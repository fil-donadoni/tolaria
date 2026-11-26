// Issue #10551 — a CR 700.6 "historic" graveyard target (Abstergo
// Entertainment) through the REAL wire projection: the client's clickable set
// equals the server's offered set (artifact, legendary, Saga — the supertype
// axis of `typeOrSubtypeFilter`), and the prompt names the union.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { activateAbilityOnState } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState } from "@convex/gre/state";
import { matchesGraveyardTarget } from "~/lib/graveyard-targets";
import { formatTargetLabel } from "~/lib/target-progress";
import type { CardInstance } from "~/types/game";

function card(name: string, id: string, owner: "p1" | "p2") {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
    });
}

function board(): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [card("Abstergo Entertainment", "abstergo", "p1")],
                graveyard: [
                    card("Grizzly Bears", "bears", "p1"),
                    card("Memnite", "memnite", "p1"),
                    card("Lutri, the Spellchaser", "lutri", "p1"),
                    card("Fable of the Mirror-Breaker", "fable", "p1"),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
            }),
            makePlayer("p2"),
        ],
    });
}

describe("historic graveyard target — client mirror over the wire (CR 700.6)", () => {
    it("clicks exactly the historic cards and names the union in the prompt", () => {
        const state = board();
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "abstergo",
            abilityId: "abstergo-entertainment-recover",
        });
        const view = projectPublicState(state, 1, "p1");
        const pt = view.pendingTarget!;
        const graveyard = view.players[0]
            .graveyard as unknown as CardInstance[];
        const clickable = graveyard
            .filter((c) => matchesGraveyardTarget(c, "p1", pt, "p1", "p1"))
            .map((c) => c.id)
            .sort();
        expect(clickable).toEqual(["fable", "lutri", "memnite"]);
        expect(
            formatTargetLabel(
                pt.targetType,
                pt.zone,
                pt.controller,
                pt.spellStackKind,
                pt.typeOrSubtypeFilter
            )
        ).toBe("an artifact, a Saga or a legendary card from your graveyard");
    });
});
