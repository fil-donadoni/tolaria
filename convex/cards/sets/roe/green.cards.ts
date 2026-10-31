// ROE — green cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import {
    nthSpellOfTypeThisTurn,
    spellCastTrigger,
} from "../../abilities/triggers/spellCastTrigger";

const secondCreatureSpell = nthSpellOfTypeThisTurn(2, { types: "Creature" });

// Vengevine — "Haste. Whenever you cast a spell, if it's the second creature
// spell you cast this turn, you may return this card from your graveyard to
// the battlefield." The ability moves the card out of the graveyard, so it
// functions there (CR 113.6m) — `zone: "graveyard"` — and nowhere else. "If
// it's the second creature spell" is an intervening if (CR 603.4): checked
// as the spell becomes cast (CR 601.2i, `condition`) and again on resolution
// (`interveningIf`), both against the caster's per-type tally snapshotted on
// the cast event, so a third creature spell cast in response does not undo it.
// hand-tail: it's the second creature spell you cast this turn (#1968)
export const vengevine = defineCard(() => ({
    id: "51eb9f05-9d5a-4196-9329-626ce4793c42",
    name: "Vengevine",
    rarity: "mythic",
    oracleText:
        "Haste\nWhenever you cast a spell, if it's the second creature spell you cast this turn, you may return this card from your graveyard to the battlefield.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 3,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        {
            ...spellCastTrigger({
                id: "vengevine-return",
                oracleText:
                    "Whenever you cast a spell, if it's the second creature spell you cast this turn, you may return this card from your graveyard to the battlefield.",
                scope: "you",
                condition: secondCreatureSpell,
                interveningIf: secondCreatureSpell,
                effects: [
                    {
                        op: "mayPay",
                        player: "controller",
                        prompt: "Return Vengevine from your graveyard to the battlefield?",
                        bind: "$return",
                    },
                    {
                        op: "if",
                        predicate: { binding: "$return" },
                        then: [
                            {
                                op: "moveZone",
                                target: { ref: "$source" },
                                to: "battlefield",
                            },
                        ],
                    },
                ],
            }),
            zone: "graveyard",
        },
    ],
}));
