// IKO (Ikoria) — colorless: the five Triomes (issue #689). Cycling itself is
// exercised end-to-end in convex/gre/__tests__/cycling.test.ts (built once,
// reused); these tests lock the `makeTriome` factory output for each card:
// three basic land subtypes in printed order, always-tapped entry (CR 603.6d),
// a three-colour mana ability, and Cycling {3} (CR 702.29).

import { describe, it, expect } from "vitest";
import {
    raugrinTriome,
    indathaTriome,
    savaiTriome,
    ketriaTriome,
    zagothTriome,
} from "../colorless";
import type { CardDefinition } from "../../../types";

function expectTriome(
    card: CardDefinition,
    subtypes: string[],
    colors: string[]
) {
    expect(card.types).toEqual(["Land"]);
    expect(card.subtypes).toEqual(subtypes);
    // CR 603.6d — Triomes always enter tapped.
    expect(card.entersTapped).toBe(true);
    const mana = card.activatedAbilities?.find((a) => a.id.endsWith("-mana"));
    expect(mana?.useStack).toBe(false);
    expect(mana?.manaChoices).toEqual(colors.map((c) => ({ [c]: 1 })));
    // CR 702.29 — Cycling {3}.
    const cycling = card.activatedAbilities?.find((a) => a.id === "cycling");
    expect(cycling?.activateFromHand).toBe(true);
    expect(cycling?.cost.discardThis).toBe(true);
    expect(cycling?.cost.mana).toEqual({ generic: 3 });
    expect(cycling?.effects).toEqual([
        { op: "draw", player: "controller", count: 1 },
    ]);
}

describe("IKO Triomes (CR 702.29 Cycling, CR 305.6 nonbasic land)", () => {
    it("Raugrin Triome — Island Mountain Plains, taps U/R/W, Cycling {3}", () => {
        expectTriome(
            raugrinTriome,
            ["Island", "Mountain", "Plains"],
            ["U", "R", "W"]
        );
    });
    it("Indatha Triome — Plains Swamp Forest, taps W/B/G", () => {
        expectTriome(
            indathaTriome,
            ["Plains", "Swamp", "Forest"],
            ["W", "B", "G"]
        );
    });
    it("Savai Triome — Mountain Plains Swamp, taps R/W/B", () => {
        expectTriome(
            savaiTriome,
            ["Mountain", "Plains", "Swamp"],
            ["R", "W", "B"]
        );
    });
    it("Ketria Triome — Forest Island Mountain, taps G/U/R", () => {
        expectTriome(
            ketriaTriome,
            ["Forest", "Island", "Mountain"],
            ["G", "U", "R"]
        );
    });
    it("Zagoth Triome — Swamp Forest Island, taps B/G/U", () => {
        expectTriome(
            zagothTriome,
            ["Swamp", "Forest", "Island"],
            ["B", "G", "U"]
        );
    });
});
