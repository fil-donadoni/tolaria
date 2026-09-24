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
import { readTargetRegistry } from "../lib/targets";
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
    syncGaps,
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

    comment(): void {}

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
            tracker
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

    it("hand-tail is partitioned exactly like grammar, mechanic and bot", () => {
        expect(PARTITIONED_KINDS).toEqual({
            grammar: "grammar-rules",
            mechanic: "ops",
            bot: "bot-gaps",
            "hand-tail": "hand-tail",
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
