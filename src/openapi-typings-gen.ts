#!/usr/bin/env node
import fs from 'fs/promises'
import path from 'path'
import YAML from 'yaml'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import prettier from 'prettier'
import { OpenApiIR } from './types'
import {
    renderComponents,
    renderPaths,
    renderOperations,
    renderPathsDictionary,
    generateIROperations,
    generateComponentTypes,
    renderZodOperationMappings,
} from './functions'
import { parseArgs } from './cli-parser'

const CONSTANT_TYPES = `
export type ImplicitParamValue = string | number
        export interface UnknownParamsObject {
            [parameter: string]: ImplicitParamValue
        }
        export type SingleParam = ImplicitParamValue
        export type Parameters<ParamsObject = UnknownParamsObject> =
            | ParamsObject
            | SingleParam
        export type OperationResponse<T = any> = Promise<T>
        export type AxiosRequestConfig = any
`

const loadSpec = async (file: string): Promise<OpenApiIR> => {
    const content = await fs.readFile(file, 'utf-8')
    if (file.endsWith('.yaml') || file.endsWith('.yml')) return YAML.parse(content)
    return JSON.parse(content)
}

const generateTypes = async (spec: OpenApiIR, keepNoOpId: boolean, zod: boolean): Promise<string> => {
    const bundled = (await $RefParser.bundle(spec)) as OpenApiIR
    const operations = generateIROperations(bundled, keepNoOpId)
    const components = generateComponentTypes(bundled.components)
    const componentsString = renderComponents(components, zod)
    const pathsString = renderPaths(operations)
    const opsString = renderOperations(operations)
    const pathDictString = renderPathsDictionary(operations)
    const zodMappingString = renderZodOperationMappings(operations)

    const combinedString = `
        /* eslint-disable @typescript-eslint/no-namespace */
    
        ${zod ? "import { z } from 'zod'" : ''}

        // Automatically generated types
        ${componentsString}

        ${pathsString}

        ${opsString}

        ${pathDictString}

        ${zod ? zodMappingString : ''}

        ${CONSTANT_TYPES}
    `

    return combinedString
}

const main = async () => {
    const { keepNoOpId, input, output, zod } = parseArgs(process.argv)
    const file = input ?? process.argv[2]
    if (!file) {
        console.error(
            `Usage:
@kallinen/openapi-typings-gen <options>

Options:
-i, --input   Path to input OpenAPI spec (json|yaml)
-o, --output  Path to output .ts file
-k, --keep    Keep methods without operationId (optional)
-z, --zod     Generate Zod validation schemas (optional)`,
        )
        process.exit(1)
    }
    const spec = await loadSpec(path.resolve(file))
    const types = await generateTypes(spec, keepNoOpId, zod)
    const config: prettier.Options = {
        parser: 'typescript',
        semi: false,
        singleQuote: true,
        tabWidth: 4,
        trailingComma: 'all',
        bracketSpacing: true,
        printWidth: 100,
    }
    const formatted = await prettier.format(types, config)

    if (!output) {
        console.log(formatted)
    } else {
        await fs.writeFile(path.resolve(output), formatted)
    }
}

main()
