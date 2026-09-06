/**
 * The merge's one-time BASELINE (issue #3052, ADR 0114 §3).
 *
 * ADR 0114 §3 says a hand-written definition and its compiled twin must AGREE,
 * and that disagreement stops the build. Four cards disagree today. Stopping
 * the build on all four would mean this artifact cannot be generated until
 * four unrelated adjudications land, so they are named here instead — the same
 * amnesty shape Guard C's `compilerRoundTrip.baseline.ts` uses, with the same
 * one-directional property: **this list only ever shrinks.**
 *
 * Three mechanisms make that true, all asserted in
 * `scripts/__tests__/catalogue-artifact.test.ts`:
 *
 *   - a row whose card no longer diverges is STALE and reds, so a fix forces
 *     its row out;
 *   - {@link BASELINE_CEILING} is a literal that may only come down, so a new
 *     divergence cannot be parked in here;
 *   - the FIELD is pinned per row, so a card that starts diverging on a
 *     SECOND field reds even though its name is already listed.
 *
 * ── Direction ──────────────────────────────────────────────────────────────
 *
 * `card-defect` — the corpus and the CR side with the compiler; the
 * hand-written definition is wrong and its fix is its own ticket.
 * `undetermined` — the two encodings mean the same thing and nobody has ruled
 * on which is canonical. A legitimate row, but a QUEUE, not a resting place
 * (ADR 0114 §5). It is deliberately NOT resolved by widening the comparator:
 * this ticket adds no normalisation axis (ADR 0114 §4), and an axis that
 * folds `cost` or `staticAbilities` is exactly the permissiveness §4 forbids.
 */

export type DivergenceDirection = "card-defect" | "undetermined";

export interface DivergenceBaselineRow {
    /** `CardDefinition.name`, as the hand-written module writes it. */
    readonly card: string;
    /** The projected field that differs — pinned, so a second divergence on
     *  the same card is not covered by this row. */
    readonly field: string;
    readonly direction: DivergenceDirection;
    /** The ticket that will retire the row, where one exists. An
     *  `undetermined` row may have none: nobody has ruled yet. */
    readonly issue?: number;
    readonly why: string;
}

export const CATALOGUE_DIVERGENCE_BASELINE: readonly DivergenceBaselineRow[] = [
    {
        card: "Ashnod's Altar",
        field: "activatedAbilities",
        direction: "card-defect",
        issue: 3046,
        why:
            'Oracle: "Sacrifice a creature: Add {C}{C}." No target, adds mana, not a ' +
            "loyalty ability, moves no card to or from a library — a mana ability by " +
            "CR 605.1a, and CR 605.3b keeps one off the stack. The hand-written " +
            "definition ships `useStack: true` with an `addMana` Effect Script; the " +
            "compiled row ships `useStack: false` with `manaProduced`. The compiler " +
            "is right.",
    },
    {
        card: "Northern Paladin",
        field: "activatedAbilities",
        direction: "card-defect",
        issue: 3047,
        why:
            'Oracle: "Destroy target black permanent." The hand-written ' +
            '`targetRequirement` is `type: "Creature"` — strictly narrower than the ' +
            "card that is printed (CR 109.1 / 300.1). The compiled row emits the six " +
            "permanent card types (CR 110.4). The compiler is right.",
    },
    {
        card: "Lava Dart",
        field: "flashback",
        direction: "undetermined",
        why:
            'Oracle: "Flashback—Sacrifice a Mountain." The hand-written flashback cost ' +
            'restates `types: ["Land"]` beside `subtypes: ["Mountain"]`; the compiled ' +
            "row writes the subtype alone. Both select the same permanents — no card " +
            "with the Mountain subtype is anything but a land — so this is an encoding " +
            "tie, the same one `KNOWN_DIVERGENCES` records for Horror of Horrors at " +
            "the activated-cost site. It sits here rather than in the comparator " +
            "because `cost` is a field ADR 0114 §4 forbids folding.",
    },
    {
        card: "Ancient Spider",
        field: "staticAbilities",
        direction: "undetermined",
        why:
            'The hand-written text is "First strike; reach" and the corpus prints ' +
            '"Reach (…)\\nFirst strike", so the two keyword lists carry the same two ' +
            "keywords in opposite order. `staticAbilities` is a set, not a sequence — " +
            "no engine path reads its order — but sorting it would be a new " +
            "normalisation axis over a field the layer system reads, which ADR 0114 §4 " +
            "puts out of reach of this ticket. docs/findings/3052-keyword-order-divergence.md",
    },
    {
        card: "Desert Twister",
        field: "targetRequirement",
        direction: "card-defect",
        issue: 3073,
        why:
            'Oracle: "Destroy target permanent." The hand-written ' +
            '`targetRequirement` is `type: ["any"]`, and "any target" is NOT a ' +
            "synonym for a permanent — CR 115.4 makes it a creature, planeswalker, " +
            "battle or player, which is what `getLegalTargets` and " +
            "`matchesTargetRequirement` both implement. So the card as shipped " +
            "cannot destroy an artifact, an enchantment or a land. The compiled row " +
            "emits the six permanent card types (CR 110.4). The compiler is right. " +
            'It is the card whose body is the `effect: "destroy-target"` shorthand, ' +
            "so a comparator that exempted a whole card on the closure sentinel " +
            "would hide this — see `twinDivergence`.",
    },
] as const;

/**
 * The size the baseline was born at. LOWER it when a card graduates; never
 * raise it. This literal is the whole "never grows" half of the mechanism —
 * the stale-row check forces a fixed card out, and this stops a new one being
 * parked in.
 */
export const BASELINE_CEILING = 5;

/** `card|field` — the key a divergence is matched on. */
export const baselineKey = (row: {
    readonly card: string;
    readonly field: string;
}): string => `${row.card}|${row.field}`;

export const BASELINE_KEYS: ReadonlySet<string> = new Set(
    CATALOGUE_DIVERGENCE_BASELINE.map(baselineKey)
);
