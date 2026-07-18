// SPM — colorless cards, split by colour per ADR 0043. The registry's
// `import * as spm from "./sets/spm"` resolves through spm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { BASIC_LAND_SUBTYPES } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Multiversal Passage — "As this land enters, choose a basic land type. Then
// you may pay 2 life. If you don't, it enters tapped.\nThis land is the
// chosen type." (issue #1306, parent PRD #620.) Composes three EXISTING,
// independent land-entry mechanisms — no new capability:
//  - the CR 614.12 pay-choice, `entersTappedUnlessPay: { life: 2 }`, the
//    shock-land shape (Steam Vents, `gpt/colorless.ts`) — a stackless
//    `land-entry-tapped` PendingChoice `applyPlayLand` suspends BEFORE the
//    zone move, independent of anything below;
//  - the on-entry instance-scoped choice storage `resolve()` protocol
//    (`source.chosenSubtypes`, `ctx.requestOptionChoice` +
//    `ctx.setChosenSubtypes`) that Illusionary Terrain (`ice/blue.ts`)
//    already established as the SANCTIONED pattern for "as ~ enters, choose
//    a basic land type" — no Effect Script Op persists an instance-scoped
//    choice, so this is a documented protocol, not a missing-Op escape
//    hatch;
//  - CR 305.7 layer-4 subtype replacement, `subtype-set` with the
//    computed-output `subtypesFor` form (same kind Illusionary Terrain uses
//    for an OTHER-land swap; here it targets the SOURCE itself — "This land
//    is the chosen type" grants only the subtype, never the Basic
//    supertype, mirroring Phantasmal Terrain's "Enchanted land is the chosen
//    type", `lea/blue.ts`). Once the subtype is set, the land's `{T}: Add
//    [colour]` mana ability is INTRINSIC (CR 305.6, `getBasicLandMana`
//    reads live/effective subtypes) — no `activatedAbilities` needed.
export const multiversalPassage: CardDefinition = {
    id: "f5fb426a-5618-4dd4-9c51-0cc847be8c1d",
    name: "Multiversal Passage",
    rarity: "rare",
    oracleText:
        "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped.\nThis land is the chosen type.",
    types: ["Land"],
    entersTappedUnlessPay: { life: 2 },
    staticEffects: [
        {
            kind: "subtype-set",
            subtypesFor: (target, source) => {
                if (target.id !== source.id) return null;
                const chosen = source.chosenSubtypes?.[0];
                return chosen ? [chosen] : null;
            },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "multiversal-passage-choose-type",
            oracleText: "As this land enters, choose a basic land type.",
            scope: "self",
            // protocol: on-entry instance-scoped choice storage (CR 603.6b) —
            // the same sanctioned class as Illusionary Terrain's
            // `setChosenSubtypes` two-pick (`ice/blue.ts`), narrowed to one
            // pick. No Effect Script Op persists an instance-scoped choice
            // yet, so this stays `resolve()` by the documented protocol, NOT
            // a "missing Op" escape hatch.
            resolve: (ctx) => {
                const options = BASIC_LAND_SUBTYPES.map((s) => ({
                    id: s,
                    label: s,
                }));
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "multiversal-passage-type",
                    options,
                    prompt: "Choose a basic land type.",
                });
                if (chosen === undefined) return;
                ctx.setChosenSubtypes([chosen]);
            },
        }),
    ],
};
