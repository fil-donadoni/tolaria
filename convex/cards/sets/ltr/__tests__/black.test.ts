// LTR (The Lord of the Rings: Tales of Middle-earth) — black card behavior
// tests (ADR 0043 colour split). Each describe block cites the CR section it
// exercises.
//
// Orcish Bowmasters is the catalogue's first Amass source (CR 701.47) and the
// first consumer of `CardDrawnEvent.isTurnBasedDrawStepDraw` (CR 504.1), so
// this file carries BOTH the per-card assertions and the keyword action's own
// CR-conformance tests — everything drives the real interpreter through
// `resolveTopOfStack`, never a hand-built view.

import { describe, it, expect } from "vitest";
import { orcishBowmasters } from "../black";
import { amassOps, makeArmyTokenSpec } from "../../../abilities/amass";
import { getCardByName } from "../../../index";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    drawCard,
    emitCardDrawn,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { advancePhase } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

const SQUIRE_ID = getCardByName("Squire").id;

function libraryCards(n: number, ownerId: string, prefix: string) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(SQUIRE_ID, {
            id: `${prefix}-${i}`,
            controllerId: ownerId,
            ownerId,
            zone: "library",
        })
    );
}

/** Board with Orcish Bowmasters already on p1's battlefield (no ETB trigger
 *  pending) and a stocked library for each player. */
function boardWithBowmasters(overrides: Partial<GameState> = {}) {
    const bowmasters = makeInstance(orcishBowmasters.id, {
        id: "bowmasters",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [bowmasters],
                library: libraryCards(5, "p1", "p1lib"),
            }),
            makePlayer("p2", { library: libraryCards(5, "p2", "p2lib") }),
        ],
        ...overrides,
    });
    return { state, bowmasters };
}

/** Announces the trigger's "any target" (CR 601.2c) through the real
 *  CR 603.3d machinery, then resolves it. */
function announceTargetAndResolve(
    state: GameState,
    target: { type: "player" | "permanent"; id: string }
) {
    if (raiseTriggerTargetSelection(state)) {
        state.pendingTarget!.selected = [target];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
    }
    resolveTopOfStack(state);
}

/** A real draw through the engine's CARD_DRAWN choke point, flagged as an
 *  effect-driven draw (NOT the draw step's turn-based draw, CR 504.1). */
function effectDraw(state: GameState, drawingPlayerId: string) {
    const player = state.players.find((p) => p.id === drawingPlayerId)!;
    if (drawCard(player) !== null) {
        emitCardDrawn(state, drawingPlayerId, 1, false);
    }
    processPendingActionTriggers(state);
}

function armiesOf(state: GameState, playerId: string): CardInstanceState[] {
    return state.players
        .find((p) => p.id === playerId)!
        .battlefield.filter((c) => c.subtypes.includes("Army"));
}

// ---------------------------------------------------------------------------
// Orcish Bowmasters — {1}{B} Creature — Orc Archer, 1/1. "Flash. When this
// creature enters and whenever an opponent draws a card except the first one
// they draw in each of their draw steps, this creature deals 1 damage to any
// target. Then amass Orcs 1." (Issue #2374.)
// ---------------------------------------------------------------------------
describe("Orcish Bowmasters (CR 603.2 multi-event trigger + CR 701.47 amass)", () => {
    it("the ETB half fires, pings the chosen target and amasses Orcs 1 (CR 603.2 / 701.47a)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: libraryCards(3, "p1", "p1lib") }),
                makePlayer("p2", { library: libraryCards(3, "p2", "p2lib") }),
            ],
        });
        pushSpell(state, orcishBowmasters.id, "p1");
        resolveTopOfStack(state); // the creature spell resolves and enters
        processPendingActionTriggers(state);

        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "orcish-bowmasters-volley"
            )
        ).toBe(true);

        announceTargetAndResolve(state, { type: "player", id: "p2" });

        expect(state.players[1].life).toBe(19);
        const armies = armiesOf(state, "p1");
        expect(armies).toHaveLength(1);
        // CR 701.47a — a 0/0 black [Orc] Army token with one +1/+1 counter.
        expect(armies[0].subtypes).toEqual(
            expect.arrayContaining(["Orc", "Army"])
        );
        expect(armies[0].types).toContain("Creature");
        expect(getEffectivePower(state, armies[0])).toBe(1);
        expect(getEffectiveToughness(state, armies[0])).toBe(1);
    });

    it("an opponent's non-draw-step draw re-fires both halves and grows the SAME Army — no second token (CR 701.47a)", () => {
        const { state } = boardWithBowmasters();

        effectDraw(state, "p2");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "orcish-bowmasters-volley"
            )
        ).toBe(true);
        announceTargetAndResolve(state, { type: "player", id: "p2" });
        expect(state.players[1].life).toBe(19);
        expect(armiesOf(state, "p1")).toHaveLength(1);

        effectDraw(state, "p2");
        announceTargetAndResolve(state, { type: "player", id: "p2" });
        expect(state.players[1].life).toBe(18);

        // CR 701.47a — the second amass found an Army already, so it added a
        // counter to it instead of creating a second token.
        const armies = armiesOf(state, "p1");
        expect(armies).toHaveLength(1);
        expect(getEffectivePower(state, armies[0])).toBe(2);
        expect(getEffectiveToughness(state, armies[0])).toBe(2);
    });

    it("does NOT fire on the opponent's turn-based draw-step draw (CR 504.1 — 'except the first one they draw in each of their draw steps')", () => {
        // p2's turn, upkeep; advancing runs p2's draw step for real.
        const { state } = boardWithBowmasters({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "UPKEEP",
            turn: 2,
        });

        advancePhase(state); // UPKEEP -> DRAW (turn-based draw happens here)

        expect(state.phase).toBe("DRAW");
        expect(state.players[1].hand).toHaveLength(1); // p2 really drew
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "orcish-bowmasters-volley"
            )
        ).toBe(false);
        expect(armiesOf(state, "p1")).toHaveLength(0);

        // …but a SECOND draw in that same draw step is not exempt.
        effectDraw(state, "p2");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "orcish-bowmasters-volley"
            )
        ).toBe(true);
    });

    it("does NOT fire on its own controller's draw (the trigger is opponent-scoped)", () => {
        const { state } = boardWithBowmasters();
        effectDraw(state, "p1");
        expect(state.stack).toHaveLength(0);
        expect(armiesOf(state, "p1")).toHaveLength(0);
    });

    it("wire format: the Army token's subtypes and counter-derived P/T survive projectPublicState (issue #1305 / CR 111)", () => {
        const { state } = boardWithBowmasters();
        effectDraw(state, "p2");
        announceTargetAndResolve(state, { type: "player", id: "p2" });

        const army = armiesOf(state, "p1")[0];
        expect(getEffectivePower(state, army)).toBe(1);

        const projected = projectPublicState(state, 1, "p1");
        const slimArmy = projected.players[0].battlefield.find(
            (c) => c.id === army.id
        )!;
        expect(slimArmy.subtypes).toEqual(
            expect.arrayContaining(["Orc", "Army"])
        );
        expect(getEffectivePower(projected, slimArmy)).toBe(1);
        expect(getEffectiveToughness(projected, slimArmy)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Amass (CR 701.47) — the keyword action itself, driven through Orcish
// Bowmasters (the catalogue's only amass source today).
// ---------------------------------------------------------------------------
describe("Amass [subtype] N (CR 701.47a)", () => {
    it("the Army token spec is a 0/0 black [subtype] Army creature (CR 701.47a)", () => {
        const spec = makeArmyTokenSpec("Orc");
        // Asserted through the real token creation path, not by reading the
        // spec back: the token's characteristics only matter once a permanent
        // carries them.
        const { state } = boardWithBowmasters();
        effectDraw(state, "p2");
        announceTargetAndResolve(state, { type: "player", id: "p2" });
        const army = armiesOf(state, "p1")[0];
        expect(army.card.id).toBeDefined();
        expect(army.subtypes).toEqual(expect.arrayContaining(spec.subtypes!));
        expect(getEffectivePower(state, army)).toBe(1); // 0 base + 1 counter
    });

    it("with 2+ Armies the controller CHOOSES which one grows, and it gains the amass subtype (CR 701.47a)", () => {
        const { state } = boardWithBowmasters();
        // Two pre-existing Armies, neither of them an Orc: the CR 701.47a
        // "choose an Army creature you control" + "if it isn't a [subtype], it
        // becomes a [subtype]" clauses both bite here.
        const armyA = makeInstance(SQUIRE_ID, {
            id: "army-a",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Army"],
        });
        const armyB = makeInstance(SQUIRE_ID, {
            id: "army-b",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Army"],
        });
        state.players[0].battlefield.push(armyA, armyB);

        effectDraw(state, "p2");
        announceTargetAndResolve(state, { type: "player", id: "p2" });

        // The resolution suspended on the CR 701.47a amass Army choice.
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("choose-permanents");
        expect(choice?.playerId).toBe("p1");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: choice!.stackItemId,
            step: choice!.step,
            choiceId: choice!.choiceId,
            cardInstanceIds: ["army-b"],
        });

        // No token was created (an Army was already controlled), and only the
        // CHOSEN Army grew and became an Orc.
        const bf = state.players[0].battlefield;
        expect(bf.filter((c) => c.subtypes.includes("Army"))).toHaveLength(2);
        const grown = bf.find((c) => c.id === "army-b")!;
        const untouched = bf.find((c) => c.id === "army-a")!;
        expect(grown.subtypes).toContain("Orc");
        expect(untouched.subtypes).not.toContain("Orc");
        expect(getEffectivePower(state, grown)).toBe(
            getEffectivePower(state, untouched) + 1
        );
    });

    it("raises NO prompt when the choice is forced (a single Army) — CR 701.47a's choice is only a choice when there are 2+", () => {
        const { state } = boardWithBowmasters();
        effectDraw(state, "p2");
        announceTargetAndResolve(state, { type: "player", id: "p2" });
        // One Army existed after the token step, so the pick was forced.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(armiesOf(state, "p1")).toHaveLength(1);
    });

    it("amassOps is parametrized by subtype and N — the script names them, no card-shaped logic", () => {
        const ops = amassOps("Zombie", 3);
        const json = JSON.stringify(ops);
        expect(json).toContain("Zombie Army");
        expect(json).toContain('"count":3');
        // No new Op: every Op name in the script is an already-shipped one.
        expect(ops.map((o) => o.op)).toEqual(["if", "if"]);
    });
});
