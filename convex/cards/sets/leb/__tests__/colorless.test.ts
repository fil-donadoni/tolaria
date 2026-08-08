// Per-card behavior tests for colorless cards in
// `convex/cards/sets/leb/colorless.ts` (artifacts + lands).
//
// LEB is mostly reprints (CardPrint → shared LEA CardDefinition) plus two
// Beta-original cards that have their own CardDefinition (Volcanic Island,
// Circle of Protection: Black — see ADR 0014). This file covers:
//   1. Registry parity — every LEB print resolves to a real definition, and
//      the two Beta-original defs are registered (the module-load guard in
//      index.ts already throws on a dangling printId; these assertions make
//      the contract explicit and name-check a few representative prints). This
//      set-wide invariant lives with the colorless (catch-all) module.
//   2. Volcanic Island — a Beta-original dual land, hence colorless.

import { describe, it, expect } from "vitest";
import {
    circleOfProtectionBlack,
    volcanicIsland,
    ancestralRecallLeb,
    drainPowerLeb,
    manaShortLeb,
    timeVaultLeb,
    taigaLeb,
} from "..";
import { ancestralRecall, taiga } from "../../lea";
import { getDefinition, getAllCards } from "../../../index";
import {
    commitLandsForCost,
    type CardInstanceState,
} from "../../../../gre/state";
import { hasManaAbility } from "../../../../gre/constants";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

// ---------------------------------------------------------------------------
// Registry parity (ADR 0014)
// ---------------------------------------------------------------------------

describe("LEB registry parity", () => {
    it("resolves reprint prints to their shared LEA definition", () => {
        // A CardPrint must resolve to the same CardDefinition as the Alpha card.
        expect(getDefinition(ancestralRecallLeb.printId)).toBe(ancestralRecall);
        expect(getDefinition(taigaLeb.printId)).toBe(taiga);
    });

    it("resolves the three repointed prints (stale definitionIds fixed)", () => {
        // drainPower/manaShort/timeVault LEB stubs originally carried garbage
        // definitionIds; they were repointed at the live LEA defs on uncomment.
        expect(getDefinition(drainPowerLeb.printId).name).toBe("Drain Power");
        expect(getDefinition(manaShortLeb.printId).name).toBe("Mana Short");
        expect(getDefinition(timeVaultLeb.printId).name).toBe("Time Vault");
    });

    it("registers the two Beta-original definitions", () => {
        expect(getDefinition(volcanicIsland.id)).toBe(volcanicIsland);
        expect(getDefinition(circleOfProtectionBlack.id)).toBe(
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
