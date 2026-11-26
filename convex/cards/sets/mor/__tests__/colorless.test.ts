// Morningtide (MOR) — colorless behaviour tests (ADR 0043 colour split).
//
// Mutavault (issue #10511): the `animate` Op's `allCreatureTypes` field
// (CR 205.3m) — every creature type is ADDED in layer 4 while the land is
// animated, and leaves with the animation at cleanup. Board-visible
// characteristic, so the wire projection is asserted too (`projectPublicState`
// reshapes the instance; `.claude/rules/gre-development.md` § Wire format).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import { advancePhase } from "../../../../gre/phases";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { revertAnimation, type GameState } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { validateAbilityEffectScript } from "../../../../gre/effects/validate";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { mutavault as mutavaultExport } from "../colorless.cards";

// A new hand-written card is not in the clean-tree registry: preload it.
preloadDefinitions([resolveCardExport(mutavaultExport)!]);
const mutavault = getDefinition("8ca3c48b-f104-4292-9a4e-2ce87a65893c");
// Lord of Atlantis — "Other Merfolk get +1/+1 and have islandwalk."
const lordOfAtlantisId = "210c4a90-fc7a-4c76-aeaa-20a005e45386";

function animatedBoard(): GameState {
    const vault = makeInstance(mutavault.id, {
        id: "vault",
        controllerId: "p1",
        ownerId: "p1",
    });
    const lord = makeInstance(lordOfAtlantisId, {
        id: "lord",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [vault, lord] }),
            makePlayer("p2"),
        ],
    });
    resolveActivated(state, vault, "mutavault-animate");
    return state;
}

function vaultOf(state: GameState) {
    return state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "vault")!;
}

describe("Mutavault — becomes a 2/2 creature with all creature types (CR 205.3m, CR 611.2a)", () => {
    it("is a plain land with no creature type before animating", () => {
        const vault = makeInstance(mutavault.id, { controllerId: "p1" });
        expect(vault.types).toEqual(["Land"]);
        expect(vault.subtypes).toEqual([]);
    });

    it("animates into a 2/2 land creature carrying every creature type", () => {
        const state = animatedBoard();
        const live = vaultOf(state);
        expect(live.types).toEqual(
            expect.arrayContaining(["Land", "Creature"])
        );
        expect(live.subtypes).toEqual(
            expect.arrayContaining(["Merfolk", "Shapeshifter", "Time Lord"])
        );
        // CR 613.4c — the Merfolk lord's +1/+1 reaches it while animated.
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("projects its creature types onto the wire", () => {
        const state = animatedBoard();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "vault"
        )!;
        expect(slim.subtypes).toEqual(
            expect.arrayContaining(["Merfolk", "Assembly-Worker"])
        );
    });

    it("loses every creature type when the animation ends at cleanup (CR 514.2)", () => {
        const state = animatedBoard();
        state.activePlayerId = "p1";
        state.turn = 1;
        state.phase = "END_STEP" as GameState["phase"];
        advancePhase(state);

        const live = vaultOf(state);
        expect(live.types).toEqual(["Land"]);
        expect(live.subtypes).toEqual([]);
        expect(live.animation).toBeUndefined();
    });

    it("a reverted copy with no re-derivation drops the creature types too", () => {
        // The Bot values an expiring animated body through `revertAnimation`
        // on a shallow copy (`revertedShape`, gre/evaluate.ts) — no layer
        // sync follows there, so the revert itself must remove what the
        // animation added.
        const state = animatedBoard();
        const shape = { ...vaultOf(state) };
        revertAnimation(shape);
        expect(shape.types).toEqual(["Land"]);
        expect(shape.subtypes).toEqual([]);
    });

    it("the validator accepts `allCreatureTypes: true` and refuses any other value", () => {
        const animateAbility = mutavault.activatedAbilities!.find(
            (a) => a.id === "mutavault-animate"
        )!;
        const withFlag = (allCreatureTypes: unknown) =>
            ({
                ...animateAbility,
                effects: animateAbility.effects!.map((op) => ({
                    ...op,
                    allCreatureTypes,
                })),
            }) as unknown as typeof animateAbility;
        expect(
            validateAbilityEffectScript(withFlag(true), "Mutavault")
        ).toEqual([]);
        expect(
            validateAbilityEffectScript(withFlag(false), "Mutavault").length
        ).toBeGreaterThan(0);
    });
});
