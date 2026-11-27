// What reading the generated vector at every evaluation costs per iteration
// (issue #10862): the base search against a search variant, on late-game
// boards, on the process CPU clock.
//
//   node docs/research/scripts/brain-bench/run-generated.mjs build <bundle.js>
//   node docs/research/scripts/brain-bench/run-generated.mjs speed <bundle.js> <out.json> \
//        [--field <fixture.json>]... [--selfplay <deckA>:<deckB>:<seed>]... \
//        [--arm generated-vector] [--iterations 60] [--rounds 3] \
//        [--play-iterations 20] [--min-turn 10] [--evaluations 2000]
//
// `speed` searches each board under `base` and under `--arm` at a fixed
// iteration count, in interleaved rounds whose order alternates, one warm-up
// round discarded — `run-rollout.mjs speed`'s method. A board is a field
// fixture (`field-position.mjs`, kept out of the repository) or a late-game
// board of a self-played game (`entry-generated.mjs`). It prints, per board,
// the CPU milliseconds per completed iteration of each arm, their ratio
// (median of the per-round ratios) and whether both arms picked the same
// move in every round; and, the same way, the CPU microseconds of ONE
// evaluation of the board under each arm (`--evaluations` calls a round).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleBench } from "./bundle.mjs";
import { median } from "./stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [command, bundle, out, ...rest] = process.argv.slice(2);

if (command === "build" && bundle) {
    mkdirSync(path.dirname(path.resolve(bundle)), { recursive: true });
    await bundleBench(path.join(here, "entry-generated.mjs"), bundle);
    console.log(`built ${bundle}`);
    process.exit(0);
}
if (command !== "speed" || !bundle || !out) {
    console.error(
        "usage: run-generated.mjs build <bundle.js> | speed <bundle.js> <out.json> [options]"
    );
    process.exit(2);
}

function option(name, fallback) {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
}
function options(name) {
    return rest.flatMap((v, i) => (rest[i - 1] === `--${name}` ? [v] : []));
}

await import(pathToFileURL(path.resolve(bundle)).href);
const bench = globalThis.__brainBench.generated;

const arm = option("arm", "generated-vector");
const iterations = Number(option("iterations", "60"));
const rounds = Number(option("rounds", "3"));
const playIterations = Number(option("play-iterations", "20"));
const minTurn = Number(option("min-turn", "10"));
const evaluations = Number(option("evaluations", "2000"));
const searchOptions = { iterations, clock: "cpu" };

/** Every board to read, by label. */
const jobs = [];
for (const file of options("field")) {
    const board = bench.fieldBoard(JSON.parse(readFileSync(file, "utf8")));
    jobs.push({ label: board.label, turn: board.turn });
}
for (const spec of options("selfplay")) {
    const [deckA, deckB, seed] = spec.split(":");
    const board = bench.selfPlayBoard({
        deckA,
        deckB,
        seed: Number(seed),
        playIterations,
        minTurn,
    });
    if (!board) {
        process.stderr.write(
            `${spec}: no searchable board from turn ${minTurn}, skipped\n`
        );
        continue;
    }
    process.stderr.write(
        `${board.label}: ${board.permanents} permanents (game: ${board.gameTurns} turns, ${board.gameEnd})\n`
    );
    jobs.push({ label: board.label, turn: board.turn });
}
if (jobs.length === 0) {
    console.error("speed: no board — give --field or --selfplay");
    process.exit(2);
}

const boards = [];
for (const job of jobs) {
    const rows = [];
    for (let round = 0; round <= rounds; round++) {
        const order = round % 2 === 0 ? ["base", arm] : [arm, "base"];
        for (const name of order) {
            const r = bench.runBoard(job.label, searchOptions, name);
            const e = bench.evaluationCost(job.label, evaluations, name);
            rows.push({
                round,
                arm: name,
                completed: r.completed,
                cpuMs: r.cpuMs,
                move: r.move,
                permanents: r.permanents,
                evaluationUs: e ? (e.cpuMs * 1000) / evaluations : null,
                evaluationSum: e ? e.sum : null,
            });
        }
    }
    // Round 0 is the warm-up.
    const at = (round, name) =>
        rows.find((r) => r.round === round && r.arm === name);
    const perIteration = (name) =>
        median(
            Array.from({ length: rounds }, (_, i) => {
                const r = at(i + 1, name);
                return r.cpuMs / r.completed;
            })
        );
    const ratios = Array.from({ length: rounds }, (_, i) => {
        const b = at(i + 1, "base");
        const h = at(i + 1, arm);
        return h.cpuMs / h.completed / (b.cpuMs / b.completed);
    });
    // A fixture that holds no stored row has no evaluation reading.
    const evaluated = rows[0].evaluationUs !== null;
    const evaluationUs = (name) =>
        evaluated
            ? Number(
                  median(
                      Array.from(
                          { length: rounds },
                          (_, i) => at(i + 1, name).evaluationUs
                      )
                  ).toFixed(1)
              )
            : null;
    const evaluationRatio = evaluated
        ? Number(
              median(
                  Array.from(
                      { length: rounds },
                      (_, i) =>
                          at(i + 1, arm).evaluationUs /
                          at(i + 1, "base").evaluationUs
                  )
              ).toFixed(4)
          )
        : null;
    const board = {
        label: job.label,
        permanents: rows[0].permanents,
        baseMsPerIteration: Number(perIteration("base").toFixed(3)),
        armMsPerIteration: Number(perIteration(arm).toFixed(3)),
        ratio: Number(median(ratios).toFixed(4)),
        ratios: ratios.map((r) => Number(r.toFixed(4))),
        sameMove: rows.every((r) => r.move === rows[0].move),
        baseEvaluationUs: evaluationUs("base"),
        armEvaluationUs: evaluationUs(arm),
        evaluationRatio,
        sameEvaluation: rows.every(
            (r) => r.evaluationSum === rows[0].evaluationSum
        ),
        load: Number(loadavg()[0].toFixed(1)),
        rows,
    };
    boards.push(board);
    const { rows: _rows, ...line } = board;
    console.log(JSON.stringify(line));
}

writeFileSync(
    out,
    JSON.stringify({ arm, iterations, rounds, evaluations, boards }, null, 1)
);
console.log(`wrote ${out}: ${boards.length} boards`);
