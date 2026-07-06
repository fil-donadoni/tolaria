// jud — green cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Sylvan Safekeeper — {G} Creature — Human Wizard (issue #684, Cube FREE
// evasion/protection statics). "Sacrifice a land: Target creature you
// control gains shroud until end of turn." (CR 702.18 shroud; CR 118.5
// sacrifice-a-permanent activation cost.)
//
// Deviation (documented per gre-development.md — "planned" registry status
// is a legal declaration, not a block; mechanicsRegistry.ts note: "GAP:
// granted via SpellContext.grantStaticAbility on multiple fem/blue.ts cards
// but no target-legality check anywhere reads the string — decorative only,
// same class as haste"): shroud is granted the same way haste/hexproof are
// elsewhere in the catalogue — the keyword is placed on the target, but no
// targeting-legality check currently reads it, so the granted shroud is
// presently decorative rather than rules-enforced. Not specific to this
// card; tracked project-wide, not a stop-and-issue case for a single card.
export const sylvanSafekeeper: CardDefinition = {
    id: "f1b8413f-c9fc-4cea-b416-a1fcf651b009",
    name: "Sylvan Safekeeper",
    rarity: "rare",
    oracleText:
        "Sacrifice a land: Target creature you control gains shroud until end of turn.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "sylvan-safekeeper-shroud",
            oracleText:
                "Sacrifice a land: Target creature you control gains shroud until end of turn.",
            cost: { sacrificeFilter: { types: "Land" } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, controller: "you" },
            effects: [
                {
                    op: "grantAbility",
                    ability: "shroud",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
