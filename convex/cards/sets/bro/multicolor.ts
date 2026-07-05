// bro — multicolor cards (ADR 0043 colour split). The registry's
// `import * as bro from "./sets/bro"` resolves through bro/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

// Third Path Iconoclast — {U}{R} Creature — Human Monk 2/1 (Vintage Cube token
// maker, issue #678). "Whenever you cast a noncreature spell, create a 1/1
// colorless Soldier artifact creature token." A SPELL_CAST triggered ability
// (CR 603.2 + 601.2i); the effect is a plain spec-driven `createToken`
// (CR 111 / 707.1). The trigger's `matches` gates on caster scope ("you") and
// a noncreature filter — the effect never inspects the firing event, so it is
// authored DSL-first as `effects` (ADR 0045), not a `resolve()` closure.
const THIRD_PATH_ICONOCLAST_ID = "f1a21287-e244-4960-84fb-c4f6e5c346d9";

export const thirdPathIconoclast: CardDefinition = {
    id: THIRD_PATH_ICONOCLAST_ID,
    name: "Third Path Iconoclast",
    rarity: "uncommon",
    oracleText:
        "Whenever you cast a noncreature spell, create a 1/1 colorless Soldier artifact creature token.",
    manaCost: { U: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Monk"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        {
            id: "third-path-iconoclast-token",
            oracleText:
                "Whenever you cast a noncreature spell, create a 1/1 colorless Soldier artifact creature token.",
            event: "SPELL_CAST",
            // CR 603.2: fires only when the source's controller is the caster
            // and the cast spell is NOT a creature spell (CR 601.2i).
            matches: (event: GameEvent, self: PermanentView): boolean =>
                event.type === "SPELL_CAST" &&
                event.casterId === self.controllerId &&
                !event.spellTypes.includes("Creature"),
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Soldier",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Soldier"],
                        power: 1,
                        toughness: 1,
                        imagePrintId: tokenPrintIdFor(
                            THIRD_PATH_ICONOCLAST_ID,
                            "Soldier"
                        ),
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};
