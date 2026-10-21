// Why a landing failed — ADR 0156 Amendment I § Failed landings: the
// taxonomy `workflow-trends.ts` charges each `land-failed` episode to, and
// the words the weekly report and the cockpit print for it. Its own module,
// with no imports, because the cockpit's page bundles it.

/** Why a landing failed (ADR 0156 Amendment I § Failed landings). */
export type LandingCause =
    | "rebase"
    | "red-base"
    | "defect"
    | "stale-artefact"
    | "environment"
    /** A red queue lane whose run left no `lane.json` to tell which red. */
    | "red-lane"
    | "other";

export const LANDING_CAUSES: readonly LandingCause[] = [
    "rebase",
    "red-base",
    "defect",
    "stale-artefact",
    "environment",
    "red-lane",
    "other",
];

export const LANDING_CAUSE_LABEL: Readonly<Record<LandingCause, string>> = {
    rebase: "rebase conflict",
    "red-base": "refused: RED base",
    defect: "red lane: the PR's own defect",
    "stale-artefact": "red lane: stale generated artefact",
    environment: "red lane: environment or flaky",
    "red-lane": "red lane: unclassified (no `lane.json`)",
    other: "other (no recognised comment)",
};
