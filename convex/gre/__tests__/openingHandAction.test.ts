// Opening-hand actions (CR 103.6 / 103.6a) — "If this card is in your opening
// hand, you may begin the game with it on the battlefield."
//
// Driven through the real London mulligan (`recordDeclaration` →
// `finalizeMulligan`) and the real submit seam (`applyPendingChoiceSubmit`, the
// body of `submitResolutionChoice`), so the window is exercised exactly where a
// game reaches it. Fixtures are synthetic variants served through
// `withTemporaryDefinition`: the mechanic is an engine shape, not a card.

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { makeMulliganState, recordDeclaration } from "../mulligan";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import type { CardInstanceState, GameState } from "../state";
import type { Phase } from "../types";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const bears = getCardByName("Grizzly Bears");

/** A permanent that may begin the game on the battlefield (CR 103.6a). */
const LEYLINE: CardDefinition = {
    id: "test-8833-leyline",
    name: "Test Opening-Hand Enchantment",
    rarity: "rare",
    oracleText:
        "If this card is in your opening hand, you may begin the game with it on the battlefield.",
    manaCost: { generic: 2, B: 2 },
    types: ["Enchantment"],
    openingHandAction: "begin-on-battlefield",
};

/** The same, with a self-ETB trigger (CR 603.6a): "When this enters, you gain
 *  3 life." */
const LEYLINE_WITH_ETB: CardDefinition = {
    ...LEYLINE,
    id: "test-8833-leyline-etb",
    name: "Test Opening-Hand Enchantment With ETB",
    triggeredAbilities: [
        {
            id: "test-8833-etb-gain",
            oracleText: "When this enchantment enters, you gain 3 life.",
            event: "PERMANENT_ENTERED",
            etbAbility: true,
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            effects: [{ op: "gainLife", player: "controller", amount: 3 }],
        },
    ],
};

/** The same, with an as-enters choice (CR 614.12a) that parks its entry. */
const LEYLINE_WITH_AS_ENTERS: CardDefinition = {
    ...LEYLINE,
    id: "test-8833-leyline-as-enters",
    name: "Test Opening-Hand Enchantment With As-Enters",
    entersWith: { asEnters: [{ kind: "payLife", cap: 1 }] },
};

/** A two-player game at the start of the mulligan, each hand the given
 *  definitions (padded with Grizzly Bears), libraries of Bears. */
function makeGame(
    hands: { p1: string[]; p2: string[] },
    startingPlayer: "p1" | "p2" = "p1"
): GameState {
    const buildPlayer = (id: "p1" | "p2") => {
        const handIds = [...hands[id]];
        while (handIds.length < 7) handIds.push(bears.id);
        const hand = handIds.map((cardId, i) =>
            makeInstance(cardId, {
                id: `${id}-hand-${i}`,
                controllerId: id,
                ownerId: id,
                zone: "hand",
            })
        );
        const library = Array.from({ length: 20 }, (_, i) =>
            makeInstance(bears.id, {
                id: `${id}-lib-${i}`,
                controllerId: id,
                ownerId: id,
                zone: "library",
            })
        );
        return makePlayer(id, { hand, library });
    };
    const state = makeState({
        players: [buildPlayer("p1"), buildPlayer("p2")],
        phase: "MULLIGAN" as Phase,
        rngSeed: 1,
        rngCounter: 0,
        priorityPlayerId: "p1",
        activePlayerId: startingPlayer,
        turn: 1,
    });
    state.mulligan = makeMulliganState(state);
    return state;
}

function keepBoth(state: GameState): void {
    recordDeclaration(state, "p1", "keep");
    recordDeclaration(state, "p2", "keep");
}

function submit(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

const onBattlefield = (state: GameState, seat: number): string[] =>
    state.players[seat].battlefield.map((c: CardInstanceState) => c.id);

describe("opening-hand actions (CR 103.6)", () => {
    it("opens the window after the mulligan: the starting player first, only eligible cards offered, privately", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame({ p1: [LEYLINE.id], p2: [LEYLINE.id] });
            keepBoth(state);

            // Still pre-game: no turn has begun (CR 103.6 precedes CR 103.8).
            expect(state.phase).toBe("MULLIGAN");
            const head = state.pendingChoices?.[0];
            expect(head?.kind).toBe("opening-hand-action");
            expect(head?.playerId).toBe("p1");
            expect(head?.candidateIds).toEqual(["p1-hand-0"]);
            expect(head?.count).toEqual({ min: 0, max: 1 });
            expect(head?.privateToChooser).toBe(true);
            expect(state.priorityPlayerId).toBe("p1");
            // One player at a time: p2's choice is raised after p1 acts.
            expect(state.pendingChoices).toHaveLength(1);
        });
    });

    it("puts the chosen card onto the battlefield (CR 103.6a), then hands the window to the next player in turn order", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame({ p1: [LEYLINE.id], p2: [LEYLINE.id] });
            keepBoth(state);

            submit(state, ["p1-hand-0"]);
            expect(onBattlefield(state, 0)).toEqual(["p1-hand-0"]);
            expect(state.players[0].hand.map((c) => c.id)).not.toContain(
                "p1-hand-0"
            );
            expect(state.phase).toBe("MULLIGAN");
            const head = state.pendingChoices?.[0];
            expect(head?.playerId).toBe("p2");
            expect(head?.candidateIds).toEqual(["p2-hand-0"]);

            // p2 declines (min 0): the window closes and turn 1 begins.
            submit(state, []);
            expect(onBattlefield(state, 1)).toEqual([]);
            expect(state.players[1].hand).toHaveLength(7);
            expect(state.mulligan).toBeUndefined();
            expect(state.pendingChoices).toBeUndefined();
            expect(state.phase).toBe("UPKEEP");
            expect(state.turn).toBe(1);
        });
    });

    it("the starting player acts first even when not seated first (CR 103.6)", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame(
                { p1: [LEYLINE.id], p2: [LEYLINE.id] },
                "p2"
            );
            keepBoth(state);

            expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
            submit(state, []);
            expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
            submit(state, []);
            expect(state.phase).toBe("UPKEEP");
        });
    });

    it("a card that began the game on the battlefield did not enter during turn 1 (CR 302.6)", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame({ p1: [LEYLINE.id], p2: [LEYLINE.id] });
            keepBoth(state);
            submit(state, ["p1-hand-0"]);
            submit(state, ["p2-hand-0"]);

            expect(state.phase).toBe("UPKEEP");
            const [mine, theirs] = state.players.map((p) => p.battlefield[0]);
            expect(mine.enteredOnTurn).toBeUndefined();
            expect(theirs.enteredOnTurn).toBeUndefined();
            // Controlled since before the starting player's turn began; the
            // other player's first turn has not begun yet.
            expect(mine.isSummoningSick).toBeFalsy();
            expect(theirs.isSummoningSick).toBe(true);
            // Arboria's tally — no qualifying action was taken during turn 1.
            expect(state.players[0].qualifyingActionThisTurn).toBeUndefined();
            expect(state.players[1].qualifyingActionThisTurn).toBeUndefined();
        });
    });

    it("skips a player with no eligible card without a prompt", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame({ p1: [], p2: [LEYLINE.id, LEYLINE.id] });
            keepBoth(state);

            const head = state.pendingChoices?.[0];
            expect(head?.playerId).toBe("p2");
            expect(head?.candidateIds).toEqual(["p2-hand-0", "p2-hand-1"]);
            submit(state, ["p2-hand-1", "p2-hand-0"]);
            expect(onBattlefield(state, 1)).toEqual(["p2-hand-1", "p2-hand-0"]);
            expect(state.phase).toBe("UPKEEP");
        });
    });

    it("refuses a hand card that does not allow the action", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame({ p1: [LEYLINE.id], p2: [] });
            keepBoth(state);
            expect(() => submit(state, ["p1-hand-1"])).toThrow(
                /not an eligible choice/
            );
            expect(onBattlefield(state, 0)).toEqual([]);
        });
    });

    it("an ETB trigger waits for the first priority, in turn 1's upkeep (CR 117.5)", () => {
        withTemporaryDefinition(LEYLINE_WITH_ETB, () => {
            const state = makeGame({ p1: [LEYLINE_WITH_ETB.id], p2: [] });
            keepBoth(state);
            submit(state, ["p1-hand-0"]);

            expect(state.phase).toBe("UPKEEP");
            expect(state.stack.map((s) => s.triggerSourceId)).toEqual([
                "p1-hand-0",
            ]);
        });
    });

    it("an as-enters choice parks the entry; the rest of the pick follows once it is answered (CR 614.12a)", () => {
        withTemporaryDefinition(LEYLINE, () =>
            withTemporaryDefinition(LEYLINE_WITH_AS_ENTERS, () => {
                const state = makeGame({
                    p1: [LEYLINE_WITH_AS_ENTERS.id, LEYLINE.id],
                    p2: [],
                });
                keepBoth(state);
                submit(state, ["p1-hand-0", "p1-hand-1"]);

                // Parked on the as-enters choice: the second card waits.
                expect(state.phase).toBe("MULLIGAN");
                expect(state.pendingChoices?.[0]?.asEntersCardId).toBe(
                    "p1-hand-0"
                );
                expect(onBattlefield(state, 0)).toEqual([]);
                expect(state.mulligan?.openingHand?.queued).toEqual([
                    "p1-hand-1",
                ]);

                // "Pay 0 life" — the option id, not a card id.
                submit(state, ["0"]);
                expect(onBattlefield(state, 0).sort()).toEqual([
                    "p1-hand-0",
                    "p1-hand-1",
                ]);
                expect(state.mulligan).toBeUndefined();
                expect(state.phase).toBe("UPKEEP");
            })
        );
    });

    it("projects the choice to its chooser only (CR 400.2 — the hand is hidden)", () => {
        withTemporaryDefinition(LEYLINE, () => {
            const state = makeGame({ p1: [LEYLINE.id], p2: [] });
            keepBoth(state);

            const mine = projectPublicState(state, 1, "p1");
            expect(mine.pendingChoices?.[0]?.kind).toBe("opening-hand-action");
            expect(mine.pendingChoices?.[0]?.candidateIds).toEqual([
                "p1-hand-0",
            ]);
            const theirs = projectPublicState(state, 1, "p2");
            expect(theirs.pendingChoices).toBeUndefined();
        });
    });
});
