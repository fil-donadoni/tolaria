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
//
// Escape hatch: a row in AS_ENTERS_TRIGGER_ALLOWLIST whose value is
// `tracked-by: #NNN` (Guard B's disposition shape, `divergenceMarkers.test.ts`)
// — an open issue that migrates the card. A row whose card no longer offends
// reds too, so a migrated card cannot leave a stale exemption behind.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { CardDefinition } from "../types";

/** "As this land enters, choose …", "As Lost Order of Jarkeld enters, choose
 *  …", "As this Aura enters, name …" — one sentence, never across a full
 *  stop. */
const AS_ENTERS_CHOICE = /\bAs [^.\n]*?\benters\b[^.\n]*?,\s*(choose|name)\b/i;

/** Cards still authored on the trigger shape, each with its migration issue. */
const AS_ENTERS_TRIGGER_ALLOWLIST: Readonly<Record<string, string>> = {
    "Alloy Golem": "tracked-by: #6483",
};

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
            if (AS_ENTERS_TRIGGER_ALLOWLIST[def.name] !== undefined) continue;
            offenders.push(`${def.name} (${def.id}): ${triggers.join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });

    it("every allowlist row names an issue and still names an offending card", () => {
        const offending = new Set(
            getAllCards()
                .filter((def) => asEntersTriggers(def).length > 0)
                .map((def) => def.name)
        );
        for (const [name, disposition] of Object.entries(
            AS_ENTERS_TRIGGER_ALLOWLIST
        )) {
            expect(disposition, name).toMatch(/^tracked-by: #\d+$/);
            expect(
                offending.has(name),
                `${name} is no longer an offender — drop its row`
            ).toBe(true);
        }
    });
});
