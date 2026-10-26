/**
 * The bot test files' MEASURED cost, and the lane's admission by it (issue
 * #6943, ADR 0154 §13).
 *
 * WHY. The lane's guard tier is cost (issue #4963): a check that costs seconds
 * runs at `land`, a dear one is health's. For vitest files the tier used to be
 * SUITE membership — no scoped lane ran a `bot-node` / `bot-dom` file at all —
 * so a census of milliseconds in a `*.bot.test.ts` file was health's, and its
 * red landed on the base: PR #6849 changed `mechanicsRegistry.ts`, which
 * `creatureKeywordBonus.bot.test.ts` imports; the walk reached it, the suite
 * rule excluded it, and the base stood RED for 2 h with 30 PRs held.
 *
 * THE PIPELINE:
 *
 *   1. `lib/vitest-duration-reporter.ts` writes, in every health run, one
 *      `FileWall` per bot file (`health/durations/<sha12>/`, issue #5484's
 *      directory).
 *   2. `bun run bot:costs` (`scripts/bot-test-costs.ts`) derives
 *      `COSTS_PATH` from the last `medianOfRuns` sealed runs: per file, the
 *      MEDIAN of its passed walls — committed, so the lane reads it offline
 *      and the plan stays a pure function of the tree.
 *   3. `check-lane.ts` admits, in every scoped lane, the bot files the diff
 *      reaches whose cost is under `perFileS`, cheapest first, up to
 *      `totalS` (`admitByCost`). The rest is NAMED in skip lines with its
 *      cost, or as unmeasured — never dropped silently.
 *
 * The budgets are config (`tolaria.config.json` `laneBotBudget`, read by this
 * module ONLY), never literals.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFileWalls, RUN_FILE, type FileWall } from "./test-headroom";

/** The committed cost table, repo-relative. */
export const COSTS_PATH = "data/bot-test-costs.json";

export interface BotTestCosts {
    version: 1;
    /** How many sealed health runs the medians are over. */
    runs: number;
    /** Where the walls came from: the run directories, newest first. */
    source: string[];
    /** Bot test file (repo-relative, posix) → median wall, ms. */
    files: Record<string, number>;
}

export interface BotBudget {
    /** A reached file costing more than this is skipped, named with its cost. */
    perFileMs: number;
    /** The admitted files' summed cost never exceeds this. */
    totalMs: number;
    /** How many of the newest sealed health runs `bot:costs` reads. */
    medianOfRuns: number;
}

/** `tolaria.config.json` `laneBotBudget`; a missing or malformed key throws —
 *  a lane that silently admitted nothing would be the old suite rule again. */
export function readBotBudget(root: string): BotBudget {
    const config = JSON.parse(
        readFileSync(join(root, "tolaria.config.json"), "utf8")
    ) as { laneBotBudget?: Record<string, unknown> };
    const b = config.laneBotBudget;
    const num = (k: string): number => {
        const v = b?.[k];
        if (typeof v !== "number" || !(v > 0))
            throw new Error(
                `tolaria.config.json: laneBotBudget.${k} must be a positive number`
            );
        return v;
    };
    return {
        perFileMs: num("perFileS") * 1000,
        totalMs: num("totalS") * 1000,
        medianOfRuns: num("medianOfRuns"),
    };
}

/** The committed table's file costs; absent file → empty (every reached file
 *  is then a skip line saying it is unmeasured). */
export function readBotTestCosts(root: string): Record<string, number> {
    const p = join(root, COSTS_PATH);
    if (!existsSync(p)) return {};
    const parsed = JSON.parse(readFileSync(p, "utf8")) as Partial<BotTestCosts>;
    return parsed.files ?? {};
}

const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * Per file, the median over `runs` of its wall in that run. Within one run a
 * file a retry re-ran is counted at its WORST passed wall (the retry ran
 * contended); a file that never passed in a run contributes nothing from it —
 * a red or a timeout measures the failure, not the cost.
 */
export function medianWalls(
    runs: readonly (readonly FileWall[])[]
): Record<string, number> {
    const perFile = new Map<string, number[]>();
    for (const walls of runs) {
        const worst = new Map<string, number>();
        for (const w of walls) {
            if (w.state !== "passed") continue;
            worst.set(w.file, Math.max(worst.get(w.file) ?? 0, w.wallMs));
        }
        for (const [file, ms] of worst) {
            const list = perFile.get(file);
            if (list) list.push(ms);
            else perFile.set(file, [ms]);
        }
    }
    const out: Record<string, number> = {};
    for (const file of [...perFile.keys()].sort())
        out[file] = median(perFile.get(file)!);
    return out;
}

/**
 * The newest `n` sealed run directories under `durationsRoot` (each a
 * `<sha12>/` holding `RUN_FILE`) that recorded at least one file wall, newest
 * first by `run.json`'s `ts`.
 */
export function newestRuns(
    durationsRoot: string,
    n: number
): { dir: string; walls: FileWall[] }[] {
    if (!existsSync(durationsRoot)) return [];
    const sealed: { dir: string; ts: number }[] = [];
    for (const name of readdirSync(durationsRoot)) {
        const dir = join(durationsRoot, name);
        try {
            const meta = JSON.parse(
                readFileSync(join(dir, RUN_FILE), "utf8")
            ) as { ts?: unknown };
            if (typeof meta.ts === "number") sealed.push({ dir, ts: meta.ts });
        } catch {
            // unsealed or not a run
        }
    }
    sealed.sort((a, b) => b.ts - a.ts || (a.dir < b.dir ? -1 : 1));
    const out: { dir: string; walls: FileWall[] }[] = [];
    for (const { dir } of sealed) {
        if (out.length >= n) break;
        const walls = readFileWalls(dir);
        if (walls.length > 0) out.push({ dir, walls });
    }
    return out;
}

export interface BotAdmission {
    /** Admitted, cheapest first (ties by path). */
    admitted: string[];
    /** Reached, but alone above `perFileMs`. */
    overFile: { file: string; ms: number }[];
    /** Reached, under `perFileMs`, but past `totalMs` once the cheaper ones
     *  were in. */
    overTotal: { file: string; ms: number }[];
    /** Reached, with no row in the cost table. */
    unmeasured: string[];
    /** The admitted files' summed cost. */
    admittedMs: number;
}

/** Cheapest first under both budgets (issue #6943): a hub change reaching
 *  most of the bot suite still admits every census, because they cost least. */
export function admitByCost(
    reached: readonly string[],
    costs: Readonly<Record<string, number>>,
    budget: Pick<BotBudget, "perFileMs" | "totalMs">
): BotAdmission {
    const out: BotAdmission = {
        admitted: [],
        overFile: [],
        overTotal: [],
        unmeasured: [],
        admittedMs: 0,
    };
    const measured: { file: string; ms: number }[] = [];
    for (const file of [...reached].sort()) {
        const ms = costs[file];
        if (ms === undefined) out.unmeasured.push(file);
        else if (ms > budget.perFileMs) out.overFile.push({ file, ms });
        else measured.push({ file, ms });
    }
    measured.sort((a, b) => a.ms - b.ms || (a.file < b.file ? -1 : 1));
    for (const m of measured) {
        if (out.admittedMs + m.ms > budget.totalMs) out.overTotal.push(m);
        else {
            out.admitted.push(m.file);
            out.admittedMs += m.ms;
        }
    }
    return out;
}

/** `1234` → `1.2 s` — the cost as a skip line prints it. */
export const formatCost = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
