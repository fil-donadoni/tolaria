// VIS — blue cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    SpellContext,
    TargetSelection,
} from "../../types";
import { BASIC_LAND_SUBTYPES } from "../../types";

// Impulse — {1}{U} Instant. "Look at the top four cards of your library. Put one
// of them into your hand and the rest on the bottom of your library in any
// order." (CR 401.4 look.) A single already-censused `digToHand` Op (issue #984)
// with look 4 / take 1: it reveals the top four, drives the unified HAND/BOTTOM
// pick of one to keep (moved library→hand), bottoms the remaining three in the
// player's chosen order, and marks those bottomed cards known to the controller
// (ADR 0026 — "in any order" is a real choice: you looked at and placed them, so
// they stay face-up in the controller's bottom-of-library view until a shuffle).
//
// Canonical definition lives in its FIRST-printing set (Visions, VIS 34), per
// the reprint convention (#1008): a card's CardDefinition sits in the earliest
// set that printed it, and later Premodern-legal printings are separate
// CardPrint reprints. The parent issue named `sets/mmq/blue.ts`, but Impulse was
// never printed in Mercadian Masques — Visions is its true first printing (both
// vis and mmq are Premodern-legal).
export const impulse: CardDefinition = {
    id: "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", // VIS 34
    rarity: "common",
    name: "Impulse",
    oracleText:
        "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    effects: [{ op: "digToHand", player: "controller", look: 4, take: 1 }],
};

// Vision Charm — {U} instant, a three-mode "Choose one —" charm (CR 700.2).
//
// Vision Charm is a "Choose one —" modal spell (CR 700.2), migrated onto the
// cast-time modes framework (CR 601.2b–c, ADR 0037): the caster locks in ONE
// mode as part of casting — BEFORE the spell goes on the stack — and announces
// that mode's target then (CR 601.2c / 700.2d), so the opponent responds with
// full information. Each mode carries its own per-mode `targetRequirement`
// (their target shapes are unrelated: a player, none, or an artifact):
//   • mode "mill"  — targets a player (CR 700.2d): "target player mills four".
//   • mode "land-type" — NO target. Its two land-type sub-choices are neither
//     modes nor targets, so they stay RESOLUTION-time choices (CR 608.2), taken
//     via `requestOptionChoice`. Mode 2's resolve is the only remaining
//     protocol-like closure on the card: a staged-resume double option-choice
//     (Illusionary Terrain protocol, ADR 0045) — both land-type picks are taken
//     FIRST (each with a stable, distinct choiceId) and the subtype mutation is
//     applied LAST, so the replay-from-top resume re-derives the already-made
//     choices instead of re-applying the effect.
//   • mode "phase" — targets an artifact (CR 700.2d): "target artifact phases
//     out". Choosing this mode at cast is legal only with a legal artifact
//     target on the battlefield (CR 700.2d), so no min:0 deadlock guard is
//     needed — the cast-time target requirement enforces it.
//
// Modern Oracle (Scryfall, set VIS) is followed per the project rule: mode 3
// is a SINGLE "Target artifact phases out", not the printed "up to four".
export const visionCharm: CardDefinition = {
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
            // CR 700.2d — the chosen mode announces its target at cast.
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const targetPlayer = ctx.targets[0]?.id;
                if (targetPlayer === undefined) return;
                // CR 701.17a — mill re-reads the LIVE top each pass, stopping
                // when the library empties.
                for (let i = 0; i < 4; i++) {
                    const top = ctx.peekLibraryTop(targetPlayer, 1);
                    if (top.length === 0) break;
                    ctx.moveCardById(
                        targetPlayer,
                        top[0],
                        "library",
                        "graveyard"
                    );
                }
            },
        },
        {
            id: "land-type",
            label: "Change a land type until end of turn",
            oracleText:
                "Choose a land type and a basic land type. Each land of the " +
                "first chosen type becomes the second chosen type until end " +
                "of turn.",
            // No targetRequirement — this mode takes no targets. Its two
            // land-type picks stay RESOLUTION-time choices (CR 608.2): they are
            // neither modes nor targets, so they are not made at cast.
            resolve: (ctx: SpellContext) => {
                // "Choose a land type and a basic land type. Each land of the
                // first chosen type becomes the second chosen type until end of
                // turn." (CR 305.7 subtype change, layer 4, until CLEANUP /
                // CR 514.2.)
                const options = BASIC_LAND_SUBTYPES.map((s) => ({
                    id: s,
                    label: s,
                }));
                const fromType = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "vision-charm-land-from",
                    options,
                    prompt: "Choose a land type to change.",
                });
                if (fromType === undefined) return;
                const toType = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "vision-charm-land-to",
                    options,
                    prompt: "Choose the basic land type they become.",
                });
                if (toType === undefined) return;
                // Effect applied last (idempotent across the replay-from-top
                // resume).
                for (const player of ctx.apNapOrder()) {
                    for (const landId of ctx.getBattlefieldIds(player, {
                        types: "Land",
                    })) {
                        const target: TargetSelection = {
                            type: "permanent",
                            id: landId,
                        };
                        if (ctx.hasSubtype(target, fromType)) {
                            ctx.setSubtypesUntil(target, [toType], {
                                phase: "end-of-turn",
                            });
                        }
                    }
                }
            },
        },
        {
            id: "phase",
            label: "Target artifact phases out",
            oracleText: "Target artifact phases out.",
            // CR 700.2d — a single artifact, any controller's ("target
            // artifact"), announced at cast.
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // CR 702.26 — it phases in before its controller untaps during
                // their NEXT untap step (returnOn untap-cycle).
                ctx.phaseOut(target.id, {
                    returnOn: { kind: "untap-cycle" },
                });
            },
        },
    ],
};
