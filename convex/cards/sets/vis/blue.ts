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

// Vision Charm — {U} instant, a three-mode "Choose one —" charm (CR 700.2).
//
// protocol card: modal spell with per-mode DIFFERENTIAL targeting plus a
// runtime double-choice. The `optionChoice` DSL Op picks the mode at
// resolution but forces ALL modes to share one cast-time-announced target slot
// (lea/blue.ts Twiddle), whereas Vision Charm's three modes have unrelated
// target shapes — a player (mode 1), no target (mode 2, which additionally asks
// TWO land-type sub-choices), and a single artifact (mode 3). No current Op
// vocabulary expresses per-mode differential targeting, so the whole card is a
// staged-resume resolve() (the Illusionary Terrain / Word of Command protocol,
// ADR 0045): every player choice is taken FIRST (each with a stable, distinct
// choiceId) and the mutating effect is applied LAST, so the replay-from-top
// resume re-derives the already-made choices instead of re-applying effects.
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
    resolve: (ctx: SpellContext) => {
        const mode = ctx.requestOptionChoice({
            playerId: ctx.controller,
            choiceId: "vision-charm-mode",
            options: [
                { id: "mill", label: "Target player mills four cards" },
                {
                    id: "land-type",
                    label: "Change a land type until end of turn",
                },
                { id: "phase", label: "Target artifact phases out" },
            ],
            prompt: "Choose one —",
        });
        if (mode === undefined) return;

        if (mode === "mill") {
            // "Target player mills four cards." No cast-time target slot on a
            // modal charm, so the player is picked at resolution.
            const targetPlayer = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: "vision-charm-mill-target",
                options: ctx.allPlayerIds.map((id) => ({
                    id,
                    label: id === ctx.controller ? "You" : "Opponent",
                })),
                prompt: "Choose a player to mill four cards.",
            });
            if (targetPlayer === undefined) return;
            // CR 701.17a — mill re-reads the LIVE top each pass, stopping when
            // the library empties.
            for (let i = 0; i < 4; i++) {
                const top = ctx.peekLibraryTop(targetPlayer, 1);
                if (top.length === 0) break;
                ctx.moveCardById(targetPlayer, top[0], "library", "graveyard");
            }
            return;
        }

        if (mode === "land-type") {
            // "Choose a land type and a basic land type. Each land of the first
            // chosen type becomes the second chosen type until end of turn."
            // (CR 305.7 subtype change, layer 4, until CLEANUP / CR 514.2.)
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
            // Effect applied last (idempotent across the replay-from-top resume).
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
            return;
        }

        // mode === "phase" — "Target artifact phases out." A single artifact,
        // any controller's ("target artifact"). count max 1; min 0 so an empty
        // board can't deadlock resolution. CR 702.26: it phases in before its
        // controller untaps during their NEXT untap step (returnOn untap-cycle).
        const picks = ctx.requestChoice({
            playerId: ctx.controller,
            choiceId: "vision-charm-phase-target",
            kind: "choose-permanents",
            zone: "battlefield",
            filter: { types: "Artifact" },
            count: { min: 0, max: 1 },
            allControllers: true,
            prompt: "Choose target artifact to phase out.",
        });
        if (picks === undefined) return;
        for (const id of picks) {
            ctx.phaseOut(id, { returnOn: { kind: "untap-cycle" } });
        }
    },
};
