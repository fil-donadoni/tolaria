// 5dn (Fifth Dawn) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";

// Crucible of Worlds — {3} Artifact. "You may play lands from your
// graveyard." One bare declarative field, no `resolve()` and no Effect
// Script: `playsLandsFromGraveyard: true` is the CR 305.1-analog player-wide
// land-play permission (issue #1190), read live off the battlefield by
// `canPlayLandsFromGraveyard` (`convex/gre/rules.ts`) — the permission ends
// the instant this artifact leaves play. Unconditional and player-wide,
// distinct from the SCOPED once-per-turn grant to one specific graveyard card
// (Serra Paragon, issue #1149).
export const crucibleOfWorlds: CardDefinition = {
    id: "312a6058-de08-487d-95bd-b3c56807fdd6",
    name: "Crucible of Worlds",
    rarity: "rare",
    oracleText: "You may play lands from your graveyard.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    playsLandsFromGraveyard: true,
};

// Pentad Prism — {2} Artifact, the catalogue's first Sunburst card (CR 702.44,
// issue #2378).
//
// CR 702.44a: "Sunburst" means "If this object is entering as a creature,
// ignoring any type-changing effects that would affect it, it enters with a
// +1/+1 counter on it for each color of mana spent to cast it. Otherwise, it
// enters with a charge counter on it for each color of mana spent to cast it."
// Pentad Prism is a noncreature artifact, so the counter type is `charge`; the
// COUNT is the `entersWith` vocabulary word `"sunburst"`, resolved by the
// shared oracle `resolveEntersWithCounters` (`convex/cards/entersWith.ts`) off
// the mana this spell was actually paid with. `noteManaSpent: true` is what
// makes that record exist: the cast-commit step snapshots the mana pool around
// payment and stores the per-colour delta on the stack item as
// `notedManaSpent` (CR 106.10), which `finalizeSpellResolution` hands to the
// entry-counter applier. COLORS, not pips — {R}{R} spent is one counter — and
// CR 105.1 knows five colors, so colorless mana spent on the generic cost
// contributes nothing while COLORED mana spent on it contributes its color.
// CR 702.44b keeps every non-cast entry path (reanimation, blink, a token
// copy) at zero counters, which is exactly what those sites pass.
//
// SIMPLIFICATION (flagged, CR 605.1a): "Remove a charge counter from this (tracked-by: #2785)
// artifact: Add one mana of any color" is a mana ability and by CR 605.3a
// should not use the stack. It is declared `useStack: true` here for the same
// reason Jeweled Amulet's noted-mana ability is (`sets/ice/colorless.ts`): the
// engine's no-stack mana path (`activateManaAbility`, `convex/game.ts`) pays
// only `cost.mana` and `cost.tapOtherFilter`, and has no `removeCounter` leg
// at all — authoring this as a mana ability would add the mana WITHOUT ever
// removing the counter, i.e. unbounded mana. The stack route pays the counter
// cost correctly (`applyMove`/`activateAbility` both call
// `payRemoveCounterCost`) and the colour choice rides the ordinary CR 700.2
// `modes` picker, which the client, the bot move enumerator and the human
// prompt all already understand. The only observable deviation is that an
// opponent could respond to the mana being added, and that the mana cannot be
// produced mid-payment of another cost — the same rules-lawyer-level deviation
// Jeweled Amulet documents.
export const pentadPrism: CardDefinition = {
    id: "672b9b16-daef-44e6-9a3a-cfd9f3c78bc7",
    name: "Pentad Prism",
    rarity: "common",
    oracleText:
        "Sunburst (This artifact enters with a charge counter on it for each color of mana spent to cast it.)\nRemove a charge counter from this artifact: Add one mana of any color.",
    manaCost: { generic: 2 },
    types: ["Artifact"],
    staticAbilities: ["sunburst"],
    // CR 106.10 — capture which colours actually paid the {2}; sunburst counts
    // them (CR 702.44a).
    noteManaSpent: true,
    entersWith: { counters: [{ type: "charge", count: "sunburst" }] },
    activatedAbilities: [
        {
            // CR 602.2b / 700.2 — instant speed; the whole cost is the counter
            // removal (CR 122.6), and the colour is locked in at announcement.
            id: "pentad-prism-any-color",
            oracleText:
                "Remove a charge counter from this artifact: Add one mana of any color.",
            cost: { removeCounter: { type: "charge", count: 1 } },
            useStack: true,
            modes: [
                {
                    id: "add-w",
                    label: "Add {W}",
                    oracleText: "Add {W}.",
                    effects: [{ op: "addMana", mana: { W: 1 } }],
                },
                {
                    id: "add-u",
                    label: "Add {U}",
                    oracleText: "Add {U}.",
                    effects: [{ op: "addMana", mana: { U: 1 } }],
                },
                {
                    id: "add-b",
                    label: "Add {B}",
                    oracleText: "Add {B}.",
                    effects: [{ op: "addMana", mana: { B: 1 } }],
                },
                {
                    id: "add-r",
                    label: "Add {R}",
                    oracleText: "Add {R}.",
                    effects: [{ op: "addMana", mana: { R: 1 } }],
                },
                {
                    id: "add-g",
                    label: "Add {G}",
                    oracleText: "Add {G}.",
                    effects: [{ op: "addMana", mana: { G: 1 } }],
                },
            ],
        },
    ],
};
