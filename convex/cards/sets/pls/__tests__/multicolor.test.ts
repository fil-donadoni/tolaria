// Planeshift (PLS) — multicolor behavior tests (ADR 0043 colour split, issue
// #1944).
//
// Keldon Twilight is a DSL card, but it introduces a genuinely new construct
// combination the auto-generated canned-scenario smoke sweep cannot drive: a
// CR 603.4 intervening-if reading the new game-level
// `creatureAttackedThisTurn` flag, and a new `EffectCardFilter` clause
// (`controlledSinceTurnStart`) whose truth depends on turn-scoped state the
// generator has no way to arrange. Per the per-Op regime
// (`.claude/rules/gre-development.md`) that earns hand-written coverage here,
// including the wire-format leg — the sacrifice picker's legality is read
// CLIENT-side off projected fields, so a projection that dropped them would
// leave the card correct on the server and dead on the board.

import { describe, it, expect } from "vitest";
import {
    cloudCover,
    crosissCharm,
    darigaazsCharm,
    dralnusCrusade,
    dromarsCharm,
    ertaiTheCorrupted,
    hullBreach,
    keldonTwilight,
    maliciousAdvice,
    marshCrocodile,
    meddlingMage,
    naturalEmergence,
    phyrexianTyranny,
    questingPhelddagrif,
    sawtoothLoon,
    trevasCharm,
    urzasGuilt,
    radiantKavu,
    rithsCharm,
} from "../multicolor";
import {
    grizzlyBears,
    savannahLions,
    controlMagic,
    ancestralRecall,
    blackLotus,
    forest,
    lightningBolt,
    monssGoblinRaiders,
    mountain,
    airElemental,
    blackKnight,
} from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    applyControlChange,
    applySourceStaticEffects,
    emitCardDrawn,
    processPendingActionTriggers,
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
    runDamageReplacement,
    sourcePreventionShieldApplies,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { getEffectiveColors } from "../../../effectiveColors";
import { castProhibitionReason } from "../../../castRestrictions";
import { announceCast } from "../../../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";
import type { Id } from "../../../../_generated/dataModel";
import { collectTriggers } from "../../../../gre/triggers";
import {
    applyMayPaySubmit,
    applyNameCardSubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import type { BecameTargetEvent, PhaseBeginEvent } from "../../../types";

const ABILITY = keldonTwilight.triggeredAbilities!.find(
    (a) => a.id === "keldon-twilight-end-step-sac"
)!;

const endStepEvent = (playerId: string): PhaseBeginEvent => ({
    type: "PHASE_BEGIN",
    phase: "END_STEP",
    activePlayerId: playerId,
});

/** Pushes Keldon Twilight's end-step trigger for `activePlayerId` and resolves
 *  it, exactly as the engine does (`resolveTopOfStack` runs the CR 603.4d
 *  intervening-if re-check before the body). */
function fireEndStep(
    state: GameState,
    source: CardInstanceState,
    activePlayerId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: ABILITY.id,
        triggerSourceId: source.id,
        triggerEvent: endStepEvent(activePlayerId),
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

/** Answers the head `sacrifice-permanents` choice through the REAL server
 *  submit path, so the pick is re-validated against the pending choice's
 *  filter (`effectivePermanentView` + `matchesPermanentFilter`). */
function submitSacrifice(state: GameState, cardInstanceId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [cardInstanceId],
    });
}

/** Board: Keldon Twilight under p1, one long-standing creature per player. */
function twoPlayerBoard(turn = 5) {
    const twilight = makeInstance(keldonTwilight.id, {
        id: "twilight",
        controllerId: "p1",
        ownerId: "p1",
    });
    const mine = makeInstance(grizzlyBears.id, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
    });
    mine.enteredOnTurn = 1;
    const theirs = makeInstance(savannahLions.id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
    });
    theirs.enteredOnTurn = 1;
    const state = makeState({
        turn,
        players: [
            makePlayer("p1", { battlefield: [twilight, mine] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
    return { state, twilight, mine, theirs };
}

describe("Keldon Twilight — trigger scope (CR 603.6a, 'each player's end step')", () => {
    it("fires on EACH player's end step, and the sacrificing player is that player", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const self = { ...twilight } as never;

        // p1's own end step.
        expect(ABILITY.matches!(endStepEvent("p1"), self, state)).toBe(true);
        fireEndStep(state, twilight, "p1");
        expect(state.pendingChoices![0].playerId).toBe("p1");
        submitSacrifice(state, mine.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);

        // p2's end step — the OPPONENT is asked, not Keldon Twilight's
        // controller. (`{ ref: "$event.activePlayerId" }`, not "controller".)
        const second = twoPlayerBoard().state;
        const twilight2 = second.players[0].battlefield[0];
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight2 as never, second)
        ).toBe(true);
        fireEndStep(second, twilight2, "p2");
        expect(second.pendingChoices![0].playerId).toBe("p2");
        submitSacrifice(second, "theirs");
        expect(second.players[1].graveyard.map((c) => c.id)).toEqual([
            "theirs",
        ]);
    });

    it("does not fire on other steps", () => {
        const { state, twilight } = twoPlayerBoard();
        expect(
            ABILITY.matches!(
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                } as PhaseBeginEvent,
                twilight as never,
                state
            )
        ).toBe(false);
    });
});

describe("Keldon Twilight — intervening-if 'if no creatures attacked this turn' (CR 603.4 / 603.4d)", () => {
    it("does not trigger at all once a creature has attacked this turn", () => {
        const { state, twilight } = twoPlayerBoard();
        state.creatureAttackedThisTurn = true;
        expect(
            ABILITY.matches!(endStepEvent("p1"), twilight as never, state)
        ).toBe(false);
    });

    it("fizzles on RESOLUTION if the condition became false after the trigger went on the stack (CR 603.4d)", () => {
        const { state, twilight } = twoPlayerBoard();
        state.stack.push({
            ...twilight,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: ABILITY.id,
            triggerSourceId: twilight.id,
            triggerEvent: endStepEvent("p1"),
            targets: [],
        } as StackItem);
        state.creatureAttackedThisTurn = true;
        resolveTopOfStack(state);
        // No sacrifice choice was ever raised and nothing died.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("counts ANY player's creatures — the OPPONENT attacking suppresses it too", () => {
        const { state, twilight } = twoPlayerBoard();
        // The flag is game-level, so an attack by p2's creature during p2's
        // turn silences the trigger on p2's own end step.
        state.creatureAttackedThisTurn = true;
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight as never, state)
        ).toBe(false);
        state.creatureAttackedThisTurn = undefined;
        expect(
            ABILITY.matches!(endStepEvent("p2"), twilight as never, state)
        ).toBe(true);
    });
});

describe("Keldon Twilight — '…that they controlled since the beginning of the turn'", () => {
    it("excludes a creature that ENTERED this turn", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const fresh = makeInstance(savannahLions.id, {
            id: "fresh",
            controllerId: "p1",
            ownerId: "p1",
        });
        fresh.enteredOnTurn = state.turn;
        state.players[0].battlefield.push(fresh);
        fireEndStep(state, twilight, "p1");
        // Only the long-standing creature is offered; picking the fresh one
        // is rejected by the server's own submit validation.
        expect(() => submitSacrifice(state, "fresh")).toThrow();
        submitSacrifice(state, mine.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
    });

    it("excludes a creature whose CONTROL changed this turn, in either direction", () => {
        const { state, twilight } = twoPlayerBoard();
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(magic);
        // p1 steals p2's long-standing creature this turn.
        applyControlChange(state, "theirs", "p1", "magic");
        // p1's own creature leaves via the same steal in reverse: give
        // "mine" to p2 as well so p1 has ONLY the freshly-stolen creature.
        applyControlChange(state, "mine", "p2", "magic");
        fireEndStep(state, twilight, "p1");
        // Nothing legal for p1 → no choice raised, nothing sacrificed.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(0);
        // …and p2, who now controls "mine", also may not sacrifice it: they
        // did not control it when the turn began.
        fireEndStep(state, twilight, "p2");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("does nothing (and does not throw) when the player controls no legal creature", () => {
        const { state, twilight } = twoPlayerBoard();
        state.players[0].battlefield = [twilight];
        fireEndStep(state, twilight, "p1");
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
        // The trigger still resolved off the stack — the player sees it come
        // and go under its own oracle text.
        expect(state.stack).toHaveLength(0);
    });

    it("is the controller's EXPLICIT choice — the picker is raised even with several legal creatures and nothing is auto-sacrificed", () => {
        const { state, twilight, mine } = twoPlayerBoard();
        const second = makeInstance(savannahLions.id, {
            id: "second",
            controllerId: "p1",
            ownerId: "p1",
        });
        second.enteredOnTurn = 1;
        state.players[0].battlefield.push(second);
        fireEndStep(state, twilight, "p1");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p1");
        expect(state.players[0].graveyard).toHaveLength(0);
        submitSacrifice(state, second.id);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["second"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            mine.id
        );
    });
});

describe("Keldon Twilight — wire format (the picker's legality is read client-side)", () => {
    it("the projection preserves the turn-scoped fields the client filter reads", () => {
        const { state, twilight } = twoPlayerBoard();
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(magic);
        applyControlChange(state, "theirs", "p1", "magic");
        state.creatureAttackedThisTurn = true;

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.turn).toBe(state.turn);
        expect(projected.controlChangedThisTurn).toEqual(["theirs"]);
        expect(projected.creatureAttackedThisTurn).toBe(true);
        const slimStolen = projected.players[0].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimStolen.enteredOnTurn).toBe(1);

        fireEndStep(state, twilight, "p1");
        // Suppressed by the intervening-if reading the projected-safe flag.
        expect(state.pendingChoices).toBeUndefined();
    });

    it("the raised choice carries the filter across the wire so the board can highlight it", () => {
        const { state, twilight } = twoPlayerBoard();
        fireEndStep(state, twilight, "p1");
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.filter).toMatchObject({
            types: "Creature",
            controlledSinceTurnStart: true,
        });
    });
});

// ---------------------------------------------------------------------------
// Phyrexian Tyranny (issue #1946) — "Whenever a player draws a card, that
// player loses 2 life unless they pay {2}." A DSL card, but `mayPay` always
// SUSPENDS on a live player decision (the auto-generated canned-scenario
// smoke sweep explicitly skips any script containing one,
// `gre/effects/scenarioGenerator.ts`), so per the per-Op regime this earns
// hand-written coverage. It is also the FIRST card to read `CARD_DRAWN`'s
// drawing player off the firing event (`{ ref: "$event.playerId" }`, the new
// `EVENT_FIELD_REGISTRY` row this issue adds) rather than `"controller"` —
// exactly the CR 117.3a "offered to the triggering player" gap.
// ---------------------------------------------------------------------------

const TYRANNY_ABILITY_ID = "phyrexian-tyranny-unless-pay";

function makeTyranny(
    controllerId: string,
    id = "tyranny"
): ReturnType<typeof makeInstance> {
    return makeInstance(phyrexianTyranny.id, {
        id,
        controllerId,
        ownerId: controllerId,
    });
}

/** Simulates a real draw (library → hand) and runs it through the engine's
 *  real CARD_DRAWN choke point — `processPendingActionTriggers` — exactly
 *  like the turn-based draw step drives it (mirrors the Sheoldred fixture in
 *  `dmu/__tests__/black.test.ts`). */
function simulateTyrannyDraw(state: GameState, drawingPlayerId: string): void {
    const player = state.players.find((p) => p.id === drawingPlayerId)!;
    const drawn = player.library.shift();
    if (drawn) player.hand.push(drawn);
    state.pendingEvents = [
        { type: "CARD_DRAWN", playerId: drawingPlayerId, count: 1 },
    ];
    processPendingActionTriggers(state);
}

/** Batch draw through the REAL per-card choke point (`emitCardDrawn`) —
 *  proves the per-card fanout (CR 120.3): a draw-N raises N separate
 *  CARD_DRAWN events, so Phyrexian Tyranny's per-card trigger fires N times,
 *  not once. */
function simulateTyrannyBatchDraw(
    state: GameState,
    drawingPlayerId: string,
    n: number
): void {
    const player = state.players.find((p) => p.id === drawingPlayerId)!;
    for (let i = 0; i < n; i++) {
        const drawn = player.library.shift();
        if (drawn) player.hand.push(drawn);
    }
    emitCardDrawn(state, drawingPlayerId, n);
    processPendingActionTriggers(state);
}

describe("Phyrexian Tyranny — offered to the DRAWING player, not the controller (CR 117.3a)", () => {
    it("an opponent's draw offers the may-pay decision to the OPPONENT", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-1" })],
                    life: 20,
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");

        expect(
            state.stack.some((s) => s.triggeredAbilityId === TYRANNY_ABILITY_ID)
        ).toBe(true);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2"); // the DRAWER, not Tyranny's controller
    });

    it("Tyranny's own controller drawing offers the decision to THEMSELVES too (CR 121.1 'a player', either player)", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tyranny],
                    library: [makeInstance(grizzlyBears.id, { id: "lib-2" })],
                    life: 20,
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });

        simulateTyrannyDraw(state, "p1");

        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
    });
});

describe("Phyrexian Tyranny — pay or lose 2 life (CR 117.3a / 119.3b)", () => {
    it("declining costs the drawing player 2 life", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-3" })],
                    life: 20,
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(20); // controller unaffected

        // Wire format — life totals are client-visible.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(18);
    });

    it("paying {2} costs the drawing player nothing further", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-4" })],
                    life: 20,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });

        expect(state.players[1].life).toBe(20); // no life lost
        expect(state.players[1].manaPool.C).toBe(0); // {2} spent

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players.find((p) => p.id === "p2")!.life).toBe(20);
    });

    it("a player who cannot pay {2} is presented the decision and simply loses 2 life on decline — never silently skipped", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-5" })],
                    life: 20,
                    // No mana available to pay {2}.
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        // The decision is still RAISED (shown), not auto-skipped for lack of
        // funds — attempting to accept with insufficient mana is rejected by
        // the server (`applyMayPaySubmit` throws), same as any other
        // unaffordable may-pay.
        expect(head.kind).toBe("may-pay");
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p2", accept: true })
        ).toThrow();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(18);
    });
});

describe("Phyrexian Tyranny — fires once per card drawn (CR 120.3)", () => {
    it("a draw-three (Ancestral Recall) raises THREE separate decisions, one per card", () => {
        const tyranny = makeTyranny("p1");
        const p2Library = Array.from({ length: 3 }, (_, i) =>
            makeInstance(grizzlyBears.id, { id: `p2-lib-${i}` })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", { library: p2Library, life: 20 }),
            ],
        });

        // Effect-driven draw: cast Ancestral Recall targeting the opponent.
        pushSpell(state, ancestralRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // resolveTopOfStack resolves the spell AND drains the resulting
        // pending CARD_DRAWN events into three separate stack triggers
        // (`processPendingActionTriggers` runs internally after resolution).
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(3);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === TYRANNY_ABILITY_ID
            )
        ).toHaveLength(3);

        // Resolve all three, declining every time: 3 separate 2-life losses.
        for (let i = 0; i < 3; i++) {
            expect(resolveTopOfStack(state)).toBeNull();
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("may-pay");
            expect(head.playerId).toBe("p2");
            applyMayPaySubmit(state, { playerId: "p2", accept: false });
        }
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].life).toBe(14); // 20 − 3×2
    });

    it("fires on the natural draw-step draw too, via the same CARD_DRAWN choke point", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-6" })],
                    life: 20,
                }),
            ],
        });

        // simulateTyrannyBatchDraw mirrors the turn-based draw step's own
        // path through `emitCardDrawn` — the SAME choke point an
        // effect-driven draw uses.
        simulateTyrannyBatchDraw(state, "p2", 1);
        expect(
            state.stack.filter(
                (s) => s.triggeredAbilityId === TYRANNY_ABILITY_ID
            )
        ).toHaveLength(1);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(18);
    });
});

describe("Phyrexian Tyranny — APNAP ordering when simultaneous (CR 603.3b)", () => {
    it("two Tyrannies under different controllers both trigger off one draw, in APNAP stack order", () => {
        const mine = makeTyranny("p1", "tyranny-mine");
        const theirs = makeTyranny("p2", "tyranny-theirs");
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [mine], life: 20 }),
                makePlayer("p2", {
                    battlefield: [theirs],
                    library: [makeInstance(grizzlyBears.id, { id: "lib-7" })],
                    life: 20,
                }),
            ],
        });

        const drawEvent = {
            type: "CARD_DRAWN" as const,
            playerId: "p2",
            count: 1,
        };
        const placed = collectTriggers(state, [drawEvent]);
        // Both permanents' abilities fire off the SAME "each" draw — APNAP
        // places the active player's (p1's) trigger first (underneath), the
        // non-active player's (p2's) on top, so the opponent's resolves
        // first (CR 603.3b).
        expect(placed).toHaveLength(2);
        expect(placed[0].triggerSourceId).toBe("tyranny-mine");
        expect(placed[1].triggerSourceId).toBe("tyranny-theirs");
        state.stack.push(...placed);

        // Top of stack (p2's Tyranny) resolves first.
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(18);

        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[1].life).toBe(16);

        expect(state.stack).toHaveLength(0);
    });
});

describe("Phyrexian Tyranny — wire format (the pending decision reaches the correct seat)", () => {
    it("the projected may-pay choice carries the DRAWING player's id, through the real reducer", () => {
        const tyranny = makeTyranny("p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyranny], life: 20 }),
                makePlayer("p2", {
                    library: [makeInstance(grizzlyBears.id, { id: "lib-8" })],
                    life: 20,
                }),
            ],
        });

        simulateTyrannyDraw(state, "p2");
        resolveTopOfStack(state);

        // Project for BOTH seats — the choice must reach p2 (the drawer),
        // not p1 (Tyranny's controller), on the wire.
        const projectedForP2 = projectPublicState(state, 1, "p2");
        const head = projectedForP2.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2");

        const projectedForP1 = projectPublicState(state, 1, "p1");
        expect(projectedForP1.pendingChoices![0].playerId).toBe("p2");
    });
});

// ────────────────────────────────────────────────────────────────────────────
// PLS free tranche — two-colour gold cards (issue #1953).
//
// Most of the slice is DSL cards reusing already-exercised Ops (`choice`,
// `forEach`, `moveZone`, `destroy`, `pump`, `tapUntap`, `discard`,
// `dealDamage`, `libraryLook`, `reveal`), so per the per-Op regime
// (`.claude/rules/gre-development.md`) they are covered catalogue-wide by
// `effectScripts.test.ts` + `effectScriptSmoke.test.ts` and need no
// hand-written test here.
//
// What DOES earn coverage below, and why:
//   * Natural Emergence / Dralnu's Crusade — `staticEffects[]`, the FULL
//     regime including the mandatory wire-format re-assertion.
//   * Sawtooth Loon — the `from: "hand"` → `to: "library"` `moveZone`
//     combination no shipped card exercised before (bottom of library).
//   * Cloud Cover — the new `EVENT_FIELD_REGISTRY.BECAME_TARGET` census row.
//   * Meddling Mage — a `resolveSteps` as-enters name choice feeding a
//     `cast-restriction` static, across the GRE → shared-cast-gate boundary.
//   * Hull Breach — the new `SpellMode.additionalTargetRequirements`, driven
//     through the REAL `announceCast` mutation, not a hand-built state.
// ────────────────────────────────────────────────────────────────────────────

/** Answers the head choice through the REAL server submit path. */
function submitChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Natural Emergence ({2}{R}{G} — lands you control are 2/2 first strikers and are still lands; CR 613/205, issue #1953)", () => {
    /** Board with one Mountain under `landController` plus Natural Emergence
     *  under p1, statics applied. */
    function animatedBoard(landController: "p1" | "p2") {
        const land = makeInstance(mountain.id, {
            id: "land-1",
            controllerId: landController,
            ownerId: landController,
            zone: "battlefield",
        });
        const ne = makeInstance(naturalEmergence.id, {
            id: "ne-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: landController === "p1" ? [land, ne] : [ne],
                }),
                makePlayer("p2", {
                    battlefield: landController === "p2" ? [land] : [],
                }),
            ],
        });
        applySourceStaticEffects(state, ne);
        return { state, land };
    }

    // CR 205 / 613 layer 4 — the Creature type is ADDED, never substituted.
    // "They're still lands" is exactly the clause a naive type-SET would break,
    // and it is what keeps the animated permanent tapping for mana.
    it("adds Creature to your lands WITHOUT removing Land, and makes them 2/2 first strikers", () => {
        const { state, land } = animatedBoard("p1");
        expect(land.types).toContain("Creature");
        expect(land.types).toContain("Land");
        expect(getEffectivePower(state, land)).toBe(2);
        expect(getEffectiveToughness(state, land)).toBe(2);
        expect(land.staticAbilities).toContain("first strike");
    });

    // "Lands YOU control" — unlike Living Lands' global "All Forests".
    it("leaves an opponent's lands alone", () => {
        const { land } = animatedBoard("p2");
        expect(land.types).not.toContain("Creature");
        expect(land.types).toContain("Land");
        expect(land.staticAbilities).not.toContain("first strike");
    });

    // MANDATORY wire-format leg: the client renders the animated land off the
    // PROJECTED state, so the same assertions must survive `projectPublicState`.
    it("survives the wire projection (P/T, keyword and both types)", () => {
        const { state, land } = animatedBoard("p1");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === land.id
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Land");
        expect(slim.staticAbilities).toContain("first strike");
        expect(getEffectivePower(projected as never, slim as never)).toBe(2);
        expect(getEffectiveToughness(projected as never, slim as never)).toBe(
            2
        );
    });
});

describe("Dralnu's Crusade ({1}{B}{R} — all Goblins get +1/+1, are black and are Zombies; CR 613, issue #1953)", () => {
    function goblinBoard(goblinController: "p1" | "p2") {
        const goblin = makeInstance(monssGoblinRaiders.id, {
            id: "goblin-1",
            controllerId: goblinController,
            ownerId: goblinController,
            zone: "battlefield",
        });
        const crusade = makeInstance(dralnusCrusade.id, {
            id: "crusade-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield:
                        goblinController === "p1"
                            ? [goblin, crusade]
                            : [crusade],
                }),
                makePlayer("p2", {
                    battlefield: goblinController === "p2" ? [goblin] : [],
                }),
            ],
        });
        applySourceStaticEffects(state, crusade);
        return { state, goblin };
    }

    it("pumps a Goblin +1/+1 and adds Zombie in addition to its other types", () => {
        const { state, goblin } = goblinBoard("p1");
        // Mons's Goblin Raiders is a printed 1/1 Goblin.
        expect(getEffectivePower(state, goblin)).toBe(2);
        expect(getEffectiveToughness(state, goblin)).toBe(2);
        expect(goblin.subtypes).toContain("Zombie");
        // "In addition to their other creature types" — Goblin is retained,
        // which is also what keeps the Crusade's own predicate matching.
        expect(goblin.subtypes).toContain("Goblin");
    });

    // "ALL Goblins", not "Goblins you control" (CR 109.4).
    it("applies to an OPPONENT's Goblins too", () => {
        const { state, goblin } = goblinBoard("p2");
        expect(getEffectivePower(state, goblin)).toBe(2);
        expect(goblin.subtypes).toContain("Zombie");
    });

    it("does not touch non-Goblin creatures", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const crusade = makeInstance(dralnusCrusade.id, {
            id: "crusade-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, crusade] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, crusade);
        expect(getEffectivePower(state, bear)).toBe(2); // printed 2/2, unbuffed
        expect(bear.subtypes).not.toContain("Zombie");
    });

    // MANDATORY wire-format leg — the anthem and the tribal retype are both
    // rendered client-side off the projected state.
    it("survives the wire projection (P/T buff and added subtype)", () => {
        const { state, goblin } = goblinBoard("p1");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        expect(getEffectivePower(projected as never, slim as never)).toBe(2);
        expect(getEffectiveToughness(projected as never, slim as never)).toBe(
            2
        );
        expect(slim.subtypes).toContain("Zombie");
        expect(slim.subtypes).toContain("Goblin");
    });

    // The COLOUR half of the wire leg (CR 613.1d layer 5). The engine writes
    // the grant onto `grantedColors`, but every colour consumer OUTSIDE
    // `gre/layers.ts` used to re-derive colours as `colorOverride ?? printed
    // cost` and drop it — the client's target/choice filters, the client-side
    // Brain's view, and the attack/cast restriction contexts. Asserted through
    // the real projection AND through the shared authority the client calls, so
    // a future copy of the derivation can't silently reintroduce the drop.
    it("the granted black survives the wire projection and reads black client-side", () => {
        const { state, goblin } = goblinBoard("p1");
        // Server-side first: the Goblin is BOTH its printed red and black
        // (additive grant, not a replacement).
        expect(getEffectiveColors(goblin as never)).toEqual(
            expect.arrayContaining(["R", "B"])
        );

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === goblin.id
        )!;
        // `slimCard` forwards the field (it only strips `card` / `knownTo`).
        expect(slim.grantedColors).toEqual([
            { color: "B", sourceId: "crusade-1" },
        ]);
        expect(getEffectiveColors(slim as never)).toEqual(
            expect.arrayContaining(["R", "B"])
        );
    });
});

describe("Sawtooth Loon ({2}{W}{U} — draw two, put two from hand on the BOTTOM of your library; CR 401.4, issue #1953)", () => {
    /** Casts Sawtooth Loon for real and drives BOTH of its ETB triggers to
     *  completion (CR 603.3b puts them on the stack in the controller's chosen
     *  order). Going through the real entry path — rather than hand-pushing one
     *  trigger — is what proves the two ETBs coexist, and it is the only way
     *  the drawn cards are genuinely in hand when the put-back choice opens.
     *
     *  Fixture: a Savannah Lions already on the battlefield gives the mandatory
     *  white-or-blue bounce a victim other than the Loon itself, so the Loon
     *  stays put and the filtering half is observed on a stable board. */
    function castLoon(): GameState {
        const lion = makeInstance(savannahLions.id, {
            id: "lion-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const library = ["lib-a", "lib-b", "lib-c"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const hand = ["hand-a", "hand-b"].map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion], hand, library }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sawtoothLoon.id, "p1");

        let guard = 0;
        while (guard++ < 30) {
            const head = state.pendingChoices?.[0];
            if (head) {
                if (head.kind === "trigger-order") {
                    resolveTriggerOrder(state);
                } else if (head.choiceId === "$bounce") {
                    submitChoice(state, ["lion-1"]);
                } else if (head.kind === "choose-hand-card") {
                    submitChoice(state, ["hand-a", "hand-b"]);
                } else {
                    throw new Error(`unexpected pending choice: ${head.kind}`);
                }
                continue;
            }
            if (state.stack.length === 0) break;
            resolveTopOfStack(state);
        }
        return state;
    }

    it("puts the two chosen cards on the BOTTOM of the library, not the top", () => {
        const state = castLoon();
        const p1 = state.players[0];
        // Drew two (lib-a, lib-b) and put back the two originals; the bounced
        // Savannah Lions is in hand too (the sibling ETB).
        const handIds = p1.hand.map((c) => c.id).sort();
        expect(handIds).toEqual(["lib-a", "lib-b", "lion-1"]);

        // `library[0]` is the TOP by convention, so the put-back cards must be
        // the LAST two entries. A `putBack`-style top placement would land them
        // at index 0/1 — the exact confusion this test exists to catch.
        const libIds = p1.library.map((c) => c.id);
        expect(libIds).toHaveLength(3);
        expect([...libIds].slice(-2).sort()).toEqual(["hand-a", "hand-b"]);
        expect(libIds[0]).toBe("lib-c");
    });

    it("also resolves the mandatory white-or-blue bounce (both ETBs coexist)", () => {
        const state = castLoon();
        const p1 = state.players[0];
        expect(p1.battlefield.map((c) => c.id)).not.toContain("lion-1");
        expect(p1.battlefield.some((c) => c.card.id === sawtoothLoon.id)).toBe(
            true
        );
    });

    // Wire leg — the owner's library crosses the projection as a COUNT, which
    // must include the returned cards or the client renders a stale deck size.
    it("survives the wire projection (library count includes the returned cards)", () => {
        const state = castLoon();
        const expectedLibrary = state.players[0].library.length;
        const expectedHand = state.players[0].hand.length;
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].library.count).toBe(expectedLibrary);
        expect(projected.players[0].hand).toHaveLength(expectedHand);
    });
});

describe("Cloud Cover ({2}{W}{U} — bounce a targeted permanent you control; CR 603.2b, issue #1953)", () => {
    const ABILITY = cloudCover.triggeredAbilities![0];

    const becameTarget = (
        targetId: string,
        targetControllerId: string,
        sourceControllerId: string
    ): BecameTargetEvent => ({
        type: "BECAME_TARGET",
        target: { type: "permanent", id: targetId },
        targetControllerId,
        sourceControllerId,
        sourceInstanceId: "opposing-spell",
    });

    function board() {
        const cover = makeInstance(cloudCover.id, {
            id: "cover-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cover, bear] }),
                makePlayer("p2"),
            ],
        });
        return { state, cover, bear };
    }

    function fire(
        state: GameState,
        cover: CardInstanceState,
        event: BecameTargetEvent
    ) {
        state.stack.push({
            ...cover,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: ABILITY.id,
            triggerSourceId: cover.id,
            triggerEvent: event,
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
    }

    it("triggers only on an OPPONENT's spell/ability targeting ANOTHER permanent you control", () => {
        const { cover, bear } = board();
        const view = cover as never;
        expect(ABILITY.matches(becameTarget(bear.id, "p1", "p2"), view)).toBe(
            true
        );
        // Your own spell targeting your own permanent — no trigger.
        expect(ABILITY.matches(becameTarget(bear.id, "p1", "p1"), view)).toBe(
            false
        );
        // An opponent's permanent targeted — not "you control".
        expect(ABILITY.matches(becameTarget(bear.id, "p2", "p2"), view)).toBe(
            false
        );
        // "ANOTHER permanent" — Cloud Cover never returns itself.
        expect(ABILITY.matches(becameTarget(cover.id, "p1", "p2"), view)).toBe(
            false
        );
    });

    // The census row under test: `$event.targetPermanent` must resolve to the
    // permanent that became a target — not to `$source`, not to a target slot.
    it("returns THAT permanent when the controller accepts the optional bounce", () => {
        const { state, cover, bear } = board();
        fire(state, cover, becameTarget(bear.id, "p1", "p2"));

        const may = state.pendingChoices![0];
        expect(may.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "bear-1"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain("bear-1");
        // Cloud Cover itself stays put.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "cover-1"
        );
    });

    it("declines cleanly — the permanent stays on the battlefield", () => {
        const { state, cover, bear } = board();
        fire(state, cover, becameTarget(bear.id, "p1", "p2"));
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "bear-1"
        );
        expect(state.players[0].hand.map((c) => c.id)).not.toContain("bear-1");
    });
});

describe("Meddling Mage ({W}{U} — name a nonland card as it enters; that spell can't be cast; CR 614.12/601.3a, issue #1953)", () => {
    /** Resolves Meddling Mage as a creature spell, answering the CR 614.12
     *  name choice with `name`. */
    function resolveMage(name: string) {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, meddlingMage.id, "p1");
        resolveTopOfStack(state);

        // Suspended on the CR 614.12 name choice BEFORE entering.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("name-card");
        applyNameCardSubmit(state, { playerId: "p1", cardName: name });

        const mage = state.players[0].battlefield.find(
            (c) => c.card.id === meddlingMage.id
        )!;
        return { state, mage };
    }

    const boltInHand = () =>
        makeInstance(lightningBolt.id, {
            id: "bolt-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });

    it("stamps the chosen name onto the permanent as it enters (CR 614.12)", () => {
        const { mage } = resolveMage(lightningBolt.name);
        expect(mage.chosenName).toBe(lightningBolt.name);
    });

    it("forbids casting a spell with the chosen name — for EITHER player (CR 601.3a)", () => {
        const { state } = resolveMage(lightningBolt.name);
        expect(castProhibitionReason("p2", boltInHand() as never, state)).toBe(
            "Spells with the chosen name can't be cast."
        );
        // Name-scoped, not a blanket lock.
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        expect(
            castProhibitionReason("p2", bears as never, state)
        ).toBeUndefined();
        // ...and it binds Meddling Mage's own controller too.
        expect(castProhibitionReason("p1", boltInHand() as never, state)).toBe(
            "Spells with the chosen name can't be cast."
        );
    });

    // The restriction is a READ-TIME battlefield scan — it must evaporate the
    // moment Meddling Mage leaves play, with no per-instance cleanup.
    it("stops forbidding once Meddling Mage leaves the battlefield", () => {
        const { state } = resolveMage(lightningBolt.name);
        state.players[0].battlefield = [];
        expect(
            castProhibitionReason("p2", boltInHand() as never, state)
        ).toBeUndefined();
    });

    // FRONTEND WIRING (mandatory): the client never re-derives cast legality —
    // it reads the SERVER-computed `legalActions` off the wire, and the shared
    // gate is the thing that computes it. Re-running the assertion against the
    // PROJECTED state is what proves the chosen name survives the projection
    // and that both sides agree.
    it("survives the wire projection — the chosen name and the lock both cross", () => {
        const { state } = resolveMage(lightningBolt.name);
        const projected = projectPublicState(state, 1, "p2");
        const slimMage = projected.players[0].battlefield.find(
            (c) => c.card.id === meddlingMage.id
        )!;
        expect(slimMage.chosenName).toBe(lightningBolt.name);
        expect(
            castProhibitionReason(
                "p2",
                boltInHand() as never,
                projected as never
            )
        ).toBe("Spells with the chosen name can't be cast.");
    });
});

describe("Hull Breach ({R}{G} — modal, third mode takes TWO independent targets; CR 700.2/601.2c, issue #1953)", () => {
    const bothMode = hullBreach.modes!.find((m) => m.id === "both")!;

    it("keeps the groups independent — artifacts for group 0, enchantments for group 1", () => {
        const art = makeInstance(blackLotus.id, {
            id: "art-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ench = makeInstance(dralnusCrusade.id, {
            id: "ench-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [art, ench] }),
            ],
        });
        const ids = (ts: ReturnType<typeof getLegalTargets>) =>
            ts.filter((t) => "id" in t).map((t) => (t as { id: string }).id);
        expect(
            ids(
                getLegalTargets(
                    state,
                    bothMode.targetRequirement!,
                    NO_TARGETING_SOURCE,
                    "p1"
                )
            )
        ).toEqual(["art-1"]);
        expect(
            ids(
                getLegalTargets(
                    state,
                    bothMode.additionalTargetRequirements![0],
                    NO_TARGETING_SOURCE,
                    "p1"
                )
            )
        ).toEqual(["ench-1"]);
    });

    // INTEGRATION (mandatory — the feature crosses GRE → game.ts → UI): the
    // per-mode group list is composed inside `announceCast`, so this drives the
    // REAL registered mutation. Pre-#1953 the card-level-only read queued NO
    // second group and the cast finalized after the artifact pick.
    it("queues the enchantment group through the real announceCast mutation", async () => {
        const art = makeInstance(blackLotus.id, {
            id: "art-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const ench = makeInstance(dralnusCrusade.id, {
            id: "ench-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const breach = makeInstance(hullBreach.id, {
            id: "breach-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lands = [mountain.id, forest.id].map((cardId, i) =>
            makeInstance(cardId, {
                id: `land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [breach],
                    battlefield: lands,
                    manaPool: { R: 1, G: 1 },
                }),
                makePlayer("p2", { battlefield: [art, ench] }),
            ],
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "breach-1",
                chosenModeId: "both",
            }
        );
        const pt = harness.state().pendingTarget!;
        expect(pt.targetType).toBe("Artifact");
        expect(pt.remainingRequirements).toEqual([
            { type: "Enchantment", count: 1 },
        ]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Mandatory discard is an EXACT count, never `{ min: 0, … }` (review round 4).
//
// `min` is what the server enforces (`pendingChoiceSubmit.ts` —
// "Select at least N cards"), so `{ min: 0, max: 3 }` on a MANDATORY "then
// discards three cards" is not a hand-size clamp, it is a licence to submit
// `[]` and keep everything. The interpreter already clamps a plain numeric
// count down to the cards actually held (`Math.min(op.count, available)`, and
// raises no choice at all at zero), which is why the range was never needed.
// Both tests below submit `[]` and require the server to refuse.
// ───────────────────────────────────────────────────────────────────────────

/** Fills `player`'s hand with `n` distinct Grizzly Bears. */
function fillHand(playerId: string, n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `${playerId}-hand-${i}`,
            controllerId: playerId,
            ownerId: playerId,
            zone: "hand",
        })
    );
}

describe("Urza's Guilt — the discard is MANDATORY (CR 701.9a / 608.2b, issue #1953)", () => {
    function resolveGuilt(handSize: number) {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: fillHand("p1", handSize),
                    library: fillHand("p1", 4).map((c) => ({
                        ...c,
                        zone: "library" as const,
                    })),
                }),
                makePlayer("p2", {
                    library: fillHand("p2", 4).map((c) => ({
                        ...c,
                        zone: "library" as const,
                    })),
                }),
            ],
        });
        pushSpell(state, urzasGuilt.id, "p1");
        resolveTopOfStack(state);
        return state;
    }

    it("raises a THREE-card discard, not a 0-to-3 range", () => {
        const state = resolveGuilt(6);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        // Exact count: the submit path enforces it as both floor and ceiling.
        expect(head.count).toBe(3);
    });

    it("refuses an empty submission — a player cannot keep their whole hand", () => {
        const state = resolveGuilt(6);
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [],
            })
        ).toThrow(/at least 3/i);
    });

    it("still clamps to a SHORT hand (CR 608.2b) — two cards held means two discarded", () => {
        // Drew two, so the hand is exactly 2 when the discard pass runs.
        const state = resolveGuilt(0);
        const head = state.pendingChoices![0];
        expect(head.count).toBe(2);
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: state.players
                    .find((p) => p.id === head.playerId)!
                    .hand.slice(0, 2)
                    .map((c) => c.id),
            })
        ).not.toThrow();
    });
});

describe("Marsh Crocodile — 'each player discards a card' is MANDATORY (CR 701.9a, issue #1953)", () => {
    /** Casts Marsh Crocodile for real and walks its two ETB triggers up to (but
     *  NOT through) the discard choice, so the raised choice is the one the
     *  server would actually present. The mandatory blue-or-black bounce takes
     *  whatever the engine offers (the Crocodile itself on this board — it is
     *  the only blue or black creature in play). */
    function fireDiscardEtb(handSize: number) {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: fillHand("p1", handSize) }),
                makePlayer("p2", { hand: fillHand("p2", handSize) }),
            ],
        });
        pushSpell(state, marshCrocodile.id, "p1");

        let guard = 0;
        while (guard++ < 30) {
            const head = state.pendingChoices?.[0];
            if (head) {
                if (head.kind === "trigger-order") {
                    resolveTriggerOrder(state);
                    continue;
                }
                if (head.choiceId === "$bounce") {
                    const croc = state.players[0].battlefield.find(
                        (c) => c.card.id === marshCrocodile.id
                    )!;
                    submitChoice(state, [croc.id]);
                    continue;
                }
                // The discard choice — stop here, it is what we assert on.
                break;
            }
            if (state.stack.length === 0) break;
            resolveTopOfStack(state);
        }
        return state;
    }

    it("raises an exact ONE-card discard per player, not a 0-or-1 range", () => {
        const state = fireDiscardEtb(3);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        expect(head.count).toBe(1);
    });

    it("refuses an empty submission", () => {
        const state = fireDiscardEtb(3);
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [],
            })
        ).toThrow(/at least 1/i);
    });

    it("skips the player whose hand is empty (CR 608.2b) — only the holder is asked", () => {
        // p1 opens with nothing but bounces the Crocodile into an otherwise
        // empty hand, so exactly one card is discardable; p2 holds nothing and
        // is never asked. The clamp is the interpreter's
        // `Math.min(count, available)`, not a `min: 0` licence.
        const state = fireDiscardEtb(0);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("discard-hand");
        expect(head.count).toBe(1);
        submitChoice(state, [state.players[0].hand[0].id]);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// CR 400.7 — `chosenName` must not survive a zone change (review round 4).
// `resetBattlefieldTransientState` is the single choke point every
// reanimation-style entry funnels through; before this fix `chosenName` was
// written in exactly one place and cleared nowhere, so a Mage that left and
// re-entered by a NON-cast path (which never runs the creature spell's
// `resolveSteps`, and so never asks for a new name) silently re-locked the
// name it chose in a previous life.
// ───────────────────────────────────────────────────────────────────────────

describe("Meddling Mage — the chosen name dies with the object (CR 400.7 / 614.12, issue #1953)", () => {
    function mageOnBattlefield(name: string) {
        const mage = makeInstance(meddlingMage.id, {
            id: "mage-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        mage.chosenName = name;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mage] }),
                makePlayer("p2"),
            ],
        });
        return { state, mage };
    }

    const boltInHand = () =>
        makeInstance(lightningBolt.id, {
            id: "bolt-2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });

    it("clears the name when the permanent is bounced to hand", () => {
        const { state, mage } = mageOnBattlefield(lightningBolt.name);
        removePermanentTo(state, mage.id, "hand");
        expect(
            state.players[0].hand.find((c) => c.id === "mage-1")!.chosenName
        ).toBeUndefined();
    });

    it("does NOT carry the old name onto a REANIMATED Mage — the new object has no name and locks nothing", () => {
        const { state, mage } = mageOnBattlefield(lightningBolt.name);
        // Dies: the graveyard card is LKI-shaped and may still carry the name.
        removePermanentTo(state, mage.id, "graveyard");
        const inYard = state.players[0].graveyard.find(
            (c) => c.id === "mage-1"
        )!;
        // Reanimated by a non-cast path — no creature spell, so no CR 614.12
        // choice is ever raised for the new object.
        state.players[0].graveyard = state.players[0].graveyard.filter(
            (c) => c.id !== "mage-1"
        );
        putReanimatedSetOnBattlefield(state, [
            { card: inYard, controllerId: "p1" },
        ]);
        const reborn = state.players[0].battlefield.find(
            (c) => c.id === "mage-1"
        )!;
        expect(reborn.chosenName).toBeUndefined();
        // ...and therefore nothing is locked (the restriction reads
        // `source.chosenName !== undefined`).
        expect(
            castProhibitionReason("p2", boltInHand() as never, state)
        ).toBeUndefined();
    });
});

describe("Malicious Advice — the life loss is NOT independent of the targets (CR 608.2b, issue #1953)", () => {
    /** Casts Malicious Advice for X = 1 at `targetId`, then resolves. */
    function castAdvice(targetId: string, board: CardInstanceState[]) {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: board }),
            ],
        });
        const item = pushSpell(state, maliciousAdvice.id, "p1", [
            { type: "permanent", id: targetId },
        ]);
        item.chosenX = 1;
        resolveTopOfStack(state);
        return state;
    }

    const bears = () =>
        makeInstance(grizzlyBears.id, {
            id: "bears-adv",
            controllerId: "p2",
            ownerId: "p2",
        });

    it("taps the target and costs the caster X life when the target is still legal", () => {
        const state = castAdvice("bears-adv", [bears()]);
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
        expect(state.players[0].life).toBe(19);
    });

    // The comment on this card used to claim the life loss "happens even if
    // every target has become illegal". It does not: `targetLegalityGate`
    // fizzles the WHOLE spell (CR 608.2b), so nothing at all resolves.
    it("fizzles entirely — and costs NO life — once every target is gone", () => {
        const state = castAdvice("bears-adv", []);
        expect(state.players[0].life).toBe(20);
        expect(state.stack).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLS free tranche — three-colour gold cards + Ertai / Phelddagrif (#1954).
// The four Charms are modal (CR 601.2b): mode chosen at announcement via
// `CardDefinition.modes`, mirroring Hull Breach / Vision Charm above. Every
// mode reuses already-exercised Ops, so per the per-Op regime
// (`.claude/rules/gre-development.md`) NO hand-written test is strictly
// required — the catalogue-wide static sweep + auto-generated smoke test
// already cover it. These are added anyway because modal announcement +
// per-mode targeting is this slice's highest-risk surface; each test proves
// ONE mode's wiring end-to-end via a direct `chosenModeId` push (the same
// shape Vision Charm's `pushModalVisionCharm` uses) rather than re-deriving
// the generic modal machinery Hull Breach's integration test already proves.
// ─────────────────────────────────────────────────────────────────────────────

describe("Crosis's Charm ({U}{B}{R} modal instant, CR 601.2b, issue #1954)", () => {
    it("mode 2 destroys a NONBLACK creature and can't be regenerated (CR 701.15c)", () => {
        const target = makeInstance(monssGoblinRaiders.id, {
            id: "raiders",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        const item = pushSpell(state, crosissCharm.id, "p1", [
            { type: "permanent", id: "raiders" },
        ]);
        item.chosenModeId = "destroy-nonblack-creature";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "raiders")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "raiders")).toBe(
            true
        );
    });

    it("mode 1 returns target permanent (any type) to its owner's hand", () => {
        const target = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        const item = pushSpell(state, crosissCharm.id, "p1", [
            { type: "permanent", id: "lotus" },
        ]);
        item.chosenModeId = "bounce";
        resolveTopOfStack(state);
        expect(state.players[1].hand.some((c) => c.id === "lotus")).toBe(true);
    });

    it("mode 3 destroys target artifact", () => {
        const target = makeInstance(blackLotus.id, {
            id: "lotus2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        const item = pushSpell(state, crosissCharm.id, "p1", [
            { type: "permanent", id: "lotus2" },
        ]);
        item.chosenModeId = "destroy-artifact";
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.some((c) => c.id === "lotus2")).toBe(
            true
        );
    });
});

describe("Darigaaz's Charm ({B}{R}{G} modal instant, CR 601.2b, issue #1954)", () => {
    it("mode 1 returns target creature card from YOUR graveyard to your hand", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead-bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, darigaazsCharm.id, "p1", [
            { type: "graveyard-card", id: "dead-bears", playerId: "p1" },
        ]);
        item.chosenModeId = "regrowth-creature";
        resolveTopOfStack(state);
        expect(state.players[0].hand.some((c) => c.id === "dead-bears")).toBe(
            true
        );
    });

    it("mode 2 deals 3 damage to any target (a player)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, darigaazsCharm.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenModeId = "damage";
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("mode 3 gives target creature +3/+3 until end of turn", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, darigaazsCharm.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenModeId = "pump";
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(5);
    });
});

describe("Dromar's Charm ({W}{U}{B} modal instant, CR 601.2b, issue #1954)", () => {
    it("mode 1 gains the caster 5 life (no target)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, dromarsCharm.id, "p1");
        item.chosenModeId = "gain-life";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25);
    });

    it("mode 2 counters target spell", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const victim = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const item = pushSpell(state, dromarsCharm.id, "p1", [
            { type: "spell", id: victim.id },
        ]);
        item.chosenModeId = "counter";
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === victim.id)).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === victim.id)).toBe(
            true
        );
    });

    it("mode 3 gives target creature -2/-2 until end of turn", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-shrink",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, dromarsCharm.id, "p1", [
            { type: "permanent", id: "bear-shrink" },
        ]);
        item.chosenModeId = "shrink";
        resolveTopOfStack(state);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "bear-shrink"
        )!;
        expect(getEffectivePower(state, live)).toBe(0);
        expect(getEffectiveToughness(state, live)).toBe(0);
    });
});

describe("Treva's Charm ({G}{W}{U} modal instant, CR 601.2b, issue #1954)", () => {
    it("mode 1 destroys target enchantment", () => {
        const ench = makeInstance(dralnusCrusade.id, {
            id: "ench-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ench] }),
            ],
        });
        const item = pushSpell(state, trevasCharm.id, "p1", [
            { type: "permanent", id: "ench-1" },
        ]);
        item.chosenModeId = "destroy-enchantment";
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.some((c) => c.id === "ench-1")).toBe(
            true
        );
    });

    it("mode 2 exiles only an ATTACKING creature (CR 508/509 combat role)", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        const mode = trevasCharm.modes!.find((m) => m.id === "exile-attacker")!;
        expect(
            getLegalTargets(
                state,
                mode.targetRequirement!,
                NO_TARGETING_SOURCE,
                "p1"
            ).some((t) => "id" in t && t.id === "attacker")
        ).toBe(true);
        const item = pushSpell(state, trevasCharm.id, "p1", [
            { type: "permanent", id: "attacker" },
        ]);
        item.chosenModeId = "exile-attacker";
        resolveTopOfStack(state);
        expect(state.players[1].exile.some((c) => c.id === "attacker")).toBe(
            true
        );
    });

    it("mode 3 draws a card then discards a card (loot)", () => {
        const drawn = makeInstance(grizzlyBears.id, {
            id: "top-of-library",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [drawn] }), makePlayer("p2")],
        });
        const item = pushSpell(state, trevasCharm.id, "p1");
        item.chosenModeId = "loot";
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at the discard choice
        expect(
            state.players[0].hand.some((c) => c.id === "top-of-library")
        ).toBe(true);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["top-of-library"],
        });
        expect(
            state.players[0].graveyard.some((c) => c.id === "top-of-library")
        ).toBe(true);
    });
});

describe("Ertai, the Corrupted ({2}{W}{U}{B}, CR 701.5a, issue #1954)", () => {
    const ABILITY = ertaiTheCorrupted.activatedAbilities!.find(
        (a) => a.id === "ertai-corrupted-counter"
    )!;

    it("counters target spell on resolution", () => {
        const ertai = makeInstance(ertaiTheCorrupted.id, {
            id: "ertai-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ertai] }),
                makePlayer("p2"),
            ],
        });
        const victim = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        state.stack.push({
            ...ertai,
            zone: "stack",
            castById: "p1",
            abilityId: "ertai-corrupted-counter",
            targets: [{ type: "spell", id: victim.id }],
        });
        resolveTopOfStack(state);
        expect(state.stack.some((s) => s.id === victim.id)).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === victim.id)).toBe(
            true
        );
        // Ertai itself stays on the battlefield — an activated ability's
        // source is not consumed by the ability object going on the stack.
        expect(
            state.players[0].battlefield.some((c) => c.id === "ertai-1")
        ).toBe(true);
    });
});

describe("Questing Phelddagrif ({1}{G}{W}{U}, three self-pump / opponent-benefit abilities, issue #1954)", () => {
    function setup() {
        const phelddagrif = makeInstance(questingPhelddagrif.id, {
            id: "phelddagrif-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [phelddagrif] }),
                makePlayer("p2"),
            ],
        });
        return { state, phelddagrif };
    }

    function resolveAbility(
        state: GameState,
        source: CardInstanceState,
        abilityId: string
    ): void {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            abilityId,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
    }

    it("{G}: pumps itself +1/+1 and gives target opponent a 1/1 green Hippo token", () => {
        const { state, phelddagrif } = setup();
        resolveAbility(state, phelddagrif, "questing-phelddagrif-green");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "phelddagrif-1"
        )!;
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(5);
        const hippo = state.players[1].battlefield.find(
            (c) => c.card.id !== questingPhelddagrif.id
        );
        expect(hippo).toBeDefined();
        expect(hippo!.power).toBe(1);
        expect(hippo!.toughness).toBe(1);
        expect(hippo!.controllerId).toBe("p2");
    });

    it("{W}: grants protection from black and red, target opponent gains 2 life", () => {
        const { state, phelddagrif } = setup();
        resolveAbility(state, phelddagrif, "questing-phelddagrif-white");
        expect(state.players[1].life).toBe(22);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "phelddagrif-1"
        )!;
        expect(live.grantedStaticAbilities ?? []).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ ability: "protection from black" }),
                expect.objectContaining({ ability: "protection from red" }),
            ])
        );
    });

    it("{U}: grants flying; target opponent MAY draw a card — accept", () => {
        const { state, phelddagrif } = setup();
        const topCard = makeInstance(grizzlyBears.id, {
            id: "p2-top",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        state.players[1].library = [topCard];
        resolveAbility(state, phelddagrif, "questing-phelddagrif-blue");
        // Suspends at the opponent's Pay/Skip decision.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices![0].playerId).toBe("p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].hand.some((c) => c.id === "p2-top")).toBe(true);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "phelddagrif-1"
        )!;
        expect(live.grantedStaticAbilities ?? []).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ ability: "flying" }),
            ])
        );
    });

    it("{U}: target opponent MAY draw a card — decline draws nothing", () => {
        const { state, phelddagrif } = setup();
        const topCard = makeInstance(grizzlyBears.id, {
            id: "p2-top-declined",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        state.players[1].library = [topCard];
        resolveAbility(state, phelddagrif, "questing-phelddagrif-blue");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(
            state.players[1].hand.some((c) => c.id === "p2-top-declined")
        ).toBe(false);
        expect(
            state.players[1].library.some((c) => c.id === "p2-top-declined")
        ).toBe(true);
    });
});

// ===========================================================================
// Radiant Kavu (CR 615 / 615.6 / 202.2) — issue #1955
// ===========================================================================
//
// The FILTER-scoped prevention shape: no target is named at all, and the match
// is re-read at the moment damage would be dealt. Asserted through the shared
// damage funnel so the test proves damage is actually stopped, not merely that
// a shield object exists.
describe("Radiant Kavu ({R}{G}{W} Creature — filter-scoped prevention, CR 615)", () => {
    /** p2 controls one blue creature, one black creature and one red creature. */
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(radiantKavu.id, {
                            id: "kavu",
                            controllerId: "p1",
                            ownerId: "p1",
                            isSummoningSick: false,
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(airElemental.id, {
                            id: "blueGuy",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(blackKnight.id, {
                            id: "blackGuy",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(monssGoblinRaiders.id, {
                            id: "redGuy",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    function activate(state: GameState): void {
        const kavu = state.players[0].battlefield.find((c) => c.id === "kavu")!;
        state.stack.push({
            ...kavu,
            zone: "stack",
            castById: "p1",
            abilityId: "radiant-kavu-prevent",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    function prevented(
        state: GameState,
        sourceId: string,
        isCombat = true
    ): boolean {
        return (
            runDamageReplacement(
                state,
                sourceId,
                "p2",
                { type: "player", id: "p1" },
                2,
                isCombat
            ) === null
        );
    }

    it("covers every blue and every black creature with no target named (CR 202.2 OR-set)", () => {
        const state = board();
        activate(state);
        expect(prevented(state, "blueGuy")).toBe(true);
        expect(prevented(state, "blackGuy")).toBe(true);
        expect(prevented(state, "redGuy")).toBe(false);
    });

    it("covers a creature that BECOMES blue AFTER the ability resolves (CR 615.6)", () => {
        const state = board();
        activate(state);
        expect(prevented(state, "redGuy")).toBe(false);
        // The filter is re-read on the damage path, not snapshotted at
        // resolution — a layer-5 colour change is picked up immediately.
        const red = state.players[1].battlefield.find(
            (c) => c.id === "redGuy"
        )!;
        red.colorOverride = ["U"];
        expect(prevented(state, "redGuy")).toBe(true);
    });

    it("stops covering a creature that stops being blue or black (CR 615.6)", () => {
        const state = board();
        activate(state);
        const blue = state.players[1].battlefield.find(
            (c) => c.id === "blueGuy"
        )!;
        blue.colorOverride = ["R"];
        expect(prevented(state, "blueGuy")).toBe(false);
    });

    it("is COMBAT-only: a blue creature's non-combat damage still lands (CR 510)", () => {
        const state = board();
        activate(state);
        expect(prevented(state, "blueGuy", false)).toBe(false);
    });

    it("the filter-scoped shield survives the wire projection (wire format)", () => {
        const state = board();
        activate(state);
        const projected = projectPublicState(state, 1, "p1");
        // Through the reducer: the slim battlefield card must still carry the
        // live colour/type the matcher reads.
        expect(sourcePreventionShieldApplies(projected, "blueGuy", true)).toBe(
            true
        );
        expect(sourcePreventionShieldApplies(projected, "redGuy", true)).toBe(
            false
        );
    });
});

// ===========================================================================
// Rith's Charm (CR 601.2b / 700.2 / 615 / 111) — issue #1955
// ===========================================================================
describe("Rith's Charm ({R}{G}{W} Instant — three modes, CR 700.2)", () => {
    function board(): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(forest.id, {
                            id: "basicForest",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "bear",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    function castMode(
        state: GameState,
        modeId: string,
        targets: StackItem["targets"] = []
    ): void {
        const item = pushSpell(state, rithsCharm.id, "p1", targets);
        item.chosenModeId = modeId;
        resolveTopOfStack(state);
    }

    it("mode 2 creates three 1/1 green Saproling tokens (CR 111)", () => {
        const state = board();
        castMode(state, "saprolings");
        const tokens = state.players[0].battlefield.filter(
            (c) => c.id !== "basicForest"
        );
        expect(tokens).toHaveLength(3);
        for (const t of tokens) {
            expect(t.types).toEqual(["Creature"]);
            expect(t.subtypes).toEqual(["Saproling"]);
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
            expect(STATIC_EFFECT_CTX.getColors(t)).toEqual(["G"]);
        }
    });

    it("mode 3 prevents ALL damage the chosen source would deal, combat AND non-combat (CR 615)", () => {
        const state = board();
        castMode(state, "prevent-source", [{ type: "permanent", id: "bear" }]);
        const dealt = (isCombat: boolean) =>
            runDamageReplacement(
                state,
                "bear",
                "p2",
                { type: "player", id: "p1" },
                2,
                isCombat
            );
        // This is the clause that distinguishes it from Falling Timber: the
        // shield is NOT combat-only.
        expect(dealt(true)).toBeNull();
        expect(dealt(false)).toBeNull();
    });

    it("mode 3's shield is recipient-agnostic — it also stops damage to a permanent", () => {
        const state = board();
        castMode(state, "prevent-source", [{ type: "permanent", id: "bear" }]);
        expect(
            runDamageReplacement(
                state,
                "bear",
                "p2",
                { type: "permanent", id: "basicForest" },
                2,
                false
            )
        ).toBeNull();
    });

    // CR 609.7 — "an activated ability, triggered ability, or spell can be a
    // source of damage" is the entire reason mode 3's target requirement
    // admits `"spell"` (issue #2051's divergence). A Lightning Bolt on the
    // stack, shielded by mode 3, must deal NO damage when it resolves.
    it("mode 3 shields a SPELL on the stack — the shielded Bolt deals no damage (CR 609.7, issue #2051)", () => {
        const state = board();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        castMode(state, "prevent-source", [{ type: "spell", id: bolt.id }]);
        // Rith's Charm has resolved (establishing the shield) and left only
        // the Bolt on the stack; resolve it now.
        expect(state.stack.map((s) => s.id)).toEqual([bolt.id]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});
