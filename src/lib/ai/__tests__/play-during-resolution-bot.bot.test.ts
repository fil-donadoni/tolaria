// Bot-driver coverage for the CR 608.2g play-during-resolution offer (issue
// #1961 — Shelldock Isle / the Hideaway cycle).
//
// The offer rides the EXISTING `option-pick` PendingChoice family rather than a
// new choice kind, precisely so the bot cannot stall on it: `option-pick` has a
// registered candidate generator, so `decideBotAction` classifies it as a
// `search-choice` and `botActionRealisation` routes it to the Worker (issue
// #1506). This file proves the vs-AI / solo path actually REACHES that point
// for BOTH branches of the extended Op — the CAST branch (a creature flashed in
// on the OPPONENT's turn, the card's defining function) and the LAND branch —
// by running a real card through the full
// project → buildBotView → decideBotAction → consultBrain → submit path, never
// a hand-built view.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "@convex/gre/state";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { buildBotView } from "../bot-view";
import { botActionRealisation, decideBotAction } from "../brain";
import { consultBrain } from "../brain-client";

const shelldockIsle = getCardByName("Shelldock Isle");
const grizzlyBears = getCardByName("Grizzly Bears");
const island = getCardByName("Island");

const PLAY_ABILITY_ID = "shelldock-isle-play-hidden";

/** Shelldock Isle under the BOT's control (p2), with a short library whose top
 *  card is `hiddenCardId`. `activePlayerId` names whose turn it is. */
function setup(
    hiddenCardId: string,
    activePlayerId: string
): { state: GameState; isle: CardInstanceState } {
    const isle = makeInstance(shelldockIsle.id, {
        id: "bot-isle",
        controllerId: "p2",
        ownerId: "p2",
    });
    const library = [
        makeInstance(hiddenCardId, {
            id: "bot-hidden",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        }),
        ...Array.from({ length: 4 }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `bot-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        ),
    ];
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", { battlefield: [isle], library }),
        ],
        activePlayerId,
        priorityPlayerId: activePlayerId,
    });
    return { state, isle: state.players[1].battlefield[0] };
}

function pushAndResolve(
    state: GameState,
    source: CardInstanceState,
    key: { abilityId?: string; triggeredAbilityId?: string }
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        ...(key.triggeredAbilityId
            ? {
                  triggerSourceId: source.id,
                  triggerEvent: {
                      type: "PERMANENT_ENTERED",
                      instanceId: source.id,
                      controllerId: source.controllerId,
                      types: ["Land"],
                  },
              }
            : {}),
        ...key,
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

/** Runs the CR 702.75a hideaway ETB and hides the top card. */
function hideTopCard(state: GameState, isle: CardInstanceState): void {
    pushAndResolve(state, isle, { triggeredAbilityId: "hideaway" });
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ["bot-hidden"],
    });
}

/** Drives the bot against the head pending choice through the REAL driver path:
 *  `decideBotAction` classifies it and hands it to the ISMCTS search, whose
 *  answer `consultBrain` returns (it falls back to the same inline
 *  `searchWithTrace` the Worker runs when no Worker exists, as in vitest), then
 *  submits that answer. Any stall would show up here as a `"none"`
 *  classification or a null move. */
async function driveBot(state: GameState): Promise<void> {
    const projected = projectPublicState(state, 1, "p2");
    const view = buildBotView(projected, "p2");
    expect(view.owedChoice?.kind).toBe("option-pick");
    expect(view.owedChoice?.searchable).toBe(true);

    const action = decideBotAction(view);
    expect(action.kind).toBe("search-choice");
    expect(botActionRealisation(action.kind)).toBe("worker");

    const { move } = await consultBrain(projected, "p2", { iterations: 24 });
    expect(move).not.toBeNull();
    expect(move!.kind).toBe("resolution-choice");
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: "p2",
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: (move as { cardInstanceIds: string[] })
            .cardInstanceIds,
    });
}

describe("Bot dispatch — CR 608.2g play-during-resolution offer (issue #1961)", () => {
    it("CAST branch on the OPPONENT's turn: the bot answers the offer and never stalls", async () => {
        // p1 is the active player — the exact case the card exists for, and the
        // one a timing-gated impulse window made unreachable.
        const { state, isle } = setup(grizzlyBears.id, "p1");
        hideTopCard(state, isle);
        pushAndResolve(state, isle, { abilityId: PLAY_ABILITY_ID });

        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        expect(offer.playerId).toBe("p2");

        await driveBot(state);
        // The choice was consumed and the resolution completed: the granting
        // ability is off the stack whichever way the search answered.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack.some((s) => s.abilityId === PLAY_ABILITY_ID)).toBe(
            false
        );
        // Exactly one of the two legal outcomes happened.
        const castIt = state.stack.some((s) => s.id === "bot-hidden");
        const stillExiled = state.players[1].exile.some(
            (c) => c.id === "bot-hidden"
        );
        expect(castIt !== stillExiled).toBe(true);
    });

    it("LAND branch on the bot's OWN turn: the bot answers the Play/Decline offer and never stalls", async () => {
        const { state, isle } = setup(island.id, "p2");
        hideTopCard(state, isle);
        pushAndResolve(state, isle, { abilityId: PLAY_ABILITY_ID });

        expect(state.pendingChoices![0].kind).toBe("option-pick");
        await driveBot(state);
        expect(state.pendingChoices).toBeUndefined();
        // CR 116.2a — a land never uses the stack, and the granting ability has
        // finished resolving either way.
        expect(state.stack).toHaveLength(0);
        // Whichever way the search answered, the CR 305.2a land drop tracks the
        // outcome exactly.
        const played = state.players[1].battlefield.some(
            (c) => c.id === "bot-hidden"
        );
        expect(
            played || state.players[1].exile.some((c) => c.id === "bot-hidden")
        ).toBe(true);
        expect(state.players[1].landsPlayedThisTurn ?? 0).toBe(played ? 1 : 0);
    });

    it("LAND branch on the OPPONENT's turn: no prompt is raised at all, so there is nothing to stall on (CR 305.3)", () => {
        const { state, isle } = setup(island.id, "p1");
        hideTopCard(state, isle);
        expect(() =>
            pushAndResolve(state, isle, { abilityId: PLAY_ABILITY_ID })
        ).not.toThrow();
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "bot-hidden")).toBe(
            true
        );
    });
});
