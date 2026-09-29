// dsk — white cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/P-T are from Scryfall (id = DSK paper printing).

import type { CardDefinition } from "../../types";
import { enduringReturnTrigger } from "../../abilities/enduringReturn";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// ─────────────────────────────────────────────────────────────────────────
// Enduring Innocence (issue #2084, ADR 0087) — the DSK "Enduring" cycle's
// one-shot layer-4 card-type SET.
// ─────────────────────────────────────────────────────────────────────────
//
// The cycle's shared dies-trigger — and the whole CR 205.1a / 613.1d / 611.2c
// derivation behind it — lives in `abilities/enduringReturn.ts` (issue #2085,
// the extract-on-the-second rule): five cards print the identical clause, so
// the Effect Script is authored once and each card only names itself.
export const enduringInnocence: CardDefinition = {
    id: "08f79439-b8f8-418f-9772-26d81844749e",
    name: "Enduring Innocence",
    rarity: "rare",
    manaCost: { X: 1, W: 2 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Sheep", "Glimmer"],
    power: 2,
    toughness: 1,
    oracleText:
        "Lifelink\nWhenever one or more other creatures you control with power 2 or less enter, draw a card. This ability triggers only once each turn.\nWhen Enduring Innocence dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)",
    staticAbilities: ["lifelink"],
    triggeredAbilities: [
        // CR 603.3b — "whenever ONE OR MORE other creatures … enter" collapses
        // a simultaneous batch of entries to a single trigger
        // (`oncePerEventBatch`), and CR 603.2's per-turn TRIGGER cap
        // ("only once each turn") is `maxTriggersPerTurn: 1` — a cap on
        // TRIGGERING, so past it no stack item is created at all.
        // "with power 2 or less" is read off the entering permanent's
        // EFFECTIVE power snapshotted on the event (CR 613.4), so a creature
        // entering under an anthem or with +1/+1 counters is measured with
        // continuous effects applied.
        enteredTrigger({
            id: "enduring-innocence-draw",
            oracleText:
                "Whenever one or more other creatures you control with power 2 or less enter, draw a card. This ability triggers only once each turn.",
            scope: "another-yours",
            filter: { types: ["Creature"], powerAtMost: 2 },
            oncePerEventBatch: true,
            maxTriggersPerTurn: 1,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
        // The cycle's shared dies-trigger (CR 700.4 / 603.4 intervening-if,
        // CR 205.1a / 613.1d type-line SET) — `abilities/enduringReturn.ts`.
        enduringReturnTrigger({
            id: "enduring-innocence-return",
            cardName: "Enduring Innocence",
        }),
    ],
};
