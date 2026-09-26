/**
 * `gaps:sync`'s pure planning (issue #3829, ADR 0137) — a stub `GapTracker`
 * proves create / update / idempotent-noop / closed-stays-closed and the
 * sub-issue cap with no network at all.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Allowlist } from "../check-gaps";
import { rankTargetBands } from "../lib/backlog-triage";
import {
    parseClusterRows,
    readTargetRegistry,
    type ClusterRow,
} from "../lib/targets";
import {
    applyUpdatedIssues,
    bandUmbrellaOf,
    BAND_UMBRELLAS,
    buildGrammarGapFilings,
    grammarGapTitle,
    LOWEST_RANKED_TARGET,
    parseUnlocks,
    PARTITIONED_KINDS,
    planMove,
    planUnlockEdges,
    renderUnlockBlockedBy,
    RETIRED_UMBRELLAS,
    syncUnlockEdges,
    umbrellaKey,
    withUnlockBlockers,
    KIND_FALLBACK,
    PRD_ISSUE,
    renderOpGapBody,
    SUB_ISSUE_CAP,
    clusterIssues,
    absorptionComment,
    closeAbsorbedSingles,
    syncGaps,
    issuesWorkedByPrs,
    syncAdoptedBlocks,
    ADOPTED_BLOCK_END,
    ADOPTED_BLOCK_START,
    keyMatchesGlob,
    matchCluster,
    raiseBandComment,
    renderAdoptedBlock,
    setFileColour,
    umbrellaBandRank,
    withAdoptedBlock,
    reHomeComment,
    type ClusterIssueState,
    type GapFiling,
    type GapTracker,
    type TrackedIssue,
    type TrackedIssueSummary,
    type UnlockSource,
} from "../lib/gap-issues";
import { claimId } from "../lib/targets";
import { parseDependencies } from "../lib/queue-plan";
import { gapOf, OP_LEVEL } from "../lib/grammar-gaps";
import { parseLockfile } from "../lib/oracle-lockfile";
import { isIssueNotFound } from "../gaps-sync";

const ADD_MANA_KEY = "(op) › addMana";

function allowlist(
    rows: { key: string; op: string; issue: number }[]
): Allowlist {
    return { ops: rows };
}

describe("buildGrammarGapFilings", () => {
    it("marks a row still on the PRD placeholder unfiled, any other issue filed", () => {
        const filings = buildGrammarGapFilings(
            allowlist([
                { key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE },
                { key: "(op) › draw", op: "draw", issue: 4001 },
            ])
        );
        // `currentIssue: null` IS "unfiled" now — the PRD placeholder is
        // translated once, here, so no later reader repeats the sentinel.
        expect(filings.map((f) => [f.key, f.currentIssue])).toEqual([
            [ADD_MANA_KEY, null],
            ["(op) › draw", 4001],
        ]);
        expect(filings[0]!.kind).toBe("grammar");
        expect(filings[0]!.fallbackParent).toBe(KIND_FALLBACK.grammar);
        expect(filings[0]!.title).toBe(grammarGapTitle(ADD_MANA_KEY));
        expect(filings[0]!.body(0)).toBe(
            renderOpGapBody("addMana", ADD_MANA_KEY)
        );
    });
});

describe("renderOpGapBody", () => {
    it("names the Op and its allowlist key, and prints no card count", () => {
        const body = renderOpGapBody("addMana", ADD_MANA_KEY);
        expect(body).toContain("`addMana`");
        expect(body).toContain(ADD_MANA_KEY);
        // The first version printed "Corpus: 0 unparsed card(s)" on all 87
        // issues — a figure that is zero by construction (next block).
        expect(body).not.toMatch(/\d+ unparsed card/);
    });
});

describe("an Op gap has no corpus attribution — the premise the body states", () => {
    it("no Fragment of the committed lockfile lands on an `(op) › …` key", () => {
        // STRUCTURAL guard, not a measurement of the compiler: `gapOf` keys a
        // fragment by its attribution slot, so an `(op) ›` key needs a slot
        // literally named `(op)`. Should one ever appear, the body's "no card
        // count here" is false and the counts are worth printing again.
        const lock = parseLockfile(
            readFileSync("data/oracle-compiled.json", "utf8")
        );
        const onOpKeys = lock.fragments.filter((f) =>
            gapOf(f).key.startsWith(`${OP_LEVEL} › `)
        );
        expect(lock.fragments.length).toBeGreaterThan(0);
        expect(onOpKeys.map((f) => f.text)).toEqual([]);
    });
});

// ── syncGaps against a stub tracker ─────────────────────────────────────

class StubTracker implements GapTracker {
    /** Per-issue adoption facts; an issue absent here reads open and free. */
    readonly states = new Map<number, ClusterIssueState>();
    readonly stateReads: number[] = [];
    readonly comments: Array<{ issue: number; body: string }> = [];

    clusterState(number: number): ClusterIssueState | null {
        this.stateReads.push(number);
        const issue = this.issues.get(number);
        if (issue === undefined) return null;
        return {
            ...(this.states.get(number) ?? {
                open: issue.state === "OPEN",
                inProgress: false,
                openPr: false,
            }),
            body: issue.body,
        };
    }

    private nextNumber = 5000;
    readonly issues = new Map<number, TrackedIssue>();
    readonly parents = new Map<number, number>();
    children = 0;
    createCalls = 0;
    updateCalls = 0;

    getIssue(number: number): TrackedIssue | null {
        const issue = this.issues.get(number);
        if (issue === undefined) return null;
        const parent = this.parents.get(number);
        return parent === undefined ? issue : { ...issue, parent };
    }

    setParent(child: number, parent: number): void {
        this.parents.set(child, parent);
    }

    createIssue(input: { body: string; parent: number }): number {
        this.createCalls += 1;
        const number = this.nextNumber++;
        this.issues.set(number, { state: "OPEN", body: input.body });
        this.parents.set(number, input.parent);
        this.children += 1;
        return number;
    }

    updateBody(number: number, body: string): void {
        this.updateCalls += 1;
        const existing = this.issues.get(number);
        if (existing === undefined) throw new Error(`no issue #${number}`);
        this.issues.set(number, { ...existing, body });
    }

    subIssueCount(): number {
        return this.children;
    }

    findSetUmbrella(): number | null {
        return null;
    }

    listOpen(): readonly TrackedIssueSummary[] {
        return [];
    }

    addLabel(): void {}

    comment(issue: number, body: string): void {
        this.comments.push({ issue, body });
    }

    readonly closed: Array<{ issue: number; body: string }> = [];

    close(issue: number, body: string): void {
        this.closed.push({ issue, body });
        const existing = this.issues.get(issue);
        if (existing === undefined) throw new Error(`no issue #${issue}`);
        this.issues.set(issue, { ...existing, state: "CLOSED" });
    }

    listUnlockSources(): readonly UnlockSource[] {
        return this.unlockSources;
    }

    unlockSources: UnlockSource[] = [];
    readonly edges = new Map<number, number[]>();

    blockedBy(issue: number): readonly number[] {
        return this.edges.get(issue) ?? [];
    }

    addBlockedBy(issue: number, blocker: number): void {
        const existing = this.edges.get(issue) ?? [];
        // The real tracker reads the edge back and throws when the write did
        // not take; a stub that silently accepted a duplicate would hide the
        // very double-write `syncUnlockEdges` exists to avoid.
        if (existing.includes(blocker))
            throw new Error(
                `issue #${issue} is already blocked by #${blocker}`
            );
        this.edges.set(issue, [...existing, blocker]);
    }
}

function filing(over: Partial<GapFiling> = {}): GapFiling {
    return {
        kind: "grammar",
        key: ADD_MANA_KEY,
        currentIssue: null,
        title: grammarGapTitle(ADD_MANA_KEY),
        labels: LABELS,
        parentSetCode: null,
        fallbackParent: KIND_FALLBACK.grammar,
        body: () => "body v1",
        ...over,
    };
}

const LABELS = ["ready-for-agent"];
const ADD_MANA_ROW = claimId("grammar", ADD_MANA_KEY);

describe("syncGaps", () => {
    it("creates an unfiled gap under the given parent and reports the new number", () => {
        const tracker = new StubTracker();
        const result = syncGaps([filing()], tracker);
        expect(result.actions).toEqual([
            {
                action: "create",
                kind: "grammar",
                key: ADD_MANA_KEY,
                issue: 5000,
                parent: KIND_FALLBACK.grammar,
            },
        ]);
        expect(result.updatedRows.get(ADD_MANA_ROW)).toBe(5000);
        expect(tracker.parents.get(5000)).toBe(KIND_FALLBACK.grammar);
    });

    it("a second run against the tracker it just wrote is a no-op — idempotent", () => {
        const tracker = new StubTracker();
        const first = syncGaps([filing()], tracker);
        const issue = first.updatedRows.get(ADD_MANA_ROW)!;
        const second = syncGaps([filing({ currentIssue: issue })], tracker);
        expect(second.actions).toEqual([
            { action: "noop", kind: "grammar", key: ADD_MANA_KEY, issue },
        ]);
        expect(second.updatedRows.size).toBe(0);
        expect(tracker.createCalls).toBe(1);
        expect(tracker.updateCalls).toBe(0);
    });

    it("rewrites an open issue whose body changed, keeping its number", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "stale" });
        tracker.parents.set(4001, KIND_FALLBACK.grammar);
        const result = syncGaps(
            [filing({ currentIssue: 4001, body: () => "fresh" })],
            tracker
        );
        expect(result.actions).toEqual([
            {
                action: "update",
                kind: "grammar",
                key: ADD_MANA_KEY,
                issue: 4001,
            },
        ]);
        expect(result.updatedRows.size).toBe(0);
        expect(tracker.getIssue(4001)?.body).toBe("fresh");
    });

    it("leaves a CLOSED issue alone — a gap closes through its PR (ADR 0137)", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "CLOSED", body: "old" });
        const result = syncGaps(
            [filing({ currentIssue: 4001, body: () => "new" })],
            tracker
        );
        expect(result.actions).toEqual([
            {
                action: "skip-closed",
                kind: "grammar",
                key: ADD_MANA_KEY,
                issue: 4001,
            },
        ]);
        expect(tracker.getIssue(4001)).toEqual({
            state: "CLOSED",
            body: "old",
        });
    });

    it("never rewrites nor moves a Grammar Cluster — one issue claiming several gaps", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "cluster, by hand" });
        tracker.parents.set(4001, 4092);
        const result = syncGaps(
            [
                filing({ currentIssue: 4001, body: () => "addMana text" }),
                filing({
                    key: "(op) › draw",
                    currentIssue: 4001,
                    body: () => "draw text",
                }),
            ],
            tracker,
            undefined,
            new Set([4001])
        );
        expect(result.actions.map((a) => a.action)).toEqual([
            "cluster",
            "cluster",
        ]);
        expect(result.moves).toEqual([]);
        expect(tracker.updateCalls).toBe(0);
        expect(tracker.getIssue(4001)?.body).toBe("cluster, by hand");
        expect(tracker.parents.get(4001)).toBe(4092);
    });

    it("a half-done cluster — one member's gap closed, so it files nothing — is still left alone", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "cluster, by hand" });
        tracker.parents.set(4001, 4092);
        const rows = allowlist([
            { key: ADD_MANA_KEY, op: "addMana", issue: 4001 },
        ]);
        const withClaim: Allowlist = {
            ...rows,
            claims: [
                {
                    kind: "grammar",
                    key: "spell › effect clause › X",
                    issue: 4001,
                },
            ],
        };
        const result = syncGaps(
            [filing({ currentIssue: 4001, body: () => "addMana text" })],
            tracker,
            undefined,
            clusterIssues(withClaim)
        );
        expect(result.actions.map((a) => a.action)).toEqual(["cluster"]);
        expect(tracker.getIssue(4001)?.body).toBe("cluster, by hand");
        expect(tracker.parents.get(4001)).toBe(4092);
    });

    it("clusterIssues counts allowlist rows — two rows on one issue, never the PRD placeholder", () => {
        const rows: Allowlist = {
            ops: [
                { key: ADD_MANA_KEY, op: "addMana", issue: 4001 },
                { key: "(op) › draw", op: "draw", issue: PRD_ISSUE },
                { key: "(op) › mill", op: "mill", issue: PRD_ISSUE },
                { key: "(op) › exile", op: "exile", issue: 4002 },
            ],
            claims: [
                {
                    kind: "grammar",
                    key: "static › static clause › Y",
                    issue: 4001,
                },
            ],
        };
        expect([...clusterIssues(rows)]).toEqual([4001]);
    });

    it("a gap gone from the allowlist is never passed in — its issue stays open", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "still tracked" });
        expect(syncGaps([], tracker).actions).toEqual([]);
        expect(tracker.getIssue(4001)?.state).toBe("OPEN");
    });

    it("recreates when the filed number resolves to nothing", () => {
        const tracker = new StubTracker();
        const result = syncGaps([filing({ currentIssue: 9999 })], tracker);
        expect(result.actions[0]!.action).toBe("create");
        expect(result.updatedRows.get(ADD_MANA_ROW)).toBe(5000);
    });

    it("refuses BEFORE any write when the creates would pass GitHub's sub-issue cap", () => {
        // 87 Op gaps filed under PRD #3820 filled it to 100; the last 9 were
        // created and left unparented. The refusal must come first.
        const tracker = new StubTracker();
        tracker.children = SUB_ISSUE_CAP - 1;
        const two = [filing(), filing({ key: "(op) › draw" })];
        expect(() => syncGaps(two, tracker)).toThrow(
            /cap of 100 — nothing was filed/
        );
        expect(tracker.createCalls).toBe(0);
    });

    it("files right up to the cap", () => {
        const tracker = new StubTracker();
        tracker.children = SUB_ISSUE_CAP - 1;
        syncGaps([filing()], tracker);
        expect(tracker.createCalls).toBe(1);
    });

    it("asks for the child count only when something will be created", () => {
        const tracker = new StubTracker();
        tracker.children = SUB_ISSUE_CAP;
        tracker.issues.set(4001, { state: "OPEN", body: "body v1" });
        // Already home — an issue with no parent would be MOVED, which asks.
        tracker.parents.set(4001, KIND_FALLBACK.grammar);
        const result = syncGaps([filing({ currentIssue: 4001 })], tracker);
        expect(result.actions[0]!.action).toBe("noop");
    });
});

describe("applyUpdatedIssues", () => {
    it("rewrites only the rows named in `updatedRows`", () => {
        const before = allowlist([
            { key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE },
            { key: "(op) › draw", op: "draw", issue: PRD_ISSUE },
        ]);
        const after = applyUpdatedIssues(
            before,
            new Map([[ADD_MANA_ROW, 5000]])
        );
        expect(after.ops).toEqual([
            { key: ADD_MANA_KEY, op: "addMana", issue: 5000 },
            { key: "(op) › draw", op: "draw", issue: PRD_ISSUE },
        ]);
    });

    it("returns the SAME object when nothing changed", () => {
        const before = allowlist([
            { key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE },
        ]);
        expect(applyUpdatedIssues(before, new Map())).toBe(before);
    });
});

describe("the committed allowlist is fully filed", () => {
    it("no row still points at the PRD placeholder", () => {
        const committed = JSON.parse(
            readFileSync("data/grammar-gaps.json", "utf8")
        ) as Allowlist;
        expect(
            committed.ops.filter((r) => r.issue === PRD_ISSUE).map((r) => r.op)
        ).toEqual([]);
    });
});

describe("isIssueNotFound — only a missing issue reads as gone", () => {
    // Anything else read as null makes `syncGaps` file a duplicate and
    // orphan the real issue (review of the fix for issue #3829).
    it("recognises gh's not-found error", () => {
        const err = Object.assign(new Error("Command failed: gh issue view"), {
            stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)\n",
        });
        expect(isIssueNotFound(err)).toBe(true);
    });

    it("does not mistake a network, rate-limit or auth failure for it", () => {
        for (const stderr of [
            "error connecting to api.github.com",
            "GraphQL: API rate limit exceeded for user ID 1.",
            "HTTP 401: Bad credentials",
        ]) {
            expect(
                isIssueNotFound(
                    Object.assign(new Error("Command failed"), { stderr })
                )
            ).toBe(false);
        }
    });
});

// ── `## Unlocks` — the engine issue a gap is blocked by (issue #4052) ─────

const CHANGELING_KEY =
    'planned-mechanic › keyword "changeling" is not implemented in the Mechanics Registry';

/** An engine issue body in the shape the template writes it. */
function engineBody(lines: readonly string[]): string {
    return [
        "## What to build",
        "",
        "Teach the compiler the clause form that lowers to `addMana`.",
        "",
        "## Unlocks",
        "",
        ...lines,
        "",
        "## Target files",
        "",
        "- `scripts/lib/oracle-grammar.ts`",
    ].join("\n");
}

/** The gap filings the declarations below resolve against. */
function gapFilings(): GapFiling[] {
    return [
        filing({ key: ADD_MANA_KEY, currentIssue: 4001 }),
        filing({
            kind: "mechanic",
            key: CHANGELING_KEY,
            currentIssue: 4002,
            title: `Quarantine (mechanic): ${CHANGELING_KEY}`,
            body: () => "quarantine body",
        }),
    ];
}

const KNOWN = new Set(gapFilings().map((f) => claimId(f.kind, f.key)));

describe("parseUnlocks", () => {
    it("reads nothing at all from a body with no section — absent, not empty", () => {
        expect(parseUnlocks("## What to build\n\n- a thing\n")).toBeNull();
    });

    it("auto-fills a bare Op name to its `(op) › …` grammar key", () => {
        const parsed = parseUnlocks(engineBody(["- addMana"]))!;
        expect(parsed.lines.map((l) => l.candidates)).toEqual([
            [claimId("grammar", ADD_MANA_KEY)],
        ]);
    });

    it("reads the `<kind>: <key>` form for a kind that is not grammar", () => {
        const parsed = parseUnlocks(
            engineBody([`- mechanic: ${CHANGELING_KEY}`])
        )!;
        expect(parsed.lines[0]!.candidates).toEqual([
            claimId("mechanic", CHANGELING_KEY),
        ]);
    });

    it("reads a bare Grammar Gap key, backticked as a body usually writes it", () => {
        const parsed = parseUnlocks(engineBody([`- \`${ADD_MANA_KEY}\``]))!;
        expect(parsed.lines[0]!.candidates).toEqual([
            claimId("grammar", ADD_MANA_KEY),
        ]);
    });

    it("offers the whole line BEFORE its `— why` truncation, so an em dash inside a key survives", () => {
        const withDash = "planned-mechanic › a detail — with an em dash";
        const parsed = parseUnlocks(
            engineBody([`- mechanic: ${withDash} — because the rule lands`])
        )!;
        expect(parsed.lines[0]!.candidates).toEqual([
            claimId("mechanic", `${withDash} — because the rule lands`),
            claimId("mechanic", withDash),
        ]);
    });

    it("refuses a prose line rather than guessing a key from it", () => {
        const parsed = parseUnlocks(
            engineBody([
                "- the Op the new rule emits",
                "This section unlocks addMana once the rule lands.",
            ])
        )!;
        expect(parsed.lines.map((l) => [l.raw, l.candidates.length])).toEqual([
            ["- the Op the new rule emits", 0],
            ["This section unlocks addMana once the rule lands.", 0],
        ]);
    });

    it("reads `None.` as declaring nothing, never as a key", () => {
        expect(parseUnlocks(engineBody(["None."]))!.lines).toEqual([]);
        expect(parseUnlocks(engineBody(["- None"]))!.lines).toEqual([]);
    });

    it("ignores a FENCED example of the section and reads the real one below it", () => {
        // The shape `docs/agents/issue-tracker.md` teaches, quoted in a body.
        // Read naively the scan locks onto the example, wires its sample key,
        // reports the closing fence as residue and never reaches the genuine
        // section — a silently dropped declaration.
        const body = [
            "## What to build",
            "",
            "Declare it like this:",
            "",
            "```markdown",
            "## Unlocks",
            "",
            "- addMana",
            "```",
            "",
            "## Unlocks",
            "",
            "- destroyAll",
            "",
            "## Target files",
        ].join("\n");
        const parsed = parseUnlocks(body)!;
        expect(parsed.lines).toEqual([
            {
                raw: "- destroyAll",
                candidates: [claimId("grammar", "(op) › destroyAll")],
            },
        ]);
    });

    it("ignores a fence INSIDE the section — an example is not a declaration", () => {
        const parsed = parseUnlocks(
            engineBody(["- addMana", "", "~~~", "- notAKey", "~~~"])
        )!;
        expect(parsed.lines).toEqual([
            {
                raw: "- addMana",
                candidates: [claimId("grammar", ADD_MANA_KEY)],
            },
        ]);
    });

    it("reads nothing from a body whose ONLY section is fenced", () => {
        const body = ["```md", "## Unlocks", "", "- addMana", "```"].join("\n");
        expect(parseUnlocks(body)).toBeNull();
    });

    it("stops at the next heading — a `## Target files` list is not a declaration", () => {
        const parsed = parseUnlocks(engineBody(["- addMana"]))!;
        expect(parsed.lines).toHaveLength(1);
    });
});

describe("planUnlockEdges", () => {
    it("resolves a declared key to the gap it names, keyed by the engine issue", () => {
        const { blockers, residue } = planUnlockEdges(
            [{ number: 4052, body: engineBody(["- addMana"]) }],
            KNOWN
        );
        expect([...blockers]).toEqual([
            [claimId("grammar", ADD_MANA_KEY), [4052]],
        ]);
        expect(residue).toEqual([]);
    });

    it("reports a key matching no filed gap as residue and wires nothing", () => {
        const { blockers, residue } = planUnlockEdges(
            [{ number: 4052, body: engineBody(["- addMaan"]) }],
            KNOWN
        );
        expect(blockers.size).toBe(0);
        expect(residue).toEqual([
            { issue: 4052, line: "- addMaan", reason: "no-such-gap" },
        ]);
    });

    it("reports an unreadable line as residue under its own reason", () => {
        const { residue } = planUnlockEdges(
            [{ number: 4052, body: engineBody(["- the Op the rule emits"]) }],
            KNOWN
        );
        expect(residue).toEqual([
            {
                issue: 4052,
                line: "- the Op the rule emits",
                reason: "unreadable",
            },
        ]);
    });

    it("an auto-filled Op name and the hand-written key plan the SAME edge", () => {
        const auto = planUnlockEdges(
            [{ number: 4052, body: engineBody(["- addMana"]) }],
            KNOWN
        );
        const byHand = planUnlockEdges(
            [
                {
                    number: 4052,
                    body: engineBody([`- grammar: ${ADD_MANA_KEY}`]),
                },
            ],
            KNOWN
        );
        expect([...byHand.blockers]).toEqual([...auto.blockers]);
    });

    it("merges two engine issues unlocking one gap, sorted and deduplicated", () => {
        const { blockers } = planUnlockEdges(
            [
                { number: 4060, body: engineBody(["- addMana", "- addMana"]) },
                { number: 4052, body: engineBody(["- addMana"]) },
            ],
            KNOWN
        );
        expect(blockers.get(claimId("grammar", ADD_MANA_KEY))).toEqual([
            4052, 4060,
        ]);
    });
});

describe("withUnlockBlockers", () => {
    it("leaves a filing nothing unlocks untouched, by reference", () => {
        const filings = gapFilings();
        const out = withUnlockBlockers(filings, new Map());
        expect(out[0]).toBe(filings[0]);
    });

    it("composes the section into the body, keeping the issue-number argument live", () => {
        const [out] = withUnlockBlockers(
            [filing({ body: (issue) => `filed as #${issue}` })],
            new Map([[claimId("grammar", ADD_MANA_KEY), [4052]]])
        );
        expect(out!.body(4001)).toBe(
            `filed as #4001\n\n${renderUnlockBlockedBy([4052])}`
        );
    });
});

describe("renderUnlockBlockedBy", () => {
    it("never writes the literal `## Unlocks`, which is the search term", () => {
        // Every gap issue carrying it would match `listUnlockSources`' search
        // and crowd the page the declarations are read from.
        expect(renderUnlockBlockedBy([4052])).not.toContain("## Unlocks");
        expect(parseUnlocks(renderUnlockBlockedBy([4052]))).toBeNull();
    });
});

describe("the two halves of the edge stay in parity", () => {
    it("the body section reads back as the dependency `queue:plan` defers on", () => {
        const [out] = withUnlockBlockers(
            [filing({ currentIssue: 4001 })],
            new Map([[claimId("grammar", ADD_MANA_KEY), [4052, 4060]]])
        );
        // `parseDependencies` is the planner's own reader, not a copy of it:
        // a section it cannot parse is a native-only edge, which gets picked
        // by the loop and bounced.
        expect(parseDependencies(out!.body(4001), 4001)).toEqual([4052, 4060]);
    });

    it("the native edge carries exactly what the body says", () => {
        const tracker = new StubTracker();
        const blockers = new Map([
            [claimId("grammar", ADD_MANA_KEY), [4052, 4060]],
        ]);
        const [out] = withUnlockBlockers(
            [filing({ currentIssue: 4001 })],
            blockers
        );
        syncUnlockEdges(
            blockers,
            new Map([[claimId("grammar", ADD_MANA_KEY), 4001]]),
            tracker
        );
        expect([...tracker.blockedBy(4001)].sort((a, b) => a - b)).toEqual(
            parseDependencies(out!.body(4001), 4001)
        );
    });
});

describe("syncUnlockEdges", () => {
    const blockers = new Map([[claimId("grammar", ADD_MANA_KEY), [4052]]]);
    const issueOf = new Map([[claimId("grammar", ADD_MANA_KEY), 4001]]);

    it("wires exactly one native edge, and a second run wires none", () => {
        const tracker = new StubTracker();
        expect(syncUnlockEdges(blockers, issueOf, tracker)).toEqual([
            {
                action: "link",
                blocked: 4001,
                blocker: 4052,
                claim: claimId("grammar", ADD_MANA_KEY),
            },
        ]);
        expect(tracker.blockedBy(4001)).toEqual([4052]);
        // The stub THROWS on a duplicate write, so a second `link` here would
        // be an error, not a silently doubled edge.
        expect(syncUnlockEdges(blockers, issueOf, tracker)).toEqual([
            {
                action: "noop",
                blocked: 4001,
                blocker: 4052,
                claim: claimId("grammar", ADD_MANA_KEY),
            },
        ]);
        expect(tracker.blockedBy(4001)).toEqual([4052]);
    });

    it("skips a gap this run filed no issue for — a closed one, say", () => {
        const tracker = new StubTracker();
        expect(syncUnlockEdges(blockers, new Map(), tracker)).toEqual([]);
        expect(tracker.edges.size).toBe(0);
    });

    it("never wires an issue to itself, and SAYS so instead of dropping it", () => {
        const tracker = new StubTracker();
        const self = new Map([[claimId("grammar", ADD_MANA_KEY), 4052]]);
        // A declaration that wires nothing and prints nothing is exactly the
        // silent drop the residue pass exists to close.
        expect(syncUnlockEdges(blockers, self, tracker)).toEqual([
            {
                action: "skip-self",
                blocked: 4052,
                blocker: 4052,
                claim: claimId("grammar", ADD_MANA_KEY),
            },
        ]);
        expect(tracker.edges.size).toBe(0);
    });
});

describe("the unlocked body is idempotent under syncGaps", () => {
    it("writes the section once and leaves it alone on the next run", () => {
        const tracker = new StubTracker();
        const blockers = new Map([[claimId("grammar", ADD_MANA_KEY), [4052]]]);
        const first = withUnlockBlockers([filing()], blockers);
        const created = syncGaps(first, tracker);
        const issue = created.updatedRows.get(ADD_MANA_ROW)!;
        expect(tracker.issues.get(issue)!.body).toContain("## Blocked by");
        tracker.updateCalls = 0;
        syncGaps(
            withUnlockBlockers([filing({ currentIssue: issue })], blockers),
            tracker
        );
        expect(tracker.updateCalls).toBe(0);
    });
});

// ── Target-keyed umbrellas (issue #4211, ADR 0143) ───────────────────────

describe("BAND_UMBRELLAS is keyed by Target, not by band letter (issue #4211)", () => {
    const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    /** The Targets that lend a band today, in rank order. */
    const RANKED = [
        ...rankTargetBands(
            readTargetRegistry(REPO_ROOT).targets,
            new Set()
        ).keys(),
    ];
    const PARTITIONED = ["grammar", "mechanic", "bot", "hand-tail"] as const;
    const FAMILIES = Object.keys(BAND_UMBRELLAS) as Array<
        keyof typeof BAND_UMBRELLAS
    >;

    /** A partitioned filing whose band is lent by `target` (null = residue). */
    function partitioned(
        kind: (typeof PARTITIONED)[number],
        target: string | null,
        over: Partial<GapFiling> = {}
    ): GapFiling {
        return filing({
            kind,
            key: `${kind}-key`,
            title: `${kind} gap`,
            fallbackParent: KIND_FALLBACK[kind],
            target,
            ...over,
        });
    }

    it("every family holds one umbrella per Target that lends a band today, plus P0 — and nothing else", () => {
        expect(RANKED.length).toBeGreaterThan(0);
        for (const family of FAMILIES)
            expect(Object.keys(BAND_UMBRELLAS[family]).sort()).toEqual(
                ["P0", ...RANKED].sort()
            );
    });

    it("the fallback Target is the LOWEST-ranked one — the roster shifting reds here, not in the tracker", () => {
        expect(LOWEST_RANKED_TARGET).toBe(RANKED[RANKED.length - 1]);
    });

    it("no umbrella number appears twice, and the Hand Tail family is the four issues #4209 created", () => {
        const all = FAMILIES.flatMap((family) =>
            Object.values(BAND_UMBRELLAS[family])
        );
        expect(new Set(all).size).toBe(all.length);
        expect(BAND_UMBRELLAS["hand-tail"]).toEqual({
            P0: 4241,
            "premodern-metagame": 4242,
            "vintage-cube": 4243,
            "format-premodern": 4244,
        });
    });

    it("a hand-tail gap resolves to the umbrella of the Target lending its band", () => {
        for (const target of RANKED) {
            const gap = partitioned("hand-tail", target);
            expect(bandUmbrellaOf(gap)).toBe(
                BAND_UMBRELLAS["hand-tail"][target]
            );
            const tracker = new StubTracker();
            syncGaps([gap], tracker);
            expect(tracker.parents.get(5000)).toBe(
                BAND_UMBRELLAS["hand-tail"][target]
            );
        }
    });

    it("residue of every partitioned kind files under the lowest-ranked Target's umbrella — never a computed one", () => {
        for (const kind of PARTITIONED) {
            const family = PARTITIONED_KINDS[kind]!;
            const fallback = BAND_UMBRELLAS[family][LOWEST_RANKED_TARGET];
            expect(KIND_FALLBACK[kind]).toBe(fallback);
            const tracker = new StubTracker();
            syncGaps([partitioned(kind, null)], tracker);
            expect(tracker.parents.get(5000)).toBe(fallback);
            // A gap the rule DID band to the strongest Target files elsewhere:
            // the fallback is not just "the umbrella every gap ends up in".
            expect(BAND_UMBRELLAS[family][RANKED[0]!]).not.toBe(fallback);
        }
    });

    it("a Target with no umbrella yet is residue, not a crash and not someone else's umbrella", () => {
        for (const kind of PARTITIONED) {
            const gap = partitioned(kind, "set-not-in-the-table");
            expect(bandUmbrellaOf(gap)).toBeNull();
            const tracker = new StubTracker();
            syncGaps([gap], tracker);
            expect(tracker.parents.get(5000)).toBe(KIND_FALLBACK[kind]);
        }
    });

    it("an umbrella number reads back as its key — P0 or a Target id — and anything else as null", () => {
        expect(umbrellaKey("ops", BAND_UMBRELLAS.ops["vintage-cube"]!)).toBe(
            "vintage-cube"
        );
        expect(umbrellaKey("hand-tail", BAND_UMBRELLAS["hand-tail"].P0)).toBe(
            "P0"
        );
        expect(umbrellaKey("ops", BAND_UMBRELLAS["bot-gaps"].P0)).toBeNull();
        expect(umbrellaKey("ops", null)).toBeNull();
    });

    it("nothing moves out of a hand-set P0 umbrella, Hand Tail's included", () => {
        const gap = partitioned("hand-tail", "vintage-cube");
        expect(planMove(gap, BAND_UMBRELLAS["hand-tail"].P0)).toBeNull();
    });

    it("a gap under a retired umbrella (#4113, #3972, PRD #3820) moves to its Target's umbrella, residue to its fallback", () => {
        expect([...RETIRED_UMBRELLAS].sort((a, b) => a - b)).toEqual([
            PRD_ISSUE,
            3972,
            4113,
        ]);
        for (const kind of PARTITIONED) {
            const family = PARTITIONED_KINDS[kind]!;
            for (const retired of RETIRED_UMBRELLAS) {
                expect(
                    planMove(partitioned(kind, "vintage-cube"), retired)
                ).toBe(BAND_UMBRELLAS[family]["vintage-cube"]);
                expect(planMove(partitioned(kind, null), retired)).toBe(
                    KIND_FALLBACK[kind]
                );
            }
        }
        for (const parent of Object.values(KIND_FALLBACK))
            expect(RETIRED_UMBRELLAS.has(parent)).toBe(false);
    });

    it("an open Hand Tail gap still filed under #4113 is emptied out of it once, then stays put", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4900, { state: "OPEN", body: "body v1" });
        tracker.parents.set(4900, 4113);
        const gap = partitioned("hand-tail", "premodern-metagame", {
            currentIssue: 4900,
        });
        const first = syncGaps([gap], tracker);
        expect(first.moves).toEqual([
            {
                kind: "hand-tail",
                key: "hand-tail-key",
                issue: 4900,
                from: 4113,
                to: BAND_UMBRELLAS["hand-tail"]["premodern-metagame"],
            },
        ]);
        expect(syncGaps([gap], tracker).moves).toEqual([]);
    });

    it("a residue gap hand-placed under any other parent keeps it — Target keying changes nothing there (issue #4110)", () => {
        for (const kind of PARTITIONED) {
            const tracker = new StubTracker();
            tracker.issues.set(4901, { state: "OPEN", body: "body v1" });
            tracker.parents.set(4901, 3838);
            const result = syncGaps(
                [partitioned(kind, null, { currentIssue: 4901 })],
                tracker
            );
            expect(result.moves).toEqual([]);
            expect(tracker.parents.get(4901)).toBe(3838);
        }
    });
});

// ── Gap Clusters: adoption by Cluster Signature (ADR 0146, issue #4677) ──

describe("parseClusterRows — fail-closed", () => {
    const parse = (clusters: unknown) =>
        parseClusterRows({ clusters } as { clusters?: unknown });

    it("reads a glob row, a `{ set, colour }` row and a Standalone Gap", () => {
        expect(
            parse([
                {
                    issue: 900,
                    kind: "bot",
                    match: ["never-chosen › * › *forEach*"],
                },
                {
                    issue: 901,
                    kind: "hand-tail",
                    match: [{ set: "apc", colour: "red" }],
                },
                {
                    issue: 902,
                    kind: "mechanic",
                    match: ["planned-mechanic › banding"],
                    standalone: true,
                    reason: "its own CR section",
                },
            ])
        ).toEqual([
            {
                issue: 900,
                kind: "bot",
                match: ["never-chosen › * › *forEach*"],
            },
            {
                issue: 901,
                kind: "hand-tail",
                match: [{ set: "apc", colour: "red" }],
            },
            {
                issue: 902,
                kind: "mechanic",
                match: ["planned-mechanic › banding"],
                standalone: true,
                reason: "its own CR section",
            },
        ]);
    });

    it("an allowlist with no `clusters` has no signatures", () => {
        expect(parseClusterRows({})).toEqual([]);
    });

    it("the committed allowlist parses", () => {
        const doc = JSON.parse(
            readFileSync(
                join(
                    dirname(fileURLToPath(import.meta.url)),
                    "../../data/grammar-gaps.json"
                ),
                "utf8"
            )
        ) as { clusters?: unknown };
        expect(() => parseClusterRows(doc)).not.toThrow();
    });

    const ok = { issue: 900, kind: "bot", match: ["a › *"] };
    it.each([
        ["`clusters` not an array", { a: 1 }, /must be an array/],
        [
            "a row that is not an object",
            ["x"],
            /clusters\[0\].*must be an object/,
        ],
        [
            "an unknown field",
            [{ ...ok, stanalone: true }],
            /clusters\[0\].*unknown field `stanalone`/,
        ],
        [
            "a non-integer issue",
            [{ ...ok, issue: "900" }],
            /clusters\[0\].*positive integer/,
        ],
        [
            "a second row for one issue",
            [ok, { ...ok }],
            /clusters\[1\].*second row/,
        ],
        [
            "an unknown kind",
            [{ ...ok, kind: "bots" }],
            /clusters\[0\].*unknown kind `bots`/,
        ],
        [
            "the migration kind",
            [{ ...ok, kind: "migration" }],
            /clusters\[0\].*unknown kind `migration`/,
        ],
        [
            "`standalone: false`",
            [{ ...ok, standalone: false }],
            /clusters\[0\].*`standalone` is `true` or absent/,
        ],
        [
            "an empty reason",
            [{ ...ok, reason: " " }],
            /clusters\[0\].*`reason` is a non-empty string/,
        ],
        [
            "a Standalone Gap with no reason",
            [{ ...ok, match: ["a › b"], standalone: true }],
            /clusters\[0\].*needs a `reason`/,
        ],
        [
            "an empty match",
            [{ ...ok, match: [] }],
            /clusters\[0\].*non-empty array/,
        ],
        [
            "a match that is not an array",
            [{ ...ok, match: "a › *" }],
            /clusters\[0\].*non-empty array/,
        ],
        [
            "a Standalone Gap with two keys",
            [{ ...ok, match: ["a", "b"], standalone: true, reason: "r" }],
            /clusters\[0\].*exactly one key/,
        ],
        [
            "a Standalone Gap with a glob",
            [{ ...ok, standalone: true, reason: "r" }],
            /clusters\[0\].*exactly one key/,
        ],
        [
            "a hand-tail string pattern",
            [{ issue: 1, kind: "hand-tail", match: ["apc"] }],
            /clusters\[0\].*`\{ set, colour \}`/,
        ],
        [
            "a hand-tail unknown colour",
            [
                {
                    issue: 1,
                    kind: "hand-tail",
                    match: [{ set: "apc", colour: "purple" }],
                },
            ],
            /clusters\[0\].*`\{ set, colour \}`/,
        ],
        [
            "a hand-tail extra key",
            [
                {
                    issue: 1,
                    kind: "hand-tail",
                    match: [{ set: "apc", colour: "red", rarity: "rare" }],
                },
            ],
            /clusters\[0\].*`\{ set, colour \}`/,
        ],
        [
            "an empty glob",
            [{ ...ok, match: [""] }],
            /clusters\[0\].*segment glob/,
        ],
        [
            "a non-string glob",
            [{ ...ok, match: [{ set: "apc", colour: "red" }] }],
            /clusters\[0\].*segment glob/,
        ],
    ])("throws on %s, naming the row", (_, clusters, message) => {
        expect(() => parse(clusters)).toThrow(message);
    });
});

describe("keyMatchesGlob — segment globs over the ` › ` key", () => {
    it("`*` matches within a segment; an Op list is plain text", () => {
        expect(
            keyMatchesGlob(
                "never-chosen › * › *forEach*",
                "never-chosen › sorcery › draw+forEach+tap"
            )
        ).toBe(true);
        expect(
            keyMatchesGlob(
                "never-chosen › * › *forEach*",
                "never-chosen › sorcery › draw+tap"
            )
        ).toBe(false);
    });

    it("never crosses a segment — the segment counts must agree", () => {
        expect(keyMatchesGlob("never-chosen › *", "never-chosen › a › b")).toBe(
            false
        );
        expect(keyMatchesGlob("never-chosen › * › *", "never-chosen › a")).toBe(
            false
        );
    });

    it("every other character is literal", () => {
        expect(keyMatchesGlob("(op) › addMana", "(op) › addMana")).toBe(true);
        expect(keyMatchesGlob("(op) › add.ana", "(op) › addMana")).toBe(false);
    });
});

describe("setFileColour — the set file a card is written in", () => {
    it.each([
        ["{X}{R}", "red"],
        ["{W}{U}{B}{R}{G}", "multicolor"],
        ["{2}", "colorless"],
        ["", "colorless"],
        ["{W/U}", "multicolor"],
        ["{G/P}{1}", "green"],
        ["{1}{R} // {2}{R}", "red"],
    ])("%s → %s", (cost, colour) => {
        expect(setFileColour(cost)).toBe(colour);
    });
});

describe("matchCluster — which Gap Cluster adopts a new gap", () => {
    const BOT = "never-chosen › sorcery › draw+forEach";
    const rows: ClusterRow[] = [
        { issue: 900, kind: "bot", match: ["never-chosen › * › *forEach*"] },
        { issue: 800, kind: "bot", match: ["never-chosen › sorcery › *"] },
        {
            issue: 950,
            kind: "hand-tail",
            match: [{ set: "apc", colour: "red" }],
        },
        {
            issue: 960,
            kind: "mechanic",
            match: ["planned-mechanic › banding"],
            standalone: true,
            reason: "its own CR section",
        },
    ];
    const free: ClusterIssueState = {
        open: true,
        inProgress: false,
        openPr: false,
    };
    const states =
        (over: Record<number, ClusterIssueState | null> = {}) =>
        (issue: number): ClusterIssueState | null =>
            issue in over ? over[issue]! : free;

    it("the lowest-numbered matching open cluster wins", () => {
        expect(matchCluster({ kind: "bot", key: BOT }, rows, states())).toEqual(
            {
                via: "signature",
                issue: 800,
            }
        );
    });

    it("skips a cluster in progress or with an open PR, naming it", () => {
        expect(
            matchCluster(
                { kind: "bot", key: BOT },
                rows,
                states({ 800: { ...free, inProgress: true } })
            )
        ).toEqual({ via: "signature", issue: 900 });
        expect(
            matchCluster(
                { kind: "bot", key: BOT },
                rows,
                states({
                    800: { ...free, inProgress: true },
                    900: { ...free, openPr: true },
                })
            )
        ).toEqual({ via: "single", busy: [800, 900] });
    });

    it("excludes a closed or missing cluster — never a target, never busy", () => {
        expect(
            matchCluster(
                { kind: "bot", key: BOT },
                rows,
                states({ 800: { ...free, open: false }, 900: null })
            )
        ).toEqual({ via: "single", busy: [] });
    });

    it("a `hand-tail` signature matches the card's set file, nothing else", () => {
        const tail = (card?: { set: string; colour: "red" | "blue" }) =>
            matchCluster(
                { kind: "hand-tail", key: "Illuminate", card },
                rows,
                states()
            );
        expect(tail({ set: "apc", colour: "red" })).toEqual({
            via: "signature",
            issue: 950,
        });
        expect(tail({ set: "apc", colour: "blue" }).via).toBe("single");
        expect(tail(undefined).via).toBe("single");
    });

    it("an open issue naming the card in `## Cards` outranks every signature", () => {
        expect(
            matchCluster(
                { kind: "bot", key: BOT, cardsIssue: 1234 },
                rows,
                states()
            )
        ).toEqual({ via: "cards", issue: 1234 });
    });

    it("a Standalone Gap matches its one key exactly, and a kind only its own", () => {
        const at = (kind: "mechanic" | "bot", key: string) =>
            matchCluster({ kind, key }, rows, states());
        expect(at("mechanic", "planned-mechanic › banding")).toEqual({
            via: "signature",
            issue: 960,
        });
        expect(at("mechanic", "planned-mechanic › bandin").via).toBe("single");
        expect(at("bot", "planned-mechanic › banding").via).toBe("single");
    });

    it("asks about a cluster's state only when its signature matched", () => {
        const asked: number[] = [];
        matchCluster({ kind: "bot", key: BOT }, rows, (issue) => {
            asked.push(issue);
            return free;
        });
        expect(asked).toEqual([800]);
    });
});

describe("withAdoptedBlock — the managed block of a Gap Cluster", () => {
    const HAND = "## Scope\n\nThe cutter's design notes.\n";
    const entries = [
        { key: "b › y", live: true, cards: ["Card B"], band: "P1" },
        {
            key: "a › x",
            live: true,
            cards: ["C1", "C2", "C3", "C4", "C5", "C6"],
            band: null,
        },
        { key: "c | z", live: false },
    ];

    it("appends after the hand-written text, which stays byte-identical", () => {
        const out = withAdoptedBlock(HAND, entries);
        expect(out.startsWith(HAND)).toBe(true);
        expect(out.slice(HAND.length)).toBe(`\n${renderAdoptedBlock(entries)}`);
    });

    it("regenerates between the markers, touching nothing outside them", () => {
        const before = `${HAND}\n${ADOPTED_BLOCK_START}\nstale rows\n${ADOPTED_BLOCK_END}\n\nTrailing notes.`;
        const out = withAdoptedBlock(before, entries);
        expect(out).toBe(
            `${HAND}\n${renderAdoptedBlock(entries)}\n\nTrailing notes.`
        );
    });

    it("is idempotent — a second run returns the same bytes", () => {
        const once = withAdoptedBlock(HAND, entries);
        expect(withAdoptedBlock(once, entries)).toBe(once);
        expect(withAdoptedBlock(once, [...entries].reverse())).toBe(once);
    });

    it("lists key, cards (capped) and band; a closed key says so", () => {
        const block = renderAdoptedBlock(entries);
        expect(block).toContain(
            "| `a › x` | C1, C2, C3, C4, C5 (+1 more) | residue |"
        );
        expect(block).toContain("| `b › y` | Card B | P1 |");
        expect(block).toContain("| `c \\| z` | — | no live gap |");
        expect(block.indexOf("a › x")).toBeLessThan(block.indexOf("b › y"));
    });

    it("refuses broken markers rather than guess where the block ends", () => {
        expect(() =>
            withAdoptedBlock(`${HAND}${ADOPTED_BLOCK_START}\nrows`, entries, 42)
        ).toThrow(/issue #42.*markers are broken/);
        expect(() =>
            withAdoptedBlock(
                `${ADOPTED_BLOCK_END}\n${ADOPTED_BLOCK_START}`,
                entries
            )
        ).toThrow(/markers are broken/);
    });
});

describe("syncGaps adopts a new gap into the matching Gap Cluster (ADR 0146)", () => {
    const BOT = "never-chosen › sorcery › draw+forEach";
    const CLUSTER = 900;
    const signature: ClusterRow = {
        issue: CLUSTER,
        kind: "bot",
        match: ["never-chosen › * › *forEach*"],
    };
    const botFiling = (over: Partial<GapFiling> = {}) =>
        filing({
            kind: "bot",
            key: BOT,
            title: `Bot Gap: ${BOT}`,
            cards: ["Card A"],
            band: "P1",
            ...over,
        });
    const HAND = "## Scope\n\nHand-cut.";
    const trackerWithCluster = () => {
        const tracker = new StubTracker();
        tracker.issues.set(CLUSTER, { state: "OPEN", body: HAND });
        return tracker;
    };
    const HAND_ROW = claimId("bot", "never-chosen › instant › forEach");

    it("claims the gap for the cluster: no create, no body write, one comment", () => {
        const tracker = trackerWithCluster();
        const result = syncGaps(
            [botFiling()],
            tracker,
            undefined,
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions).toEqual([
            {
                action: "adopt",
                kind: "bot",
                key: BOT,
                issue: CLUSTER,
                via: "signature",
            },
        ]);
        expect(result.updatedRows.get(claimId("bot", BOT))).toBe(CLUSTER);
        expect(tracker.createCalls).toBe(0);
        expect(tracker.updateCalls).toBe(0);
        expect(tracker.comments.map((c) => c.issue)).toEqual([CLUSTER]);
    });

    it("files a single when the only matching cluster is in progress", () => {
        const tracker = trackerWithCluster();
        tracker.states.set(CLUSTER, {
            open: true,
            inProgress: true,
            openPr: false,
        });
        const result = syncGaps([botFiling()], tracker, undefined, new Set(), [
            signature,
        ]);
        expect(result.actions.map((a) => [a.action, a.issue])).toEqual([
            ["create", 5000],
        ]);
        expect(result.updatedRows.get(claimId("bot", BOT))).toBe(5000);
    });

    it("the next run over the recorded claim is the cluster, left alone", () => {
        const tracker = trackerWithCluster();
        syncGaps([botFiling()], tracker, undefined, new Set([CLUSTER]), [
            signature,
        ]);
        const second = syncGaps(
            [botFiling({ currentIssue: CLUSTER })],
            tracker,
            undefined,
            new Set([CLUSTER]),
            [signature]
        );
        expect(second.actions.map((a) => a.action)).toEqual(["cluster"]);
        expect(tracker.updateCalls).toBe(0);
        expect(tracker.comments).toHaveLength(1);
    });

    it("the `## Cards` adoption outranks the signature", () => {
        const tracker = trackerWithCluster();
        const result = syncGaps(
            [botFiling({ adopts: 1234 })],
            tracker,
            undefined,
            new Set(),
            [signature]
        );
        expect(result.actions).toEqual([
            { action: "adopt", kind: "bot", key: BOT, issue: 1234 },
        ]);
    });

    it("with no signature rows, plans exactly what it planned before — and asks no cluster state", () => {
        const plain = syncGaps([botFiling()], new StubTracker());
        const tracker = new StubTracker();
        const none = syncGaps([botFiling()], tracker, undefined, new Set(), []);
        expect(none).toEqual(plain);
        expect(tracker.stateReads).toEqual([]);
    });

    describe("a live key on a CLOSED Gap Cluster is re-homed (issue #4679)", () => {
        const CLOSED = 800;
        const TIP = "abc123def456";
        const trackerWithClosed = () => {
            const tracker = trackerWithCluster();
            tracker.issues.set(CLOSED, { state: "CLOSED", body: HAND });
            return tracker;
        };

        it("moves the key into the matching open cluster, commenting on both", () => {
            const tracker = trackerWithClosed();
            const result = syncGaps(
                [botFiling({ currentIssue: CLOSED })],
                tracker,
                undefined,
                new Set([CLOSED, CLUSTER]),
                [signature, { ...signature, issue: CLOSED }],
                TIP
            );
            expect(result.actions).toEqual([
                {
                    action: "re-home",
                    kind: "bot",
                    key: BOT,
                    issue: CLUSTER,
                    via: "signature",
                    from: CLOSED,
                },
            ]);
            expect(result.updatedRows.get(claimId("bot", BOT))).toBe(CLUSTER);
            expect(tracker.createCalls).toBe(0);
            expect(tracker.comments.map((c) => c.issue).sort()).toEqual([
                CLOSED,
                CLUSTER,
            ]);
            const moved = tracker.comments.find((c) => c.issue === CLOSED)!;
            expect(moved.body).toBe(reHomeComment(BOT, TIP, CLUSTER));
            expect(moved.body).toContain(`\`${BOT}\``);
            expect(moved.body).toContain(TIP);
            expect(moved.body).toContain(`issue #${CLUSTER}`);
        });

        it("files a new single when no open cluster matches", () => {
            const tracker = trackerWithClosed();
            tracker.states.set(CLUSTER, {
                open: true,
                inProgress: true,
                openPr: false,
            });
            const result = syncGaps(
                [botFiling({ currentIssue: CLOSED })],
                tracker,
                undefined,
                new Set([CLOSED, CLUSTER]),
                [signature, { ...signature, issue: CLOSED }],
                TIP
            );
            expect(
                result.actions.map((a) => [a.action, a.issue, a.from])
            ).toEqual([["re-home", 5000, CLOSED]]);
            expect(result.updatedRows.get(claimId("bot", BOT))).toBe(5000);
            expect(tracker.createCalls).toBe(1);
            expect(tracker.comments).toEqual([
                { issue: CLOSED, body: reHomeComment(BOT, TIP, 5000) },
            ]);
        });

        it("an open issue naming the card in `## Cards` outranks the signature — no duplicate filed", () => {
            const tracker = trackerWithClosed();
            const result = syncGaps(
                [botFiling({ currentIssue: CLOSED, adopts: 1234 })],
                tracker,
                undefined,
                new Set([CLOSED, CLUSTER]),
                [signature, { ...signature, issue: CLOSED }],
                TIP
            );
            expect(result.actions).toEqual([
                {
                    action: "re-home",
                    kind: "bot",
                    key: BOT,
                    issue: 1234,
                    from: CLOSED,
                },
            ]);
            expect(result.updatedRows.get(claimId("bot", BOT))).toBe(1234);
            expect(tracker.createCalls).toBe(0);
            expect(tracker.comments).toEqual([
                { issue: CLOSED, body: reHomeComment(BOT, TIP, 1234) },
            ]);
        });

        it("a closed SINGLE stays skip-closed, and a gone key is the closer's — no filing, no action", () => {
            const tracker = trackerWithClosed();
            const single = syncGaps(
                [botFiling({ currentIssue: CLOSED })],
                tracker,
                undefined,
                new Set([CLUSTER]),
                [signature],
                TIP
            );
            expect(single.actions.map((a) => a.action)).toEqual([
                "skip-closed",
            ]);
            const gone = syncGaps(
                [],
                tracker,
                undefined,
                new Set([CLOSED, CLUSTER]),
                [signature, { ...signature, issue: CLOSED }],
                TIP
            );
            expect(gone.actions).toEqual([]);
            expect(tracker.comments).toEqual([]);
            expect(tracker.createCalls).toBe(0);
        });
    });

    describe("syncAdoptedBlocks — the managed block, after the write-back", () => {
        const recorded = new Map([
            [claimId("bot", BOT), CLUSTER],
            [HAND_ROW, CLUSTER],
            [claimId("bot", "elsewhere › x"), 777],
        ]);

        it("lists every recorded key of the cluster; the hand-written text survives", () => {
            const tracker = trackerWithCluster();
            expect(
                syncAdoptedBlocks([signature], recorded, [botFiling()], tracker)
            ).toEqual([CLUSTER]);
            const body = tracker.issues.get(CLUSTER)!.body;
            expect(body.startsWith(HAND)).toBe(true);
            expect(body).toContain(`| \`${BOT}\` | Card A | P1 |`);
            expect(body).toContain(
                "| `never-chosen › instant › forEach` | — | no live gap |"
            );
            expect(body).not.toContain("elsewhere");
        });

        it("a second run writes nothing", () => {
            const tracker = trackerWithCluster();
            syncAdoptedBlocks([signature], recorded, [botFiling()], tracker);
            const writes = tracker.updateCalls;
            expect(
                syncAdoptedBlocks([signature], recorded, [botFiling()], tracker)
            ).toEqual([]);
            expect(tracker.updateCalls).toBe(writes);
        });

        it("never writes into a Standalone Gap, a closed cluster or one a session is working", () => {
            const tracker = trackerWithCluster();
            syncAdoptedBlocks(
                [{ ...signature, match: [BOT], standalone: true, reason: "r" }],
                recorded,
                [botFiling()],
                tracker
            );
            for (const state of [
                { open: false, inProgress: false, openPr: false },
                { open: true, inProgress: true, openPr: false },
                { open: true, inProgress: false, openPr: true },
            ]) {
                tracker.states.set(CLUSTER, state);
                syncAdoptedBlocks(
                    [signature],
                    recorded,
                    [botFiling()],
                    tracker
                );
            }
            expect(tracker.updateCalls).toBe(0);
        });
    });
});

describe("syncGaps absorbs its own open singles into the matching Gap Cluster (issue #4678)", () => {
    const BOT = "never-chosen › sorcery › draw+forEach";
    const CLUSTER = 900;
    const SINGLE = 4099;
    const signature: ClusterRow = {
        issue: CLUSTER,
        kind: "bot",
        match: ["never-chosen › * › *forEach*"],
    };
    const SINGLE_BODY =
        "## Gap\n\n```ts\nforEach()\n```\n\nFiled by `gaps:sync`.";
    const filed = (over: Partial<GapFiling> = {}) =>
        filing({
            kind: "bot",
            key: BOT,
            title: `Bot Gap: ${BOT}`,
            currentIssue: SINGLE,
            body: () => "body v2",
            ...over,
        });
    const tracker = (title = `Bot Gap: ${BOT}`) => {
        const t = new StubTracker();
        t.issues.set(CLUSTER, { state: "OPEN", body: "## Scope" });
        t.issues.set(SINGLE, { state: "OPEN", title, body: SINGLE_BODY });
        return t;
    };
    // `main`'s order: plan, (write-back), then close the absorbed singles.
    const run = (t: StubTracker, over: Partial<GapFiling> = {}) => {
        const result = syncGaps(
            [filed(over)],
            t,
            undefined,
            new Set([CLUSTER]),
            [signature]
        );
        closeAbsorbedSingles(result.absorbed, t);
        return result;
    };

    it("closes the matching filed single, re-points its claim row at the cluster", () => {
        const t = tracker();
        const result = run(t);
        expect(result.actions).toEqual([
            {
                action: "absorb",
                kind: "bot",
                key: BOT,
                issue: CLUSTER,
                single: SINGLE,
            },
        ]);
        expect(result.updatedRows.get(claimId("bot", BOT))).toBe(CLUSTER);
        expect(t.closed.map((c) => c.issue)).toEqual([SINGLE]);
        expect(t.issues.get(SINGLE)!.state).toBe("CLOSED");
        // Neither the single's body nor the cluster's is rewritten here: the
        // managed block is `syncAdoptedBlocks`'s, after the write-back.
        expect(t.updateCalls).toBe(0);
        expect(t.createCalls).toBe(0);
    });

    it("syncGaps only PLANS the close — the single stays open until after the write-back", () => {
        const t = tracker();
        const result = syncGaps([filed()], t, undefined, new Set([CLUSTER]), [
            signature,
        ]);
        expect(t.closed).toEqual([]);
        expect(t.issues.get(SINGLE)!.state).toBe("OPEN");
        expect(result.absorbed).toEqual([
            {
                kind: "bot",
                key: BOT,
                single: SINGLE,
                cluster: CLUSTER,
                body: SINGLE_BODY,
            },
        ]);
    });

    it("the closing comment names the cluster and carries the single's body verbatim", () => {
        const t = tracker();
        run(t);
        const body = t.closed[0]!.body;
        expect(body).toMatch(/^absorbed into issue #900\b/);
        expect(body).toContain(`\n${SINGLE_BODY}\n`);
        // The body's own ``` fence cannot close the quoting fence early.
        expect(body).toContain("````markdown\n");
        expect(absorptionComment(CLUSTER, SINGLE_BODY)).toBe(body);
    });

    it("a second run over the re-pointed row plans no absorb — the cluster, left alone", () => {
        const t = tracker();
        const first = run(t);
        const second = run(t, {
            currentIssue: first.updatedRows.get(claimId("bot", BOT))!,
        });
        expect(second.actions.map((a) => a.action)).toEqual(["cluster"]);
        expect(t.closed).toHaveLength(1);
        expect(t.updateCalls).toBe(0);
    });

    it("a hand-filed issue on the claim row is left alone", () => {
        const t = tracker("Bot never casts forEach sorceries");
        const result = run(t);
        expect(result.actions.map((a) => a.action)).toEqual(["update"]);
        expect(t.closed).toEqual([]);
        expect(result.updatedRows.size).toBe(0);
    });

    it("an issue whose title was never read is left alone — fail closed", () => {
        const t = tracker();
        t.issues.set(SINGLE, { state: "OPEN", body: SINGLE_BODY });
        expect(run(t).actions.map((a) => a.action)).toEqual(["update"]);
        expect(t.closed).toEqual([]);
    });

    it("an in-progress single is left alone", () => {
        const t = tracker();
        t.states.set(SINGLE, { open: true, inProgress: true, openPr: false });
        expect(run(t).actions.map((a) => a.action)).toEqual(["update"]);
        expect(t.closed).toEqual([]);
    });

    it("a single with an open PR is left alone", () => {
        const t = tracker();
        t.states.set(SINGLE, { open: true, inProgress: false, openPr: true });
        expect(run(t).actions.map((a) => a.action)).toEqual(["update"]);
        expect(t.closed).toEqual([]);
    });

    it("a multi-claimed issue is a cluster, never absorbed", () => {
        const t = tracker();
        const result = syncGaps(
            [filed()],
            t,
            undefined,
            new Set([CLUSTER, SINGLE]),
            [signature]
        );
        expect(result.actions.map((a) => a.action)).toEqual(["cluster"]);
        expect(t.closed).toEqual([]);
    });

    it("a single that IS its own Standalone Gap is never absorbed into itself", () => {
        const t = tracker();
        const standalone: ClusterRow = {
            issue: SINGLE,
            kind: "bot",
            match: [BOT],
            standalone: true,
        };
        const result = syncGaps([filed()], t, undefined, new Set(), [
            standalone,
        ]);
        expect(result.actions.map((a) => a.action)).toEqual(["update"]);
        expect(t.closed).toEqual([]);
    });

    it("a busy cluster absorbs nothing — the single stays", () => {
        const t = tracker();
        t.states.set(CLUSTER, { open: true, inProgress: true, openPr: false });
        expect(run(t).actions.map((a) => a.action)).toEqual(["update"]);
        expect(t.closed).toEqual([]);
    });
});

describe("umbrellaBandRank — a family's band census, P0 first (issue #4680)", () => {
    it("P0 is the strongest rank, 0", () => {
        expect(
            umbrellaBandRank("bot-gaps", BAND_UMBRELLAS["bot-gaps"].P0)
        ).toBe(0);
    });

    it("ranks each Target umbrella by its declared position, weaker as it ranks lower", () => {
        const ranks = (
            ["premodern-metagame", "vintage-cube", "format-premodern"] as const
        ).map((t) =>
            umbrellaBandRank("bot-gaps", BAND_UMBRELLAS["bot-gaps"][t])
        );
        expect(ranks).toEqual([1, 2, 3]);
    });

    it("null for a parent naming none of the family's umbrellas, or no parent at all — a hand-parented cluster, left to its cutter", () => {
        expect(umbrellaBandRank("bot-gaps", 1)).toBeNull();
        expect(umbrellaBandRank("bot-gaps", null)).toBeNull();
    });
});

describe("syncGaps raises a Gap Cluster's band to its highest live key, upward only (issue #4680)", () => {
    const BOT = "never-chosen › sorcery › draw+forEach";
    const CLUSTER = 900;
    const signature: ClusterRow = {
        issue: CLUSTER,
        kind: "bot",
        match: ["never-chosen › * › *forEach*"],
    };
    const botFiling = (over: Partial<GapFiling> = {}) =>
        filing({ kind: "bot", key: BOT, title: `Bot Gap: ${BOT}`, ...over });
    const HAND = "## Scope\n\nHand-cut.";
    const trackerAt = (parent: number): StubTracker => {
        const t = new StubTracker();
        t.issues.set(CLUSTER, { state: "OPEN", body: HAND });
        t.parents.set(CLUSTER, parent);
        return t;
    };
    const P0 = BAND_UMBRELLAS["bot-gaps"].P0;
    const P1 = BAND_UMBRELLAS["bot-gaps"]["premodern-metagame"];
    const P2 = BAND_UMBRELLAS["bot-gaps"]["vintage-cube"];

    it("a P0 key adopted into a band-P2 cluster moves it under the P0 umbrella of its kind", () => {
        const tracker = trackerAt(P2);
        const result = syncGaps(
            [botFiling()],
            tracker,
            "P0",
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions).toContainEqual({
            action: "raise-band",
            kind: "bot",
            key: BOT,
            issue: CLUSTER,
            from: P2,
            parent: P0,
        });
        expect(tracker.parents.get(CLUSTER)).toBe(P0);
        const comment = tracker.comments.find((c) =>
            c.body.startsWith("`gaps:sync` raised")
        )!;
        expect(comment.issue).toBe(CLUSTER);
        expect(comment.body).toContain(`#${P2}`);
        expect(comment.body).toContain(`#${P0}`);
        expect(comment.body).toContain(BOT);
    });

    it("a member's own re-home — its Target now lends a stronger band — raises the cluster too", () => {
        const tracker = trackerAt(P2);
        const result = syncGaps(
            [
                botFiling({
                    currentIssue: CLUSTER,
                    target: "premodern-metagame",
                }),
            ],
            tracker,
            undefined,
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions).toContainEqual({
            action: "raise-band",
            kind: "bot",
            key: BOT,
            issue: CLUSTER,
            from: P2,
            parent: P1,
        });
        expect(tracker.parents.get(CLUSTER)).toBe(P1);
    });

    it("never raises a cluster already at, or above, the band a key would lend", () => {
        const tracker = trackerAt(P0);
        const result = syncGaps(
            [botFiling()],
            tracker,
            "P0",
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions.map((a) => a.action)).not.toContain("raise-band");
        expect(tracker.parents.get(CLUSTER)).toBe(P0);
    });

    it("a closed P0 key never moves the cluster back — a weaker live key stays under it", () => {
        const tracker = trackerAt(P0);
        const result = syncGaps(
            // The P0 key that raised it earlier no longer appears this run
            // (fixed, closed) — only a weaker live member remains.
            [botFiling({ currentIssue: CLUSTER, target: "vintage-cube" })],
            tracker,
            undefined,
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions.map((a) => a.action)).toEqual(["cluster"]);
        expect(result.actions).not.toContainEqual(
            expect.objectContaining({ action: "raise-band" })
        );
        expect(tracker.parents.get(CLUSTER)).toBe(P0);
    });

    it("never raises a hand-parented cluster — its parent names none of the family's umbrellas, left to its cutter", () => {
        const tracker = new StubTracker();
        tracker.issues.set(CLUSTER, { state: "OPEN", body: HAND });
        tracker.parents.set(CLUSTER, 4001);
        const result = syncGaps(
            [botFiling()],
            tracker,
            "P0",
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions.map((a) => a.action)).not.toContain("raise-band");
        expect(tracker.parents.get(CLUSTER)).toBe(4001);
    });

    it("an origin-`P0` run never pulls an already-claimed member's OWN vote up to P0 — only what's new this run (planMove's own asymmetry)", () => {
        // The cluster sits at its correct P1 umbrella; the member's own
        // Target lends only the weakest band. `--band P0` is flagged for an
        // UNRELATED reason this run (the whole backlog is re-scanned), and
        // must not force this cluster to P0 on that account alone.
        const tracker = trackerAt(P1);
        const result = syncGaps(
            [botFiling({ currentIssue: CLUSTER, target: "format-premodern" })],
            tracker,
            "P0",
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions.map((a) => a.action)).not.toContain("raise-band");
        expect(tracker.parents.get(CLUSTER)).toBe(P1);
    });

    it("an absorbed single's key raises the destination cluster's band too", () => {
        const SINGLE = 4200;
        const tracker = trackerAt(P2);
        tracker.issues.set(SINGLE, {
            state: "OPEN",
            title: `Bot Gap: ${BOT}`,
            body: "## Gap\n\nFiled by `gaps:sync`.",
        });
        const result = syncGaps(
            [botFiling({ currentIssue: SINGLE })],
            tracker,
            "P0",
            new Set([CLUSTER]),
            [signature]
        );
        expect(result.actions).toContainEqual(
            expect.objectContaining({
                action: "absorb",
                issue: CLUSTER,
                single: SINGLE,
            })
        );
        expect(result.actions).toContainEqual({
            action: "raise-band",
            kind: "bot",
            key: BOT,
            issue: CLUSTER,
            from: P2,
            parent: P0,
        });
        expect(tracker.parents.get(CLUSTER)).toBe(P0);
    });

    it("a raise-band's destination is folded into the sub-issue cap check, before any write", () => {
        const tracker = trackerAt(P2);
        tracker.children = SUB_ISSUE_CAP;
        expect(() =>
            syncGaps([botFiling()], tracker, "P0", new Set([CLUSTER]), [
                signature,
            ])
        ).toThrow(/sub-issues/);
        expect(tracker.parents.get(CLUSTER)).toBe(P2);
    });
});

describe("raiseBandComment — names the old and new parent and the raising key", () => {
    it("mentions both issue numbers and the kind/key", () => {
        const body = raiseBandComment("bot", "some › key", 4101, 4099);
        expect(body).toContain("#4101");
        expect(body).toContain("#4099");
        expect(body).toContain("`bot`");
        expect(body).toContain("some › key");
    });
});

describe("issuesWorkedByPrs — which clusters have an open PR", () => {
    it("reads the `…issue-N` branch and closing keywords, nothing else", () => {
        expect(
            [
                ...issuesWorkedByPrs(
                    [
                        { headRefName: "feat/issue-4677", body: "" },
                        {
                            headRefName: "fix/other",
                            body: "Closes #12, fixes #13",
                        },
                        {
                            headRefName: "chore/tweak",
                            body: "see #14, issue #15",
                        },
                    ],
                    100
                ),
            ].sort((a, b) => a - b)
        ).toEqual([12, 13, 4677]);
    });

    it("fails closed on a full page — a truncated list would read a busy cluster as free", () => {
        expect(() =>
            issuesWorkedByPrs([{ headRefName: "x", body: "" }], 1)
        ).toThrow(/fill the page/);
    });
});

describe("clusterIssues counts a signature cluster, never a Standalone Gap", () => {
    it("a signature row with one claim is a cluster; a standalone one is not", () => {
        const doc = {
            ops: [],
            claims: [
                { kind: "bot" as const, key: "a", issue: 900 },
                { kind: "bot" as const, key: "b", issue: 960 },
            ],
            clusters: [
                { issue: 900, kind: "bot" as const, match: ["a"] },
                {
                    issue: 960,
                    kind: "bot" as const,
                    match: ["b"],
                    standalone: true as const,
                    reason: "alone",
                },
            ],
        };
        expect([...clusterIssues(doc)]).toEqual([900]);
    });
});
