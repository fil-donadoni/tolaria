// M3C — colorless cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Talon Gates of Madara — Land — Gate (Vintage Cube, issue #7253).
// "When this land enters, up to one target creature phases out.
// {T}: Add {C}.
// {1}, {T}: Add one mana of any color.
// {4}: Put this card from your hand onto the battlefield."
//   - ETB: a CR 603.3d targeted self-ETB trigger ("up to one" ⇒ `count`
//     min 0, the controller may choose no target) whose body is the DSL
//     `phaseOut` Op (CR 702.26a), the Vision "Target artifact phases out"
//     shape (vis/blue.cards.ts).
//   - Both mana abilities are CR 605.1a mana abilities (`useStack: false`).
//   - "{4}: Put this card from your hand onto the battlefield" is an
//     ACTIVATED ability that functions only from hand (`activateFromHand`,
//     the Ninjutsu / Cycling shape) — it uses the stack (CR 602), and its
//     body is the hand-carrier `moveZone` (`$source`, `from: "hand"`,
//     `to: "battlefield"`). The land enters via the ability, not the land
//     drop, so it does not consume the turn's land play (CR 305.2) and its
//     ETB trigger still fires.
// hand-tail: Up to one target creature phases out (#7253)
export const talonGatesOfMadara = defineCard(() => ({
    id: "de92facf-762b-4a23-8d5e-bb673b0500c0",
    name: "Talon Gates of Madara",
    rarity: "rare",
    oracleText:
        "When this land enters, up to one target creature phases out.\n{T}: Add {C}.\n{1}, {T}: Add one mana of any color.\n{4}: Put this card from your hand onto the battlefield.",
    types: ["Land"],
    subtypes: ["Gate"],
    triggeredAbilities: [
        enteredTrigger({
            id: "talon-gates-of-madara-etb",
            oracleText:
                "When this land enters, up to one target creature phases out.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: { min: 0, max: 1 },
            },
            effects: [{ op: "phaseOut", target: { target: 0 } }],
        }),
    ],
    activatedAbilities: [
        {
            id: "talon-gates-of-madara-mana-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "talon-gates-of-madara-mana-any",
            oracleText: "{1}, {T}: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
        {
            id: "talon-gates-of-madara-put-from-hand",
            oracleText:
                "{4}: Put this card from your hand onto the battlefield.",
            cost: { mana: { X: 4 } },
            activateFromHand: true,
            useStack: true,
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$source" },
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
}));
