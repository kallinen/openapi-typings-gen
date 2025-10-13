import { renderZod, TypeNode } from "../functions"

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
})
