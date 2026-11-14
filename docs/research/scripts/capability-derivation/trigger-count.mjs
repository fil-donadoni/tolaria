// How many catalogue triggers exist, and how many arrive from the compiler
// with a JSON head (`compiledTriggeredAbilities[].head`) before hydration.
//
//   bun docs/research/scripts/capability-derivation/trigger-count.mjs
import { readFileSync } from "node:fs";
import { getAllCatalogueCards } from "../../../../convex/cards/catalogue";
let total = 0;
let cards = 0;
for (const d of getAllCatalogueCards()) {
    const triggers = d.triggeredAbilities ?? [];
    if (triggers.length > 0) cards++;
    total += triggers.length;
}
let compiled = 0;
const kinds = {};
const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        if (key === "compiledTriggeredAbilities" && Array.isArray(value)) {
            for (const t of value) {
                compiled++;
                const kind = t.head?.kind ?? "?";
                kinds[kind] = (kinds[kind] ?? 0) + 1;
            }
        } else walk(value);
    }
};
walk(JSON.parse(readFileSync("data/oracle-compiled.json", "utf8")));
console.log({
    catalogueTriggers: total,
    cardsWithTriggers: cards,
    compiledDescriptors: compiled,
});
console.log(
    Object.entries(kinds)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
);
