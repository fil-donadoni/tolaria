// `chooseColorEffects` — shared Effect Script builder for the recurring INV
// "becomes the color of your choice until end of turn" template (Blind Seer,
// Rainbow Crow, Tidal Visionary, Metathran Transport, Sway of Illusion,
// issue #1083). CR 613.1e (layer 5) — the target's color is set outright,
// replacing all other color derivation, for a limited duration.
//
// The "choice of five colors" half needs NO new choice-kind construct: it
// composes the pre-existing `optionChoice` Op (ADR 0045 "generalize, don't
// add") — one mode per color (CR 105.1, the five colors; a "becomes the
// color of your choice" effect never offers colorless as a choice), each a
// single-Op `setColor` body targeting the SAME object selector. `duration`
// is threaded through unchanged so a spell-target case (no duration meaning)
// and a permanent-target "until end of turn" case both compose correctly.

import type {
    Color,
    DurationSpec,
    EffectMode,
    EffectObjectSelector,
    EffectOp,
} from "../types";

const COLOR_LABELS: ReadonlyArray<[Color, string]> = [
    ["W", "White"],
    ["U", "Blue"],
    ["B", "Black"],
    ["R", "Red"],
    ["G", "Green"],
];

/** Builds the five-mode "choose one of the five colors" `EffectMode[]` for
 *  an `optionChoice` Op, one mode per color (CR 105.1). Each mode's body is
 *  produced by `bodyForColor(color)` — the caller decides what the chosen
 *  color DOES (a single-target `setColor`, or a `forEach` applying it to
 *  several targets at once, Sway of Illusion's "any number of target
 *  creatures become THE color of your choice" — one shared choice, not a
 *  per-creature one, since the oracle text says "the color", singular). Kept
 *  separate from `chooseColorEffects` below (the single-target convenience
 *  wrapper) so a multi-target caller can compose its own mode body instead
 *  of one `setColor` per target/per-choice. */
export function colorChoiceModes(
    bodyForColor: (color: Color) => EffectOp[]
): EffectMode[] {
    return COLOR_LABELS.map(([color, label]) => ({
        id: color,
        label,
        effects: bodyForColor(color),
    }));
}

/** Builds the one-Op `[{ op: "optionChoice", ... }]` script for "target
 *  becomes the color of your choice" (CR 613.1e) — the single-target case
 *  (Blind Seer, Rainbow Crow, Tidal Visionary). `target` is the object
 *  selector the color change applies to (an announced target slot or
 *  `$source` for a self-color-change ability); `duration` is forwarded to
 *  the inner `setColor` Op (omit for an indefinite change — no shipped INV
 *  card does this, every one is "until end of turn", but the parameter stays
 *  general per the primitive-reuse mandate). `prompt` is the choice header
 *  shown to the player. */
export function chooseColorEffects(
    target: EffectObjectSelector,
    duration: DurationSpec | undefined,
    prompt: string
): EffectOp[] {
    return [
        {
            op: "optionChoice",
            prompt,
            modes: colorChoiceModes((color) => [
                { op: "setColor", target, colors: [color], duration },
            ]),
        },
    ];
}
