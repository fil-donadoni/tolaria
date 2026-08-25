// jud — white cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { upkeepDiscardOrElseTrigger } from "../../abilities/upkeepDiscardOrElse";

// Ray of Revelation — {1}{W} Instant. "Destroy target enchantment." with
// Flashback {G} (CR 702.34 — cast from the graveyard for the flashback cost,
// then exile it). The effect is a plain DSL `destroy` on the announced
// enchantment target. Flashback is the engine capability
// (convex/gre/flashback.ts); the `flashback` field carries the alternative
// (off-colour green) cost so the ray can be cast twice, once from hand and
// once from the graveyard. Mirrors ody/red.ts Firebolt's flashback shape.
export const rayOfRevelation: CardDefinition = {
    id: "6d762c8c-6172-4dc0-8fcc-d0f6dd8ca013",
    rarity: "common",
    name: "Ray of Revelation",
    oracleText: "Destroy target enchantment.\nFlashback {G}",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    flashback: { G: 1 },
    targetRequirement: { type: "Enchantment", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
};

// Solitary Confinement (issue #1130, parent PRD #1058) — {2}{W} Enchantment.
// Four clauses, each composed from an already-shipped primitive — no new
// SpellContext primitive, no new StaticEffect kind, no new Op:
//   1. "At the beginning of your upkeep, sacrifice this enchantment unless
//      you discard a card." — CR 603.6a beginning-of-upkeep trigger + CR
//      117.3a "unless you pay [cost]" + CR 701.9 discard, via the shared
//      `upkeepDiscardOrElseTrigger` factory (issue #1129, ice/black.ts's
//      Oath of Lim-Dûl discard branch generalized). `onDecline` sacrifices
//      the source (CR 701.21), mirroring the factory's own fixture test.
//   2. "Skip your draw step." — CR 504 / 614 draw-step skip via
//      `drawStepReplacement: true` (Necropotence / Island Sanctuary
//      precedent, ice/black.ts). The skip is unconditional (no "may"), so
//      the flag alone suffices.
//   3. "You have shroud." — CR 702.18 shroud applied to a PLAYER via CR
//      115.4, the player-scoped `player-guard` StaticEffect (issue #1128).
//      `cantBeTargeted: true`; `appliesTo` defaults to `"controller"` — the
//      card's own controller, read by `playerHasShroud`
//      (`convex/gre/permanentGuard.ts`).
//   4. "Prevent all damage that would be dealt to you." — CR 614/615, an
//      unconditional damage-consuming `replacementEffects[]` entry scoped to
//      the controller (Divine Presence / Energy Storm precedent,
//      inv/white.ts, ice/white.ts): `appliesTo` filters the event to a
//      player-target matching `self.controllerId`; `replace` consumes it
//      (CR 615 — the damage is never dealt).
export const solitaryConfinement: CardDefinition = {
    id: "e7a8eb7a-eb3f-405e-8f44-d8ea64d76386",
    rarity: "rare",
    name: "Solitary Confinement",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you discard a card.\nSkip your draw step.\nYou have shroud. (You can't be the target of spells or abilities.)\nPrevent all damage that would be dealt to you.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    drawStepReplacement: true,
    staticEffects: [
        {
            kind: "player-guard",
            id: "solitary-confinement-shroud",
            cantBeTargeted: true,
        },
    ],
    replacementEffects: [
        {
            id: "solitary-confinement-damage-prevention",
            oracleText: "Prevent all damage that would be dealt to you.",
            eventKind: "damage",
            damageEffectKind: "prevention",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "player" &&
                event.target.id === self.controllerId,
            replace: () => ({ kind: "consumed" }),
        },
    ],
    triggeredAbilities: [
        upkeepDiscardOrElseTrigger({
            id: "solitary-confinement-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice this enchantment unless you discard a card.",
            prompt: "Discard a card?",
            onDecline: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};
