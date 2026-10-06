import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { HEALTH_SCRIPTS } from "../lib/health-step";
import { opGapKey } from "../lib/grammar-gaps";
import {
    auditOpCensus,
    baselineAllowlist,
    censusClusters,
    emittedOps,
    botGapsFiledPerDay,
    gapsVerdict,
    renderBotGapCensus,
    handTailCardMatch,
    liveClusterKeys,
    parseAllowlist,
    render,
    renderBotGaps,
    renderClusterCensus,
    renderHandTailClaims,
    unclaimedBotGaps,
    type Allowlist,
    type LiveGapKey,
    type Violation,
} from "../check-gaps";
import {
    handTailClaimMismatches,
    scanCompilerGapMarkers,
} from "../lib/compiler-gap-markers";
import type { CardRow, FragmentRow } from "../lib/oracle-lockfile";
import type { ClusterRow } from "../lib/targets";

/**
 * The derived Op census guard (ADR 0105 § 7.3, issue #3824).
 *
 * PURE over fixtures, on purpose. The live census — the committed allowlist
 * against the committed lockfile — is `bun run check:gaps`, and this file must
 * not become a second copy of it: `scripts/__tests__` runs inside
 * `check:guards`, which runs inside `check:pr` on EVERY diff, while the census
 * is admitted only by a diff that can move it (`CHEAP_GUARDS` in
 * `check-lane.ts`, issue #4963) and runs in `health`. Asserting the real files
 * here would red every branch the day an Op is added rather than the PR that
 * lands it.
 */

const ROOT = path.resolve(__dirname, "../..");
const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
) as { scripts: Record<string, string> };

const row = (op: string, issue = 3820) => ({ key: opGapKey(op), op, issue });
const list = (...ops: string[]): Allowlist => ({ ops: ops.map((o) => row(o)) });
const kinds = (vs: readonly Violation[]) => vs.map((v) => `${v.kind}:${v.op}`);

describe("check:gaps runs in health and in the lane, composed by no package script", () => {
    it("is a script of its own", () => {
        expect(pkg.scripts["check:gaps"]).toBe("bun scripts/check-gaps.ts");
    });

    it("is a health step", () => {
        expect(HEALTH_SCRIPTS).toContain("check:gaps");
    });

    it("runs after check:all, which owns the lockfile drift guard", () => {
        expect(HEALTH_SCRIPTS.indexOf("check:gaps")).toBeGreaterThan(
            HEALTH_SCRIPTS.indexOf("check:all")
        );
    });

    it("health-main reads the list rather than keeping its own copy", () => {
        const src = fs.readFileSync(
            path.join(ROOT, "scripts/health-main.ts"),
            "utf8"
        );
        expect(src).toContain("const scripts = HEALTH_SCRIPTS;");
    });

    // The census is offline and costs <1 s, so it runs in the lane, admitted
    // by a diff that can move it (issue #4963) — never composed into
    // `check:all`/`check:pr`, which every diff pays whole.
    //
    // Scanned rather than enumerated: an enumeration covers `check:all:inner`
    // and misses the `check:all` that wraps it, and stops covering anything
    // renamed or newly composed (review of PR #3878).
    it("no other package script invokes it", () => {
        const callers = Object.entries(pkg.scripts)
            .filter(
                ([name, body]) =>
                    name !== "check:gaps" && body.includes("check:gaps")
            )
            .map(([name]) => name);
        expect(callers).toEqual([]);
    });
});

describe("emittedOps", () => {
    it("counts ready AND quarantine — quarantine gates the card, not the grammar", () => {
        const emitted = emittedOps([
            { state: "ready", opsUsed: ["draw"] },
            { state: "quarantine", opsUsed: ["mill", "draw"] },
            { state: "unparsed", opsUsed: ["exile"] },
            { state: "unparsed" },
        ]);
        expect([...emitted].sort()).toEqual(["draw", "mill"]);
    });

    // Reading it as "emits nothing" would be a false `missing`, and a
    // `missing` has no legal exit — a row may not be added.
    it("refuses a compiled row with no opsUsed rather than reading it as empty", () => {
        expect(() =>
            emittedOps([{ name: "Black Lotus", state: "ready" }])
        ).toThrow(/Black Lotus is `ready` with no `opsUsed`/);
    });
});

describe("auditOpCensus", () => {
    it("passes when every never-emitted Op has a row", () => {
        const result = auditOpCensus({
            implemented: ["draw", "mill", "exile"],
            emitted: new Set(["draw"]),
            allowlist: list("mill", "exile"),
            baseline: list("mill", "exile"),
        });
        expect(result.violations).toEqual([]);
        expect(result.baselineChecked).toBe(true);
        expect(result.emittedCount).toBe(1);
        expect(result.allowlistedCount).toBe(2);
    });

    it("reds an emitted-by-nothing Op with no row", () => {
        const result = auditOpCensus({
            implemented: ["draw", "mill"],
            emitted: new Set(["draw"]),
            allowlist: list(),
            baseline: list(),
        });
        expect(kinds(result.violations)).toEqual(["missing:mill"]);
    });

    it("reds a row whose Op is now emitted — the rule landed, the row goes", () => {
        const result = auditOpCensus({
            implemented: ["draw", "mill"],
            emitted: new Set(["draw", "mill"]),
            allowlist: list("mill"),
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["covered:mill"]);
    });

    it("reds a row for an Op the registry does not implement", () => {
        const result = auditOpCensus({
            implemented: ["draw"],
            emitted: new Set(["draw"]),
            allowlist: list("getEnergy"),
            baseline: list("getEnergy"),
        });
        expect(kinds(result.violations)).toEqual(["unknown-op:getEnergy"]);
    });

    it("reds a duplicated row", () => {
        const result = auditOpCensus({
            implemented: ["mill"],
            emitted: new Set(),
            allowlist: { ops: [row("mill"), row("mill")] },
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["duplicate:mill"]);
    });

    it("reds a row whose key is not the stable key `gaps:sync` shares", () => {
        const result = auditOpCensus({
            implemented: ["mill"],
            emitted: new Set(),
            allowlist: { ops: [{ key: "mill", op: "mill", issue: 3820 }] },
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["malformed:mill"]);
        expect(result.violations[0]).toMatchObject({
            detail: expect.stringContaining("(op) › mill"),
        });
    });

    it("reds a row with no issue number", () => {
        const result = auditOpCensus({
            implemented: ["mill"],
            emitted: new Set(),
            allowlist: {
                ops: [{ key: opGapKey("mill"), op: "mill", issue: 0 }],
            },
            baseline: list("mill"),
        });
        expect(kinds(result.violations)).toEqual(["malformed:mill"]);
    });

    // A new Op is DOUBLY refused: it has no row (missing) and may not gain one
    // (grown). ADR 0137's single exit is the grammar rule that emits it.
    it("reds a row the previous revision did not have — the allowlist only shrinks", () => {
        const result = auditOpCensus({
            implemented: ["draw", "explore"],
            emitted: new Set(["draw"]),
            allowlist: list("explore"),
            baseline: list(),
        });
        expect(kinds(result.violations)).toEqual(["grown:explore"]);
    });

    it("leaves the shrink check unrun when there is no previous revision", () => {
        const result = auditOpCensus({
            implemented: ["draw", "explore"],
            emitted: new Set(["draw"]),
            allowlist: list("explore"),
            baseline: null,
        });
        expect(result.violations).toEqual([]);
        expect(result.baselineChecked).toBe(false);
    });

    it("orders violations deterministically", () => {
        const input = {
            implemented: ["draw", "mill", "exile", "scryReorder"],
            emitted: new Set(["draw", "mill"]),
            allowlist: list("mill", "scryReorder"),
            baseline: list("mill"),
        };
        const once = kinds(auditOpCensus(input).violations);
        expect(once).toEqual(kinds(auditOpCensus(input).violations));
        expect(once).toEqual([
            "covered:mill",
            "missing:exile",
            "grown:scryReorder",
        ]);
    });
});

describe("the committed allowlist", () => {
    // Shape only — never the census itself (see this file's header).
    const allowlist = parseAllowlist(
        fs.readFileSync(path.join(ROOT, "data/grammar-gaps.json"), "utf8")
    );

    it("carries Op, issue and the stable key on every row", () => {
        expect(allowlist.ops.length).toBeGreaterThan(0);
        for (const r of allowlist.ops) {
            expect(r.key).toBe(opGapKey(r.op));
            expect(Number.isInteger(r.issue) && r.issue > 0).toBe(true);
        }
    });

    it("holds one row per Op, sorted", () => {
        const ops = allowlist.ops.map((r) => r.op);
        expect(new Set(ops).size).toBe(ops.length);
        expect(ops).toEqual([...ops].sort());
    });
});

describe("baselineAllowlist", () => {
    /**
     * A throwaway repo whose `data/grammar-gaps.json` has the given revisions,
     * oldest first. Returns its path with HEAD at the last one.
     */
    function repoWith(...revisions: Allowlist[]): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaps-baseline-"));
        const git = (...args: string[]) => {
            const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
            if (r.status !== 0)
                throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
            return r.stdout.trim();
        };
        git("init", "-q", "-b", "staging");
        git("config", "user.email", "t@t");
        git("config", "user.name", "t");
        fs.mkdirSync(path.join(dir, "data"));
        for (const [i, rev] of revisions.entries()) {
            fs.writeFileSync(
                path.join(dir, "data/grammar-gaps.json"),
                JSON.stringify(rev, null, 4) + "\n"
            );
            git("add", "-A");
            git("commit", "-q", "-m", `rev ${i}`);
        }
        return dir;
    }

    it("is the file's own previous revision", () => {
        const dir = repoWith(list("mill", "exile"), list("mill"));
        expect(baselineAllowlist(dir)?.ops.map((r) => r.op)).toEqual([
            "mill",
            "exile",
        ]);
    });

    /**
     * The regression this test exists for. `check:gaps` runs ONLY in `health`,
     * and `health` gates a `git worktree add --detach <base tip>`. The first
     * implementation read the allowlist at `merge-base(HEAD, origin/<base>)`,
     * which in that worktree IS HEAD — so the baseline was the very file being
     * audited, `grown` could never fire, and shrink-only was unenforced
     * everywhere it ran (review of PR #3878).
     */
    it("survives a detached HEAD sitting exactly on the base branch tip", () => {
        const dir = repoWith(list("mill"), list("mill", "explore"));
        const git = (...args: string[]) =>
            spawnSync("git", args, { cwd: dir, encoding: "utf8" });
        git("update-ref", "refs/remotes/origin/staging", "HEAD");
        git("checkout", "-q", "--detach", "HEAD");
        expect(git("merge-base", "HEAD", "origin/staging").stdout.trim()).toBe(
            git("rev-parse", "HEAD").stdout.trim()
        );

        const baseline = baselineAllowlist(dir);
        expect(baseline?.ops.map((r) => r.op)).toEqual(["mill"]);
        const result = auditOpCensus({
            implemented: ["mill", "explore"],
            emitted: new Set(),
            allowlist: list("mill", "explore"),
            baseline,
        });
        expect(kinds(result.violations)).toEqual(["grown:explore"]);
    });

    it("has none at the commit that introduces the file", () => {
        expect(baselineAllowlist(repoWith(list("mill")))).toBeNull();
    });

    it("has none outside a git repository", () => {
        expect(
            baselineAllowlist(fs.mkdtempSync(path.join(os.tmpdir(), "nogit-")))
        ).toBeNull();
    });
});

describe("render", () => {
    const green = (baseline: Allowlist | null) =>
        render(
            auditOpCensus({
                implemented: ["draw"],
                emitted: new Set(["draw"]),
                allowlist: { ops: [] },
                baseline,
            })
        );

    it("says so when the shrink check did not run", () => {
        expect(green(null)).toContain("shrink check SKIPPED");
        expect(green({ ops: [] })).toContain("shrink verified");
    });

    // A red that omits it would let a reader assume `grown` was evaluated.
    it("says so on the violation path too", () => {
        const red = render(
            auditOpCensus({
                implemented: ["draw", "mill"],
                emitted: new Set(["draw"]),
                allowlist: { ops: [] },
                baseline: null,
            })
        );
        expect(red).toContain("shrink check SKIPPED");
        expect(red).toContain("do not add a row");
        expect(red).toContain("/new-op");
    });
});

describe("in-scope Bot Gaps are filed (issue #4061)", () => {
    const KEYS = [
        "never-chosen › Enchantment › destroy",
        "position-unmodelled › Instant target:spell",
    ];

    it("reports an in-scope Bot Gap key with no `bot` claim row as pending, never red (issue #4944)", () => {
        expect(
            unclaimedBotGaps(KEYS, [
                { kind: "bot", key: KEYS[0]!, issue: 4300 },
            ])
        ).toEqual([KEYS[1]]);
        expect(renderBotGaps(2, [KEYS[1]!])).toMatch(
            /^… gaps: 1 of 2 in-scope Bot Gap key\(s\) have no `bot` claim row yet — pending, not red/
        );
        const census = auditOpCensus({
            implemented: [],
            emitted: new Set(),
            allowlist: { ops: [] },
            baseline: null,
        });
        expect(gapsVerdict(census, 2, [KEYS[1]!], []).ok).toBe(true);
    });

    it("a claim of ANOTHER kind on the same key does not count", () => {
        expect(
            unclaimedBotGaps(KEYS, [
                { kind: "scenario", key: KEYS[0]!, issue: 4300 },
                { kind: "bot", key: KEYS[1]!, issue: 4301 },
            ])
        ).toEqual([KEYS[0]]);
    });

    it("is green when every in-scope key is claimed", () => {
        expect(
            unclaimedBotGaps(
                KEYS,
                KEYS.map((key, i) => ({
                    kind: "bot" as const,
                    key,
                    issue: 4300 + i,
                }))
            )
        ).toEqual([]);
        expect(renderBotGaps(2, [])).toMatch(/^✓ gaps: 2 Bot Gap key/);
    });
});

describe("hand-tail markers name their claim (issue #4514)", () => {
    /** One card, its doc paragraph carrying `hand-tail:` markers — scanned
     *  through the real scanner, so attachment is the production rule. */
    const source = (name: string, ...issues: number[]) => [
        ...issues.map((n) => `// hand-tail: some fragment (#${n})`),
        `export const Card${issues.length} = defineCard(() => ({`,
        `    name: "${name}",`,
        "}));",
        "",
    ];
    const markers = (...cards: string[][]) =>
        scanCompilerGapMarkers(cards.flat());
    const claim = (key: string, issue: number) => ({
        kind: "hand-tail" as const,
        key,
        issue,
    });
    const census = auditOpCensus({
        implemented: [],
        emitted: new Set(),
        allowlist: { ops: [] },
        baseline: null,
    });

    it("a marker naming its claim's issue is no finding", () => {
        const found = handTailClaimMismatches(
            markers(source("Arena of Glory", 4338, 4338)),
            [claim("Arena of Glory", 4338)]
        );
        expect(found).toEqual([]);
        expect(gapsVerdict(census, 0, [], found).ok).toBe(true);
    });

    it("a marker naming another issue is ONE finding naming card, marker and claim, and reds", () => {
        const found = handTailClaimMismatches(
            markers(
                source("Myr Battlesphere", 4195, 4195),
                source("Arena of Glory", 4338)
            ),
            [claim("Myr Battlesphere", 4321), claim("Arena of Glory", 4338)]
        );
        expect(found).toEqual([
            { card: "Myr Battlesphere", markerIssue: 4195, claimIssue: 4321 },
        ]);
        const verdict = gapsVerdict(census, 0, [], found);
        expect(verdict.ok).toBe(false);
        expect(renderHandTailClaims(found)).toContain(
            "Myr Battlesphere: marker names #4195, claim is #4321"
        );
        expect(verdict.out).toContain("✗ gaps: 1 `hand-tail:` marker(s)");
    });

    it("the remedy offered is only the one that clears the check (issue #4774)", () => {
        // Closing the claim issue never retires its claim row, and this check
        // is offline: a render offering "close the claim" sends the author to
        // a remedy that leaves the tip red (PR #4760, Emblazoned Golem).
        const text = renderHandTailClaims([
            { card: "Myr Battlesphere", markerIssue: 4195, claimIssue: 4321 },
        ]);
        expect(text).toContain("Re-point the marker to the claim's issue");
        expect(text).not.toMatch(/\bor close the claim\b/i);
        expect(text).toContain("Closing the claim issue alone");
    });

    it("a hand-tail card with no hand-tail claim row is no finding", () => {
        const found = handTailClaimMismatches(
            markers(source("Arena of Glory", 4338)),
            [
                claim("Myr Battlesphere", 4321),
                { kind: "bot", key: "Arena of Glory", issue: 4000 },
            ]
        );
        expect(found).toEqual([]);
        expect(renderHandTailClaims(found)).toMatch(/^✓ gaps: every/);
    });
});

describe("handTailCardMatch (ADR 0146, issue #4682)", () => {
    it("reads set and colour off the card's own set file", () => {
        expect(
            handTailCardMatch("convex/cards/sets/inv/blue.cards.ts")
        ).toEqual({
            set: "inv",
            colour: "blue",
        });
    });

    it("is undefined for a legacy flat set file with no colour segment", () => {
        expect(handTailCardMatch("convex/cards/sets/inv.ts")).toBeUndefined();
    });

    it("is undefined for an unrecognised colour segment", () => {
        expect(
            handTailCardMatch("convex/cards/sets/inv/notacolour.ts")
        ).toBeUndefined();
    });
});

describe("liveClusterKeys (ADR 0146, issue #4682)", () => {
    const fragment = (text: string): FragmentRow => ({
        text,
        reason: "no slot consumed the line",
        cards: 1,
    });
    const quarantined = (
        oracleId: string,
        kind: string,
        detail: string
    ): CardRow => ({
        oracleId,
        name: oracleId,
        state: "quarantine",
        opsUsed: [],
        quarantineReasons: [{ kind, detail }] as CardRow["quarantineReasons"],
    });
    const handTailMarker = (card: string, file: string, issue = 4338) =>
        scanCompilerGapMarkers([
            `// hand-tail: some fragment (#${issue})`,
            `export const Only = defineCard(() => ({`,
            `    name: "${card}",`,
            "}));",
        ]).map((m) => ({ ...m, file }));

    it("unions the op census with the fragment-level Grammar Gaps", () => {
        const lock = { cards: [], fragments: [fragment("a one-off line")] };
        const keys = liveClusterKeys(
            lock,
            ["mill", "draw"],
            new Set(["draw"]),
            null,
            []
        );
        expect(
            keys.filter((k) => k.kind === "grammar").map((k) => k.key)
        ).toEqual(expect.arrayContaining([opGapKey("mill")]));
        expect(keys.filter((k) => k.kind === "grammar")).toHaveLength(2);
    });

    it("does not count an emitted implemented Op as live", () => {
        const lock = { cards: [], fragments: [] };
        const keys = liveClusterKeys(
            lock,
            ["draw"],
            new Set(["draw"]),
            null,
            []
        );
        expect(keys).toEqual([]);
    });

    it("reads mechanic and scenario keys off quarantine reasons", () => {
        const lock = {
            cards: [
                quarantined("c1", "planned-op", "c1 (uuid): some op"),
                quarantined("c2", "smoke-skip", "some shape"),
            ],
            fragments: [],
        };
        const keys = liveClusterKeys(lock, [], new Set(), null, []);
        expect(keys.map((k) => k.kind).sort()).toEqual([
            "mechanic",
            "scenario",
        ]);
    });

    // The regression this test exists for (review of issue #4682's PR): the
    // first implementation threaded `unclaimedBotGaps`'s RANKED-scoped key
    // list here, which reads a Bot Gap as "gone" the moment its cards leave
    // ranked scope — exactly the false conclusion `computedGapKeys`'s own
    // docstring says a whole-corpus census must not draw. A card whose Target
    // was never ranked (never in scope) still owes a `bot` live key.
    it("reads WHOLE-CORPUS bot keys, never the ranked-scoped filing list", () => {
        const unranked: CardRow = {
            oracleId: "c1",
            name: "Unranked Frozen Card",
            state: "quarantine",
            opsUsed: [],
            botReach: "frozen",
            botGap: "never-chosen › Enchantment › destroy",
        };
        const keys = liveClusterKeys(
            { cards: [unranked], fragments: [] },
            [],
            new Set(),
            new Map(),
            []
        );
        expect(keys).toEqual([
            { kind: "bot", key: "never-chosen › Enchantment › destroy" },
        ]);
    });

    it("reports no `bot` key at all when there is no Bot Reach Findings report", () => {
        const unranked: CardRow = {
            oracleId: "c1",
            name: "Unranked Frozen Card",
            state: "quarantine",
            opsUsed: [],
            botReach: "frozen",
            botGap: "never-chosen › Enchantment › destroy",
        };
        const keys = liveClusterKeys(
            { cards: [unranked], fragments: [] },
            [],
            new Set(),
            null,
            []
        );
        expect(keys.filter((k) => k.kind === "bot")).toEqual([]);
    });

    it("counts only kind `hand-tail` exempting markers, carrying the set file's card match", () => {
        const markers = [
            ...handTailMarker(
                "Arena of Glory",
                "convex/cards/sets/inv/blue.cards.ts"
            ),
            ...scanCompilerGapMarkers([
                "// compiler-gap: some fragment (#1)",
                `export const Only = defineCard(() => ({`,
                '    name: "Some Other Card",',
                "}));",
            ]).map((m) => ({
                ...m,
                file: "convex/cards/sets/inv/red.cards.ts",
            })),
        ];
        const keys = liveClusterKeys(
            { cards: [], fragments: [] },
            [],
            new Set(),
            null,
            markers
        );
        expect(keys).toEqual([
            {
                kind: "hand-tail",
                key: "Arena of Glory",
                card: { set: "inv", colour: "blue" },
            },
        ]);
    });

    it("leaves `card` undefined for a hand-tail marker in a legacy flat set file", () => {
        const keys = liveClusterKeys(
            { cards: [], fragments: [] },
            [],
            new Set(),
            null,
            handTailMarker("Arena of Glory", "convex/cards/sets/inv.ts")
        );
        expect(keys).toEqual([
            { kind: "hand-tail", key: "Arena of Glory", card: undefined },
        ]);
    });
});

describe("censusClusters (ADR 0146, issue #4682)", () => {
    const cluster = (
        issue: number,
        kind: ClusterRow["kind"],
        match: readonly string[]
    ): ClusterRow => ({ issue, kind, match });

    it("flags a live key two signatures match, the lowest issue winning", () => {
        const liveKeys: LiveGapKey[] = [{ kind: "bot", key: "cause › form" }];
        const { ambiguities } = censusClusters(
            liveKeys,
            [],
            [
                cluster(101, "bot", ["cause › form"]),
                cluster(100, "bot", ["cause › *"]),
            ]
        );
        expect(ambiguities).toEqual([
            { kind: "bot", key: "cause › form", issues: [100, 101] },
        ]);
    });

    it("is no ambiguity when only one signature matches", () => {
        const liveKeys: LiveGapKey[] = [{ kind: "bot", key: "cause › form" }];
        const { ambiguities } = censusClusters(
            liveKeys,
            [],
            [cluster(100, "bot", ["cause › *"])]
        );
        expect(ambiguities).toEqual([]);
    });

    it("counts a live claimed key no signature matches as a residual single of its kind", () => {
        const liveKeys: LiveGapKey[] = [
            { kind: "grammar", key: opGapKey("mill") },
        ];
        const { residualSingles } = censusClusters(
            liveKeys,
            [{ kind: "grammar", key: opGapKey("mill"), issue: 200 }],
            []
        );
        expect(residualSingles).toEqual([
            { kind: "grammar", count: 1 },
            { kind: "mechanic", count: 0 },
            { kind: "scenario", count: 0 },
            { kind: "bot", count: 0 },
            { kind: "hand-tail", count: 0 },
        ]);
    });

    it("never counts a claim whose key this run computes no live gap for", () => {
        const { residualSingles } = censusClusters(
            [],
            [{ kind: "scenario", key: "dead › key", issue: 300 }],
            []
        );
        expect(residualSingles.find((r) => r.kind === "scenario")?.count).toBe(
            0
        );
    });

    it("does not count a residual single once a signature matches it", () => {
        const liveKeys: LiveGapKey[] = [
            { kind: "grammar", key: opGapKey("mill") },
        ];
        const { residualSingles } = censusClusters(
            liveKeys,
            [{ kind: "grammar", key: opGapKey("mill"), issue: 200 }],
            [cluster(201, "grammar", ["(op) › *"])]
        );
        expect(residualSingles.find((r) => r.kind === "grammar")?.count).toBe(
            0
        );
    });

    it("flags a Cluster Signature matching no live key as dead", () => {
        const { deadSignatures } = censusClusters(
            [{ kind: "bot", key: "cause › form" }],
            [],
            [cluster(555, "mechanic", ["nonexistent › *"])]
        );
        expect(deadSignatures).toEqual([555]);
    });

    it("a signature matching a live key is not dead", () => {
        const { deadSignatures } = censusClusters(
            [{ kind: "bot", key: "cause › form" }],
            [],
            [cluster(100, "bot", ["cause › *"])]
        );
        expect(deadSignatures).toEqual([]);
    });
});

describe("renderClusterCensus (ADR 0146, issue #4682)", () => {
    it("prints clean when there is nothing to report", () => {
        expect(
            renderClusterCensus({
                ambiguities: [],
                residualSingles: [
                    { kind: "grammar", count: 0 },
                    { kind: "mechanic", count: 0 },
                    { kind: "scenario", count: 0 },
                    { kind: "bot", count: 0 },
                    { kind: "hand-tail", count: 0 },
                ],
                deadSignatures: [],
            })
        ).toMatch(/^✓ gaps: Gap Cluster census clean/);
    });

    it("never prints ✗ — informational, never red", () => {
        const out = renderClusterCensus({
            ambiguities: [
                { kind: "bot", key: "cause › form", issues: [100, 101] },
            ],
            residualSingles: [
                { kind: "grammar", count: 3 },
                { kind: "mechanic", count: 0 },
                { kind: "scenario", count: 0 },
                { kind: "bot", count: 0 },
                { kind: "hand-tail", count: 0 },
            ],
            deadSignatures: [555],
        });
        expect(out).not.toContain("✗");
        expect(out).toContain("cause › form: #100, #101 — #100 would win");
        expect(out).toContain("grammar 3");
        expect(out).toContain("#555");
    });
});

describe("Bot Gaps filed per day census (issue #4944)", () => {
    const row = (key: string, issue: number) => [
        "+        {",
        '+            "kind": "bot",',
        `+            "key": "${key}",`,
        `+            "issue": ${issue}`,
        "+        },",
    ];

    it("counts the `bot` claim rows each day's commits added", () => {
        const log = [
            "@2026-09-30",
            "diff --git a/data/grammar-gaps.json b/data/grammar-gaps.json",
            ...row("a", 1),
            ...row("b", 2),
            "",
            "@2026-09-29",
            ...row("c", 3),
            '+            "kind": "scenario",',
            '-            "kind": "bot",',
            "",
        ].join("\n");
        expect([...botGapsFiledPerDay(log)]).toEqual([
            ["2026-09-29", 1],
            ["2026-09-30", 2],
        ]);
        expect(renderBotGapCensus(botGapsFiledPerDay(log))).toBe(
            "census: Bot Gaps filed per day (last 7 days): 2026-09-29 1, 2026-09-30 2 — 3 total"
        );
    });

    it("does not count a Cluster Cut row (`kind` then `issue`)", () => {
        const log = [
            "@2026-09-30",
            "+        {",
            '+            "kind": "bot",',
            '+            "issue": 4999',
            "+        },",
        ].join("\n");
        expect(botGapsFiledPerDay(log).size).toBe(0);
    });

    it("reads an empty window as none", () => {
        expect(renderBotGapCensus(botGapsFiledPerDay(""))).toMatch(/: none$/);
    });
});
