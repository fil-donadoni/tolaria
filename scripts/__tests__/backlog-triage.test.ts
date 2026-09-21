/**
 * `backlog:triage` — the band rule of issue #3851 decision 3 (issue #4054).
 *
 * The rule is tested as the pure function it is, over a synthetic Target
 * registry and a synthetic lockfile; the I/O half (`runTriage`) is driven with
 * a recording `ghClient`, which is what pins "zero mutations" and "the board
 * read is the shared single-field query, never a whole-board item list".
 *
 * The write side (issue #4055) runs against a STATEFUL stub tracker: its
 * mutations move the stub's board, so "the second run writes nothing" is
 * measured on the board the first run left, not asserted by construction.
 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    applyWrites,
    fetchOpenIssues,
    OPEN_ISSUES_QUERY,
    PRIORITY_FIELD_QUERY,
    runTriage,
    WRITE_BATCH,
} from "../backlog-triage";
import {
    cardBandIndex,
    cardsNamedByEngineTitle,
    claimedCards,
    issueCards,
    labelBand,
    planUmbrellas,
    planWrites,
    parseBand,
    parseCards,
    rankTargetBands,
    renderReport,
    residueCause,
    resolveDeclaredCards,
    suggestCards,
    summarize,
    targetBand,
    triage,
    umbrellaSlots,
    type TriageIssue,
} from "../lib/backlog-triage";
import type { BoardPriority } from "../lib/board-priority";
import type { CardRow } from "../lib/oracle-lockfile";

// ── Synthetic lockfile + registry ────────────────────────────────────────

const CARDS = {
    Meta: "id-meta",
    Tier: "id-tier",
    Cube: "id-cube",
    SetOnly: "id-set",
    Fmt: "id-fmt",
    Loose: "id-loose",
    "Wan Shi Tong, Librarian": "id-wan",
} as const;
const byName = (name: string): string | undefined =>
    (CARDS as Record<string, string>)[name];

// A synthetic registry: the three ranked rows in registry order, one row that
// stops lending (a tier1 list carries no `priority`), one card-only set.
const ROWS = [
    { id: "premodern-metagame", priority: 1 },
    { id: "vintage-cube", priority: 2 },
    { id: "set-4ed", priority: 3 },
    { id: "tier1-goblin" },
    { id: "format-premodern" },
];
const syntheticBand = (id: string) =>
    rankTargetBands(ROWS, new Set()).get(id) ?? null;

const index = cardBandIndex(
    [
        { id: "premodern-metagame", ids: [CARDS.Meta] },
        { id: "tier1-goblin", ids: [CARDS.Tier] },
        // A card in both the cube and a set takes the cube's band.
        { id: "vintage-cube", ids: [CARDS.Cube, CARDS.Meta] },
        { id: "set-4ed", ids: [CARDS.SetOnly, CARDS.Cube] },
        { id: "format-premodern", ids: [CARDS.Fmt] },
    ],
    syntheticBand
);

const issue = (
    number: number,
    over: Partial<Omit<TriageIssue, "number">> = {}
): TriageIssue => ({
    number,
    title: `issue ${number}`,
    parent: null,
    blocks: [],
    cards: [],
    ...over,
});

const verdictOf = (
    issues: TriageIssue[],
    board: Record<number, BoardPriority> = {},
    n = issues[0]!.number
) => triage(issues, index, board, 9999).get(n);

describe("backlog-triage — targetBand", () => {
    /** Four Targets, priorities 1 / 2 / 4 / 7 in a scrambled row order. */
    const REGISTRY = [
        { id: "c", priority: 4 },
        { id: "unranked" },
        { id: "a", priority: 1 },
        { id: "d", priority: 7 },
        { id: "b", priority: 2 },
    ];
    const bands = (completed: string[] = []) =>
        Object.fromEntries(
            rankTargetBands(REGISTRY, new Set(completed)).entries()
        );

    it("ranks by priority, not by row order", () => {
        expect(bands()).toEqual({ a: "P1", b: "P2", c: "P3" });
    });

    it("a gap in the numbering costs nothing — c holds priority 4 and is still the 3rd", () => {
        expect(bands().c).toBe("P3");
    });

    it("a Target beyond the third lends nothing", () => {
        expect(bands()).not.toHaveProperty("d");
    });

    it("a completed Target drops out and promotes the next one", () => {
        expect(bands(["a"])).toEqual({ b: "P1", c: "P2", d: "P3" });
        expect(bands(["a", "b"])).toEqual({ c: "P1", d: "P2" });
    });

    it("completing a Target that is not ranked, or not in the registry, changes nothing", () => {
        expect(bands(["unranked", "elsewhere"])).toEqual(bands());
    });

    it("an unranked Target lends null whatever else completes", () => {
        expect(bands()).not.toHaveProperty("unranked");
        expect(bands(["a", "b", "c", "d"])).toEqual({});
    });

    it("reads data/targets.json: the metagame, the cube and the premodern pool rank 1, 2, 3", () => {
        expect(targetBand("premodern-metagame")).toBe("P1");
        expect(targetBand("vintage-cube")).toBe("P2");
        expect(targetBand("format-premodern")).toBe("P3");
    });

    it("no id prefix lends a band — tier1-*, set-* and the other formats carry no priority", () => {
        expect(targetBand("tier1-aluren")).toBeNull();
        expect(targetBand("set-2ed")).toBeNull();
        expect(targetBand("format-legacy")).toBeNull();
        expect(targetBand("someone-elses-list")).toBeNull();
    });

    it("indexes each card at its STRONGEST Target", () => {
        expect(index.get(CARDS.Meta)).toEqual({
            band: "P1",
            target: "premodern-metagame",
        });
        expect(index.get(CARDS.Cube)?.band).toBe("P2");
    });
});

describe("backlog-triage — the rule (issue #3851 decision 3)", () => {
    it("a metagame card → P1; a card only a priority-less list holds lends nothing", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.Meta] })])).toEqual({
            kind: "band",
            band: "P1",
            source: "cards",
            via: "premodern-metagame",
        });
        expect(verdictOf([issue(1, { cards: [CARDS.Tier] })])).toEqual({
            kind: "residue",
            cause: "off-road",
        });
    });

    it("a cube card → P2", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.Cube] })])).toMatchObject({
            band: "P2",
            source: "cards",
        });
    });

    it("the 3rd ranked Target's card → P3; an unranked format's card is residue", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.SetOnly] })])).toMatchObject(
            { band: "P3", source: "cards", via: "set-4ed" }
        );
        expect(verdictOf([issue(1, { cards: [CARDS.Fmt] })])).toEqual({
            kind: "residue",
            cause: "off-road",
        });
    });

    it("no cards but a blocking edge to a P1 → P1", () => {
        const v = verdictOf([
            issue(1, { blocks: [2] }),
            issue(2, { cards: [CARDS.Meta] }),
        ]);
        expect(v).toEqual({
            kind: "band",
            band: "P1",
            source: "edge",
            via: "#2",
        });
    });

    it("a P2 parent → P2 (band inheritance reads the parent's board value)", () => {
        expect(verdictOf([issue(1, { parent: 50 })], { 50: "P2" })).toEqual({
            kind: "band",
            band: "P2",
            source: "parent",
            via: "#50",
        });
    });

    it("all three sources disagreeing → the strongest wins", () => {
        const issues = [
            issue(1, { cards: [CARDS.SetOnly], blocks: [2], parent: 50 }),
            issue(2, { cards: [CARDS.Meta] }),
        ];
        expect(verdictOf(issues, { 50: "P2" })).toMatchObject({
            band: "P1",
            source: "edge",
        });
        // ...whichever source holds the strongest one.
        const flipped = [
            issue(1, { cards: [CARDS.Cube], blocks: [2], parent: 50 }),
            issue(2, { cards: [CARDS.SetOnly] }),
        ];
        expect(verdictOf(flipped, { 50: "P1" })).toMatchObject({
            band: "P1",
            source: "parent",
        });
    });

    it("a hand-set P0 is untouched, whatever its sources say", () => {
        expect(
            verdictOf([issue(1, { cards: [CARDS.SetOnly] })], { 1: "P0" })
        ).toEqual({ kind: "p0" });
        const s = summarize(
            [issue(1, { cards: [CARDS.SetOnly] })],
            triage(
                [issue(1, { cards: [CARDS.SetOnly] })],
                index,
                { 1: "P0" },
                9999
            ),
            { 1: "P0" }
        );
        expect(s.p0).toEqual([1]);
        expect(s.perBand.P3.hold).toBe(0);
    });

    it("no source → residue, unprioritized — never P3", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.Loose] })])).toEqual({
            kind: "residue",
            cause: "off-road",
        });
        const issues = [issue(1)];
        const s = summarize(issues, triage(issues, index, {}, 9999), {});
        expect(s.residue.map((r) => r.number)).toEqual([1]);
        expect(s.perBand.P3.hold).toBe(0);
    });

    it("residue has a cause: no cards = undeclared, cards in no ranked Target = off-road, a ranked-Target card = neither", () => {
        expect(verdictOf([issue(1, { cards: [] })])).toEqual({
            kind: "residue",
            cause: "undeclared",
        });
        expect(verdictOf([issue(1, { cards: [CARDS.Loose] })])).toEqual({
            kind: "residue",
            cause: "off-road",
        });
        expect(verdictOf([issue(1, { cards: [CARDS.Meta] })]).kind).toBe(
            "band"
        );
    });

    it("the cause is read from the issue's own cards, whatever bands the row or its neighbours", () => {
        // #1 declares nothing but blocks a ranked issue → banded by edge, out
        // of the residue; its cause is still computable and still undeclared.
        // #2 has off-road cards and a parent lending nothing → stays residue.
        // #3 has NO cards but a parent that lends P1 → banded; #4 keeps its
        // own cause next to it.
        const issues = [
            issue(1, { blocks: [5] }),
            issue(2, { cards: [CARDS.Loose], parent: 60 }),
            issue(3, { parent: 50 }),
            issue(4, { cards: [CARDS.Loose], parent: 50 }),
            issue(5, { cards: [CARDS.Meta] }),
            issue(60),
        ];
        const v = triage(issues, index, { 50: "P1" }, 9999);
        expect(v.get(1)).toMatchObject({ kind: "band", source: "edge" });
        expect(v.get(3)).toMatchObject({ kind: "band", source: "parent" });
        expect(v.get(4)).toMatchObject({ kind: "band", source: "parent" });
        expect(v.get(2)).toEqual({ kind: "residue", cause: "off-road" });
        expect(v.get(60)).toEqual({ kind: "residue", cause: "undeclared" });
        // The cause is a function of the issue alone: banded rows keep theirs.
        expect(residueCause(issues[0]!)).toBe("undeclared");
        expect(residueCause(issues[3]!)).toBe("off-road");
    });

    it("an edge pointing at residue contributes nothing", () => {
        expect(verdictOf([issue(1, { blocks: [2] }), issue(2)])).toEqual({
            kind: "residue",
            cause: "undeclared",
        });
    });

    it("edges and parents are read ONE level — no fixpoint", () => {
        // 1 blocks 2, 2 blocks 3 (a P1): 2 is P1 by edge, 1 gets nothing.
        const issues = [
            issue(1, { blocks: [2] }),
            issue(2, { blocks: [3] }),
            issue(3, { cards: [CARDS.Meta] }),
        ];
        const v = triage(issues, index, {}, 9999);
        expect(v.get(2)).toMatchObject({ band: "P1", source: "edge" });
        expect(v.get(1)).toEqual({ kind: "residue", cause: "undeclared" });
        // A cycle terminates and bands nothing out of thin air.
        const cycle = [issue(1, { blocks: [2] }), issue(2, { blocks: [1] })];
        expect([...triage(cycle, index, {}, 9999).values()]).toEqual([
            { kind: "residue", cause: "undeclared" },
            { kind: "residue", cause: "undeclared" },
        ]);
    });

    it("a blocked issue's board value (short of P0) lends nothing — only its seed does", () => {
        expect(
            verdictOf([issue(1, { blocks: [2] }), issue(2)], { 2: "P1" })
        ).toEqual({ kind: "residue", cause: "undeclared" });
        // A hand-set P0 lends P1: the script never writes P0.
        expect(
            verdictOf([issue(1, { blocks: [2] }), issue(2)], { 2: "P0" })
        ).toMatchObject({ band: "P1", source: "edge" });
    });

    it("a neighbour lends the STRONGER of its seed and the board value it may lend", () => {
        // Parent: seed P3 (a set card), board P1 → the child inherits P1.
        expect(
            verdictOf(
                [
                    issue(1, { parent: 50 }),
                    issue(50, { cards: [CARDS.SetOnly] }),
                ],
                { 50: "P1" }
            )
        ).toMatchObject({ band: "P1", source: "parent" });
        // Blocked issue: seed P3, hand-set P0 → the blocker is P1.
        expect(
            verdictOf(
                [
                    issue(1, { blocks: [2] }),
                    issue(2, { cards: [CARDS.SetOnly] }),
                ],
                { 2: "P0" }
            )
        ).toMatchObject({ band: "P1", source: "edge" });
    });

    it("a P0 parent lends P1, never P0", () => {
        expect(verdictOf([issue(1, { parent: 50 })], { 50: "P0" })).toEqual({
            kind: "band",
            band: "P1",
            source: "parent",
            via: "#50",
        });
    });

    it("the user-decision root and its direct children are P1", () => {
        const issues = [issue(9999), issue(1, { parent: 9999 })];
        const v = triage(issues, index, {}, 9999);
        expect(v.get(9999)).toMatchObject({
            band: "P1",
            source: "user-decision",
        });
        expect(v.get(1)).toMatchObject({ band: "P1", source: "user-decision" });
    });
});

describe("backlog-triage — `## Band`, the user-decision source (issue #4230)", () => {
    const ruled = (band: "P1" | "P2" | "P3", reason = "because") =>
        ({ band, reason }) as const;

    it("a ruling is the band, via the issue itself", () => {
        expect(verdictOf([issue(1, { ruling: ruled("P2") })])).toEqual({
            kind: "band",
            band: "P2",
            source: "user-decision",
            via: "#1",
        });
    });

    it("beats a STRONGER band from cards, an edge and the parent — the truth, not a candidate", () => {
        // cards → P1, blocks a P1 issue, parent P1 — and the ruling says P3.
        const issues = [
            issue(1, {
                cards: [CARDS.Meta],
                blocks: [2],
                parent: 50,
                ruling: ruled("P3"),
            }),
            issue(2, { cards: [CARDS.Meta] }),
            issue(50, { cards: [CARDS.Meta] }),
        ];
        expect(verdictOf(issues, {}, 1)).toEqual({
            kind: "band",
            band: "P3",
            source: "user-decision",
            via: "#1",
        });
    });

    it("`## Band: P3` under a P1 parent → P3", () => {
        const issues = [
            issue(1, { parent: 50, ruling: ruled("P3") }),
            issue(2, { parent: 50 }),
        ];
        const v = triage(issues, index, { 50: "P1" }, 9999);
        expect(v.get(1)).toMatchObject({ band: "P3", source: "user-decision" });
        // The sibling with no line still inherits.
        expect(v.get(2)).toMatchObject({ band: "P1", source: "parent" });
    });

    it("beats the hard-wired root too", () => {
        const issues = [issue(1, { parent: 9999, ruling: ruled("P3") })];
        expect(triage(issues, index, {}, 9999).get(1)).toMatchObject({
            band: "P3",
            source: "user-decision",
            via: "#1",
        });
    });

    it("a hand-set P0 on the board still wins — the ruling never clears it", () => {
        expect(
            verdictOf([issue(1, { ruling: ruled("P3") })], { 1: "P0" })
        ).toEqual({ kind: "p0" });
    });

    it("a ruled issue lends ITS ruling to a neighbour, never a stale board value", () => {
        // #50 was written P1 on an earlier run, and is now ruled P3: its child
        // inherits P3. The child's neighbour read of #1 (an edge) reads the
        // ruling as well, not the cards that would have banded #1 P1.
        const issues = [
            issue(50, { ruling: ruled("P3") }),
            issue(1, { parent: 50 }),
            issue(2, { blocks: [3] }),
            issue(3, { cards: [CARDS.Meta], ruling: ruled("P3") }),
        ];
        const v = triage(issues, index, { 50: "P1" }, 9999);
        expect(v.get(1)).toMatchObject({ band: "P3", source: "parent" });
        expect(v.get(2)).toMatchObject({ band: "P3", source: "edge" });
    });

    it("a hand-set P0 on a ruled parent still lends P1", () => {
        const issues = [
            issue(50, { ruling: ruled("P3") }),
            issue(1, { parent: 50 }),
        ];
        expect(triage(issues, index, { 50: "P0" }, 9999).get(1)).toMatchObject({
            band: "P1",
            source: "parent",
        });
    });
});

describe("backlog-triage — labelBand, the residue default table (issue #4231)", () => {
    // One case per row of the ADR 0143 table, then the stacking rules.
    const cases: [string, string[], "P1" | "P2" | "P3" | null, string?][] = [
        ["user-report", ["user-report"], "P1", "user-report"],
        ["bug + area:mechanics", ["bug", "area:mechanics"], "P2"],
        ["bug + area:game-bot", ["bug", "area:game-bot"], "P2"],
        ["bug + area:ui-ux", ["bug", "area:ui-ux"], "P2"],
        ["bug + area:cards", ["bug", "area:cards"], "P2"],
        ["bug + area:workflow", ["bug", "area:workflow"], "P3"],
        ["bug + area:monitoring", ["bug", "area:monitoring"], "P3"],
        ["bug + area:admin", ["bug", "area:admin"], "P3"],
        ["bug + area:docs", ["bug", "area:docs"], "P3"],
        [
            "bug + an unnamed area → P3",
            ["bug", "area:limited-bot"],
            "P3",
            "bug",
        ],
        ["bug + no area → P3", ["bug"], "P3", "bug"],
        ["bug + a label that is no area → P3", ["bug", "constructor"], "P3"],
        [
            "enhancement + area:mechanics (any area) → P3",
            ["enhancement", "area:mechanics"],
            "P3",
            "enhancement",
        ],
        ["enhancement + no area", ["enhancement"], "P3", "enhancement"],
        ["prd → no default", ["prd"], null],
        ["prd + area:mechanics → no default", ["prd", "area:mechanics"], null],
        [
            "wayfinder task (none of the four) → no default",
            ["ready-for-agent", "area:workflow"],
            null,
        ],
        ["no labels → no default", [], null],
        // Stacking: user-report first; several areas take the stronger band.
        [
            "user-report beats a bug's weaker area",
            ["bug", "area:docs", "user-report"],
            "P1",
            "user-report",
        ],
        [
            "several areas on a bug take the stronger",
            ["bug", "area:docs", "area:mechanics"],
            "P2",
            "bug + area:mechanics",
        ],
        [
            "bug is read before enhancement",
            ["enhancement", "bug", "area:ui-ux"],
            "P2",
        ],
    ];
    it.each(cases)("%s", (_name, labels, band, via) => {
        const got = labelBand(labels);
        expect(got?.band ?? null).toBe(band);
        if (via !== undefined) expect(got?.via).toBe(via);
    });
});

describe("backlog-triage — the `labels` source, the weakest (issue #4231)", () => {
    const bugMech = ["bug", "area:mechanics"];

    it("a residue issue with a default gets verdict `band`, source `labels`, via the label", () => {
        expect(verdictOf([issue(1, { labels: bugMech })])).toEqual({
            kind: "band",
            band: "P2",
            source: "labels",
            via: "bug + area:mechanics",
        });
    });

    it("a stronger source keeps the row — bug + area:mechanics under a P1 parent → parent/P1, not labels/P2", () => {
        const issues = [issue(1, { parent: 50, labels: bugMech })];
        expect(triage(issues, index, { 50: "P1" }, 9999).get(1)).toEqual({
            kind: "band",
            band: "P1",
            source: "parent",
            via: "#50",
        });
    });

    it("never LIFTS a row a stronger source bands — user-report (P1) under a P3 parent stays parent/P3", () => {
        const issues = [issue(1, { parent: 50, labels: ["user-report"] })];
        expect(triage(issues, index, { 50: "P3" }, 9999).get(1)).toMatchObject({
            band: "P3",
            source: "parent",
        });
    });

    it("never LIFTS a row an edge bands — user-report blocking a P3 issue stays edge/P3", () => {
        const issues = [
            issue(1, { blocks: [2], labels: ["user-report"] }),
            issue(2, { cards: [CARDS.SetOnly] }),
        ];
        expect(verdictOf(issues, {}, 1)).toMatchObject({
            band: "P3",
            source: "edge",
        });
    });

    it("never LOWERS a row cards band — an enhancement (P3) with a P1 card stays cards/P1", () => {
        expect(
            verdictOf([
                issue(1, { cards: [CARDS.Meta], labels: ["enhancement"] }),
            ])
        ).toMatchObject({ band: "P1", source: "cards" });
    });

    it("never touches the hard-wired root's children — user-decision/P1 beats an enhancement", () => {
        const issues = [issue(1, { parent: 9999, labels: ["enhancement"] })];
        expect(triage(issues, index, {}, 9999).get(1)).toMatchObject({
            band: "P1",
            source: "user-decision",
        });
    });

    it("a `## Band` line beats the label default", () => {
        const issues = [
            issue(1, {
                labels: ["user-report"],
                ruling: { band: "P3", reason: "the owner says so" },
            }),
        ];
        expect(verdictOf(issues)).toEqual({
            kind: "band",
            band: "P3",
            source: "user-decision",
            via: "#1",
        });
    });

    it("`prd` and an unlabelled-other row stay residue — even with a stale board value", () => {
        const issues = [
            issue(1, { labels: ["prd"] }),
            issue(2, { labels: ["ready-for-agent", "area:workflow"] }),
            issue(3),
        ];
        const board: Record<number, BoardPriority> = { 1: "P2", 2: "P3" };
        const v = triage(issues, index, board, 9999);
        for (const n of [1, 2, 3])
            expect(v.get(n)).toMatchObject({ kind: "residue" });
        // Neither written nor cleared here — the one-shot clear's job.
        expect(planWrites(v, board)).toEqual([]);
    });

    it("a hand-set P0 on the board is untouched — a label never writes over it", () => {
        expect(
            verdictOf([issue(1, { labels: ["user-report"] })], { 1: "P0" })
        ).toEqual({ kind: "p0" });
    });

    it("a label default lends NOTHING to a neighbour — the seed a neighbour reads stays cards / ruling", () => {
        // #2 blocks #1 and #3 is #1's child; #1 defaults to P1 by label, and
        // neither neighbour inherits it (no board value has been written yet).
        const issues = [
            issue(1, { labels: ["user-report"] }),
            issue(2, { blocks: [1] }),
            issue(3, { parent: 1 }),
        ];
        const v = triage(issues, index, {}, 9999);
        expect(v.get(1)).toMatchObject({ band: "P1", source: "labels" });
        expect(v.get(2)).toMatchObject({ kind: "residue" });
        expect(v.get(3)).toMatchObject({ kind: "residue" });
    });

    it("once a parent's label default is WRITTEN, its child inherits it as `parent` — the accepted one-hop spread across runs", () => {
        const issues = [
            issue(1, { labels: ["bug", "area:cards"] }),
            issue(2, { parent: 1 }),
        ];
        // Run 1: empty board — the child is residue, the parent defaults P2.
        const first = triage(issues, index, {}, 9999);
        expect(first.get(1)).toMatchObject({ band: "P2", source: "labels" });
        expect(first.get(2)).toMatchObject({ kind: "residue" });
        // Run 2: the board holds what run 1 wrote for the parent.
        expect(triage(issues, index, { 1: "P2" }, 9999).get(2)).toMatchObject({
            band: "P2",
            source: "parent",
            via: "#1",
        });
    });

    it("planWrites overwrites a stale board value on a labelled row, and writes nothing once it agrees", () => {
        const issues = [issue(1, { labels: ["user-report"] })];
        const stale = triage(issues, index, { 1: "P3" }, 9999);
        expect(planWrites(stale, { 1: "P3" })).toEqual([
            { number: 1, band: "P1", from: "P3" },
        ]);
        expect(planWrites(stale, { 1: "P1" })).toEqual([]);
    });

    it("the summary counts `labels` like any source, and the report lists only what REMAINS residue", () => {
        const issues = [
            issue(1, { labels: ["user-report"] }), // gain P1
            issue(2, { labels: ["bug", "area:ui-ux"] }), // change P3 → P2
            issue(3, { labels: ["enhancement"] }), // unchanged P3
            issue(4, { title: "an umbrella", labels: ["prd"] }), // residue
        ];
        const board: Record<number, BoardPriority> = { 2: "P3", 3: "P3" };
        const s = summarize(issues, triage(issues, index, board, 9999), board);
        expect(s.perSource).toEqual({
            "user-decision": 0,
            cards: 0,
            edge: 0,
            parent: 0,
            labels: 3,
        });
        expect(s.perBand.P1).toMatchObject({ hold: 1, gain: 1 });
        expect(s.perBand.P2).toMatchObject({ hold: 1, change: 1 });
        expect(s.perBand.P3).toMatchObject({ hold: 1, unchanged: 1 });
        expect(s.residue.map((r) => r.number)).toEqual([4]);
        const report = renderReport(s);
        expect(report).toContain(
            "by source: user-decision 0, cards 0, edge 0, parent 0, labels 3"
        );
        expect(report).toContain("#4 an umbrella");
        expect(report).not.toMatch(/#1 /);
    });
});

describe("backlog-triage — parseBand (issue #4230)", () => {
    const body = (line: string) => `intro\n\n## Band\n\n${line}\n\n## Other\n`;

    it("reads `P2 — <reason>`, bare or as a list item, with the reason", () => {
        for (const line of [
            "P2 — a ruling",
            "- P2 — a ruling",
            "P2 – a ruling",
            "P2 - a ruling",
        ])
            expect(parseBand(5, body(line))).toEqual({
                ruling: { band: "P2", reason: "a ruling" },
                residue: [],
            });
    });

    it("no section, `None.` and an empty section declare nothing", () => {
        for (const b of ["no section", body("None."), "## Band\n"])
            expect(parseBand(5, b)).toEqual({ ruling: null, residue: [] });
    });

    it("a P0 line is reported and yields no band", () => {
        expect(parseBand(5, body("P0 — now"))).toEqual({
            ruling: null,
            residue: [
                { issue: 5, line: "P0 — now", reason: "P0 is never written" },
            ],
        });
    });

    it("an unreadable line — no reason, no band, prose — is reported, never guessed", () => {
        for (const line of ["P2", "P2 —", "P4 — nope", "soon", "P2 — "]) {
            const r = parseBand(5, body(line));
            expect(r.ruling).toBeNull();
            expect(r.residue).toEqual([
                { issue: 5, line: line.trim(), reason: "unreadable" },
            ]);
        }
    });

    it("two lines are reported whole — two rulings have no tiebreak", () => {
        const r = parseBand(5, body("P1 — a\nP3 — b"));
        expect(r.ruling).toBeNull();
        expect(r.residue.map((x) => x.reason)).toEqual([
            "extra line",
            "extra line",
        ]);
    });

    it("a fenced example is not a ruling", () => {
        expect(parseBand(5, "```\n## Band\n\nP1 — example\n```\n")).toEqual({
            ruling: null,
            residue: [],
        });
    });
});

describe("backlog-triage — cards named or unlocked", () => {
    it("an unresolvable card name yields no band, not a wrong one", () => {
        // `cardsNamedByTitle`'s contract: one unresolved name → NO names, so
        // the resolvable Meta does not band the issue on a guess.
        const cards = issueCards(
            { number: 1, title: "[cards] Meta + Not A Card — ship both" },
            new Map(),
            byName
        );
        expect(cards).toEqual([]);
        expect(verdictOf([issue(1, { cards })])).toEqual({
            kind: "residue",
            cause: "undeclared",
        });
        expect(
            cardsNamedByEngineTitle(
                "[engine] Mayhem keyword — blocks Carnage, Crimson Chaos",
                byName
            )
        ).toEqual([]);
        // One resolvable name beside an unresolvable one is still NO names.
        expect(
            cardsNamedByEngineTitle(
                "[engine] Mayhem keyword — blocks Meta, Not A Card",
                byName
            )
        ).toEqual([]);
    });

    it("reads a `[card]` title and an `[engine] … — <Card>` tail", () => {
        expect(
            issueCards(
                { number: 1, title: "[card] Cube — plain DSL ship" },
                new Map(),
                byName
            )
        ).toEqual([CARDS.Cube]);
        expect(
            cardsNamedByEngineTitle(
                "[engine] Impending keyword (CR 702.176) — blocks Meta",
                byName
            )
        ).toEqual(["Meta"]);
        expect(
            cardsNamedByEngineTitle(
                "[engine] X readable — ships Wan Shi Tong, Librarian",
                byName
            )
        ).toEqual(["Wan Shi Tong, Librarian"]);
        expect(
            cardsNamedByEngineTitle(
                "[engine] forEach selector — unblocks Cube, SetOnly (#1120 gap 2)",
                byName
            )
        ).toEqual(["Cube", "SetOnly"]);
        expect(
            cardsNamedByEngineTitle(
                "[engine] Hand-zone access — Cube / SetOnly (#1120 gap 6b)",
                byName
            )
        ).toEqual(["Cube", "SetOnly"]);
        // A clause tail names nothing.
        expect(
            cardsNamedByEngineTitle(
                "[engine] four trigger factories — blocks DSL migration",
                byName
            )
        ).toEqual([]);
    });

    it("maps each claim to the cards it unlocks, per kind", () => {
        const rows = [
            { oracleId: CARDS.Meta, name: "Meta", gaps: [0] },
            {
                oracleId: CARDS.Cube,
                name: "Cube",
                quarantineReasons: [
                    {
                        kind: "planned-op",
                        detail: "Cube (00000000-0000-0000-0000-000000000000): needs fooOp",
                    },
                ],
            },
        ] as unknown as CardRow[];
        const claimed = claimedCards(
            [
                { kind: "grammar", key: "slot › shape", issue: 10 },
                {
                    kind: "mechanic",
                    key: "planned-op › needs fooOp",
                    issue: 11,
                },
                { kind: "hand-tail", key: "SetOnly", issue: 12 },
                { kind: "hand-tail", key: "Not A Card", issue: 13 },
                { kind: "migration", key: "sig", issue: 14 },
            ],
            { cards: rows },
            (row) => (row.oracleId === CARDS.Meta ? ["slot › shape"] : []),
            byName
        );
        expect([...(claimed.get(10) ?? [])]).toEqual([CARDS.Meta]);
        expect([...(claimed.get(11) ?? [])]).toEqual([CARDS.Cube]);
        expect([...(claimed.get(12) ?? [])]).toEqual([CARDS.SetOnly]);
        expect(claimed.has(13)).toBe(false);
        expect(claimed.has(14)).toBe(false);
    });
});

describe("backlog-triage — `## Cards` (issue #4086)", () => {
    it("parseCards reads a list, `None.` as empty, no section as null", () => {
        expect(
            parseCards(
                "## Why\n\ntext\n\n## Cards\n\n- Meta\n- `Cube`\n- **Wan Shi Tong, Librarian**\n\n## Target files\n\n- x.ts\n"
            )
        ).toEqual({
            names: ["Meta", "Cube", "Wan Shi Tong, Librarian"],
            unreadable: [],
        });
        expect(parseCards("## Cards\n\nNone.\n")).toEqual({
            names: [],
            unreadable: [],
        });
        expect(parseCards("## Cards\n\n- None\n")).toEqual({
            names: [],
            unreadable: [],
        });
        expect(parseCards("## Why\n\n- Meta\n")).toBeNull();
    });

    it("ignores a fenced example section and reads the real one after it", () => {
        const body = [
            "## Why",
            "",
            "The form is:",
            "",
            "```markdown",
            "## Cards",
            "",
            "- Psychatog",
            "```",
            "",
            "## Cards",
            "",
            "- Cube",
        ].join("\n");
        expect(parseCards(body)).toEqual({ names: ["Cube"], unreadable: [] });
        // A body that only SHOWS the section declares nothing.
        expect(parseCards(body.split("\n").slice(0, 9).join("\n"))).toBeNull();
    });

    it("a prose line is unreadable, never read as a name", () => {
        expect(
            parseCards("## Cards\n\nThe cards this unblocks:\n- Meta\n")
        ).toEqual({
            names: ["Meta"],
            unreadable: ["The cards this unblocks:"],
        });
    });

    it("one unresolvable line leaves the others' cards in place, banding the issue through triage, and is reported", () => {
        const body = "## Cards\n\n- Not A Card\n- Meta\na sentence, really\n";
        const declared = resolveDeclaredCards(5, body, byName);
        expect(declared.ids).toEqual([CARDS.Meta]);
        expect(declared.residue).toEqual([
            { issue: 5, line: "a sentence, really", reason: "unreadable" },
            { issue: 5, line: "Not A Card", reason: "no such card" },
        ]);
        // An otherwise-residue issue (no claim, no card in its title, no
        // edge, no parent) is banded P1 by its declared metagame card.
        const cards = issueCards(
            { number: 5, title: "[engine] something generic" },
            new Map(),
            byName,
            declared.ids
        );
        const issues = [issue(5, { cards })];
        const verdicts = triage(issues, index, {}, 9999);
        expect(verdicts.get(5)).toEqual({
            kind: "band",
            band: "P1",
            source: "cards",
            via: "premodern-metagame",
        });
        const report = renderReport(
            summarize(issues, verdicts, {}),
            null,
            declared.residue
        );
        expect(report).toContain("## Cards residue");
        expect(report).toContain("#5  Not A Card  — no such card");
        expect(report).toContain("#5  a sentence, really  — unreadable");
    });

    it("suggestCards proposes only strict spans that are a ranked Target's card", () => {
        const ranked = new Set(index.keys());
        const body = [
            "Uses `Meta` and **Cube** as examples; Meta again, `Meta` again.",
            "`Loose` is in no ranked Target; `Not A Card` resolves nothing.",
            "```ts",
            "const x = `SetOnly`;",
            "```",
        ].join("\n");
        expect(suggestCards(body, byName, ranked)).toEqual(["Meta", "Cube"]);
    });
});

describe("backlog-triage — summary", () => {
    it("counts gain / change / unchanged against the board, and lists residue with its board value", () => {
        const issues = [
            issue(1, { cards: [CARDS.Meta] }), // gain P1
            issue(2, { cards: [CARDS.Meta] }), // change P2 → P1
            issue(3, { cards: [CARDS.Cube] }), // unchanged P2
            issue(4, { title: "orphan" }), // residue (undeclared), board P3
            issue(5, { title: "off the road", cards: [CARDS.Loose] }), // residue (off-road), unprioritized
        ];
        const board: Record<number, BoardPriority> = {
            2: "P2",
            3: "P2",
            4: "P3",
        };
        const s = summarize(issues, triage(issues, index, board, 9999), board);
        expect(s.perBand.P1).toEqual({
            hold: 2,
            gain: 1,
            change: 1,
            unchanged: 0,
        });
        expect(s.perBand.P2).toEqual({
            hold: 1,
            gain: 0,
            change: 0,
            unchanged: 1,
        });
        expect(s.residue).toEqual([
            { number: 4, title: "orphan", board: "P3", cause: "undeclared" },
            {
                number: 5,
                title: "off the road",
                board: null,
                cause: "off-road",
            },
        ]);
        expect(s.perCause).toEqual({ undeclared: 1, "off-road": 1 });
        expect(s.perSource.cards).toBe(3);
    });

    it("renderReport prints the two causes apart, each with its own count and board-held figure", () => {
        const issues = [
            issue(1, { title: "orphan A" }),
            issue(2, { title: "orphan B" }),
            issue(3, { title: "off the road", cards: [CARDS.Loose] }),
        ];
        const board: Record<number, BoardPriority> = { 1: "P3", 3: "P2" };
        const report = renderReport(
            summarize(issues, triage(issues, index, board, 9999), board)
        );
        const [head, rest] = report.split("residue — off-road");
        expect(head).toMatch(/residue — undeclared .*: 2 \(1 hold a board/);
        expect(head).toContain("#1 [board P3] orphan A");
        expect(head).toContain("#2 orphan B");
        expect(head).not.toContain("off the road");
        expect(rest).toMatch(/^ .*: 1 \(1 hold a board/);
        expect(rest).toContain("#3 [board P2] off the road");
        expect(rest).not.toContain("orphan");
    });
});

// ── The I/O half: reads only ─────────────────────────────────────────────

const ROOT = resolve(__dirname, "../..");

function recordingGh(calls: string[][]) {
    return (args: string[]): string => {
        calls.push(args);
        const query = args.find((a) => a.startsWith("query=")) ?? "";
        if (query.includes("projectV2"))
            return JSON.stringify([
                {
                    data: {
                        repositoryOwner: {
                            projectV2: {
                                items: {
                                    totalCount: 1,
                                    pageInfo: {
                                        hasNextPage: false,
                                        endCursor: null,
                                    },
                                    nodes: [
                                        {
                                            content: {
                                                __typename: "Issue",
                                                number: 7,
                                                repository: {
                                                    nameWithOwner:
                                                        "fil-donadoni/tolaria",
                                                },
                                            },
                                            fieldValueByName: { name: "P0" },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            ]);
        if (query === `query=${OPEN_ISSUES_QUERY}`)
            return JSON.stringify([
                {
                    data: {
                        repository: {
                            issues: {
                                totalCount: 5,
                                pageInfo: { hasNextPage: false },
                                nodes: [
                                    {
                                        number: 7,
                                        title: "hand-set",
                                        body: "",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                        labels: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 8,
                                        title: "nothing",
                                        body: "An example: `Psychatog`, and `Not A Real Card Name`.",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                        labels: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 9,
                                        title: "declares its cards",
                                        body: "## Cards\n\n- Psychatog\n- Not A Real Card Name\n\n## Band\n\nP0 — now\n",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                        labels: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 10,
                                        title: "ruled by hand",
                                        body: "## Band\n\nP3 — the owner says so\n",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                        labels: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 11,
                                        title: "labelled only",
                                        body: "",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                        labels: {
                                            totalCount: 2,
                                            nodes: [
                                                { name: "bug" },
                                                { name: "area:mechanics" },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            ]);
        throw new Error(`unexpected gh call: ${args.join(" ")}`);
    };
}

describe("backlog-triage — runTriage", () => {
    it("with no flags performs zero mutations, and reads the board through the single-field query", () => {
        const calls: string[][] = [];
        const report = runTriage({
            root: ROOT,
            argv: [],
            ghClient: recordingGh(calls),
        });
        expect(report).toContain("DRY RUN");
        expect(report).toContain(
            "P0 untouched (hand-set, never written or cleared): 1 — #7"
        );
        expect(report).toMatch(/residue .*: 1 /);
        expect(report).toContain("#8 nothing");
        // #8 declares nothing (its backticked names are prose, not a claim).
        expect(report).toMatch(
            /residue — undeclared .*: 1 [^]*#8 nothing[^]*residue — off-road .*: 0 /
        );
        // #9 is banded by its declared card; its typo is reported, not dropped.
        expect(report).not.toContain("#9 declares its cards");
        expect(report).toContain(
            "by source: user-decision 1, cards 1, edge 0, parent 0, labels 1"
        );
        // #11 carries only labels: `bug` + `area:mechanics` → P2, and it is
        // NOT residue (#8 is the one residue row).
        expect(report).toMatch(/^P2 +1 +1 +/m);
        expect(report).not.toContain("#11 labelled only");
        // #10's `## Band` line is the band, read through the driver.
        expect(report).toMatch(/^P3 +1 +1 +/m);
        // #9's P0 line bands nothing (its cards still do) and is reported in its own section.
        expect(report).toMatch(
            /## Band residue[^\n]*: 1\n {2}#9 {2}P0 — now {2}— P0 is never written/
        );
        expect(report).toContain("#9  Not A Real Card Name  — no such card");
        // No flag, no backfill.
        expect(report).not.toContain("Cards suggestions");

        // Exactly the two reads, both GraphQL queries — nothing else; ONE of
        // them the issue query, which carries the bodies.
        expect(calls).toHaveLength(2);
        expect(
            calls.filter((a) => a.includes(`query=${OPEN_ISSUES_QUERY}`))
        ).toHaveLength(1);
        expect(OPEN_ISSUES_QUERY).toMatch(/^\s*body$/m);
        for (const args of calls) {
            expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
            const q = args.find((a) => a.startsWith("query="))!;
            expect(q).not.toMatch(/\bmutation\b/);
        }
        const flat = calls.flat().join(" ");
        expect(flat).not.toContain("item-list");
        expect(flat).not.toContain("item-edit");
        expect(flat).not.toMatch(/\bissue edit\b/);
        expect(flat).toContain('fieldValueByName(name: "Priority")');
    }, 60_000);

    it("--suggest-cards proposes a block per residue issue and performs zero mutations", () => {
        const calls: string[][] = [];
        const report = runTriage({
            root: ROOT,
            argv: ["--suggest-cards"],
            ghClient: recordingGh(calls),
        });
        expect(report).toContain("## Cards suggestions");
        expect(report).toContain("#8\n## Cards\n\n- Psychatog");
        expect(report).not.toContain("- Not A Real Card Name");
        expect(calls).toHaveLength(2);
        for (const args of calls) {
            expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
            expect(args.find((a) => a.startsWith("query="))!).not.toMatch(
                /\bmutation\b/
            );
        }
        expect(calls.flat().join(" ")).not.toMatch(/item-edit|\bissue edit\b/);
    }, 60_000);

    it("refuses --write together with --dry-run", () => {
        expect(() =>
            runTriage({
                root: ROOT,
                argv: ["--write", "--dry-run"],
                ghClient: recordingGh([]),
            })
        ).toThrow(/pick one/);
    });
});

describe("backlog-triage — fetchOpenIssues reads the label names (issue #4231)", () => {
    const page = (labels: { totalCount: number; nodes: { name: string }[] }) =>
        JSON.stringify([
            {
                data: {
                    repository: {
                        issues: {
                            totalCount: 1,
                            pageInfo: { hasNextPage: false },
                            nodes: [
                                {
                                    id: "I_1",
                                    number: 1,
                                    title: "t",
                                    body: "",
                                    parent: null,
                                    blocking: { totalCount: 0, nodes: [] },
                                    labels,
                                },
                            ],
                        },
                    },
                },
            },
        ]);

    it("asks for the names in the same query as the bodies, and carries them", () => {
        expect(OPEN_ISSUES_QUERY).toMatch(/labels\(first: \d+\)/);
        const got = fetchOpenIssues(() =>
            page({
                totalCount: 2,
                nodes: [{ name: "bug" }, { name: "area:ui-ux" }],
            })
        );
        expect(got[0]!.labels).toEqual(["bug", "area:ui-ux"]);
    });

    it("fails closed on a truncated label list — a dropped user-report is a wrong default", () => {
        expect(() =>
            fetchOpenIssues(() =>
                page({ totalCount: 31, nodes: [{ name: "bug" }] })
            )
        ).toThrow(/carries 31 labels, more than one page/);
    });
});

// ── The write side (issue #4055) ─────────────────────────────────────────

describe("backlog-triage — planWrites", () => {
    const band = (b: "P1" | "P2" | "P3") =>
        ({
            kind: "band",
            band: b,
            source: "user-decision",
            via: "#1",
        }) as const;

    it("owes only CHANGED values — a band the board holds owes nothing", () => {
        const verdicts = new Map([
            [1, band("P1")],
            [2, band("P2")],
            [3, band("P3")],
        ]);
        expect(planWrites(verdicts, { 1: "P1", 2: "P3" })).toEqual([
            { number: 2, band: "P2", from: "P3" },
            { number: 3, band: "P3", from: null },
        ]);
    });

    it("never writes over a board P0, even against a band verdict", () => {
        expect(planWrites(new Map([[1, band("P2")]]), { 1: "P0" })).toEqual([]);
    });

    it("a p0 or residue verdict owes no write — not P3, not a clear", () => {
        const verdicts = new Map([
            [1, { kind: "p0" } as const],
            [2, { kind: "residue", cause: "undeclared" } as const],
            [3, { kind: "residue", cause: "off-road" } as const],
        ]);
        expect(planWrites(verdicts, { 1: "P0", 2: "P2" })).toEqual([]);
    });
});

describe("backlog-triage — Target-keyed umbrellas follow their Target (issue #4212)", () => {
    // Three ranked Targets; `premodern-metagame` completes in `after`.
    const RANKED = [
        { id: "premodern-metagame", priority: 1 },
        { id: "vintage-cube", priority: 2 },
        { id: "format-premodern", priority: 3 },
    ];
    const before = (id: string) =>
        rankTargetBands(RANKED, new Set()).get(id) ?? null;
    const after = (id: string) =>
        rankTargetBands(RANKED, new Set(["premodern-metagame"])).get(id) ??
        null;
    const TABLE = {
        ops: {
            P0: 90,
            "premodern-metagame": 91,
            "vintage-cube": 92,
            "format-premodern": 93,
        },
    };
    const ALL_OPEN = new Set([90, 91, 92, 93]);
    // Hand-set once, while `premodern-metagame` was still open.
    const STALE: Record<number, BoardPriority> = {
        90: "P0",
        91: "P1",
        92: "P2",
        93: "P3",
    };

    it("umbrellaSlots skips the P0 slot and an umbrella that is not open", () => {
        expect(umbrellaSlots(TABLE, ALL_OPEN).map((s) => s.number)).toEqual([
            91, 92, 93,
        ]);
        expect(
            umbrellaSlots(TABLE, new Set([90, 92])).map((s) => [
                s.family,
                s.targetId,
            ])
        ).toEqual([["ops", "vintage-cube"]]);
    });

    it("a Target completing owes its umbrellas the shifted values, and the completed one is left alone", () => {
        const slots = umbrellaSlots(TABLE, ALL_OPEN);
        expect(planUmbrellas(slots, STALE, before).writes).toEqual([]);
        expect(planUmbrellas(slots, STALE, after).writes).toEqual([
            {
                number: 92,
                band: "P1",
                from: "P2",
                family: "ops",
                targetId: "vintage-cube",
            },
            {
                number: 93,
                band: "P2",
                from: "P3",
                family: "ops",
                targetId: "format-premodern",
            },
        ]);
    });

    it("never writes a P0 board value, and an unprioritized umbrella gains its band", () => {
        const slots = umbrellaSlots(TABLE, ALL_OPEN);
        const board: Record<number, BoardPriority> = { 92: "P0" };
        expect(
            planUmbrellas(slots, board, after).writes.map((w) => [
                w.number,
                w.from,
                w.band,
            ])
        ).toEqual([[93, null, "P2"]]);
    });

    it("planWrites merges the umbrella writes and never lets an umbrella's own verdict write over them", () => {
        const slots = umbrellaSlots(TABLE, ALL_OPEN);
        const plan = planUmbrellas(slots, STALE, after);
        const inherited = (b: "P1" | "P2" | "P3") =>
            ({
                kind: "band",
                band: b,
                source: "parent",
                via: "#1",
            }) as const;
        const verdicts = new Map([
            [92, inherited("P3")], // stale board, wrong inherited band
            [91, inherited("P2")], // Target lends nothing now — left alone
            [94, inherited("P2")], // an ordinary issue, still written
        ]);
        expect(planWrites(verdicts, STALE, plan)).toEqual([
            {
                number: 92,
                band: "P1",
                from: "P2",
                family: "ops",
                targetId: "vintage-cube",
            },
            {
                number: 93,
                band: "P2",
                from: "P3",
                family: "ops",
                targetId: "format-premodern",
            },
            { number: 94, band: "P2", from: null },
        ]);
        // Once the board agrees, the umbrella's own verdict still owes nothing.
        const settled = { ...STALE, 92: "P1", 93: "P2" } as const;
        expect(
            planWrites(verdicts, settled, planUmbrellas(slots, settled, after))
        ).toEqual([{ number: 94, band: "P2", from: null }]);
    });
});

/**
 * A tracker whose board MOVES: `add` returns the board item (idempotently),
 * `update` sets the option on it. Every call is recorded; every mutation is
 * also recorded per write so a test can read exactly which values moved.
 */
function stubTracker(
    board: Record<number, BoardPriority>,
    open: {
        number: number;
        parent: number | null;
        labels?: readonly string[];
    }[]
) {
    const calls: string[][] = [];
    const mutations: string[] = [];
    const written: { number: number; value: string }[] = [];
    const OPTION: Record<string, string> = {
        P0: "OPT_P0",
        P1: "OPT_P1",
        P2: "OPT_P2",
        P3: "OPT_P3",
    };
    const byOption = Object.fromEntries(
        Object.entries(OPTION).map(([k, v]) => [v, k])
    ) as Record<string, BoardPriority>;
    const client = (args: string[]): string => {
        calls.push(args);
        const query = (args.find((a) => a.startsWith("query=")) ?? "").slice(
            "query=".length
        );
        if (query.includes('fieldValueByName(name: "Priority")'))
            return JSON.stringify([
                {
                    data: {
                        repositoryOwner: {
                            projectV2: {
                                items: {
                                    totalCount: Object.keys(board).length,
                                    pageInfo: {
                                        hasNextPage: false,
                                        endCursor: null,
                                    },
                                    nodes: Object.entries(board).map(
                                        ([n, value]) => ({
                                            content: {
                                                __typename: "Issue",
                                                number: Number(n),
                                                repository: {
                                                    nameWithOwner:
                                                        "fil-donadoni/tolaria",
                                                },
                                            },
                                            fieldValueByName: { name: value },
                                        })
                                    ),
                                },
                            },
                        },
                    },
                },
            ]);
        if (query === OPEN_ISSUES_QUERY)
            return JSON.stringify([
                {
                    data: {
                        repository: {
                            issues: {
                                totalCount: open.length,
                                pageInfo: { hasNextPage: false },
                                nodes: open.map((i) => ({
                                    id: `I_${i.number}`,
                                    number: i.number,
                                    title: `issue ${i.number}`,
                                    parent:
                                        i.parent === null
                                            ? null
                                            : { number: i.parent },
                                    blocking: { totalCount: 0, nodes: [] },
                                    labels: {
                                        totalCount: (i.labels ?? []).length,
                                        nodes: (i.labels ?? []).map((name) => ({
                                            name,
                                        })),
                                    },
                                })),
                            },
                        },
                    },
                },
            ]);
        if (query === PRIORITY_FIELD_QUERY)
            return JSON.stringify({
                data: {
                    repositoryOwner: {
                        projectV2: {
                            id: "PVT_1",
                            field: {
                                id: "FLD_PRIO",
                                options: Object.entries(OPTION).map(
                                    ([name, id]) => ({ id, name })
                                ),
                            },
                        },
                    },
                },
            });
        if (query.startsWith("mutation")) {
            mutations.push(query);
            const data: Record<string, unknown> = {};
            for (const m of query.matchAll(
                /(a\d+): addProjectV2ItemById\(input: \{ projectId: "PVT_1", contentId: "I_(\d+)" \}\)/g
            ))
                data[m[1]!] = { item: { id: `PVTI_${m[2]}` } };
            for (const m of query.matchAll(
                /(u\d+): updateProjectV2ItemFieldValue\(input: \{ projectId: "PVT_1", itemId: "PVTI_(\d+)", fieldId: "FLD_PRIO", value: \{ singleSelectOptionId: "(\w+)" \} \}\)/g
            )) {
                const n = Number(m[2]);
                board[n] = byOption[m[3]!]!;
                written.push({ number: n, value: board[n]! });
                data[m[1]!] = { projectV2Item: { id: `PVTI_${n}` } };
            }
            return JSON.stringify({ data });
        }
        throw new Error(`unexpected gh call: ${args.join(" ")}`);
    };
    return { client, calls, mutations, written };
}

describe("backlog-triage — runTriage --write", () => {
    // #3820 is the user-decision root (PRD_ISSUE): its children are P1. #50 is
    // an umbrella the board holds at P2, so its child inherits P2.
    const OPEN = [
        { number: 7, parent: 3820 }, // P0 on the board — the rule says P1
        { number: 8, parent: null }, // residue, board P3 — must stay P3
        { number: 9, parent: 3820 }, // → P1, unprioritized today (gain)
        { number: 10, parent: 50 }, // → P2, P3 today (change)
        { number: 11, parent: 3820 }, // → P1, P1 today (unchanged)
        { number: 12, parent: null }, // residue, unprioritized — stays so
        { number: 50, parent: null }, // residue umbrella, board P2
    ];
    const BOARD = (): Record<number, BoardPriority> => ({
        7: "P0",
        8: "P3",
        10: "P3",
        11: "P1",
        50: "P2",
    });

    it("a first run writes exactly the changed values; a second run writes nothing", () => {
        const board = BOARD();
        const first = stubTracker(board, OPEN);
        const report = runTriage({
            root: ROOT,
            argv: ["--write"],
            ghClient: first.client,
        });
        expect(first.written).toEqual([
            { number: 9, value: "P1" },
            { number: 10, value: "P2" },
        ]);
        expect(report).toContain(
            "WRITE: 2 board value(s) written (P1 1, P2 1, P3 0"
        );
        // P0 and residue untouched on the board the run left behind.
        expect(board).toEqual({
            7: "P0",
            8: "P3",
            9: "P1",
            10: "P2",
            11: "P1",
            50: "P2",
        });
        // Every mutation names only the changed issues' content ids.
        const touched = first.mutations.join("\n").match(/contentId: "I_\d+"/g);
        expect(touched).toEqual(['contentId: "I_9"', 'contentId: "I_10"']);

        const second = stubTracker(board, OPEN);
        const again = runTriage({
            root: ROOT,
            argv: ["--write"],
            ghClient: second.client,
        });
        expect(second.mutations).toEqual([]);
        // The two reads only — not even the project-metadata read.
        expect(second.calls).toHaveLength(2);
        expect(again).toContain("WRITE: 0 board value(s) written");
    }, 60_000);

    it("a labels-only row is written its default (overwriting a stale value); a prd and a P0 row are not; a second run writes nothing (issue #4231)", () => {
        const open = [
            { number: 20, parent: null, labels: ["user-report"] }, // gain P1
            { number: 21, parent: null, labels: ["bug", "area:cards"] }, // P3 → P2
            { number: 22, parent: null, labels: ["prd"] }, // residue, board P2 stays
            { number: 23, parent: null, labels: ["enhancement"] }, // P0 stays
        ];
        const board: Record<number, BoardPriority> = {
            21: "P3",
            22: "P2",
            23: "P0",
        };
        const first = stubTracker(board, open);
        runTriage({ root: ROOT, argv: ["--write"], ghClient: first.client });
        expect(first.written).toEqual([
            { number: 20, value: "P1" },
            { number: 21, value: "P2" },
        ]);
        expect(board).toEqual({ 20: "P1", 21: "P2", 22: "P2", 23: "P0" });
        const second = stubTracker(board, open);
        runTriage({ root: ROOT, argv: ["--write"], ghClient: second.client });
        expect(second.mutations).toEqual([]);
    }, 60_000);

    it("a dry run writes nothing, even with the write path built", () => {
        const board = BOARD();
        for (const argv of [[], ["--dry-run"]]) {
            const t = stubTracker(board, OPEN);
            const report = runTriage({ root: ROOT, argv, ghClient: t.client });
            expect(report).toContain("DRY RUN");
            expect(t.mutations).toEqual([]);
            expect(t.calls).toHaveLength(2);
        }
        expect(board).toEqual(BOARD());
    }, 60_000);

    it("applyWrites batches, one add and one update request per batch", () => {
        const n = WRITE_BATCH + 3;
        const board: Record<number, BoardPriority> = {};
        const open = Array.from({ length: n }, (_, i) => ({
            number: i + 1,
            parent: null,
        }));
        const t = stubTracker(board, open);
        const writes = open.map((i) => ({
            number: i.number,
            band: "P3" as const,
            from: null,
        }));
        const applied = applyWrites(
            t.client,
            writes,
            new Map(open.map((i) => [i.number, `I_${i.number}`]))
        );
        expect(applied).toHaveLength(n);
        expect(t.mutations).toHaveLength(4);
        expect(Object.keys(board)).toHaveLength(n);
        expect(applyWrites(t.client, [], new Map())).toEqual([]);
        expect(t.calls).toHaveLength(5); // metadata + 4 mutations, none for []
    });

    it("fails closed before any write when the field lacks a band's option", () => {
        const t = stubTracker({}, [{ number: 1, parent: null }]);
        const noP3 = (args: string[]): string => {
            const out = t.client(args);
            if (args.some((a) => a === `query=${PRIORITY_FIELD_QUERY}`)) {
                const res = JSON.parse(out);
                res.data.repositoryOwner.projectV2.field.options =
                    res.data.repositoryOwner.projectV2.field.options.filter(
                        (o: { name: string }) => o.name !== "P3"
                    );
                return JSON.stringify(res);
            }
            return out;
        };
        expect(() =>
            applyWrites(
                noP3,
                [{ number: 1, band: "P3", from: null }],
                new Map([[1, "I_1"]])
            )
        ).toThrow(/no `P3` option/);
        expect(t.mutations).toEqual([]);
    });
    describe("Target-keyed umbrellas (issue #4212)", () => {
        // The real BAND_UMBRELLAS numbers: grammar-rules P0 4091, ops
        // vintage-cube 4097, ops format-premodern 4098, an umbrella that is
        // not open 4099 (bot-gaps P0).
        const wrong = (band: string | null): BoardPriority =>
            band === "P3" ? "P2" : "P3";
        const cube = targetBand("vintage-cube")!;
        const fmt = targetBand("format-premodern")!;
        const open = [
            // Parented under the user-decision root: its OWN verdict says P1.
            { number: 4097, parent: 3820, labels: ["prd"] },
            { number: 4098, parent: null, labels: ["prd"] },
            { number: 4091, parent: null, labels: ["prd"] }, // P0 slot
        ];
        const board = (): Record<number, BoardPriority> => ({
            4097: wrong(cube),
            4098: fmt,
            4091: "P0",
        });

        it("writes the stale umbrella from its Target, never from its own verdict, and a re-run writes nothing", () => {
            const b = board();
            const first = stubTracker(b, open);
            const report = runTriage({
                root: ROOT,
                argv: ["--write"],
                ghClient: first.client,
            });
            expect(first.written).toEqual([{ number: 4097, value: cube }]);
            expect(b).toEqual({ 4097: cube, 4098: fmt, 4091: "P0" });
            expect(report).toContain(
                `#4097  ops / vintage-cube  ${wrong(cube)} → ${cube}`
            );
            expect(report).toContain("1 written");

            const second = stubTracker(b, open);
            runTriage({
                root: ROOT,
                argv: ["--write"],
                ghClient: second.client,
            });
            expect(second.mutations).toEqual([]);
        }, 60_000);

        it("a child of a stale umbrella is banded from the value the umbrella is about to hold — one run converges, the second writes nothing", () => {
            const kids = [
                { number: 4097, parent: null, labels: ["prd"] },
                ...open.slice(1),
                { number: 5000, parent: 4097 },
                { number: 5001, parent: 4097 },
            ];
            const b = board();
            b[5000] = wrong(cube);
            const first = stubTracker(b, kids);
            runTriage({
                root: ROOT,
                argv: ["--write"],
                ghClient: first.client,
            });
            expect(first.written).toEqual([
                { number: 4097, value: cube },
                { number: 5000, value: cube },
                { number: 5001, value: cube },
            ]);
            const second = stubTracker(b, kids);
            runTriage({
                root: ROOT,
                argv: ["--write"],
                ghClient: second.client,
            });
            expect(second.mutations).toEqual([]);
        }, 60_000);

        it("a dry run reports the same umbrella change and writes nothing", () => {
            const b = board();
            const t = stubTracker(b, open);
            const report = runTriage({
                root: ROOT,
                argv: [],
                ghClient: t.client,
            });
            expect(report).toContain("DRY RUN");
            expect(report).toContain("1 to write");
            expect(report).toContain(
                `#4097  ops / vintage-cube  ${wrong(cube)} → ${cube}`
            );
            expect(t.mutations).toEqual([]);
            expect(b).toEqual(board());
        }, 60_000);

        it("an umbrella that is not open is not written", () => {
            const b: Record<number, BoardPriority> = { 4097: wrong(cube) };
            const t = stubTracker(b, [{ number: 12, parent: null }]);
            runTriage({ root: ROOT, argv: ["--write"], ghClient: t.client });
            expect(t.mutations).toEqual([]);
        }, 60_000);
    });
});
