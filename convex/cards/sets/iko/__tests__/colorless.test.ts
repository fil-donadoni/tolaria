// IKO (Ikoria) — colorless: the five Triomes (issue #689). Cycling itself is
// exercised end-to-end in convex/gre/__tests__/cycling.test.ts (built once,
// reused); these tests lock the `makeTriome` factory output for each card:
// three basic land subtypes in printed order, always-tapped entry (CR 603.6d),
// three intrinsic mana options (CR 305.6), and Cycling {3} (CR 702.29).

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "../../../types";
import { getDefinition } from "../../../index";
import { getManaTapOptions } from "../../../../gre/constants";
import { makeInstance } from "../../../__tests__/setup.helper";

const raugrinTriome = getDefinition("02138fbb-3962-4348-8d31-faaefba0b8b2");
const indathaTriome = getDefinition("2b74bb81-fb9a-40e5-a941-e517430b52f5");
const savaiTriome = getDefinition("748e6a61-9c1f-4225-9f04-e54002f63ac3");
const ketriaTriome = getDefinition("a249b1f4-2b22-4b67-a207-e0c4ae95d2e1");
const zagothTriome = getDefinition("cc520518-2063-4b57-a0d4-10cf62a7175e");

function expectTriome(
    card: CardDefinition,
    subtypes: string[],
    colors: string[]
) {
    expect(card.types).toEqual(["Land"]);
    expect(card.subtypes).toEqual(subtypes);
    // CR 603.6d — Triomes always enter tapped.
    expect(card.entersTapped).toBe(true);
    // CR 305.6 — no printed mana ability: each basic land type is an
    // intrinsic "{T}: Add" the engine offers as its own tap option, in
    // printed order (issue #5623).
    expect(card.activatedAbilities?.some((a) => !a.useStack)).toBe(false);
    expect(getManaTapOptions(makeInstance(card.id))).toEqual(
        colors.map((c) => ({ [c]: 1 }))
    );
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
