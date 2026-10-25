// Catalogue guard — an "As … enters, choose/name …" clause is never a trigger
// (issue #2672).
//
// CR 603.6d: "As [this permanent] enters …" text is a static ability, not a
// triggered ability. CR 614.1c makes it a replacement effect and CR 614.12a
// makes its choice BEFORE the permanent enters. The engine's one seam for that
// is `entersWith.asEnters` (ADR 0100). Authoring the clause as an ETB trigger
// instead — a `triggeredAbilities` entry whose own text is the "As … enters"
// sentence — puts the choice on the stack AFTER the permanent entered: it sits
// on the battlefield without its choice while the opponent holds priority
// (Multiversal Passage asked for 2 life before its land type, issue #2672).
// This guard keeps the next card from being authored back onto that shape.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { CardDefinition } from "../types";

/** "As this land enters, choose …", "As Lost Order of Jarkeld enters, choose
 *  …", "As this Aura enters, name …" — one sentence, never across a full
 *  stop. */
const AS_ENTERS_CHOICE = /\bAs [^.\n]*?\benters\b[^.\n]*?,\s*(choose|name)\b/i;

/** The triggered abilities that restate the card's "As … enters" sentence —
 *  the clause authored as a trigger. */
function asEntersTriggers(def: CardDefinition): string[] {
    if (!AS_ENTERS_CHOICE.test(def.oracleText ?? "")) return [];
    return (def.triggeredAbilities ?? [])
        .filter((t) => /^\s*As\b[^.\n]*\benters\b/i.test(t.oracleText ?? ""))
        .map((t) => t.id ?? t.oracleText ?? "?");
}

describe("an as-enters choice is an entersWith.asEnters replacement, never a trigger (CR 603.6d / 614.12a, issue #2672)", () => {
    it("no shipped card expresses an 'As … enters, choose/name' clause as a triggered ability", () => {
        const offenders: string[] = [];
        for (const def of getAllCards()) {
            const triggers = asEntersTriggers(def);
            if (triggers.length === 0) continue;
            offenders.push(`${def.name} (${def.id}): ${triggers.join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });
});
