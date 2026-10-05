/**
 * When a health batch owes the blade robustness audit, and how much of it
 * (issue #5078).
 *
 * `blade:robustness` (issue #4875) is ~16 min of search over every `must`
 * entry. It used to ride `batchTouchesBot` — any file under `BOT_GLOBS` — and
 * ran on 12 of the last 14 health runs although most Bot-glob changes (the
 * `bot:reach` sweep tooling, the Verdict quiz UI, blade infrastructure, tests)
 * are code the search never imports. `batchTouchesBot` stays as it is for the
 * Bot Findings refresh; the audit asks this module instead.
 *
 * What the audit's result is a function of: the entry definition, the
 * committed eval weights, the Bot code the search executes, and the engine the
 * rollouts simulate. This module triggers on the first three:
 *
 *   - FULL        a changed file is in `BOT_GLOBS` AND in the static import
 *                 closure of the audit (`ROBUSTNESS_ROOTS`, the shard runner
 *                 that runs each entry's search, and through it the eval
 *                 weights) — the closure is derived from the source on every
 *                 run, so tooling the search never imports drops out by itself
 *                 and a module it starts importing joins by itself;
 *   - INCREMENTAL the only trigger-relevant change is the blade registry's own
 *                 entries: audit just the `must` entries added or whose
 *                 definition changed since the last GREEN tip (matched by
 *                 label; a retitle is a delete plus an add);
 *   - NONE        otherwise.
 *
 * An unknown last-GREEN tip, an unreadable diff or a registry this module
 * cannot read with confidence is FULL.
 *
 * DECLARED RESIDUAL — the engine. `convex/gre/**` outside `BOT_GLOBS` and the
 * cards are in the closure but never trigger: an engine change can shift
 * rollouts and RNG consumption, yet a real flip of an entry's own seeds is
 * still caught by `test:blade` in every health run (`wrong`), and the three
 * historical pins (issue #4768, issue #4777, issue #4874) all came from
 * refits. What is lost is only the PREDICTION of an engine-induced fragility —
 * a pin the next Bot batch will find.
 *
 * Builtins, `bot-globs.ts`, `import-graph.ts` and `blade-registry-entries.ts`
 * (each builtins only) — `health-main.ts`'s own constraint.
 */
import { execFileSync } from "node:child_process";
import { matchesBotGlob } from "./bot-globs";
import { registryChange, type RegistryChange } from "./blade-registry-entries";
import { createImportGraph, type ImportGraphSource } from "./import-graph";

/** The module that runs one entry's audit: the shard runner every
 *  `robustness.shard-N.spec.ts` registers through. Its closure is the Bot
 *  code the audit executes — `search`, the evaluator, the valuers, the eval
 *  weights, the baseline it compares against. */
export const ROBUSTNESS_ROOTS: readonly string[] = [
    "convex/gre/ai/blade/__tests__/robustnessShardRunner.helper.ts",
    "convex/gre/ai/evalWeights.ts",
];

/** The file whose entries an incremental audit is cut from. */
export const REGISTRY_PATH = "convex/gre/ai/blade/registry.ts";

/** Env var the shard runner reads: a JSON array of `must` labels to audit. */
export const ROBUSTNESS_LABELS_ENV = "BLADE_ROBUSTNESS_LABELS";

export type RobustnessMode =
    | { kind: "none"; reason: string }
    | { kind: "full"; reason: string }
    | { kind: "incremental"; reason: string; labels: string[] };

export interface RobustnessInputs {
    /** Paths between the last GREEN tip and this one; `null` when the diff
     *  could not be taken. */
    changed: readonly string[] | null;
    /** The audit's import closure at the tip — asked only when a Bot-glob
     *  file changed. */
    closure: () => ReadonlySet<string>;
    /** What changed in the registry — asked only when it is the one
     *  trigger-relevant file. */
    registry: () => RegistryChange;
}

export function robustnessMode(inputs: RobustnessInputs): RobustnessMode {
    const { changed } = inputs;
    if (changed === null)
        return {
            kind: "full",
            reason: "unknown last-GREEN tip or unreadable diff",
        };
    const botFiles = changed.filter(matchesBotGlob);
    if (botFiles.length === 0)
        return { kind: "none", reason: "no Bot-glob file changed" };

    const closure = inputs.closure();
    const relevant = botFiles.filter((f) => closure.has(f));
    if (relevant.length === 0)
        return {
            kind: "none",
            reason: `${botFiles.length} Bot-glob file(s) changed, none in the audit's import closure (first: ${botFiles[0]})`,
        };
    const other = relevant.find((f) => f !== REGISTRY_PATH);
    if (other !== undefined)
        return { kind: "full", reason: `${other} is in the audit's closure` };

    const change = inputs.registry();
    if (change.kind === "other")
        return { kind: "full", reason: `${REGISTRY_PATH}: ${change.why}` };
    if (change.labels.length === 0)
        return {
            kind: "none",
            reason: `${REGISTRY_PATH} changed, no must entry added or changed`,
        };
    return {
        kind: "incremental",
        labels: change.labels,
        reason: `${REGISTRY_PATH}: ${change.labels.length} must entr${change.labels.length === 1 ? "y" : "ies"} added or changed`,
    };
}

/** One line for `health:status` and the run's log. */
export function describeRobustnessMode(mode: RobustnessMode): string {
    return mode.kind === "none"
        ? `blade:robustness not run — ${mode.reason}`
        : `blade:robustness ${mode.kind} — ${mode.reason}`;
}

/** Does the audit run at all? */
export function robustnessOwed(mode: RobustnessMode): boolean {
    return mode.kind !== "none";
}

/** The env a step runs with: the label filter, in incremental mode only. */
export function robustnessStepEnv(
    mode: RobustnessMode
): Record<string, string> | undefined {
    return mode.kind === "incremental"
        ? { [ROBUSTNESS_LABELS_ENV]: JSON.stringify(mode.labels) }
        : undefined;
}

function git(root: string, args: string[]): string {
    return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
    });
}

/** The tree at git revision `rev`, read without checking it out. */
export function gitTreeSource(root: string, rev: string): ImportGraphSource {
    const files = new Set(
        git(root, ["ls-tree", "-r", "--name-only", rev])
            .split("\n")
            .filter((l) => l !== "")
    );
    return {
        isFile: (p) => files.has(p),
        readFile: (p) => git(root, ["show", `${rev}:${p}`]),
    };
}

/**
 * The mode for a batch `green..tip`, read from git. Any failure reading the
 * trees is FULL — an audit that cannot be decided is an audit that runs.
 */
export function robustnessModeFromGit(opts: {
    root: string;
    green: string | null;
    tip: string;
    changed: readonly string[] | null;
}): RobustnessMode {
    const { root, green, tip, changed } = opts;
    try {
        return robustnessMode({
            changed: green === null ? null : changed,
            closure: () => {
                const graph = createImportGraph({
                    root,
                    source: gitTreeSource(root, tip),
                });
                const all = new Set<string>();
                for (const entry of ROBUSTNESS_ROOTS)
                    for (const f of graph.closureOf(entry)) all.add(f);
                return all;
            },
            registry: () => {
                let before: string | null = null;
                try {
                    before = git(root, ["show", `${green}:${REGISTRY_PATH}`]);
                } catch {
                    before = null;
                }
                return registryChange(
                    before,
                    git(root, ["show", `${tip}:${REGISTRY_PATH}`])
                );
            },
        });
    } catch (err) {
        return {
            kind: "full",
            reason: `trigger undecidable (${String(err).slice(0, 120)})`,
        };
    }
}
