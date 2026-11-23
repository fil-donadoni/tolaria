// Fold the leaf-parallel bench's outputs (issue #10450) into the note's
// tables.
//
//   node docs/research/scripts/brain-bench/summarize-leaf.mjs throughput <browsers.json>
//   node docs/research/scripts/brain-bench/summarize-leaf.mjs handoff <browsers.json> <handoff-v8.json>
//   node docs/research/scripts/brain-bench/summarize-leaf.mjs quality <q.jsonl>... [--base base] [--control k0s]
//
// `throughput`: per engine and board kind, each arm's completed iterations
// over `k0s`'s in the same round on the same board (the ratio), its median
// over rounds per board, then the median and range over boards; the median
// iterations per decision; the per-helper rollout slowdown (a helper's mean
// rollout at K over the same transport's at K = 1, all boards' rollouts
// pooled); and the per-rollout hand-off the coordinator and a helper paid.
//
// `handoff`: per engine and board, the medians of a structured clone of the
// world, of a replay from the seed and path, and of the rollout; the world's
// JSON size; and the root state's one clone per search.
//
// `quality`: per arm, `must` green over the jobs with a search, and flips /
// fixes against the base arm and against the control.

import { readFileSync } from "node:fs";
import { median } from "./stats.mjs";

const [command, ...files] = process.argv.slice(2);
const r2 = (x) =>
    x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(2);
const r1 = (x) =>
    x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(1);

function throughput(file) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const rows = data.rows.filter((r) => r.round > 0);
    console.log(
        `cores ${data.cores}, ${data.memGB} GB, blade cap ${data.bladeCap} ms, field cap ${data.fieldCap} ms`
    );
    for (const e of data.engines) {
        console.log(
            `engine ${e.name} ${e.version ?? ""} rss/worker ${e.rssPerWorkerMB ?? "—"} MB${e.failed ? " FAILED " + e.failed : ""}`
        );
    }
    const loads = rows.map((r) => r.load);
    console.log(`load ${Math.min(...loads)}–${Math.max(...loads)}`);
    const engines = [...new Set(rows.map((r) => r.engine))];
    const arms = [...new Set(rows.map((r) => r.arm))];
    for (const engine of engines) {
        for (const kind of ["blade", "field"]) {
            const er = rows.filter(
                (r) => r.engine === engine && r.kind === kind
            );
            if (!er.length) continue;
            const targets = [...new Set(er.map((r) => r.target))];
            console.log(`\n## ${engine}, ${kind} (${targets.length} boards)`);
            console.log(
                "| arm | ÷ k0s, median over boards | range | iterations / decision, median | helper rollout slowdown | coordinator post ms / rollout | helper receive ms / rollout | replay ms / rollout | rollout ms (helper) |"
            );
            console.log(
                "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
            );
            const k1Rollout = {};
            for (const t of ["clone", "replay"]) {
                const k1 = er.filter((r) => r.arm === `${t}1`);
                const ms = k1.reduce((n, r) => n + r.transfer.rolloutMs, 0);
                const n = k1.reduce((n, r) => n + r.transfer.settled, 0);
                k1Rollout[t] = n ? ms / n : null;
            }
            for (const arm of arms) {
                const perBoard = targets.map((t) => {
                    const ratios = [];
                    for (const round of new Set(er.map((r) => r.round))) {
                        const at = (a) =>
                            er.find(
                                (r) =>
                                    r.target === t &&
                                    r.round === round &&
                                    r.arm === a
                            );
                        const a = at(arm);
                        const b = at("k0s");
                        if (a && b && b.completed)
                            ratios.push(a.completed / b.completed);
                    }
                    return ratios.length ? median(ratios) : null;
                });
                const ok = perBoard.filter((x) => x !== null);
                const ar = er.filter((r) => r.arm === arm);
                const done = ar.map((r) => r.completed);
                const tr = ar.filter(
                    (r) => r.transfer && r.transfer.settled > 0
                );
                const sum = (k) => tr.reduce((n, r) => n + r.transfer[k], 0);
                const settled = sum("settled");
                const jobs = sum("jobs");
                const t = arm.startsWith("replay") ? "replay" : "clone";
                const rollout = settled ? sum("rolloutMs") / settled : null;
                console.log(
                    `| ${arm} | ${r2(ok.length ? median(ok) : null)} | ${r2(Math.min(...ok))}–${r2(Math.max(...ok))} | ${Math.round(median(done))} | ${tr.length && k1Rollout[t] ? r2(rollout / k1Rollout[t]) : "—"} | ${jobs ? r2(sum("postMs") / jobs) : "—"} | ${settled ? r2(sum("recvMs") / settled) : "—"} | ${settled ? r2(sum("replayMs") / settled) : "—"} | ${r1(rollout)} |`
                );
            }
        }
    }
}

function handoff(browsersFile, v8File) {
    const rows = [];
    const b = JSON.parse(readFileSync(browsersFile, "utf8"));
    for (const h of b.handoff) {
        rows.push({ engine: h.engine, kind: h.kind, ...fold(h) });
    }
    if (v8File) {
        const v = JSON.parse(readFileSync(v8File, "utf8"));
        for (const h of v.rows) {
            rows.push({
                engine: v.engine,
                kind: h.kind,
                label: h.label,
                permanents: h.permanents,
                leaves: h.leaves,
                cloneMs: h.cloneMs.median,
                replayMs: h.replayMs.median,
                rolloutMs: h.rolloutMs.median,
                kb: h.bytes.median / 1024,
                path: h.pathLength.median,
                rootCloneMs: h.rootCloneMs,
                rootKb: h.rootBytes / 1024,
            });
        }
    }
    console.log(
        "| engine | board | permanents | leaves | world KB | path moves | clone ms | replay ms | rollout ms | clone ÷ rollout | replay ÷ rollout | root clone ms (once) |"
    );
    console.log(
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    );
    for (const r of rows) {
        console.log(
            `| ${r.engine} | ${r.label.slice(0, 28)} | ${r.permanents ?? "—"} | ${r.leaves} | ${Math.round(r.kb)} | ${r.path} | ${r2(r.cloneMs)} | ${r2(r.replayMs)} | ${r1(r.rolloutMs)} | ${((r.cloneMs / r.rolloutMs) * 100).toFixed(1)}% | ${((r.replayMs / r.rolloutMs) * 100).toFixed(1)}% | ${r2(r.rootCloneMs)} |`
        );
    }
}

function fold(h) {
    const pick = (k) => h.leaves.map((l) => l[k]);
    return {
        label: h.label,
        permanents: h.permanents,
        leaves: h.leaves.length,
        cloneMs: median(pick("cloneMs")),
        replayMs: median(pick("replayMs")),
        rolloutMs: median(pick("rolloutMs")),
        kb: median(pick("bytes")) / 1024,
        path: median(pick("pathLength")),
        rootCloneMs: h.rootCloneMs,
        rootKb: h.rootBytes / 1024,
    };
}

function quality(paths) {
    const flag = (name, fallback) => {
        const i = paths.indexOf(`--${name}`);
        if (i === -1) return fallback;
        const v = paths[i + 1];
        paths.splice(i, 2);
        return v;
    };
    const baseArm = flag("base", "base");
    const control = flag("control", "k0s");
    const jobs = paths.flatMap((f) =>
        readFileSync(f, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
    );
    // A job whose control rolled nothing out had no search (a forced move).
    const searched = jobs.filter((j) => (j.arms[control]?.rollouts ?? 0) > 0);
    const arms = Object.keys(jobs[0].arms);
    const loads = jobs.map((j) => j.load);
    console.log(
        `${jobs.length} jobs, ${searched.length} searched, ${new Set(jobs.map((j) => j.index)).size} entries, load ${Math.min(...loads)}–${Math.max(...loads)}`
    );
    console.log(
        `| arm | green | red | flips / fixes vs ${baseArm} | flips / fixes vs ${control} | iterations, median |`
    );
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const arm of arms) {
        const green = searched.filter((j) => j.arms[arm]?.ok).length;
        const vs = (ref) => {
            let flips = 0;
            let fixes = 0;
            for (const j of searched) {
                if (!j.arms[arm] || !j.arms[ref]) continue;
                if (j.arms[ref].ok && !j.arms[arm].ok) flips++;
                if (!j.arms[ref].ok && j.arms[arm].ok) fixes++;
            }
            return `${flips} / ${fixes}`;
        };
        console.log(
            `| ${arm} | ${green} | ${searched.length - green} | ${vs(baseArm)} | ${vs(control)} | ${median(searched.map((j) => j.arms[arm]?.iterations ?? 0))} |`
        );
    }
    const red = searched.filter((j) => arms.some((a) => !j.arms[a]?.ok));
    console.log(`\nred somewhere (${red.length}):`);
    for (const j of red) {
        console.log(
            `- ${j.index} seed ${j.seed}: ${arms.map((a) => `${a}=${j.arms[a]?.ok ? "g" : "R"}`).join(" ")} — ${j.label.slice(0, 90)}`
        );
    }
}

if (command === "throughput") throughput(files[0]);
else if (command === "handoff") handoff(files[0], files[1]);
else if (command === "quality") quality(files);
else {
    console.error("usage: summarize-leaf.mjs throughput|handoff|quality …");
    process.exit(2);
}
