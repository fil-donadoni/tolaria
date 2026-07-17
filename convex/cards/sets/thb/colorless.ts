// Theros Beyond Death (THB) — Colorless: artifacts with no coloured mana cost,
// split by colour per ADR 0043. The registry's `import * as thb from "./sets/thb"`
// resolves through thb/index.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n` (e.g. {1} → { X: 1 }).
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Soul-Guide Lantern — {1} Artifact. Graveyard hate plus a sacrifice-cantrip
// (CR 603.6a self-ETB trigger exiles one graveyard card; CR 605 two activated
// sacrifice abilities — the mass-exile and the card-draw). The ETB chooses one
// card from a single graveyard, opponents preferred (the "target card from a
// graveyard" choice is modelled per-graveyard rather than across both bins at
// once — faithful to the dominant graveyard-hate use; CR 115.4 free choice of
// which bin is the only simplification).
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
            resolve: (ctx: SpellContext) => {
                const opponents = ctx.allPlayerIds.filter(
                    (p) => p !== ctx.controller
                );
                const ownerOrder = [...opponents, ctx.controller];
                const owner = ownerOrder.find(
                    (p) => ctx.getGraveyardCards(p).length > 0
                );
                if (owner === undefined) return; // no legal target → no effect
                const candidateIds = ctx
                    .getGraveyardCards(owner)
                    .map((c) => c.id);
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `soul-guide-lantern-etb-${ctx.sourceInstanceId}`,
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    zoneOwnerId: owner,
                    candidateIds,
                    count: 1,
                    prompt: "Exile target card from a graveyard.",
                });
                if (picks === undefined) return; // suspended on the choice
                for (const id of picks)
                    ctx.moveCardById(owner, id, "graveyard", "exile");
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
