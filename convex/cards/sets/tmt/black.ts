// TMT — black cards, split by colour per ADR 0043. The registry's
// `import * as tmt from "./sets/tmt"` resolves through tmt/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    TriggeredAbility,
} from "../../../../convex/cards/types";

// Super Shredder — {1}{B} Legendary Creature — Mutant Ninja Human, 1/1
// (issue #681, Cube FREE +1/+1 counters). "Menace\nWhenever another
// permanent leaves the battlefield, put a +1/+1 counter on Super Shredder."
// (CR 702.111 menace; CR 603.2 PERMANENT_LEFT trigger, no zone/controller
// restriction — ANY permanent leaving, not just deaths — CR 122 counter
// placement on self.) Pure DSL: the effect doesn't need to read the firing
// event, so the trigger's `effects` reads only `$source`.
function superShredderCounterTrigger(): TriggeredAbility {
    return {
        id: "super-shredder-counter",
        oracleText:
            "Whenever another permanent leaves the battlefield, put a +1/+1 counter on Super Shredder.",
        event: "PERMANENT_LEFT",
        matches: (event, self) =>
            event.type === "PERMANENT_LEFT" && event.instanceId !== self.id,
        effects: [
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { ref: "$source" },
                count: 1,
            },
        ],
    };
}

export const superShredder: CardDefinition = {
    id: "37a497b8-e908-4ddc-996e-a8470df72afb",
    name: "Super Shredder",
    rarity: "mythic",
    oracleText:
        "Menace\nWhenever another permanent leaves the battlefield, put a +1/+1 counter on Super Shredder.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Mutant", "Ninja", "Human"],
    power: 1,
    toughness: 1,
    staticAbilities: ["menace"],
    triggeredAbilities: [superShredderCounterTrigger()],
};
