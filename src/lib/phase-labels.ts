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
};

export type PhaseGroup = {
    label: string;
    steps: PhaseStep[];
};

export const PHASE_GROUPS: PhaseGroup[] = [
    {
        label: "Beginning",
        steps: [
            { id: "UNTAP", short: "UT", label: "Untap" },
            { id: "UPKEEP", short: "UK", label: "Upkeep" },
            { id: "DRAW", short: "DR", label: "Draw" },
        ],
    },
    {
        label: "Main 1",
        steps: [{ id: "PRECOMBAT_MAIN", short: "M1", label: "Main Phase 1" }],
    },
    {
        label: "Combat",
        steps: [
            {
                id: "BEGINNING_OF_COMBAT",
                short: "BC",
                label: "Beginning of Combat",
            },
            {
                id: "DECLARE_ATTACKERS",
                short: "DA",
                label: "Declare Attackers",
            },
            { id: "DECLARE_BLOCKERS", short: "DB", label: "Declare Blockers" },
            {
                id: "FIRST_STRIKE_DAMAGE",
                short: "FD",
                label: "First Strike Damage",
            },
            { id: "COMBAT_DAMAGE", short: "CD", label: "Combat Damage" },
            { id: "END_OF_COMBAT", short: "EC", label: "End of Combat" },
        ],
    },
    {
        label: "Main 2",
        steps: [{ id: "POSTCOMBAT_MAIN", short: "M2", label: "Main Phase 2" }],
    },
    {
        label: "Ending",
        steps: [
            { id: "END_STEP", short: "ES", label: "End Step" },
            { id: "CLEANUP", short: "CL", label: "Cleanup" },
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
 *  table. Used by the portrait bottom bar's Phase tab (#1815 review fixup
 *  round 3; promoted to the tab's prominent step value by #1818) to keep the
 *  collapsed label from truncating at the 320px floor — see that component's
 *  doc comment for the char/px budget. */
export function phaseShort(phase: Phase): string {
    const step = STEP_BY_ID[phase];
    if (step) return step.short;
    return phase.slice(0, 2).toUpperCase();
}

/** Three-letter, uppercase abbreviation of a phase's GROUP label (e.g.
 *  "Combat" -> "COM", "Beginning" -> "BEG", "Main 1"/"Main 2" -> "MAI" for
 *  both — the trailing digit is dropped since {@link phaseShort} already
 *  disambiguates Main 1 vs Main 2 at the step level). Derived from
 *  {@link phaseGroupLabel} by a generic slice/uppercase transform rather than
 *  a hardcoded per-phase table, so it carries no new phase-specific strings.
 *  Used by the portrait bottom bar's Phase tab (#1818) as the compact caption
 *  alongside the granular {@link phaseShort} step code, so the tab shows both
 *  "which broad group" (small caption) and "which specific step" (prominent
 *  value) without growing past the tab's char/px budget. */
export function phaseGroupShort(phase: Phase): string {
    const letters = phaseGroupLabel(phase).replace(/[^A-Za-z]/g, "");
    return letters.slice(0, 3).toUpperCase();
}
