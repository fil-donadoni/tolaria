// ONS — red cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons"` resolves through ons/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";

// Lava Dart — {R} Instant. "Lava Dart deals 1 damage to any target.
// Flashback—Sacrifice a Mountain." (CR 702.34, issue #1005, part of the
// Premodern mono-red Burn deck sideboard, PRD #979). The main cast is a plain
// DSL `dealDamage` to the announced "any target" (CR 115.4 — creature /
// planeswalker / battle / player), same shape as Firebolt (ody/red.ts). The
// flashback cast pays NO mana — only the non-mana `FlashbackCost.sacrifice`
// additional cost (CR 702.34a / 118.5): "a Mountain" is a land permanent with
// the Mountain subtype. WHICH Mountain is sacrificed is the caster's explicit
// choice through the unified sacrificeChoice layer (never auto-picked); the
// engine wiring (`convex/gre/flashback.ts` → `getFlashbackAdditionalCost`,
// folded into the cast-time sacrifice selection in `convex/game.ts`
// `buildCastSacrificeSelection`) shipped with #1035/#1037 — this card is its
// first consumer.
export const lavaDart: CardDefinition = {
    id: "865bb1d3-5b7d-40e9-87cc-96be9524a105",
    rarity: "common",
    name: "Lava Dart",
    oracleText:
        "Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { R: 1 },
    types: ["Instant"],
    // Purely non-mana flashback (no `mana` key) — "Sacrifice a Mountain" only.
    flashback: { sacrifice: { types: "Land", subtypes: "Mountain" } },
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};

// Goblin Piledriver — {1}{R} 1/2 Goblin Warrior. "Protection from blue"
// (CR 702.16a — the COLOUR family of `parseProtectionQuality`, the shipped
// `convex/gre/protection.ts` authority every consumer reads) plus "Whenever
// this creature attacks, it gets +2/+0 until end of turn for each other
// attacking Goblin." (CR 508.1 attack declaration, CR 613.4c layer 7c
// buff, CR 611.2 duration.)
//
// The buff is a plain `pump` whose `power` is the `count` construct scaled by
// the grammar's own `times` multiplier (issue #999's "TWICE the number of"
// factor — no arithmetic composition, the frozen-grammar defence): "for each
// other attacking Goblin" at +2 apiece is `times: 2` over the count of
// attacking Goblins excluding the source itself. `isAttacking` (issue #1097)
// and `excludeSource` (issue #2373) are the two filter fields that make
// "other attacking" expressible declaratively; `acrossAllPlayers` because a
// Goblin attacking is a Goblin attacking whoever controls it (nothing in the
// Oracle line scopes the count to permanents you control).
//
// compiler-gap: Whenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin. (#2693)
export const goblinPiledriver: CardDefinition = {
    id: "f6c4df1f-f148-42ec-8e22-e7114216927d", // ONS 205
    rarity: "rare",
    name: "Goblin Piledriver",
    oracleText:
        "Protection from blue\nWhenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Warrior"],
    power: 1,
    toughness: 2,
    staticAbilities: ["protection from blue"],
    triggeredAbilities: [
        attacksTrigger({
            id: "goblin-piledriver-attack-pump",
            oracleText:
                "Whenever this creature attacks, it gets +2/+0 until end of turn for each other attacking Goblin.",
            scope: "self",
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: {
                        count: {
                            zone: "battlefield",
                            acrossAllPlayers: true,
                            filter: {
                                type: "Creature",
                                subtype: "Goblin",
                                isAttacking: true,
                                excludeSource: true,
                            },
                            times: 2,
                        },
                    },
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
    ],
};

// Goblin Pyromancer — {3}{R} 2/2 Goblin Wizard. Two independent triggered
// abilities, one Oracle line each (CR 603.2):
//
//   1. "When this creature enters, Goblin creatures get +3/+0 until end of
//      turn." (CR 603.6a ETB, CR 613.4c layer 7c, CR 611.2 duration.) A
//      `forEach` over every Goblin creature on the battlefield — the Oracle
//      line names no controller, so the pump reaches the opponent's Goblins
//      too — each one taking the same `pump`, the History of Benalia
//      (`dom/white.ts`) shape with the subtype swapped.
//   2. "At the beginning of the end step, destroy all Goblins." (CR 603.6a
//      phase trigger on EVERY end step, not just its controller's — hence
//      `scope: "each"` — and CR 701.8's destroy over the same `forEach`
//      sweep Tivadar's Crusade (`drk/white.ts`) uses. Regeneration is NOT
//      denied: the printed line has no "can't be regenerated" clause, so no
//      `cantBeRegenerated` flag. The Pyromancer is itself a Goblin and dies
//      to its own trigger.)
//
// compiler-gap: At the beginning of the end step, destroy all Goblins. (#2693)
export const goblinPyromancer: CardDefinition = {
    id: "bb4815b7-fc20-44a4-ad1c-66d92993557f", // ONS 206
    rarity: "rare",
    name: "Goblin Pyromancer",
    oracleText:
        "When this creature enters, Goblin creatures get +3/+0 until end of turn.\nAt the beginning of the end step, destroy all Goblins.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin", "Wizard"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "goblin-pyromancer-etb-pump",
            oracleText:
                "When this creature enters, Goblin creatures get +3/+0 until end of turn.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", subtype: "Goblin" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 3,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
        phaseTrigger({
            id: "goblin-pyromancer-end-step-sweep",
            oracleText:
                "At the beginning of the end step, destroy all Goblins.",
            phase: "END_STEP",
            scope: "each",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", subtype: "Goblin" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        }),
    ],
};

// Goblin Sharpshooter — {2}{R} 1/1 Goblin, three Oracle lines that compose
// into the deck's sweeper:
//
//   1. "This creature doesn't untap during your untap step." (CR 502.3 — the
//      active player determines which of their permanents untap.) An
//      `untapRestriction` static scoped to the SOURCE via `appliesToSelf`
//      (issue #2713): the engine synthesizes this permanent's own instance-id
//      filter at collection time, the exact twin of the `appliesToHost`
//      branch Merseine uses. A characteristic filter would have been wrong —
//      it would lock every OTHER Goblin on the board too.
//   2. "Whenever a creature dies, untap this creature." (CR 603.2 / CR 700.4
//      — "dies" is put into a graveyard from the battlefield, for ANY creature, either player's, including the
//      Sharpshooter's own, which simply finds nothing to untap.) The plain
//      `tapUntap` Op pointed at `{ ref: "$source" }`.
//   3. "{T}: This creature deals 1 damage to any target." (CR 602.1,
//      CR 115.4.) With line 2 this is the engine: each ping kills something,
//      each death untaps the Sharpshooter, and line 1 is the drawback that
//      keeps it from simply untapping for free.
//
// No `compiler-gap` marker: the Oracle compiler reads this card back into its
// own definition (Guard C's round-trip leg). It was `quarantine` rather than
// `unparsed` in the lockfile for a REASON about the canned smoke generator —
// `tapUntap` untapping a permanent the generator already seeds untapped — and
// that reason is answered by this card's own untap-step test
// (`gre/__tests__/untap-restriction.test.ts`).
export const goblinSharpshooter: CardDefinition = {
    id: "7e689df7-b85d-4346-bee8-5e978b5cbbbc", // ONS 207
    rarity: "rare",
    name: "Goblin Sharpshooter",
    oracleText:
        "This creature doesn't untap during your untap step.\nWhenever a creature dies, untap this creature.\n{T}: This creature deals 1 damage to any target.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    staticEffects: [
        untapRestriction({
            id: "goblin-sharpshooter-no-untap",
            oracleText: "This creature doesn't untap during your untap step.",
            filter: {},
            appliesToSelf: true,
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        diedTrigger({
            id: "goblin-sharpshooter-untap-on-death",
            oracleText: "Whenever a creature dies, untap this creature.",
            scope: "any",
            filter: { types: "Creature" },
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "goblin-sharpshooter-ping",
            oracleText: "{T}: This creature deals 1 damage to any target.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
