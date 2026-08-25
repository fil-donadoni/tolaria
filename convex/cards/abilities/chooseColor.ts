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

/** Shared "choose a color" option list (CR 105.1, the five colors — no
 *  colorless) for an imperative `ctx.requestOptionChoice` caller whose
 *  effect is NOT a plain "target/self becomes this color" `optionChoice` Op —
 *  Fertile Ground's mana-ability colour pick (`usg/green.ts`) resolves
 *  outside the stack (CR 605.1b/605.4) and so cannot route through
 *  `colorChoiceModes`' `optionChoice`-Op modes at all. Sets `color` on every
 *  entry, same as `colorChoiceModes` (both feed `PendingChoiceOptions`, which
 *  draws a `ManaSymbol` when `color` is present). Historical note: earlier
 *  revisions of Kavu Chameleon, Alloy Golem and Shyft also hand-rolled their
 *  own options here without a `color` tag; all three have since migrated to
 *  `colorChoiceModes` below (issue #2306 review finding 2 re-checked the
 *  call sites — none of the four remaining colour pickers omits `color`
 *  today). Import this instead of a new local const when the shape fits
 *  (primitive-reuse mandate — extract, don't re-duplicate). */
export const COLOR_OPTIONS: { id: Color; label: string; color: Color }[] =
    COLOR_LABELS.map(([color, label]) => ({ id: color, label, color }));

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
        color,
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
