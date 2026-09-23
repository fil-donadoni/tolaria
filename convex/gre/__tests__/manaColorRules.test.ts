// Until-end-of-turn mana colour rules (issue #3811) — the permanent test of the
// `replaceManaProductionColor` (CR 614.1a / 106.3) and `grantManaSubstitution`
// (CR 609.4b) Ops, shipped on False Dawn.
//
//  1. **Grammar** — the two Oracle sentence forms compile to the two Ops, and
//     a scoped variant is refused rather than widened.
//  2. **Interpreter** — resolving False Dawn records both effects and draws.
//  3. **Production** — every production path turns coloured mana white for the
//     controller only; colourless passes through (CR 105.1).
//  4. **Spending** — white pays any coloured pip, and only white does.
//  5. **Wire + serialization** — the client sees the fields; they round-trip.
//  6. **Full path** — through the registered `tapUntap` / `announceCast` /
//     `selectTargets` mutations: a Mountain taps for {W}, which pays Lightning
//     Bolt's {R}.

import { describe, it, expect } from "vitest";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/fixtures";
import { falseDawn } from "../../cards/sets/apc/white";
import { darkRitual } from "../../cards/sets/lea/black";
import { lightningBolt } from "../../cards/sets/lea/red";
import { mountain, solRing } from "../../cards/sets/lea/colorless";
import {
    getManaSubstitutions,
    getPlayer,
    isManaCostCovered,
    resolveTopOfStack,
    type GameState,
} from "../state";
import {
    applyLandManaReplacement,
    replaceProducedManaColor,
} from "../constants";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import { announceCast, selectTargets, tapUntap } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { Id } from "../../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../__tests__/gameMutationHarness";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function board(): GameState {
    const library = Array.from({ length: 3 }, (_, i) =>
        makeInstance(mountain.id, {
            id: `lib${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                library,
                hand: [
                    makeInstance(lightningBolt.id, {
                        id: "bolt",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(mountain.id, {
                        id: "mtn",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(solRing.id, {
                        id: "ring",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                manaPool: { ...POOL0 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(mountain.id, {
                        id: "opp-mtn",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** `board()` with False Dawn cast by p1 and resolved. */
function afterFalseDawn(): GameState {
    const state = board();
    pushSpell(state, falseDawn.id, "p1");
    resolveTopOfStack(state);
    return state;
}

describe("grammar — the two sentence forms compile to the two Ops (CR 614.1a / 609.4b)", () => {
    it("False Dawn compiles back to its own effects", () => {
        const outcome = compileCard(
            oracleCard({
                name: "False Dawn",
                manaCost: "{1}{W}",
                typeLine: "Sorcery",
                oracleText: falseDawn.oracleText!,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.effects).toEqual(falseDawn.effects);
    });

    it("refuses a spend permission with a trailing scope rather than widening it", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Scoped Probe",
                manaCost: "{1}{W}",
                typeLine: "Sorcery",
                oracleText:
                    "Until end of turn, you may spend white mana as though it were mana of any color to cast creature spells.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("resolving the Ops records both until-end-of-turn effects", () => {
    it("False Dawn installs the replacement and the permission, and draws", () => {
        const state = afterFalseDawn();
        expect(state.manaProductionColorThisTurn).toEqual({ p1: "W" });
        expect(state.manaSubstitutionGrantsThisTurn).toEqual({
            p1: [{ from: "W", breadth: "any-color" }],
        });
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toContain("lib0");
    });
});

describe("production — coloured mana becomes white for the controller only (CR 614.1a / 106.3)", () => {
    it("a Mountain tapped by the controller adds {W}", () => {
        const state = afterFalseDawn();
        const mtn = getPlayer(state, "p1").battlefield[0];
        expect(applyLandManaReplacement(state, "p1", mtn, { R: 1 })).toEqual({
            W: 1,
        });
    });

    it("colourless is not coloured (CR 105.1): Sol Ring still adds {C}{C}", () => {
        const state = afterFalseDawn();
        const ring = getPlayer(state, "p1").battlefield[1];
        expect(applyLandManaReplacement(state, "p1", ring, { C: 2 })).toEqual({
            C: 2,
        });
        expect(replaceProducedManaColor(state, "p1", { C: 1, G: 2 })).toEqual({
            C: 1,
            W: 2,
        });
    });

    it("the opponent's mana is untouched — keyed on the producing controller", () => {
        const state = afterFalseDawn();
        const oppMtn = getPlayer(state, "p2").battlefield[0];
        expect(applyLandManaReplacement(state, "p2", oppMtn, { R: 1 })).toEqual(
            { R: 1 }
        );
    });

    it("a ritual's addMana Op (SpellContext.addManaTo) is replaced too: Dark Ritual adds {W}{W}{W}", () => {
        const state = afterFalseDawn();
        pushSpell(state, darkRitual.id, "p1");
        resolveTopOfStack(state);
        const pool = getPlayer(state, "p1").manaPool;
        expect(pool.W).toBe(3);
        expect(pool.B).toBe(0);
    });
});

describe("spending — white as any colour, and only white (CR 609.4b)", () => {
    it("the controller's substitutions are exactly W → each colour", () => {
        const state = afterFalseDawn();
        const subs = getManaSubstitutions(state, "p1");
        expect(subs.every((s) => s.from === "W")).toBe(true);
        expect(subs.map((s) => s.to).sort()).toEqual(["B", "G", "R", "U"]);
        expect(getManaSubstitutions(state, "p2")).toEqual([]);
    });

    it("{W}{W} pays {R}{G}; {U}{U} still does not", () => {
        const state = afterFalseDawn();
        const subs = getManaSubstitutions(state, "p1");
        expect(isManaCostCovered({ W: 2 }, { R: 1, G: 1 }, subs)).toBe(true);
        expect(isManaCostCovered({ U: 2 }, { R: 1, G: 1 }, subs)).toBe(false);
        // any-color, not any-type: a {C} pip is not payable with white.
        expect(isManaCostCovered({ W: 1 }, { C: 1 }, subs)).toBe(false);
    });
});

describe("wire format + serialization", () => {
    it("the projection carries both fields to the client", () => {
        const projected = projectPublicState(afterFalseDawn(), 1, "p2");
        expect(projected.manaProductionColorThisTurn).toEqual({ p1: "W" });
        expect(projected.manaSubstitutionGrantsThisTurn).toEqual({
            p1: [{ from: "W", breadth: "any-color" }],
        });
    });

    it("both fields round-trip compactState → expandState", () => {
        const restored = expandState(compactState(afterFalseDawn()));
        expect(restored.manaProductionColorThisTurn).toEqual({ p1: "W" });
        expect(restored.manaSubstitutionGrantsThisTurn).toEqual({
            p1: [{ from: "W", breadth: "any-color" }],
        });
    });
});

describe("full path — a Mountain taps for {W} and the {W} pays Lightning Bolt", () => {
    const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

    it("tapUntap → announceCast → selectTargets puts Bolt on the stack, paid in white", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(afterFalseDawn()),
        ]);
        await runMutation(
            tapUntap as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: "mtn" }
        );
        const tapped = harness.state();
        expect(getPlayer(tapped, "p1").manaPool).toMatchObject({ W: 1, R: 0 });
        // The wire view shows what the player now has: white, not red.
        const projected = projectPublicState(tapped, 1, "p1");
        expect(
            projected.players.find((p) => p.id === "p1")?.manaPool
        ).toMatchObject({ W: 1, R: 0 });

        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: "bolt" }
        );
        await runMutation(
            selectTargets as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, targets: [{ targetType: "player", targetId: "p2" }] }
        );
        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((i) => i.card.id)).toEqual([lightningBolt.id]);
        expect(getPlayer(state, "p1").manaPool.W).toBe(0);
    });
});
