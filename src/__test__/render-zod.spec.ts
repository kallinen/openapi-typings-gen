import { renderZod, TypeNode } from '../functions'

it('renders single-member unions without z.union wrapper', () => {
    const node: TypeNode = {
        kind: 'union',
        types: [{ kind: 'literal', value: 'ControlRoom' }],
    } as const

    expect(renderZod(node)).toBe('z.literal("ControlRoom")')
})

describe('renderZod corner cases', () => {
    it('renders recursive object using z.lazy', () => {
        const node: TypeNode = {
            kind: 'object',
            properties: {
                child: { kind: 'identifier', name: 'NodeA' },
            },
            required: ['child'],
        }

        const processing = new Set(['NodeA'])
        expect(renderZod(node, processing)).toBe('z.object({ "child": z.lazy(() => NodeASchema) })')
    })

    it('renders recursive array using z.lazy', () => {
        const node: TypeNode = {
            kind: 'array',
            element: { kind: 'identifier', name: 'NodeB' },
        }

        const processing = new Set(['NodeB'])
        expect(renderZod(node, processing)).toBe('z.array(z.lazy(() => NodeBSchema))')
    })

    it('renders union of literals correctly', () => {
        const node: TypeNode = {
            kind: 'union',
            types: [
                { kind: 'literal', value: 'A' },
                { kind: 'literal', value: 'B' },
            ],
        } as const

        expect(renderZod(node)).toBe('z.union([z.literal("A"), z.literal("B")])')
    })

    it('renders intersection correctly', () => {
        const node: TypeNode = {
            kind: 'intersection',
            types: [
                { kind: 'object', properties: { a: { kind: 'identifier', name: 'string' } }, required: ['a'] },
                { kind: 'object', properties: { b: { kind: 'identifier', name: 'number' } }, required: ['b'] },
            ],
        }

        expect(renderZod(node)).toBe('z.intersection(z.object({ "a": z.string() }), z.object({ "b": z.number() }))')
    })

    it('renders deeply recursive object correctly using z.lazy', () => {
        const node: TypeNode = {
            kind: 'object',
            properties: {
                name: { kind: 'identifier', name: 'string' },
                child: { kind: 'identifier', name: 'NodeC' },
            },
            required: ['name', 'child'],
        }

        const processing = new Set(['NodeC'])

        expect(renderZod(node, processing)).toBe('z.object({ "name": z.string(), "child": z.lazy(() => NodeCSchema) })')
    })

    it('renders recursive array correctly using z.lazy', () => {
        const node: TypeNode = {
            kind: 'array',
            element: { kind: 'identifier', name: 'NodeD' },
        }

        const processing = new Set(['NodeD'])

        expect(renderZod(node, processing)).toBe('z.array(z.lazy(() => NodeDSchema))')
    })

    it('renders required nullable reference correctly', () => {
        const node: TypeNode = {
            kind: 'object',
            properties: {
                description: {
                    kind: 'identifier',
                    name: 'string',
                    nullable: true,
                },
                myschema: {
                    kind: 'identifier',
                    name: 'Components.Schemas.SomeReferencedSchema',
                    nullable: true,
                },
                orderedItems: {
                    kind: 'array',
                    element: {
                        kind: 'identifier',
                        name: 'Components.Schemas.SomeItemSchema',
                    } as any,
                },
                id: {
                    kind: 'identifier',
                    name: 'number',
                },
            },
            required: ['orderedItems', 'id', 'description', 'myschema'],
        }

        const output = renderZod(node)

        expect(output).toContain('"description": z.string().nullable()')
        expect(output).toContain('"myschema": Components.Schemas.SomeReferencedSchemaSchema.nullable()')

        expect(output).toContain('"orderedItems": z.array(Components.Schemas.SomeItemSchemaSchema)')

        expect(output).toContain('"id": z.number()')
    })
})

describe('renderZod optional/nullable handling (pre-normalization)', () => {
    it('does not duplicate nullable/optional on optional nullable field', () => {
        const node: TypeNode = {
            kind: 'object',
            properties: {
                id: { kind: 'identifier', name: 'string' },
                description: { kind: 'identifier', name: 'string', nullable: true },
            },
            required: ['id'],
        }

        const result = renderZod(node)

        // "id" should be required (no suffix)
        expect(result).toContain('"id": z.string()')

        // "description" should be nullable + optional
        expect(result).toContain('"description": z.string().nullable().optional()')

        // should not double-apply either suffix
        expect(result).not.toMatch(/nullable\(\).*nullable\(\)/)
        expect(result).not.toMatch(/optional\(\).*optional\(\)/)
    })

    it('applies optional only once for nested objects', () => {
        const node: TypeNode = {
            kind: 'object',
            properties: {
                profile: {
                    kind: 'object',
                    properties: { name: { kind: 'identifier', name: 'string' } },
                    required: ['name'],
                },
            },
            required: [],
        } as const

        const result = renderZod(node)

        // Nested object should be optional only once
        expect(result).toMatch(/"profile": z\.object\({ "name": z\.string\(\) }\)\.optional\(\)/)
        expect(result).not.toMatch(/optional\(\).*optional\(\)/)
    })

    it('should not duplicate optional/nullable on union types', () => {
        const node: TypeNode = {
            kind: 'union',
            types: [
                { kind: 'literal', value: null as any },
                { kind: 'identifier', name: 'string' },
            ],
        } as const

        const result = renderZod(node)

        // unions shouldn't get optional/nullable suffixes inside
        expect(result).toBe('z.union([z.literal(null), z.string()])')
        expect(result).not.toMatch(/optional|nullable.*optional|nullable/)
    })

    it('should not add optional/nullable to array elements by default', () => {
        const node: TypeNode = {
            kind: 'array',
            element: {
                kind: 'identifier',
                name: 'string',
            },
        } as const

        const result = renderZod(node)

        // array should not automatically wrap element
        expect(result).toBe('z.array(z.string())')
        expect(result).not.toMatch(/optional|nullable/)
    })
})
