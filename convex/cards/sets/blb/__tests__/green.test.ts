// blb (Bloomburrow) — per-card behavior tests for green cards in
// `convex/cards/sets/blb/green.cards.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import { beginApplyingStaticEffects } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import type { CardType } from "../../../types";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { keenEyedCurator as curatorModuleExport } from "../green.cards";

// The PR head carries no `definition-index.json` row for the card (ADR 0157:
// derived state is regenerated post-merge), so register the module's own
// definition rather than depend on the lazy catalogue source.
preloadDefinitions([resolveCardExport(curatorModuleExport)!]);
const keenEyedCurator = getDefinition("8cf33d80-0704-4dc4-8e8d-1dcbcbc35add");

const balduvianBears = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095");

/** A card of `types` sitting in `ownerId`'s graveyard. */
function graveyardCard(
    id: string,
    types: CardType[],
    ownerId = "p2"
): CardInstanceState {
    return makeInstance(balduvianBears.id, {
        id,
        types,
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
    });
}

function curatorBoard(graveyard: CardInstanceState[]) {
    const curator = makeInstance(keenEyedCurator.id, {
        id: "curator",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [curator] }),
            makePlayer("p2", { graveyard }),
        ],
    });
    beginApplyingStaticEffects(state, curator);
    return { state, curator };
}

/** Exile `cardId` from p2's graveyard through the real activated ability. */
function exileWithCurator(
    state: GameState,
    curator: CardInstanceState,
    cardId: string
) {
    resolveActivated(state, curator, "keen-eyed-curator-exile", [
        { type: "graveyard-card", id: cardId, playerId: "p2" },
    ]);
    checkStateBasedActions(state);
}

const power = (s: GameState, c: CardInstanceState) => getEffectivePower(s, c);
const toughness = (s: GameState, c: CardInstanceState) =>
    getEffectiveToughness(s, c);

describe("Keen-Eyed Curator (CR 607.2a, CR 205.2a, CR 611.3a)", () => {
    const makePile = () => [
        graveyardCard("g-creature", ["Creature"]),
        graveyardCard("g-land", ["Land"]),
        graveyardCard("g-instant", ["Instant"]),
        graveyardCard("g-artifact-creature", ["Artifact", "Creature"]),
        graveyardCard("g-enchantment", ["Enchantment"]),
    ];

    it("is a 3/3 without trample under four card types", () => {
        const { state, curator } = curatorBoard(makePile());
        for (const id of ["g-creature", "g-land", "g-instant"]) {
            exileWithCurator(state, curator, id);
        }
        expect(power(state, curator)).toBe(3);
        expect(toughness(state, curator)).toBe(3);
        expect(curator.staticAbilities).not.toContain("trample");
    });

    it("becomes 7/7 trample when the fourth card type is exiled, at instant speed", () => {
        const { state, curator } = curatorBoard(makePile());
        for (const id of ["g-creature", "g-land", "g-instant"]) {
            exileWithCurator(state, curator, id);
        }
        exileWithCurator(state, curator, "g-enchantment");
        expect(power(state, curator)).toBe(7);
        expect(toughness(state, curator)).toBe(7);
        expect(curator.staticAbilities).toContain("trample");
    });

    it("counts a multi-type card once per type, not once per card", () => {
        const { state, curator } = curatorBoard(makePile());
        exileWithCurator(state, curator, "g-artifact-creature");
        exileWithCurator(state, curator, "g-land");
        // Artifact, Creature, Land = 3 types from 2 cards; one Instant → 4.
        expect(power(state, curator)).toBe(3);
        exileWithCurator(state, curator, "g-instant");
        expect(power(state, curator)).toBe(7);
    });

    it("ignores cards exiled by another source", () => {
        const { state, curator } = curatorBoard(makePile());
        for (const id of ["g-creature", "g-land", "g-instant"]) {
            exileWithCurator(state, curator, id);
        }
        state.players[1].exile.push(
            makeInstance(balduvianBears.id, {
                id: "foreign",
                types: ["Enchantment"],
                controllerId: "p2",
                ownerId: "p2",
                zone: "exile",
                exiledBySourceId: "someone-else",
            })
        );
        expect(power(state, curator)).toBe(3);
    });

    it("survives projectPublicState (wire format)", () => {
        const { state, curator } = curatorBoard(makePile());
        for (const id of [
            "g-creature",
            "g-land",
            "g-instant",
            "g-enchantment",
        ]) {
            exileWithCurator(state, curator, id);
        }
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "curator"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(7);
        expect(getEffectiveToughness(projected, slim)).toBe(7);
        expect(slim.staticAbilities).toContain("trample");
    });
});
