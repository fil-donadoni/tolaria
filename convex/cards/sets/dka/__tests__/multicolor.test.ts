// Dark Ascension (DKA) — multicolor behavior tests (ADR 0043 colour split).
//
// Sorin, Lord of Innistrad's −6 (issue #1469, closing #1227):
//   "Destroy up to three target creatures and/or other planeswalkers. Return
//    each card put into a graveyard this way to the battlefield under your
//    control."
// Two things get pinned here that the per-Op interpreter suite cannot:
//  1. the "OTHER planeswalkers" self-exclusion, asserted at BOTH ends of the
//     single-authority target path (`getLegalTargets` == the `selectTarget`
//     filter gate) — a UI-only filter is the known bug class;
//  2. the destroy→return linkage end to end through `resolveTopOfStack`,
//     including its load-bearing negative (an indestructible target survives,
//     so there is nothing to return).

import { describe, it, expect } from "vitest";
import { sorinLordOfInnistrad } from "../multicolor";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getLegalTargets,
    pendingTargetFiltersFromRequirement,
} from "../../../../gre/rules";
import { checkPermanentTargetFilters } from "../../../../gre/targetFilters";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";
import type { TargetSelection } from "../../../types";

const MINUS6 = "sorin-lord-of-innistrad-minus6";

const minus6 = () =>
    sorinLordOfInnistrad.activatedAbilities!.find((a) => a.id === MINUS6)!;

/** A vanilla 2/2 creature instance (Sorin's own card id is only used as an
 *  art/definition handle here — the tests assert on zones and ids, not P/T). */
function creature(id: string, controllerId: string, extra = {}) {
    return makeInstance(sorinLordOfInnistrad.id, {
        id,
        controllerId,
        ownerId: controllerId,
        ...extra,
    });
}

function sorinOnBattlefield(loyalty = 6) {
    return makeInstance(sorinLordOfInnistrad.id, {
        id: "sorin1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes Sorin's −6 on the stack with the given announced targets and
 *  resolves it through the real path. */
function activateMinus6(state: GameState, targets: TargetSelection[]) {
    const sorin = state.players[0].battlefield.find((c) => c.id === "sorin1")!;
    state.stack.push({
        ...sorin,
        zone: "stack",
        castById: "p1",
        abilityId: MINUS6,
        targets,
    });
    resolveTopOfStack(state);
}

describe("Sorin, Lord of Innistrad — −6 self-exclusion (CR 601.2c, issue #1469)", () => {
    it("declares a dynamic requirement excluding its own instance id", () => {
        const sorin = sorinOnBattlefield();
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [sorin] })],
        });
        const req = minus6().getTargetRequirement!(sorin, state);
        expect(req.excludeInstanceIds).toEqual(["sorin1"]);
        expect(req.type).toEqual(["Creature", "Planeswalker"]);
        expect(req.count).toEqual({ min: 0, max: 3 });
    });

    it("getLegalTargets offers other planeswalkers but NOT Sorin itself", () => {
        const sorin = sorinOnBattlefield();
        const other = makeInstance(sorinLordOfInnistrad.id, {
            id: "pw2",
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sorin] }),
                makePlayer("p2", { battlefield: [other] }),
            ],
        });
        const req = minus6().getTargetRequirement!(sorin, state);
        const legal = getLegalTargets(
            state,
            req,
            [],
            "p1",
            undefined,
            sorinLordOfInnistrad.types,
            sorinLordOfInnistrad.subtypes,
            false
        );
        const ids = legal.map((t) => ("id" in t ? t.id : ""));
        expect(ids).toContain("pw2");
        expect(ids).not.toContain("sorin1");
    });

    it("the selectTarget filter gate rejects Sorin itself — offered == accepted", () => {
        const sorin = sorinOnBattlefield();
        const other = makeInstance(sorinLordOfInnistrad.id, {
            id: "pw2",
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sorin] }),
                makePlayer("p2", { battlefield: [other] }),
            ],
        });
        const req = minus6().getTargetRequirement!(sorin, state);
        // The SAME carry `announceAbility` performs into `pendingTarget`, so
        // this is literally the gate `selectTarget` runs (no hand-built view).
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        const ctx = {
            state,
            chooserId: "p1",
            activePlayerId: state.activePlayerId,
            sourceColors: [],
            sourceTypes: sorinLordOfInnistrad.types,
            sourceSubtypes: sorinLordOfInnistrad.subtypes ?? [],
        };
        expect(
            checkPermanentTargetFilters(ctx, sorin, {
                excludeInstanceIds: pt.excludeInstanceIds,
            })
        ).not.toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, other, {
                excludeInstanceIds: pt.excludeInstanceIds,
            })
        ).toBeNull();
    });
});

describe("Sorin, Lord of Innistrad — −6 destroy-then-return (CR 400.7 / 608.2b, issue #1469)", () => {
    it("returns each destroyed creature to the battlefield under Sorin's controller (wire format)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sorinOnBattlefield()] }),
                makePlayer("p2", {
                    battlefield: [creature("a", "p2"), creature("b", "p2")],
                }),
            ],
        });
        activateMinus6(state, [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        const mine = state.players[0].battlefield.map((c) => c.id);
        expect(mine).toContain("a");
        expect(mine).toContain("b");
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([]);
        // CR 800.4a — owner stays p2, controller becomes p1.
        const a = state.players[0].battlefield.find((c) => c.id === "a")!;
        expect(a.controllerId).toBe("p1");
        expect(a.ownerId).toBe("p2");
        // The reanimated permanents are board-visible: assert through the wire.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield.map((c) => c.id)).toEqual(
            expect.arrayContaining(["a", "b"])
        );
        expect(projected.players[1].battlefield.map((c) => c.id)).toEqual([]);
    });

    it("does NOT return an indestructible target — it never reached a graveyard (CR 702.12 / 608.2b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sorinOnBattlefield()] }),
                makePlayer("p2", {
                    battlefield: [
                        creature("a", "p2"),
                        creature("ind", "p2", {
                            staticAbilities: ["indestructible"],
                        }),
                    ],
                }),
            ],
        });
        activateMinus6(state, [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "ind" },
        ]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("a");
        // The survivor stays where it was, under its own controller — it is
        // neither destroyed nor stolen by the return clause.
        const survivor = state.players[1].battlefield.find(
            (c) => c.id === "ind"
        );
        expect(survivor).toBeDefined();
        expect(survivor?.controllerId).toBe("p2");
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "ind"
        );
    });

    it("no-ops on unfilled target slots (up to three, CR 608.2b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sorinOnBattlefield()] }),
                makePlayer("p2", { battlefield: [creature("a", "p2")] }),
            ],
        });
        expect(() =>
            activateMinus6(state, [{ type: "permanent", id: "a" }])
        ).not.toThrow();
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("a");
    });
});
