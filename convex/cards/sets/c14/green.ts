// C14 — green cards, split by colour per ADR 0043. The registry's
// `import * as c14 from "./sets/c14"` resolves through c14/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

// Titania, Protector of Argoth — {3}{G}{G} Legendary Creature. "When Titania
// enters, return target land card from your graveyard to the battlefield.
// Whenever a land you control is put into a graveyard from the battlefield,
// create a 5/3 green Elemental creature token." (CR 603.6a ETB + CR 603.6e /
// 603.10 leaves-the-battlefield trigger.)
//
// `TriggeredAbility` carries no `targetRequirement` (only `CardDefinition` /
// `ActivatedAbility` do), so the ETB's "target land card from YOUR graveyard"
// pick is modeled as a `choose-graveyard-card` resolution choice scoped to
// the controller's own graveyard (ADR 0002 precedent: Banishing Light) —
// chooser and zone owner coincide here ("your graveyard"), so the `choice`
// Op's single `player` field (chooser AND zone owner) fits exactly. The
// `choice` Op's graveyard branch now honours a type filter (issue #680 — it
// used to ignore `filter` entirely, unlike hand/library), so "a LAND card"
// is enforced; the reanimation itself is the `moveZone` cards-shape's new
// `from: "graveyard"` source (issue #680), paired with `to: "battlefield"`.
const TITANIA_ID = "224d904a-5972-4152-878a-9a922e7a55b6";

export const titaniaProtectorOfArgoth: CardDefinition = {
    id: TITANIA_ID,
    name: "Titania, Protector of Argoth",
    rarity: "mythic",
    oracleText:
        "When Titania enters, return target land card from your graveyard to the battlefield.\nWhenever a land you control is put into a graveyard from the battlefield, create a 5/3 green Elemental creature token.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elemental"],
    power: 5,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "titania-etb-return-land",
            oracleText:
                "When Titania enters, return target land card from your graveyard to the battlefield.",
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
                    filter: { type: "Land" },
                    count: 1,
                    prompt: "Return target land card from your graveyard to the battlefield.",
                    bind: "$land",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$land" },
                    player: "controller",
                    from: "graveyard",
                    to: "battlefield",
                },
            ],
        },
        {
            id: "titania-land-dies-elemental",
            oracleText:
                "Whenever a land you control is put into a graveyard from the battlefield, create a 5/3 green Elemental creature token.",
            event: "PERMANENT_LEFT",
            matches: (event, self) =>
                event.type === "PERMANENT_LEFT" &&
                event.toZone === "graveyard" &&
                event.controllerId === self.controllerId &&
                event.types.includes("Land"),
            effects: [
                {
                    op: "createToken",
                    controller: "controller",
                    token: {
                        name: "Elemental",
                        types: ["Creature"],
                        subtypes: ["Elemental"],
                        colors: ["G"],
                        power: 5,
                        toughness: 3,
                        imagePrintId: tokenPrintIdFor(TITANIA_ID, "Elemental"),
                    },
                },
            ],
        },
    ],
};
