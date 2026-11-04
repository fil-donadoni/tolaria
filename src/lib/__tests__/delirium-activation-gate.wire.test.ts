// CR 602.1b — a card-type tally restriction ("Activate only if there are four or
// more card types among cards in your graveyard") gates the CLIENT affordance,
// and a target in the graveyard must not hide the ability for want of a
// battlefield candidate. Every assertion reads `projectPublicState` through
// `buildTriggerStateView`: a hand-built view would mask a `types` field the wire
// or the reducer drops.

import { describe, expect, it } from "vitest";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import type { GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const WOODLAND = getCardByName("Shifting Woodland").id;
const COPY_ABILITY = "shifting-woodland-delirium-copy";
/** Three cards, four card types: Memnite is an Artifact Creature. */
const FOUR_TYPES = ["Memnite", "Forest", "Wrath of God"];
const ONE_TYPE = Array.from({ length: 4 }, () => "Grizzly Bears");

function board(graveyardNames: string[]): GameState {
    const own = (cardId: string, id: string) =>
        makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [own(WOODLAND, "woodland")],
                graveyard: graveyardNames.map((name, i) =>
                    own(getCardByName(name).id, `gy-${i}`)
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

function offeredIds(state: GameState): string[] {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Parameters<
        typeof buildTriggerStateView
    >[0];
    const view = buildTriggerStateView(players, projected.activePlayerId);
    const source = projected.players[0].battlefield.find(
        (c) => c.id === "woodland"
    ) as unknown as CardInstance;
    return getStackAbilities(source, undefined, true, view).map((a) => a.id);
}

describe("delirium activation gate on the client (CR 602.1b)", () => {
    it("offers the ability at four card types among three cards", () => {
        expect(offeredIds(board(FOUR_TYPES))).toContain(COPY_ABILITY);
    });

    it("hides it with four cards of a single card type", () => {
        expect(offeredIds(board(ONE_TYPE))).not.toContain(COPY_ABILITY);
    });
});
