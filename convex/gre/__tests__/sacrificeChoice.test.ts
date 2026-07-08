import { describe, it, expect } from "vitest";
import {
    sacrificeCandidates,
    nextUnmetRequirement,
    isSacrificeCandidateLegal,
    autoResolveFungible,
    isSacrificeSelectionComplete,
    applySacrificeSelection,
    type SacrificeSelection,
} from "../sacrificeChoice";
import { makeInstance, makePlayer, makeState } from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards/index";

const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;
const BEARS = getCardByName("Grizzly Bears").id;

// CR 701.21a — the sacrificing player chooses which permanent(s) to sacrifice.
describe("sacrificeChoice (CR 701.21a)", () => {
    function landSel(playerId: string, count: number): SacrificeSelection {
        return {
            playerId,
            reason: "Test",
            requirements: [{ filter: { types: ["Land"] }, count }],
            picked: [],
        };
    }

    it("sacrificeCandidates returns only matching permanents on the player's battlefield", () => {
        const forest = makeInstance(FOREST, { controllerId: "p1" });
        const bears = makeInstance(BEARS, { controllerId: "p1" });
        const p1 = makePlayer("p1", { battlefield: [forest, bears] });
        const state = makeState({ players: [p1] });
        const cands = sacrificeCandidates(state, "p1", { types: ["Land"] });
        expect(cands.map((c) => c.id)).toEqual([forest.id]);
    });

    it("autoResolveFungible pre-fills when candidates equal count (forced)", () => {
        const f1 = makeInstance(FOREST, { controllerId: "p1" });
        const f2 = makeInstance(FOREST, { controllerId: "p1" });
        const p1 = makePlayer("p1", { battlefield: [f1, f2] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 2);
        autoResolveFungible(state, sel);
        expect(new Set(sel.picked)).toEqual(new Set([f1.id, f2.id]));
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
    });

    it("autoResolveFungible pre-fills when all candidates are indistinguishable", () => {
        const f1 = makeInstance(FOREST, { controllerId: "p1" });
        const f2 = makeInstance(FOREST, { controllerId: "p1" });
        const f3 = makeInstance(FOREST, { controllerId: "p1" });
        const p1 = makePlayer("p1", { battlefield: [f1, f2, f3] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 1);
        autoResolveFungible(state, sel);
        expect(sel.picked.length).toBe(1);
        expect(isSacrificeSelectionComplete(sel)).toBe(true);
    });

    it("autoResolveFungible leaves a real choice unresolved (tapped differs)", () => {
        const untapped = makeInstance(FOREST, { controllerId: "p1" });
        const tapped = makeInstance(FOREST, {
            controllerId: "p1",
            isTapped: true,
        });
        const p1 = makePlayer("p1", { battlefield: [untapped, tapped] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 1);
        autoResolveFungible(state, sel);
        expect(sel.picked.length).toBe(0);
        expect(isSacrificeSelectionComplete(sel)).toBe(false);
    });

    it("isSacrificeCandidateLegal accepts a filter match, rejects a non-match", () => {
        const forest = makeInstance(FOREST, { controllerId: "p1" });
        const bears = makeInstance(BEARS, { controllerId: "p1" });
        const p1 = makePlayer("p1", { battlefield: [forest, bears] });
        const state = makeState({ players: [p1] });
        const sel = landSel("p1", 1);
        expect(isSacrificeCandidateLegal(state, sel, forest.id)).toBe(true);
        expect(isSacrificeCandidateLegal(state, sel, bears.id)).toBe(false);
    });

    it("nextUnmetRequirement advances as picks are added", () => {
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Test",
            requirements: [
                { filter: { types: ["Land"] }, count: 1 },
                { filter: { types: ["Creature"] }, count: 1 },
            ],
            picked: [],
        };
        expect(nextUnmetRequirement(sel)?.filter).toEqual({ types: ["Land"] });
        sel.picked.push("a");
        expect(nextUnmetRequirement(sel)?.filter).toEqual({
            types: ["Creature"],
        });
        sel.picked.push("b");
        expect(nextUnmetRequirement(sel)).toBeUndefined();
    });

    it("applySacrificeSelection moves picked permanents to the graveyard and returns snapshot data", () => {
        const island = makeInstance(ISLAND, { controllerId: "p1" });
        const p1 = makePlayer("p1", { battlefield: [island] });
        const state = makeState({ players: [p1] });
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Test",
            requirements: [
                { filter: { types: ["Land"] }, count: 1, snapshot: true },
            ],
            picked: [island.id],
        };
        const results = applySacrificeSelection(state, sel);
        const player = state.players[0];
        expect(
            player.battlefield.find((c) => c.id === island.id)
        ).toBeUndefined();
        expect(player.graveyard.some((c) => c.id === island.id)).toBe(true);
        expect(results).toEqual([
            { id: island.id, mv: 0, subtypes: ["Island"], snapshot: true },
        ]);
    });

    it("applySacrificeSelection skips a victim that already left the battlefield (CR 608.2b)", () => {
        const missingId = "gone-instance";
        const p1 = makePlayer("p1", { battlefield: [] });
        const state = makeState({ players: [p1] });
        const sel: SacrificeSelection = {
            playerId: "p1",
            reason: "Test",
            requirements: [{ filter: { types: ["Land"] }, count: 1 }],
            picked: [missingId],
        };
        expect(() => applySacrificeSelection(state, sel)).not.toThrow();
        expect(applySacrificeSelection(state, sel)).toEqual([]);
    });
});
