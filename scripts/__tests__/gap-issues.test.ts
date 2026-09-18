/**
 * `gaps:sync`'s pure planning (issue #3829, ADR 0137) — a stub `GapTracker`
 * proves create / update / idempotent-noop / closed-stays-closed and the
 * sub-issue cap with no network at all.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Allowlist } from "../check-gaps";
import {
    applyUpdatedIssues,
    buildBotGapFilings,
    buildGrammarGapFilings,
    grammarGapTitle,
    OP_GAP_UMBRELLA,
    PRD_ISSUE,
    renderOpGapBody,
    SUB_ISSUE_CAP,
    syncGaps,
    type GapFiling,
    type GapTracker,
    type TrackedIssue,
} from "../lib/gap-issues";
import { gapOf, OP_LEVEL } from "../lib/grammar-gaps";
import { parseLockfile } from "../lib/oracle-lockfile";

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
        expect(filings.map((f) => [f.key, f.filed, f.currentIssue])).toEqual([
            [ADD_MANA_KEY, false, PRD_ISSUE],
            ["(op) › draw", true, 4001],
        ]);
        expect(filings[0]!.title).toBe(grammarGapTitle(ADD_MANA_KEY));
        expect(filings[0]!.body).toBe(renderOpGapBody("addMana", ADD_MANA_KEY));
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
        // If the compiler ever attributes a refused line to an Op, the body's
        // "no card count here" becomes false and the counts are worth
        // printing again: this is the tripwire that says so.
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

describe("buildBotGapFilings", () => {
    it("files nothing — the Bot-play sweep it would read from is not built", () => {
        expect(buildBotGapFilings()).toEqual([]);
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
        return this.issues.get(number) ?? null;
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
}

function filing(over: Partial<GapFiling> = {}): GapFiling {
    return {
        key: ADD_MANA_KEY,
        currentIssue: PRD_ISSUE,
        filed: false,
        title: grammarGapTitle(ADD_MANA_KEY),
        body: "body v1",
        ...over,
    };
}

const LABELS = ["ready-for-agent"];

describe("syncGaps", () => {
    it("creates an unfiled gap under the given parent and reports the new number", () => {
        const tracker = new StubTracker();
        const result = syncGaps([filing()], tracker, LABELS, OP_GAP_UMBRELLA);
        expect(result.actions).toEqual([
            { kind: "create", key: ADD_MANA_KEY, issue: 5000 },
        ]);
        expect(result.updatedRows.get(ADD_MANA_KEY)).toBe(5000);
        expect(tracker.parents.get(5000)).toBe(OP_GAP_UMBRELLA);
    });

    it("a second run against the tracker it just wrote is a no-op — idempotent", () => {
        const tracker = new StubTracker();
        const first = syncGaps([filing()], tracker, LABELS, OP_GAP_UMBRELLA);
        const issue = first.updatedRows.get(ADD_MANA_KEY)!;
        const second = syncGaps(
            [filing({ currentIssue: issue, filed: true })],
            tracker,
            LABELS,
            OP_GAP_UMBRELLA
        );
        expect(second.actions).toEqual([
            { kind: "noop", key: ADD_MANA_KEY, issue },
        ]);
        expect(second.updatedRows.size).toBe(0);
        expect(tracker.createCalls).toBe(1);
        expect(tracker.updateCalls).toBe(0);
    });

    it("rewrites an open issue whose body changed, keeping its number", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "stale" });
        const result = syncGaps(
            [filing({ currentIssue: 4001, filed: true, body: "fresh" })],
            tracker,
            LABELS,
            OP_GAP_UMBRELLA
        );
        expect(result.actions).toEqual([
            { kind: "update", key: ADD_MANA_KEY, issue: 4001 },
        ]);
        expect(result.updatedRows.size).toBe(0);
        expect(tracker.getIssue(4001)?.body).toBe("fresh");
    });

    it("leaves a CLOSED issue alone — a gap closes through its PR (ADR 0137)", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "CLOSED", body: "old" });
        const result = syncGaps(
            [filing({ currentIssue: 4001, filed: true, body: "new" })],
            tracker,
            LABELS,
            OP_GAP_UMBRELLA
        );
        expect(result.actions).toEqual([
            { kind: "skip-closed", key: ADD_MANA_KEY, issue: 4001 },
        ]);
        expect(tracker.getIssue(4001)).toEqual({
            state: "CLOSED",
            body: "old",
        });
    });

    it("a gap gone from the allowlist is never passed in — its issue stays open", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "still tracked" });
        expect(syncGaps([], tracker, LABELS, OP_GAP_UMBRELLA).actions).toEqual(
            []
        );
        expect(tracker.getIssue(4001)?.state).toBe("OPEN");
    });

    it("recreates when the filed number resolves to nothing", () => {
        const tracker = new StubTracker();
        const result = syncGaps(
            [filing({ currentIssue: 9999, filed: true })],
            tracker,
            LABELS,
            OP_GAP_UMBRELLA
        );
        expect(result.actions[0]!.kind).toBe("create");
        expect(result.updatedRows.get(ADD_MANA_KEY)).toBe(5000);
    });

    it("refuses BEFORE any write when the creates would pass GitHub's sub-issue cap", () => {
        // 87 Op gaps filed under PRD #3820 filled it to 100; the last 9 were
        // created and left unparented. The refusal must come first.
        const tracker = new StubTracker();
        tracker.children = SUB_ISSUE_CAP - 1;
        const two = [filing(), filing({ key: "(op) › draw" })];
        expect(() => syncGaps(two, tracker, LABELS, OP_GAP_UMBRELLA)).toThrow(
            /cap of 100 — nothing was filed/
        );
        expect(tracker.createCalls).toBe(0);
    });

    it("files right up to the cap", () => {
        const tracker = new StubTracker();
        tracker.children = SUB_ISSUE_CAP - 1;
        syncGaps([filing()], tracker, LABELS, OP_GAP_UMBRELLA);
        expect(tracker.createCalls).toBe(1);
    });

    it("asks for the child count only when something will be created", () => {
        const tracker = new StubTracker();
        tracker.children = SUB_ISSUE_CAP;
        tracker.issues.set(4001, { state: "OPEN", body: "body v1" });
        const result = syncGaps(
            [filing({ currentIssue: 4001, filed: true })],
            tracker,
            LABELS,
            OP_GAP_UMBRELLA
        );
        expect(result.actions[0]!.kind).toBe("noop");
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
            new Map([[ADD_MANA_KEY, 5000]])
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
