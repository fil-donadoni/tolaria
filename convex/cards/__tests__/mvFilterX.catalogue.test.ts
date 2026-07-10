// Catalogue guard for the X-dependent target-legality castability gate
// (CR 107.3 / 202.3). A spell whose legal targets ride an X-parametrized mana
// value (`targetRequirement.mvFilter` using the `"X"` placeholder — Dominate
// `{ max: "X" }`, Detonate / Spell Blast `{ equals: "X" }`) must be judged
// castable whenever ANY reachable X exposes a legal target, not only X = 0.
// The gate (`hasEnoughLegalTargets` via `getLegalActions`) once resolved the
// filter at X = 0 alone, so such a spell was dead in hand unless a mana-value-0
// target happened to exist — a whole bug CLASS, not one card.
//
// This sweep is data-driven over the WHOLE registry: any current or FUTURE card
// declaring an X-dependent `mvFilter` is picked up automatically. For each it
// asserts two things:
//   1. Structural — the gate's X-probing detector (`mvFilterUsesX`) recognises
//      the requirement, so the probing branch is taken and never silently
//      regresses to the X = 0 pass.
//   2. Behavioural — with a legal target reachable only by RAISING X, and
//      enough mana to reach it, the cast is offered; with mana capping X below
//      the target's mana value, it is NOT (proving the gate neither ignores X
//      nor over-offers).
// A target shape the harness can't scenario-ize is reported as an explicit
// skip-with-reason (never a silent pass) — the signal to extend this harness.

import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import { getLegalActions, mvFilterUsesX } from "../../gre/rules";
import { manaValue } from "../../gre/constants";
import type { CardDefinition, TargetRequirement } from "../types";
import type { CardInstanceState, GameState } from "../../gre/state";
import { plains, island, swamp, mountain, forest } from "../sets/lea/colorless";
import { makeInstance, makePlayer, makeState, pushSpell } from "./setup";

const BASIC_BY_COLOR: Record<string, CardDefinition> = {
    W: plains,
    U: island,
    B: swamp,
    R: mountain,
    G: forest,
};

/** The registry cards whose spell target legality rides an X-dependent mana
 *  value. `count: "X"` spells (Fireball et al.) are a different gate and never
 *  enter here — only an X-parametrized `mvFilter` does. */
const mvFilterXCards = getAllCards().filter(
    (c) =>
        (c.targetRequirement && mvFilterUsesX(c.targetRequirement)) ||
        (c.kickedTargetRequirement && mvFilterUsesX(c.kickedTargetRequirement))
);

/** Normalizes a requirement's `type` to the single token the harness dispatches
 *  on: `"spell"` for stack targets, otherwise the first permanent card type. */
function targetShape(req: TargetRequirement): string {
    const t = req.type;
    const list = Array.isArray(t) ? t : [t];
    if (list.includes("spell")) return "spell";
    return list[0] as string;
}

/** Smallest-mana-value registered permanent of card type `type` with mv ≥ 1
 *  (mv 0 can't force X to rise). Data-driven so a future target type is picked
 *  up without editing the harness. Returns null when none exists. */
function findPermanentFiller(type: string): CardDefinition | null {
    let best: CardDefinition | null = null;
    let bestMv = Infinity;
    for (const c of getAllCards()) {
        if (!c.types.includes(type as CardDefinition["types"][number]))
            continue;
        if (c.types.includes("Land")) continue; // lands have no mana value to gate on
        const mv = manaValue(c.manaCost);
        if (mv < 1) continue;
        if (mv < bestMv) {
            best = c;
            bestMv = mv;
        }
    }
    return best;
}

/** Any registered nonland spell with mv ≥ 1 — the filler pushed on the stack
 *  for a `"spell"`-target requirement. */
function findSpellFiller(): CardDefinition | null {
    let best: CardDefinition | null = null;
    let bestMv = Infinity;
    for (const c of getAllCards()) {
        if (c.types.includes("Land")) continue;
        const mv = manaValue(c.manaCost);
        if (mv < 1) continue;
        if (mv < bestMv) {
            best = c;
            bestMv = mv;
        }
    }
    return best;
}

/** Lands that let `controllerId` pay the colored portion of `cost` plus
 *  `genericSlots` generic mana (fixed generic + the desired X). Colored pips get
 *  matching basics; generic gets extra Islands (a {U} source pays a generic
 *  slot). */
function landsForCast(
    controllerId: string,
    cost: Record<string, number>,
    genericSlots: number
): CardInstanceState[] {
    const lands: CardInstanceState[] = [];
    let idx = 0;
    const push = (def: CardDefinition) =>
        lands.push(
            makeInstance(def.id, {
                id: `${controllerId}-land-${idx++}`,
                controllerId,
                ownerId: controllerId,
            })
        );
    for (const c of ["W", "U", "B", "R", "G"]) {
        for (let i = 0; i < (cost[c] ?? 0); i++) push(BASIC_BY_COLOR[c]);
    }
    for (let i = 0; i < genericSlots; i++) push(island);
    return lands;
}

/** Normalizes a card's printed cost to `{ colored…, X: fixedGeneric }` at X = 0
 *  — the fixed portion the caster always pays. */
function fixedCostOf(def: CardDefinition): Record<string, number> {
    const raw = def.manaCost ?? {};
    const out: Record<string, number> = {};
    for (const c of ["W", "U", "B", "R", "G", "C"]) {
        const n = (raw as Record<string, unknown>)[c];
        if (typeof n === "number" && n > 0) out[c] = n;
    }
    const genericKey = (raw as Record<string, unknown>).generic;
    const numericX = (raw as Record<string, unknown>).X;
    out.X =
        (typeof genericKey === "number" ? genericKey : 0) +
        (typeof numericX === "number" ? numericX : 0);
    return out;
}

describe("X-dependent mvFilter castability gate (bug class, CR 107.3 / 202.3)", () => {
    it("the registry actually contains X-dependent mvFilter cards to guard", () => {
        // Guards the guard: if this drops to 0 the sweep below silently tests
        // nothing (a registry rename / filter regression), so pin it.
        expect(mvFilterXCards.length).toBeGreaterThan(0);
    });

    for (const card of mvFilterXCards) {
        describe(`${card.name} (${card.id.slice(0, 8)})`, () => {
            const baseReq = card.targetRequirement;
            const usesXOnBase = baseReq && mvFilterUsesX(baseReq);

            it("gate detector recognises the X-dependent mvFilter (structural)", () => {
                const req = usesXOnBase
                    ? baseReq!
                    : card.kickedTargetRequirement!;
                expect(mvFilterUsesX(req)).toBe(true);
            });

            if (!usesXOnBase) {
                it.skip("behavioural scenario (X-dependent mvFilter is on the KICKED requirement — harness covers base only)", () => {});
                return;
            }

            const shape = targetShape(baseReq!);
            const fixed = fixedCostOf(card);

            // Build a caster + a target reachable only by raising X, then the
            // same board with mana capping X at 0.
            const buildState = (
                targetMv: number,
                affordable: boolean,
                placeTarget: (
                    state: GameState,
                    fillerId: string,
                    opponentId: string
                ) => void,
                filler: CardDefinition
            ): { state: GameState; casterCard: CardInstanceState } => {
                const desiredX = affordable ? targetMv : 0;
                const casterCard = makeInstance(card.id, {
                    id: "subject",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                });
                // Generic slots = fixed generic + the X we want reachable.
                const lands = landsForCast(
                    "p1",
                    fixed,
                    (fixed.X ?? 0) + desiredX
                );
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [casterCard],
                            battlefield: lands,
                        }),
                        makePlayer("p2"),
                    ],
                    activePlayerId: "p1",
                    priorityPlayerId: "p1",
                    phase: "PRECOMBAT_MAIN",
                });
                placeTarget(state, filler.id, "p2");
                return { state, casterCard };
            };

            // How to seat the target for this requirement shape: push a spell on
            // the stack, or sit a permanent on the opponent's board.
            const place: (s: GameState, fid: string, oid: string) => void =
                shape === "spell"
                    ? (s, fid, oid) => {
                          pushSpell(s, fid, oid);
                      }
                    : (s, fid, oid) => {
                          s.players[1].battlefield.push(
                              makeInstance(fid, {
                                  id: "filler",
                                  controllerId: oid,
                                  ownerId: oid,
                              })
                          );
                      };

            const filler =
                shape === "spell"
                    ? findSpellFiller()
                    : findPermanentFiller(shape);

            if (!filler) {
                it.skip(`behavioural scenario (no registered ${shape} filler with mv ≥ 1 — extend the harness)`, () => {});
                return;
            }
            const targetMv = manaValue(filler.manaCost);

            it(`is castable when X is raised to reach an mv-${targetMv} ${shape} target`, () => {
                const { state, casterCard } = buildState(
                    targetMv,
                    true,
                    place,
                    filler
                );
                expect(
                    getLegalActions(state, state.players[0], casterCard)
                ).toContain("cast");
            });

            it("is NOT castable when mana caps X below the target's mana value", () => {
                const { state, casterCard } = buildState(
                    targetMv,
                    false,
                    place,
                    filler
                );
                expect(
                    getLegalActions(state, state.players[0], casterCard)
                ).not.toContain("cast");
            });
        });
    }
});
