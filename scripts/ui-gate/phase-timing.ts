/**
 * Per-cell phase timing for `check:ui` (issue #4687).
 *
 * WHY. A full receipt cost 27–30 minutes uncontended and the diagnostic block
 * printed one number: total wall time. Nothing said what a cell spent on the
 * walk, the settle predicate, the probe, axe, the screenshot, the Named
 * Assertions or the cleanup — so no lever (fewer navigations, a built bundle,
 * more contexts) could be ranked on data. This module is the ruler: every cell
 * carries its seven phase durations, the cell line prints them, and the
 * diagnostic block closes with a per-phase total the levers are judged on.
 *
 * DIAGNOSTIC ONLY. Every line here lands in the diagnostic block or on a cell
 * line, neither of which `land` reads (`verify-receipt.ts` re-derives the
 * verdict block alone), so a timing can never invalidate a pasted receipt.
 *
 * Pure: the caller measures with `timed`, the rest is arithmetic on the
 * numbers it collected.
 */

/** The phases of one cell, in the order the lane runs them. `walk` is the
 *  surface's own navigation and clicks (their inner settles included);
 *  `settle` is the lane's final Settled Screen wait after the walk. */
export const PHASES = [
    "walk",
    "settle",
    "probe",
    "axe",
    "screenshot",
    "assertions",
    "cleanup",
] as const;

export type Phase = (typeof PHASES)[number];

/** Milliseconds spent per phase. A cell that never reached a phase holds 0. */
export type PhaseTimings = Record<Phase, number>;

export interface CellTiming {
    surface: string;
    viewport: string;
    ms: PhaseTimings;
}

export function emptyTimings(): PhaseTimings {
    return {
        walk: 0,
        settle: 0,
        probe: 0,
        axe: 0,
        screenshot: 0,
        assertions: 0,
        cleanup: 0,
    };
}

/** Run `fn`, adding its wall time to `t[phase]` whether it resolved or threw
 *  — a walk that failed still cost what it cost. */
export async function timed<T>(
    t: PhaseTimings,
    phase: Phase,
    fn: () => Promise<T>,
    now: () => number = Date.now
): Promise<T> {
    const start = now();
    try {
        return await fn();
    } finally {
        t[phase] += now() - start;
    }
}

/** Short names for the cell line, where the column is already wide. */
const SHORT: Record<Phase, string> = {
    walk: "walk",
    settle: "settle",
    probe: "probe",
    axe: "axe",
    screenshot: "shot",
    assertions: "assert",
    cleanup: "clean",
};

function secs(ms: number): string {
    return (ms / 1000).toFixed(1);
}

export function totalMs(t: PhaseTimings): number {
    return PHASES.reduce((sum, p) => sum + t[p], 0);
}

/** ` | t walk1.2 settle0.3 probe0.4 axe0.9 shot0.2 assert0.1 clean0.0 =3.1s`
 *  — appended to a measured cell line. */
export function cellTimingSuffix(t: PhaseTimings): string {
    const parts = PHASES.map((p) => `${SHORT[p]}${secs(t[p])}`);
    return ` | t ${parts.join(" ")} =${secs(totalMs(t))}s`;
}

/**
 * The run's per-phase account: total, share of the summed phases, mean per
 * cell and the single most expensive cell of each phase. Then the gap between
 * the phases' sum and the wall — everything a cell line does not own: sign-in,
 * the settle self-check, the warm-up navigation, INFRA waits and the serial
 * part of the viewport pool.
 */
export function phaseSummaryLines(
    cells: readonly CellTiming[],
    wallMs: number
): string[] {
    if (cells.length === 0) {
        return ["phase timing: no cell was measured"];
    }
    const sum = emptyTimings();
    const max: Record<Phase, { ms: number; where: string }> = {
        walk: { ms: -1, where: "" },
        settle: { ms: -1, where: "" },
        probe: { ms: -1, where: "" },
        axe: { ms: -1, where: "" },
        screenshot: { ms: -1, where: "" },
        assertions: { ms: -1, where: "" },
        cleanup: { ms: -1, where: "" },
    };
    for (const c of cells) {
        for (const p of PHASES) {
            sum[p] += c.ms[p];
            if (c.ms[p] > max[p].ms) {
                max[p] = { ms: c.ms[p], where: `${c.surface} @ ${c.viewport}` };
            }
        }
    }
    const all = totalMs(sum);
    const lines = [
        `phase timing: ${cells.length} cell(s), phases sum ${secs(all)}s of ${secs(wallMs)}s wall — the rest is sign-in, self-check, warm-up, INFRA waits and the pool's serial tail`,
    ];
    for (const p of PHASES) {
        const share = all > 0 ? Math.round((sum[p] / all) * 100) : 0;
        lines.push(
            `  ${p.padEnd(11)} total ${secs(sum[p]).padStart(7)}s  ${String(share).padStart(3)}%  mean ${secs(sum[p] / cells.length).padStart(5)}s  max ${secs(max[p].ms).padStart(5)}s (${max[p].where})`
        );
    }
    return lines;
}
