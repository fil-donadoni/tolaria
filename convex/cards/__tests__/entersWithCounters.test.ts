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

/** True when `ops` (recursively) adds counters to the ability's OWN source —
 *  the exact shape the replacement subsumes. Counters placed on anything else
 *  (a target, another permanent) are a real trigger and are left alone.
 *
 *  The descent is STRUCTURAL, not a hand-maintained key list. A key list is
 *  exactly how this walk went stale: it named `then`/`else`/`effects` plus two
 *  keys (`do`, `ops`) that no `EffectOp` variant has ever declared, while
 *  missing every nesting site added since — `optionChoice.modes[].effects`
 *  (`types.ts`), `divideIntoPiles.chosenEffect`/`otherEffect`, and
 *  `coinFlip.win`/`loss.effects`. A trigger burying its self-counter placement
 *  inside any of those slipped through the guard entirely. Walking every
 *  nested object/array value instead makes the guard complete BY CONSTRUCTION
 *  and immune to the next Op that introduces a nested body: the shape test
 *  (`op === "counters"`) is specific enough that visiting a non-Op object is
 *  harmless. */
function addsCountersToSelf(ops: readonly unknown[] | undefined): boolean {
    if (!ops) return false;
    for (const op of ops) {
        if (op === null || typeof op !== "object") continue;
        const o = op as Record<string, unknown>;
        if (o.op === "counters" && o.action === "add") {
            const target = o.target as { ref?: string } | undefined;
            if (target?.ref === "$source") return true;
        }
        for (const value of Object.values(o)) {
            if (Array.isArray(value)) {
                if (addsCountersToSelf(value)) return true;
            } else if (value !== null && typeof value === "object") {
                if (addsCountersToSelf([value])) return true;
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
    return addsCountersToSelf((t as { effects?: EffectOp[] }).effects);
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

describe("the guard's Op walk descends into EVERY nested body (issue #1693)", () => {
    // The walk is the guard: a self-counter placement it cannot see is a
    // catalogue offender that ships. These are the nesting sites the previous
    // hand-maintained key list (`then`/`else`/`do`/`effects`/`ops`) missed —
    // it named two keys no `EffectOp` variant declares (`do`, `ops`) while
    // omitting three that several do. Each case must be SEEN, or the guard is
    // silently narrower than its docstring claims.
    const SELF_COUNTER = {
        op: "counters",
        action: "add",
        target: { ref: "$source" },
        counterType: "+1/+1",
        amount: 1,
    };

    it("sees a placement nested in `optionChoice.modes[].effects`", () => {
        expect(
            addsCountersToSelf([
                {
                    op: "optionChoice",
                    prompt: "Choose one —",
                    modes: [
                        { label: "nothing", effects: [] },
                        { label: "counters", effects: [SELF_COUNTER] },
                    ],
                },
            ])
        ).toBe(true);
    });

    it("sees a placement nested in `divideIntoPiles.chosenEffect`/`otherEffect`", () => {
        const pile = (key: "chosenEffect" | "otherEffect") => [
            {
                op: "divideIntoPiles",
                chosenBind: "$a",
                otherBind: "$b",
                chosenEffect: [],
                otherEffect: [],
                [key]: [SELF_COUNTER],
            },
        ];
        expect(addsCountersToSelf(pile("chosenEffect"))).toBe(true);
        expect(addsCountersToSelf(pile("otherEffect"))).toBe(true);
    });

    it("sees a placement nested in `coinFlip.win`/`loss` and in `if`/`forEach`", () => {
        expect(
            addsCountersToSelf([
                {
                    op: "coinFlip",
                    win: { effects: [SELF_COUNTER] },
                    loss: { effects: [] },
                },
            ])
        ).toBe(true);
        expect(
            addsCountersToSelf([{ op: "if", then: [SELF_COUNTER], else: [] }])
        ).toBe(true);
        expect(
            addsCountersToSelf([
                { op: "forEach", bind: "$x", effects: [SELF_COUNTER] },
            ])
        ).toBe(true);
    });

    it("does NOT flag counters aimed at anything other than the source", () => {
        expect(
            addsCountersToSelf([
                {
                    op: "optionChoice",
                    modes: [
                        {
                            label: "other",
                            effects: [
                                {
                                    ...SELF_COUNTER,
                                    target: { ref: "$target" },
                                },
                            ],
                        },
                    ],
                },
            ])
        ).toBe(false);
        expect(addsCountersToSelf([])).toBe(false);
        expect(addsCountersToSelf(undefined)).toBe(false);
    });
});
