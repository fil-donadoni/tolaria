// Normalisation is the only step allowed to remove text (convex/oracle/normalize.ts),
// so it is the only place the all-consuming invariant could leak. Every removal
// is asserted here to be either typographic or CR-sanctioned.

import { describe, expect, it } from "vitest";
import {
    normalizeOracleText,
    SELF_MARKER,
    stripReminderText,
    substituteSelf,
} from "../normalize";
import { readManaCost, tokenizeManaSymbols } from "../manaCost";
import { readTypeLine } from "../typeLine";
import { oracleCard } from "./fixtures";

describe("reminder text (CR 207.2a)", () => {
    it("removes a parenthesised summary and keeps the rules text", () => {
        const r = stripReminderText(
            "Flying (This creature can't be blocked except by …)"
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.text.lines[0]).toBe("Flying ");
    });

    it("removes a line that is nothing but reminder text", () => {
        const r = normalizeOracleText(
            oracleCard({ oracleText: "({T}: Add {G}.)", name: "Forest" })
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.text.lines).toEqual([]);
    });

    it("fails closed on unbalanced parentheses rather than repairing them", () => {
        expect(stripReminderText("Flying (unclosed").ok).toBe(false);
        expect(stripReminderText("Flying) stray").ok).toBe(false);
    });
});

describe("self reference (CR 201.5)", () => {
    it("substitutes a whole-token occurrence of the card's own name", () => {
        expect(
            substituteSelf("Lightning Bolt deals 3 damage.", "Lightning Bolt")
        ).toBe(`${SELF_MARKER} deals 3 damage.`);
    });

    it("does not corrupt a longer word that merely contains the name", () => {
        expect(substituteSelf("Fearsome creatures attack.", "Fear")).toBe(
            "Fearsome creatures attack."
        );
    });

    it("leaves the marker unreadable by grammar v0, so a self-reference fails closed", () => {
        const r = normalizeOracleText(
            oracleCard({
                name: "Test Card",
                oracleText: "Test Card deals 1 damage to any target.",
            })
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.text.lines[0]).toContain(SELF_MARKER);
    });
});

describe("typography and line splitting", () => {
    it("collapses whitespace and drops empty lines only", () => {
        const r = normalizeOracleText(
            oracleCard({ oracleText: "Flying\n\nTrample  \n" })
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.text.lines).toEqual(["Flying", "Trample"]);
    });

    it("normalises curly quotes without changing word content", () => {
        const r = normalizeOracleText(
            oracleCard({ oracleText: "It can’t be blocked." })
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.text.lines).toEqual(["It can't be blocked."]);
    });
});

describe("mana cost (CR 107.4)", () => {
    it("reads generic into the X slot and colours into their own", () => {
        expect(readManaCost("{1}{G}")).toEqual({
            ok: true,
            cost: { X: 1, G: 1 },
        });
        expect(readManaCost("{G}{G}")).toEqual({ ok: true, cost: { G: 2 } });
        expect(readManaCost("")).toEqual({ ok: true, cost: {} });
    });

    it("reads a variable X, its factor, and fixed generic beside it (CR 107.3)", () => {
        expect(readManaCost("{X}{U}")).toEqual({
            ok: true,
            cost: { X: "X", U: 1 },
        });
        expect(readManaCost("{X}{X}{U}")).toEqual({
            ok: true,
            cost: { X: "X", xFactor: 2, U: 1 },
        });
        expect(readManaCost("{X}{2}{B}")).toEqual({
            ok: true,
            cost: { X: "X", generic: 2, B: 1 },
        });
    });

    it("reads Phyrexian (CR 107.4f) and guild hybrid (CR 107.4e) pips", () => {
        expect(readManaCost("{1}{B/P}{B/P}")).toEqual({
            ok: true,
            cost: { X: 1, phyrexian: { B: 2 } },
        });
        expect(readManaCost("{B/G}")).toEqual({
            ok: true,
            cost: { hybrid: [["B", "G"]] },
        });
    });

    it("FAILS on a symbol ManaCost cannot represent instead of approximating it", () => {
        // {2/W} monocolour hybrid and {S} snow have no encoding; a lenient
        // reader would call them "generic 2" and "generic 1" and be wrong.
        expect(readManaCost("{2/W}").ok).toBe(false);
        expect(readManaCost("{S}").ok).toBe(false);
    });

    it("fails on anything outside a symbol", () => {
        expect(tokenizeManaSymbols("{1} {G}").ok).toBe(false);
        expect(tokenizeManaSymbols("{1").ok).toBe(false);
    });
});

describe("type line (CR 205.1)", () => {
    it("splits supertypes, types and subtypes", () => {
        expect(readTypeLine("Legendary Creature — Human Wizard")).toEqual({
            ok: true,
            parsed: {
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Human", "Wizard"],
            },
        });
    });

    it("reads a multi-type line", () => {
        const r = readTypeLine("Artifact Creature — Thopter");
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.parsed.types).toEqual(["Artifact", "Creature"]);
    });

    it("fails on an unknown word rather than guessing a type", () => {
        expect(readTypeLine("Conspiracy").ok).toBe(false);
        expect(readTypeLine("Creature Bear").ok).toBe(false);
        expect(readTypeLine("— Bear").ok).toBe(false);
    });
});
