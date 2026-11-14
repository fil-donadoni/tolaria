// Prototype: infer the trigger head of a hand-written `matches` closure by
// running it, and every candidate factory configuration, on synthetic events
// and keeping the candidate that answers identically on all of them.
//
//   bun docs/research/scripts/capability-derivation/head-infer.mjs
import { getAllCards } from "../../../../convex/cards/catalogue";
import { attacksTrigger } from "../../../../convex/cards/abilities/triggers/attacksTrigger";
import { diedTrigger } from "../../../../convex/cards/abilities/triggers/diedTrigger";
import { enteredTrigger } from "../../../../convex/cards/abilities/triggers/enteredTrigger";
const SCOPES = [
    "self",
    "yours",
    "opponents",
    "any",
    "another-yours",
    "any-other",
    "host",
];
const base = { id: "x", oracleText: "x", effects: [] };
const TYPES = [undefined, "Creature", "Land", "Artifact", "Enchantment"];
const cands = [];
for (const scope of SCOPES) {
    cands.push({
        label: `attacks/${scope}`,
        ev: "ATTACKERS_DECLARED",
        m: attacksTrigger({ ...base, scope }).matches,
    });
    cands.push({
        label: `died/${scope}`,
        ev: "CREATURE_DIED",
        m: diedTrigger({ ...base, scope }).matches,
    });
    for (const t of TYPES)
        cands.push({
            label: `entered/${scope}${t ? "/" + t : ""}`,
            ev: "PERMANENT_ENTERED",
            m: enteredTrigger({
                ...base,
                scope,
                ...(t ? { filter: { types: [t] } } : {}),
            }).matches,
        });
}
const self = {
    id: "S",
    controllerId: "A",
    ownerId: "A",
    attachedTo: "H",
    types: ["Creature"],
    subtypes: [],
    counters: {},
    staticAbilities: [],
};
const perms = [
    ["S", "A"],
    ["Y", "A"],
    ["O", "B"],
    ["H", "A"],
    ["H2", "B"],
];
const state = {
    players: [
        { id: "A", battlefield: [], life: 20 },
        { id: "B", battlefield: [], life: 20 },
    ],
    activePlayerId: "A",
};
const events = {
    ATTACKERS_DECLARED: [],
    CREATURE_DIED: [],
    PERMANENT_ENTERED: [],
};
for (const ids of [["S"], ["Y"], ["S", "Y"], ["H"], ["Y", "H"]])
    events.ATTACKERS_DECLARED.push({
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "A",
        attackerIds: ids,
    });
for (const ids of [["O"], ["H2"], ["O", "H2"]])
    events.ATTACKERS_DECLARED.push({
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: "B",
        attackerIds: ids,
    });
for (const [id, c] of perms) {
    events.CREATURE_DIED.push({
        type: "CREATURE_DIED",
        creatureInstanceId: id,
        creatureControllerId: c,
        creatureOwnerId: c,
        creatureTypes: ["Creature"],
        creatureSubtypes: [],
        damagedBySources: [],
        creaturePower: 2,
        creatureToughness: 2,
    });
    for (const t of ["Creature", "Land", "Artifact", "Enchantment"])
        events.PERMANENT_ENTERED.push({
            type: "PERMANENT_ENTERED",
            instanceId: id,
            controllerId: c,
            ownerId: c,
            types: [t],
            subtypes: [],
            colors: [],
            power: 2,
            toughness: 2,
        });
}
const run = (m, e) => {
    try {
        return m(e, self, state) ? "1" : "0";
    } catch {
        return "E";
    }
};
const sig = (m, ev) => events[ev].map((e) => run(m, e)).join("");
const candSig = cands.map((c) => ({ ...c, s: sig(c.m, c.ev) }));
let raw = 0,
    inScope = 0,
    hit = 0;
const miss = [];
const hits = {};
for (const d of getAllCards())
    for (const t of d.triggeredAbilities ?? []) {
        const src = t.matches.toString();
        if (/args\b|descriptor|scope\b/.test(src)) continue;
        raw++;
        const ev = Array.isArray(t.event) ? null : t.event;
        if (!ev || !events[ev]) continue;
        inScope++;
        const s = sig(t.matches, ev);
        const c = candSig.filter((c) => c.ev === ev && c.s === s);
        if (c.length) {
            hit++;
            hits[c[0].label] = (hits[c[0].label] ?? 0) + 1;
        } else miss.push(`${d.name} [${ev}] ${s}`);
    }
console.log({ raw, inScope, hit });
console.log(hits);
console.log(
    miss.slice(0, 25).join(`
`)
);
