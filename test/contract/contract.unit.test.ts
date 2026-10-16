// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Unit tests of the contract diff engine (src/analyzers/contract.ts) for cases the I-C fixtures do not cover:
 * unknowns, file-level outcomes, AsyncAPI 3.0 removals, request bodies, media types, directions, cycles and the
 * integration fallbacks (name sniffing, non-contract files, deleted/renamed files, working-tree mode).
 */
import { describe, expect, it } from "vitest";
import { diffContract, looksLikeContract, type ContractItem } from "../../src/analyzers/contract.js";
import { analyzeJson, cli, Repo } from "../helpers.js";

const changes = (items: ContractItem[]): string[] => items.map((i) => `${i.kind}:${i.change}:${i.pointer}`);
function diff(base: string | null | undefined, head: string | null | undefined): ContractItem[] {
  const r = diffContract(base, head);
  if (!r.contract) throw new Error("not a contract");
  return r.items;
}

const oas = (body: string, version = "3.0.3"): string =>
  `openapi: ${version}\ninfo:\n  title: T\n  version: 1.0.0\n${body}`;

describe("file-level outcomes", () => {
  it("added file → nothing; deleted file → document-removed", () => {
    expect(diff(undefined, oas("paths: {}\n"))).toEqual([]);
    expect(diff(oas("paths: {}\n"), undefined)).toEqual([
      expect.objectContaining({
        kind: "break",
        change: "document-removed",
        pointer: "",
        baseLine: 1,
        headLine: null,
      }),
    ]);
  });

  it("non-contract YAML/JSON is not handled; unparseable on every side is not handled", () => {
    expect(diffContract("a: 1\n", "a: 2\n")).toEqual({ contract: false });
    expect(diffContract("a: [\n", "b: {\n")).toEqual({ contract: false });
    expect(diffContract(undefined, undefined)).toEqual({ contract: false });
  });

  it("unparseable, unsupported, swagger, oversized and format changes are unknown", () => {
    expect(changes(diff(oas("paths: {}\n"), "openapi: 3.0.3\npaths: [\n"))).toEqual(["unknown:unparseable:"]);
    expect(changes(diff(oas("paths: {}\n"), "- not\n- a mapping\n"))).toEqual(["unknown:unparseable:"]);
    expect(changes(diff(oas("paths: {}\n"), null))).toEqual(["unknown:unparseable:"]);
    const swagger = diff('swagger: "2.0"\npaths: {}\n', 'swagger: "2.0"\npaths: {x: 1}\n');
    expect(changes(swagger)).toEqual([
      "unknown:unsupported-version:/swagger",
      "unknown:unsupported-version:/swagger",
    ]);
    expect(swagger[0]).toMatchObject({ side: "base", baseLine: 1 });
    expect(changes(diff(oas("paths: {}\n"), oas("paths: {}\n", "3.2.0")))).toEqual([
      "unknown:unsupported-version:/openapi",
    ]);
    expect(changes(diff("openapi: 3.1\npaths: {}\n", undefined))).toEqual([
      "unknown:unsupported-version:/openapi",
    ]);
    expect(changes(diff(oas("paths: {}\n"), "asyncapi: 2.6.0\nchannels: {}\n"))).toEqual([
      "unknown:format-changed:",
    ]);
    expect(changes(diff(oas("paths: {}\n"), "a: 1\n"))).toEqual(["unknown:format-changed:"]);
    const big = oas(`x-pad: "${"a".repeat(1024 * 1024)}"\n`);
    expect(changes(diff(oas("paths: {}\n"), big))).toEqual(["unknown:unparseable:"]);
  });

  it("alias bombs and duplicate keys are unparseable, never expanded without limit", () => {
    const bomb = ["openapi: 3.0.3", "a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let i = 0; i < 12; i++)
      bomb.push(
        `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(10)
          .fill(`*${String.fromCharCode(97 + i)}`)
          .join(", ")}]`
      );
    expect(changes(diff(oas("paths: {}\n"), `${bomb.join("\n")}\n`))).toEqual(["unknown:unparseable:"]);
    expect(changes(diff(oas("paths: {}\n"), oas("paths: {}\npaths: {}\n")))).toEqual([
      "unknown:unparseable:",
    ]);
  });

  it("deep nesting is either compared or unparseable, never a crash", () => {
    const nested = (n: number): string =>
      oas(`paths: {}\nx-n: 1\nwebhooks: ${"{a: ".repeat(n)}1${"}".repeat(n)}\n`);
    expect(changes(diff(oas("paths: {}\n"), nested(500)))).toEqual(["unclassified:added:/webhooks"]);
    expect(changes(diff(nested(500), nested(500).replace("{a: 1}", "{a: 2}")))).toHaveLength(1);
    expect(changes(diff(oas("paths: {}\n"), nested(5000)))).toEqual(["unknown:unparseable:"]);
  });

  it("a minor spec-version change is unclassified; a patch change is not reported", () => {
    expect(changes(diff(oas("paths: {}\n"), oas("paths: {}\n", "3.1.0")))).toEqual([
      "unclassified:changed:/openapi",
    ]);
    expect(diff(oas("paths: {}\n"), oas("paths: {}\n", "3.0.4"))).toEqual([]);
  });

  it("sniffs top-level openapi/asyncapi keys only", () => {
    expect(looksLikeContract("x/spec.yaml", "# c\nopenapi: 3.0.3\n")).toBe(true);
    expect(looksLikeContract("x/spec.yml", "a:\n  openapi: 3\n")).toBe(false);
    expect(looksLikeContract("spec.json", '{ "asyncapi": "3.0.0" }')).toBe(true);
    expect(looksLikeContract("package.json", '{ "dependencies": { "openapi": "1" } }')).toBe(false);
    expect(looksLikeContract("spec.txt", "openapi: 3.0.3")).toBe(false);
    expect(looksLikeContract("spec.yaml", null)).toBe(false);
  });
});

describe("OpenAPI details", () => {
  const op = (inner: string): string =>
    oas(`paths:\n  /a:\n    post:\n${inner}      responses:\n        "200":\n          description: ok\n`);

  it("request body: became required, removed, media types, compatible addition", () => {
    const body = (required: string, mt = "application/json"): string =>
      op(
        `      requestBody:\n${required}        content:\n          ${mt}:\n            schema:\n              type: object\n`
      );
    expect(changes(diff(body(""), body("        required: true\n")))).toEqual([
      "break:required-added:/paths/~1a/post/requestBody",
    ]);
    expect(changes(diff(op(""), body("        required: true\n")))).toEqual([
      "break:required-added:/paths/~1a/post/requestBody",
    ]);
    expect(diff(op(""), body(""))).toEqual([]);
    expect(changes(diff(body(""), op("")))).toEqual(["unclassified:removed:/paths/~1a/post/requestBody"]);
    expect(changes(diff(body(""), body("", "text/plain")))).toEqual([
      "unclassified:media-type-removed:/paths/~1a/post/requestBody/content/application~1json",
    ]);
  });

  it("parameters: removal is unclassified, path-level parameters apply, refs resolve", () => {
    const base = oas(
      [
        "paths:",
        "  /a/{id}:",
        "    parameters:",
        "      - $ref: '#/components/parameters/Id'",
        "    get:",
        "      parameters:",
        "        - name: q",
        "          in: query",
        "          style: form",
        "      responses: {}",
        "components:",
        "  parameters:",
        "    Id: { name: id, in: path, required: true, schema: { type: string } }",
        "",
      ].join("\n")
    );
    const head = base.replace(
      "        - name: q\n          in: query\n          style: form\n",
      "        - name: h\n          in: header\n          required: true\n"
    );
    expect(changes(diff(base, head))).toEqual([
      "unclassified:parameter-removed:/paths/~1a~1{id}/get/parameters/0",
      "break:required-added:/paths/~1a~1{id}/get/parameters/0",
    ]);
    const narrowed = base.replace("schema: { type: string }", "schema: { type: integer }");
    expect(changes(diff(base, narrowed))).toEqual([
      "break:type-narrowed:/components/parameters/Id/schema/type",
    ]);
    const styled = base.replace("style: form", "style: spaceDelimited");
    expect(changes(diff(base, styled))).toEqual([
      "unclassified:changed:/paths/~1a~1{id}/get/parameters/0/style",
    ]);
  });

  it("response direction: widening, enum additions, required removal, media types are unclassified", () => {
    const resp = (schema: string, mt = "application/json"): string =>
      oas(
        `paths:\n  /a:\n    get:\n      responses:\n        "200":\n          content:\n            ${mt}:\n              schema:\n${schema}`
      );
    const s = (lines: string[]): string => lines.map((l) => `                ${l}\n`).join("");
    const base = resp(
      s([
        "type: object",
        "required: [a]",
        "properties:",
        "  a: { type: integer, enum: [1, 2] }",
        "  b: { type: string }",
      ])
    );
    const head = resp(
      s(["type: object", "properties:", "  a: { type: number, enum: [1, 2, 3] }", "  b: { type: string }"])
    );
    expect(changes(diff(base, head))).toEqual([
      "unclassified:required-removed:/paths/~1a/get/responses/200/content/application~1json/schema/properties/a",
      "unclassified:enum-value-added:/paths/~1a/get/responses/200/content/application~1json/schema/properties/a/enum/2",
      "unclassified:type-widened:/paths/~1a/get/responses/200/content/application~1json/schema/properties/a/type",
    ]);
    // narrowing a response and removing a response enum value are compatible
    expect(
      diff(head, base.replace("                required: [a]\n", "").replace("enum: [1, 2]", "enum: [1]"))
    ).toEqual([]);
    expect(changes(diff(base, resp(s(["type: object"]), "text/csv")))).toEqual([
      "unclassified:media-type-removed:/paths/~1a/get/responses/200/content/application~1json",
      "unclassified:media-type-added:/paths/~1a/get/responses/200/content/text~1csv",
    ]);
  });

  it("schemas: items, composition, enum added, other keywords, nullable (3.0), cycles, missing local refs", () => {
    const req = (schema: string): string =>
      oas(
        `paths:\n  /a:\n    post:\n      requestBody:\n        content:\n          application/json:\n            schema:\n              $ref: '#/components/schemas/N'\n      responses: {}\ncomponents:\n  schemas:\n    N:\n${schema}`
      );
    const n = (lines: string[]): string => lines.map((l) => `      ${l}\n`).join("");
    const base = req(
      n([
        "type: object",
        "nullable: true",
        "properties:",
        "  kids: { type: array, items: { $ref: '#/components/schemas/N' } }",
        "  s: { type: string, pattern: '^a' }",
        "  o: { oneOf: [{ type: string }] }",
      ])
    );
    const head = req(
      n([
        "type: object",
        "properties:",
        "  kids: { type: array, items: { $ref: '#/components/schemas/N' } }",
        "  s: { type: string, pattern: '^b', enum: [x] }",
        "  o: { oneOf: [{ type: integer }] }",
      ])
    );
    expect(changes(diff(base, head))).toEqual([
      "unclassified:changed:/components/schemas/N/properties/o/oneOf",
      "unclassified:added:/components/schemas/N/properties/s/enum",
      "unclassified:changed:/components/schemas/N/properties/s/pattern",
      "break:type-narrowed:/components/schemas/N/type",
    ]);
    const missing = head.replace("$ref: '#/components/schemas/N' }", "$ref: '#/components/schemas/Gone' }");
    expect(changes(diff(head, missing))).toEqual([
      "unknown:unresolved-ref:/components/schemas/N/properties/kids/items/$ref",
    ]);
    const dropItems = head.replace(", items: { $ref: '#/components/schemas/N' }", "");
    expect(changes(diff(head, dropItems))).toEqual([
      "unclassified:removed:/components/schemas/N/properties/kids/items",
    ]);
    expect(changes(diff(dropItems, head))).toEqual([
      "unclassified:added:/components/schemas/N/properties/kids/items",
    ]);
    const removedProp = head.replace("  o: { oneOf: [{ type: integer }] }\n", "");
    expect(changes(diff(head, removedProp))).toEqual([
      "unclassified:property-removed:/components/schemas/N/properties/o",
    ]);
  });

  it("generic areas: security, operationId, webhooks; JSON and YAML equal; servers without a list", () => {
    const base = oas(
      "security: [{ k: [] }]\npaths:\n  /a:\n    get:\n      operationId: one\n      responses: {}\n"
    );
    const head = oas(
      "security: [{ j: [] }]\npaths:\n  /a:\n    get:\n      operationId: two\n      responses: {}\nwebhooks: { w: {} }\n"
    );
    expect(changes(diff(base, head))).toEqual([
      "unclassified:changed:/paths/~1a/get/operationId",
      "unclassified:changed:/security",
      "unclassified:added:/webhooks",
    ]);
    const json = JSON.stringify(
      {
        openapi: "3.0.3",
        info: { title: "T", version: "1" },
        security: [{ k: [] }],
        paths: { "/a": { get: { operationId: "one", responses: {} } } },
      },
      null,
      2
    );
    expect(diff(base, json)).toEqual([]);
    expect(
      changes(diff(oas("servers:\n  - url: https://x.invalid\npaths: {}\n"), oas("paths: {}\n")))
    ).toEqual(["break:server-removed:/servers/0"]);
  });
});

describe("AsyncAPI details", () => {
  const a3 = (body: string): string => `asyncapi: 3.0.0\ninfo:\n  title: T\n  version: 1.0.0\n${body}`;
  const base = a3(
    [
      "servers:",
      "  prod: { host: broker.invalid, protocol: kafka }",
      "  test: { host: test.invalid, protocol: kafka }",
      "channels:",
      "  orders:",
      "    address: shop.orders",
      "    messages:",
      "      created: { payload: { schemaFormat: 'application/schema+json;version=draft-07', schema: { type: object, required: [id], properties: { id: { type: string } } } } }",
      "      cancelled: { payload: { type: object } }",
      "  audit:",
      "    address: shop.audit",
      "operations:",
      "  send: { action: send, channel: { $ref: '#/channels/orders' } }",
      "  log: { action: send, channel: { $ref: '#/channels/audit' } }",
      "",
    ].join("\n")
  );

  it("3.0: channel (by address), message, operation and server removals", () => {
    const head = base
      .replace("  test: { host: test.invalid, protocol: kafka }\n", "")
      .replace("      cancelled: { payload: { type: object } }\n", "")
      .replace("  audit:\n    address: shop.audit\n", "  renamed:\n    address: shop.audit\n")
      .replace("  log: { action: send, channel: { $ref: '#/channels/audit' } }\n", "");
    expect(changes(diff(base, head))).toEqual([
      "break:message-removed:/channels/orders/messages/cancelled",
      "break:operation-removed:/operations/log",
      "break:server-removed:/servers/test",
    ]);
    const moved = base.replace("address: shop.orders", "address: shop.orders.v2");
    expect(changes(diff(base, moved))).toContain("break:channel-removed:/channels/orders");
  });

  it("3.0 multi-format payload: required added and schemaFormat change", () => {
    const head = base.replace(
      "required: [id], properties: { id: { type: string } }",
      "required: [id, at], properties: { id: { type: string }, at: { type: string } }"
    );
    expect(changes(diff(base, head))).toEqual([
      "break:required-added:/channels/orders/messages/created/payload/schema/properties/at",
    ]);
    const fmt = base.replace("version=draft-07", "version=draft-2020-12");
    expect(changes(diff(base, fmt))).toEqual([
      "unclassified:changed:/channels/orders/messages/created/payload/schemaFormat",
    ]);
  });

  it("2.6: single message with a $ref, removal by ref name, publish removal, channel bindings", () => {
    const a2 = (channel: string): string =>
      `asyncapi: 2.6.0\ninfo: { title: T, version: '1' }\nchannels:\n  c:\n${channel}components:\n  messages:\n    M: { payload: { type: string } }\n    N: { payload: { type: string } }\n`;
    const base26 = a2(
      "    publish:\n      message: { $ref: '#/components/messages/M' }\n    subscribe:\n      message: { payload: { type: object } }\n"
    );
    expect(
      changes(
        diff(
          base26,
          a2(
            "    publish:\n      message: { $ref: '#/components/messages/N' }\n    subscribe:\n      message: { payload: { type: object } }\n"
          )
        )
      )
    ).toEqual(["break:message-removed:/channels/c/publish/message"]);
    expect(
      changes(
        diff(
          base26,
          a2("    subscribe:\n      message: { payload: { type: object } }\n    bindings: { kafka: {} }\n")
        )
      )
    ).toEqual(["unclassified:added:/channels/c/bindings", "break:operation-removed:/channels/c/publish"]);
    expect(changes(diff(base26, base26.replace("asyncapi: 2.6.0", "asyncapi: 3.0.0")))).toEqual([
      "unknown:format-changed:",
    ]);
  });
});

describe("integration", () => {
  it("adversarial contract: secret-like enum values are redacted, Markdown-breaking names escaped, URLs never shown", async () => {
    const token = `ghp_${"x".repeat(36)}`; // fake, generated at test time
    const evil = "a`](https://evil.invalid) <b>@admin</b>";
    const spec = (values: string[], withPath: boolean): string =>
      oas(
        [
          "servers:",
          "  - url: https://user:pass@api.example.invalid/v1",
          "paths:",
          ...(withPath ? [`  "/${evil}":`, "    get:", "      responses: {}"] : []),
          "  /a:",
          "    post:",
          "      parameters:",
          "        - name: mode",
          "          in: query",
          `          schema: { type: string, enum: [${values.map((v) => JSON.stringify(v)).join(", ")}] }`,
          "      responses: {}",
          "",
        ].join("\n")
      );
    const repo = Repo.create({
      "src/index.ts": "export {};\n",
      "openapi.yaml": spec(["safe", token], true),
    }).branch("f");
    repo.write({
      "openapi.yaml": spec(["safe"], false).replace(
        "  - url: https://user:pass@api.example.invalid/v1\n",
        ""
      ),
    });
    repo.commit("change");
    const json = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    const text = JSON.stringify(json);
    expect(text).not.toContain(token);
    expect(text).not.toContain("user:pass");
    expect(text).toContain("enum value removed: [REDACTED]");
    const md = await cli(["analyze", "--quiet", "--base", "main", "--head", "HEAD"], repo.dir);
    expect(md.stdout).not.toContain(token);
    expect(md.stdout).not.toContain("<b>@admin</b>");
    // Prose is escaped; the pointer is an inert code span.
    expect(md.stdout).toContain("path removed: /a\\`\\](https://evil.invalid) \\<b\\>");
    expect(md.stdout).toContain("``/paths/~1a`](https:~1~1evil.invalid) <b>@admin<~1b>``");
  });

  it("sniffs unnamed contracts, keeps api-contract-changed for others, handles deleted and renamed files", async () => {
    const spec = oas("paths:\n  /a:\n    get:\n      responses: {}\n  /b:\n    get:\n      responses: {}\n");
    const repo = Repo.create({
      "src/index.ts": "export {};\n",
      "api/spec.yaml": spec,
      "api/old-openapi.json": JSON.stringify({ openapi: "3.0.3", paths: {} }),
      "api/move-openapi.yaml": spec,
      "api/openapi-generator.json": '{ "generatorName": "ts" }\n',
      "schema.graphql": "type Q { a: Int }\n",
    }).branch("feature");
    repo.write({
      "api/spec.yaml": spec.replace("  /b:\n    get:\n      responses: {}\n", ""),
      "api/openapi-generator.json": '{ "generatorName": "go" }\n',
      "schema.graphql": "type Q { b: Int }\n",
    });
    repo.remove("api/old-openapi.json");
    repo.git("mv", "api/move-openapi.yaml", "api/moved-openapi.yaml");
    repo.write({ "api/moved-openapi.yaml": spec.replace("  /a:\n    get:\n      responses: {}\n", "") });
    repo.commit("change");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    const breaking = report.findings.filter((f) => f.rule_id === "contract-breaking-change");
    expect(breaking.map((f) => f.evidence[0]?.path).sort()).toEqual([
      "api/move-openapi.yaml",
      "api/old-openapi.json",
      "api/spec.yaml",
    ]);
    const moved = breaking.find((f) => f.evidence[0]?.path === "api/move-openapi.yaml");
    expect(moved?.evidence[0]).toMatchObject({
      side: "base",
      contract: { change: "path-removed", pointer: "/paths/~1a" },
    });
    const pathRule = report.findings.filter((f) => f.rule_id === "api-contract-changed");
    expect(pathRule.flatMap((f) => f.evidence.map((e) => e.path)).sort()).toEqual([
      "api/openapi-generator.json",
      "schema.graphql",
    ]);
  });

  it("reads contract files from the working tree in worktree mode", async () => {
    const spec = oas("paths:\n  /a:\n    get:\n      responses: {}\n");
    const repo = Repo.create({ "src/index.ts": "export {};\n", "openapi.yaml": spec });
    repo.write({ "openapi.yaml": oas("paths: {}\n") });
    const report = await analyzeJson(repo.dir, ["--base", "main"]);
    const f = report.findings.find((x) => x.rule_id === "contract-breaking-change");
    expect(f?.evidence[0]).toMatchObject({
      commit: expect.any(String),
      contract: { change: "path-removed" },
    });
    repo.write({ "untracked-openapi.yaml": spec });
    const again = await analyzeJson(repo.dir, ["--base", "main"]);
    expect(again.findings.filter((x) => x.rule_id.startsWith("contract-")).length).toBe(1);
  });
});
