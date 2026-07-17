// BIG — red cards, split by colour per ADR 0043. The registry's
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
// in `sets/big/__tests__/red.test.ts` per gre-development.md's own carve-out.
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

// Legion Extruder — {1}{R} Artifact (Cube FREE residue token-maker, issue
// #1304). "When this artifact enters, it deals 2 damage to any target. {2},
// {T}, Sacrifice another artifact: Create a 3/3 colorless Golem artifact
// creature token." The ETB damage half would be DSL-clean on its own
// (`dealDamage`), but the activated ability's cost is "Sacrifice ANOTHER
// artifact" (excluding this permanent itself) — `ActivatedAbility.cost.
// sacrificeFilter` is a static `PermanentFilter` shared by every instance of
// the card, with no per-source dynamic hook (unlike `TargetRequirement.
// excludeInstanceIds`, which a `getTargetRequirement(source)` closure can
// populate per-instance — the Sorceress Queen precedent, arn/black.ts); the
// sacrifice-candidate scan (`convex/gre/moves.ts`) matches the WHOLE
// battlefield including the activating permanent. Shipping the filter as-is
// would illegally let the source pay its own cost by sacrificing itself.
// Stop-and-issue per gre-development.md; shipping only the ETB half would
// misrepresent the card. tracked-by: #1357
// export const legionExtruder: CardDefinition = {
//     id: "5a077de0-1893-40d0-a499-ee2e6e2258f1",
//     name: "Legion Extruder",
//     rarity: "mythic",
//     manaCost: { generic: 1, R: 1 },
//     types: ["Artifact"],
// };

// Generous Plunderer — {1}{R} Creature — Human Rogue, 2/2 (Cube FREE residue
// token-maker, issue #1304). "Menace. At the beginning of your upkeep, you
// may create a Treasure token. When you do, target opponent creates a
// TAPPED Treasure token. Whenever this creature attacks, it deals damage to
// defending player equal to the number of artifacts they control." Menace
// (data) and the attack trigger (`dealDamage` sized off an `EffectCount` of
// the defending player's artifacts) are DSL-free, but the upkeep clause's
// "target opponent creates a TAPPED Treasure token" needs a token that
// enters TAPPED — `createTokenPermanents` (`convex/gre/state.ts`) hardcodes
// `isTapped: false` on every created token, and neither `TokenSpec` nor
// `EffectTokenSpec` has an "enters tapped" flag; the `createToken` Op also
// has no `bind` to snapshot a just-created token for a follow-up `tapUntap`
// Op. No card can create a tapped token today. Stop-and-issue per
// gre-development.md; shipping only the attack-trigger half would
// misrepresent the card. tracked-by: #1357
// export const generousPlunderer: CardDefinition = {
//     id: "4c6cf93a-d073-48ac-88db-c46bf3e10beb",
//     name: "Generous Plunderer",
//     rarity: "mythic",
//     manaCost: { generic: 1, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Rogue"],
//     power: 2,
//     toughness: 2,
// };

export {};
