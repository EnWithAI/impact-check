// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Parser-based export analysis. Uses the TypeScript *parser* only (no program, no type checker, no module loading),
// so it never reads other files and never executes anything.
import ts from "typescript";
import type { LineRange } from "../types.js";

/** One named export of a module as seen by the parser. */
export interface ExportInfo {
  name: string;
  kind: string;
  line: number;
  typeOnly: boolean;
  /** Line ranges that make up the declaration's public signature (bodies and private members excluded). */
  signature: LineRange[];
}

/** All statically visible exports of one module, plus markers that make the set incomplete. */
export interface ExportSet {
  exports: Map<string, ExportInfo>;
  /** Specifiers of `export * from "..."`: the export set is open and cannot be fully known statically. */
  starReexports: string[];
  /** CommonJS `module.exports` / `exports.x` / `export =` present (shapes not analyzed). */
  commonJs: boolean;
  parseErrors: number;
}

/** One name imported (or re-exported) from a module specifier. */
export interface ImportedName {
  specifier: string;
  /** Imported (not local) name; "default" for default imports; "*" for namespace imports. */
  name: string;
  line: number;
  typeOnly: boolean;
}

/** TypeScript script kind for a path (JSX/TSX parsing depends on it). */
function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Parses text into a syntax tree (parser only; no program, no file system access). */
function parse(text: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
}

/** 1-based line of a character position. */
function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Line range covering two character positions. */
function range(sf: ts.SourceFile, from: number, to: number): LineRange {
  return { start: lineOf(sf, from), end: lineOf(sf, to) };
}

/** Modifiers of a node (export, default, private, …), if it can have any. */
function modifiers(node: ts.Node): readonly ts.ModifierLike[] {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}

/** True when the node carries the given modifier keyword. */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiers(node).some((m) => m.kind === kind);
}

/** Header of a function-like node: from its start up to the line where its body begins. */
function headerRange(sf: ts.SourceFile, node: ts.Node, body: ts.Node | undefined): LineRange {
  return body ? range(sf, node.getStart(sf), body.getStart(sf)) : range(sf, node.getStart(sf), node.getEnd());
}

/** Signature ranges of a class: its header plus the headers of all non-private members. */
function classSignature(sf: ts.SourceFile, node: ts.ClassDeclaration): LineRange[] {
  const ranges: LineRange[] = [range(sf, node.getStart(sf), node.members.pos)];
  for (const member of node.members) {
    if (
      hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
      (member.name && ts.isPrivateIdentifier(member.name))
    )
      continue;
    const body = (member as { body?: ts.Node }).body;
    ranges.push(headerRange(sf, member, body));
  }
  return ranges;
}

/** Names bound by a variable declaration, including destructuring patterns. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));
}

/** True for `module.exports = …`, `module.exports.x = …` and `exports.x = …` statements. */
function isCommonJsExport(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
  if (statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const left = statement.expression.left.getText();
  return left === "module.exports" || left.startsWith("module.exports.") || left.startsWith("exports.");
}

/**
 * Parses a module and returns its named exports with lines and signature ranges. Tolerates syntax errors
 * (the count is reported in `parseErrors`).
 */
export function extractExports(text: string, path: string): ExportSet {
  const sf = parse(text, path);
  const set: ExportSet = {
    exports: new Map(),
    starReexports: [],
    commonJs: false,
    parseErrors: (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ?? 0,
  };
  const add = (info: ExportInfo): void => {
    if (!set.exports.has(info.name)) set.exports.set(info.name, info);
  };
  const whole = (node: ts.Node): LineRange[] => [range(sf, node.getStart(sf), node.getEnd())];

  for (const st of sf.statements) {
    if (isCommonJsExport(st)) {
      set.commonJs = true;
      continue;
    }
    if (ts.isExportAssignment(st)) {
      if (st.isExportEquals) set.commonJs = true;
      else
        add({
          name: "default",
          kind: "default",
          line: lineOf(sf, st.getStart(sf)),
          typeOnly: false,
          signature: whole(st),
        });
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const specifier =
        st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      const line = lineOf(sf, st.getStart(sf));
      if (!st.exportClause) {
        if (specifier !== null) set.starReexports.push(specifier);
        continue;
      }
      if (ts.isNamespaceExport(st.exportClause)) {
        add({
          name: st.exportClause.name.text,
          kind: "re-export",
          line,
          typeOnly: st.isTypeOnly,
          signature: whole(st),
        });
        continue;
      }
      for (const el of st.exportClause.elements) {
        add({
          name: el.name.text,
          kind: specifier === null ? "export-list" : "re-export",
          line: lineOf(sf, el.getStart(sf)),
          typeOnly: st.isTypeOnly || el.isTypeOnly,
          signature: whole(st),
        });
      }
      continue;
    }
    if (!hasModifier(st, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
    const line = lineOf(sf, st.getStart(sf));
    if (ts.isFunctionDeclaration(st)) {
      add({
        name: isDefault ? "default" : (st.name?.text ?? "default"),
        kind: "function",
        line,
        typeOnly: false,
        signature: [headerRange(sf, st, st.body)],
      });
    } else if (ts.isClassDeclaration(st)) {
      add({
        name: isDefault ? "default" : (st.name?.text ?? "default"),
        kind: "class",
        line,
        typeOnly: false,
        signature: classSignature(sf, st),
      });
    } else if (ts.isVariableStatement(st)) {
      const flags = st.declarationList.flags;
      const kind = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
      for (const decl of st.declarationList.declarations) {
        const init = decl.initializer;
        const fnBody =
          init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)
            ? init.body
            : undefined;
        const signature = [
          fnBody
            ? range(sf, decl.getStart(sf), fnBody.getStart(sf))
            : range(sf, decl.getStart(sf), decl.getEnd()),
        ];
        for (const name of bindingNames(decl.name)) {
          add({ name, kind, line: lineOf(sf, decl.getStart(sf)), typeOnly: false, signature });
        }
      }
    } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) {
      add({
        name: st.name.text,
        kind: ts.isInterfaceDeclaration(st) ? "interface" : "type",
        line,
        typeOnly: true,
        signature: whole(st),
      });
    } else if (ts.isEnumDeclaration(st)) {
      add({ name: st.name.text, kind: "enum", line, typeOnly: false, signature: whole(st) });
    } else if (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name)) {
      add({ name: st.name.text, kind: "namespace", line, typeOnly: false, signature: whole(st) });
    }
  }
  return set;
}

/**
 * Lists the names a module imports or re-exports by name, per specifier. Namespace imports are reported as
 * name "*" and side-effect imports are omitted.
 */
export function importedNames(text: string, path: string): ImportedName[] {
  const sf = parse(text, path);
  const out: ImportedName[] = [];
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause) {
      const specifier = st.moduleSpecifier.text;
      const clause = st.importClause;
      const clauseTypeOnly = clause.isTypeOnly;
      const line = lineOf(sf, st.getStart(sf));
      if (clause.name) out.push({ specifier, name: "default", line, typeOnly: clauseTypeOnly });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        out.push({ specifier, name: "*", line, typeOnly: clauseTypeOnly });
      else if (bindings) {
        for (const el of bindings.elements) {
          out.push({
            specifier,
            name: (el.propertyName ?? el.name).text,
            line,
            typeOnly: clauseTypeOnly || el.isTypeOnly,
          });
        }
      }
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      const line = lineOf(sf, st.getStart(sf));
      for (const el of st.exportClause.elements) {
        out.push({
          specifier: st.moduleSpecifier.text,
          name: (el.propertyName ?? el.name).text,
          line,
          typeOnly: st.isTypeOnly || el.isTypeOnly,
        });
      }
    }
  }
  return out;
}

/** True when any line in `lines` falls inside any of the ranges. Returns the first such line. */
export function firstLineIn(ranges: readonly LineRange[], lines: readonly number[]): number | null {
  for (const line of [...lines].sort((a, b) => a - b)) {
    if (ranges.some((r) => line >= r.start && line <= r.end)) return line;
  }
  return null;
}
