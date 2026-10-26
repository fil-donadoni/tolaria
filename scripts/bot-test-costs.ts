/**
 * `bun run bot:costs` — regenerate `data/bot-test-costs.json`, the per-file
 * cost table the scoped lanes admit bot tests by (issue #6943,
 * `lib/bot-test-costs.ts`).
 *
 * Reads the newest `laneBotBudget.medianOfRuns` sealed health runs under the
 * PRIMARY checkout's `.claude/telemetry/health/durations/` (health writes
 * there, issue #5484; a worktree has none) and writes, per bot file, the
 * median of its passed walls into THIS checkout — run it in a worktree and
 * ship the table as a PR like any other data change.
 *
 *   bun run bot:costs                    # the primary's health runs
 *   bun run bot:costs --durations <dir>  # any directory of <sha12>/ runs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    COSTS_PATH,
    medianWalls,
    newestRuns,
    readBotBudget,
    type BotTestCosts,
} from "./lib/bot-test-costs";
import { primaryCheckout } from "./lib/primary-checkout";

function main(argv: string[]): void {
    const root = process.cwd();
    const at = argv.indexOf("--durations");
    const durationsRoot =
        at >= 0 && argv[at + 1]
            ? argv[at + 1]
            : join(primaryCheckout(root), ".claude/telemetry/health/durations");
    const { medianOfRuns } = readBotBudget(root);
    const runs = newestRuns(durationsRoot, medianOfRuns);
    if (runs.length === 0) {
        console.error(
            `bot:costs: no sealed run with file walls under ${durationsRoot} — nothing written`
        );
        process.exit(1);
    }
    const table: BotTestCosts = {
        version: 1,
        runs: runs.length,
        source: runs.map((r) => r.dir.split("/").slice(-1)[0]),
        files: medianWalls(runs.map((r) => r.walls)),
    };
    writeFileSync(
        join(root, COSTS_PATH),
        `${JSON.stringify(table, null, 4)}\n`
    );
    console.log(
        `bot:costs: ${Object.keys(table.files).length} files over ${runs.length} run(s) → ${COSTS_PATH}`
    );
}

main(process.argv.slice(2));
