import type { Phase } from "@convex/gre/types";

/** Plain-language phase / combat-step surface for the controller pod (#331).
 *  The pod and the expanded phase list both read from this single source so
 *  the collapsed label and the full list never drift. Pure data + lookups —
 *  no game logic, no GRE imports beyond the `Phase` type. */

export type PhaseStep = {
    id: Phase;
    /** Two-letter abbreviation, kept for the compact stop-list rows. */
    short: string;
    /** Full plain-language label shown collapsed and in the list. */
    label: string;
    /** Readable step WORD for the portrait bottom bar's Phase tab value row
     *  (#1818 review fixup) — e.g. "ATTACK", "1ST DMG". At most 7 characters
     *  (the tab's char/px budget once the static Flag glyph was removed, see
     *  `controller-phase-tab.tsx`'s doc comment), and pairwise distinct across
     *  every phase (`phase-labels.test.ts`). Unlike {@link short}, this is
     *  meant to be read cold, without a legend — a real word or a clearly
     *  truncated one ("1ST DMG", "END CMB"), not an opaque two-letter code. */
    compact: string;
};

export type PhaseGroup = {
    label: string;
    steps: PhaseStep[];
};

export const PHASE_GROUPS: PhaseGroup[] = [
    {
        label: "Beginning",
        steps: [
            { id: "UNTAP", short: "UT", label: "Untap", compact: "UNTAP" },
            { id: "UPKEEP", short: "UK", label: "Upkeep", compact: "UPKEEP" },
            { id: "DRAW", short: "DR", label: "Draw", compact: "DRAW" },
        ],
    },
    {
        label: "Main 1",
        steps: [
            {
                id: "PRECOMBAT_MAIN",
                short: "M1",
                label: "Main Phase 1",
                compact: "MAIN 1",
            },
        ],
    },
    {
        label: "Combat",
        steps: [
            {
                id: "BEGINNING_OF_COMBAT",
                short: "BC",
                label: "Beginning of Combat",
                // "BEGIN", not the full "Beginning of Combat" — the tab
                // caption already reads "T{turn}·COM" for every combat
                // sub-step, so the group is disambiguated there and this
                // value row only needs to say WHICH combat step.
                compact: "BEGIN",
            },
            {
                id: "DECLARE_ATTACKERS",
                short: "DA",
                label: "Declare Attackers",
                compact: "ATTACK",
            },
            {
                id: "DECLARE_BLOCKERS",
                short: "DB",
                label: "Declare Blockers",
                compact: "BLOCK",
            },
            {
                id: "FIRST_STRIKE_DAMAGE",
                short: "FD",
                label: "First Strike Damage",
                // "1ST DMG" (7 chars, the budget ceiling) — "First Strike
                // Damage" has no plain-English word short enough on its own,
                // so this is the clearest truncation rather than a bare code.
                compact: "1ST DMG",
            },
            {
                id: "COMBAT_DAMAGE",
                short: "CD",
                label: "Combat Damage",
                compact: "DAMAGE",
            },
            {
                id: "END_OF_COMBAT",
                short: "EC",
                label: "End of Combat",
                // "END CMB" (7 chars) distinguishes this from End Step's bare
                // "END" below — both read "end-ish" but the CMB suffix plus
                // the differing group caption (COM vs END) disambiguate them.
                compact: "END CMB",
            },
        ],
    },
    {
        label: "Main 2",
        steps: [
            {
                id: "POSTCOMBAT_MAIN",
                short: "M2",
                label: "Main Phase 2",
                compact: "MAIN 2",
            },
        ],
    },
    {
        label: "Ending",
        steps: [
            { id: "END_STEP", short: "ES", label: "End Step", compact: "END" },
            {
                id: "CLEANUP",
                short: "CL",
                label: "Cleanup",
                compact: "CLEANUP",
            },
        ],
    },
];

const STEP_BY_ID: Record<string, PhaseStep> = Object.fromEntries(
    PHASE_GROUPS.flatMap((g) => g.steps).map((s) => [s.id, s])
);

const GROUP_BY_STEP: Record<string, PhaseGroup> = Object.fromEntries(
    PHASE_GROUPS.flatMap((g) => g.steps.map((s) => [s.id, g]))
);

/** Plain-language label for a phase/step (e.g. "Declare Attackers"). Falls
 *  back to a title-cased form for any phase not in the table (e.g. MULLIGAN). */
export function phaseLabel(phase: Phase): string {
    const step = STEP_BY_ID[phase];
    if (step) return step.label;
    return phase
        .split("_")
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(" ");
}

/** Group display name for a phase (e.g. "Combat"). */
export function phaseGroupLabel(phase: Phase): string {
    return GROUP_BY_STEP[phase]?.label ?? phaseLabel(phase);
}

/** Two-letter step code for a phase (e.g. "M1", "DA") — {@link PhaseStep.short}.
 *  Falls back to the first two letters of the phase id for anything not in the
 *  table. Was briefly the portrait bottom bar Phase tab's prominent step value
 *  (#1815 review fixup round 3); #1818's review fixup replaced that with the
 *  readable {@link phaseCompact} word instead (a bare 2-letter code needs a
 *  legend to read, which was exactly the "can't tell which combat step"
 *  complaint #1818 opened against). Kept for the stop-list rows and anywhere
 *  else a terse 2-letter code is still the right fit. */
export function phaseShort(phase: Phase): string {
    const step = STEP_BY_ID[phase];
    if (step) return step.short;
    return phase.slice(0, 2).toUpperCase();
}

/** Three-letter, uppercase abbreviation of a phase's GROUP label (e.g.
 *  "Combat" -> "COM", "Beginning" -> "BEG", "Main 1"/"Main 2" -> "MAI" for
 *  both — the trailing digit is dropped since {@link phaseCompact} already
 *  disambiguates Main 1 vs Main 2, and every other step, at the value-row
 *  level). Derived from {@link phaseGroupLabel} by a generic slice/uppercase
 *  transform rather than a hardcoded per-phase table, so it carries no new
 *  phase-specific strings. Used by the portrait bottom bar's Phase tab
 *  (#1818) as the compact caption alongside the granular {@link phaseCompact}
 *  step word, so the tab shows both "which broad group" (small caption) and
 *  "which specific step" (prominent value) without growing past the tab's
 *  char/px budget. */
export function phaseGroupShort(phase: Phase): string {
    const letters = phaseGroupLabel(phase).replace(/[^A-Za-z]/g, "");
    return letters.slice(0, 3).toUpperCase();
}

/** Readable step WORD for a phase (e.g. "ATTACK", "1ST DMG") —
 *  {@link PhaseStep.compact}. Falls back to the first 7 characters of
 *  {@link phaseLabel}, uppercased, for anything not in the table. This is the
 *  portrait bottom bar Phase tab's prominent value-row content (#1818 review
 *  fixup): once the tab's static Flag glyph was removed, the freed-up width
 *  gave the value row a ~7-char budget at its 12px `text-xs` size (see
 *  `controller-phase-tab.tsx`'s doc comment) — enough for a real word or a
 *  clearly-truncated one, rather than the 2-letter {@link phaseShort} code a
 *  player would need a legend to decode. */
export function phaseCompact(phase: Phase): string {
    const step = STEP_BY_ID[phase];
    if (step) return step.compact;
    return phaseLabel(phase).slice(0, 7).toUpperCase();
}
