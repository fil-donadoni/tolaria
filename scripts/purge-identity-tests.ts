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
 * ── The dry run is repo-wide (issue #4489) ───────────────────────────────────
 * `--dry` scans EVERY tracked test file, not just the card sets, and reports
 * three classes, each counted per area (`set:<code>` for a card-set suite, the
 * first two path segments otherwise):
 *
 *   - identity blocks, minus the named allow-list
 *     (`scripts/lib/identity-test-allowlist.ts`);
 *   - definition-read LINES inside behavioural blocks;
 *   - Op-only blocks on pure-DSL cards (`scripts/lib/card-code-ownership.ts`
 *     decides which cards are pure-DSL), with the reasons the rest were
 *     cleared, so a sampled review can see where the boundary fell.
 *
 * `--list <path>` also writes one TSV row per flagged block/line for that
 * review.
 *
 * ── The rewrite is repo-wide too (issue #4490) ───────────────────────────────
 * Without `--dry` the script deletes, across EVERY tracked test file:
 *
 *   - identity blocks, minus the named allow-list;
 *   - Op-only blocks on pure-DSL cards — evaluated in `convex/cards/sets/**`
 *     only, as in the dry run (elsewhere a pure-DSL card is an engine
 *     fixture).
 *
 * Definition-read LINES are reported, never deleted: the block they sit in is
 * behavioural, and the line is a review finding, not a purge class. A file the
 * purge leaves with no test at all is deleted whole — vitest fails a suite
 * that declares nothing. `--list <path>` in rewrite mode writes one TSV row
 * per DELETED block (`kind\tfile:line\tname`), the list the purge PR carries.
 * The boundary is the classifier's rule: a block the sampled review disagrees
 * with is a classifier fix, never a hand exception here.
 *
 * `bun run check:test-hygiene` (a `health` step, never a PR-phase gate) is
 * the census that keeps both classes at zero after the purge.
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
 * The #2363 run left a handful of such errors across 6 files, cleared by hand
 * and by an eslint-driven loop over the unused-import cascade. Anyone
 * re-running this from the pre-purge tree should expect the same shapes and
 * finish the same way: `bunx eslint convex/cards/sets/` until it is silent.
 *
 * ── Fixed after review: the curried-`.each` over-deletion ────────────────────
 * The first #2363 run deleted 9 BEHAVIOURAL blocks, which the issue puts out of
 * scope. Cause: `describe.each(table)(name, fn)` parses as a call whose callee
 * is itself a call, and `stripEmptySuites` treated the inner
 * `describe.each(table)` head as a suite of its own. The head holds only the
 * table, so it always "contains no test" — and its enclosing statement is the
 * WHOLE wrapper, behavioural siblings included. `isCurriedCalleeHead` below
 * excludes the head at both sites (the suite scan and `containsTest`), so a
 * wrapper is now removed only when every block inside it was identity.
 * Regression test: `scripts/__tests__/purge-identity-tests.test.ts`.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { execFileSync } from "child_process";
import {
    classifyTestBlocks,
    type CardFacts,
    type ClassifyOptions,
    type TestBlock,
} from "./lib/identity-test-classifier";
import {
    isAllowListed,
    staleEntries,
    testName,
} from "./lib/identity-test-allowlist";

const REPO_ROOT = path.resolve(__dirname, "..");

/** `.tsx` suites parse as TSX, as the classifier parses them. */
const scriptKindOf = (file: string) =>
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const BLOCK_FNS = new Set(["it", "test"]);
const SUITE_FNS = new Set(["describe", "suite"]);

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

/**
 * `describe.each(table)(name, fn)` parses as a call whose CALLEE is itself a
 * call: `CallExpression{ expression: CallExpression{ describe.each, [table] } }`.
 * Only the OUTER call is the suite — the inner head holds nothing but the
 * table. Treating the head as a suite in its own right is what deleted whole
 * `describe.each` wrappers in the #2363 run: the head trivially "contains no
 * test", and its enclosing statement is the entire suite.
 */
function isCurriedCalleeHead(node: ts.CallExpression): boolean {
    const parent = node.parent;
    return (
        !!parent && ts.isCallExpression(parent) && parent.expression === node
    );
}

/** Does this node contain a test-declaring call anywhere beneath it? */
function containsTest(node: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(n) && !isCurriedCalleeHead(n)) {
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
            scriptKindOf(file)
        );
        const ranges: Range[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && !isCurriedCalleeHead(node)) {
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
            scriptKindOf(file)
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

/** Which purge class doomed a block. */
export type PurgeKind = "identity" | "op-only";

export interface DeletedBlock {
    kind: PurgeKind;
    line: number;
    name: string;
}

export interface PurgeResult {
    file: string;
    /** Blocks removed, both classes. */
    removed: number;
    removedIdentity: number;
    removedOpOnly: number;
    deleted: DeletedBlock[];
    before: number;
    after: number;
    emptied: boolean;
    text: string;
}

/** The purge class a block falls in, or null when it stays. */
export function purgeKindOf(block: TestBlock): PurgeKind | null {
    if (block.verdict === "identity" && !isAllowListed(block))
        return "identity";
    if (block.opOnly?.kind === "op-only") return "op-only";
    return null;
}

/**
 * Purge one file. `opts.cards` enables the Op-only class — the caller passes
 * it for a card-set suite only, exactly as `dryRun` does.
 */
export function purgeFile(
    relFile: string,
    source: string,
    keep: Set<string>,
    opts: ClassifyOptions = {}
): PurgeResult {
    const blocks = classifyTestBlocks(relFile, source, opts);
    const before = blocks.length;
    const deleted: DeletedBlock[] = [];
    const doomed = blocks.filter((b) => {
        if (keep.has(`${relFile}:${b.line}`)) return false;
        const kind = purgeKindOf(b);
        if (kind === null) return false;
        deleted.push({ kind, line: b.line, name: testName(b) });
        return true;
    });

    let text = source;
    if (doomed.length > 0) {
        const sf = ts.createSourceFile(
            relFile,
            source,
            ts.ScriptTarget.Latest,
            true,
            scriptKindOf(relFile)
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
    // Every doomed block must have been found again by its line: a miss here
    // would report a deletion that never happened.
    if (before - after !== doomed.length)
        throw new Error(
            `${relFile}: ${doomed.length} blocks doomed, ${before - after} removed`
        );
    return {
        file: relFile,
        removed: doomed.length,
        removedIdentity: deleted.filter((d) => d.kind === "identity").length,
        removedOpOnly: deleted.filter((d) => d.kind === "op-only").length,
        deleted,
        before,
        after,
        emptied: before > 0 && after === 0,
        text,
    };
}

const isCardSetSuite = (relFile: string) =>
    relFile.startsWith("convex/cards/sets/");

/** `set:<code>` for a card-set suite, else the first two path segments. */
export function areaOf(relFile: string): string {
    const set = /^convex\/cards\/sets\/([^/]+)\//.exec(relFile);
    return set ? `set:${set[1]}` : relFile.split("/").slice(0, 2).join("/");
}

export interface DryRunReport {
    files: number;
    blocks: number;
    identity: { flagged: number; allowListed: number };
    definitionReads: { lines: number; blocks: number };
    /** Op-only blocks, the cards they name, and every asserting behavioural block on pure-DSL cards only. */
    opOnly: { blocks: number; cards: number; onPureDslCards: number };
    /** Area → [identity, definition-read lines, Op-only blocks]. */
    byArea: Map<string, [number, number, number]>;
    /** Why a behavioural, asserting block was NOT Op-only — reason kind → count. */
    cleared: Map<string, number>;
    stale: string[];
    /** Entries whose name matches more than one block — each exempts them all. */
    ambiguous: string[];
    rows: string[];
}

/**
 * Reads a relative import of a repo test file (`./helpers` → `./helpers.ts`)
 * — but only a TEST-SUPPORT module, one under a `__tests__/` directory. An
 * engine module (`../state`) is the code under test, never a fixture helper:
 * seeing through `advancePhase` to the calls inside it would launder an engine
 * surface into the Op-only vocabulary.
 */
export function readRelativeImport(
    fromFile: string,
    specifier: string
): string | undefined {
    const base = path.join(REPO_ROOT, path.dirname(fromFile), specifier);
    for (const candidate of [
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
    ]) {
        if (!candidate.includes(`${path.sep}__tests__${path.sep}`)) continue;
        if (fs.existsSync(candidate))
            return fs.readFileSync(candidate, "utf-8");
    }
    return undefined;
}

/** The repo-wide dry run over already-read sources — pure, so it is unit-testable. */
export function dryRun(
    sources: readonly { file: string; source: string }[],
    cards: CardFacts,
    readImport?: (fromFile: string, specifier: string) => string | undefined
): DryRunReport {
    const report: DryRunReport = {
        files: sources.length,
        blocks: 0,
        identity: { flagged: 0, allowListed: 0 },
        definitionReads: { lines: 0, blocks: 0 },
        opOnly: { blocks: 0, cards: 0, onPureDslCards: 0 },
        byArea: new Map(),
        cleared: new Map(),
        stale: [],
        ambiguous: [],
        rows: [],
    };
    const opOnlyCards = new Set<string>();
    const all: TestBlock[] = [];
    const bump = (area: string, slot: 0 | 1 | 2, n = 1) => {
        const row = report.byArea.get(area) ?? [0, 0, 0];
        row[slot] += n;
        report.byArea.set(area, row);
    };
    const row = (b: TestBlock, kind: string, line: number, detail: string) =>
        report.rows.push(
            [kind, `${b.file}:${line}`, testName(b), detail].join("\t")
        );

    for (const { file, source } of sources) {
        // The Op-only class is a per-CARD-suite verdict: outside the card sets a
        // block on a pure-DSL card is an engine test using it as a fixture.
        const blocks = classifyTestBlocks(file, source, {
            cards: isCardSetSuite(file) ? cards : undefined,
            readImport,
        });
        all.push(...blocks);
        report.blocks += blocks.length;
        const area = areaOf(file);
        for (const b of blocks) {
            const allowed = isAllowListed(b);
            if (b.verdict === "identity") {
                if (allowed) {
                    report.identity.allowListed++;
                } else {
                    report.identity.flagged++;
                    bump(area, 0);
                    row(b, "identity", b.line, "");
                }
            }
            if (b.definitionReads.length > 0 && !allowed) {
                report.definitionReads.lines += b.definitionReads.length;
                report.definitionReads.blocks++;
                bump(area, 1, b.definitionReads.length);
                for (const l of b.definitionReads)
                    row(b, "definition-read", l, "");
            }
            if (b.opOnly?.kind === "op-only") {
                report.opOnly.blocks++;
                report.opOnly.onPureDslCards++;
                bump(area, 2);
                for (const c of b.opOnly.cards) opOnlyCards.add(c);
                row(b, "op-only", b.line, b.opOnly.cards.join(", "));
            } else if (b.opOnly) {
                const { rule, reason } = b.opOnly;
                if (
                    rule !== "no-catalogue-card" &&
                    rule !== "unknown-card" &&
                    rule !== "card-owns-code"
                )
                    report.opOnly.onPureDslCards++;
                // A foreign call is broken out by callee: that is the list a
                // sampled review reads to see where the vocabulary stops.
                const kind =
                    rule === "foreign-call"
                        ? `${rule}: ${reason.slice("calls ".length)}`
                        : rule === "card-owns-code"
                          ? `${rule}: ${reason.replace(/^.*?: /, "").replace(/ \(.*$/, "")}`
                          : rule;
                report.cleared.set(kind, (report.cleared.get(kind) ?? 0) + 1);
            }
        }
    }
    report.opOnly.cards = opOnlyCards.size;
    const { stale, ambiguous } = staleEntries(all);
    report.stale = stale.map((e) => `${e.file} :: ${e.test}`);
    report.ambiguous = ambiguous.map((e) => `${e.file} :: ${e.test}`);
    return report;
}

export function trackedTestFiles(): string[] {
    return (
        execFileSync("git", ["ls-files", "--", "*.test.ts", "*.test.tsx"], {
            cwd: REPO_ROOT,
            encoding: "utf-8",
        })
            .split("\n")
            .filter(Boolean)
            // A file deleted in the work tree but not yet staged is still in the
            // index: the purge itself deletes an emptied suite this way.
            .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)))
            .sort()
    );
}

export async function loadCardFacts(): Promise<CardFacts> {
    // Imported lazily: the rewrite mode never needs the catalogue.
    const { getAllCards } = await import("../convex/cards");
    const { buildCardFacts, smokeCoverage } =
        await import("./lib/card-code-ownership");
    const cards = getAllCards();
    return buildCardFacts(cards, smokeCoverage(cards));
}

function printReport(r: DryRunReport, top: number) {
    console.log(
        `[dry] ${r.files} test files, ${r.blocks} blocks\n` +
            `  identity blocks:        ${r.identity.flagged} (+${r.identity.allowListed} allow-listed)\n` +
            `  definition-read lines:  ${r.definitionReads.lines} in ${r.definitionReads.blocks} blocks\n` +
            `  Op-only blocks:         ${r.opOnly.blocks} on ${r.opOnly.cards} pure-DSL cards ` +
            `(of ${r.opOnly.onPureDslCards} asserting blocks naming only pure-DSL cards)`
    );
    console.log("\nper area (identity / definition-read lines / Op-only):");
    const areas = [...r.byArea].sort(
        (a, b) =>
            b[1][2] + b[1][0] - (a[1][2] + a[1][0]) || a[0].localeCompare(b[0])
    );
    for (const [area, [id, dr, op]] of areas)
        console.log(
            `  ${area.padEnd(28)} ${String(id).padStart(4)} ${String(dr).padStart(5)} ${String(op).padStart(5)}`
        );
    console.log(
        `\nwhy asserting behavioural blocks were NOT Op-only (top ${top}):`
    );
    for (const [k, n] of [...r.cleared]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top))
        console.log(`  ${String(n).padStart(6)}  ${k}`);
    if (r.ambiguous.length > 0) {
        console.log(
            `\nAMBIGUOUS allow-list entries (${r.ambiguous.length}) — one name, several blocks; retitle them:`
        );
        for (const a of r.ambiguous) console.log("  " + a);
    }
    if (r.stale.length > 0) {
        console.log(
            `\nSTALE allow-list entries (${r.stale.length}) — delete them:`
        );
        for (const s of r.stale) console.log("  " + s);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const dry = args.includes("--dry");
    const keep = new Set<string>();
    let list: string | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--keep" && args[i + 1]) keep.add(args[++i]);
        if (args[i] === "--list" && args[i + 1]) list = args[++i];
    }

    if (dry) {
        const sources = trackedTestFiles().map((file) => ({
            file,
            source: fs.readFileSync(path.join(REPO_ROOT, file), "utf-8"),
        }));
        const report = dryRun(
            sources,
            await loadCardFacts(),
            readRelativeImport
        );
        printReport(report, 15);
        if (list) {
            fs.writeFileSync(list, report.rows.join("\n") + "\n");
            console.log(`\n${report.rows.length} rows → ${list}`);
        }
        return;
    }

    const sources = trackedTestFiles().map((file) => ({
        file,
        source: fs.readFileSync(path.join(REPO_ROOT, file), "utf-8"),
    }));
    const purge = purgeSources(
        sources,
        await loadCardFacts(),
        keep,
        readRelativeImport
    );
    for (const { file, text } of purge.writes)
        fs.writeFileSync(path.join(REPO_ROOT, file), text);
    for (const file of purge.unlinks) fs.unlinkSync(path.join(REPO_ROOT, file));

    console.log(
        `removed ${purge.removedIdentity} identity + ${purge.removedOpOnly} Op-only blocks across ${purge.writes.length + purge.unlinks.length} files`
    );
    console.log("\nblocks per area (before → after), changed areas only:");
    for (const [area, [before, after]] of [...purge.byArea].sort((a, b) =>
        a[0].localeCompare(b[0])
    )) {
        if (before === after) continue;
        console.log(
            `  ${area.padEnd(28)} ${String(before).padStart(5)} → ${String(after).padStart(5)}`
        );
    }
    if (purge.unlinks.length > 0) {
        console.log(
            `\nfiles left with ZERO tests, deleted (${purge.unlinks.length}):`
        );
        for (const f of purge.unlinks) console.log("  " + f);
    }
    if (list) {
        fs.writeFileSync(list, purge.rows.join("\n") + "\n");
        console.log(`\n${purge.rows.length} deleted blocks → ${list}`);
    }
}

export interface RepoPurge {
    /** Files to rewrite, with their purged text. */
    writes: { file: string; text: string }[];
    /** Files the purge emptied — a suite that declares no test fails vitest
     *  ("No test found"), so it goes with its blocks. */
    unlinks: string[];
    /** One `kind\tfile:line\tname` row per deleted block. */
    rows: string[];
    /** Area → [blocks before, blocks after]. */
    byArea: Map<string, [number, number]>;
    removedIdentity: number;
    removedOpOnly: number;
}

/**
 * The repo-wide rewrite over already-read sources — pure, so the one decision
 * that matters is unit-testable: card facts reach the classifier for a
 * card-set suite ONLY. Handed to every file, the Op-only class would purge
 * engine tests that use a pure-DSL card as a fixture.
 */
export function purgeSources(
    sources: readonly { file: string; source: string }[],
    cards: CardFacts,
    keep: Set<string>,
    readImport?: (fromFile: string, specifier: string) => string | undefined
): RepoPurge {
    const out: RepoPurge = {
        writes: [],
        unlinks: [],
        rows: [],
        byArea: new Map(),
        removedIdentity: 0,
        removedOpOnly: 0,
    };
    for (const { file, source } of sources) {
        const result = purgeFile(file, source, keep, {
            cards: isCardSetSuite(file) ? cards : undefined,
            readImport,
        });
        const area = out.byArea.get(areaOf(file)) ?? [0, 0];
        area[0] += result.before;
        area[1] += result.after;
        out.byArea.set(areaOf(file), area);
        if (result.removed === 0) continue;
        out.removedIdentity += result.removedIdentity;
        out.removedOpOnly += result.removedOpOnly;
        for (const d of result.deleted)
            out.rows.push([d.kind, `${file}:${d.line}`, d.name].join("\t"));
        if (result.emptied) out.unlinks.push(file);
        else out.writes.push({ file, text: result.text });
    }
    return out;
}

if (import.meta.main) await main();
