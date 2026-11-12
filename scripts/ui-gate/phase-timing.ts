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
    /** `walk` split into its sub-phases (issue #9268); absent on a cell
     *  measured before the split existed. */
    walk?: WalkSplit;
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
 * the phases' sum and the wall — everything a cell line does not own: the
 * fixed floor (`floorLines`, measured step by step), INFRA waits and the serial
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
        `phase timing: ${cells.length} cell(s), phases sum ${secs(all)}s of ${secs(wallMs)}s wall — the rest is the fixed floor (measured below), INFRA waits and the pool's serial tail`,
    ];
    for (const p of PHASES) {
        const share = all > 0 ? Math.round((sum[p] / all) * 100) : 0;
        lines.push(
            `  ${p.padEnd(11)} total ${secs(sum[p]).padStart(7)}s  ${String(share).padStart(3)}%  mean ${secs(sum[p] / cells.length).padStart(5)}s  max ${secs(max[p].ms).padStart(5)}s (${max[p].where})`
        );
    }
    return lines;
}

/* ── Walk sub-phases (issue #9268) ────────────────────────────────────────
 *
 * WHY. Over 27 runs `walk` was 70–90 % of cell time and one number: it could
 * not say whether a game row's ~13 s went to page navigation, to loading the
 * declared position through the debug sheet, or to waiting out conditional
 * prompts that never appear (a `clickIfVisible(…, 6000)` on a mulligan the
 * resumed game is already past pays the full timeout). The ledger below splits
 * `walk` into four EXCLUSIVE buckets that sum to it exactly:
 *
 *  - `goto`       — navigation + route ready (`surfaces.ts`'s `goto`);
 *  - `position`   — loading a declared position or fixture (the debug sheet's
 *                   scenario clicks, opening a seeded Limited event);
 *  - `absentWait` — waiting for an element that never appeared (a presence
 *                   probe that came back false: the conditional-click misses);
 *  - `interact`   — the rest of the walk.
 *
 * Exclusive by nesting: a `goto` inside a `position` load is charged to
 * `goto`, a miss inside either is charged to `absentWait`, and each bucket
 * keeps only the time no inner bucket claimed. `interact` is the walk minus
 * every claimed millisecond, computed from the SAME clock reading that charges
 * `walk`, so the four can never drift from it.
 *
 * The helpers reach the ledger through the `Page` they already hold
 * (`bindWalkLedger` / `walkLedgerOf`): it is bound only while a cell's walk
 * runs, so the same helpers called from `cleanup`, sign-in or an assertion
 * charge nothing. One walk is one sequential chain of awaits — no helper
 * call in `surfaces.ts` runs beside another — which is what lets one stack of
 * frames attribute time; two frames racing would each claim the overlap.
 */
export const WALK_SUBPHASES = [
    "goto",
    "position",
    "absentWait",
    "interact",
] as const;

export type WalkSubphase = (typeof WALK_SUBPHASES)[number];

/** A bucket a helper can claim; `interact` is only ever the remainder. */
export type ClaimedSubphase = Exclude<WalkSubphase, "interact">;

export type WalkSplit = Record<WalkSubphase, number>;

export function emptyWalkSplit(): WalkSplit {
    return { goto: 0, position: 0, absentWait: 0, interact: 0 };
}

interface Frame {
    /** Milliseconds inner frames claimed while this one was open. */
    claimed: number;
}

export interface WalkLedger {
    readonly split: WalkSplit;
    readonly now: () => number;
    /** Open frames, innermost last; the walk's own frame at the bottom. */
    readonly frames: Frame[];
}

export function newWalkLedger(
    split: WalkSplit,
    now: () => number = Date.now
): WalkLedger {
    return { split, now, frames: [] };
}

/**
 * Run `fn` inside a frame; when it settles, `decide(result)` names the bucket
 * its EXCLUSIVE time goes to (`null`: none — its unclaimed time stays with the
 * enclosing frame, only what inner frames claimed travels up). A step that
 * threw is charged to `onThrow`.
 */
async function framed<T>(
    ledger: WalkLedger,
    decide: (result: T) => ClaimedSubphase | null,
    onThrow: ClaimedSubphase | null,
    fn: () => Promise<T>
): Promise<T> {
    const frame: Frame = { claimed: 0 };
    const start = ledger.now();
    ledger.frames.push(frame);
    let bucket: ClaimedSubphase | null = onThrow;
    try {
        const result = await fn();
        bucket = decide(result);
        return result;
    } finally {
        const elapsed = ledger.now() - start;
        ledger.frames.pop();
        const parent = ledger.frames[ledger.frames.length - 1];
        if (bucket) {
            ledger.split[bucket] += elapsed - frame.claimed;
            if (parent) parent.claimed += elapsed;
        } else if (parent) {
            parent.claimed += frame.claimed;
        }
    }
}

/** Charge `fn`'s exclusive time to `sub`. No ledger (outside a walk): just
 *  run it. */
export async function chargeSub<T>(
    ledger: WalkLedger | undefined,
    sub: ClaimedSubphase,
    fn: () => Promise<T>
): Promise<T> {
    if (!ledger) return fn();
    return framed(ledger, () => sub, sub, fn);
}

/**
 * Run a presence probe — "did this element appear within the timeout?". A
 * MISS (`false`) charges its exclusive time to `absentWait`; a hit charges
 * nothing, so the wait before an element that did appear stays with whatever
 * the walk was doing. A probe that threw is not a miss either.
 */
export async function presence(
    ledger: WalkLedger | undefined,
    probe: () => Promise<boolean>
): Promise<boolean> {
    if (!ledger) return probe();
    return framed(
        ledger,
        (found) => (found ? null : "absentWait"),
        null,
        probe
    );
}

/**
 * Time one walk: adds its wall time to `t.walk` and, from the same two clock
 * readings, its unclaimed remainder to `ledger.split.interact` — so the four
 * sub-phases of a cell sum to its `walk`, attempt after attempt.
 */
export async function timedWalk<T>(
    t: PhaseTimings,
    ledger: WalkLedger,
    fn: () => Promise<T>
): Promise<T> {
    const root: Frame = { claimed: 0 };
    const start = ledger.now();
    ledger.frames.push(root);
    try {
        return await fn();
    } finally {
        const elapsed = ledger.now() - start;
        ledger.frames.pop();
        t.walk += elapsed;
        ledger.split.interact += elapsed - root.claimed;
    }
}

const LEDGERS = new WeakMap<object, WalkLedger>();

/** Make `ledger` the one the walk helpers find through `page`. */
export function bindWalkLedger(page: object, ledger: WalkLedger): void {
    LEDGERS.set(page, ledger);
}

export function unbindWalkLedger(page: object, ledger: WalkLedger): void {
    if (LEDGERS.get(page) === ledger) LEDGERS.delete(page);
}

export function walkLedgerOf(page: object): WalkLedger | undefined {
    return LEDGERS.get(page);
}

const SUB_SHORT: Record<WalkSubphase, string> = {
    goto: "goto",
    position: "pos",
    absentWait: "absent",
    interact: "act",
};

/** ` [goto1.0 pos3.1 absent6.0 act2.2]` — the walk's split, appended to a
 *  measured cell line after its phase column. */
export function walkSplitSuffix(split: WalkSplit): string {
    return ` [${WALK_SUBPHASES.map((s) => `${SUB_SHORT[s]}${secs(split[s])}`).join(" ")}]`;
}

/** The run's walk account, shaped like `phaseSummaryLines`: per sub-phase
 *  total, share of the summed walk, mean per cell, worst cell. */
export function walkSplitSummaryLines(cells: readonly CellTiming[]): string[] {
    const split = cells.filter((c) => c.walk);
    if (split.length === 0) return ["walk sub-phases: no walk was split"];
    const sum = emptyWalkSplit();
    const max = Object.fromEntries(
        WALK_SUBPHASES.map((s) => [s, { ms: -1, where: "" }])
    ) as Record<WalkSubphase, { ms: number; where: string }>;
    for (const c of split) {
        for (const s of WALK_SUBPHASES) {
            const ms = c.walk![s];
            sum[s] += ms;
            if (ms > max[s].ms) {
                max[s] = { ms, where: `${c.surface} @ ${c.viewport}` };
            }
        }
    }
    const all = WALK_SUBPHASES.reduce((n, s) => n + sum[s], 0);
    const lines = [
        `walk sub-phases: ${split.length} cell(s), walk ${secs(all)}s`,
    ];
    for (const s of WALK_SUBPHASES) {
        const share = all > 0 ? Math.round((sum[s] / all) * 100) : 0;
        lines.push(
            `  ${s.padEnd(11)} total ${secs(sum[s]).padStart(7)}s  ${String(share).padStart(3)}%  mean ${secs(sum[s] / split.length).padStart(5)}s  max ${secs(max[s].ms).padStart(5)}s (${max[s].where})`
        );
    }
    return lines;
}

/* ── The fixed per-run floor (issue #9268) ────────────────────────────────
 * What a run pays before and around its cells — measured, each its own line,
 * never inferred as "wall minus phases". */

export interface FloorStep {
    /** e.g. `serve`, `fleet bootstrap`. */
    label: string;
    ms: number;
    /** What the step covers, printed after the number. */
    detail: string;
}

export function floorLines(steps: readonly FloorStep[]): string[] {
    const total = steps.reduce((n, s) => n + s.ms, 0);
    return [
        `fixed floor: ${secs(total)}s measured over ${steps.length} step(s)`,
        ...steps.map(
            (s) =>
                `  ${s.label.padEnd(18)} ${secs(s.ms).padStart(7)}s  ${s.detail}`
        ),
    ];
}
