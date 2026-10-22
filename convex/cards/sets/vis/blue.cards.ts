// VIS — blue cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Impulse — {1}{U} Instant. "Look at the top four cards of your library. Put one
// of them into your hand and the rest on the bottom of your library in any
// order." (CR 401.4 look.) A single already-censused `lookDistribute` Op (issue #984)
// with look 4 / take 1: it reveals the top four, drives the unified HAND/BOTTOM
// pick of one to keep (moved library→hand), bottoms the remaining three in the
// player's chosen order, and marks those bottomed cards known to the controller
// (ADR 0026 — "in any order" is a real choice: you looked at and placed them, so
// they stay face-up in the controller's bottom-of-library view until a shuffle).
//
// Canonical definition lives in its FIRST-printing set (Visions, VIS 34), per
// the reprint convention (#1008): a card's CardDefinition sits in the earliest
// set that printed it, and later Premodern-legal printings are separate
// CardPrint reprints. The parent issue named `sets/mmq/blue.cards.ts`, but Impulse was
// never printed in Mercadian Masques — Visions is its true first printing (both
// vis and mmq are Premodern-legal).
export const impulse = defineCard(() => ({
    id: "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", // VIS 34
    rarity: "common",
    name: "Impulse",
    oracleText:
        "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: 4,
            take: 1,
        },
    ],
}));

// Vision Charm — {U} instant, a three-mode "Choose one —" charm (CR 700.2).
//
// The caster locks in ONE mode as part of casting and announces that mode's
// target then (CR 601.2b–c / 700.2d), so each mode carries its own
// `targetRequirement` (a player, none, or an artifact).
//   • mode "mill" — "Target player mills four cards" (CR 701.17).
//   • mode "land-type" — NO target. Its two picks are neither modes nor
//     targets: two `chooseLandType` Ops made as the spell resolves (CR 608.2d)
//     — any land type (CR 205.3i), then a basic one (CR 305.6). Every land
//     carrying the first is snapshotted as the `forEach` starts (CR 611.2c)
//     and has its land types replaced by the second until end of turn
//     (CR 305.7, layer 4).
//   • mode "phase" — "Target artifact phases out" (CR 702.26), back in before
//     its controller's next untap.
//
// Modern Oracle (Scryfall, set VIS) is followed per the project rule: mode 3
// is a SINGLE "Target artifact phases out", not the printed "up to four".
export const visionCharm = defineCard(() => ({
    id: "78b384d3-3adf-493a-8b89-bfe68fd1c3e2",
    name: "Vision Charm",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    oracleText:
        "Choose one —\n" +
        "• Target player mills four cards.\n" +
        "• Choose a land type and a basic land type. Each land of the first chosen type becomes the second chosen type until end of turn.\n" +
        "• Target artifact phases out.",
    modes: [
        {
            id: "mill",
            label: "Target player mills four cards",
            oracleText: "Target player mills four cards.",
            targetRequirement: { type: "player", count: 1 },
            effects: [{ op: "mill", player: { target: 0 }, count: 4 }],
        },
        {
            id: "land-type",
            label: "Change a land type until end of turn",
            oracleText:
                "Choose a land type and a basic land type. Each land of the " +
                "first chosen type becomes the second chosen type until end " +
                "of turn.",
            effects: [
                {
                    op: "chooseLandType",
                    player: "controller",
                    prompt: "Choose a land type",
                    bind: "$firstChosenType",
                },
                {
                    op: "chooseLandType",
                    player: "controller",
                    prompt: "Choose a basic land type",
                    bind: "$secondChosenType",
                    basic: true,
                },
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: {
                            type: "Land",
                            subtype: { ref: "$firstChosenType" },
                        },
                    },
                    effects: [
                        {
                            op: "setSubtype",
                            target: { ref: "$each" },
                            subtypes: { ref: "$secondChosenType" },
                            family: "land",
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
        {
            id: "phase",
            label: "Target artifact phases out",
            oracleText: "Target artifact phases out.",
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [{ op: "phaseOut", target: { target: 0 } }],
        },
    ],
}));

// Man-o'-War — {2}{U} 2/2 Jellyfish. "When this creature enters, return target
// creature to its owner's hand." A CR 603.3d targeted ETB trigger (the target is
// announced as the trigger goes on the stack) whose body is the `moveZone`
// target shape to `hand` (CR 400.7 — a new object in its OWNER's hand). Written
// structurally identical to the compiler's own output, so it round-trips; the
// compiled row sits in quarantine only because the generated smoke scenario
// cannot model a `moveZone` on an announced creature, which is what the per-card
// test in `vis/__tests__/blue.test.ts` covers instead.
export const manOWar = defineCard(() => ({
    id: "4dbf9bf9-75cd-4b25-a3a1-43b7e029700b", // VIS 37
    rarity: "common",
    name: "Man-o'-War",
    oracleText:
        "When this creature enters, return target creature to its owner's hand.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Jellyfish"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "man-o-war-etb-bounce",
            oracleText:
                "When this creature enters, return target creature to its owner's hand.",
            scope: "self",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        }),
    ],
}));
