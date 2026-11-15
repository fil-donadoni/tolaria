// Every compile gap of every card the Oracle Compiler leaves `unparsed`,
// with its attribution (slot, path, span). Input of `body-test.mjs` and
// `families.py`.
//
//   bun docs/research/scripts/trigger-head-gaps/dump-gaps.mjs /tmp/gaps.json
import { compileCard } from "../../../../convex/oracle/compile";
import { withMeldPairs } from "../../../../convex/oracle/meldPairs";
import { readCorpus } from "../../../../scripts/oracle-corpus";
import { writeFileSync } from "node:fs";
const corpus = readCorpus();
const toOracle = (c) => ({
    oracleId: c.oracleId,
    name: c.name,
    manaCost: c.manaCost,
    typeLine: c.typeLine,
    oracleText: c.oracleText,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    layout: c.layout,
    ...(c.faces ? { faces: c.faces } : {}),
});
const oracleCards = withMeldPairs(corpus.map(toOracle));
const rows = [];
const states = {};
for (const [i, c] of corpus.entries()) {
    const out = compileCard(oracleCards[i]);
    states[out.state] = (states[out.state] ?? 0) + 1;
    if (out.state !== "unparsed") continue;
    rows.push({
        i,
        name: c.name,
        poolIn: c.poolIn,
        typeLine: c.typeLine,
        gaps: out.gaps.map((g) => ({
            line: g.line,
            fragment: g.fragment,
            reason: g.reason,
            slot: g.slot,
            a: g.attribution
                ? {
                      slot: g.attribution.slot,
                      path: g.attribution.path,
                      span: g.attribution.span,
                  }
                : null,
        })),
    });
}
console.log(states, rows.length);
writeFileSync(process.argv[2], JSON.stringify(rows));
