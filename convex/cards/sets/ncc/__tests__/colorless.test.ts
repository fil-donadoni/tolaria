// NCC — per-card behavior tests for colourless cards in
// `convex/cards/sets/ncc/colorless.ts` (set split by colour, ADR 0043).
//
// Currency Converter (issue #791) is the concrete vehicle for the per-source
// exile linkage capability (`linkExileToSource` / `getCardsExiledWith`, CR 111)
// plus the (already-shipped) discard trigger (CR 701.9) and draw/discard
// primitives. These tests exercise all three abilities through the real
// resolution path and assert the new provenance field survives projection +
// serialization.

import { describe, it, expect } from "vitest";
import { currencyConverter } from "../colorless";
import { forest, grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveActivated, resolveTrigger, answerChoice } from "./helpers";
import {
    resolveTopOfStack,
    removePermanentTo,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";

const CC_ID = currencyConverter.id;

function discardEvent(
    playerId: string,
    cardInstanceId: string
): StackItem["triggerEvent"] {
    return { type: "CARD_DISCARDED", playerId, cardInstanceId };
}

function withConverter(p1Overrides: Parameters<typeof makePlayer>[1] = {}): {
    state: GameState;
    cc: ReturnType<typeof makeInstance>;
} {
    const cc = makeInstance(CC_ID, {
        id: "cc",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [cc], ...p1Overrides }),
            makePlayer("p2"),
        ],
    });
    return { state, cc };
}

describe("Currency Converter — discard trigger + per-source exile link (CR 701.9 / 111)", () => {
    function discardedState() {
        const disc = makeInstance(grizzlyBears.id, {
            id: "disc1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const { state, cc } = withConverter({ graveyard: [disc] });
        return { state, cc };
    }

    it('exiles the discarded card from the graveyard and stamps it when the player says "yes"', () => {
        const { state, cc } = discardedState();
        resolveTrigger(
            state,
            cc,
            "currency-converter-discard-exile",
            discardEvent("p1", "disc1")
        );
        // Suspended on the "you may" decision.
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        answerChoice(state, ["yes"]);

        expect(state.players[0].graveyard).toHaveLength(0);
        const exiled = state.players[0].exile.find((c) => c.id === "disc1")!;
        expect(exiled).toBeDefined();
        // CR 111 — provenance link stamped to Currency Converter.
        expect(exiled.exiledBySourceId).toBe("cc");
    });

    it('leaves the card in the graveyard when the player declines ("no")', () => {
        const { state, cc } = discardedState();
        resolveTrigger(
            state,
            cc,
            "currency-converter-discard-exile",
            discardEvent("p1", "disc1")
        );
        answerChoice(state, ["no"]);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].exile).toHaveLength(0);
    });
});

describe("Currency Converter — {2},{T}: Draw a card, then discard a card (CR 121.6 / 701.8)", () => {
    it("draws exactly once before suspending for the discard choice", () => {
        const lib = ["l1", "l2"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const { state, cc } = withConverter({ library: lib, hand: [] });
        resolveActivated(state, cc, "currency-converter-draw-discard");

        // Step 0 drew once (library 2 → 1, hand 0 → 1), step 1 suspended.
        expect(state.players[0].library).toHaveLength(1);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.pendingChoices).toHaveLength(1);

        answerChoice(state, ["l1"]);
        // No second draw; the chosen card is discarded.
        expect(state.players[0].library).toHaveLength(1);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["l1"]);
    });
});

describe("Currency Converter — retrieve exiled card + conditional token (CR 111 / 400.7)", () => {
    function retrieveState() {
        const land = makeInstance(forest.id, {
            id: "landX",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            exiledBySourceId: "cc",
        });
        const nonland = makeInstance(grizzlyBears.id, {
            id: "bearX",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            exiledBySourceId: "cc",
        });
        // A card exiled with a DIFFERENT source — must not cross-contaminate.
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            exiledBySourceId: "some-other-source",
        });
        const { state, cc } = withConverter({ exile: [land, nonland, other] });
        return { state, cc };
    }

    it("only offers cards exiled with THIS artifact (per-source isolation)", () => {
        const { state, cc } = retrieveState();
        resolveActivated(state, cc, "currency-converter-retrieve");
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].candidateIds?.sort()).toEqual([
            "bearX",
            "landX",
        ]);
    });

    it("a land → graveyard + a Treasure token", () => {
        const { state, cc } = retrieveState();
        resolveActivated(state, cc, "currency-converter-retrieve");
        answerChoice(state, ["landX"]);

        expect(state.players[0].exile.find((c) => c.id === "landX")).toBe(
            undefined
        );
        expect(state.players[0].graveyard.some((c) => c.id === "landX")).toBe(
            true
        );
        const treasure = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes.includes("Treasure")
        );
        expect(treasure).toBeDefined();
    });

    it("a nonland card → graveyard + a 2/2 black Rogue token", () => {
        const { state, cc } = retrieveState();
        resolveActivated(state, cc, "currency-converter-retrieve");
        answerChoice(state, ["bearX"]);

        expect(state.players[0].graveyard.some((c) => c.id === "bearX")).toBe(
            true
        );
        const rogue = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes.includes("Rogue")
        );
        expect(rogue).toBeDefined();
        expect(rogue!.power).toBe(2);
        expect(rogue!.toughness).toBe(2);
    });

    it("does nothing when no card is exiled with the artifact", () => {
        const { state, cc } = withConverter({ exile: [] });
        resolveActivated(state, cc, "currency-converter-retrieve");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield).toHaveLength(1); // just the artifact
    });

    it("an activation already on the stack when the artifact is destroyed still retrieves (CR 113.7a / 608.2h, issue #2001)", () => {
        const { state, cc } = retrieveState();
        // Push the ability onto the stack WITHOUT resolving yet — mirrors it
        // being activated, then the source destroyed in response, the same
        // shape as the reported Skyship Weatherlight failure. The retrieve
        // ability is UNTARGETED, so CR 608.2b's target-legality re-check
        // never runs for it; CR 113.7a (the ability survives its source's
        // removal) + CR 608.2h (last known information) are what license
        // reading the destroyed artifact's pile.
        state.stack.push({
            ...cc,
            zone: "stack",
            castById: cc.controllerId,
            abilityId: "currency-converter-retrieve",
            targets: [],
        });
        removePermanentTo(state, "cc", "graveyard", "destroy");
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].candidateIds?.sort()).toEqual([
            "bearX",
            "landX",
        ]);
    });
});

describe("Currency Converter — wire format + serialization (issue #791)", () => {
    function linkedState() {
        const land = makeInstance(forest.id, {
            id: "landX",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            exiledBySourceId: "cc",
        });
        return withConverter({ exile: [land] }).state;
    }

    it("projects the per-source link as exiledByPermanentId (Arena pinning)", () => {
        const state = linkedState();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].exile.find((c) => c.id === "landX")!;
        expect(slim).toBeDefined();
        expect(slim.exiledByPermanentId).toBe("cc");
    });

    it("survives a serialize/deserialize round-trip", () => {
        const state = linkedState();
        const restored = expandState(compactState(state));
        const card = restored.players[0].exile.find((c) => c.id === "landX")!;
        expect(card.exiledBySourceId).toBe("cc");
    });
});
