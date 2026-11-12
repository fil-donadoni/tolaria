// M20 — colorless card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import { getDefinition, preloadDefinitions } from "../../../index";
import { castProhibitionReason } from "../../../castRestrictions";
import {
    battlefieldEntryBlockedFrom,
    putReanimatedSetOnBattlefield,
} from "../../../../gre/state";
import { grafdiggersCage } from "../colorless.cards";

const manifoldKey = getDefinition("715e637a-dfd8-45a0-b1ea-53e4abd29307");
const balduvianBears = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095");

/** Push an activated ability onto the stack with its cost assumed already
 *  paid, then resolve it (mirrors post-activateAbility state). */
// Manifold Key — {1} Artifact (CR 701.26 untap; "can't be blocked" via the
// engine's `unblockable` keyword grant, CR 613.1f temporary keyword grant).
describe("Manifold Key (CR 701.26 untap-another; CR 613.1f unblockable grant)", () => {
    function setup() {
        const key = makeInstance(manifoldKey.id, {
            id: "key",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifact = makeInstance(manifoldKey.id, {
            id: "other-key",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const creature = makeInstance(balduvianBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [key, otherArtifact, creature],
                }),
                makePlayer("p2"),
            ],
        });
        return { state, key, otherArtifact, creature };
    }

    it("untaps another target artifact", () => {
        const { state, key } = setup();
        resolveActivated(state, key, "manifold-key-untap", [
            { type: "permanent", id: "other-key" },
        ]);
        const other = state.players[0].battlefield.find(
            (c) => c.id === "other-key"
        )!;
        expect(other.isTapped).toBe(false);
    });

    it("excludes itself from the untap target ('another target artifact')", () => {
        const { state, key } = setup();
        const ability = manifoldKey.activatedAbilities![0];
        const dynamicReq = ability.getTargetRequirement!(
            key as never,
            state as never
        );
        expect(dynamicReq.excludeInstanceIds).toEqual([key.id]);
    });

    it("a target creature can't be blocked this turn", () => {
        const { state, key } = setup();
        resolveActivated(state, key, "manifold-key-unblockable", [
            { type: "permanent", id: "bears" },
        ]);
        const bears = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(bears.cantBeBlockedThisTurn).toBe(true);
    });
});

// Grafdigger's Cage — {1} Artifact (issue #8599). CR 614.17 "can't" entry
// prohibition + CR 601.3a cast prohibition, both keyed on the card's zone.
describe("Grafdigger's Cage (CR 614.17 entry block; CR 601.3a cast block)", () => {
    preloadDefinitions([grafdiggersCage()]);
    const cage = getDefinition("2a6240e7-d3aa-40e9-a627-58e7bf62525c");

    function setup() {
        const cageCard = makeInstance(cage.id, {
            id: "cage",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cageCard] }),
                makePlayer("p2"),
            ],
        });
        return { state, cageCard };
    }

    it("forbids casting a spell from a graveyard or a library, not from hand", () => {
        const { state } = setup();
        for (const zone of ["graveyard", "library"] as const) {
            const spell = makeInstance(balduvianBears.id, {
                id: `bears-${zone}`,
                controllerId: "p1",
                ownerId: "p1",
                zone,
            });
            expect(castProhibitionReason("p1", spell, state)).toMatch(
                /from graveyards or libraries/
            );
        }
        const inHand = makeInstance(balduvianBears.id, {
            id: "bears-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        expect(castProhibitionReason("p1", inHand, state)).toBeUndefined();
    });

    it("blocks a creature card in a graveyard or library from entering, and lifts when the Cage leaves", () => {
        const { state, cageCard } = setup();
        const gyBears = makeInstance(balduvianBears.id, {
            id: "bears-gy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const libBears = makeInstance(balduvianBears.id, {
            id: "bears-lib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const handBears = makeInstance(balduvianBears.id, {
            id: "bears-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const artifactInGy = makeInstance(cage.id, {
            id: "cage-gy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        expect(battlefieldEntryBlockedFrom(state, gyBears)).toBe(true);
        expect(battlefieldEntryBlockedFrom(state, libBears)).toBe(true);
        expect(battlefieldEntryBlockedFrom(state, handBears)).toBe(false);
        expect(battlefieldEntryBlockedFrom(state, artifactInGy)).toBe(false);
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== cageCard.id
        );
        expect(battlefieldEntryBlockedFrom(state, gyBears)).toBe(false);
    });

    it("a reanimated creature card stays in the graveyard while the Cage is in play", () => {
        const { state } = setup();
        const bears = makeInstance(balduvianBears.id, {
            id: "bears-gy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // The reanimation caller has already lifted the card out of its zone.
        const entered = putReanimatedSetOnBattlefield(state, [
            { card: bears, controllerId: "p1" },
        ]);
        expect(entered).toEqual([]);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "bears-gy"
        );
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "bears-gy"
        );
    });
});
