// `landfallTrigger` — declarative factory for the **Landfall** ability word:
// "Landfall — Whenever a land you control enters, [effect]." Landfall is an
// ABILITY WORD (CR 702 preamble — italic flavour text with NO independent
// rules meaning), so it carries no `staticAbilities[]` keyword and no
// Mechanics Registry row (issue #694). Mechanically it is exactly a
// `PERMANENT_ENTERED` triggered ability (CR 603.6a) whose entering permanent
// is a Land controlled by the ability's source controller.
//
// This is a thin semantic skin over `enteredTrigger` with `scope: "yours"`
// (CR 109.2 — the entering permanent shares the source's controller) and the
// Land type filter baked in, so every landfall card declares only its id,
// oracle text and effect. Built once here; its sole live consumer today is
// Bristly Bill, Spine Sower (`sets/otj/green.ts`). The other Landfall cards
// from issue #694 are tracked stubs blocked on OTHER capabilities and do NOT
// use this factory yet: Omnath / Scythecat Cub (#1189, per-turn
// ability-resolution-count escalation), Icetill Explorer (#1190,
// play-lands-from-graveyard), Tireless Tracker (#1191, Investigate / Clue).
// Mirrors `enteredTrigger`'s DSL-first / resolve contract unchanged.

import type {
    EffectOp,
    PermanentEnteredEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import {
    enteredTrigger,
    type EnteredPermanentInfo,
} from "./enteredTrigger";

export interface LandfallTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a),
     *  conventionally prefixed "Landfall — ". */
    oracleText: string;
    /** CR 603.4 check-time predicate, forwarded to `enteredTrigger`. */
    condition?: (
        event: PermanentEnteredEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if, forwarded to `enteredTrigger`. */
    interveningIf?: (
        event: PermanentEnteredEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045) — the DSL-first default. Rides straight to the
     *  interpreter with the source's controller and `$source` bound; the
     *  entering land is a separate payload, not the acting player, so a plain
     *  `"controller"` selector always means the landfall card's controller
     *  (safe under `scope: "yours"`). Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Imperative resolve — the escape hatch when the effect must inspect the
     *  entering land itself (which the Effect Script cannot reach). */
    resolve?: (
        ctx: SpellContext,
        event: PermanentEnteredEvent,
        entered: EnteredPermanentInfo
    ) => void;
}

/** Builds a `TriggeredAbility` for the Landfall ability word — a
 *  `PERMANENT_ENTERED` trigger gated to Lands controlled by the source's
 *  controller (CR 603.6a / 109.2). */
export function landfallTrigger(args: LandfallTriggerArgs): TriggeredAbility {
    return enteredTrigger({
        id: args.id,
        oracleText: args.oracleText,
        // "a land you control enters" — CR 109.2: same controller as the
        // source. `enteredTrigger`'s "yours" scope also matches the source's
        // own ETB, which is correct for landfall (a land IS a permanent; the
        // source here is never itself a land so this is moot, but faithful).
        scope: "yours",
        filter: { types: "Land" },
        ...(args.condition ? { condition: args.condition } : {}),
        ...(args.interveningIf ? { interveningIf: args.interveningIf } : {}),
        ...(args.effects
            ? { effects: args.effects }
            : { resolve: args.resolve }),
    });
}
