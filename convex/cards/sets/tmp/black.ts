// TMP — black cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Reanimate — {B} Sorcery. "Put target creature card from a graveyard onto
// the battlefield under your control. You lose life equal to that card's
// mana value." (CR 601.2c target in ANY graveyard, CR 400.7 / 800.4a control
// override, CR 119.3b life loss, CR 202.3 mana value.)
//
// A plain spell target (`targetRequirement.zone: "graveyard", controller:
// "any"` — Hymn of Rebirth precedent), so the pick itself needs no new
// capability. Two small, well-precedented `moveZone` generalizations (issue
// #680) express the rest with zero new Ops: `controller` (an explicit
// override of the default owner-control, passing through to
// `SpellContext.returnToBattlefield`'s already-existing optional 4th
// argument — the exact mechanism Hymn of Rebirth's `resolve()` already
// used) for "under your control", and `bind` + a `ref.manaValue` snapshot
// property for "lose life equal to that card's mana value" (captured BEFORE
// the reanimation, CR 608.2h last-known information).
export const reanimate: CardDefinition = {
    id: "ae1ef31c-8ca5-444c-8f39-e1d1827318f5",
    name: "Reanimate",
    rarity: "uncommon",
    oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "battlefield",
            controller: "controller",
            bind: "$reanimated",
        },
        {
            op: "loseLife",
            player: "controller",
            amount: { ref: "$reanimated.manaValue" },
        },
    ],
};

// Corpse Dance — {2}{B} Instant. "Buyback {2} (You may pay an additional {2}
// as you cast this spell. If you do, put this card into your hand instead of
// into your graveyard as it resolves.)\nReturn the top creature card of your
// graveyard to the battlefield. That creature gains haste until end of turn.
// Exile it at the beginning of the next end step." (issue #1200, closing the
// Buyback half — CR 702.27 — of the Vintage Cube split from #699.)
//
// Buyback itself is no longer the blocker: `CardDefinition.buyback` (issue
// #1200) is a shipped, real cost-system capability, and the rest of the
// oracle text is the Sneak Attack idiom (`convex/cards/sets/usg/red.ts`,
// issue #1151) — `moveZone`(reanimate) + `grantAbility`(haste,
// end-of-turn) + `delayedTrigger`(next-end-step, exile the captured
// permanent) — zero new Ops needed for that half either.
//
// Blocked: "the TOP creature card of your graveyard" needs a deterministic
// (non-player-choice) "top of graveyard" object selector; every
// graveyard-card selection Op today (`choice(zone: "graveyard")`) is a
// player pick, not an implicit positional one — the EXACT gap already
// tracked for Shallow Grave (`convex/cards/sets/mir/black.ts`, issue #920,
// item 11). Re-flagged rather than worked around: inventing a
// player-choice substitute for "the top card" would diverge from modern
// Oracle text (ADR 0004).
// tracked-by: #920
// export const corpseDance: CardDefinition = {
//     id: "76ae81ea-13e3-4ab8-b956-4c7b139a5e9c", // TMP 116
//     name: "Corpse Dance",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1 },
//     types: ["Instant"],
//     buyback: { X: 2 },
// };

// Reckless Spite — {1}{B}{B} Instant. "Destroy two target nonblack
// creatures. You lose 5 life." (CR 701.8 destroy, CR 601.2c "two target" —
// exact count, not "up to two".) Two announced targets addressed by
// position (Force of Vigor precedent, mh1/green.ts).
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/black.ts`.
export const recklessSpite: CardDefinition = {
    id: "9141daea-1f4f-4227-b7d7-20753e3cb4d4", // TMP 152
    rarity: "uncommon",
    name: "Reckless Spite",
    oracleText: "Destroy two target nonblack creatures. You lose 5 life.",
    manaCost: { X: 1, B: 2 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 2, excludeColors: "B" },
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "destroy", target: { target: 1 } },
        { op: "loseLife", player: "controller", amount: 5 },
    ],
};
