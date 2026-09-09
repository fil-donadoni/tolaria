// SPM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as spm from "./sets/spm"` resolves through spm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, PermanentView } from "../../types";

// Carnage, Crimson Chaos — {2}{B}{R} Legendary Creature. "Trample. When
// Carnage enters, return target creature card with mana value 3 or less from
// your graveyard to the battlefield. It gains 'This creature attacks each
// combat if able' and 'When this creature deals combat damage to a player,
// sacrifice it.' Mayhem {B}{R}." Blocked, HALF-narrowed: `grantAbility`
// widened (issue #1665 — `grantedTriggeredId` + `triggeredGrantTemplates[]`)
// to grant non-keyword TRIGGERED abilities, proven by Guardian Scalelord
// (`moc/white.ts`), so "when this creature deals combat damage to a player,
// sacrifice it" is now expressible. What remains: (i) keyword **Mayhem**
// (CR 702.187) is still `status: "planned"` (`convex/cards/mechanicsRegistry.ts`)
// → tracked-by #1971, and (ii) "attacks each combat if able" is NOT
// grantable per-instance — `hasAttackRequirement` (`convex/gre/combat.ts`)
// reads `attack-requirement` only from the card's own compile-time
// `def.staticEffects`; the only per-instance flag, `mustAttackThisTurn`
// (`convex/gre/state.ts`), is transient and cleared at cleanup — the wrong
// duration for a permanent grant → tracked-by #1972.
//
// PATTERN for (ii), landed for the Aura twin in #2471 (CR 303.4 enchant
// restriction, `convex/gre/state.ts`): a normalized restriction interface in
// `cards/types.ts`; an optional `CardInstanceState` field granted by a new
// OPTIONAL FIELD on an existing Op rather than a new Op; ONE exported resolver
// that every legality site calls, with the per-consumer copies DELETED, not a
// second reader added; a hand-written `compactCard` / `expandCard` branch plus
// a round-trip assertion (`PERSISTED_OPTIONAL_KEYS` guards only top-level
// `GameState` keys, so it will not catch a missing instance field).
//
// The part that is easy to get wrong, and did get wrong on the first pass:
// ONE predicate is necessary but NOT sufficient. Two sites calling the same
// function still disagree if they call it at moments where the DATA differs.
// Decide the grant's scope, then clear it at every boundary of that scope —
// including before any legality question asked during an entry sequence, not
// only in the entry-side reset that runs after the answer has been used.
// tracked-by: #1971
// tracked-by: #1972
// export const carnageCrimsonChaos: CardDefinition = {
//     id: "930befba-6068-493e-baa2-e9371cd99e93",
//     name: "Carnage, Crimson Chaos",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Symbiote", "Villain"],
//     power: 4,
//     toughness: 3,
// };

// Spider-Woman, Stunning Savior — {1}{W/U} Legendary Creature — Spider Human
// Hero, 2/2. "Flying / Venom Blast — Artifacts and creatures your opponents
// control enter tapped." (Modern Scryfall oracle text, ADR 0004.) Pure
// declarative data — one keyword plus one static effect, no Effect Script and
// no `resolve()`.
//
// "Venom Blast" is an ABILITY WORD (CR 207.2c): italic flavour that ties
// similarly-functioning cards together and has NO rules meaning and no
// Comprehensive Rules entry of its own. It therefore gets no Mechanics
// Registry row — the same treatment Delirium / Domain / Metalcraft get — and
// nothing in the definition below keys off it; it survives only inside the
// `oracleText` string.
//
// The static is `StaticEntersTappedRestriction` (CR 614.1c + 110.5b), the
// battlefield-SCANNED, player-scoped kind: unlike the self-only
// `entersTapped` card flag, the engine asks every permanent on the
// battlefield whether an entering permanent must be tapped, so this one can
// force OTHER players' permanents to enter tapped — tokens included, since a
// token entering the battlefield is an entering permanent like any other
// (CR 111.1). Kismet (`leg/white.ts`) is the shipped precedent; Spider-Woman
// is the same kind with a NARROWER type filter — artifacts and creatures, no
// lands.
//
// Guard C (issue #2701): the grammar consumes neither the ability-word
// prefix (a line prefixed with any "<Word> —" fails even when the clause
// after it parses) nor the battlefield-scanned enters-tapped static.
// compiler-gap: "Venom Blast —" ability-word prefix (#2693)
// compiler-gap: "Artifacts and creatures your opponents control enter tapped." (#2693)
export const spiderWomanStunningSavior: CardDefinition = {
    id: "bc9b2a76-3cce-4fd0-a4ef-932747cb11b2",
    name: "Spider-Woman, Stunning Savior",
    rarity: "rare",
    oracleText:
        "Flying\nVenom Blast — Artifacts and creatures your opponents control enter tapped.",
    // CR 202.1a — {1}{W/U}: one generic pip plus one guild-hybrid pip payable
    // with either white or blue mana (issue #1738 / PRD #1736).
    manaCost: { generic: 1, hybrid: [["W", "U"]] },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Spider", "Human", "Hero"],
    power: 2,
    toughness: 2,
    // CR 702.9 — Flying.
    staticAbilities: ["flying"],
    staticEffects: [
        {
            kind: "enters-tapped-restriction",
            id: "spider-woman-opponents-enter-tapped",
            forcesTapped: (entering: PermanentView, source: PermanentView) => {
                // "your opponents control" — the entering permanent's
                // prospective controller is NOT Spider-Woman's controller.
                if (entering.controllerId === source.controllerId) return false;
                // "Artifacts and creatures" — lands are deliberately absent
                // (the one narrowing against Kismet's three-type filter).
                return (
                    entering.types.includes("Artifact") ||
                    entering.types.includes("Creature")
                );
            },
            oracleText:
                "Artifacts and creatures your opponents control enter tapped (Spider-Woman, Stunning Savior).",
        },
    ],
};
