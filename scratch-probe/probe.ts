import gzip from "node:zlib";
import { readFileSync } from "node:fs";
import { compileCard } from "../convex/oracle/compile";

const rows = JSON.parse(
    gzip.gunzipSync(readFileSync("data/oracle-corpus.json.gz")).toString("utf8")
) as Record<string, unknown>[] | { cards: Record<string, unknown>[] };
const cards = Array.isArray(rows) ? rows : rows.cards;
for (const name of process.argv.slice(2)) {
    const c = cards.find((x) => (x as { name?: string }).name === name);
    if (!c) {
        console.log(name, "NOT FOUND");
        continue;
    }
    const out = compileCard(c as never);
    console.log("===", name, "state=", (out as { state?: string }).state);
    console.log(JSON.stringify(out).slice(0, 1600));
}
