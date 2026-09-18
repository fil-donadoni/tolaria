/**
 * The pinned mtgtop8 metagame import (issue #3855, wayfinder map #3846): 25
 * archetype decklists plus their fetch provenance, read the same fail-closed
 * way as the Premodern Tier 1 lists (`scripts/lib/tier1-decks.ts`).
 *
 * Two jobs, deliberately: FAIL-CLOSED unit tests on fixtures (what happens
 * when the committed data is wrong), and a shape/bijection assertion on the
 * real committed files — every archetype id in the pin resolves to exactly
 * one list in the decks file, and vice versa.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseLockfile } from "../lib/oracle-lockfile";
import { poolOracleIdsFromIndex } from "../oracle-compile";
import { tier1Reports, type Tier1Deck } from "../lib/tier1-decks";
import {
    ARCHETYPES,
    parseMetagameDecks,
    parseMetagamePin,
    readMetagameDecks,
    readMetagamePin,
} from "../premodern-metagame-import";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

/** 60 + 15 built from four names, so the size validation is satisfiable. */
function fixtureDeck(overrides: Partial<Tier1Deck> = {}): Tier1Deck {
    return {
        slug: "fixture",
        name: "Fixture",
        main: [
            { count: 4, name: "Goblin Lackey" },
            { count: 56, name: "Mountain" },
        ],
        sideboard: [{ count: 15, name: "Goblin Sharpshooter" }],
        ...overrides,
    };
}

describe("parseMetagameDecks — fail-closed, same shape as Tier 1", () => {
    const file = (deck: Tier1Deck): string =>
        JSON.stringify({
            source: { supplier: "mtgtop8.com", format: "PREM", note: "x" },
            decks: [deck],
        });

    it("accepts a 60 + 15 list", () => {
        expect(parseMetagameDecks(file(fixtureDeck())).decks).toHaveLength(1);
    });

    it("refuses a maindeck that is not 60", () => {
        const short = fixtureDeck({
            main: [{ count: 4, name: "Goblin Lackey" }],
        });
        expect(() => parseMetagameDecks(file(short))).toThrow(
            /fixture is 4 \+ 15, not 60 \+ 15/
        );
    });

    it("refuses two decks under one slug", () => {
        const text = JSON.stringify({
            source: { supplier: "mtgtop8.com", format: "PREM", note: "x" },
            decks: [fixtureDeck(), fixtureDeck()],
        });
        expect(() => parseMetagameDecks(text)).toThrow(/duplicate deck slug/);
    });

    it("refuses a document with no decks", () => {
        expect(() => parseMetagameDecks('{"decks":[]}')).toThrow(/no decks/);
    });
});

describe("parseMetagamePin — fail-closed", () => {
    const pin = (entries: unknown[]): string =>
        JSON.stringify({
            source: "mtgtop8.com",
            format: "PREM",
            fetchedAt: "2026-09-18T00:00:00.000Z",
            decks: entries,
        });

    it("accepts one entry per archetype id", () => {
        expect(
            parseMetagamePin(
                pin([
                    { slug: "goblin", archetypeId: 1479 },
                    { slug: "psychatog", archetypeId: 1485 },
                ])
            ).decks
        ).toHaveLength(2);
    });

    it("refuses the same archetype id pinned twice", () => {
        expect(() =>
            parseMetagamePin(
                pin([
                    { slug: "goblin", archetypeId: 1479 },
                    { slug: "goblin-2", archetypeId: 1479 },
                ])
            )
        ).toThrow(/archetype 1479 is pinned twice/);
    });

    it("refuses an empty pin", () => {
        expect(() => parseMetagamePin(pin([]))).toThrow(/no pin entries/);
    });
});

describe("the committed metagame import", () => {
    const deckFile = readMetagameDecks(ROOT);
    const pin = readMetagamePin(ROOT);

    it("carries exactly the 25 archetypes named in issue #3855", () => {
        expect(deckFile.decks.map((d) => d.slug).sort()).toEqual(
            ARCHETYPES.map((a) => a.slug).sort()
        );
    });

    it("pins every archetype id exactly once", () => {
        expect(
            pin.decks.map((e) => e.archetypeId).sort((a, b) => a - b)
        ).toEqual(ARCHETYPES.map((a) => a.archetypeId).sort((a, b) => a - b));
    });

    it("every pin entry's slug resolves to exactly one deck-file list", () => {
        // The bijection the acceptance criterion asks for: pin -> decks and
        // decks -> pin agree on the SET of slugs, one-to-one.
        const deckSlugs = new Set(deckFile.decks.map((d) => d.slug));
        for (const entry of pin.decks) {
            expect(deckSlugs.has(entry.slug)).toBe(true);
        }
        expect(pin.decks.map((e) => e.slug).sort()).toEqual(
            deckFile.decks.map((d) => d.slug).sort()
        );
    });

    it("every pinned event/deck/date field is present and non-empty", () => {
        for (const entry of pin.decks) {
            expect(entry.eventId).toBeGreaterThan(0);
            expect(entry.deckId).toBeGreaterThan(0);
            expect(entry.player.length).toBeGreaterThan(0);
            expect(entry.placement.length).toBeGreaterThan(0);
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(entry.fetchedAt.length).toBeGreaterThan(0);
        }
    });

    it("names only cards the Oracle lockfile carries", () => {
        // deckReport throws on an unresolvable name — this is the whole
        // check, same discipline as the Tier 1 lists.
        expect(() =>
            tier1Reports(
                deckFile,
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

describe("the metagame union — v1 exit threshold's denominator (roadmap #3846)", () => {
    it("reports a non-trivial ready percentage over the union of all 25 lists", () => {
        const reports = tier1Reports(
            readMetagameDecks(ROOT),
            parseLockfile(
                readFileSync(join(ROOT, "data", "oracle-compiled.json"), "utf8")
            ),
            poolOracleIdsFromIndex(
                JSON.parse(
                    readFileSync(join(ROOT, "data", "card-index.json"), "utf8")
                ) as { oracleId?: string; source?: string }[]
            )
        );
        const union = new Map<string, string>();
        for (const report of reports) {
            for (const card of report.cards)
                union.set(card.oracleId, card.state);
        }
        // Not asserted at 100% — unlike the hand-curated Tier 1 lists, the
        // metagame import is exactly the cards a live tournament played, gaps
        // included; the number IS the report.
        expect(union.size).toBeGreaterThan(0);
        const ready = [...union.values()].filter(
            (s) => s === "ours" || s === "ready"
        ).length;
        expect(ready).toBeGreaterThan(0);
        expect(ready).toBeLessThanOrEqual(union.size);
    });
});
