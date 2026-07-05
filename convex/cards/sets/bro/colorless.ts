// bro — colorless cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Haywire Mite — {1} Artifact Creature — Insect, 1/1 (Vintage Cube FREE:
// ETB/dies/attack triggers, issue #679). "When this creature dies, you gain
// 2 life. {G}, Sacrifice this creature: Exile target noncreature artifact or
// noncreature enchantment." CR 603.2 death trigger (DSL `gainLife` Op) +
// CR 605 activated ability with a self-sacrifice cost (DSL `exile` Op). Both
// Ops are already interpreter-exercised — no hand-written test required
// (per-Op regime, ADR 0046).
export const haywireMite: CardDefinition = {
    id: "847a175e-ead1-4596-baf3-5f7f57859e0b",
    name: "Haywire Mite",
    rarity: "uncommon",
    oracleText:
        "When this creature dies, you gain 2 life.\n{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.",
    manaCost: { X: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "haywire-mite-death",
            oracleText: "When this creature dies, you gain 2 life.",
            event: "CREATURE_DIED",
            matches: (event, self) =>
                event.type === "CREATURE_DIED" &&
                event.creatureInstanceId === self.id,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
    activatedAbilities: [
        {
            id: "haywire-mite-sac",
            oracleText:
                "{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.",
            cost: { mana: { G: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                excludeTypes: "Creature",
                count: 1,
            },
            effects: [{ op: "exile", target: { target: 0 } }],
        },
    ],
};

// Portal to Phyrexia — {9} Artifact. "When this artifact enters, each
// opponent sacrifices three creatures of their choice. At the beginning of
// your upkeep, put target creature card from a graveyard onto the
// battlefield under your control. It's a Phyrexian in addition to its other
// types." Blocked: the ETB is actually free (2-player-only —
// `choice(kind: "sacrifice-permanents", player: "opponent")` + `sacrifice`,
// the Innocent Blood pattern), but the recurring upkeep reanimation needs a
// CROSS-PLAYER graveyard pick — "a graveyard" (not "your graveyard") means the
// chooser (the controller) and the zone owner (either player) can differ, and
// `choice`'s `player` field conflates the two (works for "your graveyard" —
// Titania, Exhume — not "a graveyard") (issue #920).
// tracked-by: #920
// export const portalToPhyrexia: CardDefinition = {
//     id: "5f608efc-0dbc-4cc3-aadd-ed473bfc29ab",
//     name: "Portal to Phyrexia",
//     rarity: "mythic",
//     manaCost: { X: 9 },
//     types: ["Artifact"],
// };
