// MH1 (Modern Horizons) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { waterloggedGrove, sunbakedCanyon, prismaticVista } from "../colorless";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type CardInstanceState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import type { CardDefinition as Def } from "../../../types";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

const cases: { card: Def; draw: string }[] = [
    { card: waterloggedGrove, draw: "waterlogged-grove-draw" },
    { card: sunbakedCanyon, draw: "sunbaked-canyon-draw" },
];

describe.each(cases)(
    "$card.name (Horizon-land painland cantrip, CR 605.1a / 305)",
    ({ card, draw }) => {
        it("the cantrip ability draws a card on resolution (CR 121.1)", () => {
            const land = makeInstance(card.id, {
                id: "land",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const lib = makeInstance(card.id, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land], library: [lib] }),
                    makePlayer("p2"),
                ],
            });
            resolveActivated(state, land, draw);
            expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
        });
    }
);

describe("Prismatic Vista (CR 701.19 / 400.7 / 701.20, issue #677)", () => {
    it("fetches a basic land card onto the battlefield untapped, then shuffles", () => {
        const land = makeInstance(prismaticVista.id, {
            id: "vistaLand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libForest = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land],
                    library: [libForest],
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "prismatic-vista-fetch",
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["forest1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["forest1"],
        });
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        );
        expect(entered).toBeDefined();
        expect(entered?.isTapped).toBeFalsy();
    });
});
