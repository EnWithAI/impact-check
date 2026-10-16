// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Structural base→head diff of OpenAPI 3.0/3.1 and AsyncAPI 2.6/3.0 documents (docs/CONTRACT_DIFF.md). Parses with
 * the `yaml` package (YAML 1.2 core schema; JSON is parsed the same way, which gives line numbers for both), resolves
 * local `$ref`s only, and classifies every difference as a break, an unclassified change or an unknown. Nothing in a
 * document is evaluated, fetched or resolved outside the document itself. Pure: no I/O.
 */
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import { compareStrings } from "../analysis/limitations.js";
import { MAX_FILE_BYTES } from "../snapshot/snapshot.js";
const COSMETIC = new Set([
    "description",
    "summary",
    "title",
    "example",
    "examples",
    "externalDocs",
    "$comment",
    "tags",
]);
const isCosmetic = (key) => COSMETIC.has(key) || key.startsWith("x-");
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** RFC 6901 escaping of one reference token. */
export const escapeToken = (token) => token.replace(/~/g, "~0").replace(/\//g, "~1");
const child = (pointer, token) => `${pointer}/${escapeToken(String(token))}`;
// ---------------------------------------------------------------------------------------------------------------
// Parsing
/** Records the line of every mapping key and sequence item, keyed by JSON pointer. */
function collectLines(node, pointer, lc, out) {
    if (isMap(node)) {
        for (const pair of node.items) {
            const key = pair.key;
            if (!isScalar(key) || key.range === undefined || key.range === null)
                continue;
            const p = child(pointer, String(key.value));
            if (!out.has(p))
                out.set(p, lc.linePos(key.range[0]).line);
            collectLines(pair.value, p, lc, out);
        }
    }
    else if (isSeq(node)) {
        node.items.forEach((item, i) => {
            const n = item;
            const p = child(pointer, i);
            if (n?.range)
                out.set(p, lc.linePos(n.range[0]).line);
            collectLines(n, p, lc, out);
        });
    }
}
const OPENAPI_VERSION = /^3\.([01])\.\d+$/;
const ASYNCAPI_VERSION = /^(2\.6|3\.0)\.\d+$/;
/** Parses one side and classifies it (docs/CONTRACT_DIFF.md §1). Never throws. */
export function parseSide(text) {
    if (text === undefined)
        return { state: "absent" };
    if (text === null)
        return { state: "unparseable", reason: "unreadable or larger than 1 MiB" };
    if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES)
        return { state: "unparseable", reason: "larger than 1 MiB" };
    const lc = new LineCounter();
    let root;
    let contents;
    try {
        const doc = parseDocument(text, {
            lineCounter: lc,
            schema: "core",
            version: "1.2",
            uniqueKeys: true,
            prettyErrors: false,
        });
        if (doc.errors.length > 0)
            return { state: "unparseable", reason: "YAML/JSON syntax error" };
        root = doc.toJS({ maxAliasCount: 100 });
        contents = doc.contents;
    }
    catch {
        return { state: "unparseable", reason: "YAML/JSON syntax error or too many aliases" };
    }
    if (!isObj(root))
        return { state: "unparseable", reason: "top level is not a mapping" };
    const lines = new Map();
    collectLines(contents, "", lc, lines);
    const rootLine = contents?.range ? lc.linePos(contents.range[0]).line : 1;
    const versionLine = (key) => lines.get(`/${key}`) ?? rootLine;
    if (own(root, "openapi")) {
        const v = String(root["openapi"]);
        const m = typeof root["openapi"] === "string" ? OPENAPI_VERSION.exec(v) : null;
        if (!m)
            return { state: "unsupported", format: "openapi", version: v, line: versionLine("openapi") };
        return { state: "contract", format: "openapi", minor: `3.${m[1]}`, root, lines, rootLine };
    }
    if (own(root, "asyncapi")) {
        const v = String(root["asyncapi"]);
        const m = typeof root["asyncapi"] === "string" ? ASYNCAPI_VERSION.exec(v) : null;
        if (!m)
            return { state: "unsupported", format: "asyncapi", version: v, line: versionLine("asyncapi") };
        return { state: "contract", format: "asyncapi", minor: m[1], root, lines, rootLine };
    }
    if (own(root, "swagger"))
        return {
            state: "unsupported",
            format: "swagger",
            version: String(root["swagger"]),
            line: versionLine("swagger"),
        };
    return { state: "not-contract" };
}
/** True if the text declares an OpenAPI/AsyncAPI document at the top level (cheap sniff, no parse). */
export function looksLikeContract(path, text) {
    if (text === null)
        return false;
    if (/\.ya?ml$/i.test(path))
        return /^(openapi|asyncapi)\s*:/m.test(text);
    if (/\.json$/i.test(path))
        return /^\s*\{\s*"(openapi|asyncapi)"\s*:/.test(text);
    return false;
}
// ---------------------------------------------------------------------------------------------------------------
// Diff state
/** Line of a pointer, falling back to the deepest recorded ancestor (aliases have no own lines). */
function lineOf(doc, pointer) {
    let p = pointer;
    for (;;) {
        const line = doc.lines.get(p);
        if (line !== undefined)
            return line;
        if (p === "")
            return doc.rootLine;
        p = p.slice(0, p.lastIndexOf("/"));
    }
}
/** Decodes a local `$ref` ("#/a/b") to a value and pointer, or null if it does not resolve. */
function resolveLocal(root, ref) {
    if (!ref.startsWith("#"))
        return null;
    let fragment = ref.slice(1);
    try {
        fragment = decodeURIComponent(fragment);
    }
    catch {
        return null;
    }
    if (fragment !== "" && !fragment.startsWith("/"))
        return null;
    let value = root;
    const tokens = fragment === "" ? [] : fragment.slice(1).split("/");
    for (const raw of tokens) {
        const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        if (Array.isArray(value) && /^\d+$/.test(token))
            value = value[Number(token)];
        else if (isObj(value) && own(value, token))
            value = value[token];
        else
            return null;
    }
    return { value, pointer: tokens.length === 0 ? "" : `/${tokens.join("/")}` };
}
class Diff {
    base;
    head;
    items = new Map();
    visited = new Set();
    constructor(base, head) {
        this.base = base;
        this.head = head;
    }
    /** Adds an item once per (kind, change, pointer); the first context wins. */
    add(kind, change, side, basePointer, headPointer, detail) {
        const pointer = (side === "base" ? basePointer : headPointer);
        const key = `${kind}\0${change}\0${pointer}`;
        if (this.items.has(key))
            return;
        this.items.set(key, {
            kind,
            change,
            pointer,
            side,
            baseLine: basePointer === null ? null : lineOf(this.base, basePointer),
            headLine: headPointer === null ? null : lineOf(this.head, headPointer),
            detail,
        });
    }
    /** Something present in base only (pointer of the element in base, of its matched parent in head). */
    removed(kind, change, bp, hParent, detail) {
        this.add(kind, change, "base", bp, hParent, detail);
    }
    /** Something present in head only. */
    added(kind, change, bParent, hp, detail) {
        this.add(kind, change, "head", bParent, hp, detail);
    }
    /** Something that differs between matched elements. */
    changed(kind, change, bp, hp, detail) {
        this.add(kind, change, "head", bp, hp, detail);
    }
    /** True the first time a (base, head, direction) location triple is compared (cycle guard). */
    firstVisit(key) {
        if (this.visited.has(key))
            return false;
        this.visited.add(key);
        return true;
    }
    result() {
        return [...this.items.values()].sort((a, b) => compareStrings(a.pointer, b.pointer) || compareStrings(a.change, b.change));
    }
}
/** Follows local `$ref` chains; returns null for unresolved references (reported separately). */
function deref(doc, at) {
    let current = at;
    for (let hops = 0; hops < 32; hops++) {
        const v = current.value;
        if (!isObj(v) || typeof v["$ref"] !== "string")
            return current;
        const target = resolveLocal(doc.root, v["$ref"]);
        if (!target)
            return null;
        current = target;
    }
    return null;
}
/**
 * Canonical JSON of a value with cosmetic keys removed. With `inline`, local refs are replaced by their targets
 * (cycles cut), so a whole-keyword comparison sees changes behind references; without it refs compare as strings.
 */
function canonical(doc, value, inline = true, stack = []) {
    if (Array.isArray(value))
        return `[${value.map((v) => canonical(doc, v, inline, stack)).join(",")}]`;
    if (isObj(value)) {
        const ref = value["$ref"];
        if (typeof ref === "string" && (!inline || ref.startsWith("#"))) {
            if (!inline)
                return `{"$ref":${JSON.stringify(ref)}}`;
            const target = resolveLocal(doc.root, ref);
            if (target && !stack.includes(target.pointer) && stack.length < 64)
                return canonical(doc, target.value, inline, [...stack, target.pointer]);
            return `{"$ref":${JSON.stringify(ref)}}`;
        }
        const keys = Object.keys(value)
            .filter((k) => !isCosmetic(k))
            .sort(compareStrings);
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(doc, value[k], inline, stack)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
/**
 * Compares two values in an area the diff does not model: every semantic difference is unclassified. Mappings are
 * descended key by key; anything else is compared as a whole.
 */
function generic(d, b, h, ctx, skip = []) {
    if (isObj(b.value) && isObj(h.value) && !own(b.value, "$ref") && !own(h.value, "$ref")) {
        const bv = b.value;
        const hv = h.value;
        const keys = [...new Set([...Object.keys(bv), ...Object.keys(hv)])]
            .filter((k) => !isCosmetic(k) && !skip.includes(k))
            .sort(compareStrings);
        for (const k of keys) {
            const bp = child(b.pointer, k);
            const hp = child(h.pointer, k);
            if (!own(hv, k))
                d.removed("unclassified", "removed", bp, h.pointer, `removed: ${k}${ctx}`);
            else if (!own(bv, k))
                d.added("unclassified", "added", b.pointer, hp, `added: ${k}${ctx}`);
            else
                generic(d, { value: bv[k], pointer: bp }, { value: hv[k], pointer: hp }, ctx);
        }
        return;
    }
    if (canonical(d.base, b.value, false) !== canonical(d.head, h.value, false)) {
        const key = h.pointer
            .slice(h.pointer.lastIndexOf("/") + 1)
            .replace(/~1/g, "/")
            .replace(/~0/g, "~");
        d.changed("unclassified", "changed", b.pointer, h.pointer, `changed: ${key || "document"}${ctx}`);
    }
}
// ---------------------------------------------------------------------------------------------------------------
// JSON Schema comparison (docs/CONTRACT_DIFF.md §2)
/** Expanded type set (`number` includes `integer`, `nullable` adds `null`); null = any type. */
function typeSet(schema, minor) {
    const raw = schema["type"];
    const listed = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.map(String) : null;
    const nullable = schema["nullable"] === true && minor === "3.0";
    if (listed === null)
        return null;
    const shown = [...new Set([...listed, ...(nullable ? ["null"] : [])])].sort(compareStrings);
    const set = new Set(shown);
    if (set.has("number"))
        set.add("integer");
    return { shown, set };
}
const contains = (outer, inner) => outer === null || (inner !== null && [...inner].every((t) => outer.has(t)));
const fmtTypes = (t) => t === null ? "[any]" : `[${t.shown.join(", ")}]`;
const fmtValue = (v) => (typeof v === "string" ? v : (JSON.stringify(v) ?? "null"));
/** Keywords compared individually; every other keyword (including oneOf/anyOf/allOf/not) is compared whole. */
const SCHEMA_MODELED = new Set(["type", "nullable", "enum", "required", "properties", "items", "$ref"]);
function compareSchema(d, bAt, hAt, dir, ctx) {
    const b = deref(d.base, bAt);
    const h = deref(d.head, hAt);
    if (!b || !h)
        return; // unresolved reference: reported as unknown
    if (!d.firstVisit(`${b.pointer}\0${h.pointer}\0${dir}`))
        return;
    if (!isObj(b.value) || !isObj(h.value)) {
        if (canonical(d.base, b.value) !== canonical(d.head, h.value))
            d.changed("unclassified", "changed", b.pointer, h.pointer, `changed: schema${ctx}`);
        return;
    }
    const bs = b.value;
    const hs = h.value;
    const bp = (k) => child(b.pointer, k);
    const hp = (k) => child(h.pointer, k);
    const noun = dir === "request" ? "request property" : dir === "response" ? "response property" : "payload property";
    // type
    const bt = typeSet(bs, d.base.minor);
    const ht = typeSet(hs, d.head.minor);
    const narrowed = !contains(ht?.set ?? null, bt?.set ?? null);
    const widened = !contains(bt?.set ?? null, ht?.set ?? null);
    const typeKey = (s) => (own(s, "type") ? "type" : own(s, "nullable") ? "nullable" : "");
    const tbp = typeKey(bs) ? bp(typeKey(bs)) : b.pointer;
    const thp = typeKey(hs) ? hp(typeKey(hs)) : h.pointer;
    if (narrowed && dir !== "response")
        d.changed("break", "type-narrowed", tbp, thp, `type narrowed: ${fmtTypes(bt)} → ${fmtTypes(ht)}${ctx}`);
    else if (widened && dir !== "request")
        d.changed("unclassified", "type-widened", tbp, thp, `type widened: ${fmtTypes(bt)} → ${fmtTypes(ht)}${ctx}`);
    // enum
    const be = Array.isArray(bs["enum"]) ? bs["enum"] : null;
    const he = Array.isArray(hs["enum"]) ? hs["enum"] : null;
    if (be && he) {
        const hKeys = new Set(he.map((v) => canonical(d.head, v)));
        const bKeys = new Set(be.map((v) => canonical(d.base, v)));
        if (dir !== "response") {
            be.forEach((v, i) => {
                if (!hKeys.has(canonical(d.base, v)))
                    d.removed("break", "enum-value-removed", child(bp("enum"), i), hp("enum"), `enum value removed: ${fmtValue(v)}${ctx}`);
            });
        }
        if (dir !== "request") {
            he.forEach((v, i) => {
                if (!bKeys.has(canonical(d.head, v)))
                    d.added("unclassified", "enum-value-added", bp("enum"), child(hp("enum"), i), `enum value added: ${fmtValue(v)}${ctx}`);
            });
        }
    }
    else if (be)
        d.removed("unclassified", "removed", bp("enum"), h.pointer, `removed: enum${ctx}`);
    else if (he)
        d.added("unclassified", "added", b.pointer, hp("enum"), `added: enum${ctx}`);
    // required
    const names = (s) => (Array.isArray(s["required"]) ? s["required"].map(String) : []);
    const breq = new Set(names(bs));
    const hreqList = names(hs);
    const hreq = new Set(hreqList);
    const bprops = isObj(bs["properties"]) ? bs["properties"] : null;
    const hprops = isObj(hs["properties"]) ? hs["properties"] : null;
    if (dir !== "response") {
        hreqList.forEach((name, i) => {
            if (breq.has(name))
                return;
            const inBase = bprops !== null && own(bprops, name);
            const headPointer = hprops !== null && own(hprops, name) ? child(hp("properties"), name) : child(hp("required"), i);
            const baseAnchor = inBase ? child(bp("properties"), name) : bprops ? bp("properties") : b.pointer;
            d.changed("break", "required-added", baseAnchor, headPointer, inBase ? `${noun} became required: ${name}${ctx}` : `required ${noun} added: ${name}${ctx}`);
        });
    }
    if (dir !== "request") {
        for (const name of [...breq].sort(compareStrings)) {
            if (hreq.has(name) || hprops === null || !own(hprops, name))
                continue;
            d.changed("unclassified", "required-removed", bprops && own(bprops, name) ? child(bp("properties"), name) : bp("required"), child(hp("properties"), name), `${noun} no longer required: ${name}${ctx}`);
        }
    }
    // properties
    if (bprops) {
        for (const name of Object.keys(bprops).sort(compareStrings)) {
            const bpp = child(bp("properties"), name);
            if (!hprops || !own(hprops, name)) {
                const anchor = hprops ? hp("properties") : h.pointer;
                if (dir === "request")
                    d.removed("unclassified", "property-removed", bpp, anchor, `${noun} removed: ${name}${ctx}`);
                else
                    d.removed("break", "response-property-removed", bpp, anchor, `${noun} removed: ${name}${ctx}`);
                continue;
            }
            compareSchema(d, { value: bprops[name], pointer: bpp }, { value: hprops[name], pointer: child(hp("properties"), name) }, dir, ctx);
        }
    }
    // items
    if (own(bs, "items") && own(hs, "items"))
        compareSchema(d, { value: bs["items"], pointer: bp("items") }, { value: hs["items"], pointer: hp("items") }, dir, ctx);
    else if (own(bs, "items"))
        d.removed("unclassified", "removed", bp("items"), h.pointer, `removed: items${ctx}`);
    else if (own(hs, "items"))
        d.added("unclassified", "added", b.pointer, hp("items"), `added: items${ctx}`);
    // composition and every other keyword: compared as a whole
    for (const k of [...new Set([...Object.keys(bs), ...Object.keys(hs)])].sort(compareStrings)) {
        if (SCHEMA_MODELED.has(k) || isCosmetic(k))
            continue;
        if (!own(hs, k))
            d.removed("unclassified", "removed", bp(k), h.pointer, `removed: ${k}${ctx}`);
        else if (!own(bs, k))
            d.added("unclassified", "added", b.pointer, hp(k), `added: ${k}${ctx}`);
        else if (canonical(d.base, bs[k]) !== canonical(d.head, hs[k]))
            d.changed("unclassified", "changed", bp(k), hp(k), `changed: ${k}${ctx}`);
    }
}
// ---------------------------------------------------------------------------------------------------------------
// Shared pieces
/** Compares a mapping of named things whose removal is a break (servers, security schemes, channels, ...). */
function namedMap(d, b, h, hFallback, change, label, each) {
    const bm = isObj(b.value) ? b.value : {};
    const hm = isObj(h.value) ? h.value : null;
    for (const name of Object.keys(bm).sort(compareStrings)) {
        const bp = child(b.pointer, name);
        if (!hm || !own(hm, name)) {
            d.removed("break", change, bp, hm ? h.pointer : hFallback, `${label}: ${name}`);
            continue;
        }
        each({ value: bm[name], pointer: bp }, { value: hm[name], pointer: child(h.pointer, name) }, name);
    }
}
/** Value and pointer of `obj[key]`. */
const at = (parent, key) => ({
    value: isObj(parent.value) ? parent.value[key] : undefined,
    pointer: child(parent.pointer, key),
});
/** The pointer of `parent[key]` if it exists, else the parent's pointer (deepest existing ancestor). */
const anchor = (parent, key) => isObj(parent.value) && own(parent.value, key) ? child(parent.pointer, key) : parent.pointer;
function securitySchemes(d, b, h) {
    const bc = at(b, "components");
    const hc = at(h, "components");
    const hs = at(hc, "securitySchemes");
    namedMap(d, at(bc, "securitySchemes"), hs, anchor(h, "components"), "security-scheme-removed", "security scheme removed", (x, y, name) => generic(d, x, y, ` (security scheme ${name})`));
}
function specVersion(d, key) {
    if (d.base.minor !== d.head.minor)
        d.changed("unclassified", "changed", `/${key}`, `/${key}`, `changed: ${key} ${d.base.minor} → ${d.head.minor}`);
}
/** Path template with parameter names removed, for matching `/pets/{id}` with `/pets/{petId}`. */
const templateKey = (path) => path.replace(/\{[^}]*\}/g, "{}");
/** Effective parameters of an operation: path-level ones overridden by operation-level ones. */
function params(doc, path, item, op) {
    const names = [...path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
    const out = new Map();
    for (const owner of [item, op]) {
        const list = at(owner, "parameters");
        if (!Array.isArray(list.value))
            continue;
        list.value.forEach((raw, i) => {
            const listed = child(list.pointer, i);
            const resolved = deref(doc, { value: raw, pointer: listed });
            if (!resolved || !isObj(resolved.value))
                return;
            const p = resolved.value;
            const where = String(p["in"]);
            const name = String(p["name"]);
            const position = names.indexOf(name);
            const id = where === "path" && position >= 0 ? `path#${position}` : `${where}:${name}`;
            out.set(id, {
                id,
                label: `${where} ${name}`,
                listed,
                resolved,
                required: where === "path" || p["required"] === true,
            });
        });
    }
    return out;
}
function compareOperation(d, bPath, hPath, method, bItem, hItem) {
    const bOp = at(bItem, method);
    const hOp = at(hItem, method);
    const ctx = ` (${method.toUpperCase()} ${hPath})`;
    const bParams = params(d.base, bPath, bItem, bOp);
    const hParams = params(d.head, hPath, hItem, hOp);
    const bAnchor = isObj(bOp.value) && own(bOp.value, "parameters") ? child(bOp.pointer, "parameters") : bOp.pointer;
    const hAnchor = isObj(hOp.value) && own(hOp.value, "parameters") ? child(hOp.pointer, "parameters") : hOp.pointer;
    for (const [id, hp] of hParams) {
        const bpar = bParams.get(id);
        if (!bpar) {
            if (hp.required)
                d.added("break", "required-added", bAnchor, hp.listed, `required parameter added: ${hp.label}${ctx}`);
            continue;
        }
        if (hp.required && !bpar.required)
            d.changed("break", "required-added", bpar.listed, hp.listed, `parameter became required: ${hp.label}${ctx}`);
        const label = ` (${hp.label}, ${method.toUpperCase()} ${hPath})`;
        compareSchema(d, at(bpar.resolved, "schema"), at(hp.resolved, "schema"), "request", label);
        generic(d, bpar.resolved, hp.resolved, label, ["name", "in", "required", "schema"]);
    }
    for (const [id, bpar] of bParams) {
        if (!hParams.has(id))
            d.removed("unclassified", "parameter-removed", bpar.listed, hAnchor, `parameter removed: ${bpar.label}${ctx}`);
    }
    // request body
    const bBodyAt = at(bOp, "requestBody");
    const hBodyAt = at(hOp, "requestBody");
    const bBody = bBodyAt.value === undefined ? null : deref(d.base, bBodyAt);
    const hBody = hBodyAt.value === undefined ? null : deref(d.head, hBodyAt);
    const required = (x) => isObj(x?.value) && x.value["required"] === true;
    if (bBodyAt.value === undefined && hBody && required(hBody))
        d.added("break", "required-added", bOp.pointer, hBodyAt.pointer, `request body became required${ctx}`);
    else if (bBodyAt.value !== undefined && hBodyAt.value === undefined)
        d.removed("unclassified", "removed", bBodyAt.pointer, hOp.pointer, `request body removed${ctx}`);
    else if (bBody && hBody) {
        if (required(hBody) && !required(bBody))
            d.changed("break", "required-added", bBodyAt.pointer, hBodyAt.pointer, `request body became required${ctx}`);
        content(d, bBody, hBody, "request", ctx);
        generic(d, bBody, hBody, ctx, ["content", "required"]);
    }
    // responses
    const bResp = at(bOp, "responses");
    const hResp = at(hOp, "responses");
    const bm = isObj(bResp.value) ? bResp.value : {};
    const hm = isObj(hResp.value) ? hResp.value : null;
    for (const status of Object.keys(bm).sort(compareStrings)) {
        if (isCosmetic(status))
            continue;
        const bsp = child(bResp.pointer, status);
        if (!hm || !own(hm, status)) {
            d.removed("break", "response-status-removed", bsp, hm ? hResp.pointer : hOp.pointer, `response status removed: ${method.toUpperCase()} ${hPath} ${status}`);
            continue;
        }
        const b = deref(d.base, { value: bm[status], pointer: bsp });
        const h = deref(d.head, { value: hm[status], pointer: child(hResp.pointer, status) });
        if (!b || !h)
            continue;
        const rctx = ` (${method.toUpperCase()} ${hPath} ${status})`;
        content(d, b, h, "response", rctx);
        generic(d, b, h, rctx, ["content"]);
    }
    generic(d, bOp, hOp, ctx, ["parameters", "requestBody", "responses"]);
}
/** Media types of a request body or response; schemas compared per common media type. */
function content(d, b, h, dir, ctx) {
    const bc = at(b, "content");
    const hc = at(h, "content");
    const bm = isObj(bc.value) ? bc.value : {};
    const hm = isObj(hc.value) ? hc.value : {};
    for (const mt of [...new Set([...Object.keys(bm), ...Object.keys(hm)])].sort(compareStrings)) {
        const bp = child(bc.pointer, mt);
        const hp = child(hc.pointer, mt);
        if (!own(hm, mt))
            d.removed("unclassified", "media-type-removed", bp, anchor(h, "content"), `media type removed: ${mt}${ctx}`);
        else if (!own(bm, mt)) {
            if (dir !== "request")
                d.added("unclassified", "media-type-added", anchor(b, "content"), hp, `media type added: ${mt}${ctx}`);
        }
        else {
            const bAt = { value: bm[mt], pointer: bp };
            const hAt = { value: hm[mt], pointer: hp };
            compareSchema(d, at(bAt, "schema"), at(hAt, "schema"), dir, ctx);
            generic(d, bAt, hAt, ctx, ["schema"]);
        }
    }
}
function diffOpenApi(d) {
    const b = { value: d.base.root, pointer: "" };
    const h = { value: d.head.root, pointer: "" };
    specVersion(d, "openapi");
    // servers (top level), identified by URL without trailing slash
    const bServers = at(b, "servers");
    const hServers = at(h, "servers");
    const url = (s) => isObj(s) && typeof s["url"] === "string" ? s["url"].replace(/\/+$/, "") : "";
    const hList = Array.isArray(hServers.value) ? hServers.value : [];
    if (Array.isArray(bServers.value)) {
        bServers.value.forEach((server, i) => {
            const j = hList.findIndex((x) => url(x) === url(server));
            const bp = child(bServers.pointer, i);
            if (j < 0)
                d.removed("break", "server-removed", bp, anchor(h, "servers"), `server removed: servers[${i}]`);
            else
                generic(d, { value: server, pointer: bp }, { value: hList[j], pointer: child(hServers.pointer, j) }, ` (servers[${j}])`, ["url"]);
        });
    }
    securitySchemes(d, b, h);
    // paths
    const bPaths = at(b, "paths");
    const hPaths = at(h, "paths");
    const bm = isObj(bPaths.value) ? bPaths.value : {};
    const hm = isObj(hPaths.value) ? hPaths.value : {};
    const hByTemplate = new Map();
    for (const p of Object.keys(hm).sort(compareStrings))
        if (!hByTemplate.has(templateKey(p)))
            hByTemplate.set(templateKey(p), p);
    for (const bPath of Object.keys(bm).sort(compareStrings)) {
        if (isCosmetic(bPath))
            continue;
        const hPath = hByTemplate.get(templateKey(bPath));
        const bp = child(bPaths.pointer, bPath);
        if (hPath === undefined) {
            d.removed("break", "path-removed", bp, anchor(h, "paths"), `path removed: ${bPath}`);
            continue;
        }
        const bItem = deref(d.base, { value: bm[bPath], pointer: bp });
        const hItem = deref(d.head, { value: hm[hPath], pointer: child(hPaths.pointer, hPath) });
        if (!bItem || !hItem || !isObj(bItem.value) || !isObj(hItem.value))
            continue;
        for (const method of HTTP_METHODS) {
            if (!own(bItem.value, method))
                continue;
            if (!own(hItem.value, method)) {
                d.removed("break", "operation-removed", child(bItem.pointer, method), hItem.pointer, `operation removed: ${method.toUpperCase()} ${bPath}`);
                continue;
            }
            compareOperation(d, bPath, hPath, method, bItem, hItem);
        }
        generic(d, bItem, hItem, ` (path ${hPath})`, [...HTTP_METHODS, "parameters"]);
    }
    generic(d, b, h, "", ["openapi", "info", "servers", "paths", "components"]);
}
// ---------------------------------------------------------------------------------------------------------------
// AsyncAPI
/** Compares two messages: payload as a "both"-direction schema, everything else unclassified. */
function compareMessage(d, b, h, ctx) {
    const bPayload = at(b, "payload");
    const hPayload = at(h, "payload");
    // AsyncAPI 3.0 multi-format schema object: { schemaFormat, schema }
    const inner = (p) => isObj(p.value) && own(p.value, "schemaFormat") && own(p.value, "schema") ? at(p, "schema") : p;
    if (bPayload.value !== undefined && hPayload.value !== undefined) {
        compareSchema(d, inner(bPayload), inner(hPayload), "both", ctx);
        if (inner(bPayload) !== bPayload || inner(hPayload) !== hPayload)
            generic(d, bPayload, hPayload, ctx, ["schema"]);
    }
    else
        generic(d, bPayload, hPayload, ctx);
    generic(d, b, h, ctx, ["payload", "messageId", "name"]);
}
/** Messages of an AsyncAPI 2.6 operation, identified by messageId, name, `$ref` target or position. */
function messages26(doc, op) {
    const out = new Map();
    const msg = at(op, "message");
    const entries = isObj(msg.value) && Array.isArray(msg.value["oneOf"])
        ? msg.value["oneOf"].map((v, i) => ({
            value: v,
            pointer: child(child(msg.pointer, "oneOf"), i),
        }))
        : msg.value === undefined
            ? []
            : [msg];
    entries.forEach((entry, i) => {
        const resolved = deref(doc, entry);
        if (!resolved)
            return;
        const v = isObj(resolved.value) ? resolved.value : {};
        const ref = isObj(entry.value) && typeof entry.value["$ref"] === "string" ? entry.value["$ref"] : null;
        const id = typeof v["messageId"] === "string"
            ? v["messageId"]
            : typeof v["name"] === "string"
                ? v["name"]
                : ref
                    ? ref.slice(ref.lastIndexOf("/") + 1)
                    : `#${i}`;
        if (!out.has(id))
            out.set(id, { listed: entry.pointer, resolved });
    });
    return out;
}
function diffAsyncApi26(d, b, h) {
    namedMap(d, at(b, "channels"), at(h, "channels"), h.pointer, "channel-removed", "channel removed", (bc, hc, name) => {
        for (const op of ["publish", "subscribe"]) {
            if (!isObj(bc.value) || !own(bc.value, op))
                continue;
            if (!isObj(hc.value) || !own(hc.value, op)) {
                d.removed("break", "operation-removed", child(bc.pointer, op), hc.pointer, `operation removed: ${op} ${name}`);
                continue;
            }
            const bOp = at(bc, op);
            const hOp = at(hc, op);
            const bm = messages26(d.base, bOp);
            const hm = messages26(d.head, hOp);
            const hMsg = at(hOp, "message");
            const hAnchor = isObj(hMsg.value) && own(hMsg.value, "oneOf")
                ? child(hMsg.pointer, "oneOf")
                : anchor(hOp, "message");
            for (const [id, bmsg] of [...bm].sort(([x], [y]) => compareStrings(x, y))) {
                const hmsg = hm.get(id);
                if (!hmsg)
                    d.removed("break", "message-removed", bmsg.listed, hAnchor, `message removed: ${id} (${name} ${op})`);
                else
                    compareMessage(d, bmsg.resolved, hmsg.resolved, ` (${name} ${op} ${id})`);
            }
            generic(d, bOp, hOp, ` (${name} ${op})`, ["message"]);
        }
        generic(d, bc, hc, ` (channel ${name})`, ["publish", "subscribe"]);
    });
}
function diffAsyncApi30(d, b, h) {
    const bChannels = at(b, "channels");
    const hChannels = at(h, "channels");
    const identity = (key, ch) => isObj(ch) && typeof ch["address"] === "string" ? ch["address"] : key;
    const hm = isObj(hChannels.value) ? hChannels.value : {};
    const hByIdentity = new Map();
    for (const key of Object.keys(hm).sort(compareStrings)) {
        const resolved = deref(d.head, { value: hm[key], pointer: child(hChannels.pointer, key) });
        const id = identity(key, resolved?.value);
        if (!hByIdentity.has(id))
            hByIdentity.set(id, key);
    }
    const bm = isObj(bChannels.value) ? bChannels.value : {};
    for (const key of Object.keys(bm).sort(compareStrings)) {
        const bc = deref(d.base, { value: bm[key], pointer: child(bChannels.pointer, key) });
        if (!bc)
            continue;
        const id = identity(key, bc.value);
        const hKey = hByIdentity.get(id);
        if (hKey === undefined) {
            d.removed("break", "channel-removed", child(bChannels.pointer, key), anchor(h, "channels"), `channel removed: ${id}`);
            continue;
        }
        const hc = deref(d.head, { value: hm[hKey], pointer: child(hChannels.pointer, hKey) });
        if (!hc)
            continue;
        const bMsgs = at(bc, "messages");
        const hMsgs = at(hc, "messages");
        const hmm = isObj(hMsgs.value) ? hMsgs.value : null;
        const bmm = isObj(bMsgs.value) ? bMsgs.value : {};
        for (const msgKey of Object.keys(bmm).sort(compareStrings)) {
            const bp = child(bMsgs.pointer, msgKey);
            if (!hmm || !own(hmm, msgKey)) {
                d.removed("break", "message-removed", bp, anchor(hc, "messages"), `message removed: ${msgKey} (${id})`);
                continue;
            }
            const bmsg = deref(d.base, { value: bmm[msgKey], pointer: bp });
            const hmsg = deref(d.head, { value: hmm[msgKey], pointer: child(hMsgs.pointer, msgKey) });
            if (bmsg && hmsg)
                compareMessage(d, bmsg, hmsg, ` (${id} ${msgKey})`);
        }
        generic(d, bc, hc, ` (channel ${id})`, ["address", "messages"]);
    }
    namedMap(d, at(b, "operations"), at(h, "operations"), h.pointer, "operation-removed", "operation removed", (x, y, name) => generic(d, x, y, ` (operation ${name})`));
}
function diffAsyncApi(d) {
    const b = { value: d.base.root, pointer: "" };
    const h = { value: d.head.root, pointer: "" };
    specVersion(d, "asyncapi");
    namedMap(d, at(b, "servers"), at(h, "servers"), h.pointer, "server-removed", "server removed", (x, y, name) => generic(d, x, y, ` (server ${name})`));
    securitySchemes(d, b, h);
    if (d.base.minor === "2.6" && d.head.minor === "2.6")
        diffAsyncApi26(d, b, h);
    else if (d.base.minor === "3.0" && d.head.minor === "3.0")
        diffAsyncApi30(d, b, h);
    generic(d, b, h, "", ["asyncapi", "info", "servers", "channels", "operations", "components"]);
}
// ---------------------------------------------------------------------------------------------------------------
// Unresolved references and entry point
/** Pointers of `$ref` keys that are external or do not resolve (cosmetic areas skipped). */
function unresolvedRefs(doc) {
    const out = [];
    const walk = (value, pointer) => {
        if (Array.isArray(value))
            value.forEach((v, i) => walk(v, child(pointer, i)));
        else if (isObj(value)) {
            for (const key of Object.keys(value)) {
                if (isCosmetic(key))
                    continue;
                const v = value[key];
                if (key === "$ref" && typeof v === "string") {
                    if (resolveLocal(doc.root, v) === null)
                        out.push(child(pointer, key));
                }
                else
                    walk(v, child(pointer, key));
            }
        }
    };
    walk(doc.root, "");
    return out;
}
const UNRESOLVED = "unresolved $ref (external or missing target)";
function unknownSide(side, which) {
    const line = side.state === "unsupported" ? side.line : null;
    const base = which === "base" ? line : null;
    const head = which === "head" ? line : null;
    if (side.state === "unparseable")
        return {
            kind: "unknown",
            change: "unparseable",
            pointer: "",
            side: which,
            baseLine: null,
            headLine: null,
            detail: `${which} unparseable: ${side.reason}`,
        };
    if (side.state === "unsupported")
        return {
            kind: "unknown",
            change: "unsupported-version",
            pointer: `/${side.format}`,
            side: which,
            baseLine: base,
            headLine: head,
            detail: `${which} unsupported version: ${side.format} ${side.version}`,
        };
    return null;
}
/**
 * Compares two revisions of one file. `undefined` = the side does not exist (added/deleted file); `null` = exists
 * but could not be read.
 */
export function diffContract(baseText, headText) {
    const base = parseSide(baseText);
    const head = parseSide(headText);
    // A file is handled here if at least one side declares openapi/asyncapi/swagger; an unparseable side next to
    // such a side becomes unknown, while a file unparseable on every side keeps the path-based rule.
    const declares = (s) => s.state === "contract" || s.state === "unsupported";
    if (!declares(base) && !declares(head))
        return { contract: false };
    if (base.state === "absent")
        return { contract: true, items: [] };
    if (head.state === "absent") {
        if (base.state === "contract")
            return {
                contract: true,
                items: [
                    {
                        kind: "break",
                        change: "document-removed",
                        pointer: "",
                        side: "base",
                        baseLine: base.rootLine,
                        headLine: null,
                        detail: `document removed: ${base.format} ${base.minor}`,
                    },
                ],
            };
        const u = unknownSide(base, "base");
        return { contract: true, items: u ? [u] : [] };
    }
    const unknowns = [unknownSide(base, "base"), unknownSide(head, "head")].filter((x) => x !== null);
    const major = (s) => (s.state === "contract" ? `${s.format} ${s.minor.split(".")[0]}` : "");
    if (base.state !== "contract" || head.state !== "contract" || major(base) !== major(head)) {
        if (unknowns.length === 0)
            unknowns.push({
                kind: "unknown",
                change: "format-changed",
                pointer: "",
                side: "head",
                baseLine: null,
                headLine: null,
                detail: "document format changed between revisions",
            });
        return { contract: true, items: unknowns };
    }
    const d = new Diff(base, head);
    if (base.format === "openapi")
        diffOpenApi(d);
    else
        diffAsyncApi(d);
    const headRefs = unresolvedRefs(head);
    for (const p of headRefs)
        d.add("unknown", "unresolved-ref", "head", p, p, UNRESOLVED);
    for (const p of unresolvedRefs(base))
        if (!headRefs.includes(p))
            d.add("unknown", "unresolved-ref", "base", p, p, UNRESOLVED);
    return { contract: true, items: d.result() };
}
