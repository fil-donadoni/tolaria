// Coldsnap (CSP) — colorless card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { mishrasBauble } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

const FOREST = getCardByName("Forest").id;

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

describe("Mishra's Bauble (free sac + next-upkeep cantrip, CR 603.7d)", () => {
    it("is a {0} artifact carrying the next-upkeep delayed trigger", () => {
        expect(getCardByName("Mishra's Bauble")).toBe(mishrasBauble);
        expect(mishrasBauble.manaCost).toEqual({});
        expect(mishrasBauble.delayedTriggers?.[0]?.timing).toBe("next-upkeep");
        const ability = mishrasBauble.activatedAbilities![0];
        expect(ability.cost).toMatchObject({ tap: true, sacrifice: true });
        expect(ability.targetRequirement).toEqual({ type: "player", count: 1 });
    });

    it("schedules the next-upkeep draw when activated (no immediate draw)", () => {
        const bauble = makeInstance(mishrasBauble.id, {
            id: "bauble",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(FOREST, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bauble], library: lib }),
                makePlayer("p2", { library: [] }),
            ],
        });
        resolveActivated(state, bauble, "mishras-bauble-look", [
            { type: "player", id: "p2" },
        ]);
        // CR 603.7d — the draw is delayed, not immediate.
        expect(state.players[0].hand.length).toBe(0);
        expect((state.delayedTriggers ?? []).length).toBeGreaterThan(0);
    });

    it("reveals the looked-at top card to the controller as persistent knowledge (CR 701.18a, ADR 0026), surviving the wire projection", () => {
        const bauble = makeInstance(mishrasBauble.id, {
            id: "bauble",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(FOREST, {
                id: `lib${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bauble] }),
                makePlayer("p2", { library: lib }),
            ],
        });
        resolveActivated(state, bauble, "mishras-bauble-look", [
            { type: "player", id: "p2" },
        ]);

        // GRE: the top card of the target's library is now known to the
        // controller (the looker) — the same `knownTo` mechanism the other
        // look-at-top-N cards use (Visions, Diabolic Vision, Portent).
        expect(state.players[1].library[0].knownTo).toEqual(["p1"]);
        expect(state.players[1].library[1].knownTo).toBeUndefined();

        // Wire format: the controller sees the looked-at card in the
        // projected state; a non-controller does not (ADR 0026 §
        // projectLibrary — `known` is gated purely by `knownTo`).
        const asController = projectPublicState(state, 1, "p1");
        const controllerLib = asController.players[1].library;
        expect(controllerLib.known).toHaveLength(1);
        expect(controllerLib.known[0].index).toBe(0);
        expect(controllerLib.known[0].card.id).toBe("lib0");

        const asOther = projectPublicState(state, 1, "p2");
        expect(asOther.players[1].library.known).toEqual([]);
    });
});
