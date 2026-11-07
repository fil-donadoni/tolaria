/**
 * `oracle:report --decks` modern table (issue #8454, PRD #8445): one row per
 * archetype — main names playable / total, playable copies of 60, sideboard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLockfile } from "../lib/oracle-lockfile";
import {
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
                    `^${file.decks[i].slug} +\\d+/\\d+ names +\\d+/60 copies +side 15$`
                )
            );
    });

    it("counts a main name playable only when its state is", () => {
        const deck = file.decks[0];
        const reports = tier1Reports(file, lock, new Set());
        const none = modernDeckLine(deck, reports[0]);
        // Every main oracle id in the pool => every main name is `ours`.
        const all = new Set(reports[0].cards.map((c) => c.oracleId));
        const full = modernDeckLine(
            deck,
            tier1Reports({ decks: [deck] }, lock, all)[0]
        );
        const names = new Set(deck.main.map((e) => e.name)).size;
        expect(full).toContain(`${names}/${names} names`);
        expect(full).toContain("60/60 copies");
        expect(none).not.toBe(full);
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

    it("refuses a list that is not 60 + 15", () => {
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
        expect(() => parseMetagameDecks(text)).toThrow(/not 60 \+ 15/);
    });
});
