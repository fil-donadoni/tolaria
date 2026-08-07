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
// as you cast this spell. If you do, put this card into your hand as it
// resolves.)\nReturn the top creature card of your graveyard to the
// battlefield. That creature gains haste until end of turn. Exile it at the
// beginning of the next end step." (CR 702.27 buyback, CR 404.3 ordered
// graveyard, CR 400.7 reanimation, CR 702.10 haste, CR 603.7 delayed
// trigger.)
//
// Two issues met here. `CardDefinition.buyback` — the real cost-system
// capability (issue #1200: announceCast folds the additional cost,
// finalizeSpellResolution routes the card to its owner's HAND instead of the
// graveyard) — shipped with no card to exercise it; Corpse Dance is its
// FIRST and so far only consumer. The reanimation half was blocked on the
// deterministic top-of-graveyard selector, built by issue #1967
// (`moveZone`'s fifth shape, `target: { zone: "graveyard", position: "top",
// filter: { type: "Creature" } }`) — a FILTERED positional scan, so the
// topmost card MATCHING the filter comes back rather than the outright top
// card only when it happens to be a creature. Never a player choice:
// substituting one diverges from the modern oracle text (ADR 0004).
//
// The remainder is exactly Shallow Grave's script (`mir/black.ts`) — the
// Sneak Attack idiom (`usg/red.ts`, issue #1151) with the sacrifice swapped
// for an exile — since the two cards' non-buyback text is word-for-word
// identical in modern oracle.
export const corpseDance: CardDefinition = {
    id: "76ae81ea-13e3-4ab8-b956-4c7b139a5e9c", // TMP 116
    name: "Corpse Dance",
    rarity: "rare",
    oracleText:
        "Buyback {2} (You may pay an additional {2} as you cast this spell. If you do, put this card into your hand as it resolves.)\nReturn the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step.",
    manaCost: { X: 2, B: 1 },
    types: ["Instant"],
    buyback: { X: 2 },
    effects: [
        {
            op: "moveZone",
            target: {
                zone: "graveyard",
                position: "top",
                player: "controller",
                filter: { type: "Creature" },
            },
            to: "battlefield",
            bind: "$revived",
        },
        {
            op: "grantAbility",
            ability: "haste",
            target: { ref: "$revived" },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "delayedTrigger",
            timing: "next-end-step",
            oracleText: "Exile it at the beginning of the next end step.",
            capture: { $captured: { ref: "$revived" } },
            effects: [{ op: "exile", target: { ref: "$captured" } }],
        },
    ],
};

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
