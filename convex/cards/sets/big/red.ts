// BIG — red cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { EFFECT_TREASURE_TOKEN } from "../../sharedTokens";

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
// token-maker, issue #1304 / #2368). "Menace. At the beginning of your
// upkeep, you may create a Treasure token. When you do, target opponent
// creates a tapped Treasure token. Whenever this creature attacks, it deals
// damage to defending player equal to the number of artifacts they
// control." (Scryfall id 4c6cf93a-d073-48ac-88db-c46bf3e10beb.)
//
// Menace is a native keyword (`staticAbilities: ["menace"]`,
// mechanicsRegistry.ts:1704). The upkeep clause is the Minsc & Boo shape
// (`clb/multicolor.ts`): a bare cost-free `mayPay` ("you may…", issue #680)
// gates an `if` whose THEN branch both creates the controller's own Treasure
// AND queues a `reflexiveTrigger` (CR 603.3c) for "When you do…" — nesting
// the reflexive trigger inside the `mayPay` gate is what makes it fire ONLY
// when a Treasure was actually created, not merely offered. The reflexive
// trigger announces its OWN single-opponent target (CR 603.3d,
// `targetRequirement: { type: "player", controller: "opponent" }`, the Loran
// of the Third Path / Questing Phelddagrif shape) and creates a second
// Treasure — `EFFECT_TREASURE_TOKEN` (`sharedTokens.ts`, the DSL-authorable
// sibling of `TREASURE_TOKEN` carrying the real "{T}, Sacrifice this
// artifact: Add one mana of any color" ability, #2423) spread with
// `entersTapped: true` (CR 508.4, `EffectTokenSpec.entersTapped`, #1195) —
// for the announced target's control.
//
// The attack trigger is the Xantid Swarm shape (`scg/green.ts`): raw
// `ATTACKERS_DECLARED` + `matches` on `attackerIds.includes(self.id)`,
// `dealDamage` sized off a `count` construct scoped to `"opponent"`'s
// battlefield artifacts (Typhoon's `leg/green.ts` island-count shape) —
// "opponent" resolves to the defending player, the only other seat in this
// engine's 2-player scope (CLAUDE.md § Out of Scope).
//
// Every Op above (`mayPay`, `reflexiveTrigger`, `createToken`, `dealDamage`)
// is an exercised `EFFECT_OP_REGISTRY` entry; no new Op needed.
export const generousPlunderer: CardDefinition = {
    id: "4c6cf93a-d073-48ac-88db-c46bf3e10beb",
    name: "Generous Plunderer",
    rarity: "mythic",
    oracleText:
        "Menace\nAt the beginning of your upkeep, you may create a Treasure token. When you do, target opponent creates a tapped Treasure token.\nWhenever this creature attacks, it deals damage to defending player equal to the number of artifacts they control.",
    manaCost: { generic: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 2,
    toughness: 2,
    staticAbilities: ["menace"],
    triggeredAbilities: [
        {
            id: "generous-plunderer-upkeep-treasure",
            oracleText:
                "At the beginning of your upkeep, you may create a Treasure token. When you do, target opponent creates a tapped Treasure token.",
            event: "PHASE_BEGIN",
            matches: (event, self) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "UPKEEP" &&
                event.activePlayerId === self.controllerId,
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Create a Treasure token?",
                    bind: "$makeTreasure",
                },
                {
                    op: "if",
                    predicate: { binding: "$makeTreasure" },
                    then: [
                        {
                            op: "createToken",
                            token: EFFECT_TREASURE_TOKEN,
                            controller: "controller",
                            count: 1,
                        },
                        {
                            op: "reflexiveTrigger",
                            oracleText:
                                "When you do, target opponent creates a tapped Treasure token.",
                            targetRequirement: {
                                type: "player",
                                count: 1,
                                controller: "opponent",
                            },
                            effects: [
                                {
                                    op: "createToken",
                                    token: {
                                        ...EFFECT_TREASURE_TOKEN,
                                        entersTapped: true,
                                    },
                                    controller: { target: 0 },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            id: "generous-plunderer-attack-damage",
            oracleText:
                "Whenever this creature attacks, it deals damage to defending player equal to the number of artifacts they control.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "dealDamage",
                    amount: {
                        count: {
                            zone: "battlefield",
                            controller: "opponent",
                            filter: { type: "Artifact" },
                        },
                    },
                    to: { player: "opponent" },
                },
            ],
        },
    ],
};
