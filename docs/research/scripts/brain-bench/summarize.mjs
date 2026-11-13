// Turn the bench's JSON outputs into the tables the research note quotes
// (issue #9527).
//
//   node docs/research/scripts/brain-bench/summarize.mjs engines <v8.json> [<jsc.json>]
//   node docs/research/scripts/brain-bench/summarize.mjs browsers <browsers.json>
//   node docs/research/scripts/brain-bench/summarize.mjs profile <profile.json>

import { readFileSync } from "node:fs";

const [mode, ...files] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

const sorted = (values) => [...values].sort((a, b) => a - b);
function percentile(values, p) {
    if (values.length === 0) return NaN;
    const s = sorted(values);
    return s[
        Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length))) - 1
    ];
}
const median = (values) => percentile(values, 50);
const fmt = (n, digits = 0) => (Number.isFinite(n) ? n.toFixed(digits) : "–");
const pct = (n) => `${fmt(100 * n, 0)}%`;
const row = (...cells) => `| ${cells.join(" | ")} |`;

function engines() {
    for (const file of files) {
        const data = read(file);
        const searched = data.cost.filter((r) => r.completed);
        const loads = [...data.cost, ...data.curve].map((r) => r.load);
        console.log(`\n### ${data.runtime}`);
        console.log(
            `\n${data.cpu}, ${data.cores} cores; load average during the run ${fmt(Math.min(...loads), 0)}–${fmt(Math.max(...loads), 0)}; ${data.cost.length - searched.length} of ${data.cost.length} positions have a single forced move and no search.`
        );

        // What one full-budget decision costs on this core.
        const cpu = searched.map((r) => r.cpuMs);
        const perIteration = searched.map((r) => r.cpuMs / r.completed);
        const settled = searched.filter((r) => r.stoppedBy === "settled");
        console.log(
            `\nCost of a decision at ${data.budgets.expert.iterations} iterations, no time cap (CPU time):\n`
        );
        console.log(row("", "p10", "median", "p90", "max"));
        console.log(row("---", "---", "---", "---", "---"));
        console.log(
            row(
                "search, ms",
                fmt(percentile(cpu, 10)),
                fmt(median(cpu)),
                fmt(percentile(cpu, 90)),
                fmt(Math.max(...cpu))
            )
        );
        console.log(
            row(
                "per iteration, ms",
                fmt(percentile(perIteration, 10), 2),
                fmt(median(perIteration), 2),
                fmt(percentile(perIteration, 90), 2),
                fmt(Math.max(...perIteration), 2)
            )
        );
        console.log(
            `\n${settled.length} of ${searched.length} searches stopped early as \`settled\`; ${searched.filter((r) => r.cpuMs > data.budgets.expert.timeMs).length} would not finish inside the ${data.budgets.expert.timeMs} ms cap on this core, ${searched.filter((r) => r.cpuMs > 5000).length} take longer than the 5,000 ms consult timeout.`
        );

        // What a device K times slower completes.
        for (const preset of Object.keys(data.budgets)) {
            const rows = data.curve.filter((r) => r.preset === preset);
            if (rows.length === 0) continue;
            const budget = data.budgets[preset];
            console.log(
                `\n\`${preset}\` (${budget.iterations} iterations, ${budget.timeMs} ms) on a device K times slower than this core:\n`
            );
            console.log(
                row(
                    "K",
                    "stopped by time",
                    "iterations completed (all searches)",
                    "median search completes",
                    "worst search completes",
                    "past the consult timeout"
                )
            );
            console.log(row("---", "---", "---", "---", "---", "---"));
            for (const scale of data.scales) {
                const at = rows.filter(
                    (r) => r.scale === scale && r.completed !== null
                );
                // What the search WOULD have run uncapped: its `cost` row.
                const full = new Map(
                    data.cost.map((r) => [r.index, r.completed])
                );
                const ratios = at.map((r) =>
                    Math.min(1, r.completed / full.get(r.index))
                );
                const completed = at.reduce((s, r) => s + r.completed, 0);
                const wanted = at.reduce((s, r) => s + full.get(r.index), 0);
                console.log(
                    row(
                        `${scale}x`,
                        `${at.filter((r) => r.stoppedBy === "time").length} / ${at.length}`,
                        pct(completed / wanted),
                        pct(median(ratios)),
                        pct(Math.min(...ratios)),
                        `${at.filter((r) => r.deviceMs > 5000).length} / ${at.length}`
                    )
                );
            }
        }
    }

    if (files.length === 2) {
        const [a, b] = files.map(read);
        const byIndex = new Map(a.cost.map((r) => [r.index, r]));
        const cpuRatios = [];
        const wallRatios = [];
        for (const r of b.cost) {
            const other = byIndex.get(r.index);
            if (!r.completed || !other?.completed) continue;
            // Per iteration, so a search one runtime settled earlier still compares.
            cpuRatios.push(
                r.cpuMs / r.completed / (other.cpuMs / other.completed)
            );
            wallRatios.push(
                r.wallMs / r.completed / (other.wallMs / other.completed)
            );
        }
        console.log(`\n### ${b.runtime} against ${a.runtime}\n`);
        console.log(row("time per iteration, ratio", "p10", "median", "p90"));
        console.log(row("---", "---", "---", "---"));
        console.log(
            row(
                "CPU time (all threads)",
                fmt(percentile(cpuRatios, 10), 2),
                fmt(median(cpuRatios), 2),
                fmt(percentile(cpuRatios, 90), 2)
            )
        );
        console.log(
            row(
                "wall time",
                fmt(percentile(wallRatios, 10), 2),
                fmt(median(wallRatios), 2),
                fmt(percentile(wallRatios, 90), 2)
            )
        );
    }
}

function browsers() {
    const data = read(files[0]);
    console.log(
        `\n${data.cpu}, ${data.cores} cores${data.backgroundQos ? ", browsers under background QoS (efficiency cores only)" : ""}; ${data.positions.length} positions, ${data.iterations} iterations, ${data.rounds - 1} measured rounds.\n`
    );
    for (const e of data.engines) {
        console.log(
            `- ${e.name}: ${e.failed ? `NOT MEASURED — ${e.failed}` : e.version}`
        );
    }
    const measured = data.engineRows.filter((r) => r.round > 0 && r.completed);
    const loads = measured.map((r) => r.load);
    console.log(
        `\nLoad average during the engine rounds: ${fmt(Math.min(...loads), 0)}–${fmt(Math.max(...loads), 0)}.\n`
    );
    const key = (r) => `${r.round}:${r.index}`;
    const base = new Map(
        measured
            .filter((r) => r.engine === "chromium")
            .map((r) => [key(r), r.wallMs / r.completed])
    );
    console.log(
        row(
            "engine",
            "ms per iteration, median",
            "ratio to Chromium, p10",
            "median",
            "p90"
        )
    );
    console.log(row("---", "---", "---", "---", "---"));
    for (const e of data.engines.filter((e) => !e.failed)) {
        const rows = measured.filter((r) => r.engine === e.name);
        const ratios = rows
            .filter((r) => base.has(key(r)))
            .map((r) => r.wallMs / r.completed / base.get(key(r)));
        console.log(
            row(
                e.name,
                fmt(median(rows.map((r) => r.wallMs / r.completed)), 2),
                fmt(percentile(ratios, 10), 2),
                fmt(median(ratios), 2),
                fmt(percentile(ratios, 90), 2)
            )
        );
    }

    console.log(`\nA second Brain Worker searching beside the Bot's:\n`);
    console.log(
        row("engine", "pairs", "slowdown, p10", "median", "p90", "load")
    );
    console.log(row("---", "---", "---", "---", "---", "---"));
    for (const e of data.engines.filter((e) => !e.failed)) {
        const rows = data.contentionRows.filter(
            (r) => r.engine === e.name && r.completed
        );
        const alone = new Map(
            rows
                .filter((r) => !r.contended)
                .map((r) => [`${r.pair}:${r.index}`, r.wallMs / r.completed])
        );
        const ratios = rows
            .filter((r) => r.contended && alone.has(`${r.pair}:${r.index}`))
            .map(
                (r) =>
                    r.wallMs / r.completed / alone.get(`${r.pair}:${r.index}`)
            );
        const l = rows.map((r) => r.load);
        console.log(
            row(
                e.name,
                String(ratios.length),
                fmt(percentile(ratios, 10), 2),
                fmt(median(ratios), 2),
                fmt(percentile(ratios, 90), 2),
                rows.length
                    ? `${fmt(Math.min(...l), 0)}–${fmt(Math.max(...l), 0)}`
                    : "–"
            )
        );
    }
}

function profile() {
    const data = read(files[0]);
    const names = Object.keys(data.results[0].shares);
    console.log(row("position", "iterations", "search ms", ...names));
    console.log(row("---", "---", "---", ...names.map(() => "---")));
    for (const r of data.results) {
        console.log(
            row(
                r.label,
                String(r.completed),
                String(r.searchMs),
                ...names.map((n) => `${r.shares[n]}%`)
            )
        );
    }
    const inclusive = Object.keys(data.results[0].inclusive);
    console.log(`\nInclusive shares (they overlap):\n`);
    console.log(row("function", ...data.results.map((r) => `#${r.index}`)));
    console.log(row("---", ...data.results.map(() => "---")));
    for (const fn of inclusive) {
        console.log(
            row(`\`${fn}\``, ...data.results.map((r) => `${r.inclusive[fn]}%`))
        );
    }
    console.log(`\nTop self time:\n`);
    for (const r of data.results) {
        console.log(
            `- #${r.index}: ${r.topSelf
                .slice(0, 10)
                .map((f) => `\`${f.name}\` ${f.share}%`)
                .join(", ")}`
        );
    }
}

const modes = { engines, browsers, profile };
if (!modes[mode] || files.length === 0) {
    console.error("usage: summarize.mjs engines|browsers|profile <files…>");
    process.exit(2);
}
modes[mode]();
