import * as path from "path";
import * as ts from "typescript";
import { createHash } from "crypto";

/**
 * The duplicate-test-block detector (issue #4620). The rule, what the
 * fingerprint is and what it misses by construction: the guard's header,
 * `scripts/__tests__/duplicate-test-blocks.test.ts`. Pure: builtins and
 * `typescript` only, so a script can run it over any tree.
 */

const TEST_BLOCK_CALLEES = new Set(["it", "test"]);
/** `it.skip` / `it.todo` run nothing; `it.each(…)` is a table, one block. */
const EXCLUDED_MODIFIERS = new Set(["skip", "todo", "each", "for"]);

export interface TestBlock {
    file: string;
    line: number;
    name: string;
    fingerprint: string;
}
/** The node's tokens, trivia (comments, whitespace) dropped. */
function tokens(
    node: ts.Node,
    sf: ts.SourceFile,
    out: string[] = []
): string[] {
    const children = node.getChildren(sf);
    if (children.length === 0) {
        const text = node.getText(sf);
        if (text.length > 0) out.push(text);
        return out;
    }
    for (const child of children) tokens(child, sf, out);
    return out;
}

function hash(text: string): string {
    return createHash("sha1").update(text).digest("hex");
}

/** Names a binding pattern introduces. */
function boundNames(name: ts.BindingName, out: string[] = []): string[] {
    if (ts.isIdentifier(name)) out.push(name.text);
    else
        for (const el of name.elements)
            if (!ts.isOmittedExpression(el)) boundNames(el.name, out);
    return out;
}

/** Where a name is bound, and how to describe the binding. */
type Binding =
    | { kind: "import"; describe: string }
    | { kind: "decl"; node: ts.Node };

/** Does the statement declare `name`? Returns the binding when it does. */
function statementBinds(
    stmt: ts.Statement,
    name: string,
    file: string
): Binding | null {
    if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations)
            if (boundNames(d.name).includes(name))
                return { kind: "decl", node: stmt };
        return null;
    }
    if (
        (ts.isFunctionDeclaration(stmt) ||
            ts.isClassDeclaration(stmt) ||
            ts.isEnumDeclaration(stmt)) &&
        stmt.name?.text === name
    )
        return { kind: "decl", node: stmt };
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
        const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
        const from = spec.startsWith(".")
            ? path
                  .join(path.dirname(file), spec)
                  .replace(/\.(tsx?|jsx?)$/, "")
                  .replace(/\/index$/, "")
            : spec;
        const clause = stmt.importClause;
        if (clause.name?.text === name)
            return { kind: "import", describe: `default@${from}` };
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb) && nb.name.text === name)
            return { kind: "import", describe: `*@${from}` };
        if (nb && ts.isNamedImports(nb))
            for (const el of nb.elements)
                if (el.name.text === name)
                    return {
                        kind: "import",
                        describe: `${(el.propertyName ?? el.name).getText()}@${from}`,
                    };
    }
    return null;
}

/** Resolve `name` lexically from `from` outward; null = a global. */
function resolve(from: ts.Node, name: string, file: string): Binding | null {
    for (let a: ts.Node | undefined = from.parent; a; a = a.parent) {
        if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a)) {
            for (const stmt of a.statements) {
                const b = statementBinds(stmt, name, file);
                if (b) return b;
            }
        }
        if (ts.isFunctionLike(a)) {
            for (const p of a.parameters)
                if (boundNames(p.name).includes(name))
                    return { kind: "decl", node: p };
            if (
                (ts.isFunctionExpression(a) || ts.isFunctionDeclaration(a)) &&
                a.name?.text === name
            )
                return { kind: "decl", node: a };
        }
        if (
            (ts.isForOfStatement(a) ||
                ts.isForInStatement(a) ||
                ts.isForStatement(a)) &&
            a.initializer &&
            ts.isVariableDeclarationList(a.initializer)
        ) {
            for (const d of a.initializer.declarations)
                if (boundNames(d.name).includes(name))
                    return { kind: "decl", node: a.initializer.parent };
        }
        if (
            ts.isCatchClause(a) &&
            a.variableDeclaration &&
            boundNames(a.variableDeclaration.name).includes(name)
        )
            return { kind: "decl", node: a.variableDeclaration };
    }
    return null;
}

/** Is the identifier a reference (not a property / member / label name)? */
function isReference(id: ts.Identifier): boolean {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if (ts.isPropertyAssignment(p) && p.name === id) return false;
    if (ts.isQualifiedName(p) && p.right === id) return false;
    if (
        (ts.isMethodDeclaration(p) ||
            ts.isPropertyDeclaration(p) ||
            ts.isPropertySignature(p) ||
            ts.isMethodSignature(p) ||
            ts.isGetAccessor(p) ||
            ts.isSetAccessor(p)) &&
        p.name === id
    )
        return false;
    if (ts.isJsxAttribute(p) && p.name === id) return false;
    if (ts.isBindingElement(p) && p.propertyName === id) return false;
    if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p))
        return false;
    return true;
}

function isWithin(node: ts.Node, container: ts.Node): boolean {
    return node.pos >= container.pos && node.end <= container.end;
}

/**
 * The fingerprint of `node`: its tokens plus, for every binding it reads
 * from outside itself, that binding's own fingerprint (memoised per
 * declaration node; a cycle contributes its name only).
 */
function fingerprintOf(
    node: ts.Node,
    sf: ts.SourceFile,
    file: string,
    memo: Map<ts.Node, string>,
    inProgress: Set<ts.Node>
): string {
    const deps = new Map<string, string>();
    const visit = (n: ts.Node) => {
        if (ts.isIdentifier(n) && isReference(n) && !deps.has(n.text)) {
            const b = resolve(n, n.text, file);
            if (b?.kind === "import") deps.set(n.text, b.describe);
            else if (b && !isWithin(b.node, node)) {
                if (ts.isParameter(b.node)) {
                    // A parameter's value comes from each call site: never
                    // equal to anything else, so pin it to its position.
                    deps.set(n.text, `param@${file}:${b.node.pos}`);
                } else if (inProgress.has(b.node)) {
                    deps.set(n.text, `cycle:${n.text}`);
                } else {
                    let d = memo.get(b.node);
                    if (d === undefined) {
                        inProgress.add(b.node);
                        d = fingerprintOf(b.node, sf, file, memo, inProgress);
                        inProgress.delete(b.node);
                        memo.set(b.node, d);
                    }
                    deps.set(n.text, d);
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    const closure = [...deps.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join(";");
    return hash(tokens(node, sf).join(" ") + "\u0000" + closure);
}

function isTestBlockCallee(e: ts.Expression): boolean {
    if (ts.isIdentifier(e)) return TEST_BLOCK_CALLEES.has(e.text);
    return (
        ts.isPropertyAccessExpression(e) &&
        ts.isIdentifier(e.expression) &&
        TEST_BLOCK_CALLEES.has(e.expression.text) &&
        !EXCLUDED_MODIFIERS.has(e.name.text)
    );
}

/** Every non-empty test block of one file, fingerprinted. */
export function collectTestBlocks(file: string, source: string): TestBlock[] {
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const memo = new Map<ts.Node, string>();
    const blocks: TestBlock[] = [];
    const visit = (n: ts.Node) => {
        if (
            ts.isCallExpression(n) &&
            isTestBlockCallee(n.expression) &&
            n.arguments.length >= 2
        ) {
            const fn = n.arguments[1];
            if (
                (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
                !(ts.isBlock(fn.body) && fn.body.statements.length === 0)
            ) {
                blocks.push({
                    file,
                    line:
                        sf.getLineAndCharacterOfPosition(n.getStart(sf)).line +
                        1,
                    name: n.arguments[0].getText(sf),
                    fingerprint: fingerprintOf(fn, sf, file, memo, new Set()),
                });
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return blocks;
}

/** Groups of two or more blocks sharing a fingerprint. */
export function findDuplicateTestBlocks(blocks: TestBlock[]): TestBlock[][] {
    const byPrint = new Map<string, TestBlock[]>();
    for (const b of blocks) {
        const g = byPrint.get(b.fingerprint);
        if (g) g.push(b);
        else byPrint.set(b.fingerprint, [b]);
    }
    return [...byPrint.values()].filter((g) => g.length > 1);
}
