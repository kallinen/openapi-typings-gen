import { TypeNode } from './functions'

export const isSchemaRef = (s: SchemaRef | Schema): s is SchemaRef => {
    return !!(s as SchemaRef).$ref
}

export type SchemaRef = { $ref: string } // keep for later resolution

export interface Schema {
    anyOf: (Schema | SchemaRef)[]
    oneOf: (Schema | SchemaRef)[]
    allOf: (Schema | SchemaRef)[]
    not: (Schema | SchemaRef)[]
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
    properties?: Record<string, Schema | SchemaRef>
    items?: Schema | SchemaRef
    required?: string[]
    enum?: any[]
    format?: string
    description?: string
    example?: any
}

export interface OpenAPIParameter {
    name: string
    required: boolean
    in: 'path' | 'query' | 'header' | 'cookie'
    schema: Schema | SchemaRef
}

export interface MediaTypeObject {
    schema: Schema | SchemaRef
}

export interface RequestBody {
    schema: Schema | SchemaRef
    contentType: string
    content?: Record<string, MediaTypeObject>
}

export interface MediaType {
    schema?: Schema | SchemaRef
    example?: any
    examples?: Record<string, any>
    encoding?: Record<string, any>
}

export interface OpenAPIResponse {
    description?: string
    headers?: Record<string, any>
    content?: Record<string, MediaType>
}

export type Responses = Record<string, OpenAPIResponse>

export interface Operation {
    operationId: string
    summary?: string
    description?: string
    parameters: OpenAPIParameter[]
    requestBody?: RequestBody
    responses: Responses
}

export interface PathItem {
    methods: Record<string, Operation>
}

export interface OpenApiIR {
    paths: Record<string, Record<string, Operation>>
    components: Record<string, Schema>
}

export interface TypedParam {
    param: OpenAPIParameter
    typeNode: TypeNode
    typeName: string
}

export interface OperationIR {
    id: string
    path: string
    method: string
    summary: string
    description?: string
    parameters: {
        path: TypedParam[]
        query: TypedParam[]
        header: TypedParam[]
        cookie: TypedParam[]
    }
    requestBody?: {
        contentType: string
        type: TypeNode
    }
    responses: Responses
}

export interface ComponentIR {
    name: string
    type: TypeNode
    description?: string
}
