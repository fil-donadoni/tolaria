/**
 * `backlog:triage` — the band rule of issue #3851 decision 3 (issue #4054).
 *
 * The rule is tested as the pure function it is, over a synthetic Target
 * registry and a synthetic lockfile; the I/O half (`runTriage`) is driven with
 * a recording `ghClient`, which is what pins "zero mutations" and "the board
 * read is the shared single-field query, never a whole-board item list".
 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_ISSUES_QUERY, runTriage } from "../backlog-triage";
import {
    cardBandIndex,
    cardsNamedByEngineTitle,
    claimedCards,
    issueCards,
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
        });
        const issues = [issue(1)];
        const s = summarize(issues, triage(issues, index, {}, 9999), {});
        expect(s.residue.map((r) => r.number)).toEqual([1]);
        expect(s.perBand.P3.hold).toBe(0);
    });

    it("an edge pointing at residue contributes nothing", () => {
        expect(verdictOf([issue(1, { blocks: [2] }), issue(2)])).toEqual({
            kind: "residue",
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
        expect(v.get(1)).toEqual({ kind: "residue" });
        // A cycle terminates and bands nothing out of thin air.
        const cycle = [issue(1, { blocks: [2] }), issue(2, { blocks: [1] })];
        expect([...triage(cycle, index, {}, 9999).values()]).toEqual([
            { kind: "residue" },
            { kind: "residue" },
        ]);
    });

    it("a blocked issue's board value (short of P0) lends nothing — only its seed does", () => {
        expect(
            verdictOf([issue(1, { blocks: [2] }), issue(2)], { 2: "P1" })
        ).toEqual({ kind: "residue" });
        // A hand-set P0 lends P1: the script never writes P0.
        expect(
            verdictOf([issue(1, { blocks: [2] }), issue(2)], { 2: "P0" })
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

    it("the fiat root and its direct children are P1 by fiat", () => {
        const issues = [issue(9999), issue(1, { parent: 9999 })];
        const v = triage(issues, index, {}, 9999);
        expect(v.get(9999)).toMatchObject({ band: "P1", source: "fiat" });
        expect(v.get(1)).toMatchObject({ band: "P1", source: "fiat" });
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
        expect(verdictOf([issue(1, { cards })])).toEqual({ kind: "residue" });
        expect(
            cardsNamedByEngineTitle(
                "[engine] Mayhem keyword — blocks Carnage, Crimson Chaos",
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

describe("backlog-triage — summary", () => {
    it("counts gain / change / unchanged against the board, and lists residue with its board value", () => {
        const issues = [
            issue(1, { cards: [CARDS.Meta] }), // gain P1
            issue(2, { cards: [CARDS.Meta] }), // change P2 → P1
            issue(3, { cards: [CARDS.Cube] }), // unchanged P2
            issue(4, { title: "orphan" }), // residue, board P3
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
            { number: 4, title: "orphan", board: "P3" },
        ]);
        expect(s.perSource.cards).toBe(3);
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
                                totalCount: 2,
                                pageInfo: { hasNextPage: false },
                                nodes: [
                                    {
                                        number: 7,
                                        title: "hand-set",
                                        parent: null,
                                        blocking: { totalCount: 0, nodes: [] },
                                    },
                                    {
                                        number: 8,
                                        title: "nothing",
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

        // Exactly the two reads, both GraphQL queries — nothing else.
        expect(calls).toHaveLength(2);
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

    it("refuses --write by name", () => {
        expect(() =>
            runTriage({
                root: ROOT,
                argv: ["--write"],
                ghClient: recordingGh([]),
            })
        ).toThrow(/dry-run only/);
    });
});
