// For every gap attributed to a trigger head, three compiles of a one-line
// synthetic card (the real card's name, type line and Enchant line):
//   repro     - the line alone still fails on its head;
//   headAlone - the head followed by ", draw a card." compiles (the head IS
//               read and the attribution was wrong);
//   bodyOk    - the body compiles behind a stand-in head the grammar reads.
// `bodyOk` is generous: any of a dozen stand-ins may carry the body.
//
//   bun docs/research/scripts/trigger-head-gaps/body-test.mjs /tmp/gaps.json /tmp/body.json
import { compileCard } from "../../../../convex/oracle/compile";
import { readCorpus } from "../../../../scripts/oracle-corpus";
import { readFileSync, writeFileSync } from "node:fs";
const corpus = readCorpus();
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const front = (c) => (c.faces && c.faces[0] ? { ...c, ...c.faces[0] } : c);
const cache = new Map();
const compile = (base, text) => {
    const key = base.name + "|" + base.typeLine + "|" + text;
    if (cache.has(key)) return cache.get(key);
    let out = { state: "unparsed", gaps: [] };
    try {
        out = compileCard({
            oracleId: "sim",
            name: base.name,
            manaCost: base.manaCost ?? "{1}",
            typeLine: base.typeLine,
            power: base.power,
            toughness: base.toughness,
            loyalty: base.loyalty,
            layout: "normal",
            oracleText: text,
        });
    } catch {}
    const r = {
        ok: out.state !== "unparsed",
        head: (out.gaps ?? []).some(
            (g) =>
                g.attribution?.slot === "triggered" &&
                g.attribution.path[0] === "trigger head"
        ),
    };
    cache.set(key, r);
    return r;
};
const out = [];
const standinOk = {};
for (const r of rows) {
    const c = corpus[r.i];
    const f = front(c);
    const name = f.name ?? c.name.split(" // ")[0];
    const base = {
        name,
        manaCost: f.manaCost,
        typeLine: f.typeLine ?? c.typeLine,
        power: f.power,
        toughness: f.toughness,
        loyalty: f.loyalty,
    };
    const enchant = /^Enchant [^\n(]+/m.exec(
        c.oracleText ?? f.oracleText ?? ""
    )?.[0];
    const pre = enchant ? enchant + "\n" : "";
    const isAura = !!enchant,
        isEquip = /Equipment/.test(base.typeLine);
    const STAND = [
        `When ${name} enters`,
        `Whenever ${name} attacks`,
        `Whenever ${name} deals combat damage to a player`,
        "Whenever a creature you control enters",
        "Whenever another creature you control enters",
        "Whenever a creature dies",
        "Whenever a creature you control dies",
        "Whenever you cast a spell",
        "Whenever an opponent casts a spell",
        "At the beginning of your upkeep",
        "At the beginning of each player's upkeep",
        ...(isAura
            ? [
                  "Whenever enchanted creature attacks",
                  "When enchanted creature dies",
                  "Whenever enchanted land becomes tapped",
              ]
            : []),
        ...(isEquip
            ? [
                  "Whenever equipped creature attacks",
                  "Whenever equipped creature dies",
              ]
            : []),
    ];
    r.gaps.forEach((g, gi) => {
        const a = g.a;
        if (!a || a.slot !== "triggered" || a.path[0] !== "trigger head")
            return;
        const real = (t) => t.replaceAll("{self}", name);
        const line = real(g.line),
            span = real(a.span);
        const at = line.indexOf(span);
        const rec = {
            i: r.i,
            gi,
            repro: false,
            headAlone: false,
            bodyOk: false,
            at,
        };
        const base0 = compile(base, pre + line);
        rec.repro = !base0.ok && base0.head;
        rec.lineOkSynthetic = base0.ok;
        if (at >= 0) {
            const prefix = line.slice(0, at),
                body = line.slice(at + span.length);
            rec.headAlone = compile(
                base,
                pre + prefix + span + ", draw a card."
            ).ok;
            for (const s of STAND) {
                if (compile(base, pre + s + body).ok) {
                    rec.bodyOk = true;
                    rec.via = s.replace(name, "<self>");
                    break;
                }
            }
            rec.bodyLen = body.length;
        }
        out.push(rec);
    });
}
writeFileSync(process.argv[3], JSON.stringify(out));
const n = (p) => out.filter(p).length;
console.log({
    lines: out.length,
    spanFound: n((x) => x.at >= 0),
    repro: n((x) => x.repro),
    lineOkSynthetic: n((x) => x.lineOkSynthetic),
    headAlone: n((x) => x.headAlone),
    bodyOk: n((x) => x.bodyOk),
    reproAndBodyOk: n((x) => x.repro && x.bodyOk),
    reproNotHeadAlone: n((x) => x.repro && !x.headAlone),
    reproNotHeadAloneBodyOk: n((x) => x.repro && !x.headAlone && x.bodyOk),
});
