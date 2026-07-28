// Catalogue-wide guard — "enters with N counters" is a REPLACEMENT effect,
// never a triggered ability (CR 614.1c + CR 121.6, issue #1693).
//
// CR 121.6: "If an effect says a permanent enters the battlefield with counters
// on it, those counters are put onto that permanent as it enters." CR 614.1c
// classifies that as a self-replacement effect: it modifies HOW the object
// enters, so the counters are already there the first instant the permanent is
// observable on the battlefield.
//
// The obsolete shape modelled the clause as a `PERMANENT_ENTERED` triggered
// ability carrying a `counters` Op aimed at `$source`. That is wrong on four
// counts: the permanent sits on the battlefield with ZERO counters, a stack
// item is created, both players get priority in that zero-counter window, and
// the clause renders as a respondable ability on the stack / in the inspector.
//
// The correct declarative surface is `CardDefinition.entersWith.counters` —
// sibling to `entersTapped` / `entersTappedUnless`, applied by the shared
// `applyEntersWithCounters` oracle (`convex/cards/entersWith.ts`) at every
// permanent-entry site BEFORE `emitPermanentEntered` scans triggers.
//
// Out of scope for this guard (intentionally NOT flagged): a genuinely
// triggered counter placement — "when this enters, put a counter on ANOTHER
// permanent" — which stays a trigger because it does not modify how THIS
// permanent enters.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { CardDefinition, EffectOp, TriggeredAbility } from "../types";

/** The printed wording of the CR 121.6 replacement, across the modern Oracle
 *  templating ("~ enters with …") and the older forms the catalogue still
 *  carries verbatim on reprints ("enters the battlefield with …", "comes into
 *  play with …"). Requires the clause to actually name a counter. */
const ENTERS_WITH_COUNTERS =
    /\benters(?: the battlefield)? with\b[^.\n]*\bcounter/i;
const COMES_INTO_PLAY_WITH_COUNTERS =
    /\bcomes into play with\b[^.\n]*\bcounter/i;

function printsEntersWithCounters(text: string | undefined): boolean {
    if (!text) return false;
    return (
        ENTERS_WITH_COUNTERS.test(text) ||
        COMES_INTO_PLAY_WITH_COUNTERS.test(text)
    );
}

/** True when `ops` (recursively, through the four structural constructs) adds
 *  counters to the ability's OWN source — the exact shape the replacement
 *  subsumes. Counters placed on anything else (a target, another permanent)
 *  are a real trigger and are left alone. */
function addsCountersToSelf(ops: readonly EffectOp[] | undefined): boolean {
    if (!ops) return false;
    for (const op of ops) {
        const o = op as unknown as Record<string, unknown>;
        if (o.op === "counters" && o.action === "add") {
            const target = o.target as { ref?: string } | undefined;
            if (target?.ref === "$source") return true;
        }
        // bind/ref/if/forEach — the four frozen structural constructs (ADR
        // 0045) nest further Ops; walk every branch.
        for (const key of ["then", "else", "do", "effects", "ops"]) {
            const nested = o[key];
            if (Array.isArray(nested)) {
                if (addsCountersToSelf(nested as EffectOp[])) return true;
            }
        }
    }
    return false;
}

/** A `PERMANENT_ENTERED` trigger that places counters on its own source — or
 *  simply re-prints the enters-with-counters Oracle line as its own
 *  `oracleText` (the `resolve()` form the Op walk above cannot see into). */
function isCounterPlacingEntryTrigger(t: TriggeredAbility): boolean {
    const events = Array.isArray(t.event) ? t.event : [t.event];
    if (!events.includes("PERMANENT_ENTERED")) return false;
    if (printsEntersWithCounters(t.oracleText)) return true;
    return addsCountersToSelf(
        (t as { effects?: EffectOp[] }).effects as EffectOp[] | undefined
    );
}

describe("enters-with-counters is a replacement, not a trigger (CR 121.6 / 614.1c, issue #1693)", () => {
    const printed: CardDefinition[] = getAllCards().filter((c) =>
        printsEntersWithCounters(c.oracleText)
    );

    it("the catalogue actually prints the wording (guard is not vacuous)", () => {
        expect(printed.length).toBeGreaterThan(10);
    });

    it("no card declares its entry counters as a triggered ability", () => {
        const offenders: string[] = [];
        for (const card of printed) {
            for (const t of card.triggeredAbilities ?? []) {
                if (isCounterPlacingEntryTrigger(t)) {
                    offenders.push(
                        `${card.name} (${card.id}): trigger "${t.id}" places its entry counters on the stack — declare \`entersWith.counters\` instead (CR 614.1c)`
                    );
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
