// SPIKE (PRD issue #3602 feasibility): a structural Capability derivator
// compared with the Card Capabilities layer. Throwaway. Reads only structured
// definition fields; a card's name is used for reporting, never for a decision.
//
//   bun docs/research/scripts/capability-derivation/derive-spike.mjs /tmp/spike.txt
import { readFileSync, writeFileSync } from "node:fs";
import { getAllCatalogueCards } from "../../../../convex/cards";
import { childOpArrays } from "../../../../convex/gre/ai/effectOpChildren";
const PERMANENT = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Planeswalker",
    "Battle",
];
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const has = (d, t) => arr(d.types).includes(t);
const isPermanentCard = (d) => PERMANENT.some((t) => has(d, t));
const mv = (d) =>
    Object.values(d.manaCost ?? {}).reduce(
        (a, v) => a + (typeof v === "number" ? v : 0),
        0
    );
const kws = (d) =>
    arr(d.staticAbilities)
        .filter((s) => typeof s === "string")
        .map((s) => s.toLowerCase());
const filterTypes = (f) => [...arr(f?.type), ...arr(f?.types)];
function flatten(ops) {
    const out = [];
    const walk = (list) => {
        for (const op of list ?? []) {
            if (!op || typeof op !== "object") continue;
            out.push(op);
            try {
                for (const child of childOpArrays(op)) walk(child);
            } catch {}
        }
    };
    walk(ops ?? []);
    return out;
}
function scripts(d) {
    const s = [];
    const tr = (x) =>
        [x?.targetRequirement, ...arr(x?.additionalTargetRequirements)].filter(
            Boolean
        );
    s.push({
        host: "spell",
        ops: flatten([...arr(d.effects), ...arr(d.aiEffects)]),
        tr: tr(d),
    });
    for (const m of arr(d.modes))
        s.push({
            host: "spell",
            ops: flatten(m.effects),
            tr: [...tr(d), ...tr(m)],
        });
    for (const a of arr(d.activatedAbilities))
        s.push({
            host: "activated",
            ops: flatten([...arr(a.effects), ...arr(a.aiEffects)]),
            tr: tr(a),
            ability: a,
        });
    for (const t of arr(d.triggeredAbilities))
        s.push({
            host: "trigger",
            ops: flatten([...arr(t.effects), ...arr(t.aiEffects)]),
            tr: tr(t),
            ability: t,
        });
    return s;
}
const allOps = (d) => scripts(d).flatMap((s) => s.ops);
const graveyardTargetTr = (sc) => sc.tr.find((r) => r?.zone === "graveyard");
function derive(d) {
    const o = {
        provides: new Set(),
        requires: new Set(),
        fired: new Map(),
    };
    const add = (side, cap, rule) => {
        o[side].add(cap);
        const k = `${side}:${cap}:${rule}`;
        o.fired.set(k, [...(o.fired.get(k) ?? []), d.name]);
    };
    const sc = scripts(d);
    const ops = allOps(d);
    const k = kws(d);
    const trig = arr(d.triggeredAbilities);
    const json = JSON.stringify(d, (_k, v) =>
        typeof v === "function" ? undefined : v
    );
    if ((has(d, "Instant") || has(d, "Sorcery")) && mv(d) <= 2)
        add("provides", "cheap-spell", "instant/sorcery mv<=2");
    if (has(d, "Artifact") && !has(d, "Land") && mv(d) <= 2)
        add("provides", "cheap-artifact", "artifact mv<=2");
    if (has(d, "Artifact") && mv(d) >= 6)
        add("provides", "big-artifact", "artifact mv>=6");
    const selfShuffles = trig.some(
        (t) =>
            t.zone === "graveyard" &&
            flatten(t.effects).some(
                (op) =>
                    op.op === "moveZone" &&
                    op.target?.ref === "$source" &&
                    op.to === "library"
            )
    );
    if (isPermanentCard(d) && mv(d) >= 7)
        add("provides", "cheat-target", "permanent mv>=7");
    if (
        has(d, "Creature") &&
        !selfShuffles &&
        (mv(d) >= 6 || (d.power ?? 0) >= 6)
    )
        add(
            "provides",
            "reanimatable",
            "creature mv>=6|power>=6, stays in gy [PROXY]"
        );
    if (ops.some((op) => op.op === "mill"))
        add("provides", "self-mills", "op mill");
    if (
        ops.some(
            (op) =>
                op.op === "revealUntilMatch" &&
                /graveyard/.test(JSON.stringify(op.rest ?? op.restTo ?? ""))
        )
    )
        add("provides", "self-mills", "revealUntil rest->gy");
    for (const s of sc) {
        const searchBind = s.ops.find(
            (op) => op.op === "choice" && op.kind === "search-library"
        )?.bind;
        if (
            searchBind &&
            s.ops.some(
                (op) =>
                    op.op === "moveZone" &&
                    op.cards?.ref === searchBind &&
                    op.to === "graveyard"
            )
        )
            add("provides", "discard-outlet", "search-library -> graveyard");
    }
    if (
        ops.some(
            (op) =>
                op.op === "discard" &&
                (op.player === "controller" || op.player === undefined)
        )
    )
        add("provides", "discard-outlet", "op discard (controller)");
    if (
        arr(d.activatedAbilities).some(
            (a) =>
                a.cost?.discard || a.cost?.discardFilter || a.cost?.discardCount
        )
    )
        add("provides", "discard-outlet", "cost discard");
    if (arr(d.activatedAbilities).some((a) => a.cost?.cyclingCost))
        add("provides", "discard-outlet", "cycling");
    if (isPermanentCard(d) && trig.some((t) => t.etbAbility === true))
        add("provides", "value-on-etb", "etbAbility trigger");
    if (
        has(d, "Creature") &&
        trig.some((t) => arr(t.event).includes("CREATURE_DIED"))
    )
        add(
            "provides",
            "value-on-death",
            "CREATURE_DIED trigger [matches opaque]"
        );
    if (k.some((x) => x === "persist" || x === "undying"))
        add("provides", "value-on-death", "persist/undying");
    if (
        has(d, "Creature") &&
        trig.some((t) => arr(t.event).includes("ATTACKERS_DECLARED"))
    )
        add(
            "provides",
            "value-on-attack",
            "ATTACKERS_DECLARED trigger [matches opaque]"
        );
    if (k.some((x) => x.startsWith("annihilator") || x.startsWith("myriad")))
        add("provides", "value-on-attack", "annihilator/myriad");
    if (k.some((x) => x === "cascade" || x === "storm"))
        add("provides", "value-on-cast", "cascade/storm");
    if (
        (has(d, "Instant") || has(d, "Sorcery")) &&
        sc[0].ops.some(
            (op) =>
                op.op === "draw" &&
                (op.player === "controller" || op.player === undefined)
        )
    )
        add("provides", "value-on-cast", "instant/sorcery draws (cantrip)");
    const creatureTokens = (op) =>
        op.op === "createToken" && filterTypes(op.token).includes("Creature");
    const tokenCount = (op) =>
        typeof op.count === "number" ? op.count : op.count == null ? 1 : 2;
    if (ops.some((op) => creatureTokens(op) && tokenCount(op) >= 2))
        add("provides", "go-wide", "createToken creature x>=2");
    else if (
        sc.some(
            (s) =>
                (s.host === "activated" ||
                    (s.host === "trigger" && !s.ability?.etbAbility)) &&
                s.ops.some(creatureTokens)
        )
    )
        add("provides", "go-wide", "repeatable creature token");
    if (
        ops.some(
            (op) =>
                op.op === "createToken" &&
                (filterTypes(op.token).includes("Creature") ||
                    filterTypes(op.token).includes("Artifact"))
        )
    )
        add("provides", "sacrifice-fodder", "createToken creature/artifact");
    for (const a of arr(d.activatedAbilities)) {
        const o2 = flatten(a.effects);
        const bind = o2.find(
            (op) => op.op === "choice" && op.kind === "search-library"
        )?.bind;
        if (
            a.cost?.sacrifice &&
            has(d, "Land") &&
            bind &&
            o2.some(
                (op) =>
                    op.op === "moveZone" &&
                    op.cards?.ref === bind &&
                    op.to === "battlefield"
            )
        )
            add("provides", "land-enters", "fetch land");
    }
    if (d.extraLandDrops) add("provides", "land-enters", "extraLandDrops");
    for (const s of sc) {
        const choice = s.ops.find(
            (op) =>
                op.op === "choice" &&
                op.kind === "search-library" &&
                (filterTypes(op.filter).includes("Land") || op.filter?.subtype)
        );
        if (
            choice &&
            !has(d, "Land") &&
            s.ops.some(
                (op) =>
                    op.op === "moveZone" &&
                    op.cards?.ref === choice.bind &&
                    op.to === "battlefield"
            )
        )
            add("provides", "land-enters", "search land -> battlefield");
    }
    for (const s of sc) {
        const gyTr = graveyardTargetTr(s);
        for (const op of s.ops) {
            if (op.op !== "moveZone" || op.to !== "battlefield") continue;
            const isSelf =
                op.target?.ref === "$source" || op.target?.ref === "$self";
            if (isSelf) continue;
            const fromGy =
                op.from === "graveyard" ||
                arr(op.fromZones).includes("graveyard") ||
                (op.target?.target !== undefined && gyTr);
            const scriptExiles = s.ops.some((x) => x.op === "exile");
            const refFromGy = op.target?.ref && !op.from && !scriptExiles;
            if (fromGy || refFromGy) {
                const max = gyTr?.mvFilter?.max;
                const types = gyTr ? [gyTr.type, ...arr(gyTr.types)] : [];
                if (types.includes("Artifact"))
                    add(
                        "requires",
                        max != null && max <= 1
                            ? "cheap-artifact-mv-1"
                            : "big-artifact",
                        "gy->bf artifact"
                    );
                else if (max === 2)
                    add("requires", "reanimatable-mv-2", "gy->bf mv<=2");
                else if (max === 3)
                    add("requires", "reanimatable-mv-3", "gy->bf mv<=3");
                else add("requires", "reanimatable", "gy->bf");
            }
            const fromHandOrLib = op.from === "hand" || op.from === "library";
            if (fromHandOrLib && op.cards?.ref) {
                const ch = s.ops.find(
                    (x) => x.op === "choice" && x.bind === op.cards.ref
                );
                const ft = filterTypes(ch?.filter);
                if (ft.length && ft.every((t) => t === "Land")) continue;
                if (ft.length === 1 && ft[0] === "Artifact")
                    add("requires", "big-artifact", "hand/lib->bf artifact");
                else if (ch?.filter?.subtype) continue;
                else add("requires", "cheat-target", "hand/lib->bf permanent");
                if (s.ops.some((x) => x.op === "delayedTrigger"))
                    add("requires", "value-on-etb", "temporary cheat");
            }
        }
        if (
            s.ops.some((x) => x.op === "exile") &&
            s.ops.some(
                (x) =>
                    x.op === "moveZone" &&
                    x.from === "exile" &&
                    x.to === "battlefield"
            )
        )
            add("requires", "value-on-etb", "flicker (exile + return)");
        if (s.ops.some((x) => x.op === "sacrificeAndReturn"))
            add("requires", "big-artifact", "sacrificeAndReturn (swap)");
    }
    if (o.requires.has("reanimatable")) {
        add("requires", "discard-outlet", "reanimator wants enabler");
        add("requires", "self-mills", "reanimator wants enabler");
    }
    if (
        k.includes("delve") ||
        /"zone":"graveyard"[^{}]*"count"|"count":\{[^{}]*"zone":"graveyard"/.test(
            json
        )
    ) {
        add("requires", "self-mills", "graveyard-scaling (delve / gy count)");
        add(
            "requires",
            "discard-outlet",
            "graveyard-scaling (delve / gy count)"
        );
    }
    if (k.includes("prowess")) add("requires", "cheap-spell", "prowess");
    if (
        isPermanentCard(d) &&
        trig.some((t) => arr(t.event).includes("SPELL_CAST"))
    ) {
        add("requires", "cheap-spell", "SPELL_CAST trigger [matches opaque]");
        add("requires", "value-on-cast", "SPELL_CAST trigger [matches opaque]");
    }
    if (k.includes("storm")) add("requires", "value-on-cast", "storm");
    if (
        k.some(
            (x) => x.startsWith("affinity for artifacts") || x === "improvise"
        ) ||
        /"countFilter":\{[^{}]*"Artifact"/.test(json)
    )
        add(
            "requires",
            "cheap-artifact",
            "artifact count / affinity / improvise"
        );
    const sacCosts = [
        ...arr(d.activatedAbilities).map((a) => a.cost),
        d.additionalCosts,
    ].filter(Boolean);
    for (const c of sacCosts) {
        if (!c?.sacrificeFilter) continue;
        const t = filterTypes(c.sacrificeFilter);
        add("requires", "sacrifice-fodder", "sacrifice cost (filter)");
        if (t.includes("Creature"))
            add("requires", "value-on-death", "sacrifice-a-creature cost");
    }
    if (k.includes("convoke") || /"countFilter":\{[^{}]*"Creature"/.test(json))
        add("requires", "go-wide", "creature count / convoke");
    if (trig.some((t) => t.keyword === "landfall"))
        add("requires", "land-enters", "landfall keyword");
    return o;
}
const layer = JSON.parse(
    readFileSync("data/card-profiles/capabilities.json", "utf8")
).capabilities;
const cards = getAllCatalogueCards();
const byId = new Map(cards.map((c) => [c.id, c]));
const opaque = (d) =>
    typeof d.resolve === "function" || !!d.resolveSteps || !!d.effect;
const ruleFires = new Map();
const derivedAll = new Map();
let opaqueCount = 0;
for (const d of cards) {
    const o = derive(d);
    derivedAll.set(d.id, o);
    if (opaque(d)) opaqueCount++;
    for (const [k, v] of o.fired)
        ruleFires.set(k, (ruleFires.get(k) ?? 0) + v.length);
}
const stats = new Map();
const cell = (k) =>
    stats.get(k) ??
    (stats.set(k, { tp: 0, fp: 0, fn: 0, fpCards: [], fnCards: [] }),
    stats.get(k));
let missing = 0;
const caps = new Set();
for (const [id, row] of Object.entries(layer)) {
    const d = byId.get(id);
    if (!d) {
        missing++;
        continue;
    }
    const o = derivedAll.get(id);
    for (const side of ["provides", "requires"]) {
        const L = new Set(row[side]);
        const D = o[side];
        for (const c of new Set([...L, ...D])) {
            caps.add(c);
            const s = cell(`${side}:${c}`);
            if (L.has(c) && D.has(c)) s.tp++;
            else if (D.has(c)) {
                s.fp++;
                s.fpCards.push(d.name + (opaque(d) ? "*" : ""));
            } else {
                s.fn++;
                s.fnCards.push(d.name + (opaque(d) ? "*" : ""));
            }
        }
    }
}
const pct = (a, b) =>
    b === 0 ? "  —  " : ((100 * a) / b).toFixed(0).padStart(4) + "%";
const lines = [];
lines.push(
    `catalogue=${cards.length} opaque(resolve/effect)=${opaqueCount} layerRows=${Object.keys(layer).length} layerRowsNotInCatalogue=${missing}`
);
lines.push("");
lines.push(
    "side      capability            TP   FP   FN  precision recall | catalogue fires (derived)"
);
const catFires = (side, cap) =>
    [...derivedAll.values()].filter((o) => o[side].has(cap)).length;
for (const key of [...stats.keys()].sort()) {
    const s = stats.get(key);
    const [side, cap] = key.split(":");
    lines.push(
        `${side.padEnd(9)} ${cap.padEnd(20)} ${String(s.tp).padStart(4)} ${String(s.fp).padStart(4)} ${String(s.fn).padStart(4)}  ${pct(s.tp, s.tp + s.fp)}    ${pct(s.tp, s.tp + s.fn)} | ${catFires(side, cap)}`
    );
}
lines.push(`
RULE FIRING COUNTS (whole catalogue)`);
for (const [k, v] of [...ruleFires].sort())
    lines.push(`  ${String(v).padStart(5)}  ${k}`);
lines.push(`
DISAGREEMENTS (FP = derived only, FN = layer only; * = opaque card)`);
for (const key of [...stats.keys()].sort()) {
    const s = stats.get(key);
    if (s.fp)
        lines.push(
            `${key} FP(${s.fp}): ${s.fpCards.slice(0, 25).join(", ")}${s.fp > 25 ? " …" : ""}`
        );
    if (s.fn)
        lines.push(
            `${key} FN(${s.fn}): ${s.fnCards.slice(0, 25).join(", ")}${s.fn > 25 ? " …" : ""}`
        );
}
writeFileSync(
    process.argv[2] ?? "/dev/stdout",
    lines.join(`
`) +
        `
`
);
