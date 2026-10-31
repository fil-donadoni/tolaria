// Impending (CR 702.176) — expanded implicitly from the `"impending N"`
// keyword string at the `getDefinition` seam (ADR 0054, the
// `expandFadingVanishing` / `expandBestow` chain).
//
// CR 702.176a: "Impending N—[cost]" means "You may choose to pay [cost] rather
//   than pay this spell's mana cost," "If you chose to pay this permanent's
//   impending cost, it enters with N time counters on it," "As long as this
//   permanent's impending cost was paid and it has a time counter on it, it's
//   not a creature," and "At the beginning of your end step, if this
//   permanent's impending cost was paid and it has a time counter on it,
//   remove a time counter from it."
//
// A COMPOSITION of two shipped keywords, not a new subsystem:
//
//   1. The alternative cost is `CardDefinition.impending` — the
//      `AlternativeCost` shape the `dash`/`warp` fields use, resolved by
//      `getAlternativeCost` / `affordableAlternativeCosts`. Choosing it stamps
//      `impended: true` on the stack item (the cast-commit sites in
//      `convex/game.ts`, the cast-mode census `gre/castMode.ts`), which rides
//      onto the permanent: the instance fact "this permanent's impending cost
//      was paid" every later clause reads.
//   2. The entry counters are an `entersWith` REPLACEMENT (CR 614.1c), the
//      Vanishing shape, counted `{ ifImpended: N }` so a hard-cast copy
//      enters with none (`cards/entersWith.ts`).
//   3. "Not a creature" is a self-applying layer-4 `type-remove` (CR 613.1d),
//      the Bestow shape. Its `applies` predicate is re-read at every
//      derivation of the layers-2-to-5 walk (`gre/layers2to5.ts`), so the
//      permanent becomes a creature again the moment its last time counter
//      comes off, with no event to hang a re-application on.
//   4. The end-step removal is a `phaseTrigger` with a CR 603.4
//      intervening-if, the Vanishing upkeep trigger moved to the end step and
//      gated on the instance fact; it has no sacrifice tail.
//
// Expanding all three from the keyword string rather than letting each card
// declare them is the Guard A inertness shape: the keyword can never be
// printed with nothing enforcing it, and N lives in exactly one place.

import type {
    CardDefinition,
    PermanentView,
    StaticEffect,
    TriggeredAbility,
} from "../types";
import { phaseTrigger } from "./triggers/phaseTrigger";
import { withTriggerGate } from "./triggers/shared";

/** CR 702.176a — the counter type the keyword counts down. */
const TIME_COUNTER = "time";

const IMPENDING_PATTERN = /^impending (\d+)$/i;

/** The id of the synthesized end-step trigger. */
export const IMPENDING_END_STEP_TRIGGER_ID = "impending-end-step";

/** `N` from a card's `"impending N"` keyword string, or null when the card
 *  carries none. */
export function parseImpending(
    staticAbilities: readonly string[] | undefined
): number | null {
    for (const ability of staticAbilities ?? []) {
        const match = IMPENDING_PATTERN.exec(ability);
        if (match) return Number(match[1]);
    }
    return null;
}

/** CR 702.176a — "this permanent's impending cost was paid and it has a time
 *  counter on it": the shared condition of the third and fourth abilities. */
const impendingClockRunning = (self: PermanentView): boolean =>
    self.impended === true && (self.counters?.[TIME_COUNTER] ?? 0) > 0;

/** CR 702.176a / 613.1d — the third ability: "As long as this permanent's
 *  impending cost was paid and it has a time counter on it, it's not a
 *  creature." Self-applying, and it removes ONLY the Creature type — the
 *  permanent keeps its other types and every ability. */
export const IMPENDING_STATIC_EFFECTS: readonly StaticEffect[] = [
    {
        kind: "type-remove",
        types: ["Creature"],
        applies: (target, source) =>
            target.id === source.id && impendingClockRunning(source),
    },
];

/** The `StaticEffect.kind`s {@link IMPENDING_STATIC_EFFECTS} injects. Read by
 *  `cards/registry.ts`'s layer precheck, which indexes the RAW definition —
 *  BEFORE this expansion runs — and would otherwise drop every impending card
 *  from the layer-4 walk (the `BESTOW_STATIC_EFFECT_KINDS` hazard). */
export const IMPENDING_STATIC_EFFECT_KINDS: readonly string[] =
    IMPENDING_STATIC_EFFECTS.map((e) => e.kind);

/** CR 702.176a / 603.4 — the fourth ability: "At the beginning of your end
 *  step, if this permanent's impending cost was paid and it has a time
 *  counter on it, remove a time counter from it." An intervening-if, checked
 *  as the step begins and again on resolution. */
function impendingEndStepTrigger(): TriggeredAbility {
    return withTriggerGate(
        phaseTrigger({
            id: IMPENDING_END_STEP_TRIGGER_ID,
            oracleText:
                "At the beginning of your end step, if this permanent's impending cost was paid and it has a time counter on it, remove a time counter from it.",
            phase: "END_STEP",
            scope: "your",
            interveningIf: (_event, self) => impendingClockRunning(self),
            effects: [
                {
                    op: "counters",
                    action: "remove",
                    counter: TIME_COUNTER,
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
        // A decidable gate on the source alone, so the Bot's value model
        // charges the countdown only to an impending permanent.
        { conditionOnSelf: impendingClockRunning }
    );
}

/** ADR 0054 — a no-op unless the card carries `"impending N"`. Appends the
 *  `{ ifImpended: N }` entry counters, the layer-4 removal and the end-step
 *  trigger; never mutates the input. Idempotent: skips a definition that
 *  already carries the synthesized trigger. */
export function expandImpending(def: CardDefinition): CardDefinition {
    const count = parseImpending(def.staticAbilities);
    if (count === null) return def;
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === IMPENDING_END_STEP_TRIGGER_ID))
        return def;
    return {
        ...def,
        entersWith: {
            ...def.entersWith,
            counters: [
                ...(def.entersWith?.counters ?? []),
                // CR 702.176a / 614.1c — "If you chose to pay this
                // permanent's impending cost, it enters with N time counters".
                { type: TIME_COUNTER, count: { ifImpended: count } },
            ],
        },
        staticEffects: [
            ...(def.staticEffects ?? []),
            ...IMPENDING_STATIC_EFFECTS,
        ],
        triggeredAbilities: [...existing, impendingEndStepTrigger()],
    };
}
