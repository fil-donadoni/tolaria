// c19 — white cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";

// Sevinne's Reclamation — {2}{W} Sorcery. "Return target permanent card with
// mana value 3 or less from your graveyard to the battlefield. If this spell was
// cast from a graveyard, you may copy this spell and may choose a new target for
// the copy." with Flashback {4}{W} (CR 702.34). The reanimation is a graveyard
// target (CR 400.7) filtered to permanent cards of MV ≤ 3; when the spell is
// itself flashed back (cast from the graveyard, CR 702.34a), its controller may
// copy it (CR 707.12) and retarget the copy — the card's whole point.
//
// protocol card: the copy clause is conditional on the cast zone
// (`wasCastFromGraveyard`, CR 702.34) and drives the "copy this spell + choose a
// new target" machinery (`copyResolvingSpell` / `requestCopyRetarget`,
// CR 707.12) behind a free "you may" — none of which the Op vocabulary expresses
// (there is no spell-copy Op). Split into resolveSteps so the copy may-choice
// suspends without re-reanimating.
export const sevinnesReclamation: CardDefinition = {
    id: "7e68f4df-88ce-4e09-a03c-7edf40bff167",
    rarity: "rare",
    name: "Sevinne's Reclamation",
    oracleText:
        "Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.\nFlashback {4}{W}",
    manaCost: { X: 2, W: 1 },
    types: ["Sorcery"],
    flashback: { X: 4, W: 1 },
    targetRequirement: {
        type: ["Creature", "Artifact", "Enchantment", "Land", "Planeswalker"],
        count: 1,
        zone: "graveyard",
        controller: "you",
        mvFilter: { max: 3 },
    },
    resolveSteps: [
        // Step 0 — reanimate the targeted permanent card (CR 400.7). The card
        // returns to the battlefield under its owner's control (the caster,
        // `controller: "you"`).
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (target?.type !== "graveyard-card" || !target.playerId) return;
            ctx.returnToBattlefield(target.playerId, target.id, "graveyard");
        },
        // Step 1 — CR 702.34a / 707.12: only when this spell was cast from a
        // graveyard (flashed back), its controller may copy it and retarget the
        // copy. Isolated in its own step so the may-choice suspension never
        // re-runs the reanimation.
        (ctx: SpellContext) => {
            if (!ctx.wasCastFromGraveyard()) return;
            const copy = ctx.requestMayPay({
                playerId: ctx.controller,
                choiceId: "sevinnes-reclamation-copy",
                prompt: "Copy Sevinne's Reclamation? (you may choose a new target for the copy)",
            });
            if (copy === undefined) return; // suspended on the choice
            if (!copy) return; // declined
            const copyId = ctx.copyResolvingSpell();
            if (copyId) ctx.requestCopyRetarget(copyId);
        },
    ],
};
