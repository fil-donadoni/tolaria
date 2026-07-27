// ELD — blue cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Slice #1337 (PRD #702, ADR 0063) — count-driven SELF-HOST cost reduction.
// CR 601.2f models cost modification applied as the cost is calculated;
// unlike every other `costReduction` consumer (Stone Calendar, Power
// Artifact, Mana Matrix, Planar Gate) — all discovered via a battlefield
// `staticEffects` scan — Emry's reducer is intrinsic to the SPELL being cast,
// which isn't a permanent yet at announcement. `selfCostReduction` is read
// directly off her own `CardDefinition` at the same 601.2f apply site
// (`getCostModifiers`, `gre/state.ts`). "Affinity for artifacts" here is
// authored DATA, not the generalized `affinity` KEYWORD (that keyword +
// convoke + Hogaak are deferred to slice #1338, ADR 0063) — Emry has no
// declared keyword.
// ─────────────────────────────────────────────────────────────────────────────

// Emry, Lurker of the Loch — {2}{U} Legendary Creature — Merfolk Wizard, 1/2
// (ELD). Modern Scryfall oracle text is authoritative (ADR 0004).
//
// DEFERRED (tracked-by: #1650) — the `{T}` ability ("Choose target artifact
// card in your graveyard. You may cast that card this turn.") needs a
// "grant permission to cast a specific GRAVEYARD card this turn" primitive
// that doesn't exist yet; the closest shipped primitive, `grantCastFromExile`
// (#1636, CR 514.2), is EXILE-zone only. Out of scope for #1337 (count-driven
// self cost-reduction seam + its first consumer) — tracked separately.
export const emryLurkerOfTheLoch: CardDefinition = {
    id: "bf4b9a8a-b42a-46fb-b0d0-9cf800f63c8a",
    rarity: "rare",
    name: "Emry, Lurker of the Loch",
    oracleText:
        "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\nWhen Emry enters, mill four cards.\n{T}: Choose target artifact card in your graveyard. You may cast that card this turn. (You still pay its costs. Timing rules still apply.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 2,
    selfCostReduction: {
        costReduction: {
            perCount: { X: 1 },
            countFilter: { types: "Artifact" },
        },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "emry-lurker-of-the-loch-etb",
            oracleText: "When Emry enters, mill four cards.",
            scope: "self",
            effects: [{ op: "mill", player: "controller", count: 4 }],
        }),
    ],
};
