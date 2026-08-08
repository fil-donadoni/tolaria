// Per-card behavior tests for colorless cards in `convex/cards/sets/plc/colorless.ts`
// (Planar Chaos, split by colour per ADR 0043). Urborg, Tomb of Yawgmoth
// exercises the `subtype-add` static-effect kind (issue #675) — the additive
// sibling of `subtype-set`: it ADDS "Swamp" to every land's subtypes without
// clobbering the printed ones (CR 305.7, 611).

import { describe, it, expect } from "vitest";
import { urborgTombOfYawgmoth } from "..";
import { forest, tropicalIsland } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { getBasicLandMana } from "../../../../gre/constants";
import {
    type GameState,
    applySourceStaticEffects,
    removePermanentTo,
} from "../../../../gre/state";
import { applyPlayLand } from "../../../../gre/playLand";

describe("Urborg, Tomb of Yawgmoth ({T}: Add {B} via basic-land inference — CR 305.7, 611)", () => {
    it("adds Swamp to its OWN subtypes when played (it is itself a Land)", () => {
        const urborg = makeInstance(urborgTombOfYawgmoth.id, { zone: "hand" });
        const player = makePlayer("p1", { hand: [urborg] });
        const state: GameState = makeState({
            players: [player, makePlayer("p2")],
        });

        const played = applyPlayLand(state, player, urborg.id)!;

        expect(played.subtypes).toContain("Swamp");
    });

    it("Urborg itself can tap for {B} via the free basic-land-type inference", () => {
        const urborg = makeInstance(urborgTombOfYawgmoth.id, { zone: "hand" });
        const player = makePlayer("p1", { hand: [urborg] });
        const state: GameState = makeState({
            players: [player, makePlayer("p2")],
        });

        const played = applyPlayLand(state, player, urborg.id)!;

        expect(getBasicLandMana(played)).toBe("B");
    });

    it("adds Swamp additively to a land already on the battlefield (original subtypes NOT replaced)", () => {
        const state = makeState();
        const urborg = makeInstance(urborgTombOfYawgmoth.id, {
            id: "urborg-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const dual = makeInstance(tropicalIsland.id, {
            id: "dual-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(urborg);
        state.players[1].battlefield.push(dual);

        applySourceStaticEffects(state, urborg);

        // Printed types (Forest, Island) survive — only Swamp is appended.
        expect(dual.subtypes).toContain("Forest");
        expect(dual.subtypes).toContain("Island");
        expect(dual.subtypes).toContain("Swamp");
        expect(dual.subtypes).toHaveLength(3);
    });

    it("a land played AFTER Urborg is already in play also gains Swamp (applyExistingGrantsTo via applyPlayLand)", () => {
        const urborg = makeInstance(urborgTombOfYawgmoth.id, {
            id: "urborg-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const newForest = makeInstance(forest.id, { zone: "hand" });
        const player = makePlayer("p2", { hand: [newForest] });
        const state: GameState = makeState({
            players: [makePlayer("p1", { battlefield: [urborg] }), player],
        });
        applySourceStaticEffects(state, urborg);

        const played = applyPlayLand(state, player, newForest.id)!;

        expect(played.subtypes).toContain("Forest");
        expect(played.subtypes).toContain("Swamp");
    });

    // Wire format (MANDATORY for staticEffects, per gre-development.md): the
    // additive Swamp subtype must survive projectPublicState — the projection
    // reshapes battlefield cards to slim client-visible shapes, and a feature
    // that reads fat-state-only fields can silently break for the client.
    it("wire format: additive Swamp subtype survives projectPublicState", () => {
        const state = makeState();
        const urborg = makeInstance(urborgTombOfYawgmoth.id, {
            id: "urborg-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const dual = makeInstance(tropicalIsland.id, {
            id: "dual-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(urborg);
        state.players[1].battlefield.push(dual);
        applySourceStaticEffects(state, urborg);

        const projected = projectPublicState(state, 1, "p2");
        const slimDual = projected.players[1].battlefield.find(
            (c) => c.id === "dual-1"
        )!;

        expect(slimDual.subtypes).toContain("Forest");
        expect(slimDual.subtypes).toContain("Island");
        expect(slimDual.subtypes).toContain("Swamp");
        expect(slimDual.subtypes).toHaveLength(3);
    });

    it("reverts the additive Swamp grant when Urborg leaves the battlefield (sacrifice)", () => {
        const state = makeState();
        const urborg = makeInstance(urborgTombOfYawgmoth.id, {
            id: "urborg-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const dual = makeInstance(tropicalIsland.id, {
            id: "dual-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(urborg);
        state.players[1].battlefield.push(dual);
        applySourceStaticEffects(state, urborg);
        expect(dual.subtypes).toContain("Swamp");

        // CR 701.16 — sacrifice is one of the "leaves the battlefield" paths
        // that must unwind subtype-add grants (unapplySourceStaticEffects).
        removePermanentTo(state, urborg.id, "graveyard", "sacrifice");

        expect(dual.subtypes).toEqual(["Forest", "Island"]);
        expect(dual.subtypes).not.toContain("Swamp");
    });
});
