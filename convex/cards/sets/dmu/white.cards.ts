// DMU — white cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import {
    CASTABLE_PERMANENT_TYPES,
    defineCard,
    PERMANENT_TYPES,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";
import { holdsExileBundle } from "../../abilities/exileBundle";

// Leyline Binding — {5}{W} Enchantment. "Flash. Domain — This spell costs {1}
// less to cast for each basic land type among lands you control. When this
// enchantment enters, exile target nonland permanent an opponent controls
// until this enchantment leaves the battlefield."
//
// Two shipped primitives, no new engine work:
//
//   - The cost clause is `CardDefinition.selfCostReduction` in the
//     `countMode: "domain"` shape (`CensusDrivenCostReduction`,
//     `cards/types.ts`, issue #1958 — Draco / Stratadon, `pls/colorless.cards.ts`).
//     Domain counts distinct basic land TYPES (CR 305.6 — Plains, Island,
//     Swamp, Mountain, Forest), not permanents: three Forests are ONE, a
//     single Tundra is TWO. Resolved by `resolveCostReductionGeneric`
//     (`gre/state.ts`) through the same `countDomain` scan every other Domain
//     site uses, and applied at the ONE CR 601.2f site
//     (`getCostModifiers`/`applyCostModifiers`), so the reduction is visible to
//     castability, payment, auto-tap and the bot alike. CR 601.2f floors the
//     mana component at {0} and reduces only GENERIC mana, so the {W} pip
//     survives every reduction: at Domain 5 the card costs exactly {W}, never
//     less.
//   - The ETB is the O-Ring shape verbatim (Banishing Light, `jou/white.cards.ts`):
//     a real announced target (CR 603.3d) exiled host-only through the ADR
//     0028 exile-and-return bundle keyed to `$source`, returned by the
//     leaves-the-battlefield trigger (CR 603.7a). The bundle is keyed to the
//     source, not to a turn, so the return still fires when this enchantment
//     leaves in response to its own ETB trigger — the ETB resolves against a
//     source that is already gone, exiles nothing, and the leave trigger's
//     `holdsExileBundle` gate finds no bundle to return.
export const leylineBinding = defineCard(() => ({
    id: "3c3ac3dd-35db-447f-8674-37b4680a1ef7",
    name: "Leyline Binding",
    rarity: "rare",
    oracleText:
        "Flash (You may cast this spell any time you could cast an instant.)\nDomain — This spell costs {1} less to cast for each basic land type among lands you control.\nWhen this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
    manaCost: { X: 5, W: 1 },
    types: ["Enchantment"],
    staticAbilities: ["flash"],
    selfCostReduction: {
        costReduction: { perCount: { X: 1 }, countMode: "domain" },
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "leyline-binding-exile",
            oracleText:
                "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
            scope: "self",
            targetRequirement: {
                type: [...PERMANENT_TYPES],
                count: 1,
                excludeTypes: "Land",
                controller: "opponent",
            },
            effects: [{ op: "exileWithAttachments", target: { target: 0 } }],
        }),
        leftTrigger({
            id: "leyline-binding-return",
            oracleText:
                "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            scope: "self",
            condition: holdsExileBundle,
            effects: [{ op: "returnExiledForSource" }],
        }),
    ],
}));

// Serra Paragon — {2}{W}{W} Creature — Angel 3/4 (issue #1239). Every clause
// is data over shipped seams:
//
//   - Flying — the keyword.
//   - "Once during each of your turns, you may play a land from your graveyard
//     or cast a permanent spell with mana value 3 or less from your graveyard"
//     — a row on the one graveyard play permission record (ADR 0093): both
//     actions, the cast restricted to castable permanent types at mana value
//     3 or less, once per turn (ONE use covers either action, spent against
//     this source), own turn only. A static ability: no stack (CR 305.1 for
//     the land, CR 601.3 for the cast).
//   - "If you do, it gains '…'" — the record's `grantsOnUse` rider, naming the
//     template below. The commit that spends the permission stamps the rider
//     on the card played or cast with it, and the permanent's entry turns it
//     into an indefinite triggered-ability grant — so the permanent keeps the
//     ability even if Serra Paragon leaves first (the card's ruling), and a
//     countered spell carries nothing.
//   - The granted ability is the shared leave trigger, self-scoped to the
//     battlefield → graveyard departure (any permanent type, CR 603.10a looks
//     back for it); `$event.card` names the card in the graveyard (CR 400.7e).
// hand-tail: Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life." (#1239)
export const serraParagon = defineCard(() => ({
    id: "ce295f1e-fb31-4275-a5d3-8c6f29afff40",
    name: "Serra Paragon",
    rarity: "mythic",
    oracleText:
        'Flying\nOnce during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."',
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flying"],
    graveyardPlayPermission: {
        actions: ["play-land", "cast"],
        cardTypes: [...CASTABLE_PERMANENT_TYPES],
        maxManaValue: 3,
        oncePerTurn: true,
        yourTurnOnly: true,
        grantsOnUse: "serra-paragon-granted-exile",
    },
    triggeredGrantTemplates: [
        leftTrigger({
            id: "serra-paragon-granted-exile",
            oracleText:
                "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life.",
            scope: "self",
            toZone: "graveyard",
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$event.card" },
                    to: "exile",
                },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        }),
    ],
}));
