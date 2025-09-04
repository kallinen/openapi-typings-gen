#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { camelCase, upperFirst } from 'lodash'
import prettier from 'prettier'

export interface OpenAPISpec {
    openapi: string
    info: any
    paths: Record<string, any>
    components?: { schemas?: Record<string, any> }
}

const loadSpec = (file: string): OpenAPISpec => {
    const content = fs.readFileSync(file, 'utf-8')
    if (file.endsWith('.yaml') || file.endsWith('.yml')) return YAML.parse(content)
    return JSON.parse(content)
}

const toSafeName = (name: string): string => {
    return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

const makeComment = (schema: Record<string, any>, indentLevel = 0): string => {
    if (!schema) return ''
    const lines: string[] = []
    if (schema.description) lines.push(schema.description)
    if (schema.example !== undefined) {
        let exampleStr: string[]
        if (typeof schema.example === 'object') {
            exampleStr = JSON.stringify(schema.example, null, 2)
                .split('\n')
        } else {
            exampleStr = [String(schema.example)]
        }

        // Prefix each line with proper JSDoc indentation
        const indent = ' '.repeat(indentLevel * 2)
        const formattedExample = exampleStr.map((line) => `${indent} * ${line}`).join('\n')
        lines.push(`example:\n${formattedExample}`)
    }

    if (!lines.length) return ''
    const indent = ' '.repeat(indentLevel * 2)
    return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join('\n')}\n${indent} */\n`
}

const mapSchemaToType = (schema: Record<string, any>, indentLevel = 0, ancestors: any[] = [], depth = 0): string => {
    if (!schema) return 'any'
    if (schema.$ref) {
        const refName = schema.$ref.split('/').pop() || 'any'
        return `Components.Schemas.${toSafeName(refName)}`
    }

    // Prevent runaway recursion
    if (ancestors.includes(schema) || depth > 5) {
        if (schema.title) return toSafeName(schema.title)
        return 'any'
    }

    if (schema.enum) {
        return schema.enum.map((v: any) => JSON.stringify(v)).join(' | ')
    }

    switch (schema.type) {
        case 'string':
            return 'string'
        case 'integer':
        case 'number':
            return 'number'
        case 'boolean':
            return 'boolean'
        case 'array':
            return `${mapSchemaToType(schema.items, indentLevel, [...ancestors, schema], depth + 1)}[]`
        case 'object':
            if (schema.properties) {
                const props = Object.entries(schema.properties)
                    .map(([k, v]: [string, any]) => {
                        const optional = schema.required?.includes(k) ? '' : '?'
                        const comment = makeComment(v, indentLevel + 1)
                        const propName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : JSON.stringify(k)

                        return `${comment}${' '.repeat((indentLevel + 1) * 2)}${propName}${optional}: ${mapSchemaToType(
                            v,
                            indentLevel + 1,
                            [...ancestors, schema],
                            depth + 1,
                        )};`
                    })
                    .join('\n')
                return `{\n${props}\n${' '.repeat(indentLevel * 2)}}`
            }
            return '{ [key: string]: any }'
        default:
            return 'any'
    }
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

const generateComponentTypes = (spec: OpenAPISpec): string => {
    if (!spec.components?.schemas) return ''
    const entries = Object.entries(spec.components.schemas).map(([name, schema]) => {
        const typeName = toSafeName(name)
        const typeBody = mapSchemaToType(schema)
        // prefer interfaces for objects, type aliases otherwise
        if (schema.type === 'object' || schema.properties) {
            return `export interface ${typeName} ${typeBody}`
        } else {
            return `export type ${typeName} = ${typeBody};`
        }
    })
    return `export namespace Components {
  export namespace Schemas {
${entries.map((e) => '    ' + e.replace(/\n/g, '\n    ')).join('\n\n')}
  }
}`
}

const generateTypesFromSpec = (spec: OpenAPISpec): string => {
    const operations: string[] = []
    const pathEntries: string[] = []
    const pathsNamespace: string[] = []

    for (const [pathKey, methods] of Object.entries(spec.paths)) {
        const methodEntries: string[] = []

        for (const [method, op] of Object.entries<any>(methods)) {
            if (!op) continue
            const opId = op.operationId
                ? toSafeName(op.operationId)
                : toSafeName(camelCase(`${method} ${pathKey.replace(/[\/{}]/g, ' ')}`))
            const summary = `${opId}${op.summary ? ` – ${op.summary}` : ''}`

            // --- Parameters ---
            const paramsTypeParts: string[] = []
            ;['path', 'query', 'header', 'cookie'].forEach((location) => {
                const params = (op.parameters || []).filter((p: any) => p.in === location)
                if (params.length) {
                    paramsTypeParts.push(
                        `{ ${params
                            .map((p: any) => `${p.name}${p.required ? '' : '?'}: ${mapSchemaToType(p.schema)}`)
                            .join('; ')} }`,
                    )
                }
            })
            const parametersType = paramsTypeParts.length ? paramsTypeParts.join(' & ') : 'UnknownParamsObject'

            // --- Request Body ---
            let bodySchema: any
            let bodyCommentLines: string[] = []

            if (op.requestBody?.content) {
                const contentTypes = Object.keys(op.requestBody.content)
                if (contentTypes.includes('application/json')) {
                    bodySchema = op.requestBody.content['application/json'].schema
                    bodyCommentLines.push('Content type: application/json')
                } else if (contentTypes.includes('multipart/form-data')) {
                    bodySchema = op.requestBody.content['multipart/form-data'].schema
                    bodyCommentLines.push('Content type: multipart/form-data (form fields)')
                } else if (contentTypes.length > 0) {
                    bodySchema = op.requestBody.content[contentTypes[0]].schema
                    bodyCommentLines.push(`Content type: ${contentTypes[0]}`)
                }
            }

            // --- Generate comment string ---
            const bodyComment = bodyCommentLines.length ? `/** ${bodyCommentLines.join('; ')} */\n` : ''

            // --- Responses ---
            const responseInterfaces: string[] = []
            const responseRefs: string[] = []
            for (const [status, response] of Object.entries<any>(op.responses || {})) {
                const schema = response?.content?.['application/json']?.schema
                const comment = makeComment(schema, 2)
                if (!schema) {
                    // No schema -> any
                    responseInterfaces.push(`${comment}export type $${status} = any;`)
                } else if (schema.type === 'object' || schema.properties) {
                    // Object -> interface
                    const ifaceBody = mapSchemaToType(schema, 2)
                    responseInterfaces.push(`${comment}export interface $${status} ${ifaceBody}`)
                } else {
                    // Primitive or array -> type alias
                    const typeBody = mapSchemaToType(schema, 2)
                    responseInterfaces.push(`${comment}export type $${status} = ${typeBody};`)
                }

                responseRefs.push(`$${status}`)
            }

            // --- Namespace for path operation ---
            pathsNamespace.push(`export namespace ${upperFirst(opId)} {
${bodyComment}  export type RequestBody = ${bodySchema ? mapSchemaToType(bodySchema) : 'undefined'};
  export namespace Responses {
    ${responseInterfaces.join('\n    ')}
  }
}`)

            // --- OperationMethods ---
            const mainResponseRef = responseRefs[0] ? `Paths.${upperFirst(opId)}.Responses.${responseRefs[0]}` : 'any'
            const cleanedDescription = cleanDescription(op.description)
            const commentLines = [`/** ${summary}`]
            if (cleanedDescription) commentLines.push(` * ${cleanedDescription}`)
            commentLines.push(' */')

            operations.push(`
${commentLines.join('\n')}
${opId}(
  parameters?: Parameters<${parametersType}> | null,
  data?: Paths.${upperFirst(opId)}.RequestBody,
  config?: AxiosRequestConfig
): OperationResponse<${mainResponseRef}>;`)
            // --- PathsDictionary ---
            methodEntries.push(`
  '${method}': (
    parameters?: Parameters<${parametersType}> | null,
    data?: Paths.${upperFirst(opId)}.RequestBody,
    config?: AxiosRequestConfig
  ) => OperationResponse<${mainResponseRef}>;`)
        }

        if (methodEntries.length) {
            pathEntries.push(`  '${pathKey}': {${methodEntries.join('')}\n  }`)
        }
    }

    const componentTypes = generateComponentTypes(spec)
    const pathsBlock = `export namespace Paths {\n${pathsNamespace.join('\n')}\n}`

    return `
        // Auto-generated from OpenAPI spec
        ${componentTypes}

        ${pathsBlock}

        export interface OperationMethods {${operations.join('\n')}
        }

        export interface PathsDictionary {
        ${pathEntries.join('\n')}
        }

        export type Parameters<T = UnknownParamsObject> = T;
        export type OperationResponse<T = any> = Promise<T>;
        export type UnknownParamsObject = { [key: string]: any };
        export type AxiosRequestConfig = any;
        
        `
}

const generateTypes = async (spec: OpenAPISpec): Promise<string> => {
    const bundled = (await $RefParser.bundle(JSON.parse(JSON.stringify(spec)))) as OpenAPISpec
    const types = generateTypesFromSpec(bundled)

    const config: prettier.Options = {
        parser: 'typescript',
        semi: false,
        singleQuote: true,
        tabWidth: 4,
        trailingComma: 'all',
        bracketSpacing: true,
        printWidth: 100,
    }
    const formatted = prettier.format(types, config)

    return formatted
}

const main = async () => {
    const file = process.argv[2]
    if (!file) {
        console.error('Usage: openapi-typings-gen <openapi.json|yaml>')
        process.exit(1)
    }
    const spec = loadSpec(path.resolve(file))
    const dts = await generateTypes(spec)
    console.log(dts)
}

main()
