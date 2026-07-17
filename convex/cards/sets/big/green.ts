// BIG — green cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Sandstorm Salvager — {2}{G} Creature — Human Artificer, 1/1 (Cube FREE
// residue token-maker, issue #1304). "When this creature enters, create a
// 3/3 colorless Golem artifact creature token. {2}, {T}: Put a +1/+1 counter
// on each creature token you control. They gain trample until end of turn."
// (CR 603.6a ETB + 701.7 Create; CR 122.6 counter placement + CR 611.2c
// duration-scoped keyword grant, both mass-applied via `forEach` over
// "creature tokens you control", `PermanentFilter.isToken`/`EffectCardFilter.
// isToken`, issue #920.) Fully DSL — every Op here (`createToken`, `forEach`,
// `counters`, `grantAbility`) is already exercised catalogue-wide; the
// `forEach`-bearing activated ability is exempt from the auto-generated
// canned-scenario smoke sweep (`scenarioGenerator.ts` skips every forEach
// script — "covered by the card's own tests") so it gets a hand-written test
// in `sets/big/__tests__/green.test.ts` per gre-development.md's own carve-out.
export const sandstormSalvager: CardDefinition = {
    id: "13b0f27c-a359-4702-833a-82fec161eeec",
    rarity: "mythic",
    name: "Sandstorm Salvager",
    oracleText:
        "When this creature enters, create a 3/3 colorless Golem artifact creature token.\n{2}, {T}: Put a +1/+1 counter on each creature token you control. They gain trample until end of turn.",
    manaCost: { generic: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "sandstorm-salvager-etb-golem",
            oracleText:
                "When this creature enters, create a 3/3 colorless Golem artifact creature token.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Golem",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Golem"],
                        power: 3,
                        toughness: 3,
                    },
                    controller: "controller",
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "sandstorm-salvager-token-buff",
            oracleText:
                "{2}, {T}: Put a +1/+1 counter on each creature token you control. They gain trample until end of turn.",
            cost: { mana: { generic: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", isToken: true },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: 1,
                        },
                        {
                            op: "grantAbility",
                            ability: "trample",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Ancient Cornucopia — "Whenever you cast a spell that's one or more colors,
// you may gain 1 life for each of that spell's colors. Do this only once
// each turn.\n{T}: Add one mana of any color." STOP-AND-ISSUE
// (tracked-by: #675): the mana ability alone is trivial (the established
// any-colour `manaChoices` shape), but the triggered life-gain needs the
// firing SPELL_CAST event's `colors.length` (an Effect Script trigger site
// does NOT thread the firing event in — only `resolve()` reads it — so this
// would need `resolve()`, which is fine) PLUS a "once each turn" limiter.
// `ActivatedAbility.oncePerTurn` exists (`CardInstanceState.activationsThis-
// Turn`), but it is scoped to ACTIVATED abilities only — `TriggeredAbility`
// has no equivalent per-turn-use cap to reuse, and inventing a one-off
// counter for this card alone would be the card-shaped primitive
// `.claude/rules/gre-development.md` § Primitive reuse asks to avoid. Left
// as a tracked stub pending a triggered-ability per-turn-cap primitive.
// export const ancientCornucopia: CardDefinition = {
//     id: "f977975d-0439-4731-b129-270cc4cdbb23",
//     name: "Ancient Cornucopia",
//     rarity: "mythic",
//     manaCost: { X: 2, G: 1 },
//     types: ["Artifact"],
// };

export {};
