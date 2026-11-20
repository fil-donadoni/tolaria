// ONS — red cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

import { diedTrigger } from "../../abilities/triggers/diedTrigger";
import { untapRestriction } from "../../abilities/static/untapRestriction";

// Lava Dart — {R} Instant. "Lava Dart deals 1 damage to any target.
// Flashback—Sacrifice a Mountain." (CR 702.34, issue #1005, part of the
// Premodern mono-red Burn deck sideboard, PRD #979). The main cast is a plain
// DSL `dealDamage` to the announced "any target" (CR 115.4 — creature /
// planeswalker / battle / player), same shape as Firebolt (ody/red.cards.ts). The
// flashback cast pays NO mana — only the non-mana `FlashbackCost.sacrifice`
// additional cost (CR 702.34a / 118.5): "a Mountain" is a land permanent with
// the Mountain subtype. WHICH Mountain is sacrificed is the caster's explicit
// choice through the unified sacrificeChoice layer (never auto-picked); the
// engine wiring (`convex/gre/flashback.ts` → `getFlashbackAdditionalCost`,
// folded into the cast-time sacrifice selection in `convex/game.ts`
// `buildCastSacrificeSelection`) shipped with #1035/#1037 — this card is its
// first consumer.
export const lavaDart = defineCard(() => ({
    id: "865bb1d3-5b7d-40e9-87cc-96be9524a105",
    rarity: "common",
    name: "Lava Dart",
    oracleText:
        "Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { R: 1 },
    types: ["Instant"],
    // Purely non-mana flashback (no `mana` key) — "Sacrifice a Mountain" only.
    // CR 205.3i — Mountain is a land type, so the subtype alone names it.
    flashback: { sacrifice: { subtypes: "Mountain" } },
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
}));

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
export const goblinSharpshooter = defineCard(() => ({
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
}));
