/**
 * Pure planning for `bun run prints:sync` (issue #5414): which flags were
 * given, which deployment the write goes to, and whether an
 * already-populated deployment lets the sync stop before the Scryfall
 * download. No I/O, so the test enumerates every branch.
 */

import { resolveSeedTarget, type SeedTargetPlan } from "./seed-preset-run";

export interface PrintsSyncArgs {
    dryRun: boolean;
    /** `--deploy`: the deployment `CONVEX_DEPLOY_KEY` selects (the hosting
     *  build, right after `convex deploy`), not the local one. */
    deploy: boolean;
    /** `--if-empty`: skip the sync when both Token Print tables have rows. */
    ifEmpty: boolean;
    /** `--warn-only`: a failure prints loudly and exits 0, for chains where a
     *  non-zero exit would block something unrelated (`dev`, a deploy). */
    warnOnly: boolean;
}

export function parsePrintsSyncArgs(argv: readonly string[]): PrintsSyncArgs {
    return {
        dryRun: argv.includes("--dry-run"),
        deploy: argv.includes("--deploy"),
        ifEmpty: argv.includes("--if-empty"),
        warnOnly: argv.includes("--warn-only"),
    };
}

export function printsSyncTarget(
    args: PrintsSyncArgs,
    env?: Record<string, string | undefined>
): SeedTargetPlan {
    return resolveSeedTarget(args.deploy ? "deployment" : "local", env);
}

export interface PrintsPopulated {
    cardPrints: boolean;
    definitionTokenPrints: boolean;
}

/** Tables a sync would fill, named for the log; empty = nothing owed. */
export function emptyPrintTables(populated: PrintsPopulated): string[] {
    return (["cardPrints", "definitionTokenPrints"] as const).filter(
        (table) => !populated[table]
    );
}

/** The loud line for a run that failed or found the tables empty. */
export function emptyTablesMessage(tables: readonly string[]): string {
    return (
        `prints-sync: ${tables.join(" + ")} EMPTY — every token renders the ` +
        `placeholder until \`bun run prints:sync\` runs`
    );
}
