// Arm B of the probe kernel (issue #10471): flat memory, still JavaScript.
//
// The state is `STATE_W` 32-bit words in one `Int32Array` (`layout.mjs`):
// integer ids, struct-of-arrays, no object per card. A probe copies the base
// state over the work state in ONE call (`Int32Array.prototype.set`), applies
// a candidate move, settles state-based actions and continuous effects, and
// evaluates the board. `kernel.c` is this file compiled to WebAssembly: the
// same layout, the same steps in the same order, so what separates the two
// arms is the compiler and the runtime, not the algorithm.
//
// The rules are the reduced subset the note declares
// (`docs/research/wasm-probe-kernel.md` § The kernel).

import {
    D_COST,
    D_KEYWORDS,
    D_LEGENDARY,
    D_POWER,
    D_SKW,
    D_SP,
    D_SPELL,
    D_ST,
    D_STATIC,
    D_SUBTYPE,
    D_TOUGHNESS,
    D_TYPE,
    D_W,
    E_P,
    E_T,
    E_TARGET,
    GY,
    HAND,
    H_ACTIVE,
    H_NEFF,
    H_NPERM,
    H_TS,
    KW_DEATHTOUCH,
    KW_DEFENDER,
    KW_FIRST_STRIKE,
    KW_FLYING,
    KW_LIFELINK,
    KW_REACH,
    KW_TRAMPLE,
    KW_VIGILANCE,
    MAXH,
    MAXP,
    MAXZ,
    M_ATTACK,
    M_AURA,
    M_INSTANT,
    M_LAND,
    M_PERMANENT,
    PL,
    PL_GY,
    PL_HAND,
    PL_LIFE,
    PL_LOST,
    PL_W,
    P_ATTACHED,
    P_ATTACKING,
    P_CTRL,
    P_DAMAGE,
    P_DEF,
    P_MINUS,
    P_PLUS,
    P_SICK,
    P_TAPPED,
    P_TS,
    SP_BURN,
    SP_PT,
    STATE_W,
    S_ANTHEM,
    S_AURA,
    S_LORD,
    S_UNTAPPED,
    T_AURA,
    T_CREATURE,
    T_LAND,
} from "./layout.mjs";

/** One kernel over one card table. `load` takes a board's flat words and its
 *  moves; `probe(m)` is one probe of candidate `m`; `run(n, reps)` is `reps`
 *  sweeps of the first `n` candidates, folded into a checksum. */
export function createFlatKernel(defs) {
    /** The card table, read-only. */
    const D = defs;
    /** The position the probes start from, never written after `load`. */
    const BASE = new Int32Array(STATE_W);
    /** The probe's own copy. */
    const W = new Int32Array(STATE_W);
    let MOVES = new Int32Array(0);
    // Characteristics after continuous effects, per slot: recomputed by every
    // settle pass, never part of a state.
    const cP = new Int32Array(MAXP);
    const cT = new Int32Array(MAXP);
    const cK = new Int32Array(MAXP);
    /** The slots holding a static ability, for the pass in progress. */
    const SRC = new Int32Array(MAXP);
    /** The slots a settle pass condemned. */
    const DYING = new Int32Array(MAXP);

    function load(state, moves) {
        BASE.set(state);
        MOVES = moves;
    }

    // -- apply ---------------------------------------------------------------

    function takeFromHand(pl, index) {
        const at = HAND + pl * MAXH;
        const count = W[PL + pl * PL_W + PL_HAND];
        const def = W[at + index];
        for (let i = index; i < count - 1; i++) W[at + i] = W[at + i + 1];
        W[at + count - 1] = -1;
        W[PL + pl * PL_W + PL_HAND] = count - 1;
        return def;
    }

    function payCost(pl, cost) {
        const n = W[H_NPERM];
        for (let s = 0; s < n && cost > 0; s++) {
            const d = W[P_DEF + s];
            if (d < 0 || W[P_CTRL + s] !== pl || W[P_TAPPED + s] !== 0) {
                continue;
            }
            if (D[d * D_W + D_TYPE] !== T_LAND) continue;
            W[P_TAPPED + s] = 1;
            cost--;
        }
    }

    function enter(def, pl, attachedTo) {
        const n = W[H_NPERM];
        let s = 0;
        while (s < n && W[P_DEF + s] >= 0) s++;
        if (s === n) W[H_NPERM] = n + 1;
        const ts = W[H_TS] + 1;
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

    function bury(pl, def) {
        const at = PL + pl * PL_W + PL_GY;
        const count = W[at];
        W[GY + pl * MAXZ + count] = def;
        W[at] = count + 1;
    }

    function applyMove(kind, a, b) {
        const pl = W[H_ACTIVE];
        if (kind === M_LAND) {
            enter(takeFromHand(pl, a), pl, -1);
        } else if (kind === M_PERMANENT) {
            const def = takeFromHand(pl, a);
            payCost(pl, D[def * D_W + D_COST]);
            enter(def, pl, -1);
        } else if (kind === M_AURA) {
            const def = takeFromHand(pl, a);
            payCost(pl, D[def * D_W + D_COST]);
            enter(def, pl, b);
        } else if (kind === M_INSTANT) {
            const def = takeFromHand(pl, a);
            const row = def * D_W;
            payCost(pl, D[row + D_COST]);
            const spell = D[row + D_SPELL];
            if (spell === SP_BURN) {
                if (b >= 0) W[P_DAMAGE + b] += D[row + D_SP];
                else W[PL + (-1 - b) * PL_W + PL_LIFE] -= D[row + D_SP];
            } else if (spell === SP_PT) {
                const e = W[H_NEFF];
                W[E_TARGET + e] = b;
                W[E_P + e] = D[row + D_SP];
                W[E_T + e] = D[row + D_ST];
                W[H_NEFF] = e + 1;
            }
            bury(pl, def);
        } else if (kind === M_ATTACK) {
            W[P_ATTACKING + a] = 1;
            if ((D[W[P_DEF + a] * D_W + D_KEYWORDS] & KW_VIGILANCE) === 0) {
                W[P_TAPPED + a] = 1;
            }
        }
    }

    // -- continuous effects --------------------------------------------------

    /** Every creature's power, toughness and keywords after the statics on
     *  the battlefield (layer 6 for the keywords they grant, layer 7c for
     *  power and toughness), the until-end-of-turn effects (7c) and its
     *  counters (7d). */
    function computeCharacteristics() {
        const n = W[H_NPERM];
        let sources = 0;
        for (let s = 0; s < n; s++) {
            const d = W[P_DEF + s];
            if (d >= 0 && D[d * D_W + D_STATIC] !== 0) SRC[sources++] = s;
        }
        const effects = W[H_NEFF];
        for (let s = 0; s < n; s++) {
            const d = W[P_DEF + s];
            if (d < 0) continue;
            const row = d * D_W;
            if (D[row + D_TYPE] !== T_CREATURE) continue;
            let p = D[row + D_POWER];
            let t = D[row + D_TOUGHNESS];
            let kw = D[row + D_KEYWORDS];
            const ctrl = W[P_CTRL + s];
            for (let i = 0; i < sources; i++) {
                const q = SRC[i];
                const qrow = W[P_DEF + q] * D_W;
                const kind = D[qrow + D_STATIC];
                let on = false;
                if (kind === S_ANTHEM) {
                    on = W[P_CTRL + q] === ctrl;
                } else if (kind === S_LORD) {
                    on =
                        W[P_CTRL + q] === ctrl &&
                        q !== s &&
                        D[qrow + D_SUBTYPE] === D[row + D_SUBTYPE];
                } else if (kind === S_UNTAPPED) {
                    on = W[P_CTRL + q] === ctrl && W[P_TAPPED + s] === 0;
                } else if (kind === S_AURA) {
                    on = W[P_ATTACHED + q] === s;
                }
                if (on) {
                    p += D[qrow + D_SP];
                    t += D[qrow + D_ST];
                    kw |= D[qrow + D_SKW];
                }
            }
            for (let e = 0; e < effects; e++) {
                if (W[E_TARGET + e] === s) {
                    p += W[E_P + e];
                    t += W[E_T + e];
                }
            }
            const counters = W[P_PLUS + s] - W[P_MINUS + s];
            cP[s] = p + counters;
            cT[s] = t + counters;
            cK[s] = kw;
        }
    }

    // -- state-based actions -------------------------------------------------

    function die(s) {
        bury(W[P_CTRL + s], W[P_DEF + s]);
        W[P_DEF + s] = -1;
    }

    /** State-based actions until none applies, the continuous effects
     *  recomputed before every pass: a creature with toughness 0 or less or
     *  with lethal damage, an Aura attached to nothing or to a non-creature,
     *  the legend rule (the newest copy stays), +1/+1 against -1/-1 counters,
     *  a player at 0 life or less. Every check of a pass reads the board as
     *  the pass found it; what it condemned leaves together. */
    function settle() {
        for (let pass = 0; pass < 8; pass++) {
            computeCharacteristics();
            const n = W[H_NPERM];
            for (let s = 0; s < n; s++) {
                DYING[s] = 0;
                const d = W[P_DEF + s];
                if (d < 0) continue;
                const plus = W[P_PLUS + s];
                const minus = W[P_MINUS + s];
                if (plus > 0 && minus > 0) {
                    const both = plus < minus ? plus : minus;
                    W[P_PLUS + s] = plus - both;
                    W[P_MINUS + s] = minus - both;
                }
                const row = d * D_W;
                const type = D[row + D_TYPE];
                if (type === T_CREATURE) {
                    if (cT[s] <= 0 || W[P_DAMAGE + s] >= cT[s]) DYING[s] = 1;
                } else if (type === T_AURA) {
                    const host = W[P_ATTACHED + s];
                    const hd = host < 0 ? -1 : W[P_DEF + host];
                    if (hd < 0 || D[hd * D_W + D_TYPE] !== T_CREATURE) {
                        DYING[s] = 1;
                    }
                }
                if (D[row + D_LEGENDARY] !== 0) {
                    const ctrl = W[P_CTRL + s];
                    const ts = W[P_TS + s];
                    for (let o = 0; o < n; o++) {
                        if (
                            W[P_DEF + o] === d &&
                            W[P_CTRL + o] === ctrl &&
                            W[P_TS + o] > ts
                        ) {
                            DYING[s] = 1;
                            break;
                        }
                    }
                }
            }
            let changed = false;
            for (let s = 0; s < n; s++) {
                if (DYING[s] !== 0) {
                    die(s);
                    changed = true;
                }
            }
            for (let pl = 0; pl < 2; pl++) {
                const at = PL + pl * PL_W;
                if (W[at + PL_LIFE] <= 0) W[at + PL_LOST] = 1;
            }
            if (!changed) return;
        }
    }

    // -- evaluation ----------------------------------------------------------

    function keywordValue(kw) {
        let v = 0;
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

    /** The board from player 0's side: life, cards in hand, lands, every
     *  creature's body and keywords, the other permanents, and for every
     *  creature able to attack what the defender could put in front of it. */
    function evaluate() {
        // Its own layer pass, as the engine's evaluation opens one
        // (`beginLayer7Pass`), not the last settle pass's numbers.
        computeCharacteristics();
        const n = W[H_NPERM];
        let score = 0;
        for (let pl = 0; pl < 2; pl++) {
            const at = PL + pl * PL_W;
            const opp = 1 - pl;
            let v = W[at + PL_LIFE] * 40 + W[at + PL_HAND] * 60;
            if (W[at + PL_LOST] !== 0) v -= 100000;
            let evasive = 0;
            for (let s = 0; s < n; s++) {
                const d = W[P_DEF + s];
                if (d < 0 || W[P_CTRL + s] !== pl) continue;
                const type = D[d * D_W + D_TYPE];
                const tapped = W[P_TAPPED + s];
                if (type === T_LAND) {
                    v += tapped === 0 ? 35 : 30;
                } else if (type === T_CREATURE) {
                    const p = cP[s];
                    const kw = cK[s];
                    const sick = W[P_SICK + s];
                    v += 40 + 25 * p + 15 * cT[s] - 5 * W[P_DAMAGE + s];
                    if (tapped !== 0) v -= 5;
                    if (sick !== 0) v -= 3;
                    v += keywordValue(kw);
                    if (
                        tapped === 0 &&
                        sick === 0 &&
                        (kw & KW_DEFENDER) === 0 &&
                        p > 0
                    ) {
                        // The sturdiest untapped creature the defender could
                        // block this one with.
                        let wall = -1;
                        for (let o = 0; o < n; o++) {
                            const od = W[P_DEF + o];
                            if (od < 0 || W[P_CTRL + o] !== opp) continue;
                            if (D[od * D_W + D_TYPE] !== T_CREATURE) continue;
                            if (W[P_TAPPED + o] !== 0) continue;
                            if (
                                (kw & KW_FLYING) !== 0 &&
                                (cK[o] & (KW_FLYING | KW_REACH)) === 0
                            ) {
                                continue;
                            }
                            const left = cT[o] - W[P_DAMAGE + o];
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
            score += pl === 0 ? v : -v;
        }
        return score;
    }

    // -- the probe -----------------------------------------------------------

    function probe(m) {
        W.set(BASE);
        applyMove(MOVES[m * 3], MOVES[m * 3 + 1], MOVES[m * 3 + 2]);
        settle();
        return evaluate();
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
                W.set(BASE);
                if (phases > 1) {
                    applyMove(MOVES[m * 3], MOVES[m * 3 + 1], MOVES[m * 3 + 2]);
                }
                if (phases > 2) settle();
                acc = (acc + (phases > 3 ? evaluate() : W[H_NPERM])) | 0;
            }
        }
        return acc;
    }

    /** The work state after probe `m`, for the runner's sanity readings. */
    function inspect(m) {
        probe(m);
        return W;
    }

    return { load, probe, run, runUpTo, inspect };
}
