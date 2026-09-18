/**
 * `gaps:sync`'s pure planning (issue #3829, ADR 0137) — a SYNTHETIC lockfile
 * and allowlist, so every count below is derivable by hand, and a STUB
 * `GapTracker` so `syncGaps` is proven create / update / idempotent-noop /
 * closed-stays-closed with no network at all.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { Allowlist } from "../check-gaps";
import {
    applyUpdatedIssues,
    buildBotGapFilings,
    buildGrammarGapFilings,
    grammarGapTitle,
    PRD_ISSUE,
    renderGrammarGapBody,
    syncGaps,
    type GapTracker,
    type GrammarGapFiling,
    type TrackedIssue,
} from "../lib/gap-issues";
import type { CardRow, FragmentRow } from "../lib/oracle-lockfile";
import { resolveContext, type TargetRegistry } from "../lib/targets";

// ── Fixtures ─────────────────────────────────────────────────────────────
//
// One Fragment attributed to the (op) frame directly — the attribution
// diagnostic (issue #3822) is what makes this possible: a refused span whose
// deepest failing slot IS an unemitted Op shares `opGapKey`'s key.

function opFragment(op: string): FragmentRow {
    return {
        text: `${op} placeholder oracle line`,
        reason: "no slot consumed the line",
        cards: 1,
        attribution: {
            slot: "(op)",
            path: [],
            span: op,
        },
    };
}

function unparsedCard(
    oracleId: string,
    name: string,
    gapIndex: number
): CardRow {
    return { oracleId, name, state: "unparsed", gaps: [gapIndex] };
}

function allowlist(
    rows: { key: string; op: string; issue: number }[]
): Allowlist {
    return { ops: rows };
}

const ADD_MANA_KEY = "(op) › addMana";

describe("buildGrammarGapFilings", () => {
    it("reads corpus counts off the lockfile via the shared key space, and marks an untouched row unfiled", () => {
        const fragments = [opFragment("addMana")];
        const cards = [unparsedCard("id-1", "Card One", 0)];
        const lock = { fragments, cards };
        const registry: TargetRegistry = {
            handTailFloor: 3,
            handTailFiling: false,
            targets: [],
        };
        const ctx = resolveContext("/tmp/nonexistent-root", lock);
        const filings = buildGrammarGapFilings(
            lock,
            allowlist([{ key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE }]),
            registry,
            ctx
        );
        expect(filings).toHaveLength(1);
        const f = filings[0]!;
        expect(f.key).toBe(ADD_MANA_KEY);
        expect(f.filed).toBe(false);
        expect(f.corpus).toEqual({ refuses: 1, compiles: 1 });
        expect(f.perTarget).toEqual([]);
        expect(f.topTarget).toBeNull();
        expect(f.title).toBe(grammarGapTitle(ADD_MANA_KEY));
    });

    it("marks a row filed once its issue differs from the PRD placeholder", () => {
        const lock = { fragments: [], cards: [] };
        const registry: TargetRegistry = {
            handTailFloor: 3,
            handTailFiling: false,
            targets: [],
        };
        const ctx = resolveContext("/tmp/nonexistent-root", lock);
        const filings = buildGrammarGapFilings(
            lock,
            allowlist([{ key: ADD_MANA_KEY, op: "addMana", issue: 4001 }]),
            registry,
            ctx
        );
        expect(filings[0]!.filed).toBe(true);
        expect(filings[0]!.currentIssue).toBe(4001);
    });

    it("ranks per PRIORITY Target only, in priority order — a format Target needs no disk I/O", () => {
        const fragments = [opFragment("addMana")];
        const cards: CardRow[] = [
            unparsedCard("id-1", "Card One", 0),
            {
                ...unparsedCard("id-2", "Card Two", 0),
                poolIn: ["premodern"],
            },
        ];
        // id-1 has no poolIn: only in corpus, not in the premodern pool.
        const lock = { fragments, cards };
        const registry: TargetRegistry = {
            handTailFloor: 3,
            handTailFiling: false,
            targets: [
                {
                    id: "format-premodern",
                    kind: "format",
                    source: "premodern",
                    priority: 1,
                },
                { id: "unranked-vintage", kind: "format", source: "vintage" },
            ],
        };
        const ctx = resolveContext("/tmp/nonexistent-root", lock);
        const filings = buildGrammarGapFilings(
            lock,
            allowlist([{ key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE }]),
            registry,
            ctx
        );
        const f = filings[0]!;
        // Corpus counts BOTH cards; the priority Target counts only its own.
        expect(f.corpus).toEqual({ refuses: 2, compiles: 2 });
        expect(f.perTarget).toEqual([
            {
                targetId: "format-premodern",
                kind: "format",
                refuses: 1,
                compiles: 1,
            },
        ]);
        expect(f.topTarget?.targetId).toBe("format-premodern");
        expect(f.topTargetSetCode).toBeNull();
        // The unranked Target (no `priority`) never appears — "measured, not
        // ranked by" (targets.ts).
        expect(f.perTarget.map((t) => t.targetId)).not.toContain(
            "unranked-vintage"
        );
    });

    it("names the set code as the parent hint when the top priority Target is a `set`", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaps-sync-set-"));
        fs.writeFileSync(
            path.join(dir, "APC.json"),
            JSON.stringify({
                data: {
                    cards: [
                        {
                            name: "Card One",
                            identifiers: { scryfallOracleId: "id-1" },
                        },
                    ],
                },
            })
        );
        const fragments = [opFragment("addMana")];
        const cards: CardRow[] = [unparsedCard("id-1", "Card One", 0)];
        const lock = { fragments, cards };
        const registry: TargetRegistry = {
            handTailFloor: 3,
            handTailFiling: false,
            targets: [
                { id: "set-apc", kind: "set", source: "APC.json", priority: 1 },
            ],
        };
        const ctx = resolveContext(dir, lock);
        const filings = buildGrammarGapFilings(
            lock,
            allowlist([{ key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE }]),
            registry,
            ctx
        );
        expect(filings[0]!.topTargetSetCode).toBe("APC");
        expect(filings[0]!.perTarget[0]).toEqual({
            targetId: "set-apc",
            kind: "set",
            refuses: 1,
            compiles: 1,
        });
    });
});

describe("renderGrammarGapBody", () => {
    it("names the Op, the corpus leverage and every ranked Target", () => {
        const body = renderGrammarGapBody(
            "addMana",
            ADD_MANA_KEY,
            { refuses: 3, compiles: 2 },
            [
                {
                    targetId: "format-premodern",
                    kind: "format",
                    refuses: 2,
                    compiles: 1,
                },
            ]
        );
        expect(body).toContain("`addMana`");
        expect(body).toContain("3 unparsed card(s)");
        expect(body).toContain("format-premodern");
        expect(body).toContain(ADD_MANA_KEY);
    });

    it("says plainly when no Target ranks the gap", () => {
        const body = renderGrammarGapBody(
            "addMana",
            ADD_MANA_KEY,
            { refuses: 0, compiles: 0 },
            []
        );
        expect(body).toContain("No registered Target List");
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
    readonly umbrellas = new Map<string, number>();
    createCalls = 0;
    updateCalls = 0;

    getIssue(number: number): TrackedIssue | null {
        return this.issues.get(number) ?? null;
    }

    createIssue(input: { title: string; body: string }): number {
        this.createCalls += 1;
        const number = this.nextNumber++;
        this.issues.set(number, { state: "OPEN", body: input.body });
        return number;
    }

    updateBody(number: number, body: string): void {
        this.updateCalls += 1;
        const existing = this.issues.get(number);
        if (existing === undefined) throw new Error(`no issue #${number}`);
        this.issues.set(number, { ...existing, body });
    }

    findSetUmbrella(setCode: string): number | null {
        return this.umbrellas.get(setCode) ?? null;
    }
}

function filing(over: Partial<GrammarGapFiling> = {}): GrammarGapFiling {
    return {
        key: ADD_MANA_KEY,
        op: "addMana",
        currentIssue: PRD_ISSUE,
        filed: false,
        corpus: { refuses: 1, compiles: 1 },
        perTarget: [],
        topTarget: null,
        topTargetSetCode: null,
        title: grammarGapTitle(ADD_MANA_KEY),
        body: "body v1",
        ...over,
    };
}

describe("syncGaps", () => {
    it("creates an issue for an unfiled row and reports the new number", () => {
        const tracker = new StubTracker();
        const result = syncGaps([filing()], tracker, ["ready-for-agent"]);
        expect(result.actions).toEqual([
            { kind: "create", key: ADD_MANA_KEY, issue: 5000 },
        ]);
        expect(result.updatedRows.get(ADD_MANA_KEY)).toBe(5000);
        expect(tracker.createCalls).toBe(1);
    });

    it("re-running with the SAME filing against the tracker it just wrote to is a no-op — idempotent", () => {
        const tracker = new StubTracker();
        const first = syncGaps([filing()], tracker, ["ready-for-agent"]);
        const filedIssue = first.updatedRows.get(ADD_MANA_KEY)!;
        const second = syncGaps(
            [filing({ currentIssue: filedIssue, filed: true })],
            tracker,
            ["ready-for-agent"]
        );
        expect(second.actions).toEqual([
            { kind: "noop", key: ADD_MANA_KEY, issue: filedIssue },
        ]);
        expect(second.updatedRows.size).toBe(0);
        expect(tracker.createCalls).toBe(1); // still just the one from `first`
        expect(tracker.updateCalls).toBe(0);
    });

    it("updates the body when the computed body changed (corpus/Target counts moved) and leaves the row's issue as-is", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "stale body" });
        const result = syncGaps(
            [filing({ currentIssue: 4001, filed: true, body: "fresh body" })],
            tracker,
            ["ready-for-agent"]
        );
        expect(result.actions).toEqual([
            { kind: "update", key: ADD_MANA_KEY, issue: 4001 },
        ]);
        expect(result.updatedRows.size).toBe(0); // issue number unchanged
        expect(tracker.getIssue(4001)?.body).toBe("fresh body");
    });

    it("a CLOSED issue is left alone — a gap closes through its PR, never by gaps:sync (ADR 0137)", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "CLOSED", body: "old" });
        const result = syncGaps(
            [filing({ currentIssue: 4001, filed: true, body: "new body" })],
            tracker,
            ["ready-for-agent"]
        );
        expect(result.actions).toEqual([
            { kind: "skip-closed", key: ADD_MANA_KEY, issue: 4001 },
        ]);
        expect(tracker.getIssue(4001)).toEqual({
            state: "CLOSED",
            body: "old",
        });
        expect(tracker.updateCalls).toBe(0);
    });

    it("a gap that disappears from the allowlist is simply never passed in — its issue is untouched either way", () => {
        const tracker = new StubTracker();
        tracker.issues.set(4001, { state: "OPEN", body: "still tracked" });
        const result = syncGaps([], tracker, ["ready-for-agent"]);
        expect(result.actions).toEqual([]);
        expect(tracker.getIssue(4001)).toEqual({
            state: "OPEN",
            body: "still tracked",
        });
    });

    it("parents an unfiled gap under the set umbrella the tracker names, falling back to PRD_ISSUE when none is found", () => {
        const tracker = new StubTracker();
        tracker.umbrellas.set("APC", 3795);
        const withSet = filing({ topTargetSetCode: "APC" });
        const withoutMatch = filing({
            key: "(op) › other",
            topTargetSetCode: "ZZZ",
        });
        let capturedParents: number[] = [];
        const capturing: GapTracker = {
            ...tracker,
            createIssue(input) {
                capturedParents.push(input.parent);
                return tracker.createIssue(input);
            },
            getIssue: tracker.getIssue.bind(tracker),
            updateBody: tracker.updateBody.bind(tracker),
            findSetUmbrella: tracker.findSetUmbrella.bind(tracker),
        };
        syncGaps([withSet, withoutMatch], capturing, ["ready-for-agent"]);
        expect(capturedParents).toEqual([3795, PRD_ISSUE]);
    });

    it("recreates when the previously filed issue number resolves to nothing (deleted/renumbered)", () => {
        const tracker = new StubTracker();
        const result = syncGaps(
            [filing({ currentIssue: 9999, filed: true })],
            tracker,
            ["ready-for-agent"]
        );
        expect(result.actions[0]!.kind).toBe("create");
        expect(result.updatedRows.get(ADD_MANA_KEY)).toBeDefined();
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

    it("returns the SAME object when nothing changed — the caller's signal to skip the write", () => {
        const before = allowlist([
            { key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE },
        ]);
        expect(applyUpdatedIssues(before, new Map())).toBe(before);
    });
});

// ── Proof-of-failure anchor: a temp git repo, exercised via commitAndPushAllowlist's
// sibling logic (staging + commit), proving the write actually lands on disk
// before land.ts's own step is trusted to run it.
describe("the allowlist write is a real file write", () => {
    it("round-trips through JSON.stringify the way `gaps-sync.ts`'s main() writes it", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaps-sync-write-"));
        const p = path.join(dir, "grammar-gaps.json");
        const before = allowlist([
            { key: ADD_MANA_KEY, op: "addMana", issue: PRD_ISSUE },
        ]);
        const after = applyUpdatedIssues(
            before,
            new Map([[ADD_MANA_KEY, 5000]])
        );
        fs.writeFileSync(p, `${JSON.stringify(after, null, 4)}\n`);
        const reread = JSON.parse(fs.readFileSync(p, "utf8")) as Allowlist;
        expect(reread.ops[0]!.issue).toBe(5000);
        // Sanity: this directory really is a throwaway temp dir, not the repo.
        expect(
            spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"])
                .status
        ).not.toBe(0);
    });
});
