import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { holdsExileBundle } from "../../abilities/exileBundle";

// Banishing Light — O-Ring-style exile-until-leaves (Journey into Nyx).
//
// The ETB trigger (CR 603.6a) exiles a chosen nonland permanent an opponent
// controls keyed to this enchantment (ADR 0028 exile-and-return bundle), and
// the leaves-the-battlefield trigger (CR 603.7a) returns it. Crucially this
// exiles ONLY the host (`includeAttachments: false`, CR 701.18): unlike
// Tawnos's Coffin the host's Auras are NOT bundled, so they fall to the
// graveyard via the orphan-aura SBA (CR 704.5n) and its Equipment detaches and
// stays on the battlefield — neither is exiled nor returned. The exiled card is
// surfaced pinned to this enchantment on the board via the mechanism-agnostic
// `exiledByPermanentId` projection link (derived from the `exileHeld` bundle's
// `sourceId`), the same affordance Ice Cauldron's noted card uses.
//
// The return half is an armed delayed trigger: its condition (`holdsExileBundle`,
// shared with the Parallax cycle) gates on the bundle's existence so it never
// fires with nothing held.
export const banishingLight: CardDefinition = {
    id: "fbaa4800-30cc-4a80-a6cc-9a24ada9eb40",
    rarity: "uncommon",
    name: "Banishing Light",
    oracleText:
        "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        // CR 603.6a — ETB trigger. `TriggeredAbility` carries no
        // `targetRequirement`, so the "target nonland permanent an opponent
        // controls" pick is modeled as a `choose-permanents` resolution choice
        // over the opponent's battlefield (Erhnam Djinn / Oubliette precedent):
        // the candidate set is computed live, and protection/hexproof are not
        // re-checked — acceptable for the current pool, no new target type.
        enteredTrigger({
            id: "banishing-light-exile",
            oracleText:
                "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!opponentId) return;
                // Nonland permanents the opponent controls (CR 603.3d). No
                // legal pick → the trigger does nothing (it still resolved).
                const candidates = ctx.getBattlefieldIds(opponentId, {
                    excludeTypes: "Land",
                });
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `banishing-light-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: opponentId,
                    candidateIds: candidates,
                    count: 1,
                    prompt: "Banishing Light: choose a nonland permanent an opponent controls to exile.",
                });
                if (picks === undefined) return; // suspended for the choice
                const targetId = picks[0];
                if (!targetId) return;
                // CR 701.18 — host-only exile (auras die, equipment detaches);
                // ADR 0028 arms the return keyed to this card.
                ctx.exileWithAttachments(targetId, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: false,
                    includeAttachments: false,
                });
            },
        }),
        leftTrigger({
            // CR 603.7a — return the exiled permanent when this leaves play.
            id: "banishing-light-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: holdsExileBundle,
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
    ],
};
