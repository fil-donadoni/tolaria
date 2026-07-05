// clu — red cards (ADR 0043 colour split).

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Headliner Scarlett — {3}{R} Legendary Creature — Human Warlock, 3/3, haste
// (Vintage Cube FREE: ETB/dies/attack triggers, issue #679). "Haste. When
// Headliner Scarlett enters, creatures target player controls can't block
// this turn. At the beginning of your upkeep, exile the top card of your
// library face down. You may look at and play that card this turn."
//
// SIMPLIFICATION (flagged, CR 115 "target player"): `TriggeredAbility`
// carries no `targetRequirement`/player-choice zone-pick kind (no
// `ZonePickKind` targets a player), and this engine is 2-player/solo only
// (CLAUDE.md — no 3+ player multiplayer), so "target player" always
// resolves to the opponent — the only choice that is ever strategically
// live. The golden path (an opponent's creatures can't block) is faithful.
//
// PROTOCOL (recurring impulse-draw — no Op skin, precedent: Elkin Bottle /
// Ice Cauldron, ice/colorless.ts): the upkeep trigger composes
// `peekLibraryTop` + `exileFaceDown` + `grantCastFromExile`. Matching every
// other shipped impulse card, the "this turn" window end is not auto-revoked
// on a timer (no play-permission-expiry primitive exists yet) — the play
// permission persists while the card remains in exile.
export const headlinerScarlett: CardDefinition = {
    id: "be77b98a-dd79-477c-8ab2-7ebf5637a89e",
    name: "Headliner Scarlett",
    rarity: "rare",
    oracleText:
        "Haste\nWhen Headliner Scarlett enters, creatures target player controls can't block this turn.\nAt the beginning of your upkeep, exile the top card of your library face down. You may look at and play that card this turn.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warlock"],
    power: 3,
    toughness: 3,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        enteredTrigger({
            id: "headliner-scarlett-etb",
            oracleText:
                "When Headliner Scarlett enters, creatures target player controls can't block this turn.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!opponentId) return;
                for (const id of ctx.getBattlefieldIds(opponentId, {
                    types: "Creature",
                })) {
                    ctx.setCantBlockThisTurn({ type: "permanent", id });
                }
            },
        }),
        phaseTrigger({
            id: "headliner-scarlett-upkeep",
            oracleText:
                "At the beginning of your upkeep, exile the top card of your library face down. You may look at and play that card this turn.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx: SpellContext, _event, scopedPlayerId) => {
                const top = ctx.peekLibraryTop(scopedPlayerId, 1);
                if (top.length === 0) return; // empty library
                const cardId = top[0];
                // CR 406.3 — exiled hidden to the opponent, known to controller.
                ctx.exileFaceDown(
                    scopedPlayerId,
                    cardId,
                    "library",
                    scopedPlayerId
                );
                ctx.grantCastFromExile(cardId, scopedPlayerId);
            },
        }),
    ],
};
