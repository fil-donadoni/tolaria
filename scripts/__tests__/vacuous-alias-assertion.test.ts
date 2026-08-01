import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Vacuous-alias-assertion guard.
 *
 * A deep-equality assertion whose EXPECTED value is a live reference into the
 * very object the code under test mutates **in place** is true by construction.
 * It passes with the feature it "covers" switched off:
 *
 *     const shield = state.targetPreventionShields[0];   // alias INTO state
 *     resolveTopOfStack(state);                          // mutates s.remaining
 *     expect(state.targetPreventionShields[0]).toEqual(shield);  // same object
 *
 * Both sides evaluate to the *same object*, so `toEqual` compares it with
 * itself. That exact assertion shipped in this repo, was green with the feature
 * disabled, and was caught only because a human demanded a mutation test. The
 * fix is one word: snapshot with `structuredClone` before the act.
 *
 * This is the mechanical half of `.claude/rules/gre-development.md`
 * § Proof-of-failure — shape 2, "the test asserts nothing". The rule exists
 * because of an asymmetry no amount of care survives:
 *
 *     A test that fails when it should pass is LOUD — CI goes red.
 *     A test that passes when it should fail is SILENT FOREVER.
 *
 * Nothing in the normal workflow exercises the second case. Writing, reading,
 * reviewing and running the test all look identical whether the assertion is
 * load-bearing or vacuous. Proof-of-failure is the general defence, but it
 * depends on a human remembering; this guard is the structural one for the
 * single shape that can be recognised from the syntax alone.
 *
 * ── What it flags ────────────────────────────────────────────────────────────
 * A deep-equality assertion (`toEqual` / `toStrictEqual` / `toMatchObject` /
 * `toContainEqual`, un-negated) where ONE side is an identifier bound earlier
 * in scope to a live alias INTO some object, and the OTHER side is also a live
 * alias (inline, or another such identifier). "Live alias" means a pure
 * property/element access chain rooted at an identifier (`state.players[0]`,
 * `st.shields[0].remaining`), optionally through an element-returning accessor
 * (`.find(…)`, `.at(…)`, `.pop()`, `.shift()`) — constructs that hand back part
 * of the receiver rather than a fresh value.
 *
 * ── What it deliberately does NOT flag, and why ───────────────────────────────
 * - `toBe(x)`: asserting reference identity is sometimes exactly the point.
 *   Only DEEP-equality is vacuous against a live reference.
 * - Negated matchers (`.not.toEqual`): an aliased argument makes those FAIL,
 *   not vacuously pass. The hazard is one-directional.
 * - Anything that copies: `structuredClone(…)`, `JSON.parse(JSON.stringify(…))`,
 *   `{ ...x }` / `[ ...x ]`, `.map/.filter/.slice/.concat(…)`, `Object.assign({}, …)`
 *   — none of these are an access chain, so they never register as a capture.
 *   That is the FIX, so recognising it is the point.
 * - Spy call records (`spy.mock.calls[0][0]`): a captured past call argument is
 *   not live state, and the `capture → mockClear() → interact → capture again →
 *   compare` idiom (four sites in `src/components/board/__tests__`) is a
 *   deliberate, self-evident equivalence check. Excluded structurally rather
 *   than by allowlisting four whole files.
 *
 * ── Precision, as measured ───────────────────────────────────────────────────
 * Over all 880 test files: the broad form of this heuristic (any alias capture
 * compared with `toEqual`) produced 8 hits, ALL false positives — validator
 * `.json` descriptions, `.find()`ed bot moves compared against a returned
 * move, spy call args. The rule as shipped produces **0 hits** and needs **no
 * allowlist**. It is a purely preventive guard: it costs ~1s and fires only on
 * a newly written aliasing comparison.
 *
 * Known blind spot, accepted: the parser has no types, so a captured PRIMITIVE
 * (`const before = state.players[0].life`) reads as an alias. Comparing it with
 * `toEqual` after the act is perfectly sound — numbers copy by value. Measured
 * occurrences: zero, because primitives are asserted with `toBe`. If one ever
 * fires, switching that assertion to `toBe` both silences it and is the better
 * test.
 *
 * Lives under `scripts/__tests__/` with the repo's other hygiene guards, so it
 * runs in the APPLICATION suite and inside `bun run check:guards` — i.e. in the
 * light pre-PR gate, with no extra wiring.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Directories worth walking — everything else holds no test files. */
const SCAN_ROOTS = ["convex", "src", "scripts"];

/**
 * Test files exempted from the sweep, with the reason.
 *
 * Deliberately EMPTY. Every shape the guard flags is a bug with a one-line fix
 * (`structuredClone` the expected value before the act), so an entry here
 * should be a genuinely-fine comparison the syntax cannot distinguish — and the
 * exemption is FILE-scoped, which is coarse: it also blinds the guard to every
 * future assertion in that file. Fix the assertion instead. If an entry is
 * truly warranted, justify it in a sentence, as the guards next door do.
 */
const ALLOWLIST = new Map<string, string>();

/** Methods whose result is an ELEMENT OF the receiver — so it aliases it.
 *  `.map/.filter/.slice/.concat` are absent on purpose: they build a new
 *  container, which is exactly what makes them safe. */
const ELEMENT_ACCESSORS = new Set(["find", "findLast", "at", "pop", "shift"]);

/** Deep-equality matchers. `toBe` is excluded: see the header. */
const DEEP_EQUAL_MATCHERS = new Set([
    "toEqual",
    "toStrictEqual",
    "toMatchObject",
    "toContainEqual",
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

/** Every test file in the repo — application and bot suites alike. */
function testFiles(): string[] {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
        const abs = path.join(REPO_ROOT, root);
        if (!fs.existsSync(abs)) continue;
        for (const f of walk(abs)) {
            if (!/\.test\.tsx?$/.test(f)) continue;
            files.push(path.relative(REPO_ROOT, f));
        }
    }
    return files.sort();
}

/** Strip the wrappers that do not change what an expression evaluates to. */
function unwrap(node: ts.Expression): ts.Expression {
    let cur = node;
    for (;;) {
        if (
            ts.isNonNullExpression(cur) ||
            ts.isParenthesizedExpression(cur) ||
            ts.isAsExpression(cur) ||
            ts.isTypeAssertionExpression(cur)
        ) {
            cur = cur.expression;
            continue;
        }
        return cur;
    }
}

/**
 * If `expr` is a live alias INTO a container, return the root identifier's
 * text; otherwise null. A bare identifier is NOT an alias (nothing was reached
 * into), nor is any call other than an element-returning accessor — a call's
 * provenance is unknowable from syntax, and assuming the worst is what turns
 * a guard into an allowlist farm.
 */
function aliasRoot(expr: ts.Expression): string | null {
    let cur = unwrap(expr);
    let reachedInto = false;
    for (;;) {
        // `spy.mock.calls[0][0]` is a record of a past call, not live state.
        if (ts.isPropertyAccessExpression(cur) && cur.name.text === "mock") {
            return null;
        }
        if (ts.isCallExpression(cur)) {
            const callee = unwrap(cur.expression);
            if (
                ts.isPropertyAccessExpression(callee) &&
                ELEMENT_ACCESSORS.has(callee.name.text)
            ) {
                cur = unwrap(callee.expression);
                reachedInto = true;
                continue;
            }
            return null;
        }
        if (
            ts.isPropertyAccessExpression(cur) ||
            ts.isElementAccessExpression(cur)
        ) {
            cur = unwrap(cur.expression);
            reachedInto = true;
            continue;
        }
        if (ts.isIdentifier(cur)) return reachedInto ? cur.text : null;
        return null;
    }
}

export interface Finding {
    file: string;
    /** the identifier holding the live alias */
    name: string;
    /** identifier the alias chain is rooted at, e.g. `state` */
    root: string;
    declLine: number;
    assertLine: number;
    matcher: string;
}

type Capture = { root: string; line: number };
type Scope = Map<string, Capture>;

function isFunctionLike(node: ts.Node): boolean {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node)
    );
}

/**
 * Parse one test file and report every vacuous-alias comparison in it.
 * Exported shape so the self-test below can feed it synthetic sources.
 */
export function findVacuousAliasAssertions(
    file: string,
    source: string
): Finding[] {
    const findings: Finding[] = [];
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const lineOf = (n: ts.Node) =>
        sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const lookup = (chain: Scope[], name: string): Capture | undefined => {
        for (let i = chain.length - 1; i >= 0; i--) {
            const hit = chain[i].get(name);
            if (hit) return hit;
        }
        return undefined;
    };

    /** Root of one side of the comparison: an inline alias, or an identifier
     *  already bound to one. */
    const sideRoot = (e: ts.Expression, chain: Scope[]): string | null => {
        const inline = aliasRoot(e);
        if (inline) return inline;
        const u = unwrap(e);
        if (ts.isIdentifier(u)) return lookup(chain, u.text)?.root ?? null;
        return null;
    };

    const visit = (node: ts.Node, chain: Scope[]) => {
        // A function body opens a scope: two `it` blocks may both bind `before`
        // to unrelated things, and a file-global map would cross-pair them.
        const scopes = isFunctionLike(node) ? [...chain, new Map()] : chain;
        const current = scopes[scopes.length - 1];

        if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            ts.isIdentifier(node.name)
        ) {
            const root = aliasRoot(node.initializer);
            if (root) current.set(node.name.text, { root, line: lineOf(node) });
            // A same-named non-alias binding must SHADOW an outer capture,
            // otherwise the outer one keeps matching in here.
            else current.delete(node.name.text);
        }
        // `x = somethingFresh()` invalidates an earlier capture in `x`.
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left) &&
            !aliasRoot(node.right)
        ) {
            for (const s of scopes) s.delete(node.left.text);
        }

        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            DEEP_EQUAL_MATCHERS.has(node.expression.name.text) &&
            node.arguments.length >= 1
        ) {
            // Walk back down the matcher chain to the `expect(…)` call, noting
            // any `.not` on the way (a negated matcher FAILS on an alias — the
            // hazard only runs one way).
            let receiver: ts.Expression = node.expression.expression;
            let negated = false;
            let actual: ts.Expression | null = null;
            for (;;) {
                const u = unwrap(receiver);
                if (ts.isPropertyAccessExpression(u)) {
                    if (u.name.text === "not") negated = true;
                    receiver = u.expression;
                    continue;
                }
                if (ts.isCallExpression(u)) {
                    const callee = unwrap(u.expression);
                    if (ts.isIdentifier(callee) && callee.text === "expect") {
                        actual = u.arguments[0] ?? null;
                        break;
                    }
                    receiver = u.expression;
                    continue;
                }
                break;
            }

            if (!negated && actual) {
                // Vacuity is symmetric, so check BOTH argument positions: the
                // captured alias is usually the matcher's argument, but
                // `expect(shield).toEqual(state.shields[0])` is the same bug.
                const expected = unwrap(node.arguments[0]);
                const sides: [ts.Identifier, ts.Expression][] = [];
                if (ts.isIdentifier(expected)) sides.push([expected, actual]);
                const a = unwrap(actual);
                if (ts.isIdentifier(a)) sides.push([a, node.arguments[0]]);

                for (const [id, other] of sides) {
                    const capture = lookup(scopes, id.text);
                    if (!capture) continue;
                    const assertLine = lineOf(node);
                    if (assertLine <= capture.line) continue;
                    if (!sideRoot(other, scopes)) continue;
                    findings.push({
                        file,
                        name: id.text,
                        root: capture.root,
                        declLine: capture.line,
                        assertLine,
                        matcher: node.expression.name.text,
                    });
                    break; // one finding per assertion
                }
            }
        }

        ts.forEachChild(node, (child) => visit(child, scopes));
    };

    visit(sf, [new Map()]);
    return findings;
}

/** Cheap textual prefilter run before the AST parse.
 *
 *  Parsing all ~880 test files costs ~1s locally but 8s on CI's shared runner —
 *  past vitest's 5s default, which is how this guard first landed red (the
 *  detector was right; the sweep was just slow). A deep-equality matcher is
 *  NECESSARY for a finding, so a file containing none can be skipped before
 *  `createSourceFile` ever sees it. This is a pure cost optimisation: it can
 *  only skip files that could not have produced a finding, never change a
 *  verdict. The `it()` below still carries a generous explicit timeout, so a
 *  future corpus that outgrows the prefilter fails loudly on its own merits
 *  rather than on the clock. */
const DEEP_EQUALITY_MATCHERS = [
    "toEqual",
    "toStrictEqual",
    "toMatchObject",
    "toContainEqual",
];

function scanRepo(): Finding[] {
    const findings: Finding[] = [];
    for (const file of testFiles()) {
        if (ALLOWLIST.has(file)) continue;
        const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
        if (!DEEP_EQUALITY_MATCHERS.some((m) => source.includes(m))) continue;
        findings.push(...findVacuousAliasAssertions(file, source));
    }
    return findings;
}

/** Fixtures are ASSEMBLED, never written as a literal aliasing expression, so
 *  the repo sweep above cannot trip over this guard's own test file. */
function fixture(lines: string[]): string {
    return ["it(" + '"x"' + ", () => {", ...lines, "});"].join("\n");
}

const CAPTURE = "const shield = state" + ".shields[0];";
const ACT = "resolveTopOfStack(state);";
const REREAD = "expect(state" + ".shields[0])";

describe("vacuous alias assertions (proof-of-failure, shape 2)", () => {
    it("no test compares a live alias into mutated state against itself", () => {
        const findings = scanRepo();
        const report = findings.map(
            (f) =>
                `${f.file}:${f.assertLine} — \`${f.name}\` (bound at line ` +
                `${f.declLine} to a live reference into \`${f.root}\`) is the ` +
                `expected value of \`${f.matcher}\`, compared against another ` +
                `live read of the same kind. If the code under test mutates ` +
                `in place, both sides are the SAME object and the assertion ` +
                `is true by construction. Snapshot it: ` +
                `\`const ${f.name} = structuredClone(…)\`.`
        );
        expect(report, report.join("\n")).toEqual([]);
        // Whole-corpus AST sweep: ~1s locally, ~8s on CI's shared runner —
        // past vitest's 5s default. Explicit and generous so a slow runner
        // never reads as a guard failure.
    }, 120_000);

    it("every allowlist entry exists and is still needed", () => {
        for (const [file, reason] of ALLOWLIST) {
            expect(
                reason.length,
                `allowlist entry needs a reason: ${file}`
            ).toBeGreaterThan(0);
            expect(
                fs.existsSync(path.join(REPO_ROOT, file)),
                `allowlisted file no longer exists: ${file}`
            ).toBe(true);
            // A stale entry silently exempts a file that no longer needs it —
            // and this exemption is file-wide, so it blinds the guard to every
            // later assertion in there too.
            const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
            expect(
                findVacuousAliasAssertions(file, source).length,
                `allowlisted file no longer trips the guard — drop the entry: ${file}`
            ).toBeGreaterThan(0);
        }
    });

    it("flags the aliased comparison and clears every way of writing it safely", () => {
        const bad = fixture([CAPTURE, ACT, REREAD + ".toEqual(shield);"]);
        const found = findVacuousAliasAssertions("bad.test.ts", bad);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ name: "shield", root: "state" });

        // The fix, and the near-misses that must NOT be flagged. Each line is
        // the same test written a way that is genuinely load-bearing.
        const good: [string, string][] = [
            [
                "structuredClone snapshot (the actual fix)",
                fixture([
                    "const shield = structuredClone(state" + ".shields[0]);",
                    ACT,
                    REREAD + ".toEqual(shield);",
                ]),
            ],
            [
                "object spread copy",
                fixture([
                    "const shield = { ...state" + ".shields[0] };",
                    ACT,
                    REREAD + ".toEqual(shield);",
                ]),
            ],
            [
                "JSON round-trip",
                fixture([
                    "const shield = JSON.parse(JSON.stringify(state" +
                        ".shields[0]));",
                    ACT,
                    REREAD + ".toEqual(shield);",
                ]),
            ],
            [
                "mapped copy of the container",
                fixture([
                    "const shields = state" +
                        ".shields.map((s) => ({ ...s }));",
                    ACT,
                    "expect(state" + ".shields).toEqual(shields);",
                ]),
            ],
            [
                "toBe — reference identity is a legitimate thing to assert",
                fixture([CAPTURE, ACT, REREAD + ".toBe(shield);"]),
            ],
            [
                "negated matcher — an alias makes this FAIL, never pass",
                fixture([CAPTURE, ACT, REREAD + ".not.toEqual(shield);"]),
            ],
            [
                "expected side is a fresh literal, not another live read",
                fixture([CAPTURE, ACT, "expect(shield).toEqual({ n: 1 });"]),
            ],
            [
                "spy call records with a mockClear between the captures",
                fixture([
                    "const first = spy.mock.calls[0][0];",
                    "spy.mockClear();",
                    "fireEvent.click(el());",
                    "const second = spy.mock.calls[0][0];",
                    "expect(second).toEqual(first);",
                ]),
            ],
            [
                "same name, different scope — no cross-pairing",
                [
                    fixture(["const before = state" + ".shields[0];", ACT]),
                    fixture([
                        "const before = countShields(state);",
                        ACT,
                        "expect(countShields(state)).toEqual(before);",
                    ]),
                ].join("\n"),
            ],
        ];
        for (const [label, source] of good) {
            expect(
                findVacuousAliasAssertions("good.test.ts", source),
                `false positive: ${label}`
            ).toEqual([]);
        }
    });

    it("flags the aliasing shape however it is written", () => {
        const variants: [string, string][] = [
            [
                "reversed argument order",
                fixture([
                    CAPTURE,
                    ACT,
                    "expect(shield).toEqual(state" + ".shields[0]);",
                ]),
            ],
            [
                "toStrictEqual",
                fixture([CAPTURE, ACT, REREAD + ".toStrictEqual(shield);"]),
            ],
            [
                "toMatchObject",
                fixture([CAPTURE, ACT, REREAD + ".toMatchObject(shield);"]),
            ],
            [
                "captured via .find()",
                fixture([
                    "const c = state" +
                        ".battlefield.find((x) => x.id === 'a')!;",
                    ACT,
                    "expect(state" +
                        ".battlefield.find((x) => x.id === 'a')).toEqual(c);",
                ]),
            ],
            [
                "both sides captured separately from the same live container",
                fixture([
                    CAPTURE,
                    ACT,
                    "const after = state" + ".shields[0];",
                    "expect(after).toEqual(shield);",
                ]),
            ],
            [
                "whole-array alias",
                fixture([
                    "const shields = state" + ".shields;",
                    ACT,
                    "expect(state" + ".shields).toEqual(shields);",
                ]),
            ],
        ];
        for (const [label, source] of variants) {
            expect(
                findVacuousAliasAssertions("bad.test.ts", source).length,
                `missed the aliasing shape: ${label}`
            ).toBeGreaterThan(0);
        }
    });
});
