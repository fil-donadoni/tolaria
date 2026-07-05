// AFR — white cards, split by colour per ADR 0043. The registry's
// `import * as afr from "./sets/afr"` resolves through afr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Portable Hole — O-Ring-style exile-until-leaves (Banishing Light precedent,
// jou/white.ts), scoped to a nonland permanent an opponent controls with mana
// value 2 or less. `TriggeredAbility` carries no `targetRequirement`, so the
// ETB's target pick is a mid-resolution `choose-permanents` choice over the
// opponent's battlefield, manually filtered by mana value (CR 603.6a / 208.1).
const portableHoleHoldsSomething = (
    _event: unknown,
    self: { id: string },
    state?: { exileHeld?: ReadonlyArray<{ sourceId: string }> }
): boolean => !!state?.exileHeld?.some((b) => b.sourceId === self.id);

export const portableHole: CardDefinition = {
    id: "80fca8c0-ae3e-439e-b202-228b9f360e9a",
    rarity: "uncommon",
    name: "Portable Hole",
    oracleText:
        "When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield.",
    manaCost: { W: 1 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "portable-hole-exile",
            oracleText:
                "When this artifact enters, exile target nonland permanent an opponent controls with mana value 2 or less until this artifact leaves the battlefield.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                if (!opponentId) return;
                const candidates = ctx
                    .getBattlefieldIds(opponentId, { excludeTypes: "Land" })
                    .filter(
                        (id) => ctx.getManaValue({ type: "permanent", id }) <= 2
                    );
                if (candidates.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `portable-hole-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: opponentId,
                    candidateIds: candidates,
                    count: 1,
                    prompt: "Portable Hole: choose a nonland permanent an opponent controls with mana value 2 or less to exile.",
                });
                if (picks === undefined) return; // suspended for the choice
                const targetId = picks[0];
                if (!targetId) return;
                ctx.exileWithAttachments(targetId, {
                    sourceId: ctx.sourceInstanceId,
                    returnTapped: false,
                    includeAttachments: false,
                });
            },
        }),
        leftTrigger({
            id: "portable-hole-return",
            oracleText:
                "When this artifact leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: portableHoleHoldsSomething,
            resolve: (ctx: SpellContext) => {
                ctx.returnExiledForSource(ctx.sourceInstanceId);
            },
        }),
    ],
};
