/**
 * The `## Target files` of the generated Quarantine, Bot Gap and Migration
 * issues (issue #8055) — `grammar-gap-target-files.ts`'s job for the other
 * families.
 *
 * An issue that declares nothing has an unknown blast radius: picked, it runs
 * alone and closes the batch; waiting, it yields to every higher-band
 * reservation. So each family declares what its key names, and only that — a
 * set as wide as the engine would turn solo into overlap with everything.
 *
 * - **Migration** deletes definitions from known set modules: those modules.
 * - **Bot Gap** is routed by its cause, the seam of the reachability walk
 *   (`docs/guides/bot-reachability.md`). Sibling gaps of one cause share a
 *   file and serialise — they do move the same valuation and sweep.
 * - **Quarantine** is routed by its reason. A `scenario` class names the gate
 *   that refused it; a keyword class names that keyword's own module, because
 *   the one file every keyword does edit, the Mechanics Registry, is a row per
 *   keyword: declaring it made every keyword overlap every registry PR in
 *   flight, which on the 2026-11-04 snapshot picked none of the 34.
 *
 * Anything unrecognised declares nothing rather than guessing: an unknown blast
 * radius is scheduled solo, a wrong one parallelises two issues that collide.
 *
 * Type-only imports: both tables must stay total over the engine's unions
 * (`tsc` reds on a new cause or reason) without pulling the engine into
 * `gaps:sync` at runtime.
 */

import type { BotReachCause } from "../../convex/gre/ai/botReach";
import type { QuarantineReason } from "../../convex/oracle/types";

/** The separator `quarantineClass` and `botGapKey` join a key's parts with. */
const KEY_SEPARATOR = " › ";

const BOT_REACH = "convex/gre/ai/botReach.ts";

/** Each Bot Gap cause → the files its fix lands in (`botCauseText`'s seams). */
export const BOT_CAUSE_FILES: Readonly<
    Record<BotReachCause, readonly string[]>
> = {
    // Seam 3 or a position the sweep does not pose yet — either way these two.
    "never-chosen": [BOT_REACH, "convex/gre/ai/opValuers.ts"],
    "position-unmodelled": [BOT_REACH, "convex/gre/ai/botReachTarget.ts"],
    "no-progress": [BOT_REACH],
    "harness-error": [BOT_REACH],
    "no-legal-move": ["convex/gre/moves.ts"],
    "unanswerable-input": ["convex/gre/ai/choiceCandidates.ts"],
};

/** The reasons a Quarantine key can open with — the Bot's is a Bot Gap key. */
type QuarantineKeyReason = Exclude<QuarantineReason["kind"], "bot-unreachable">;

/**
 * Each reason → the files that clear it. `null` is a keyword reason: its file
 * comes from the keyword the key names (`keywordModule`).
 */
export const QUARANTINE_REASON_FILES: Readonly<
    Record<QuarantineKeyReason, readonly string[] | null>
> = {
    "planned-op": ["convex/gre/effects/interpreter.ts"],
    "planned-mechanic": null,
    "ungrantable-keyword": null,
    "validate-effect-script": ["convex/gre/effects/validate.ts"],
    "smoke-scenario": ["convex/gre/effects/scenarioGenerator.ts"],
    "wire-projection": ["convex/oracle/gates.ts"],
    "not-json": ["convex/oracle/gates.ts"],
};

/**
 * The module a keyword's implementation lives in, by the directory's own
 * spelling: `split second` → `convex/cards/abilities/splitSecond.ts`. A planned
 * keyword's module does not exist yet; the path still serialises the two
 * classes one keyword can carry.
 */
export function keywordModule(keyword: string): string {
    const [head = "", ...rest] = keyword
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word !== "");
    const camel = [
        head,
        ...rest.map((word) => word[0]!.toUpperCase() + word.slice(1)),
    ].join("");
    return `convex/cards/abilities/${camel}.ts`;
}

/** The files a Bot Gap issue declares, `null` for a cause with no row. */
export function botGapTargetFiles(key: string): readonly string[] | null {
    const cause = key.split(KEY_SEPARATOR)[0] ?? "";
    return (
        (BOT_CAUSE_FILES as Readonly<Record<string, readonly string[]>>)[
            cause
        ] ?? null
    );
}

/** The files a Quarantine issue declares, `null` when its key names none. */
export function quarantineTargetFiles(key: string): readonly string[] | null {
    const reason = key.split(KEY_SEPARATOR)[0] ?? "";
    const files = (
        QUARANTINE_REASON_FILES as Readonly<
            Record<string, readonly string[] | null | undefined>
        >
    )[reason];
    if (files === undefined) return null;
    if (files !== null) return files;
    const keyword = /keyword "([^"]+)"/.exec(key)?.[1];
    return keyword === undefined ? null : [keywordModule(keyword)];
}

/** `Graduate.module`'s placeholder for a card no set module was found for. */
export const MODULE_NOT_FOUND = "(module not found)";

/** The set modules a Migration cluster retires definitions from, sorted. */
export function migrationTargetFiles(
    modules: readonly string[]
): readonly string[] {
    return [...new Set(modules)]
        .filter((module) => module !== MODULE_NOT_FOUND)
        .sort();
}

/**
 * The `## Target files` section a body ends on — opening blank line included —
 * or no lines for no files: an empty list would read as "touches nothing" and
 * batch beside everything, where no section reads as unknown.
 */
export function renderTargetFilesSection(
    files: readonly string[] | null
): string[] {
    if (files === null || files.length === 0) return [];
    return ["", "## Target files", "", ...files.map((f) => `- \`${f}\``)];
}
