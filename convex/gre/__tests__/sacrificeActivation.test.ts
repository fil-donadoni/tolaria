import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards/index";
import { tryAutoCommitPendingActivation } from "../../game";
import {
    autoResolveFungible,
    isSacrificeSelectionComplete,
    type SacrificeSelection,
} from "../sacrificeChoice";
import type { GameState, CardInstanceState } from "../state";

// CR 602.1 / 118.5 / 701.21a — an activated ability's "Sacrifice an artifact"
// cost is a choice made by the activating player. Commit is gated on the choice
// and never auto-picks when a real choice remains.
describe("activated-ability sacrifice cost (CR 701.21a)", () => {
    const priest = getCardByName("Priest of Yawgmoth");
    const orni = getCardByName("Ornithopter").id;

    const makeArtifact = (id: string, overrides = {}): CardInstanceState =>
        makeInstance(orni, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            ...overrides,
        });

    function scenario(artifacts: CardInstanceState[]): GameState {
        const priestInst = makeInstance(priest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [priestInst, ...artifacts],
                }),
                makePlayer("p2"),
            ],
            priorityPlayerId: "p1",
            activePlayerId: "p1",
        });
    }

    function artifactSelection(): SacrificeSelection {
        return {
            playerId: "p1",
            reason: "Priest of Yawgmoth",
            requirements: [
                { filter: { types: ["Artifact"] }, count: 1, snapshot: true },
            ],
            picked: [],
        };
    }

    function pendingActivation(sel: SacrificeSelection) {
        return {
            playerId: "p1",
            cardInstanceId: "priest",
            abilityId: "priest-of-yawgmoth-mana",
            manaCost: {},
            tappedLandIds: [],
            tapSource: true,
            sacrificeSource: false,
            sacrificeSelection: sel,
        } as unknown as NonNullable<GameState["pendingActivation"]>;
    }

    it("parks (blocks commit) when the artifacts are non-fungible", () => {
        const state = scenario([
            makeArtifact("artU"),
            makeArtifact("artT", { isTapped: true }),
        ]);
        const sel = artifactSelection();
        autoResolveFungible(state, sel);
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
        state.pendingActivation = pendingActivation(sel);
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).toBeNull();
        expect(state.stack).toHaveLength(0);
        // Neither artifact was sacrificed.
        expect(
            state.players[0].battlefield.filter((c) =>
                c.types.includes("Artifact")
            )
        ).toHaveLength(2);
    });

    it("auto-resolves and commits when the artifacts are fungible", () => {
        const state = scenario([makeArtifact("artA"), makeArtifact("artB")]);
        const sel = artifactSelection();
        autoResolveFungible(state, sel);
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
        state.pendingActivation = pendingActivation(sel);
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();
        expect(state.stack).toHaveLength(1);
        // Exactly one artifact was sacrificed.
        expect(
            state.players[0].battlefield.filter((c) =>
                c.types.includes("Artifact")
            )
        ).toHaveLength(1);
        expect(
            state.players[0].graveyard.filter((c) =>
                c.types.includes("Artifact")
            )
        ).toHaveLength(1);
    });
});
