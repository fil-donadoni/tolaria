/**
 * Which browser walk a health run owes (ADR 0131 amendment, issue #5076).
 *
 * Batch health used to run `check:ui --all` on every batch, whatever it
 * touched. It now walks what the BATCH can reach — the diff from the last
 * GREEN tip to the tip being gated, through the scoper `check:ui` and `land`
 * use — and only `bun run release` (and an explicit `--ui-all`) keeps the full
 * walk:
 *
 *   - no DOM-reaching path in the batch → `skipped`, no walk at all;
 *   - paths that reach some surfaces     → `scoped`, exactly those;
 *   - a global input, or anything the plan cannot read → `full`.
 *
 * Every unreadable input degrades to `full`, never to a smaller walk: an
 * unknown last-GREEN tip, a scoper that failed, a scoper line nobody can parse.
 *
 * Pure, and import-free beyond `ui-scope.ts` (types only at runtime):
 * `health-main.ts` carries the gate's zero-import constraint.
 */
import { SURFACES_FILE, UI_GATE_DIR } from "./ui-scope";

export type WalkPlan =
    | { kind: "skipped"; reason: string }
    | { kind: "scoped"; surfaces: string[] }
    | { kind: "full"; reason: string };

/** The walk entry `HEALTH_SCRIPTS` declares, and what `release` forces. */
export const FULL_WALK_ENTRY = "check:ui --all";

export const SKIPPED_REASON = "no DOM-reaching path in the batch";

/** `check:ui --scope-only`'s verdict lines (`renderUiScope`), read back.
 *  `null` for anything else: the caller walks full. */
export function parseScopeOnly(output: string): WalkPlan | null {
    const head = /scope \(diff base [^)]*\): (FULL|SCOPED) — (.*)/.exec(output);
    if (head === null) return null;
    if (head[1] === "FULL") return { kind: "full", reason: head[2].trim() };
    const surfaces = [...output.matchAll(/^ {2}· (\S+)\s*$/gm)].map(
        (m) => m[1]
    );
    const declared = /^(\d+) surface/.exec(head[2]);
    if (declared === null || Number(declared[1]) !== surfaces.length)
        return null;
    return surfaces.length === 0
        ? { kind: "skipped", reason: SKIPPED_REASON }
        : { kind: "scoped", surfaces };
}

function isProsePath(path: string): boolean {
    return /\.md$/.test(path) && !path.startsWith(UI_GATE_DIR);
}

export interface PlanInput {
    /** `--ui-all` and `release`: the backstop walk, whatever the batch is. */
    forceAll: boolean;
    /** The batch's changed paths; `null` when the last GREEN tip is unknown
     *  or unreadable. */
    changed: readonly string[] | null;
    /** `check:ui --scope-only --base=<green>` run at the tip: its stdout, or
     *  `null` when it could not run. Called at most once, and only when the
     *  batch has a path a cheap rule cannot place. */
    scopeOutput: () => string | null;
}

export function planHealthWalk({
    forceAll,
    changed,
    scopeOutput,
}: PlanInput): WalkPlan {
    if (forceAll) return { kind: "full", reason: "forced (--ui-all, release)" };
    if (changed === null)
        return {
            kind: "full",
            reason: "last GREEN tip unknown or unreadable",
        };
    // Prose alone needs no scoper. Nothing else is placed here: a `scripts/`
    // path is non-DOM only until the build configuration's closure or the
    // lane's own directory says otherwise, and that is the scoper's call.
    if (changed.every(isProsePath))
        return { kind: "skipped", reason: SKIPPED_REASON };
    // `check:ui` diffs the surface table against the merge-base with the base
    // branch, not against this batch's start: it cannot say which surfaces the
    // batch edited, so the batch walks them all.
    if (changed.includes(SURFACES_FILE))
        return { kind: "full", reason: `${SURFACES_FILE} edited in the batch` };
    const out = scopeOutput();
    const plan = out === null ? null : parseScopeOnly(out);
    return (
        plan ?? {
            kind: "full",
            reason: "scope unavailable: check:ui --scope-only unreadable",
        }
    );
}

/** `health:status`'s line, and the `last.json` `walk` text. */
export function describeWalkPlan(plan: WalkPlan): string {
    if (plan.kind === "scoped")
        return `scoped — ${plan.surfaces.length} surface(s): ${plan.surfaces.join(", ")}`;
    return `${plan.kind} — ${plan.reason}`;
}

/**
 * The walk entries one run executes, given its plan: `[]` when skipped, the
 * entry unchanged when full, and `check:ui --base=<green>` when scoped — the
 * walk re-derives the very scope the plan printed, from the same diff.
 */
export function walkEntriesFor(
    walk: readonly string[],
    plan: WalkPlan,
    greenSha: string | null
): string[] {
    if (plan.kind === "skipped") return [];
    if (plan.kind === "full" || greenSha === null) return [...walk];
    return walk.map((entry) =>
        entry === FULL_WALK_ENTRY ? `check:ui --base=${greenSha}` : entry
    );
}
