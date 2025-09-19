[![npm module](https://badge.fury.io/js/@kallinen%2Fopenapi-typings-gen.svg)](https://www.npmjs.org/package/@kallinen/openapi-typings-gen)

# OpenAPI type generator

Generate types from OpenAPI v3 documentation (json or yaml) with single command

```
npx @kallinen/openapi-typings-gen openapi.json > openapi-types.d.ts
```

The library supports also methods that don't have operationId set by adding -k as argument

```
npx @kallinen/openapi-typings-gen -k -i openapi.json -o openapi-types.d.ts
```
