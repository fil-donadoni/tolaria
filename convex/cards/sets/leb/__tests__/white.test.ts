// Per-card behavior tests for white cards in `convex/cards/sets/leb/white.ts`.
//
// Circle of Protection: Black is a Beta-original {1}{W} enchantment (ADR 0014),
// so its behavior test lives in the white module's parallel test file.

import { describe, it, expect } from "vitest";
import { circleOfProtectionBlack } from "..";
import { lightningBolt, terror } from "../../lea";
import { getLegalTargets } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

// ---------------------------------------------------------------------------
// Circle of Protection: Black — Beta-original (CR 615.1, 615.6)
// ---------------------------------------------------------------------------

describe("Circle of Protection: Black", () => {
    it("is a {1}{W} enchantment with a black color filter on its ability", () => {
        expect(circleOfProtectionBlack.types).toEqual(["Enchantment"]);
        expect(circleOfProtectionBlack.manaCost).toEqual({ X: 1, W: 1 });
        const ability = circleOfProtectionBlack.activatedAbilities?.[0];
        expect(ability?.targetRequirement?.colorFilter).toBe("B");
    });

    it("only offers black spells/permanents as legal targets", () => {
        const blackSpell = makeInstance(terror.id, {
            id: "terror",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const redSpell = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const state = makeState();
        state.stack.push({ ...blackSpell, castById: "p2" });
        state.stack.push({ ...redSpell, castById: "p2" });
        const ability = circleOfProtectionBlack.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.map((t) => t.id)).toEqual(["terror"]);
    });

    it("registers a one-shot end-of-turn prevention when it resolves", () => {
        const cop = makeInstance(circleOfProtectionBlack.id, { id: "cop" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cop] }),
                makePlayer("p2"),
            ],
        });
        const blackSpell = makeInstance(terror.id, {
            id: "terror-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...blackSpell,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        state.stack.push({
            ...cop,
            zone: "stack",
            castById: "p1",
            abilityId: "cop-prevent",
            targets: [{ type: "spell", id: "terror-stack" }],
        });
        resolveTopOfStack(state);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: "terror-stack",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });
});
