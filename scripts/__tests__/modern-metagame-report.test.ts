/**
 * `oracle:report --decks` modern table (issue #8454, PRD #8445): one row per
 * archetype — playable copies of the main 60, of the sideboard 15, of the 75
 * (issue #8453: the same `deckPlayability` the Preset Deck seed gates on).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLockfile } from "../lib/oracle-lockfile";
import {
    deckPlayability,
    modernDeckLine,
    tier1Reports,
    type Tier1Deck,
} from "../lib/tier1-decks";
import {
    parseMetagameDecks,
    readModernMetagameDecks,
} from "../premodern-metagame-import";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const lock = parseLockfile(
    readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
);

describe("modern metagame report rows", () => {
    const file = readModernMetagameDecks(ROOT);

    it("prints one row per archetype, ten in all", () => {
        const reports = tier1Reports(file, lock, new Set());
        const lines = file.decks.map((d, i) => modernDeckLine(d, reports[i]));
        expect(lines).toHaveLength(10);
        for (const [i, line] of lines.entries())
            expect(line).toMatch(
                new RegExp(
                    `^${file.decks[i].slug} +main +(\\d+)/60 +side +(\\d+)/15 +(\\d+)/75$`
                )
            );
    });

    it("counts a copy playable only when its card's state is", () => {
        const deck = file.decks[0];
        // Every oracle id of the list in the pool => every card is `ours`.
        const all = new Set(
            tier1Reports({ decks: [deck] }, lock, new Set())[0].cards.map(
                (c) => c.oracleId
            )
        );
        const full = modernDeckLine(
            deck,
            tier1Reports({ decks: [deck] }, lock, all)[0]
        );
        expect(full).toMatch(/main +60\/60 +side +15\/15 +75\/75$/);
        // A sideboard card that is not playable is counted out of the 15 —
        // the gap `copies of 60` used to hide.
        const sideCard = deck.sideboard.find(
            (e) => !deck.main.some((m) => m.name === e.name)
        )!;
        const [report] = tier1Reports({ decks: [deck] }, lock, all);
        const held = {
            ...report,
            cards: report.cards.map((c) =>
                c.name === sideCard.name
                    ? { ...c, state: "unparsed" as const }
                    : c
            ),
        };
        const short = deckPlayability(deck, held);
        expect(short.side).toBe(15 - sideCard.count);
        expect(short.missing.map((c) => c.name)).toEqual([sideCard.name]);
        expect(modernDeckLine(deck, held)).toContain(
            `side ${`${15 - sideCard.count}/15`.padStart(5)}`
        );
    });

    it("fails closed on a name the lockfile cannot resolve", () => {
        const bad: Tier1Deck = {
            ...file.decks[0],
            main: [
                { count: 59, name: "Forest" },
                { count: 1, name: "Not A Real Card" },
            ],
        };
        expect(() => tier1Reports({ decks: [bad] }, lock, new Set())).toThrow(
            /Not A Real Card/
        );
    });

    it("refuses a main deck under 60 (CR 100.2a)", () => {
        const text = JSON.stringify({
            source: { supplier: "x", format: "MO", note: "" },
            decks: [
                {
                    slug: "a",
                    name: "A",
                    main: [{ count: 59, name: "Forest" }],
                    sideboard: [],
                },
            ],
        });
        expect(() => parseMetagameDecks(text)).toThrow(
            /59 \+ 0, outside the constructed bounds/
        );
    });
});
