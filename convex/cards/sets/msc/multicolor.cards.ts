// MSC — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as msc from "./sets/msc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Okoye, Mighty and Adored — {2}{G}{W} Legendary Creature — Human Warrior
// Hero, 3/3 (Vintage Cube, issue #7243).
//   - "You become the monarch" is the plain `becomeMonarch` Op (CR 725.1),
//     an ETB self trigger.
//   - The combat trigger is ONE ability (CR 603.2): a beginning-of-combat
//     phase trigger on its controller's turn targeting a creature
//     (CR 603.3d), which puts the +1/+1 counter (CR 122.1) and then schedules
//     the INSTANCE-scoped repeating delayed trigger on that same announced
//     target (CR 603.7 / 603.7b). It fires once per declaration that has the
//     watched creature attacking the monarch (CR 508.3a), is purged at cleanup
//     (CR 514.2) and dies with the creature (CR 400.7); its body re-reads the
//     creature through a `capture` and grants both keywords until end of turn
//     (CR 611.2a).
// compiler-gap: Whenever that creature attacks the monarch this turn, it (#7218)
export const okoyeMightyAndAdored = defineCard(() => ({
    id: "18ee486e-dc25-4de7-a71f-f11fdf100176",
    name: "Okoye, Mighty and Adored",
    rarity: "rare",
    oracleText:
        "When Okoye enters, you become the monarch.\nAt the beginning of combat on your turn, put a +1/+1 counter on target creature. Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn.",
    manaCost: { G: 1, W: 1, X: 2 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Warrior", "Hero"],
    power: 3,
    toughness: 3,
    triggeredAbilities: [
        enteredTrigger({
            id: "okoye-mighty-and-adored-monarch",
            oracleText: "When Okoye enters, you become the monarch.",
            scope: "self",
            effects: [{ op: "becomeMonarch" }],
        }),
        phaseTrigger({
            id: "okoye-mighty-and-adored-combat",
            oracleText:
                "At the beginning of combat on your turn, put a +1/+1 counter on target creature. Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 1,
                },
                {
                    op: "delayedTrigger",
                    timing: "this-turn-watched-creature-attacks-monarch",
                    oracleText:
                        "Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn.",
                    watch: { target: 0 },
                    capture: { $c: { target: 0 } },
                    effects: [
                        {
                            op: "grantAbility",
                            ability: "double strike",
                            target: { ref: "$c" },
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "grantAbility",
                            ability: "trample",
                            target: { ref: "$c" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
    ],
}));
