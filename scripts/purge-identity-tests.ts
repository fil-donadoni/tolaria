/**
 * One-shot codemod for issue #2363: remove identity-only `it()` blocks from the
 * card-set test suites, then any `describe` left holding no tests, then any
 * import/binding left unreferenced by the removal.
 *
 * Kept in the tree rather than run from a scratch directory because the diff it
 * produces is ~900 blocks across ~280 files: the only way to review that is to
 * re-run the transform and diff the result. It is idempotent — a second run
 * over a purged tree changes nothing.
 *
 *     bun scripts/purge-identity-tests.ts --dry     # report, touch nothing
 *     bun scripts/purge-identity-tests.ts           # rewrite in place
 *
 * `--keep <file:line>` (repeatable) spares one block — used during the triage
 * pass for the handful of identity blocks that were CONVERTED to behaviour
 * tests by hand rather than deleted.
 *
 * ── Known residue: run `bun run lint` after it ───────────────────────────────
 * The binding cleanup below is deliberately conservative — it drops MODULE-level
 * `const`s and import specifiers only, because an over-eager remover deletes a
 * binding something else still needs and the failure is a broken build, not a
 * lint warning. So a real run leaves three shapes behind, and ESLint names every
 * one of them:
 *
 *   - a `const` inside a `describe` whose only reader was a deleted block
 *     (`no-unused-vars`);
 *   - a `for (… of TABLE) { }` whose body was a single deleted `it`
 *     (`no-empty`, then `TABLE` goes unused in turn);
 *   - the import cascade those two release, one layer per round.
 *
 * The #2363 run left exactly 9 such errors across 6 files, cleared by hand and
 * by an eslint-driven loop over the unused-import cascade. Anyone re-running
 * this from the pre-purge tree should expect the same 9 and finish the same
 * way: `bunx eslint convex/cards/sets/` until it is silent.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { classifyTestBlocks } from "./lib/identity-test-classifier";

const REPO_ROOT = path.resolve(__dirname, "..");
const SETS_ROOT = path.join(REPO_ROOT, "convex/cards/sets");

const BLOCK_FNS = new Set(["it", "test"]);
const SUITE_FNS = new Set(["describe", "suite"]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".test.ts") && full.includes("__tests__"))
            out.push(full);
    }
    return out;
}

function unwrap(node: ts.Expression): ts.Expression {
    let cur = node;
    for (;;) {
        if (
            ts.isNonNullExpression(cur) ||
            ts.isParenthesizedExpression(cur) ||
            ts.isAsExpression(cur)
        ) {
            cur = cur.expression;
            continue;
        }
        return cur;
    }
}

/** Root identifier of `it` / `it.only` / `describe.each(...)`. */
function keywordOf(callee: ts.Expression): string | null {
    let cur = unwrap(callee);
    for (;;) {
        if (ts.isIdentifier(cur)) return cur.text;
        if (ts.isPropertyAccessExpression(cur)) {
            cur = unwrap(cur.expression);
            continue;
        }
        if (ts.isCallExpression(cur)) {
            cur = unwrap(cur.expression);
            continue;
        }
        return null;
    }
}

/** The statement a call sits in — that is the unit we delete. */
function enclosingStatement(node: ts.Node): ts.Statement | null {
    let cur: ts.Node | undefined = node;
    while (cur && !ts.isSourceFile(cur)) {
        if (ts.isStatement(cur)) return cur;
        cur = cur.parent;
    }
    return null;
}

type Range = { start: number; end: number };

/**
 * Statement span including its own leading comment block and the newline that
 * terminates it, so removal leaves no orphaned doc comment or blank line.
 *
 * `getFullStart()` reaches back over trivia to the end of the previous token.
 * We keep only the part of that trivia that starts on its own line: a trailing
 * `// …` on the PREVIOUS statement's line belongs to that statement.
 */
function spanOf(stmt: ts.Statement, sf: ts.SourceFile, text: string): Range {
    let start = stmt.getFullStart();
    const declaredStart = stmt.getStart(sf);
    // Walk forward past trivia that is still on the previous statement's line.
    const firstNewline = text.indexOf("\n", start);
    if (firstNewline !== -1 && firstNewline < declaredStart) {
        // Skip every blank/comment line back-to-back up to the statement, but
        // only from the first line break onwards.
        start = firstNewline + 1;
    }
    // Anchor to the start of the line so indentation goes with it.
    const lineStart = text.lastIndexOf("\n", declaredStart - 1) + 1;
    if (text.slice(lineStart, declaredStart).trim() === "") {
        start = Math.min(start, declaredStart);
    }
    let end = stmt.getEnd();
    if (text[end] === ";") end++;
    while (end < text.length && (text[end] === " " || text[end] === "\t"))
        end++;
    if (text[end] === "\r") end++;
    if (text[end] === "\n") end++;
    return { start, end };
}

function applyRemovals(text: string, ranges: Range[]): string {
    const sorted = [...ranges].sort((a, b) => b.start - a.start);
    let out = text;
    for (const r of sorted) out = out.slice(0, r.start) + out.slice(r.end);
    return out;
}

/** Does this node contain a test-declaring call anywhere beneath it? */
function containsTest(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(n)) {
            const kw = keywordOf(n.expression);
            if (kw && (BLOCK_FNS.has(kw) || SUITE_FNS.has(kw))) {
                found = true;
                return;
            }
        }
        ts.forEachChild(n, visit);
    };
    ts.forEachChild(node, visit);
    return found;
}

/** Remove `describe(...)` statements that no longer contain any test. */
function stripEmptySuites(file: string, text: string): string {
    for (;;) {
        const sf = ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
        );
        const ranges: Range[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const kw = keywordOf(node.expression);
                if (kw && SUITE_FNS.has(kw) && !containsTest(node)) {
                    const stmt = enclosingStatement(node);
                    if (stmt) {
                        ranges.push(spanOf(stmt, sf, text));
                        return; // do not descend into what we are deleting
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
        if (ranges.length === 0) return text;
        text = applyRemovals(text, ranges);
    }
}

/** Every identifier the file READS (declaration names and property names excluded). */
function referencedNames(sf: ts.SourceFile): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (n: string) => counts.set(n, (counts.get(n) ?? 0) + 1);
    // Two passes rather than a pruning walk: the identifiers that are NOT reads
    // are marked first, then every remaining identifier is counted. A single
    // walk that skips a declaration's name by re-descending its `getChildren()`
    // silently loses whole subtrees — `getChildren()` yields SyntaxList nodes
    // that `forEachChild` will not traverse, which drops every function
    // PARAMETER and with it every type annotation on one. That bug read as
    // "these type imports are unused" and deleted them.
    const notARead = new Set<ts.Node>();
    const mark = (node: ts.Node) => {
        if (
            (ts.isImportSpecifier(node) ||
                ts.isImportClause(node) ||
                ts.isNamespaceImport(node) ||
                ts.isVariableDeclaration(node)) &&
            node.name &&
            ts.isIdentifier(node.name)
        ) {
            notARead.add(node.name);
        }
        // `obj.foo`, `{ foo: … }`, `interface { foo: T }`, `{ foo: bar } = x`,
        // `ns.Foo` — in all of these the marked identifier names a member, not
        // a binding in scope.
        if (ts.isPropertyAccessExpression(node)) notARead.add(node.name);
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name))
            notARead.add(node.name);
        if (
            (ts.isPropertySignature(node) ||
                ts.isMethodSignature(node) ||
                ts.isPropertyDeclaration(node) ||
                ts.isMethodDeclaration(node)) &&
            node.name &&
            ts.isIdentifier(node.name)
        ) {
            notARead.add(node.name);
        }
        if (
            ts.isBindingElement(node) &&
            node.propertyName &&
            ts.isIdentifier(node.propertyName)
        ) {
            notARead.add(node.propertyName);
        }
        if (ts.isQualifiedName(node)) notARead.add(node.right);
        ts.forEachChild(node, mark);
    };
    mark(sf);

    // Everything else counts as a read. Deliberately over-inclusive: a function
    // or parameter name that happens to collide with an import keeps that
    // import alive, and keeping one import too many is invisible while dropping
    // one breaks the build.
    const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && !notARead.has(node)) bump(node.text);
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return counts;
}

/**
 * Drop imports and const bindings the purge orphaned. Iterated to a fixpoint:
 * removing `const DEF = byId("x")` can orphan the `byId` import in turn.
 */
function stripUnusedBindings(file: string, text: string): string {
    for (;;) {
        const sf = ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
        );
        const used = referencedNames(sf);
        const isUsed = (n: string) => (used.get(n) ?? 0) > 0;
        const ranges: Range[] = [];

        for (const stmt of sf.statements) {
            if (ts.isImportDeclaration(stmt) && stmt.importClause) {
                const clause = stmt.importClause;
                const named = clause.namedBindings;
                const deadDefault = clause.name && !isUsed(clause.name.text);
                if (named && ts.isNamedImports(named)) {
                    const live = named.elements.filter((e) =>
                        isUsed(e.name.text)
                    );
                    if (live.length === 0 && (deadDefault || !clause.name)) {
                        ranges.push(spanOf(stmt, sf, text));
                        continue;
                    }
                    if (live.length < named.elements.length) {
                        // Rewrite the specifier list in place.
                        const inner = live.map((e) => e.getText(sf)).join(", ");
                        ranges.push({
                            start: named.getStart(sf),
                            end: named.getEnd(),
                        });
                        text =
                            text.slice(0, named.getStart(sf)) +
                            `{ ${inner} }` +
                            text.slice(named.getEnd());
                        ranges.pop();
                        // Re-parse from the top: offsets just shifted.
                        break;
                    }
                } else if (deadDefault && !named) {
                    ranges.push(spanOf(stmt, sf, text));
                }
                continue;
            }
            if (
                ts.isVariableStatement(stmt) &&
                stmt.declarationList.declarations.length === 1
            ) {
                const decl = stmt.declarationList.declarations[0];
                if (ts.isIdentifier(decl.name) && !isUsed(decl.name.text)) {
                    ranges.push(spanOf(stmt, sf, text));
                }
            }
        }

        if (ranges.length === 0) {
            // The `break` above rewrote text without queuing a range; detect
            // that by comparing against the parsed source.
            if (text === sf.text) return text;
            continue;
        }
        text = applyRemovals(text, ranges);
    }
}

export interface PurgeResult {
    file: string;
    removed: number;
    before: number;
    after: number;
    emptied: boolean;
    text: string;
}

export function purgeFile(
    relFile: string,
    source: string,
    keep: Set<string>
): PurgeResult {
    const blocks = classifyTestBlocks(relFile, source);
    const before = blocks.length;
    const doomed = blocks.filter(
        (b) => b.verdict === "identity" && !keep.has(`${relFile}:${b.line}`)
    );

    let text = source;
    if (doomed.length > 0) {
        const sf = ts.createSourceFile(
            relFile,
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
        );
        const doomedLines = new Set(doomed.map((b) => b.line));
        const ranges: Range[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const kw = keywordOf(node.expression);
                if (kw && BLOCK_FNS.has(kw)) {
                    const line =
                        sf.getLineAndCharacterOfPosition(node.getStart(sf))
                            .line + 1;
                    if (doomedLines.has(line)) {
                        const stmt = enclosingStatement(node);
                        if (stmt) ranges.push(spanOf(stmt, sf, source));
                        return;
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
        text = applyRemovals(source, ranges);
        text = stripEmptySuites(relFile, text);
        text = stripUnusedBindings(relFile, text);
    }

    const after = classifyTestBlocks(relFile, text).length;
    return {
        file: relFile,
        removed: doomed.length,
        before,
        after,
        emptied: before > 0 && after === 0,
        text,
    };
}

function main() {
    const args = process.argv.slice(2);
    const dry = args.includes("--dry");
    const keep = new Set<string>();
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--keep" && args[i + 1]) keep.add(args[++i]);
    }

    let totalRemoved = 0;
    const emptied: string[] = [];
    const touched: string[] = [];

    for (const abs of walk(SETS_ROOT).sort()) {
        const rel = path.relative(REPO_ROOT, abs);
        const source = fs.readFileSync(abs, "utf-8");
        const result = purgeFile(rel, source, keep);
        if (result.removed === 0) continue;
        totalRemoved += result.removed;
        touched.push(rel);
        if (result.emptied) emptied.push(rel);
        if (!dry) fs.writeFileSync(abs, result.text);
    }

    console.log(
        `${dry ? "[dry] " : ""}removed ${totalRemoved} identity blocks across ${touched.length} files`
    );
    if (emptied.length > 0) {
        console.log(`\nfiles left with ZERO tests (${emptied.length}):`);
        for (const f of emptied) console.log("  " + f);
    }
}

if (import.meta.main) main();
