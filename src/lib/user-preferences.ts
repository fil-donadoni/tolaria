/**
 * Shared vocabulary for the per-user Settings surface (issue #2595, PRD
 * #2405 slice 16/16, ADR 0101): density, motion, and the card-preview
 * Oracle/Printed default. `convex/userSettings.ts` is the persistence half;
 * this module is the client-side "what does an unset field mean" half,
 * shared by the settings page, the document-root effect that makes
 * density/motion "switch the tokens live", and `CardPreviewBody`'s seeded
 * initial toggle state.
 *
 * Phase stops are deliberately NOT here — `src/lib/skip-phase-prefs.ts` +
 * `src/hooks/useSkipPhasePreferences.ts` stay the single source of truth for
 * that store (localStorage, cross-tab synced); the settings page reads and
 * writes through the SAME hook the board pod uses, never a copy.
 */

export type DensityPreference = "compact" | "comfortable" | "roomy";
export type MotionPreference = "system" | "reduced";
export type PreviewPreference = "computed" | "printed";

export const DENSITY_PREFERENCE_OPTIONS: readonly {
    value: DensityPreference;
    label: string;
    description: string;
}[] = [
    {
        value: "compact",
        label: "Compact",
        description: "Tightest rhythm — banners, pickers, board prompts.",
    },
    {
        value: "comfortable",
        label: "Comfortable",
        description: "Phone-aware middle ground.",
    },
    {
        value: "roomy",
        label: "Roomy",
        description: "The default — lobby, dialogs, full-page surfaces.",
    },
];

export const MOTION_PREFERENCE_OPTIONS: readonly {
    value: MotionPreference;
    label: string;
    description: string;
}[] = [
    {
        value: "system",
        label: "System",
        description: "Follow the OS's Reduce Motion setting.",
    },
    {
        value: "reduced",
        label: "Reduced",
        description: "Always collapse animation, regardless of the OS.",
    },
];

export const PREVIEW_PREFERENCE_OPTIONS: readonly {
    value: PreviewPreference;
    label: string;
    description: string;
}[] = [
    {
        value: "computed",
        label: "Oracle (live text)",
        description:
            "Modern oracle wording, granted/lost abilities, effective P/T.",
    },
    {
        value: "printed",
        label: "Printed",
        description: "The original printing, as-is.",
    },
];

/** Matches `Panel`'s previous hard-coded default (issue #2581) — a user who
 *  has never opened Settings sees exactly what they always saw. */
export const DEFAULT_DENSITY_PREFERENCE: DensityPreference = "roomy";
/** The `@media (prefers-reduced-motion: reduce)` query keeps deciding. */
export const DEFAULT_MOTION_PREFERENCE: MotionPreference = "system";
/** `CardPreviewBody`'s previous hard-coded initial `useState`. */
export const DEFAULT_PREVIEW_PREFERENCE: PreviewPreference = "computed";

/**
 * Publish density/motion to `<html>` as `[data-density]`/`[data-motion]`
 * (`src/index.css`) — the mechanism that makes a Settings change "switch the
 * tokens live" for every Panel that does not pin its own rung. Takes the
 * element explicitly so it is unit-testable without depending on the real
 * `document` global.
 */
export function applyDocumentPreferences(
    root: Pick<HTMLElement, "dataset">,
    density: DensityPreference,
    motion: MotionPreference
): void {
    root.dataset.density = density;
    root.dataset.motion = motion;
}
