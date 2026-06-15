// Per-card behavior tests for cards in `convex/cards/sets/leb.ts`.
//
// LEB is mostly reprints (CardPrint → shared LEA CardDefinition) plus two
// Beta-original cards that have their own CardDefinition (Volcanic Island,
// Circle of Protection: Black — see ADR 0014). This file covers:
//   1. Registry parity — every LEB print resolves to a real definition, and
//      the two Beta-original defs are registered (the module-load guard in
//      index.ts already throws on a dangling printId; these assertions make
//      the contract explicit and name-check a few representative prints).
//   2. Volcanic Island — dual-land mana ability, GRE + wire format.
//   3. Circle of Protection: Black — color filter + one-shot prevention.

import { describe, it, expect } from "vitest";
import {
    circleOfProtectionBlack,
    volcanicIsland,
    ancestralRecallLeb,
    drainPowerLeb,
    manaShortLeb,
    timeVaultLeb,
    taigaLeb,
} from "../leb";
import { lightningBolt, terror, ancestralRecall, taiga } from "../lea";
import { getCardById, getAllCards } from "../../index";
import { getLegalTargets } from "../../../gre/rules";
import {
    resolveTopOfStack,
    commitLandsForCost,
    type CardInstanceState,
} from "../../../gre/state";
import { hasManaAbility } from "../../../gre/constants";
import { projectPublicState } from "../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";

// ---------------------------------------------------------------------------
// Registry parity (ADR 0014)
// ---------------------------------------------------------------------------

describe("LEB registry parity", () => {
    it("resolves reprint prints to their shared LEA definition", () => {
        // A CardPrint must resolve to the same CardDefinition as the Alpha card.
        expect(getCardById(ancestralRecallLeb.printId)).toBe(ancestralRecall);
        expect(getCardById(taigaLeb.printId)).toBe(taiga);
    });

    it("resolves the three repointed prints (stale definitionIds fixed)", () => {
        // drainPower/manaShort/timeVault LEB stubs originally carried garbage
        // definitionIds; they were repointed at the live LEA defs on uncomment.
        expect(getCardById(drainPowerLeb.printId).name).toBe("Drain Power");
        expect(getCardById(manaShortLeb.printId).name).toBe("Mana Short");
        expect(getCardById(timeVaultLeb.printId).name).toBe("Time Vault");
    });

    it("registers the two Beta-original definitions", () => {
        expect(getCardById(volcanicIsland.id)).toBe(volcanicIsland);
        expect(getCardById(circleOfProtectionBlack.id)).toBe(
            circleOfProtectionBlack
        );
        const all = getAllCards();
        expect(all).toContain(volcanicIsland);
        expect(all).toContain(circleOfProtectionBlack);
    });
});

// ---------------------------------------------------------------------------
// Volcanic Island — Beta-original dual land (CR 305.6, 605.1a)
// ---------------------------------------------------------------------------

describe("Volcanic Island (dual land: {T}: Add {U} or {R})", () => {
    it("is a non-basic Land with Island and Mountain subtypes", () => {
        expect(volcanicIsland.types).toEqual(["Land"]);
        expect(volcanicIsland.subtypes).toEqual(["Island", "Mountain"]);
        expect(volcanicIsland.supertypes).toBeUndefined();
    });

    it("offers U and R as a single choice mana ability (useStack false)", () => {
        const ability = volcanicIsland.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toEqual([{ U: 1 }, { R: 1 }]);
    });

    it("commitLandsForCost commits the dual for either chosen color", () => {
        for (const color of ["U", "R"] as const) {
            const dual = makeInstance(volcanicIsland.id, {
                id: "volc-1",
                isTapped: true,
                chosenMana: { [color]: 1 },
            });
            const p1 = makePlayer("p1", { battlefield: [dual] });
            commitLandsForCost(p1, { [color]: 1 });
            expect(p1.battlefield[0].manaCommitted).toBe(true);
        }
    });

    it("wire format: mana ability + subtypes survive projectPublicState", () => {
        const dual = makeInstance(volcanicIsland.id, { id: "volc-inst" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dual] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "volc-inst"
        )!;
        expect(hasManaAbility(slim as CardInstanceState)).toBe(true);
        expect(slim.subtypes).toEqual(["Island", "Mountain"]);
    });
});

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
