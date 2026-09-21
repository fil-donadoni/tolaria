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
    planWrites,
    parseBand,
    parseCards,
    renderReport,
    residueCause,
    resolveDeclaredCards,
    suggestCards,
    summarize,
    targetBand,
    triage,
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

const index = cardBandIndex([
    { id: "premodern-metagame", ids: [CARDS.Meta] },
    { id: "tier1-goblin", ids: [CARDS.Tier] },
    // A card in both the cube and a set takes the cube's band.
    { id: "vintage-cube", ids: [CARDS.Cube, CARDS.Meta] },
    { id: "set-4ed", ids: [CARDS.SetOnly, CARDS.Cube] },
    { id: "format-premodern", ids: [CARDS.Fmt] },
]);

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
    it("ranks the Target ids decision 3 names, and lends nothing for others", () => {
        expect(targetBand("premodern-metagame")).toBe("P1");
        expect(targetBand("tier1-aluren")).toBe("P1");
        expect(targetBand("vintage-cube")).toBe("P2");
        expect(targetBand("set-2ed")).toBe("P3");
        expect(targetBand("format-legacy")).toBe("P3");
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
    it("a metagame card → P1, a tier1 card → P1", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.Meta] })])).toEqual({
            kind: "band",
            band: "P1",
            source: "cards",
            via: "premodern-metagame",
        });
        expect(verdictOf([issue(1, { cards: [CARDS.Tier] })])).toMatchObject({
            band: "P1",
            via: "tier1-goblin",
        });
    });

    it("a cube card → P2", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.Cube] })])).toMatchObject({
            band: "P2",
            source: "cards",
        });
    });

    it("a set-only (or format-only) card → P3", () => {
        expect(verdictOf([issue(1, { cards: [CARDS.SetOnly] })])).toMatchObject(
            { band: "P3", source: "cards", via: "set-4ed" }
        );
        expect(verdictOf([issue(1, { cards: [CARDS.Fmt] })])).toMatchObject({
            band: "P3",
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
                                totalCount: 4,
                                pageInfo: { hasNextPage: false },
                                nodes: [
                                    {
                                        number: 7,
                                        title: "hand-set",
                                        body: "",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 8,
                                        title: "nothing",
                                        body: "An example: `Psychatog`, and `Not A Real Card Name`.",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 9,
                                        title: "declares its cards",
                                        body: "## Cards\n\n- Psychatog\n- Not A Real Card Name\n\n## Band\n\nP0 — now\n",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 10,
                                        title: "ruled by hand",
                                        body: "## Band\n\nP3 — the owner says so\n",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
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
        expect(report).toContain("by source: user-decision 1, cards 1");
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

/**
 * A tracker whose board MOVES: `add` returns the board item (idempotently),
 * `update` sets the option on it. Every call is recorded; every mutation is
 * also recorded per write so a test can read exactly which values moved.
 */
function stubTracker(
    board: Record<number, BoardPriority>,
    open: { number: number; parent: number | null }[]
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
});
