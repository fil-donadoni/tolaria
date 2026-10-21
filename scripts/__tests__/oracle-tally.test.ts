/**
 * The lockfile's tallies are derived from its rows on read (ADR 0157 § 1a,
 * issue #6244): one function per figure, over a fixture lockfile.
 */

import { describe, expect, it } from "vitest";
import type { CardRow } from "../lib/oracle-lockfile";
import { deriveCounts, deriveFormats } from "../lib/oracle-tally";

const row = (
    oracleId: string,
    state: CardRow["state"],
    extra: Partial<CardRow> = {}
): CardRow => ({ oracleId, name: oracleId, state, ...extra });

const CARDS: CardRow[] = [
    row("a", "ready", { poolIn: ["premodern", "modern"] }),
    row("b", "ready", { poolIn: ["premodern"] }),
    row("c", "quarantine", { poolIn: ["modern"] }),
    row("d", "unparsed", {
        poolIn: ["premodern", "modern"],
        bannedIn: ["modern"],
    }),
    row("e", "unparsed"),
];

describe("deriveCounts", () => {
    it("tallies the rows by state and totals them", () => {
        expect(deriveCounts(CARDS)).toEqual({
            ready: 2,
            quarantine: 1,
            unparsed: 2,
            total: 5,
        });
    });
});

describe("deriveFormats", () => {
    const formats = deriveFormats(CARDS, new Set(["a", "d"]));

    it("counts a card in each format it is legal in, by state", () => {
        expect(formats.premodern).toEqual({
            total: 3,
            ready: 2,
            quarantine: 0,
            unparsed: 1,
            pool: 2,
        });
    });

    it("leaves a banned or restricted card out of the format it is banned in", () => {
        expect(formats.modern).toEqual({
            total: 2,
            ready: 1,
            quarantine: 1,
            unparsed: 0,
            pool: 1,
        });
    });

    it("keeps a row for every reported format, zeroed when no card is legal", () => {
        expect(formats.pauper).toEqual({
            total: 0,
            ready: 0,
            quarantine: 0,
            unparsed: 0,
            pool: 0,
        });
    });
});
