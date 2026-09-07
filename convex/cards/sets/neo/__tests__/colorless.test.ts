// NEO — colourless card behavior tests (ADR 0043 colour split). One describe
// per card with non-trivial behavior; GRE + wire-format coverage per
// `.claude/rules/gre-development.md`.

import { describe, it, expect } from "vitest";
import { boseijuWhoEndures, otawaraSoaringCity } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";

// Wasteland (TMP) — a nonbasic land with no basic land type, used as the
// "nonbasic land an opponent controls" target for Boseiju's first clause.
const WASTELAND_ID = "99ff731b-8399-40c8-b539-ba6ba5783771";
// Tundra (LEA) — a nonbasic DUAL land carrying two basic land TYPES (Plains,
// Island) but no Basic SUPERTYPE — the "land card with a basic land type,
// NOT a basic land card" acceptance case (a Triome/dual qualifies).
const TUNDRA_ID = "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb";
// Grizzly Bears (LEA) — a plain vanilla Creature, reused as generic filler.
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    } as StackItem);
    resolveTopOfStack(state);
}

function submitSearchChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Boseiju, Who Endures (Channel ability word, CR 207.2c; snapshot-idiom controller-of-target search, issue #2287/#2290)", () => {
    it("destroys the opponent's nonbasic land, then offers the OPTIONAL search to THAT PLAYER (the destroyed permanent's controller), never the activator", () => {
        const boseiju = makeInstance(boseijuWhoEndures.id, {
            id: "boseiju",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const target = makeInstance(WASTELAND_ID, {
            id: "opp-wasteland",
            controllerId: "p2",
            ownerId: "p2",
        });
        const libraryLand = makeInstance(GRIZZLY_BEARS_ID, {
            id: "opp-lib-forest",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [boseiju] }),
                makePlayer("p2", {
                    battlefield: [target],
                    library: [libraryLand],
                }),
            ],
        });
        resolveActivated(state, boseiju, "boseiju-channel", [
            { type: "permanent", id: "opp-wasteland" },
        ]);
        // The target is gone from p2's battlefield, in p2's graveyard.
        expect(
            state.players[1].battlefield.some((c) => c.id === "opp-wasteland")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "opp-wasteland")
        ).toBe(true);
        // The may-pay is owed to p2 — the DESTROYED permanent's controller —
        // never p1, the activator. Submitting as p1 would be rejected.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p1", accept: true })
        ).toThrow();
    });

    it("declining the search leaves the library unshuffled and untouched (CR 701.23's search never begins)", () => {
        const boseiju = makeInstance(boseijuWhoEndures.id, {
            id: "boseiju",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const target = makeInstance(WASTELAND_ID, {
            id: "opp-wasteland",
            controllerId: "p2",
            ownerId: "p2",
        });
        const libraryLand = makeInstance(TUNDRA_ID, { id: "opp-lib-tundra" });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [boseiju] }),
                makePlayer("p2", {
                    battlefield: [target],
                    library: [libraryLand],
                }),
            ],
        });
        resolveActivated(state, boseiju, "boseiju-channel", [
            { type: "permanent", id: "opp-wasteland" },
        ]);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        // The library is untouched — same single card, same order — proving
        // no shuffle happened (a shuffled 1-card library is unobservable by
        // content, but declining means the search Op never ran at all).
        expect(state.players[1].library).toHaveLength(1);
        expect(state.players[1].library[0]!.id).toBe("opp-lib-tundra");
    });

    it("accepting finds a DUAL land with a basic land type (not the Basic supertype), puts it onto the battlefield under its owner's control, then shuffles", () => {
        const boseiju = makeInstance(boseijuWhoEndures.id, {
            id: "boseiju",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const target = makeInstance(WASTELAND_ID, {
            id: "opp-wasteland",
            controllerId: "p2",
            ownerId: "p2",
        });
        const libraryLand = makeInstance(TUNDRA_ID, {
            id: "opp-lib-tundra",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [boseiju] }),
                makePlayer("p2", {
                    battlefield: [target],
                    library: [libraryLand],
                }),
            ],
        });
        resolveActivated(state, boseiju, "boseiju-channel", [
            { type: "permanent", id: "opp-wasteland" },
        ]);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        submitSearchChoice(state, ["opp-lib-tundra"]);
        expect(state.pendingChoices).toBeUndefined();
        // Onto the BATTLEFIELD (not hand), under p2's control, library empty
        // (proving the shuffle/search actually ran).
        expect(
            state.players[1].battlefield.some((c) => c.id === "opp-lib-tundra")
        ).toBe(true);
        expect(state.players[1].library).toHaveLength(0);
    });

    it("the search clause still happens when the destroy did NOT remove the permanent (indestructible, CR 608.2h last-known information)", () => {
        const boseiju = makeInstance(boseijuWhoEndures.id, {
            id: "boseiju",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const target = makeInstance(WASTELAND_ID, {
            id: "opp-wasteland",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["indestructible"],
        });
        const libraryLand = makeInstance(TUNDRA_ID, { id: "opp-lib-tundra" });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [boseiju] }),
                makePlayer("p2", {
                    battlefield: [target],
                    library: [libraryLand],
                }),
            ],
        });
        resolveActivated(state, boseiju, "boseiju-channel", [
            { type: "permanent", id: "opp-wasteland" },
        ]);
        // Indestructible — the land survives the destroy attempt.
        expect(
            state.players[1].battlefield.some((c) => c.id === "opp-wasteland")
        ).toBe(true);
        // The may-pay/search clause fires anyway (the snapshot was taken
        // BEFORE the destroy attempt, unconditionally).
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
    });
});

describe("Otawara, Soaring City (Channel ability word, CR 207.2c, issue #2290)", () => {
    it("bounces a target of ANY controller (including the activator's own) to its owner's hand", () => {
        const otawara = makeInstance(otawaraSoaringCity.id, {
            id: "otawara",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const ownCreature = makeInstance(GRIZZLY_BEARS_ID, {
            id: "own-bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [otawara],
                    battlefield: [ownCreature],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, otawara, "otawara-channel", [
            { type: "permanent", id: "own-bear" },
        ]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "own-bear")
        ).toBe(false);
        expect(state.players[0].hand.some((c) => c.id === "own-bear")).toBe(
            true
        );
    });
});
