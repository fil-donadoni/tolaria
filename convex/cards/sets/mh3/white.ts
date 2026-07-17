// MH3 — white cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Guide of Souls — {W} Creature — Human Cleric, 1/2 (MH3, issue #1194).
// "Whenever another creature you control enters, you gain 1 life and get {E}
// (an energy counter). Whenever you attack, you may pay {E}{E}{E}. When you
// do, put two +1/+1 counters and a flying counter on target attacking
// creature. It becomes an Angel in addition to its other types."
//
// Was a tracked stop-and-issue stub (#1194) blocked on two engine gaps, both
// closed by this issue:
//   (1) keyword counters that GRANT their ability (CR 122.1c / 613.4d) — a
//       "flying" counter placed by the `counters` Op now grants flying via
//       `SpellContext.addCounter`'s keyword-counter sync
//       (`mechanicsRegistry.getKeywordCounterGrant`).
//   (2) an indefinite type-add continuous effect (CR 613.1d, layer 4) — the
//       new `addSubtype` Op / `SpellContext.addSubtype` primitive.
// The fixed `{E}{E}{E}` pay + reflexive "When you do" is `mayPay` (cost.energy,
// issue #1194's third leg) + `if $paid`.
export const guideOfSouls: CardDefinition = {
    id: "76c3cad2-1e25-4abe-878d-9194de6fcc27",
    rarity: "rare",
    name: "Guide of Souls",
    oracleText:
        "Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).\nWhenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "guide-of-souls-etb",
            oracleText:
                "Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).",
            scope: "another-yours",
            filter: { types: "Creature" },
            effects: [
                { op: "gainLife", player: "controller", amount: 1 },
                { op: "getEnergy", player: "controller", amount: 1 },
            ],
        }),
        {
            id: "guide-of-souls-attack",
            oracleText:
                "Whenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d (issue #1193) — the target is chosen when this
            // triggered ability is put on the stack, regardless of the later
            // may-pay decision (CR 601.2c / 118.4).
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackingPlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { energy: 3 },
                    prompt: "Pay {E}{E}{E}?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { binding: "$paid" },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            count: 2,
                            target: { target: 0 },
                        },
                        {
                            op: "counters",
                            action: "add",
                            counter: "flying",
                            count: 1,
                            target: { target: 0 },
                        },
                        {
                            op: "addSubtype",
                            target: { target: 0 },
                            subtype: "Angel",
                        },
                    ],
                },
            ],
        },
    ],
};
