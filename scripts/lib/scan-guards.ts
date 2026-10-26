/**
 * Repo-wide scan guards (issue #7012): a `*.guard.test.ts(x)` file is a
 * census that READS its corpus through `fs` (a grep over `src/**`, the CSS,
 * `index.html`), so no import edge reaches it from the diff and the scoped
 * `vitest(related)` run (ADR 0154 §2) never selects it. PR #6973 landed a
 * bare `100vh` past `no-bare-100vh.guard.test.ts` that way, and health found
 * it 34 minutes later.
 *
 * Each guard file DECLARES what it scans and what it costs, in two header
 * lines the planner reads as text (importing a test file would run it):
 *
 *     // lane-scans: src/** index.html
 *     // lane-cost: 7 s (how it was measured)
 *
 * `lane-scans` is a space-separated list of repo-relative globs
 * (`globToRegExp`'s `**` / `*` / `{a,b}`); `lane-cost` is the measured
 * seconds. A diff with a path matching one glob admits the guard WHOLE, like
 * a `CHEAP_GUARDS` row; one whose cost is over `LANE_COST_BUDGET_S` stays
 * health's and must be named in `HEALTH_ONLY_GUARDS`. There is
 * no hand-kept list: the files are discovered by name.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globToRegExp } from "./bot-globs";

/** What names a scan guard: `git ls-files` pathspecs, `*` spanning `/`. */
export const SCAN_GUARD_PATHSPECS = [
    "*.guard.test.ts",
    "*.guard.test.tsx",
] as const;

export interface ScanGuard {
    /** Repo-relative path of the guard test file. */
    file: string;
    /** The globs whose paths the guard reads. */
    scans: readonly string[];
    /** Measured cost, seconds. */
    costS: number;
}

const SCANS_LINE = /^\s*\/\/\s*lane-scans:\s*(.+?)\s*$/m;
const COST_LINE = /^\s*\/\/\s*lane-cost:\s*(\d+(?:\.\d+)?)\s*s\b/m;

/**
 * Parse one guard file's declaration; throws naming the file and the missing
 * line, so an undeclared guard refuses at the lane of the PR that adds it.
 */
export function parseScanGuard(file: string, source: string): ScanGuard {
    const scans = SCANS_LINE.exec(source)?.[1].split(/\s+/);
    const cost = COST_LINE.exec(source)?.[1];
    if (!scans || cost === undefined)
        throw new Error(
            `${file}: a *.guard.test file must declare \`// lane-scans: <glob> …\` and \`// lane-cost: <seconds> s\` (issue #7012) — the lane admits it by those globs`
        );
    return { file, scans, costS: Number(cost) };
}

/** Every scan guard in the tree at `root`, from `git ls-files`. */
export function discoverScanGuards(root: string): ScanGuard[] {
    const out = spawnSync("git", ["ls-files", "--", ...SCAN_GUARD_PATHSPECS], {
        cwd: root,
        encoding: "utf8",
    });
    if (out.status !== 0)
        throw new Error(`git ls-files failed: ${out.stderr.trim()}`);
    return out.stdout
        .split("\n")
        .filter(Boolean)
        .sort()
        .map((file) =>
            parseScanGuard(file, readFileSync(join(root, file), "utf8"))
        );
}

/** Does any of `files` match one of the guard's `scans` globs, or is it
 *  the guard file itself? */
export function scanGuardAdmits(
    guard: ScanGuard,
    files: readonly string[]
): boolean {
    const res = guard.scans.map(globToRegExp);
    return files.some((p) => p === guard.file || res.some((re) => re.test(p)));
}
