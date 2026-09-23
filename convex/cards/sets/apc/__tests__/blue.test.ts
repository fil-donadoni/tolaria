// Per-card behaviour tests for APC blue cards (`convex/cards/sets/apc/blue.ts`).
//
// Whirlpool Warrior is a HAND-TAIL card (issue #4358): its activated half sits
// below the grammar floor, so it is written by hand and owes the test the
// compiler's generated smoke scenario would otherwise have given it. Two
// claims fail silently without one:
//
//   * CR 608.2h — "draws that many" is read only once, as the effect is
//     applied, so it is the hand size BEFORE the cards move. A recount after
//     the move reads an emptied hand and draws nothing, which looks exactly
//     like a card that simply shuffles the hand away.
//   * "EACH player … draws that many": the count is PER PLAYER, so a single
//     shared count would still empty and refill both hands — only a board
//     where the two hands differ in size can tell the two readings apart.
//
// The activated half's outcome is visible on the board, so the wire-format
// assertion through `projectPublicState` is mandatory (convex/CLAUDE.md
// § Card testing convention).

import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { finalizeCleanup } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    activateAbility,
    confirmTargets,
    selectTarget,
    submitResolutionChoice,
} from "../../../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";
import type { Id } from "../../../../_generated/dataModel";

const GAME_ID = "game-1" as Id<"games">;
import { projectPublicState } from "../../../../gameProjections";

// Resolved through the REGISTRY SEAM by id, never by name (`getCardByName`
// reads a registry `preloadDefinitions` never writes).
const WHIRLPOOL_WARRIOR = getDefinition("01f891ca-4e6a-4710-b1cf-5dabb5e1ad93");
const BEAR = getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a");

function cards(
    owner: string,
    ids: string[],
    zone: CardInstanceState["zone"]
): CardInstanceState[] {
    return ids.map((id) =>
        makeInstance(BEAR.id, { id, controllerId: owner, ownerId: owner, zone })
    );
}

function warriorOnBattlefield(): CardInstanceState {
    return makeInstance(WHIRLPOOL_WARRIOR.id, {
        id: "warrior",
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** Push an ability of `source` onto the stack with its cost assumed already
 *  paid (mirrors the post-`activateAbility` / post-trigger state) and resolve
 *  it. `abilityId` names an activated ability, `triggeredAbilityId` a trigger. */
function resolveAbility(
    state: GameState,
    source: CardInstanceState,
    key: { abilityId?: string; triggeredAbilityId?: string }
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        ...key,
        ...(key.triggeredAbilityId ? { triggerSourceId: source.id } : {}),
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Whirlpool Warrior — shuffle the hand back and redraw (CR 608.2h, issue #3807)", () => {
    it("the ETB trigger redraws exactly the hand it shuffled away", () => {
        const warrior = warriorOnBattlefield();
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [warrior],
                    hand: cards("p1", ["h1", "h2", "h3"], "hand"),
                    library: cards(
                        "p1",
                        ["l1", "l2", "l3", "l4", "l5"],
                        "library"
                    ),
                }),
                makePlayer("p2"),
            ],
        });

        resolveAbility(state, warrior, {
            triggeredAbilityId: "whirlpool-warrior-etb-redraw",
        });

        // A recount after the move would draw 0 and leave the hand empty.
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(5);
        expect(
            [...state.players[0].hand, ...state.players[0].library]
                .map((c) => c.id)
                .sort()
        ).toEqual(["h1", "h2", "h3", "l1", "l2", "l3", "l4", "l5"]);
    });

    it("the activated ability gives EACH player back their OWN hand size, on the board and on the wire", () => {
        const warrior = warriorOnBattlefield();
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [warrior],
                    hand: cards("p1", ["a1", "a2"], "hand"),
                    library: cards("p1", ["a3", "a4", "a5", "a6"], "library"),
                }),
                makePlayer("p2", {
                    hand: cards("p2", ["b1", "b2", "b3", "b4"], "hand"),
                    library: cards("p2", ["b5", "b6"], "library"),
                }),
            ],
        });

        resolveAbility(state, warrior, {
            abilityId: "whirlpool-warrior-each-player-redraw",
        });

        // The two counts differ, so a single shared count cannot produce both.
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(4);
        expect(state.players[1].hand).toHaveLength(4);
        expect(state.players[1].library).toHaveLength(2);
        // Nobody drew from anybody else's library.
        for (const c of [...state.players[0].hand, ...state.players[0].library])
            expect(c.id.startsWith("a")).toBe(true);
        for (const c of [...state.players[1].hand, ...state.players[1].library])
            expect(c.id.startsWith("b")).toBe(true);

        // The projection is what the client renders: an opponent's hand is a
        // list of nulls and a library is a count, so a redraw that never
        // reached the wire would show as an emptied board.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(2);
        expect(projected.players[0].library.count).toBe(4);
        expect(projected.players[1].hand).toHaveLength(4);
        expect(projected.players[1].library.count).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Unnatural Selection (issue #3809) — a resolution-time creature-type choice
// that excludes Wall drives an until-end-of-turn type SET (CR 205.3m / 205.1a).
// ---------------------------------------------------------------------------

const UNNATURAL_SELECTION = getDefinition(
    "c575e2cb-3990-4c73-b81c-e16311ec6bbb"
);
const SELECTION_GOBLIN = "unnatural-selection-test-goblin";
/** A land creature (Dryad Arbor's shape): its land type is NOT a creature
 *  type and must survive a creature-type set (CR 205.1a). */
const SELECTION_LAND_CREATURE = "unnatural-selection-test-land-creature";
registerTokenDefinition({
    id: SELECTION_GOBLIN,
    name: SELECTION_GOBLIN,
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 1,
});
registerTokenDefinition({
    id: SELECTION_LAND_CREATURE,
    name: SELECTION_LAND_CREATURE,
    rarity: "common",
    types: ["Land", "Creature"],
    subtypes: ["Forest", "Dryad"],
    power: 1,
    toughness: 1,
});

function selectionBoard(): { state: GameState; source: CardInstanceState } {
    const source = makeInstance(UNNATURAL_SELECTION.id, {
        id: "selection",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [source],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(SELECTION_GOBLIN, {
                        id: "goblin",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(SELECTION_LAND_CREATURE, {
                        id: "arbor",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, source };
}

function activateSelection(
    state: GameState,
    source: CardInstanceState,
    targetId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId: "unnatural-selection-retype",
        targets: [{ type: "permanent", id: targetId }],
    });
    resolveTopOfStack(state);
}

function pickType(state: GameState, subtype: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [subtype],
    });
}

const permanent = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

describe("Unnatural Selection — choose a creature type other than Wall; target creature becomes that type until end of turn (CR 205.3m / 205.1a, issue #3809)", () => {
    it("offers every creature type except Wall, and the server refuses Wall", () => {
        const { state, source } = selectionBoard();
        activateSelection(state, source, "goblin");
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        const ids = head.options!.map((o) => o.id);
        expect(ids).toContain("Elf");
        expect(ids).not.toContain("Wall");
        expect(() => pickType(state, "Wall")).toThrow();
    });

    it("SETS the creature types — the chosen type replaces them all — and reverts at end of turn", () => {
        const { state, source } = selectionBoard();
        activateSelection(state, source, "goblin");
        pickType(state, "Elf");
        expect(permanent(state, "goblin").subtypes).toEqual(["Elf"]);
        // Wire format — the retype reaches the client.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "goblin"
        )!;
        expect(slim.subtypes).toEqual(["Elf"]);
        // CR 611.2 / 514.2 — "until end of turn".
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(permanent(state, "goblin").subtypes).toEqual([
            "Goblin",
            "Warrior",
        ]);
    });

    it("CR 205.1a — a land creature keeps its LAND type; only its creature types are replaced", () => {
        const { state, source } = selectionBoard();
        activateSelection(state, source, "arbor");
        pickType(state, "Elf");
        expect([...permanent(state, "arbor").subtypes].sort()).toEqual([
            "Elf",
            "Forest",
        ]);
    });
});

describe("Unnatural Selection — full path through game.ts (issue #3809)", () => {
    it("activate → target → resolve → submit the type → the retyped creature is on the wire", async () => {
        const { state } = selectionBoard();
        const first = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation(
            activateAbility as unknown as Handler<unknown, void>,
            first.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "selection",
                abilityId: "unnatural-selection-retype",
            }
        );
        await runMutation(
            selectTarget as unknown as Handler<unknown, void>,
            first.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                targetType: "permanent",
                targetId: "goblin",
            }
        );
        if (first.state().pendingTarget !== undefined) {
            await runMutation(
                confirmTargets as unknown as Handler<unknown, void>,
                first.ctx,
                { gameId: GAME_ID, playerId: "p1" }
            );
        }
        const onStack = first.state();
        expect(onStack.stack[onStack.stack.length - 1]?.abilityId).toBe(
            "unnatural-selection-retype"
        );
        // Both players pass: the ability resolves up to its type choice.
        resolveTopOfStack(onStack);
        const second = makeMutationCtx("p1", [gameStateSeed(onStack)]);
        const head = second.state().pendingChoices![0];
        const submit = (subtype: string) =>
            runMutation(
                submitResolutionChoice as unknown as Handler<unknown, void>,
                second.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    stackItemId: head.stackItemId,
                    step: head.step,
                    choiceId: head.choiceId,
                    cardInstanceIds: [subtype],
                }
            );
        await expect(submit("Wall")).rejects.toThrow();
        await submit("Elf");
        const projected = projectPublicState(second.state(), 1, "p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "goblin")!
                .subtypes
        ).toEqual(["Elf"]);
    });
});
