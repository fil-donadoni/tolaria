// Census of every closure on a hand-written card definition, by property key,
// with each card's state in the compiled pool.
//
//   bun docs/research/scripts/capability-derivation/closure-census.mjs /tmp/closures-by-card.json
import { getAllRawCards } from "../../../../convex/cards/catalogue";
import { readFileSync, writeFileSync } from "node:fs";
const pool = JSON.parse(
    readFileSync("data/oracle-compiled.json", "utf8")
).cards;
const state = new Map(pool.map((c) => [c.name, c.state]));
const byKey = {};
const cardsByKey = {};
const perCard = {};
let n = 0;
const poolOf = {};
const poolClosure = {};
const seen = new WeakSet();
const walk = (o, key, name) => {
    if (typeof o === "function") {
        byKey[key] = (byKey[key] ?? 0) + 1;
        (cardsByKey[key] ??= new Set()).add(name);
        (perCard[name] ??= []).push(key);
        return;
    }
    if (o === null || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
        for (const v of o) walk(v, key, name);
        return;
    }
    for (const [k, v] of Object.entries(o)) walk(v, k, name);
};
for (const d of getAllRawCards()) {
    n++;
    const s = state.get(d.name) ?? "absent";
    poolOf[s] = (poolOf[s] ?? 0) + 1;
    walk(d, "", d.name);
    if (perCard[d.name]) poolClosure[s] = (poolClosure[s] ?? 0) + 1;
}
console.log({
    handWritten: n,
    withClosure: Object.keys(perCard).length,
    poolOf,
    poolClosure,
});
console.log(
    Object.entries(byKey)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v} (${cardsByKey[k].size} cards)`).join(`
`)
);
writeFileSync(process.argv[2], JSON.stringify(perCard));
