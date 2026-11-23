// The probe kernel's boards (issue #10471): synthetic, seeded, shaped like the
// four production late-game boards of `docs/research/rollout-policy-cost.md`
// § 1 — 21, 26 and 30 permanents, a library of 28–39 cards a side, and as
// many candidate moves as a probing ply there has (5.2–8.1). No production
// row enters the repository: every card here comes out of `mulberry32`.
//
// A board is a neutral DESCRIPTION (plain numbers); each arm builds its own
// state from it — `kernel-objects.mjs` an object graph, `layout.mjs`'s
// `encodeBoard` the flat words arms B and C share. `anchorSpec` lowers the
// same description to real cards, for the engine's own probe.

import {
    DEFS,
    DEF_ID,
    MAXH,
    MAXM,
    MAXP,
    MAXZ,
    M_ATTACK,
    M_AURA,
    M_INSTANT,
    M_LAND,
    M_PASS,
    M_PERMANENT,
    T_CREATURE,
    T_LAND,
} from "./layout.mjs";

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const CREATURE_POOL = [
    "bear",
    "bear",
    "giant",
    "wurm",
    "angel",
    "lion",
    "elf",
    "elf",
    "spider",
    "wall",
    "lord",
];
const ZONE_POOL = [
    "land",
    "land",
    "land",
    "bear",
    "giant",
    "lion",
    "elf",
    "angel",
    "bolt",
    "growth",
    "blessing",
    "anthem",
];

/** The shapes measured: permanents on the battlefield and the candidate moves
 *  at the probing ply (indexes into `buildBoard`'s list), after the field
 *  boards: 21 / 26 / 30 permanents, 5.2–8.1 candidates per probing ply. */
export const SHAPES = [
    { permanents: 21, candidates: [0, 1, 2, 3, 4, 5] },
    { permanents: 26, candidates: [0, 6, 7, 8, 9, 10] },
    { permanents: 30, candidates: [0, 1, 2, 3, 4, 8, 9, 10] },
];

/** One board of `shape`, from `seed`. Player 0 is the active player, in its
 *  main phase with untapped lands and a hand to choose from. */
export function buildBoard(shape, seed) {
    const rng = mulberry32(seed);
    const int = (n) => Math.floor(rng() * n);
    const pick = (list) => list[int(list.length)];
    const permanents = [];
    const creaturesOf = [[], []];

    for (let pl = 0; pl < 2; pl++) {
        const n =
            pl === 0
                ? Math.ceil(shape.permanents / 2)
                : Math.floor(shape.permanents / 2);
        const lands = Math.round(n * 0.48);
        const others = Math.max(1, Math.round(n * 0.14));
        const creatures = n - lands - others;
        // The active player has tapped for the turn's earlier plays; the
        // opponent's lands are all open.
        const open = pl === 0 ? Math.min(lands, 5) : lands;
        for (let i = 0; i < lands; i++) {
            permanents.push({
                def: DEF_ID.land,
                controller: pl,
                tapped: i < open ? 0 : 1,
                damage: 0,
                plus: 0,
                minus: 0,
                attachedTo: -1,
            });
        }
        for (let i = 0; i < creatures; i++) {
            // Each side opens with a 2/2 and a one-toughness body, the bodies
            // a burn spell and a shrink are aimed at; the active player's
            // third is the legendary one its hand holds a second copy of.
            const name =
                i === 0
                    ? "bear"
                    : i === 1
                      ? "lion"
                      : i === 2 && pl === 0
                        ? "hero"
                        : pick(CREATURE_POOL);
            const d = DEFS[DEF_ID[name]];
            const plus = rng() < 0.15 ? 1 : 0;
            creaturesOf[pl].push(permanents.length);
            permanents.push({
                def: DEF_ID[name],
                controller: pl,
                tapped: i > 1 && rng() < 0.15 ? 1 : 0,
                damage: d.toughness > 1 && rng() < 0.1 ? 1 : 0,
                plus,
                minus: !plus && d.toughness > 2 && rng() < 0.05 ? 1 : 0,
                attachedTo: -1,
            });
        }
        for (let i = 0; i < others; i++) {
            // One anthem a side, then Auras and the conditional static.
            const name =
                i === 0
                    ? "anthem"
                    : pick(["blessing", "blessing", "frailty", "bulwark"]);
            let attachedTo = -1;
            if (name === "blessing") {
                // Never on the two bodies the candidates aim at.
                attachedTo = pick(creaturesOf[pl].slice(2));
            }
            if (name === "frailty") {
                // On the opponent's biggest body, which survives it. Player
                // 0's Auras are placed before player 1 has creatures: they go
                // on its own.
                const side = creaturesOf[1 - pl].length ? 1 - pl : pl;
                attachedTo = creaturesOf[side].reduce((best, s) =>
                    DEFS[permanents[s].def].toughness >
                    DEFS[permanents[best].def].toughness
                        ? s
                        : best
                );
                if (DEFS[permanents[attachedTo].def].toughness < 3) {
                    attachedTo = -1;
                } else {
                    // A board reaches the search settled: nothing on it is
                    // already dead.
                    permanents[attachedTo].damage = 0;
                    permanents[attachedTo].minus = 0;
                }
            }
            permanents.push({
                def:
                    attachedTo === -1 && name !== "anthem"
                        ? DEF_ID.bulwark
                        : DEF_ID[name],
                controller: pl,
                tapped: 0,
                damage: 0,
                plus: 0,
                minus: 0,
                attachedTo,
            });
        }
    }

    const zone = (n) =>
        Array.from({ length: n }, () => DEF_ID[pick(ZONE_POOL)]);
    // The hand the candidates are drawn from; every card is castable off the
    // open lands, alone.
    const hand0 = [
        "land",
        "bear",
        "bolt",
        "growth",
        "blessing",
        "frailty",
        "wither",
        "hero",
    ].map((name) => DEF_ID[name]);
    const players = [
        {
            life: 8 + int(13),
            hand: hand0,
            library: zone(28 + int(12)),
            graveyard: zone(5 + int(6)),
        },
        {
            life: 6 + int(15),
            hand: zone(2 + int(3)),
            library: zone(28 + int(12)),
            graveyard: zone(5 + int(6)),
        },
    ];

    const mine = creaturesOf[0];
    const theirs = creaturesOf[1];
    const untapped = mine.filter((s) => !permanents[s].tapped);
    const h = (name) => hand0.indexOf(DEF_ID[name]);
    // In the order a reader would list them; `pass` first, as in the engine.
    const all = [
        { kind: M_PASS, a: 0, b: 0 },
        // The burn spell on a 2/2: it dies unless a counter or the
        // conditional static has taken it past three toughness.
        { kind: M_INSTANT, a: h("bolt"), b: theirs[0] },
        { kind: M_PERMANENT, a: h("bear"), b: 0 },
        // A shrinking Aura on a one-toughness body. Its side's anthem keeps
        // it alive at 1/1: a probe that moves characteristics and kills
        // nothing.
        { kind: M_AURA, a: h("frailty"), b: theirs[1] },
        { kind: M_ATTACK, a: untapped[0] ?? mine[0], b: 0 },
        { kind: M_INSTANT, a: h("growth"), b: mine[int(mine.length)] },
        { kind: M_LAND, a: h("land"), b: 0 },
        { kind: M_INSTANT, a: h("bolt"), b: -2 },
        { kind: M_AURA, a: h("blessing"), b: mine[int(mine.length)] },
        { kind: M_INSTANT, a: h("wither"), b: theirs[1] },
        // The shrink on the same body: it dies. Then a second copy of the
        // legendary creature already out: the first leaves, and any Aura on
        // it follows in the next pass.
        { kind: M_PERMANENT, a: h("hero"), b: 0 },
    ];
    const board = {
        label: `${shape.permanents}p/${shape.candidates.length}c/${seed}`,
        shape,
        seed,
        active: 0,
        players,
        permanents,
        effects: rng() < 0.5 ? [{ target: mine[0], p: 1, t: 1 }] : [],
        moves: shape.candidates.map((i) => all[i]),
    };
    check(board);
    return board;
}

function check(board) {
    const fail = (why) => {
        throw new Error(`board ${board.label}: ${why}`);
    };
    // A probe may add one permanent; the kernel never grows past its slots.
    if (board.permanents.length + 1 > MAXP) fail("too many permanents");
    if (board.moves.length > MAXM) fail("too many moves");
    for (const p of board.players) {
        if (p.hand.length > MAXH) fail("hand too large");
        if (p.library.length > MAXZ) fail("library too large");
        // A probe can bury a spell, a creature and its Auras.
        if (p.graveyard.length + 8 > MAXZ) fail("graveyard too large");
    }
    for (const p of board.permanents) {
        if (!Number.isInteger(p.attachedTo)) fail("an Aura has no host");
    }
    const open = board.permanents.filter(
        (p) => p.controller === 0 && DEFS[p.def].type === T_LAND && !p.tapped
    ).length;
    for (const m of board.moves) {
        if (m.kind === M_PASS || m.kind === M_ATTACK) continue;
        const d = DEFS[board.players[0].hand[m.a]];
        if (!d) fail("a move names no hand card");
        if (d.cost > open) fail(`${d.name} is not castable`);
        if (m.kind === M_AURA || (m.kind === M_INSTANT && m.b >= 0)) {
            if (DEFS[board.permanents[m.b]?.def]?.type !== T_CREATURE) {
                fail(`${d.name} targets no creature`);
            }
        }
    }
}

/** The measured boards: two seeds per shape. */
export function buildBoards() {
    return SHAPES.flatMap((shape, i) =>
        [1, 2].map((k) => buildBoard(shape, 0x10471 + i * 16 + k))
    );
}

// ---------------------------------------------------------------------------
// The same board, in real cards
// ---------------------------------------------------------------------------

const REAL = {
    bear: "Grizzly Bears",
    giant: "Hill Giant",
    wurm: "Craw Wurm",
    angel: "Serra Angel",
    lion: "Savannah Lions",
    elf: "Llanowar Elves",
    spider: "Giant Spider",
    wall: "Wall of Stone",
    lord: "Elvish Champion",
    hero: "Gray Ogre",
    anthem: "Glorious Anthem",
    bulwark: "Castle",
    blessing: "Holy Strength",
    frailty: "Weakness",
    bolt: "Lightning Bolt",
    growth: "Giant Growth",
    wither: "Shock",
};
/** The basics a side's lands cycle through, so every colour the hand needs is
 *  among the open ones. */
const BASICS = ["Mountain", "Forest", "Plains", "Swamp"];

/** `board` as the `ScenarioSpec` the engine's own builder takes
 *  (`convex/debugScenarioSpec.ts`): the same permanents by kind and side, the
 *  same hand, a library of the same size. Not the same GAME — a real card has
 *  rules the kernel's row does not — the same SHAPE, which is what the probe's
 *  cost follows. An Aura's host is named by card name, so an Aura lands on the
 *  first permanent of its host's name. */
export function anchorSpec(board) {
    const owner = (pl) => (pl === 0 ? "me" : "opp");
    const lands = [0, 0];
    const realName = (def, pl) =>
        DEFS[def].type === T_LAND
            ? BASICS[lands[pl]++ % BASICS.length]
            : REAL[DEFS[def].name];
    const cards = [];
    for (const p of board.permanents) {
        const host = board.permanents[p.attachedTo];
        cards.push({
            name: realName(p.def, p.controller),
            owner: owner(p.controller),
            zone: "battlefield",
            ...(p.tapped ? { tapped: true } : {}),
            ...(p.damage ? { damageMarked: p.damage } : {}),
            ...(p.plus ? { counters: { "+1/+1": p.plus } } : {}),
            ...(host ? { attachedTo: REAL[DEFS[host.def].name] } : {}),
        });
    }
    board.players.forEach((player, pl) => {
        for (const def of player.hand) {
            cards.push({
                name: realName(def, pl),
                owner: owner(pl),
                zone: "hand",
            });
        }
        for (const def of player.graveyard) {
            cards.push({
                name: realName(def, pl),
                owner: owner(pl),
                zone: "graveyard",
            });
        }
    });
    return {
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 15,
        libraryCount: Math.round(
            (board.players[0].library.length +
                board.players[1].library.length) /
                2
        ),
        life: { me: board.players[0].life, opp: board.players[1].life },
    };
}
