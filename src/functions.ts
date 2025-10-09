import { camelCase, upperFirst } from 'lodash'
import {
    ComponentIR,
    isSchemaRef,
    MediaType,
    OpenApiIR,
    OpenAPIResponse,
    OperationIR,
    Responses,
    Schema,
    SchemaRef,
    TypedParam,
} from './types'

type TypeNodeBase = {
    description?: string
    example?: string
}

export type TypeNode =
    | ({ kind: 'identifier' } & TypeNodeBase & { name: string })
    | ({ kind: 'literal' } & TypeNodeBase & { value: string | number | boolean })
    | ({ kind: 'array' } & TypeNodeBase & { element: TypeNode })
    | ({ kind: 'union' } & TypeNodeBase & { types: TypeNode[] })
    | ({ kind: 'intersection' } & TypeNodeBase & { types: TypeNode[] })
    | ({ kind: 'generic' } & TypeNodeBase & { base: TypeNode; params: TypeNode[] })
    | ({ kind: 'object' } & TypeNodeBase & { properties: Record<string, TypeNode>; required: string[] })

export const identifier = (name: string, schema?: Schema): TypeNode => ({ kind: 'identifier', name, ...schema })
export const union = (types: TypeNode[]): TypeNode => ({ kind: 'union', types })
export const intersection = (types: TypeNode[]): TypeNode => ({ kind: 'intersection', types })
export const generic = (base: TypeNode, params: TypeNode[]): TypeNode => ({ kind: 'generic', base, params })
export const literal = (value: string | number | boolean): TypeNode => ({ kind: 'literal', value })
export const arrayOf = (element: TypeNode): TypeNode => ({ kind: 'array', element })

export const generateComponentTypes = (components: OpenApiIR['components']): ComponentIR[] => {
    if (!components?.schemas) return []
    return Object.entries(components.schemas).map(([name, schema]: [name: string, schema: Schema]) => ({
        ...schema,
        name: toSafeName(name),
        type: mapSchemaToTypeNode(schema),
    }))
}

export const generateIROperations = (spec: OpenApiIR, keepNoOpId: boolean): OperationIR[] => {
    const operations: OperationIR[] = []

    for (const [pathKey, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods)) {
            if (!op) continue
            if (!keepNoOpId && !op.operationId) continue
            const opId = op.operationId
                ? toSafeName(op.operationId)
                : toSafeName(camelCase(`${method} ${pathKey.replace(/[\/{}]/g, ' ')}`))
            const summary = `${opId}${op.summary ? ` – ${op.summary}` : ''}`

            const filteredParams = (op.parameters || []).filter((p) => !p.name.endsWith('@TypeHint'))

            const parameters = filteredParams.map((p) => {
                const typeName = upperFirst(toSafeName(p.name))
                const typeNode = mapSchemaToTypeNode(p.schema)
                return { param: p, typeName, typeNode } as TypedParam
            })

            const requestBody: OperationIR['requestBody'] = (() => {
                if (!op.requestBody?.content) return undefined
                const [contentType, media] = Object.entries(op.requestBody.content)[0]
                return {
                    contentType,
                    type: mapSchemaToTypeNode(media.schema),
                }
            })()

            const responses: Responses = Object.fromEntries(
                Object.entries(op.responses ?? {}).map(([status, resp]) => [
                    status,
                    {
                        description: resp.description,
                        headers: resp.headers,
                        content: resp.content
                            ? Object.fromEntries(
                                  Object.entries(resp.content).map(([mime, media]) => [
                                      mime,
                                      {
                                          schema: media.schema,
                                          example: media.example,
                                          examples: media.examples,
                                          encoding: media.encoding,
                                      } as MediaType,
                                  ]),
                              )
                            : undefined,
                    } as OpenAPIResponse,
                ]),
            )
            operations.push({
                id: opId,
                path: pathKey,
                method,
                parameters: {
                    cookie: parameters.filter((x) => x.param.in === 'cookie'),
                    header: parameters.filter((x) => x.param.in === 'header'),
                    path: parameters.filter((x) => x.param.in === 'path'),
                    query: parameters.filter((x) => x.param.in === 'query'),
                },
                summary,
                responses,
                description: op.description,
                requestBody,
            })
        }
    }
    return operations
}

const toComment = (input: string | string[], prefix = ' * '): string => {
    const lines = Array.isArray(input) ? input : input.split('\n')
    const formatted = lines.map((line) => `${prefix}${line}`)
    return ['/**', ...formatted, ' */'].join('\n')
}

const cleanDescription = (desc?: string): string | undefined => {
    if (!desc) return undefined
    let cleaned = desc.replace(/<\/?[^>]+(>|$)/g, '')
    cleaned = cleaned
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
    return cleaned
}

export const renderComponents = (components: ComponentIR[], zod: boolean) => {
    return `
    export namespace Components {
        export namespace Schemas {
            ${zod ? renderZodComponents(components) : ''}

            ${components
                .map((item) => {
                    const exportType = item.type.kind === 'object' ? 'interface' : 'type'
                    const equals = exportType === 'type' ? ' =' : ''
                    return `
            ${item.description ? `/** ${cleanDescription(item.description)} */` : ''}
            export ${exportType} ${item.name}${equals} ${renderTypeWithComment(item.type)}`
                })
                .join('\n')}
        }
    }
    
    ${components.map((item) => `export type ${item.name} = Components.Schemas.${item.name}`).join('\n')}
    `
}
const isSafeParam = (name: string) => /^[$A-Z_][0-9A-Z_$]*$/i.test(name)
const safeParamName = (name: string) => (isSafeParam(name) ? name : `"${name}"`)
const toSafeName = (name: string): string => {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

export const renderZod = (node: TypeNode, processing: Set<string> = new Set()): string => {
    switch (node.kind) {
        case 'identifier':
            if (['string', 'number', 'boolean'].includes(node.name!)) {
                return `z.${node.name}()`
            }
            if (node.name === '{ [key: string]: any }') {
                return `z.record(z.string(), z.any())`
            }
            if (processing.has(node.name!)) {
                return `z.lazy(() => ${node.name}Schema)`
            }
            return `${node.name}Schema`

        case 'literal':
            return `z.literal(${JSON.stringify(node.value)})`

        case 'array':
            return `z.array(${renderZod(node.element!, processing)})`

        case 'union':
            return `z.union([${node.types!.map((t) => renderZod(t, processing)).join(', ')}])`

        case 'intersection':
            return `z.intersection(${renderZod(node.types![0], processing)}, ${renderZod(node.types![1], processing)})`

        case 'object': {
            const props = Object.entries(node.properties || {})
                .map(([key, val]) => {
                    const required = node.required?.includes(key) ? '' : '.optional()'
                    return `"${key}": ${renderZod(val, processing)}${required}`
                })
                .join(', ')
            return `z.object({ ${props} })`
        }

        case 'generic':
            return `${renderZod(node.base!, processing)}<${node.params!.map((p) => renderZod(p, processing)).join(', ')}>`
    }
}

export const renderZodComponents = (components: ComponentIR[]): string => {
    const processing = new Set<string>()

    return components
        .map((item) => {
            processing.add(item.name)
            const schemaStr = renderZod(item.type, processing)
            processing.delete(item.name)

            return `export const ${item.name}Schema: z.ZodType<any> = ${schemaStr};`
        })
        .join('\n\n')
}

export const renderZodOperationMappings = (operations: OperationIR[]): string => {
    const lines: string[] = []
    lines.push(`export const apiResponseValidators = {`)

    for (const op of operations) {
        // Find first successful (2xx) response
        const successResponse = Object.entries(op.responses).find(([status]) => status.startsWith('2'))
        let responseSchemaName: string | undefined
        if (successResponse) {
            const resp = successResponse[1]
            const media = Object.values(resp.content || {})[0] as MediaType | undefined
            const schema = media?.schema
            if (schema && isSchemaRef(schema)) {
                responseSchemaName = toSafeName(schema.$ref.split('/').pop()!)
            }
        }

        const responseSchemaStr = responseSchemaName ? `Components.Schemas.${responseSchemaName}Schema` : 'undefined'

        lines.push(`${op.id}: ${responseSchemaStr},`)
    }

    lines.push(`} as const`)
    return lines.join('\n')
}

export const renderPaths = (operations: OperationIR[]) => {
    const operationsString = operations
        .map((op) => {
            // helper to render a parameter safely
            const renderParam = (p: TypedParam) => {
                if (isSafeParam(p.typeName)) {
                    return `export type ${p.typeName} = ${renderType(p.typeNode)};`
                } else {
                    // fallback: inline object with original param name
                    return `export interface Param_${toSafeName(p.typeName)} {\n    "${p.param.name}": ${renderType(p.typeNode)};\n}`
                }
            }
            const mapFn = (p: TypedParam) => {
                let typeRef: string
                if (isSafeParam(p.typeName)) {
                    typeRef = `Parameters.${safeParamName(p.typeName)}`
                } else {
                    typeRef = `Parameters.Param_${toSafeName(p.typeName)}["${p.param.name}"]`
                }

                return `    ${safeParamName(p.param.name)}${p.param.required ? '' : '?'}: ${typeRef};`
            }
            const pathParamsLines = op.parameters.path.map(mapFn).join('\n')

            const queryParamsLines = op.parameters.query.map(mapFn).join('\n')

            return `
            export namespace ${upperFirst(op.id)} {
                export type RequestBody = ${op.requestBody ? renderType(op.requestBody.type) : 'undefined'};

                export namespace Parameters {
                    ${[...op.parameters.path, ...op.parameters.query].map(renderParam).join('\n')}
                }

                export interface PathParameters {
                    ${pathParamsLines}
                }

                export interface QueryParameters {
                    ${queryParamsLines}
                }

                export namespace Responses {
                    ${Object.entries(op.responses)
                        .map(([status, resp]) => {
                            if (!resp.content) {
                                return `export type $${status} = undefined;`
                            }

                            const entries = Object.entries(resp.content)

                            const typeNodes = entries.map(([_, media]) =>
                                media.schema
                                    ? mapSchemaToTypeNode(media.schema)
                                    : ({ kind: 'identifier', name: 'unknown' } satisfies TypeNode),
                            )

                            const deduped = Array.from(new Map(typeNodes.map((tn) => [renderType(tn), tn])).values())

                            const tsType = renderType(union(deduped))

                            const mimes = entries.map(([mime]) => mime).join(', ')

                            return `/** ${mimes} */\nexport type $${status} = ${tsType};`
                        })
                        .join('\n')}
                }
            }`
        })
        .join('\n')

    return `export namespace Paths {
                ${operationsString}
            }`
}

export const renderOperations = (operations: OperationIR[]) => {
    const renderWithComment = (op: OperationIR, typing: string) => {
        const parts = [op.summary, op.description].filter(Boolean).map(cleanDescription)
        if (!parts.length) return typing

        const comment = parts.map((line) => ` * ${line}`).join('\n')
        return `/**\n${comment}\n */\n${typing}`
    }

    return `
        export interface OperationMethods {
        ${operations
            .map((op) => {
                const operationName = upperFirst(op.id)
                const paramsTypeParts: string[] = []
                if (op.parameters.path.length) paramsTypeParts.push(`Paths.${operationName}.PathParameters`)
                if (op.parameters.query.length) paramsTypeParts.push(`Paths.${operationName}.QueryParameters`)

                const paramsType =
                    paramsTypeParts.length > 0 ? `Parameters<${paramsTypeParts.join(' & ')}>` : 'null | undefined'
                const reqBody = op.requestBody ? `Paths.${operationName}.RequestBody` : 'undefined'
                const mainResp = Object.keys(op.responses)[0]
                    ? `Paths.${operationName}.Responses.$${Object.keys(op.responses)[0]}`
                    : 'any'
                return renderWithComment(
                    op,
                    `${op.id}: (parameters?: ${paramsType}, data?: ${reqBody}, config?: AxiosRequestConfig) => OperationResponse<${mainResp}>;`,
                )
            })
            .join('\n')}
        }
    `
}

export const renderPathsDictionary = (operations: OperationIR[]) => {
    const grouped = operations.reduce<Record<string, OperationIR[]>>((acc, op) => {
        if (!acc[op.path]) acc[op.path] = []
        acc[op.path].push(op)
        return acc
    }, {})

    return `
        export interface PathsDictionary {
        ${Object.entries(grouped)
            .map(([path, ops]) => {
                const methodsStr = ops
                    .map((op) => {
                        const operationName = upperFirst(op.id)

                        const paramsTypeParts: string[] = []
                        if (op.parameters.path.length) paramsTypeParts.push(`Paths.${operationName}.PathParameters`)
                        if (op.parameters.query.length) paramsTypeParts.push(`Paths.${operationName}.QueryParameters`)

                        const paramsType =
                            paramsTypeParts.length > 0
                                ? `Parameters<${paramsTypeParts.join(' & ')}>`
                                : 'null | undefined'

                        const reqBody = op.requestBody ? `Paths.${operationName}.RequestBody` : 'undefined'

                        const mainResp = Object.keys(op.responses)[0]
                            ? `Paths.${operationName}.Responses.$${Object.keys(op.responses)[0]}`
                            : 'any'

                        return `  ${op.method}: (parameters?: ${paramsType}, data?: ${reqBody}, config?: AxiosRequestConfig) => OperationResponse<${mainResp}>;`
                    })
                    .join('\n')

                return `  '${path}': {\n${methodsStr}\n  }`
            })
            .join('\n')}
        }
    `
}

export const renderTypeWithComment = (node: TypeNode): string => {
    const typeStr = renderType(node)
    const d = cleanDescription(node.description)
    return node.description ? `/** ${d} */\n${typeStr}` : typeStr
}

export const renderType = (node: TypeNode): string => {
    switch (node.kind) {
        case 'identifier':
            return node.name
        case 'literal':
            return JSON.stringify(node.value)
        case 'array': {
            const elem = renderType(node.element)
            if (node.element.kind === 'union' || node.element.kind === 'intersection') {
                return `(${elem})[]`
            }
            return `${elem}[]`
        }
        case 'union':
            return node.types.map(renderType).join(' | ')
        case 'intersection':
            return node.types.map(renderType).join(' & ')
        case 'generic':
            return `${renderType(node.base)}<${node.params.map(renderType).join(', ')}>`
        case 'object': {
            const props = Object.entries(node.properties).map(([name, type]) => {
                const optional = node.required?.includes(name) ? '' : '?'
                let lines: string[] = []
                if (type.description) {
                    lines.push(`${cleanDescription(type.description)}`)
                }

                if (type.example !== undefined) {
                    lines.push('example:')
                    const example = typeof type.example === 'string' ? type.example : JSON.stringify(type.example)
                    lines.push(example)
                }
                if (lines.length) {
                    lines = [toComment(lines)]
                }

                lines.push(`    ${safeParamName(name)}${optional}: ${renderType(type)};`)

                return lines.join('\n')
            })

            return `{\n${props.join('\n')}\n}`
        }
    }
}

export const mapSchemaToTypeNode = (
    schema: Schema | SchemaRef,
    ancestors: (Schema | SchemaRef)[] = [],
    depth = 0,
): TypeNode => {
    if (!schema) return identifier('any')

    if (isSchemaRef(schema)) {
        const refName = schema.$ref.split('/').pop() || 'any'
        return identifier(`Components.Schemas.${toSafeName(refName)}`)
    }

    // prevent runaway recursion
    if (ancestors.includes(schema) || depth > 5) return identifier(schema.type ?? 'any', schema)

    if (schema.enum) {
        return union(schema.enum.map((v) => literal(v)))
    }

    if (schema.anyOf) {
        return union(schema.anyOf.map((v) => mapSchemaToTypeNode(v, ancestors, depth + 1)))
    }

    if (schema.allOf) {
        return intersection(schema.allOf.map((v) => mapSchemaToTypeNode(v, ancestors, depth + 1)))
    }

    if (schema.oneOf) {
        return union(schema.oneOf.map((v) => mapSchemaToTypeNode(v, ancestors, depth + 1)))
    }

    switch (schema.type) {
        case 'string':
            return identifier('string', schema)
        case 'integer':
        case 'number':
            return identifier('number', schema)
        case 'boolean':
            return identifier('boolean', schema)
        case 'array':
            return arrayOf(mapSchemaToTypeNode(schema.items!, [...ancestors, schema], depth + 1))
        case 'object': {
            if (schema.properties) {
                console
                const props: Record<string, TypeNode> = {}
                for (const [k, v] of Object.entries(schema.properties)) {
                    props[k] = mapSchemaToTypeNode(v as Schema | SchemaRef, [...ancestors, schema], depth + 1)
                }
                return {
                    kind: 'object',
                    properties: props,
                    required: schema.required || [],
                    description: schema.description,
                    example: schema.example,
                }
            }
            return identifier('{ [key: string]: any }', schema)
        }
        default:
            return identifier('any', schema)
    }
}
