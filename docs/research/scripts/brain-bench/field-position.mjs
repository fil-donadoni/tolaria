// Pull a FIELD position for the bench (issue #10122): one production game's
// stored row and its library companion (ADR 0179), read-only, written as the
// fixture `entry.mjs`'s `runField` expands and searches.
//
//   node docs/research/scripts/brain-bench/field-position.mjs <gameIdPrefix> <out.json> [--cwd <checkout>]
//
// `--cwd` is the checkout whose Convex project is the production one (the
// primary checkout; a worktree's `.env.local` names a local deployment).
// The fixture holds a real game's board and the players' ids: keep it out of
// the repository.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const cwdAt = args.indexOf("--cwd");
const cwd = cwdAt === -1 ? process.cwd() : args[cwdAt + 1];
const [prefix, out] = args.filter((_, i) => i !== cwdAt && i !== cwdAt + 1);
if (!prefix || !out) {
    console.error(
        "usage: field-position.mjs <gameIdPrefix> <out.json> [--cwd <checkout>]"
    );
    process.exit(2);
}

/** Every row of `table` whose `gameId` starts with the prefix. */
function rows(table) {
    const res = spawnSync(
        "npx",
        [
            "convex",
            "data",
            table,
            "--prod",
            "--limit",
            "10000",
            "--format",
            "jsonLines",
        ],
        { cwd, encoding: "utf8", maxBuffer: 1 << 28 }
    );
    if (res.status !== 0) {
        console.error(`convex data ${table}: exit ${res.status}`);
        process.exit(1);
    }
    return res.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((row) => String(row.gameId).startsWith(prefix));
}

const [state] = rows("gameStates");
if (!state) {
    console.error(`no gameStates row for ${prefix}`);
    process.exit(1);
}
const [library] = rows("gameLibraries");
writeFileSync(
    out,
    JSON.stringify({
        label: `field ${prefix} seq ${state.seq}`,
        state: state.state,
        libraries: library?.payload ?? null,
    })
);
console.log(`wrote ${out} (seq ${state.seq})`);
