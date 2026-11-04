// `wardAbility` — declarative template for Ward (CR 702.21), the keyword
// ability that taxes an opponent's targeted removal/interaction.
//
// CR 702.21a: Ward is a triggered ability. "Ward [cost]" means "Whenever this
//   permanent becomes the target of a spell or ability an opponent controls,
//   counter that spell or ability unless that player pays [cost]."
// CR 702.21b: Some ward abilities include an X in their cost and state what X
//   is equal to; that value is determined at RESOLUTION, not locked in as the
//   ability triggers. (No X-cost consumer yet — `MayPayCost` already resolves
//   at `mayPay` execution time, so a future X-cost card composes without
//   changes here.)
//
// Expanded implicitly from the keyword string at the `getDefinition` seam
// (ADR 0054, the `expandMobilize` / `expandImpending` chain): a card declares
// only `"ward {2}"` / `"ward—pay 2 life"` in `staticAbilities[]` (matched by
// the Mechanics Registry's `bindingPattern`) and `expandWard` injects
// `wardAbility({...})`, so a card can never print the keyword and enforce
// nothing, and a compiled (JSON) definition reaches the `matches` closure below
// without a second statement of it. A GRANTED ward (`keyword-grant` +
// `triggered-grant`, Lavaspur Boots) calls the factory directly: the string is
// not on the granting card's own `staticAbilities`.
//
// Routed entirely through EXISTING targeted-triggered-ability machinery
// (CR 603.3d) — no parallel counter mechanism:
//   - `event: "BECAME_TARGET"` (CR 603.2) is the SAME
//     target-declaration event Leovold's "you or a permanent you control
//     becomes the target" reads. `matches` narrows it to "THIS permanent
//     specifically" (`event.target.id === self.id`, tighter than Leovold's
//     controller-level check) + "an opponent's spell/ability" — CR 702.21a.
//   - `targetRequirement` locks the trigger's OWN target — "that spell or
//     ability" — via `spellTargetsSelfSource` (a dynamic twin of Mistfolk's
//     `spellTargetsInstanceIds`, resolved per-instance in
//     `raiseTriggerTargetSelection` from `StackItem.triggerSourceId` instead
//     of a static author-time id) combined with `spellStackKind: "any"`
//     (spells AND abilities both qualify, CR 702.21a's "spell or ability").
//     With exactly one such object on the stack (the overwhelming common
//     case — the very thing that just triggered this ability) the CR 603.3d
//     single-legal-target rule auto-selects it: no player choice, matching
//     the keyword's fully automatic targeting.
//   - `effects` is the SAME "counter unless pay" DSL shape Miscalculation /
//     Force Spike already exercise: `mayPay` (payer = `{ controllerOf:
//     { target: 0 } }`, CR 117.3a — "unless THAT PLAYER pays", the countered
//     object's controller) then `if (!$paid) counter target 0`. Every Op here
//     (`mayPay`, `if`, `counter`) is already covered by the interpreter test
//     suite — the per-Op regime applies, no new Op introduced.
//
// Two-simultaneous-targeters edge (CR 702.21a): the FILTER-based instance
// pin above (`spellTargetsSelfSource` → `spellTargetsInstanceIds: [self.id]`)
// alone can't distinguish WHICH of two spells/abilities simultaneously
// targeting the same warded permanent caused a GIVEN ward trigger instance —
// both are legal candidates under a "targets this permanent" filter. Fixed by
// threading the causing object's OWN stack-item id through the BECAME_TARGET
// event that fires each ward trigger (`BecameTargetEvent.sourceInstanceId`,
// set by `emitBecameTargetEvents`) and having
// `raiseTriggerTargetSelection` (`gre/rules.ts`) narrow its legal-target set
// to that exact id when present — so each ward instance forces the precise
// object that caused it, per CR 702.21a, with no player choice even when two
// (or more) targeters overlap. The broad `triggerSourceId`-based filter
// remains as a defensive fallback for the (never expected) case where the
// causing event carries no `sourceInstanceId`.

import type { CardDefinition, MayPayCost, TriggeredAbility } from "../types";

export interface WardArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id?: string;
    /** Oracle reminder text shown on the stack (CR 603.3a). Defaults to the
     *  standard ward reminder for the given cost. */
    oracleText?: string;
    /** The ward cost (CR 702.21a). A bare `ManaCost` (the common case, "Ward
     *  {2}") or the `{ mana?, life?, sacrifice?, discard?, energy? }` union
     *  for a special-action cost ("Ward—Sacrifice a creature", "Ward—Pay 2
     *  life"). */
    cost: MayPayCost;
    /** Label for the cost shown in the may-pay prompt and the default reminder
     *  (e.g. "{2}", "2 life"). */
    costLabel: string;
}

/** Builds the Ward triggered ability (CR 702.21). A printed ward declares the
 *  keyword string and lets {@link expandWard} call this; only a granted ward
 *  calls it by hand. */
export function wardAbility(args: WardArgs): TriggeredAbility {
    const costLabel = args.costLabel;
    const oracle =
        args.oracleText ??
        `Ward ${costLabel} (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays ${costLabel}.)`;
    return {
        id: args.id ?? "ward",
        oracleText: oracle,
        event: "BECAME_TARGET",
        // CR 702.21a — "whenever THIS PERMANENT becomes the target of a spell
        // or ability an OPPONENT controls". Narrower than Leovold's "you or a
        // permanent you control" (issue #1265, `event.targetControllerId ===
        // self.controllerId`): pins to this exact permanent
        // (`event.target.id === self.id`), and requires the targeting
        // source's controller differ from this permanent's controller.
        matches: (event, self) =>
            event.type === "BECAME_TARGET" &&
            event.target.type === "permanent" &&
            event.target.id === self.id &&
            event.sourceControllerId !== self.controllerId,
        // CR 603.3d — the trigger's own target IS "that spell or ability":
        // dynamically pinned to whatever is CURRENTLY on the stack targeting
        // this permanent (see file header). `count: 1` + the single-legal-
        // target rule means no player choice in the common case.
        targetRequirement: {
            type: "spell",
            count: 1,
            spellStackKind: "any",
            spellTargetsSelfSource: true,
        },
        effects: [
            {
                op: "mayPay",
                // CR 702.21a — "unless THAT PLAYER pays" = the controller of
                // the countered spell/ability (announced target slot 0, CR
                // 117.3a — same shape as Force Spike / Miscalculation).
                player: { controllerOf: { target: 0 } },
                cost: args.cost,
                prompt: `Pay ward (${costLabel})?`,
                bind: "$paid",
            },
            {
                op: "if",
                predicate: { not: { binding: "$paid" } },
                then: [{ op: "counter", target: { target: 0 } }],
            },
        ],
    };
}

/** The id {@link wardAbility} gives its ability by default. */
const WARD_TRIGGER_ID = "ward";

/** `"ward {N}"` — a generic-mana ward, the keyword-run form. */
const WARD_MANA = /^ward \{([1-9]\d*)\}$/;
/** `"ward—pay N life"` — the dashed form. */
const WARD_LIFE = /^ward—pay ([1-9]\d*) life$/;

/** A printed ward's cost, read from its keyword string, or null for any string
 *  that is not one of the two forms above: the one authority on what those
 *  forms mean, read by the expander and by the Oracle keyword line. */
export function parseWard(keyword: string): WardArgs | null {
    const mana = WARD_MANA.exec(keyword);
    if (mana !== null) {
        const amount = Number(mana[1]);
        return { cost: { mana: { X: amount } }, costLabel: `{${amount}}` };
    }
    const life = WARD_LIFE.exec(keyword);
    if (life === null) return null;
    const amount = Number(life[1]);
    return {
        cost: { life: amount },
        costLabel: `${amount} life`,
        oracleText: `Ward—Pay ${amount} life (Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays ${amount} life.)`,
    };
}

/** ADR 0054 — a no-op unless the card carries a ward keyword string. Appends
 *  one trigger per declared ward, each triggering on its own; never mutates the
 *  input. Idempotent: skips a definition already carrying the trigger, so a
 *  definition spread from an expanded one does not ward twice. */
export function expandWard(def: CardDefinition): CardDefinition {
    const wards = (def.staticAbilities ?? []).flatMap((keyword) => {
        const args = parseWard(keyword);
        return args === null ? [] : [args];
    });
    if (wards.length === 0) return def;
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === WARD_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...wards.map((args, i) =>
                wardAbility({
                    ...args,
                    id:
                        i === 0
                            ? WARD_TRIGGER_ID
                            : `${WARD_TRIGGER_ID}-${i + 1}`,
                })
            ),
        ],
    };
}
