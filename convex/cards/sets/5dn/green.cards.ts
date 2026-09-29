// 5dn — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Eternal Witness — {1}{G}{G} Creature. "When this creature enters, you may
// return target card from your graveyard to your hand." (CR 603.6a ETB,
// 117.3a optional.)
//
// `TriggeredAbility` carries no `targetRequirement`, so the pick is modeled
// as a `choose-graveyard-card` resolution choice (ADR 0002 precedent:
// Banishing Light) scoped to the controller's own graveyard (chooser = zone
// owner, "your graveyard"). The "you may" / "any card" wording needs no new
// capability: `count: { min: 0, max: 1 }` (issue #677) is already the
// engine's optional-pick idiom, and no `filter` at all admits any card type
// (Eternal Witness returns lands, artifacts, spells — not just creatures).
// `moveZone`'s cards-shape `from: "graveyard"` (issue #680) does the move.
export const eternalWitness: CardDefinition = {
    id: "c7e10ca7-1e5d-4224-82cf-798a4d436d72",
    name: "Eternal Witness",
    rarity: "uncommon",
    oracleText:
        "When this creature enters, you may return target card from your graveyard to your hand.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Shaman"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "eternal-witness-etb-regrow",
            oracleText:
                "When this creature enters, you may return target card from your graveyard to your hand.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) =>
                event.type === "PERMANENT_ENTERED" &&
                event.instanceId === self.id,
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    count: { min: 0, max: 1 },
                    prompt: "You may return target card from your graveyard to your hand.",
                    bind: "$regrown",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$regrown" },
                    player: "controller",
                    from: "graveyard",
                    to: "hand",
                },
            ],
        },
    ],
};
