// Theros Beyond Death (THB) — Colorless: artifacts with no coloured mana cost,
// split by colour per ADR 0043. The registry's `import * as thb from "./sets/thb"`
// resolves through thb/index.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n` (e.g. {1} → { X: 1 }).
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Soul-Guide Lantern — {1} Artifact. Graveyard hate plus a sacrifice-cantrip
// (CR 603.6a self-ETB trigger exiles one graveyard card; CR 605 two activated
// sacrifice abilities — the mass-exile and the card-draw).
//
// CR 603.3d (issue #1193) — "exile target card from a graveyard" is a REAL
// target chosen when the ETB trigger is put on the stack, NOT a resolution-time
// choice. Declared as a `targetRequirement` on the TriggeredAbility (engine:
// `raiseTriggerTargetSelection`, gre/rules.ts); the interpreter locks the
// target across BOTH graveyards as the trigger goes on the stack, so the pick
// is subject to hexproof / protection / becomes-target triggers instead of the
// old resolve()+requestChoice per-graveyard workaround. `type: "card"` = any
// card type; `zone: "graveyard"` + `controller: "any"` = either player's bin.
export const soulGuideLantern: CardDefinition = {
    id: "7c850b94-75c9-4457-8b5e-1193352d6fcb",
    name: "Soul-Guide Lantern",
    rarity: "uncommon",
    oracleText:
        "When this artifact enters, exile target card from a graveyard.\n{T}, Sacrifice this artifact: Exile each opponent's graveyard.\n{1}, {T}, Sacrifice this artifact: Draw a card.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "soul-guide-lantern-etb-exile",
            oracleText:
                "When this artifact enters, exile target card from a graveyard.",
            scope: "self",
            // CR 603.3d — target chosen when the trigger goes on the stack.
            targetRequirement: {
                type: "card",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            resolve: (ctx: SpellContext) => {
                const t = ctx.targets[0];
                if (t?.type !== "graveyard-card" || !t.playerId) return; // CR 608.2b — target gone / no legal target
                ctx.moveCardById(t.playerId, t.id, "graveyard", "exile");
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "soul-guide-lantern-mass-exile",
            oracleText:
                "{T}, Sacrifice this artifact: Exile each opponent's graveyard.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 406 / 400.7 — each opponent's whole graveyard → exile.
                for (const pid of ctx.allPlayerIds) {
                    if (pid === ctx.controller) continue;
                    ctx.moveZone(pid, "graveyard", "exile");
                }
            },
        },
        {
            id: "soul-guide-lantern-draw",
            oracleText: "{1}, {T}, Sacrifice this artifact: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #1264): a single
            // controller draw through the unified suspend-capable draw seam
            // (CR 121.1, ADR 0061).
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};
