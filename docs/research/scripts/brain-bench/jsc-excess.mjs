// What JavaScriptCore pays MORE for than V8, function by function (issue
// #10123): reads a `profile.mjs` (V8) and a `profile-jsc.mjs` (JSC) output
// over the same positions and iteration count, and ranks the functions whose
// inclusive time grew more than the search as a whole did.
//
//   node docs/research/scripts/brain-bench/jsc-excess.mjs <v8.json> <jsc.json> [--min <share>] [--top N]
//
// Same bundle, same seed, same position: both engines search the SAME tree
// (the rows' `move` must agree, which this checks), so a function's time in
// one engine against the other is a like-for-like reading. Per position:
//
//   share   a function's inclusive time over its engine's `searchWithTrace`
//           inclusive time (V8's profile carries the collector outside every
//           stack; JSC's never shows it, `profile-jsc.mjs`)
//   ratio   the search's JSC wall time over V8's (both under their profiler)
//   excess  JSC share − V8 share: the part of a JSC search this function
//           would give back if JSC ran it no worse, relative to V8, than it
//           runs the search as a whole ((JSC ms − V8 ms × ratio) / JSC ms)
//
// Inclusive shares (`inclusiveAll`), never self: V8 charges an inlined
// built-in (`filter`, `map`, `Set`, spread) to its caller, JSC to a frame of
// its own. Functions above 99% (the search loop and its callers) are skipped.
// `--min` (default 2) drops functions under that V8 inclusive share: a small
// function's ratio is a handful of samples.

import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const at = argv.indexOf(name);
    if (at === -1) return fallback;
    const [, value] = argv.splice(at, 2);
    return Number(value);
};
const min = option("--min", 2);
const top = option("--top", 12);
const [v8File, jscFile] = argv;
if (!v8File || !jscFile) {
    console.error(
        "usage: jsc-excess.mjs <v8.json> <jsc.json> [--min <share>] [--top N]"
    );
    process.exit(2);
}
const v8 = JSON.parse(readFileSync(v8File, "utf8")).results;
const jsc = JSON.parse(readFileSync(jscFile, "utf8")).results;

for (const a of v8) {
    const b = jsc.find((r) => r.label === a.label);
    if (!b) continue;
    if (a.move !== b.move) {
        console.log(
            `\n${a.label}: the engines chose different moves — skipped`
        );
        continue;
    }
    const ratio = b.wallMs / a.wallMs;
    const share = (r, fn) =>
        (100 * (r.inclusiveAll[fn] ?? 0)) / r.inclusiveAll.searchWithTrace;
    const rows = Object.keys(a.inclusiveAll)
        .map((fn) => ({ fn, v8: share(a, fn), jsc: share(b, fn) }))
        .filter((r) => r.fn !== "" && r.v8 >= min && r.v8 < 99)
        .map((r) => ({
            ...r,
            ratio: (r.jsc / r.v8) * ratio,
            excess: r.jsc - r.v8,
        }))
        .filter((r) => r.jsc > 0) // a frame JSC's sampler never shows (`webkit-search-profile.md` § 3)
        .sort((x, y) => y.excess - x.excess)
        .slice(0, top);
    console.log(
        `\n### ${a.label}\n\nJSC / V8 search wall time: ${ratio.toFixed(2)}\n`
    );
    console.log(
        "| function | V8 share % | JSC share % | JSC / V8 time | excess, % of a JSC search |"
    );
    console.log("| --- | --- | --- | --- | --- |");
    for (const r of rows) {
        console.log(
            `| \`${r.fn}\` | ${r.v8.toFixed(1)} | ${r.jsc.toFixed(1)} | ${r.ratio.toFixed(2)} | ${r.excess.toFixed(1)} |`
        );
    }
}
