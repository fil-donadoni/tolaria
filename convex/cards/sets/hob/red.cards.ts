// HOB — red cards, split by colour per ADR 0043. The registry's
// `import * as hob from "./sets/hob/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../../../convex/cards/types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Gandalf, Goblins' Bane // Flameshape — {2}{R} Legendary Creature — Avatar
// Wizard, 2/3 (Vintage Cube, issue #7233). One card (CR 715.2c): the Adventure
// half is the `insetSpell`, built into the `${id}#adventure` twin by
// `cards/insetSpell.ts`.
//   - "Whenever you cast a noncreature spell": the shared `spellCastTrigger`
//     (CR 603.2 + 601.2i), `scope: "you"` + `excludeTypes: "Creature"`.
//     "Gandalf gets +1/+1 until end of turn" is a `pump` on `$source`; the
//     1 damage is sourced from the trigger item, which carries Gandalf's
//     characteristics.
//   - Flameshape: `exileTopOfLibrary { faceDown: true }` (CR 406.3, issue
//     #7295) exiles exactly the top two, known to the controller alone (they
//     looked), then `grantCastFromExile` with a `control` condition (CR 611.2b):
//     "for as long as they remain exiled" is the `while-exiled` window, "you
//     may play them if you control a Wizard" is re-read at every play attempt,
//     and `includesLand` covers "play" (CR 305.1 — a land among them).
// compiler-gap: Look at the top two cards of your library and exile them face down (#7216)
export const gandalfGoblinsBane = defineCard(() => ({
    id: "9b0d29a1-7da9-4fb3-8536-8ff8d8acae0b", // HOB
    rarity: "rare",
    name: "Gandalf, Goblins' Bane",
    oracleText:
        "Whenever you cast a noncreature spell, Gandalf gets +1/+1 until end of turn and deals 1 damage to each opponent.",
    manaCost: { X: 2, R: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Avatar", "Wizard"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        spellCastTrigger({
            id: "gandalf-goblins-bane-noncreature-cast",
            oracleText:
                "Whenever you cast a noncreature spell, Gandalf gets +1/+1 until end of turn and deals 1 damage to each opponent.",
            scope: "you",
            filter: { excludeTypes: "Creature" },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
                { op: "dealDamage", amount: 1, to: { player: "opponent" } },
            ],
        }),
    ],
    // CR 715.2 — the inset frame; `kind: "adventure"` makes the parent offer
    // the cast option (CR 715.3).
    insetSpell: {
        kind: "adventure",
        name: "Flameshape",
        manaCost: { X: 1, R: 1 },
        types: ["Sorcery"],
        subtypes: ["Adventure"],
        oracleText:
            "Look at the top two cards of your library and exile them face down. For as long as they remain exiled, you may play them if you control a Wizard.",
        effects: [
            {
                op: "exileTopOfLibrary",
                player: "controller",
                count: 2,
                faceDown: true,
                linkToSource: true,
            },
            {
                op: "grantCastFromExile",
                card: { exiledWithSource: true },
                player: "controller",
                window: "while-exiled",
                includesLand: true,
                condition: {
                    kind: "control",
                    filter: { subtypes: ["Wizard"] },
                },
            },
        ],
    },
}));
