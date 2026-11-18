// Tables for the root-parallel note (issue #10135).
//
//   node summarize-ensemble.mjs quality <q1.jsonl> [<q2.jsonl> ...]
//   node summarize-ensemble.mjs workers <workers.json>

import { readFileSync } from "node:fs";
import { percentile } from "./stats.mjs";

const [kind, ...files] = process.argv.slice(2);
const fmt = (x, d = 2) => (x === null ? "—" : x.toFixed(d));

function quality() {
    // One row per (entry, seed, mode, budget): arms from several runs over
    // the same entries (`--arms`) join.
    const byJob = new Map();
    for (const f of files) {
        for (const line of readFileSync(f, "utf8").trim().split("\n")) {
            if (!line) continue;
            const r = JSON.parse(line);
            const key = `${r.tier}:${r.index}:${r.seed}:${r.mode}:${r.B}`;
            const seen = byJob.get(key);
            if (seen) Object.assign(seen.arms, r.arms);
            else byJob.set(key, r);
        }
    }
    const rows = [...byJob.values()];
    const perTree = rows[0].mode === "per-tree";
    const REF = perTree ? "1x(B)" : "1x(T)";
    // Only entries where one tree actually searched: a forced move (no
    // trace) says nothing about a merge.
    const all = rows.filter((r) => r.arms[REF]?.mechanism != null);
    const SPLITS = ["split2x(B)", "split4x(B)"];
    if (perTree) {
        for (const arm of ["1x(B)", "4x(B)", ...SPLITS]) {
            const ran = all.filter((r) => r.arms[arm]);
            const pass = ran.filter((r) => r.arms[arm].ok).length;
            console.log(`${arm}: ${pass} / ${ran.length} green`);
        }
        for (const arm of SPLITS) {
            const harmed = all.filter(
                (r) => r.arms[arm] && !r.arms[arm].ok && r.arms["1x(B)"].ok
            );
            console.log(
                `${arm} red where 1x(B) is green: ${harmed.length}` +
                    (harmed.length
                        ? `  ${harmed.map((r) => r.label.slice(0, 70)).join(" | ")}`
                        : "")
            );
        }
    }
    // Per tree, the deeper single trees ran only where 1x(B) or 4x(B) was red.
    const searched = perTree ? all.filter((r) => r.arms["1x(4B)"]) : all;
    const arms = perTree
        ? ["1x(B)", "1x(2B)", "1x(4B)", "2x(B)", "4x(B)", ...SPLITS].filter(
              (arm) => searched.every((r) => r.arms[arm])
          )
        : Object.keys(searched[0].arms);
    console.log(
        `${rows.length} sampled entries, ${all.length} searched, ${searched.length} in the table; load ${Math.min(...rows.map((r) => r.load))}–${Math.max(...rows.map((r) => r.load))}`
    );
    console.log(
        `\n| arm | must passes | same move as ${REF} | CPU ms, median |`
    );
    console.log("| --- | --- | --- | --- |");
    for (const arm of arms) {
        const pass = searched.filter((r) => r.arms[arm].ok).length;
        const same = searched.filter(
            (r) => r.arms[arm].move === r.arms[REF].move
        ).length;
        const cpu = percentile(
            searched.map((r) => r.arms[arm].cpuMs),
            50
        );
        console.log(
            `| ${arm} | ${pass} / ${searched.length} | ${same} / ${searched.length} | ${Math.round(cpu)} |`
        );
    }
    console.log("\nby T (must passes per arm):");
    for (const T of [...new Set(searched.map((r) => r.T))].sort(
        (a, b) => a - b
    )) {
        const at = searched.filter((r) => r.T === T);
        console.log(
            `T=${T} (${at.length}): ` +
                arms
                    .map(
                        (arm) =>
                            `${arm} ${at.filter((r) => r.arms[arm].ok).length}`
                    )
                    .join(", ")
        );
    }
    console.log(
        "\nflips (ensemble vs one of its own trees, vs one tree at T):"
    );
    const PAIRS = perTree
        ? [
              ["2x(B)", ["1x(B)", "1x(2B)"]],
              ["4x(B)", ["1x(B)", "1x(4B)"]],
              ["split2x(B)", ["1x(B)", "1x(2B)"]],
              ["split4x(B)", ["1x(B)", "1x(4B)"]],
          ].filter(([ens]) => arms.includes(ens))
        : [
              ["2x(T/2)", ["1x(T/2)", "1x(T)"]],
              ["4x(T/4)", ["1x(T/4)", "1x(T)"]],
          ];
    for (const [ens, refs] of PAIRS) {
        for (const ref of refs) {
            const gained = searched.filter(
                (r) => r.arms[ens].ok && !r.arms[ref].ok
            );
            const lost = searched.filter(
                (r) => !r.arms[ens].ok && r.arms[ref].ok
            );
            console.log(
                `${ens} vs ${ref}: +${gained.length} −${lost.length}` +
                    (lost.length
                        ? `  lost: ${lost.map((r) => r.label.slice(0, 70)).join(" | ")}`
                        : "")
            );
        }
    }
    const repeats = rows.flatMap((r) =>
        Object.values(r.arms).filter((a) => "repeatMove" in a)
    );
    const stable = repeats.filter((a) => a.repeatMove === a.move).length;
    console.log(
        `\ndeterminism: ${stable} / ${repeats.length} ensemble re-runs chose the same move`
    );
}

function workers() {
    const data = JSON.parse(readFileSync(files[0], "utf8"));
    console.log(
        `${data.cpu}, ${data.cores} cores, cap ${data.capMs} ms, positions ${data.positions.join(", ")}`
    );
    for (const e of data.engines) {
        console.log(
            `${e.name} ${e.version ?? ""}${e.failed ? ` FAILED ${e.failed}` : ""}, RSS per warm Worker ${e.rssPerWorkerMB ?? "—"} MB`
        );
    }
    const measured = data.rows.filter((r) => r.round > 0);
    const loads = measured.map((r) => r.load);
    console.log(`load ${Math.min(...loads)}–${Math.max(...loads)}`);
    console.log(
        "\n| engine | N | ensemble iterations ÷ one Worker's, p10 | median | p90 | per-Worker slowdown, median | one Worker's iterations, median |"
    );
    console.log("| --- | --- | --- | --- | --- | --- | --- |");
    for (const engine of data.engines.filter((e) => !e.failed)) {
        const mine = measured.filter((r) => r.engine === engine.name);
        const lone = new Map(
            mine
                .filter((r) => r.n === 1)
                .map((r) => [`${r.round}:${r.index}`, r.completed[0]])
        );
        for (const n of [1, 2, 3, 4]) {
            const at = mine.filter((r) => r.n === n);
            const gain = [];
            const slow = [];
            for (const r of at) {
                const one = lone.get(`${r.round}:${r.index}`);
                if (!one) continue;
                const total = r.completed.reduce((a, b) => a + b, 0);
                gain.push(total / one);
                slow.push(one / (total / n));
            }
            const ones = at.map((r) => lone.get(`${r.round}:${r.index}`));
            console.log(
                `| ${engine.name} | ${n} | ${fmt(percentile(gain, 10))} | ${fmt(percentile(gain, 50))} | ${fmt(percentile(gain, 90))} | ${fmt(percentile(slow, 50))} | ${Math.round(percentile(ones, 50))} |`
            );
        }
    }
}

if (kind === "quality") quality();
else if (kind === "workers") workers();
else {
    console.error("usage: summarize-ensemble.mjs quality|workers <files…>");
    process.exit(2);
}
