# Contract diff — OpenAPI 3.0/3.1 and AsyncAPI 2.6/3.0 (spec)

_Spec written before the implementation (design notes §7.1, decisions D-081, D-082, D-085, D-090). Fixtures I-C1 to
I-C10 in `test/contract/` encode this document; where they disagree, this document is fixed first._

For OpenAPI and AsyncAPI files, Impact Check compares the base and head versions of each changed contract file
structurally. This replaces the path-based `api-contract-changed` hypothesis for those formats. GraphQL, protobuf,
Avro, Thrift, Prisma and `*.schema.json` files keep `api-contract-changed`.

The engine is native (Node only, offline). Files are parsed with one pinned YAML parser (`yaml` 2.9.1, ISC) using the
YAML 1.2 core schema. JSON files go through the same parser, which gives line numbers for both. Nothing in a contract
is evaluated, fetched or resolved outside the file itself.

## 1. Which files are compared

A changed file (added, modified, renamed or deleted) is a **contract candidate** if either:

- its path matches the existing contract name patterns `*openapi*.{yaml,yml,json}`, `*swagger*.{yaml,yml,json}` or
  `asyncapi*.{yaml,yml,json}` (case-insensitive file name); or
- it is a `.yaml`/`.yml` file with a top-level `openapi:` or `asyncapi:` key at column 0, or a `.json` file whose first
  key is `"openapi"` or `"asyncapi"` (head side, or base side for deleted files).

Each side of a candidate is classified:

| Side content                                                       | Format           |
| ------------------------------------------------------------------ | ---------------- |
| mapping with `openapi: "3.0.x"` or `"3.1.x"` (string)              | OpenAPI 3.0/3.1  |
| mapping with `asyncapi: "2.6.x"` or `"3.0.x"` (string)             | AsyncAPI 2.6/3.0 |
| mapping with any other `openapi`/`asyncapi` value, or `swagger`    | unsupported      |
| parse error, not a mapping, or larger than 1 MiB                   | unparseable      |
| a mapping without `openapi`, `asyncapi` or `swagger` (e.g. config) | not a contract   |

Outcome per file:

- **Both sides not a contract** (or only one side exists and it is not a contract): the file keeps the path-based
  `api-contract-changed` rule if its name matches; otherwise it is ignored by contract rules.
- **Added file** (no base side): nothing is reported. A new contract has no consumers of a previous version.
- **Deleted file** whose base is a supported contract: one `contract-breaking-change` with a single evidence item,
  change `document-removed`, pointer `""`.
- **Either side unsupported or unparseable** (including a format or major-version change between sides):
  `contract-breaking-change` with status `unknown` (§5).
- **Both sides supported, same format**: structural diff (§2–§4).

## 2. Diff model

The diff walks known structure and classifies every difference as one of:

- **break** — a listed breaking change (§3); reported in `contract-breaking-change` (`verified_static_fact`).
- **unclassified** — a semantic difference whose compatibility depends on how consumers use the contract (§4);
  reported in `contract-change-unclassified` (`hypothesis`).
- **compatible** — additions that cannot break an existing consumer (new path, new operation, new optional parameter,
  new optional request property, new response property, new response status, new enum value in a request, a narrower
  response type); not reported.
- **cosmetic** — not reported. These keys are ignored everywhere: `description`, `summary`, `title`, `example`,
  `examples`, `externalDocs`, `$comment`, `tags`, every key starting with `x-`, and the whole `info` object. Key
  order, quoting, comments, YAML vs JSON flow style and anchors/aliases never matter: values are compared after
  parsing.

**Local `$ref`** (`#/…`) is resolved inside the same document before comparing; the pointer reported is where the
referenced element is defined (for example `/components/schemas/Pet/properties/name`). Each distinct
`(change, pointer)` pair is reported once, even when several operations reach it; the detail names the first
operation or message (in sorted order) that reached it. Reference cycles are followed once per pair of base and head
locations. A `$ref` that does not start with `#` (another file or a URL), or a local `$ref` whose target does not exist,
is **unresolved** (§5). Components that no operation or message reaches are not compared, except
`components/securitySchemes`.

### Schema directions

The same JSON Schema change means different things depending on who produces the value:

| Direction | Where                                                                       | Producer       |
| --------- | --------------------------------------------------------------------------- | -------------- |
| request   | OpenAPI parameter schemas and request-body schemas                          | client         |
| response  | OpenAPI response schemas                                                    | server         |
| both      | AsyncAPI message payloads (the document does not say who the other side is) | either or both |

Schema comparison (`type` is a set: `nullable: true` adds `null`; `number` includes `integer`; a missing `type`
means "any"):

| Difference                                                                                                                                          | request      | response     | both         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------ | ------------ |
| property removed from `properties`                                                                                                                  | unclassified | **break**    | **break**    |
| property added to `required` (new or existing)                                                                                                      | **break**    | compatible   | **break**    |
| property removed from `required` (still present)                                                                                                    | compatible   | unclassified | unclassified |
| head type set does not contain the base type set                                                                                                    | **break**    | compatible   | **break**    |
| head type set strictly larger than base                                                                                                             | compatible   | unclassified | unclassified |
| enum value removed (both sides have `enum`)                                                                                                         | **break**    | compatible   | **break**    |
| enum value added                                                                                                                                    | compatible   | unclassified | unclassified |
| `enum` added or removed entirely                                                                                                                    | unclassified | unclassified | unclassified |
| any other keyword differs (`pattern`, `format`, `minimum`, `maxLength`, `default`, `additionalProperties`, `const`, `readOnly`, `discriminator`, …) | unclassified | unclassified | unclassified |
| `oneOf`/`anyOf`/`allOf`/`not` differ (compared as a whole, not descended)                                                                           | unclassified | unclassified | unclassified |

Comparison descends into `properties` present on both sides and into `items`.

## 3. Breaking changes (`contract-breaking-change`, verified_static_fact)

| `change`                    | I-C  | OpenAPI                                                                                                                                                                        | AsyncAPI                                                                                                            |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `path-removed`              | I-C1 | a key of `paths` is gone (path templates match ignoring parameter names: `/pets/{id}` = `/pets/{petId}`)                                                                       | —                                                                                                                   |
| `operation-removed`         | I-C1 | an HTTP method (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`) is gone from a surviving path                                                             | 2.6: `publish`/`subscribe` gone from a surviving channel; 3.0: a key of `operations` is gone                        |
| `channel-removed`           | I-C1 | —                                                                                                                                                                              | 2.6: a key of `channels` is gone; 3.0: a channel whose `address` (or key, without `address`) is gone                |
| `message-removed`           | I-C1 | —                                                                                                                                                                              | a message of a surviving operation (2.6) or channel (3.0) is gone; identity `messageId`, `name`, `$ref` target, key |
| `response-status-removed`   | I-C2 | a key of an operation's `responses` (including `default`) is gone                                                                                                              | —                                                                                                                   |
| `required-added`            | I-C3 | a parameter that is required in head (`in: path`, or `required: true`) was absent or optional in base; a request body became required; a request property became required (§2) | a payload property became required (§2)                                                                             |
| `response-property-removed` | I-C4 | a property is gone from a response schema (§2)                                                                                                                                 | a property is gone from a payload (§2)                                                                              |
| `type-narrowed`             | I-C5 | a request schema no longer accepts a type it accepted (§2)                                                                                                                     | a payload no longer allows a type it allowed (§2)                                                                   |
| `enum-value-removed`        | I-C6 | a request enum lost a value (§2)                                                                                                                                               | a payload enum lost a value (§2)                                                                                    |
| `server-removed`            | I-C7 | a top-level `servers[].url` is gone (compared without trailing `/`)                                                                                                            | a key of top-level `servers` is gone                                                                                |
| `security-scheme-removed`   | I-C8 | a key of `components/securitySchemes` is gone                                                                                                                                  | a key of `components/securitySchemes` is gone                                                                       |
| `document-removed`          | —    | the contract file was deleted                                                                                                                                                  | the contract file was deleted                                                                                       |

Parameters are identified by `(in, name)` after resolving `$ref`; path parameters by `in: path` and their position in
the path template. Path-level `parameters` apply to every operation of the path unless an operation overrides them.

## 4. Unclassified changes (`contract-change-unclassified`, hypothesis)

Every other semantic difference: the "unclassified" cells of §2; a parameter removed; a request or response media
type removed or added; request body removed; `security` requirements, `servers` on paths/operations, `operationId`,
`deprecated`, `callbacks`, `webhooks`, `links`, response `headers`, parameter `style`/`explode`/`schema` keywords not
covered by §2; server variables or protocol changed; a security scheme's definition changed; AsyncAPI `bindings`,
`traits`, `headers`, `correlationId`, channel `parameters`, operation `action`/`channel`/`reply`; a change of the minor
spec version (`3.0` → `3.1`, `2.6` → … within the supported set). Each is reported at the pointer where it occurs.

## 5. Unknown (`contract-breaking-change`, status `unknown`)

Compatibility cannot be decided when:

- either side is unparseable or unsupported (`swagger: "2.0"`, `openapi: "3.2.0"`, `asyncapi: "2.5.0"`, …), or the
  format changes between sides; evidence: one item per affected side, change `unparseable` or `unsupported-version`;
- either side contains an **unresolved** `$ref` (§2); evidence: one item per unresolved reference, change
  `unresolved-ref`, pointer = location of the `$ref` key, detail = `unresolved $ref (external or missing target)`.
  The reference value itself is never printed (it may be a URL with credentials).

When a file has unresolved references, the rest of the file is still compared: breaks and unclassified changes found
elsewhere are reported as usual, because they do not depend on the unresolved content. The limitation
`contract-diff-incomplete` lists the file.

## 6. Evidence

Every reported item is one evidence entry of kind `contract-element` with an extra `contract` object:

```json
{
  "kind": "contract-element",
  "path": "api/openapi.yaml",
  "side": "base",
  "line_start": 14,
  "line_end": 14,
  "commit": "<base commit>",
  "detail": "operation removed: DELETE /pets/{petId}",
  "contract": {
    "change": "operation-removed",
    "pointer": "/paths/~1pets~1{petId}/delete",
    "base_line": 14,
    "head_line": 9
  }
}
```

- `pointer` is an RFC 6901 JSON pointer (`~0` for `~`, `~1` for `/`) into the side that holds the element: base for
  removals, head otherwise.
- `base_line` / `head_line` are 1-based lines of the element in each revision: the line of its mapping key (or of the
  sequence item). If the element does not exist on one side, that side's line is the line of the **deepest ancestor
  that exists there** (for a removed operation: its path key in head), or `null` if none exists (deleted file).
- `side` is `base` for removals and `head` otherwise; `line_start` = `line_end` = that side's line; `path` is that
  side's file path (the previous path of a renamed file for `base`).
- Evidence is sorted by `pointer`, then `change`. At most 25 entries per finding; the summary gives the total count.
- Details contain only keys, HTTP methods, status codes, type names, enum values and channel/message names from the
  document, redacted and escaped like every other repository string. Never values of `default`, `example`, `const`
  or server URLs.

## 7. Findings

| Rule                           | Category     | Status               | Severity | Confidence | Provenance |
| ------------------------------ | ------------ | -------------------- | -------- | ---------- | ---------- |
| `contract-breaking-change`     | api-contract | verified_static_fact | medium   | high       | graph      |
| `contract-breaking-change`     | api-contract | unknown              | medium   | low        | graph      |
| `contract-change-unclassified` | api-contract | hypothesis           | low      | medium     | inferred   |

At most one finding per rule and status per file. Severity is `medium`, not `high`, by the same reasoning as
`export-removed`: the contract changed incompatibly, but Impact Check cannot see whether any consumer uses the removed
element. The default `check` policy (fail on `high`) is therefore unchanged by this feature.

## 8. Limits

- No resolution of external `$ref` (other files, URLs): reported as `unknown`, never fetched.
- OpenAPI 2.0 (Swagger) and OpenAPI 3.2 are unsupported (`unknown`).
- AsyncAPI message `traits` and OpenAPI `allOf` are not merged; changes inside them are unclassified.
- `webhooks` and `callbacks` are compared as a whole (unclassified).
- Files over 1 MiB are not parsed (`unknown`). YAML aliases are expanded up to the parser's default limit (100);
  more aliases make the side unparseable.
