// AVR — green cards, split by colour per ADR 0043. The registry's
// `import * as avr from "./sets/avr"` resolves through avr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Craterhoof Behemoth — {5}{G}{G}{G} Creature — Beast, 5/5 (AVR 172, Vintage
// Cube top-end green finisher, issue #2372, parent PRD #1525). "Haste\nWhen
// this creature enters, creatures you control gain trample and get +X/+X
// until end of turn, where X is the number of creatures you control."
//
// `staticAbilities: ["haste"]` — CR 702.10, native keyword.
//
// The ETB is a single `forEach{permanents, controller:"controller",
// Creature}` (CR 611.2c/608.2i — Garruk Wildspeaker's −4 shape, `lrw/
// green.ts`, freezes the member SET once at construct entry) whose body
// grants `trample` (`grantAbility`, layer 6) then `pump`s (layer 7c) each
// member `+X/+X`, both `duration: { phase: "end-of-turn" }`. X is a
// non-literal `count` value (`zone: "battlefield", controller: "controller",
// filter: { type: "Creature" }` — the Bloodtithe Harvester dynamic-pump
// shape, `vow/multicolor.ts`) evaluated per member; since the body only
// grants an ability and pumps P/T (it never adds/removes a creature), the
// count is identical on every iteration, which is exactly the "value fixed
// as this ability resolves" one-shot continuous effect CR 611.2c specifies —
// no separate bind/freeze primitive needed. Craterhoof itself has already
// entered the battlefield by the time its own ETB trigger resolves (CR
// 603.6a), so it is counted AND pumped (verified: Craterhoof alone on an
// empty board becomes a 6/6, X = 1).
//
// Union of two already-shipped patterns (forEach+pump+grantAbility from
// Garruk Wildspeaker, non-literal `count` pump from Bloodtithe Harvester) —
// no new Op. The scenario generator's documented explicit skip for a
// non-literal `pump` amount (`scenarioGenerator.ts`'s `pump` case) means the
// canned smoke sweep can't cover this script; a hand-written test lives in
// `convex/cards/sets/avr/__tests__/green.test.ts` per that fallback
// (`.claude/rules/gre-development.md` § Per-Op test regime).
export const craterhoofBehemoth: CardDefinition = {
    id: "a249be17-73ed-4108-89c0-f7e87939beb8", // AVR 172
    rarity: "mythic",
    name: "Craterhoof Behemoth",
    oracleText:
        "Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.",
    manaCost: { G: 3, generic: 5 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 5,
    toughness: 5,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        enteredTrigger({
            id: "craterhoof-behemoth-etb",
            oracleText:
                "When this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "grantAbility",
                            ability: "trample",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: { type: "Creature" },
                                },
                            },
                            toughness: {
                                count: {
                                    zone: "battlefield",
                                    controller: "controller",
                                    filter: { type: "Creature" },
                                },
                            },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
    ],
};
