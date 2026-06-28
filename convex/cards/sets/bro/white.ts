// BRO (The Brothers' War) — white cards, split by colour per ADR 0043. The
// registry's `import * as bro from "./sets/bro"` resolves through bro/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition, SpellContext } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Loran of the Third Path — {2}{W} Legendary Creature 2/1 with vigilance.
// "When Loran enters, destroy up to one target artifact or enchantment.
//  {T}: You and target opponent each draw a card."
// CR 603.6a ETB triggered ability; the "up to one target" is chosen at
// resolution via a `choose-permanents` requestChoice over both battlefields
// (CR 115 — a triggered ability picks its target when it would go on the stack;
// modelled here as a resolve-time pick, matching the engine idiom for targeted
// triggers). The {T} ability draws for the controller and the chosen opponent
// (CR 605 activated ability, CR 121.1 draw).
export const loranOfTheThirdPath: CardDefinition = {
    id: "59faa45d-868b-4bc7-934c-0e077642e129",
    rarity: "rare",
    name: "Loran of the Third Path",
    oracleText:
        "Vigilance\nWhen Loran enters, destroy up to one target artifact or enchantment.\n{T}: You and target opponent each draw a card.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Artificer"],
    power: 2,
    toughness: 1,
    staticAbilities: ["vigilance"],
    triggeredAbilities: [
        enteredTrigger({
            id: "loran-etb-destroy",
            oracleText:
                "When Loran enters, destroy up to one target artifact or enchantment.",
            scope: "self",
            resolve: (ctx: SpellContext) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `loran-etb-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: ["Artifact", "Enchantment"] },
                    allControllers: true,
                    count: { min: 0, max: 1 },
                    prompt: "Destroy up to one target artifact or enchantment (or none).",
                });
                if (picks === undefined) return; // suspended on the choice
                for (const id of picks) {
                    ctx.destroy({ type: "permanent", id });
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "loran-draw",
            oracleText: "{T}: You and target opponent each draw a card.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
                const t = ctx.targets[0];
                if (t?.type === "player") ctx.drawCards(t.id, 1);
            },
        },
    ],
};
