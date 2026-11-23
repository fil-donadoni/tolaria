// The probe kernel's vocabulary and its flat memory layout (issue #10471).
//
// One reduced rules subset, written three times (`kernel-objects.mjs`,
// `kernel-flat.mjs`, `kernel.c`). This file is the part the three share:
// the card table's columns, the move kinds, and where every field of a flat
// state lives. A flat state is `STATE_W` 32-bit words; arm B holds it in an
// `Int32Array`, arm C in WebAssembly linear memory, byte for byte the same,
// so the encoder below feeds both and a clone is one memory copy in each.
//
// `kernel.c` cannot import this file, so it repeats the constants;
// `entry-wasm-probe.mjs` refuses to measure unless the module's
// `layoutWord(i)` agrees with `LAYOUT_WORDS`.

// ---------------------------------------------------------------------------
// The rules vocabulary
// ---------------------------------------------------------------------------

export const T_LAND = 0;
export const T_CREATURE = 1;
export const T_AURA = 2;
export const T_ENCHANTMENT = 3;
export const T_INSTANT = 4;

export const KW_FLYING = 1;
export const KW_FIRST_STRIKE = 2;
export const KW_VIGILANCE = 4;
export const KW_DEATHTOUCH = 8;
export const KW_LIFELINK = 16;
export const KW_TRAMPLE = 32;
export const KW_DEFENDER = 64;
export const KW_REACH = 128;
export const KEYWORD_NAMES = [
    "flying",
    "first strike",
    "vigilance",
    "deathtouch",
    "lifelink",
    "trample",
    "defender",
    "reach",
];

/** What a permanent's static ability does to creatures (layer 7c, and the
 *  keywords it grants in layer 6). */
export const S_NONE = 0;
/** Creatures its controller controls. */
export const S_ANTHEM = 1;
/** OTHER creatures its controller controls that share its subtype. */
export const S_LORD = 2;
/** Untapped creatures its controller controls. */
export const S_UNTAPPED = 3;
/** The creature it is attached to. */
export const S_AURA = 4;

export const SP_NONE = 0;
/** `sp` damage to a creature or a player. */
export const SP_BURN = 1;
/** +`sp`/+`st` until end of turn (negative for a shrink). */
export const SP_PT = 2;

export const M_PASS = 0;
/** Hand card `a` enters as a land. */
export const M_LAND = 1;
/** Hand card `a` (a creature or an enchantment) is paid for and enters. */
export const M_PERMANENT = 2;
/** Hand card `a` (an Aura) is paid for and enters attached to permanent `b`. */
export const M_AURA = 3;
/** Hand card `a` (an instant) is paid for and resolves on `b`: a permanent,
 *  or player `-1 - b`. */
export const M_INSTANT = 4;
/** Permanent `a` is declared as an attacker. */
export const M_ATTACK = 5;

// The card table: one row of `D_W` words per card definition. Read-only, so
// no arm copies it with a state — the engine shares definitions the same way
// (`convex/gre/clone.ts`, `SHARED_KEYS`).
export const D_W = 12;
export const D_TYPE = 0;
export const D_COST = 1;
export const D_POWER = 2;
export const D_TOUGHNESS = 3;
export const D_KEYWORDS = 4;
export const D_SUBTYPE = 5;
export const D_LEGENDARY = 6;
export const D_STATIC = 7;
/** The static's (or the spell's) power change — a burn spell's damage. */
export const D_SP = 8;
export const D_ST = 9;
/** Keywords the static grants. */
export const D_SKW = 10;
export const D_SPELL = 11;

const def = (name, type, cost, fields = {}) => ({
    name,
    type,
    cost,
    power: 0,
    toughness: 0,
    keywords: 0,
    subtype: 0,
    legendary: 0,
    static: S_NONE,
    sp: 0,
    st: 0,
    skw: 0,
    spell: SP_NONE,
    ...fields,
});
const creature = (name, cost, power, toughness, fields = {}) =>
    def(name, T_CREATURE, cost, { power, toughness, ...fields });

/** The kernel's whole card pool. The names are labels for a reader; the
 *  kernel reads the numbers. Subtype 1 is the one the lord cares about. */
export const DEFS = [
    def("land", T_LAND, 0),
    creature("bear", 2, 2, 2),
    creature("giant", 4, 3, 3),
    creature("wurm", 6, 6, 4, { keywords: KW_TRAMPLE }),
    creature("angel", 5, 4, 4, { keywords: KW_FLYING | KW_VIGILANCE }),
    creature("lion", 1, 2, 1),
    creature("elf", 1, 1, 1, { subtype: 1 }),
    creature("spider", 4, 2, 4, { keywords: KW_REACH }),
    creature("wall", 3, 0, 8, { keywords: KW_DEFENDER }),
    creature("lord", 3, 2, 2, {
        subtype: 1,
        static: S_LORD,
        sp: 1,
        st: 1,
    }),
    creature("hero", 3, 3, 3, { legendary: 1, keywords: KW_FIRST_STRIKE }),
    def("anthem", T_ENCHANTMENT, 3, { static: S_ANTHEM, sp: 1, st: 1 }),
    def("bulwark", T_ENCHANTMENT, 4, { static: S_UNTAPPED, sp: 0, st: 2 }),
    def("blessing", T_AURA, 1, {
        static: S_AURA,
        sp: 1,
        st: 2,
        skw: KW_LIFELINK,
    }),
    def("frailty", T_AURA, 1, { static: S_AURA, sp: -2, st: -1 }),
    def("bolt", T_INSTANT, 1, { spell: SP_BURN, sp: 3 }),
    def("growth", T_INSTANT, 1, { spell: SP_PT, sp: 3, st: 3 }),
    def("wither", T_INSTANT, 2, { spell: SP_PT, sp: -2, st: -2 }),
];
export const DEF_ID = Object.fromEntries(DEFS.map((d, i) => [d.name, i]));

// ---------------------------------------------------------------------------
// The flat state
// ---------------------------------------------------------------------------

/** Permanent slots. */
export const MAXP = 48;
/** Until-end-of-turn effects. */
export const MAXE = 16;
/** Hand cards per player. */
export const MAXH = 8;
/** Library, and graveyard, cards per player. */
export const MAXZ = 48;

export const H_NPERM = 0;
export const H_NEFF = 1;
export const H_TS = 2;
export const H_ACTIVE = 3;

export const PL = 8;
export const PL_W = 8;
export const PL_LIFE = 0;
export const PL_LOST = 1;
export const PL_HAND = 2;
export const PL_LIB = 3;
export const PL_GY = 4;

export const HAND = PL + 2 * PL_W;
export const LIB = HAND + 2 * MAXH;
export const GY = LIB + 2 * MAXZ;

// Permanents: struct-of-arrays, one column of `MAXP` words per field. A free
// slot has definition -1.
export const P_DEF = GY + 2 * MAXZ;
export const P_CTRL = P_DEF + MAXP;
export const P_TAPPED = P_CTRL + MAXP;
export const P_SICK = P_TAPPED + MAXP;
export const P_DAMAGE = P_SICK + MAXP;
export const P_PLUS = P_DAMAGE + MAXP;
export const P_MINUS = P_PLUS + MAXP;
export const P_ATTACHED = P_MINUS + MAXP;
export const P_TS = P_ATTACHED + MAXP;
export const P_ATTACKING = P_TS + MAXP;

export const E_TARGET = P_ATTACKING + MAXP;
export const E_P = E_TARGET + MAXE;
export const E_T = E_P + MAXE;

export const STATE_W = E_T + MAXE;

/** Candidate moves per board, three words each (kind, a, b). */
export const MAXM = 16;
/** Rows the card table has room for. */
export const MAXD = 32;

/** What `kernel.as.ts` must agree on, in the order its `layoutWord` hands
 *  them out. */
export const LAYOUT_WORDS = [
    STATE_W,
    D_W,
    MAXP,
    MAXE,
    MAXH,
    MAXZ,
    MAXM,
    HAND,
    LIB,
    GY,
    P_DEF,
    P_ATTACKING,
    E_TARGET,
    E_T,
    MAXD,
];

/** The card table as arms B and C read it. */
export function encodeDefs() {
    const out = new Int32Array(DEFS.length * D_W);
    DEFS.forEach((d, i) => {
        out.set(
            [
                d.type,
                d.cost,
                d.power,
                d.toughness,
                d.keywords,
                d.subtype,
                d.legendary,
                d.static,
                d.sp,
                d.st,
                d.skw,
                d.spell,
            ],
            i * D_W
        );
    });
    return out;
}

/** A board description (`boards.mjs`) as one flat state. Permanent `i` of the
 *  description takes slot `i`. */
export function encodeBoard(board) {
    const s = new Int32Array(STATE_W);
    s[H_NPERM] = board.permanents.length;
    s[H_NEFF] = board.effects.length;
    s[H_TS] = board.permanents.length;
    s[H_ACTIVE] = board.active;
    s.fill(-1, HAND, P_DEF + MAXP);
    s.fill(-1, P_ATTACHED, P_ATTACHED + MAXP);
    board.players.forEach((p, i) => {
        const at = PL + i * PL_W;
        s[at + PL_LIFE] = p.life;
        s[at + PL_LOST] = 0;
        s[at + PL_HAND] = p.hand.length;
        s[at + PL_LIB] = p.library.length;
        s[at + PL_GY] = p.graveyard.length;
        s.set(p.hand, HAND + i * MAXH);
        s.set(p.library, LIB + i * MAXZ);
        s.set(p.graveyard, GY + i * MAXZ);
    });
    board.permanents.forEach((p, i) => {
        s[P_DEF + i] = p.def;
        s[P_CTRL + i] = p.controller;
        s[P_TAPPED + i] = p.tapped;
        s[P_SICK + i] = 0;
        s[P_DAMAGE + i] = p.damage;
        s[P_PLUS + i] = p.plus;
        s[P_MINUS + i] = p.minus;
        s[P_ATTACHED + i] = p.attachedTo;
        s[P_TS + i] = i + 1;
        s[P_ATTACKING + i] = 0;
    });
    board.effects.forEach((e, i) => {
        s[E_TARGET + i] = e.target;
        s[E_P + i] = e.p;
        s[E_T + i] = e.t;
    });
    return s;
}

/** A board's candidate moves, three words each. */
export function encodeMoves(board) {
    const out = new Int32Array(MAXM * 3);
    board.moves.forEach((m, i) => out.set([m.kind, m.a, m.b], i * 3));
    return out;
}
