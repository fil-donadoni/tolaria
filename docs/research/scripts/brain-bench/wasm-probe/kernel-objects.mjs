// Arm A of the probe kernel (issue #10471): objects, as the engine is written.
//
// The same reduced rules as `kernel-flat.mjs`, on the data model the engine
// uses (`convex/gre/state/declarations.ts`): a `GameState` object holding
// `players[]`, each with `hand` / `library` / `graveyard` / `battlefield`
// arrays of card INSTANCES; an instance is an object with a string id, a
// shared reference to its definition, and its characteristic lists; a
// permanent is found by a linear scan for its id (`convex/gre/lookup.ts`);
// a keyword is a string in `staticAbilities`; a static ability is a
// definition's `applies` predicate. A probe deep-clones the state with the
// engine's own algorithm — `cloneValue` below is `convex/gre/clone.ts`'s, both
// of its per-engine copies and its shared keys — then applies the move,
// settles and evaluates.
//
// Where the engine does a thing in a particular way, this arm does it that
// way: layer 6 is WRITTEN BACK onto the instance as a fresh `staticAbilities`
// array at every settle pass (`syncLayer6`), power and toughness are computed
// ON DEMAND through a per-pass cache (`getEffectivePT` under a
// `Layer7Pass`), and no loop is a `for…of` (issue #10126).

import {
    DEFS,
    KEYWORD_NAMES,
    M_ATTACK,
    M_AURA,
    M_INSTANT,
    M_LAND,
    M_PASS,
    M_PERMANENT,
    SP_BURN,
    SP_PT,
    S_ANTHEM,
    S_AURA,
    S_LORD,
    S_UNTAPPED,
    T_AURA,
    T_CREATURE,
    T_ENCHANTMENT,
    T_INSTANT,
    T_LAND,
} from "./layout.mjs";

// ---------------------------------------------------------------------------
// Definitions: data, with the static's reach as a predicate
// ---------------------------------------------------------------------------

const TYPE_NAME = {
    [T_LAND]: "Land",
    [T_CREATURE]: "Creature",
    [T_AURA]: "Enchantment",
    [T_ENCHANTMENT]: "Enchantment",
    [T_INSTANT]: "Instant",
};
const keywordList = (bits) => KEYWORD_NAMES.filter((_, i) => bits & (1 << i));

const APPLIES = {
    [S_ANTHEM]: (source, target) => source.controllerId === target.controllerId,
    [S_LORD]: (source, target) =>
        source.controllerId === target.controllerId &&
        source.id !== target.id &&
        source.subtypes[0] === target.subtypes[0],
    [S_UNTAPPED]: (source, target) =>
        source.controllerId === target.controllerId && !target.isTapped,
    [S_AURA]: (source, target) => source.attachedTo === target.id,
};

/** The registry: a definition by its id, as `getDefinition` hands one out. */
const DEFINITIONS = new Map(
    DEFS.map((d) => [
        d.name,
        {
            id: d.name,
            name: d.name,
            types: [TYPE_NAME[d.type]],
            subtypes: [d.type === T_AURA ? "Aura" : d.subtype ? "Elf" : "None"],
            supertypes: d.legendary ? ["Legendary"] : [],
            manaCost: { generic: d.cost },
            power: d.power,
            toughness: d.toughness,
            staticAbilities: keywordList(d.keywords),
            ...(d.static
                ? {
                      staticEffects: [
                          {
                              layer: 7,
                              power: d.sp,
                              toughness: d.st,
                              grantedAbilities: keywordList(d.skw),
                              applies: APPLIES[d.static],
                          },
                      ],
                  }
                : {}),
            ...(d.spell === SP_BURN ? { damage: d.sp } : {}),
            ...(d.spell === SP_PT
                ? { pump: { power: d.sp, toughness: d.st } }
                : {}),
        },
    ])
);
const definitionOf = (card) => DEFINITIONS.get(card.card.id);

// ---------------------------------------------------------------------------
// The engine's clone (`convex/gre/clone.ts`), verbatim in its two copies
// ---------------------------------------------------------------------------

function isShared(key, value) {
    switch (key) {
        case "card":
            return !("card" in value);
        case "types":
        case "subtypes":
        case "staticAbilities":
        case "baseTypes":
        case "baseSubtypes":
        case "baseStaticAbilities":
            return Array.isArray(value);
        default:
            return false;
    }
}

const COPY_BY_SPREAD = typeof new Error().line === "number";

function cloneValue(value) {
    if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) {
            const v = value[i];
            out[i] = v === null || typeof v !== "object" ? v : cloneValue(v);
        }
        return out;
    }
    if (COPY_BY_SPREAD) {
        const out = { ...value };
        for (const key in out) {
            const v = out[key];
            if (v !== null && typeof v === "object" && !isShared(key, v)) {
                out[key] = cloneValue(v);
            }
        }
        return out;
    }
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const v = value[key];
        out[key] =
            v === null || typeof v !== "object" || isShared(key, v)
                ? v
                : cloneValue(v);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Building a state from a board description
// ---------------------------------------------------------------------------

const PLAYER_IDS = ["p1", "p2"];

function buildState(board) {
    let nextInstanceId = 1;
    const instance = (def, pl, zone) => {
        const definition = DEFINITIONS.get(DEFS[def].name);
        return {
            id: String(nextInstanceId++),
            card: { id: definition.id },
            controllerId: PLAYER_IDS[pl],
            ownerId: PLAYER_IDS[pl],
            zone,
            types: definition.types,
            subtypes: definition.subtypes,
            staticAbilities: definition.staticAbilities,
            isTapped: false,
        };
    };
    const players = board.players.map((p, pl) => ({
        id: PLAYER_IDS[pl],
        name: `Player ${pl + 1}`,
        life: p.life,
        hand: p.hand.map((def) => instance(def, pl, "hand")),
        library: p.library.map((def) => instance(def, pl, "library")),
        graveyard: p.graveyard.map((def) => instance(def, pl, "graveyard")),
        battlefield: [],
        exile: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        landsPlayedThisTurn: 0,
    }));
    const placed = board.permanents.map((p, i) => {
        const card = instance(p.def, p.controller, "battlefield");
        card.isTapped = p.tapped !== 0;
        card.timestamp = i + 1;
        if (p.damage) card.damageMarked = p.damage;
        if (p.plus || p.minus) {
            card.counters = {};
            if (p.plus) card.counters["+1/+1"] = p.plus;
            if (p.minus) card.counters["-1/-1"] = p.minus;
        }
        players[p.controller].battlefield.push(card);
        return card;
    });
    board.permanents.forEach((p, i) => {
        if (p.attachedTo >= 0) placed[i].attachedTo = placed[p.attachedTo].id;
    });
    const state = {
        players,
        stack: [],
        turn: 15,
        activePlayerId: PLAYER_IDS[board.active],
        priorityPlayerId: PLAYER_IDS[board.active],
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: board.seed,
        rngCounter: 0,
        nextInstanceId,
        timestampCounter: board.permanents.length,
        continuousEffects: board.effects.map((e, i) => ({
            id: `ce${i}`,
            targetId: placed[e.target].id,
            layer: 7,
            power: e.p,
            toughness: e.t,
            duration: "endOfTurn",
        })),
    };
    const moves = board.moves.map((m) => {
        const active = players[board.active];
        if (m.kind === M_PASS) return { kind: M_PASS };
        if (m.kind === M_ATTACK) {
            return { kind: M_ATTACK, attackerId: placed[m.a].id };
        }
        const move = { kind: m.kind, cardId: active.hand[m.a].id };
        if (m.kind === M_AURA || m.kind === M_INSTANT) {
            if (m.b >= 0) move.targetId = placed[m.b].id;
            else move.targetPlayerId = PLAYER_IDS[-1 - m.b];
        }
        return move;
    });
    return { state, moves };
}

// ---------------------------------------------------------------------------
// Lookup (`convex/gre/lookup.ts`): linear, by string id
// ---------------------------------------------------------------------------

function getPlayer(state, playerId) {
    return state.players.find((p) => p.id === playerId);
}

function findPermanent(state, id) {
    for (let i = 0; i < state.players.length; i++) {
        const found = state.players[i].battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

const isType = (card, type) => card.types.includes(type);
const isAura = (card) => card.subtypes.includes("Aura");
const hasKeyword = (card, keyword) => card.staticAbilities.includes(keyword);

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function takeFromHand(player, cardId) {
    const index = player.hand.findIndex((c) => c.id === cardId);
    return player.hand.splice(index, 1)[0];
}

function payCost(player, cost) {
    for (let i = 0; i < player.battlefield.length && cost > 0; i++) {
        const card = player.battlefield[i];
        if (card.isTapped || !isType(card, "Land")) continue;
        card.isTapped = true;
        cost--;
    }
}

function enter(state, player, card, attachedTo) {
    card.zone = "battlefield";
    card.isTapped = false;
    card.summoningSick = true;
    card.timestamp = ++state.timestampCounter;
    if (attachedTo !== undefined) card.attachedTo = attachedTo;
    player.battlefield.push(card);
}

function bury(state, card) {
    card.zone = "graveyard";
    card.isTapped = false;
    delete card.summoningSick;
    delete card.damageMarked;
    delete card.counters;
    delete card.attachedTo;
    delete card.attacking;
    card.staticAbilities = definitionOf(card).staticAbilities;
    getPlayer(state, card.ownerId).graveyard.push(card);
}

function applyMove(state, move) {
    const player = getPlayer(state, state.activePlayerId);
    switch (move.kind) {
        case M_LAND: {
            enter(state, player, takeFromHand(player, move.cardId));
            player.landsPlayedThisTurn += 1;
            break;
        }
        case M_PERMANENT: {
            const card = takeFromHand(player, move.cardId);
            payCost(player, definitionOf(card).manaCost.generic);
            enter(state, player, card);
            break;
        }
        case M_AURA: {
            const card = takeFromHand(player, move.cardId);
            payCost(player, definitionOf(card).manaCost.generic);
            enter(state, player, card, move.targetId);
            break;
        }
        case M_INSTANT: {
            const card = takeFromHand(player, move.cardId);
            const definition = definitionOf(card);
            payCost(player, definition.manaCost.generic);
            if (definition.damage !== undefined) {
                if (move.targetId !== undefined) {
                    const target = findPermanent(state, move.targetId);
                    target.damageMarked =
                        (target.damageMarked ?? 0) + definition.damage;
                } else {
                    getPlayer(state, move.targetPlayerId).life -=
                        definition.damage;
                }
            } else if (definition.pump) {
                state.continuousEffects.push({
                    id: `ce${state.continuousEffects.length}`,
                    targetId: move.targetId,
                    layer: 7,
                    power: definition.pump.power,
                    toughness: definition.pump.toughness,
                    duration: "endOfTurn",
                });
            }
            bury(state, card);
            break;
        }
        case M_ATTACK: {
            const attacker = findPermanent(state, move.attackerId);
            attacker.attacking = true;
            // The printed keywords, as arms B and C read them: the move is
            // applied before the board settles.
            if (!definitionOf(attacker).staticAbilities.includes("vigilance")) {
                attacker.isTapped = true;
            }
            break;
        }
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// Continuous effects
// ---------------------------------------------------------------------------

/** The static abilities on the battlefield, as rows: the source and its
 *  effect. Rebuilt per pass, like the engine's registry read. */
function staticRows(state) {
    const rows = [];
    for (let i = 0; i < state.players.length; i++) {
        const battlefield = state.players[i].battlefield;
        for (let j = 0; j < battlefield.length; j++) {
            const source = battlefield[j];
            const effects = definitionOf(source).staticEffects;
            if (!effects) continue;
            for (let k = 0; k < effects.length; k++) {
                rows.push({ source, effect: effects[k] });
            }
        }
    }
    return rows;
}

/** Layer 6, written back: every creature's `staticAbilities` becomes a FRESH
 *  array — its printed keywords and the ones the statics grant it. */
function syncLayer6(state, rows) {
    for (let i = 0; i < state.players.length; i++) {
        const battlefield = state.players[i].battlefield;
        for (let j = 0; j < battlefield.length; j++) {
            const card = battlefield[j];
            if (!isType(card, "Creature")) continue;
            let abilities = definitionOf(card).staticAbilities;
            for (let k = 0; k < rows.length; k++) {
                const { source, effect } = rows[k];
                if (effect.grantedAbilities.length === 0) continue;
                if (!effect.applies(source, card)) continue;
                for (let g = 0; g < effect.grantedAbilities.length; g++) {
                    const keyword = effect.grantedAbilities[g];
                    if (!abilities.includes(keyword)) {
                        abilities = abilities.concat([keyword]);
                    }
                }
            }
            card.staticAbilities = abilities;
        }
    }
}

/** A layer-7 pass: the static rows read once, and each creature's power and
 *  toughness kept for the pass after its first read. */
function beginLayer7Pass(state) {
    return { rows: staticRows(state), cache: new Map() };
}

function getEffectivePT(state, card, pass) {
    const cached = pass.cache.get(card.id);
    if (cached) return cached;
    const definition = definitionOf(card);
    let power = definition.power;
    let toughness = definition.toughness;
    for (let k = 0; k < pass.rows.length; k++) {
        const { source, effect } = pass.rows[k];
        if (!effect.applies(source, card)) continue;
        power += effect.power;
        toughness += effect.toughness;
    }
    for (let e = 0; e < state.continuousEffects.length; e++) {
        const effect = state.continuousEffects[e];
        if (effect.targetId !== card.id) continue;
        power += effect.power;
        toughness += effect.toughness;
    }
    const counters =
        (card.counters?.["+1/+1"] ?? 0) - (card.counters?.["-1/-1"] ?? 0);
    const pt = { power: power + counters, toughness: toughness + counters };
    pass.cache.set(card.id, pt);
    return pt;
}

// ---------------------------------------------------------------------------
// State-based actions
// ---------------------------------------------------------------------------

function leaveBattlefield(state, card) {
    const player = getPlayer(state, card.controllerId);
    const index = player.battlefield.findIndex((c) => c.id === card.id);
    player.battlefield.splice(index, 1);
    bury(state, card);
}

function checkStateBasedActions(state) {
    for (let guard = 0; guard < 8; guard++) {
        const pass = beginLayer7Pass(state);
        syncLayer6(state, pass.rows);
        const dying = [];
        for (let i = 0; i < state.players.length; i++) {
            const battlefield = state.players[i].battlefield;
            for (let j = 0; j < battlefield.length; j++) {
                const card = battlefield[j];
                const counters = card.counters;
                if (counters) {
                    const plus = counters["+1/+1"] ?? 0;
                    const minus = counters["-1/-1"] ?? 0;
                    if (plus > 0 && minus > 0) {
                        const both = Math.min(plus, minus);
                        counters["+1/+1"] = plus - both;
                        counters["-1/-1"] = minus - both;
                    }
                }
                if (isType(card, "Creature")) {
                    const { toughness } = getEffectivePT(state, card, pass);
                    if (
                        toughness <= 0 ||
                        (card.damageMarked ?? 0) >= toughness
                    ) {
                        dying.push(card);
                    }
                } else if (isAura(card)) {
                    const host =
                        card.attachedTo === undefined
                            ? undefined
                            : findPermanent(state, card.attachedTo);
                    if (!host || !isType(host, "Creature")) dying.push(card);
                }
            }
            // The legend rule: the newest copy stays.
            for (let j = 0; j < battlefield.length; j++) {
                const card = battlefield[j];
                if (!definitionOf(card).supertypes.includes("Legendary")) {
                    continue;
                }
                const newer = battlefield.some(
                    (other) =>
                        other.card.id === card.card.id &&
                        other.timestamp > card.timestamp
                );
                if (newer && !dying.includes(card)) dying.push(card);
            }
        }
        for (let i = 0; i < dying.length; i++) {
            leaveBattlefield(state, dying[i]);
        }
        for (let i = 0; i < state.players.length; i++) {
            const player = state.players[i];
            if (player.life <= 0) player.hasLost = true;
        }
        if (dying.length === 0) return;
    }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const KEYWORD_VALUE = [
    ["flying", 30],
    ["first strike", 15],
    ["vigilance", 10],
    ["deathtouch", 25],
    ["lifelink", 20],
    ["trample", 12],
    ["defender", -20],
    ["reach", 8],
];

function keywordValue(card) {
    let v = 0;
    for (let i = 0; i < KEYWORD_VALUE.length; i++) {
        if (hasKeyword(card, KEYWORD_VALUE[i][0])) v += KEYWORD_VALUE[i][1];
    }
    return v;
}

function evaluate(state, botId) {
    const pass = beginLayer7Pass(state);
    let score = 0;
    for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i];
        const opponent = state.players[1 - i];
        let v = player.life * 40 + player.hand.length * 60;
        if (player.hasLost) v -= 100000;
        let evasive = 0;
        for (let j = 0; j < player.battlefield.length; j++) {
            const card = player.battlefield[j];
            if (isType(card, "Land")) {
                v += card.isTapped ? 30 : 35;
            } else if (isType(card, "Creature")) {
                const { power, toughness } = getEffectivePT(state, card, pass);
                v +=
                    40 +
                    25 * power +
                    15 * toughness -
                    5 * (card.damageMarked ?? 0);
                if (card.isTapped) v -= 5;
                if (card.summoningSick) v -= 3;
                v += keywordValue(card);
                if (
                    !card.isTapped &&
                    !card.summoningSick &&
                    !hasKeyword(card, "defender") &&
                    power > 0
                ) {
                    const flying = hasKeyword(card, "flying");
                    let wall = -1;
                    for (let k = 0; k < opponent.battlefield.length; k++) {
                        const blocker = opponent.battlefield[k];
                        if (!isType(blocker, "Creature")) continue;
                        if (blocker.isTapped) continue;
                        if (
                            flying &&
                            !hasKeyword(blocker, "flying") &&
                            !hasKeyword(blocker, "reach")
                        ) {
                            continue;
                        }
                        const left =
                            getEffectivePT(state, blocker, pass).toughness -
                            (blocker.damageMarked ?? 0);
                        if (left > wall) wall = left;
                    }
                    if (wall < 0) {
                        evasive += power;
                        v += 12 * power;
                    } else if (power >= wall) {
                        v += 6 * (power - wall) + 4;
                    }
                }
            } else {
                v += 50;
            }
        }
        if (evasive >= opponent.life) v += 500;
        score += player.id === botId ? v : -v;
    }
    return score;
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/** One kernel: `load` builds a board's state and moves; `probe(m)` is one
 *  probe of candidate `m`; `run(n, reps)` is `reps` sweeps of the first `n`
 *  candidates, folded into the checksum arms B and C must reproduce. */
export function createObjectKernel() {
    let base = null;
    let moves = [];
    const botId = PLAYER_IDS[0];

    function load(board) {
        ({ state: base, moves } = buildState(board));
        // A position reaches the search settled: this pass writes layer 6
        // back, and must find nothing to bury.
        const buried = () =>
            base.players.reduce((n, p) => n + p.graveyard.length, 0);
        const before = buried();
        checkStateBasedActions(base);
        if (buried() !== before) {
            throw new Error(`board ${board.label} is not settled`);
        }
    }

    function probe(m) {
        const state = cloneValue(base);
        applyMove(state, moves[m]);
        checkStateBasedActions(state);
        return evaluate(state, botId);
    }

    function run(n, reps) {
        let acc = 0;
        for (let r = 0; r < reps; r++) {
            for (let m = 0; m < n; m++) {
                acc = (Math.imul(acc, 31) + probe(m)) | 0;
            }
        }
        return acc;
    }

    /** `reps` sweeps of the first `phases` steps of a probe (1 clone, 2 +
     *  apply, 3 + settle, 4 the whole probe), for the kernel's own split. */
    function runUpTo(n, reps, phases) {
        let acc = 0;
        for (let r = 0; r < reps; r++) {
            for (let m = 0; m < n; m++) {
                const state = cloneValue(base);
                if (phases > 1) applyMove(state, moves[m]);
                if (phases > 2) checkStateBasedActions(state);
                acc =
                    (acc +
                        (phases > 3
                            ? evaluate(state, botId)
                            : state.players.length)) |
                    0;
            }
        }
        return acc;
    }

    /** How many objects and arrays one clone allocates. */
    function cloneSize() {
        let objects = 0;
        const walk = (value, key) => {
            if (value === null || typeof value !== "object") return;
            if (key !== undefined && isShared(key, value)) return;
            objects++;
            if (Array.isArray(value)) value.forEach((v) => walk(v));
            else Object.keys(value).forEach((k) => walk(value[k], k));
        };
        walk(base);
        return objects;
    }

    return { load, probe, run, runUpTo, cloneSize };
}
