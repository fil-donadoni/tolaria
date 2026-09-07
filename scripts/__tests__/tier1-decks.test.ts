/**
 * The Premodern Tier 1 deck report (issue #2696, PRD #2693 user story 8).
 *
 * Two jobs in one file, deliberately:
 *
 *  - the FAIL-CLOSED unit tests, on fixtures, because every one of them is
 *    about what happens when the canonical data is wrong, and the committed
 *    data is right;
 *  - the PROGRESS SNAPSHOT, on the real lists and the real lockfile, which
 *    asserts nothing about the numbers. It records them. M1's acceptance
 *    (issue #2719) is the ticket that turns this into `expect(playable).toBe(
 *    total)`; until then its only job is to put "goblin went 16/28 -> 19/28"
 *    in the diff of any PR that moves the grammar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLockfile, type CardRow } from "../lib/oracle-lockfile";
import { poolOracleIdsFromIndex } from "../oracle-compile";
import {
    deckReport,
    lockfileRowsByName,
    parseTier1Decks,
    readTier1Decks,
    summaryLines,
    tier1Reports,
    type Tier1Deck,
} from "../lib/tier1-decks";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function row(
    oracleId: string,
    name: string,
    state: CardRow["state"],
    extra: Partial<CardRow> = {}
): CardRow {
    return { oracleId, name, state, ...extra };
}

const FRAGMENTS = [
    { text: "Whenever this creature deals damage to a player, you may ..." },
    { text: "Protection from blue" },
];

const ROWS: CardRow[] = [
    row("id-mountain", "Mountain", "unparsed", { gaps: [0] }),
    row("id-warchief", "Goblin Warchief", "ready"),
    row("id-lackey", "Goblin Lackey", "unparsed", { gaps: [0] }),
    row("id-piledriver", "Goblin Piledriver", "unparsed", { gaps: [1] }),
    row("id-sharpshooter", "Goblin Sharpshooter", "quarantine", {
        quarantineReasons: [
            { kind: "smoke-scenario", detail: 'Op "tapUntap" untaps nothing' },
        ],
    }),
];

const rowsByName = lockfileRowsByName({ cards: ROWS } as never);

/** 60 + 15 built from four names, so the size validation is satisfiable. */
function fixtureDeck(overrides: Partial<Tier1Deck> = {}): Tier1Deck {
    return {
        slug: "fixture",
        name: "Fixture",
        main: [
            { count: 4, name: "Goblin Lackey" },
            { count: 4, name: "Goblin Warchief" },
            { count: 4, name: "Goblin Piledriver" },
            { count: 48, name: "Mountain" },
        ],
        sideboard: [{ count: 15, name: "Goblin Sharpshooter" }],
        ...overrides,
    };
}

describe("parseTier1Decks — fail-closed on the canonical data", () => {
    const file = (deck: Tier1Deck): string =>
        JSON.stringify({
            source: { supplier: "x", suppliedOn: "y", note: "z" },
            shippedPresets: [],
            decks: [deck],
        });

    it("accepts a 60 + 15 list", () => {
        expect(parseTier1Decks(file(fixtureDeck())).decks).toHaveLength(1);
    });

    it("refuses a maindeck that is not 60 — the denominator would be wrong", () => {
        const short = fixtureDeck({
            main: [
                { count: 4, name: "Goblin Lackey" },
                { count: 55, name: "Mountain" },
            ],
        });
        expect(() => parseTier1Decks(file(short))).toThrow(
            /fixture is 59 \+ 15, not 60 \+ 15/
        );
    });

    it("refuses a sideboard that is not 15", () => {
        const wide = fixtureDeck({
            sideboard: [{ count: 16, name: "Goblin Sharpshooter" }],
        });
        expect(() => parseTier1Decks(file(wide))).toThrow(
            /fixture is 60 \+ 16, not 60 \+ 15/
        );
    });

    it("refuses a non-positive count", () => {
        const zero = fixtureDeck({
            main: [
                { count: 0, name: "Goblin Lackey" },
                { count: 60, name: "Mountain" },
            ],
        });
        expect(() => parseTier1Decks(file(zero))).toThrow(/non-positive count/);
    });

    it("refuses two decks under one slug", () => {
        const text = JSON.stringify({
            source: { supplier: "x", suppliedOn: "y", note: "z" },
            shippedPresets: [],
            decks: [fixtureDeck(), fixtureDeck()],
        });
        expect(() => parseTier1Decks(text)).toThrow(/duplicate deck slug/);
    });

    it("refuses a document with no decks", () => {
        expect(() =>
            parseTier1Decks('{"shippedPresets":[],"decks":[]}')
        ).toThrow(/no decks/);
    });
});

describe("lockfileRowsByName", () => {
    it("drops a name the corpus carries twice rather than picking one", () => {
        const ambiguous = lockfileRowsByName({
            cards: [
                row("id-a", "Ineffable Blessing", "ready"),
                row("id-b", "Ineffable Blessing", "unparsed"),
                row("id-c", "Mountain", "ready"),
            ],
        } as never);
        expect(ambiguous.has("Ineffable Blessing")).toBe(false);
        expect(ambiguous.get("Mountain")?.oracleId).toBe("id-c");
    });
});

describe("deckReport", () => {
    it("counts DISTINCT cards, and sums copies across main and sideboard", () => {
        const deck = fixtureDeck({
            main: [
                { count: 4, name: "Goblin Lackey" },
                { count: 4, name: "Goblin Warchief" },
                { count: 4, name: "Goblin Sharpshooter" },
                { count: 48, name: "Mountain" },
            ],
            sideboard: [
                { count: 3, name: "Goblin Sharpshooter" },
                { count: 12, name: "Goblin Piledriver" },
            ],
        });
        const report = deckReport(deck, rowsByName, FRAGMENTS, new Set());
        expect(report.total).toBe(5);
        const sharpshooter = report.cards.find(
            (c) => c.name === "Goblin Sharpshooter"
        );
        expect(sharpshooter?.copies).toBe(7);
        expect(sharpshooter?.slot).toBe("both");
    });

    it("lets a hand-written definition win over the lockfile's state", () => {
        const report = deckReport(
            fixtureDeck(),
            rowsByName,
            FRAGMENTS,
            new Set(["id-lackey"])
        );
        const lackey = report.cards.find((c) => c.name === "Goblin Lackey");
        // The lockfile says `unparsed`; the card is shipped by hand, so it is
        // playable today and the compiler's opinion of it is not the question.
        expect(lackey?.state).toBe("ours");
        expect(report.counts.ours).toBe(1);
        expect(report.playable).toBe(2); // Lackey (ours) + Warchief (ready)
    });

    it("carries the unconsumed fragment as the blocker", () => {
        const report = deckReport(
            fixtureDeck(),
            rowsByName,
            FRAGMENTS,
            new Set()
        );
        expect(
            report.cards.find((c) => c.name === "Goblin Piledriver")?.blocker
        ).toBe("Protection from blue");
    });

    it("carries the quarantine reason as the blocker", () => {
        const report = deckReport(
            fixtureDeck(),
            rowsByName,
            FRAGMENTS,
            new Set()
        );
        expect(
            report.cards.find((c) => c.name === "Goblin Sharpshooter")?.blocker
        ).toBe('smoke-scenario: Op "tapUntap" untaps nothing');
    });

    it("leaves a playable card with no blocker", () => {
        const report = deckReport(
            fixtureDeck(),
            rowsByName,
            FRAGMENTS,
            new Set()
        );
        expect(
            report.cards.find((c) => c.name === "Goblin Warchief")?.blocker
        ).toBeUndefined();
    });

    it("THROWS on a card the lockfile does not carry — never shrinks the denominator", () => {
        const typo = fixtureDeck({
            main: [
                { count: 4, name: "Goblin Lakcey" },
                { count: 4, name: "Goblin Warchief" },
                { count: 4, name: "Goblin Piledriver" },
                { count: 48, name: "Mountain" },
            ],
        });
        expect(() =>
            deckReport(typo, rowsByName, FRAGMENTS, new Set())
        ).toThrow(/names `Goblin Lakcey`/);
    });
});

describe("the committed Tier 1 lists", () => {
    const file = readTier1Decks(ROOT);

    it("carries the six supplied lists, each 60 + 15", () => {
        // parseTier1Decks enforces the sizes; this pins the SET of decks, so
        // dropping one from the canonical file is a red rather than a quietly
        // shorter report.
        expect(file.decks.map((d) => d.slug)).toEqual([
            "goblin",
            "psychatog",
            "parallax-replenish",
            "landstill",
            "oath-ponza",
            "aluren",
        ]);
    });

    it("references the shipped Premodern presets by slug, with no card list", () => {
        expect(file.shippedPresets.map((p) => p.slug)).toEqual([
            "deck-1",
            "burn",
            "enchantress",
        ]);
        for (const preset of file.shippedPresets) {
            expect(Object.keys(preset).sort()).toEqual(["name", "slug"]);
        }
    });

    it("names only cards the Oracle lockfile carries", () => {
        // The report throws on an unresolvable name, so this is the whole
        // check: a typo in the canonical data reds here and nowhere else.
        expect(() =>
            tier1Reports(
                file,
                parseLockfile(
                    readFileSync(
                        join(ROOT, "data", "oracle-compiled.json"),
                        "utf8"
                    )
                ),
                new Set()
            )
        ).not.toThrow();
    });
});

describe("M1 progress", () => {
    /**
     * NON-ASSERTING (issue #2696 acceptance criterion 3). The snapshot is a
     * record, not a requirement: it goes red only when a number MOVES, which is
     * exactly when a human should look at it. Issue #2719 replaces it with the
     * real assertion — every deck N/N.
     */
    it("records the per-deck summary so the diff shows progress", () => {
        const lock = parseLockfile(
            readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
        );
        const index = JSON.parse(
            readFileSync(join(ROOT, "data", "card-index.json"), "utf8")
        ) as { oracleId?: string; source?: string }[];
        const reports = tier1Reports(
            readTier1Decks(ROOT),
            lock,
            poolOracleIdsFromIndex(index)
        );
        expect(summaryLines(reports).join("\n")).toMatchSnapshot();
    });
});
