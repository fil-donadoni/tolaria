// `landTypeChangeEffects` — shared Effect Script builder for CR 305.7's
// land-type change: "target land becomes <one or more basic land types>
// until <duration>" (Dream Thrush, Kavu Recluse, Reef Shaman, Tundra Kavu,
// issues #1083 / #4138).
//
// CR 305.7 — setting a land's subtype to a basic land type REPLACES its old
// land types (and the abilities generated from them), which is exactly the
// `setSubtype` Op, a declarative skin over `SpellContext.setSubtypesUntil`.
// CR 613.1d puts the change in layer 4.
//
// The "of your choice" half needs NO new choice-kind construct: it composes
// the pre-existing `optionChoice` Op (ADR 0045 "generalize, don't add") —
// one mode per OFFERED basic land type, each a single-Op `setSubtype` body
// targeting the same object selector. `offered` is what the printed line
// offers, and the printed lines offer three arities of one thing: all five
// (CR 305.6 — "the basic land type of your choice", Dream Thrush), a named
// pair ("a Plains or an Island", Tundra Kavu), or one ("a Forest", Kavu
// Recluse). The one-type case emits the bare `setSubtype` and NO
// `optionChoice`, because a choice with a single mode is a prompt with
// nothing to decide (CR 608.2d offers a choice; a one-option offer is not
// one) — and that is the shape the hand-written Kavu Recluse already ships.

import type { DurationSpec, EffectObjectSelector, EffectOp } from "../types";

/**
 * Builds the Effect Script for "target land becomes <offered> until
 * <duration>" (CR 305.7).
 *
 * `target` is the object selector the land-type change applies to (an
 * announced target slot, or `$source` for a land changing its own types);
 * `offered` is the basic land types the line puts on the table, IN PRINTED
 * ORDER — `BASIC_LAND_SUBTYPES` for "the basic land type of your choice",
 * the named list otherwise; `duration` is forwarded to the `setSubtype` Op
 * unchanged. `prompt` is the choice header, and is unused when `offered`
 * names a single type (there is no prompt to show).
 */
export function landTypeChangeEffects(
    target: EffectObjectSelector,
    offered: readonly string[],
    duration: DurationSpec,
    prompt: string
): EffectOp[] {
    const become = (subtype: string): EffectOp[] => [
        { op: "setSubtype", target, subtypes: [subtype], duration },
    ];
    if (offered.length === 1) return become(offered[0]!);
    return [
        {
            op: "optionChoice",
            prompt,
            modes: offered.map((subtype) => ({
                id: subtype,
                label: subtype,
                effects: become(subtype),
            })),
        },
    ];
}
