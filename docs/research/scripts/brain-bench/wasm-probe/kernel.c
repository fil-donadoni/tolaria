// Arm C of the probe kernel (issue #10471): the flat layout compiled to
// WebAssembly.
//
// This is `kernel-flat.mjs`, function for function: the same words at the
// same offsets, the same steps in the same order. The state lives in linear
// memory instead of an `Int32Array`, and a clone is one `memory.copy`. The
// constants repeat `layout.mjs`'s (this file cannot import it); `layoutWord`
// hands them out so the runner refuses a module that disagrees.
//
// Build (`run-wasm-probe.mjs build` runs it; no toolchain is in a manifest):
//
//   clang --target=wasm32-unknown-unknown -O3 -ffreestanding -nostdlib \
//         -mbulk-memory -c kernel.c -o kernel.o
//
// then `link-wasm-object.mjs` turns the object into a module.

typedef int i32;

enum { T_LAND = 0, T_CREATURE = 1, T_AURA = 2 };

enum {
    KW_FLYING = 1,
    KW_FIRST_STRIKE = 2,
    KW_VIGILANCE = 4,
    KW_DEATHTOUCH = 8,
    KW_LIFELINK = 16,
    KW_TRAMPLE = 32,
    KW_DEFENDER = 64,
    KW_REACH = 128,
};

enum { S_ANTHEM = 1, S_LORD = 2, S_UNTAPPED = 3, S_AURA = 4 };

enum { SP_BURN = 1, SP_PT = 2 };

enum { M_LAND = 1, M_PERMANENT = 2, M_AURA = 3, M_INSTANT = 4, M_ATTACK = 5 };

enum {
    D_W = 12,
    D_TYPE = 0,
    D_COST = 1,
    D_POWER = 2,
    D_TOUGHNESS = 3,
    D_KEYWORDS = 4,
    D_SUBTYPE = 5,
    D_LEGENDARY = 6,
    D_STATIC = 7,
    D_SP = 8,
    D_ST = 9,
    D_SKW = 10,
    D_SPELL = 11,
};

enum { MAXP = 48, MAXE = 16, MAXH = 8, MAXZ = 48, MAXM = 16, MAXD = 32 };

enum { H_NPERM = 0, H_NEFF = 1, H_TS = 2, H_ACTIVE = 3 };

enum {
    PL = 8,
    PL_W = 8,
    PL_LIFE = 0,
    PL_LOST = 1,
    PL_HAND = 2,
    PL_GY = 4,
};

enum {
    HAND = PL + 2 * PL_W,
    LIB = HAND + 2 * MAXH,
    GY = LIB + 2 * MAXZ,

    P_DEF = GY + 2 * MAXZ,
    P_CTRL = P_DEF + MAXP,
    P_TAPPED = P_CTRL + MAXP,
    P_SICK = P_TAPPED + MAXP,
    P_DAMAGE = P_SICK + MAXP,
    P_PLUS = P_DAMAGE + MAXP,
    P_MINUS = P_PLUS + MAXP,
    P_ATTACHED = P_MINUS + MAXP,
    P_TS = P_ATTACHED + MAXP,
    P_ATTACKING = P_TS + MAXP,

    E_TARGET = P_ATTACKING + MAXP,
    E_P = E_TARGET + MAXE,
    E_T = E_P + MAXE,

    STATE_W = E_T + MAXE,
};

/* The card table, read-only. */
static i32 D[MAXD * D_W];
/* The position the probes start from, never written after it is loaded. */
static i32 BASE[STATE_W];
/* The probe's own copy. */
static i32 W[STATE_W];
static i32 MOVES[MAXM * 3];
/* Characteristics after continuous effects, per slot. */
static i32 cP[MAXP];
static i32 cT[MAXP];
static i32 cK[MAXP];
/* The slots holding a static ability, for the pass in progress. */
static i32 SRC[MAXP];
/* The slots a settle pass condemned. */
static i32 DYING[MAXP];

i32 *defsPtr(void) { return D; }
i32 *basePtr(void) { return BASE; }
i32 *movesPtr(void) { return MOVES; }

i32 layoutWord(i32 i) {
    switch (i) {
    case 0:
        return STATE_W;
    case 1:
        return D_W;
    case 2:
        return MAXP;
    case 3:
        return MAXE;
    case 4:
        return MAXH;
    case 5:
        return MAXZ;
    case 6:
        return MAXM;
    case 7:
        return HAND;
    case 8:
        return LIB;
    case 9:
        return GY;
    case 10:
        return P_DEF;
    case 11:
        return P_ATTACKING;
    case 12:
        return E_TARGET;
    case 13:
        return E_T;
    case 14:
        return MAXD;
    default:
        return -1;
    }
}

/* -- apply ---------------------------------------------------------------- */

static i32 takeFromHand(i32 pl, i32 index) {
    const i32 at = HAND + pl * MAXH;
    const i32 count = W[PL + pl * PL_W + PL_HAND];
    const i32 def = W[at + index];
    for (i32 i = index; i < count - 1; i++) W[at + i] = W[at + i + 1];
    W[at + count - 1] = -1;
    W[PL + pl * PL_W + PL_HAND] = count - 1;
    return def;
}

static void payCost(i32 pl, i32 cost) {
    const i32 n = W[H_NPERM];
    for (i32 s = 0; s < n && cost > 0; s++) {
        const i32 d = W[P_DEF + s];
        if (d < 0 || W[P_CTRL + s] != pl || W[P_TAPPED + s] != 0) continue;
        if (D[d * D_W + D_TYPE] != T_LAND) continue;
        W[P_TAPPED + s] = 1;
        cost--;
    }
}

static void enter(i32 def, i32 pl, i32 attachedTo) {
    const i32 n = W[H_NPERM];
    i32 s = 0;
    while (s < n && W[P_DEF + s] >= 0) s++;
    if (s == n) W[H_NPERM] = n + 1;
    const i32 ts = W[H_TS] + 1;
    W[H_TS] = ts;
    W[P_DEF + s] = def;
    W[P_CTRL + s] = pl;
    W[P_TAPPED + s] = 0;
    W[P_SICK + s] = 1;
    W[P_DAMAGE + s] = 0;
    W[P_PLUS + s] = 0;
    W[P_MINUS + s] = 0;
    W[P_ATTACHED + s] = attachedTo;
    W[P_TS + s] = ts;
    W[P_ATTACKING + s] = 0;
}

static void bury(i32 pl, i32 def) {
    const i32 at = PL + pl * PL_W + PL_GY;
    const i32 count = W[at];
    W[GY + pl * MAXZ + count] = def;
    W[at] = count + 1;
}

static void applyMove(i32 kind, i32 a, i32 b) {
    const i32 pl = W[H_ACTIVE];
    if (kind == M_LAND) {
        enter(takeFromHand(pl, a), pl, -1);
    } else if (kind == M_PERMANENT) {
        const i32 def = takeFromHand(pl, a);
        payCost(pl, D[def * D_W + D_COST]);
        enter(def, pl, -1);
    } else if (kind == M_AURA) {
        const i32 def = takeFromHand(pl, a);
        payCost(pl, D[def * D_W + D_COST]);
        enter(def, pl, b);
    } else if (kind == M_INSTANT) {
        const i32 def = takeFromHand(pl, a);
        const i32 row = def * D_W;
        payCost(pl, D[row + D_COST]);
        const i32 spell = D[row + D_SPELL];
        if (spell == SP_BURN) {
            if (b >= 0) W[P_DAMAGE + b] += D[row + D_SP];
            else W[PL + (-1 - b) * PL_W + PL_LIFE] -= D[row + D_SP];
        } else if (spell == SP_PT) {
            const i32 e = W[H_NEFF];
            W[E_TARGET + e] = b;
            W[E_P + e] = D[row + D_SP];
            W[E_T + e] = D[row + D_ST];
            W[H_NEFF] = e + 1;
        }
        bury(pl, def);
    } else if (kind == M_ATTACK) {
        W[P_ATTACKING + a] = 1;
        if ((D[W[P_DEF + a] * D_W + D_KEYWORDS] & KW_VIGILANCE) == 0) {
            W[P_TAPPED + a] = 1;
        }
    }
}

/* -- continuous effects --------------------------------------------------- */

static void computeCharacteristics(void) {
    const i32 n = W[H_NPERM];
    i32 sources = 0;
    for (i32 s = 0; s < n; s++) {
        const i32 d = W[P_DEF + s];
        if (d >= 0 && D[d * D_W + D_STATIC] != 0) SRC[sources++] = s;
    }
    const i32 effects = W[H_NEFF];
    for (i32 s = 0; s < n; s++) {
        const i32 d = W[P_DEF + s];
        if (d < 0) continue;
        const i32 row = d * D_W;
        if (D[row + D_TYPE] != T_CREATURE) continue;
        i32 p = D[row + D_POWER];
        i32 t = D[row + D_TOUGHNESS];
        i32 kw = D[row + D_KEYWORDS];
        const i32 ctrl = W[P_CTRL + s];
        for (i32 i = 0; i < sources; i++) {
            const i32 q = SRC[i];
            const i32 qrow = W[P_DEF + q] * D_W;
            const i32 kind = D[qrow + D_STATIC];
            i32 on = 0;
            if (kind == S_ANTHEM) {
                on = W[P_CTRL + q] == ctrl;
            } else if (kind == S_LORD) {
                on = W[P_CTRL + q] == ctrl && q != s &&
                     D[qrow + D_SUBTYPE] == D[row + D_SUBTYPE];
            } else if (kind == S_UNTAPPED) {
                on = W[P_CTRL + q] == ctrl && W[P_TAPPED + s] == 0;
            } else if (kind == S_AURA) {
                on = W[P_ATTACHED + q] == s;
            }
            if (on) {
                p += D[qrow + D_SP];
                t += D[qrow + D_ST];
                kw |= D[qrow + D_SKW];
            }
        }
        for (i32 e = 0; e < effects; e++) {
            if (W[E_TARGET + e] == s) {
                p += W[E_P + e];
                t += W[E_T + e];
            }
        }
        const i32 counters = W[P_PLUS + s] - W[P_MINUS + s];
        cP[s] = p + counters;
        cT[s] = t + counters;
        cK[s] = kw;
    }
}

/* -- state-based actions -------------------------------------------------- */

static void die(i32 s) {
    bury(W[P_CTRL + s], W[P_DEF + s]);
    W[P_DEF + s] = -1;
}

static void settle(void) {
    for (i32 pass = 0; pass < 8; pass++) {
        computeCharacteristics();
        const i32 n = W[H_NPERM];
        for (i32 s = 0; s < n; s++) {
            DYING[s] = 0;
            const i32 d = W[P_DEF + s];
            if (d < 0) continue;
            const i32 plus = W[P_PLUS + s];
            const i32 minus = W[P_MINUS + s];
            if (plus > 0 && minus > 0) {
                const i32 both = plus < minus ? plus : minus;
                W[P_PLUS + s] = plus - both;
                W[P_MINUS + s] = minus - both;
            }
            const i32 row = d * D_W;
            const i32 type = D[row + D_TYPE];
            if (type == T_CREATURE) {
                if (cT[s] <= 0 || W[P_DAMAGE + s] >= cT[s]) DYING[s] = 1;
            } else if (type == T_AURA) {
                const i32 host = W[P_ATTACHED + s];
                const i32 hd = host < 0 ? -1 : W[P_DEF + host];
                if (hd < 0 || D[hd * D_W + D_TYPE] != T_CREATURE) {
                    DYING[s] = 1;
                }
            }
            if (D[row + D_LEGENDARY] != 0) {
                const i32 ctrl = W[P_CTRL + s];
                const i32 ts = W[P_TS + s];
                for (i32 o = 0; o < n; o++) {
                    if (W[P_DEF + o] == d && W[P_CTRL + o] == ctrl &&
                        W[P_TS + o] > ts) {
                        DYING[s] = 1;
                        break;
                    }
                }
            }
        }
        i32 changed = 0;
        for (i32 s = 0; s < n; s++) {
            if (DYING[s] != 0) {
                die(s);
                changed = 1;
            }
        }
        for (i32 pl = 0; pl < 2; pl++) {
            const i32 at = PL + pl * PL_W;
            if (W[at + PL_LIFE] <= 0) W[at + PL_LOST] = 1;
        }
        if (!changed) return;
    }
}

/* -- evaluation ----------------------------------------------------------- */

static i32 keywordValue(i32 kw) {
    i32 v = 0;
    if (kw & KW_FLYING) v += 30;
    if (kw & KW_FIRST_STRIKE) v += 15;
    if (kw & KW_VIGILANCE) v += 10;
    if (kw & KW_DEATHTOUCH) v += 25;
    if (kw & KW_LIFELINK) v += 20;
    if (kw & KW_TRAMPLE) v += 12;
    if (kw & KW_DEFENDER) v -= 20;
    if (kw & KW_REACH) v += 8;
    return v;
}

static i32 evaluate(void) {
    computeCharacteristics();
    const i32 n = W[H_NPERM];
    i32 score = 0;
    for (i32 pl = 0; pl < 2; pl++) {
        const i32 at = PL + pl * PL_W;
        const i32 opp = 1 - pl;
        i32 v = W[at + PL_LIFE] * 40 + W[at + PL_HAND] * 60;
        if (W[at + PL_LOST] != 0) v -= 100000;
        i32 evasive = 0;
        for (i32 s = 0; s < n; s++) {
            const i32 d = W[P_DEF + s];
            if (d < 0 || W[P_CTRL + s] != pl) continue;
            const i32 type = D[d * D_W + D_TYPE];
            const i32 tapped = W[P_TAPPED + s];
            if (type == T_LAND) {
                v += tapped == 0 ? 35 : 30;
            } else if (type == T_CREATURE) {
                const i32 p = cP[s];
                const i32 kw = cK[s];
                const i32 sick = W[P_SICK + s];
                v += 40 + 25 * p + 15 * cT[s] - 5 * W[P_DAMAGE + s];
                if (tapped != 0) v -= 5;
                if (sick != 0) v -= 3;
                v += keywordValue(kw);
                if (tapped == 0 && sick == 0 && (kw & KW_DEFENDER) == 0 &&
                    p > 0) {
                    i32 wall = -1;
                    for (i32 o = 0; o < n; o++) {
                        const i32 od = W[P_DEF + o];
                        if (od < 0 || W[P_CTRL + o] != opp) continue;
                        if (D[od * D_W + D_TYPE] != T_CREATURE) continue;
                        if (W[P_TAPPED + o] != 0) continue;
                        if ((kw & KW_FLYING) != 0 &&
                            (cK[o] & (KW_FLYING | KW_REACH)) == 0) {
                            continue;
                        }
                        const i32 left = cT[o] - W[P_DAMAGE + o];
                        if (left > wall) wall = left;
                    }
                    if (wall < 0) {
                        evasive += p;
                        v += 12 * p;
                    } else if (p >= wall) {
                        v += 6 * (p - wall) + 4;
                    }
                }
            } else {
                v += 50;
            }
        }
        if (evasive >= W[PL + opp * PL_W + PL_LIFE]) v += 500;
        score += pl == 0 ? v : -v;
    }
    return score;
}

/* -- the probe ------------------------------------------------------------ */

i32 probe(i32 m) {
    __builtin_memcpy(W, BASE, sizeof W);
    applyMove(MOVES[m * 3], MOVES[m * 3 + 1], MOVES[m * 3 + 2]);
    settle();
    return evaluate();
}

i32 run(i32 n, i32 reps) {
    unsigned acc = 0;
    for (i32 r = 0; r < reps; r++) {
        for (i32 m = 0; m < n; m++) {
            acc = acc * 31u + (unsigned)probe(m);
        }
    }
    return (i32)acc;
}

i32 runUpTo(i32 n, i32 reps, i32 phases) {
    unsigned acc = 0;
    for (i32 r = 0; r < reps; r++) {
        for (i32 m = 0; m < n; m++) {
            __builtin_memcpy(W, BASE, sizeof W);
            if (phases > 1) {
                applyMove(MOVES[m * 3], MOVES[m * 3 + 1], MOVES[m * 3 + 2]);
            }
            if (phases > 2) settle();
            acc += (unsigned)(phases > 3 ? evaluate() : W[H_NPERM]);
        }
    }
    return (i32)acc;
}
