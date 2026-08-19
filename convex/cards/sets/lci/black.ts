// LCI — black cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

/** Bitter Triumph — {1}{B} Instant. "As an additional cost to cast this spell,
 *  discard a card or pay 3 life. Destroy target creature or planeswalker."
 *
 *  CR 601.2b / 118.8 — the "discard a card OR pay 3 life" clause is a
 *  CASTER-CHOSEN disjunction of ADDITIONAL costs: both legs are paid ALONGSIDE
 *  the mana cost (CR 118.8), never instead of it, and the caster names which
 *  one at ANNOUNCEMENT — before targets (CR 601.2c) and before anything is paid
 *  (CR 601.2h). That is exactly `additionalCosts.oneOf`; the engine flattens
 *  the named leg onto the spec (`resolveAdditionalCosts`,
 *  `convex/gre/additionalCost.ts`) and the ordinary cost machinery pays it —
 *  the discard through the cast's hand-cost picker (CR 701.9), the life as a
 *  scalar at commit (CR 119.4).
 *
 *  The empty `filter` is the untyped "discard A CARD" shape; the cast card
 *  itself is never eligible (CR 601.2a — it is on the stack by then). With an
 *  empty hand AND 3 or less life NEITHER leg is payable, so the spell is not
 *  castable at all (CR 601.2h). */
export const bitterTriumph: CardDefinition = {
    id: "05bdd22c-3e11-4c29-bdfa-d3dfc0e90a9f",
    name: "Bitter Triumph",
    rarity: "uncommon",
    oracleText:
        "As an additional cost to cast this spell, discard a card or pay 3 life.\nDestroy target creature or planeswalker.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    additionalCosts: {
        oneOf: [
            {
                id: "discard",
                label: "Discard a card",
                discard: { count: 1 },
            },
            { id: "pay-3-life", label: "Pay 3 life", payLife: 3 },
        ],
    },
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
    },
    effects: [{ op: "destroy", target: { target: 0 } }],
};

// TODO(issue #679 stub — Deep-Cavern Bat's leave trigger needs to remember
// ONE specific card this creature exiled (arbitrarily many turns earlier)
// and move THAT card to its owner's hand when Deep-Cavern Bat leaves.
// `SpellContext` has no exile-zone reader (`getHandCards`/`getBattlefieldIds`
// exist; no `getExileIds`) and no generic per-instance scratch note that
// stores a card id (only `addCounter`, numeric). The one channel that DOES
// carry a value from an ETB exile to a later trigger,
// `exileWithAttachments`/`returnExiledForSource` (ADR 0028), is wired only
// for a return-to-BATTLEFIELD host (Tawnos's Coffin shape) — not a
// return-to-hand. `scheduleDelayedTrigger`'s `timing: "leaves-battlefield"`
// (issue #731/#916) looked promising but is explicitly THIS-TURN-scoped —
// "every `leaves-battlefield` instance is this-turn scoped... purged at
// CLEANUP" (convex/gre/phases.ts) — wrong semantics for an "until this
// leaves the battlefield" duration that must survive across turns. Re-
// audited under the #1305 residue tranche (parent PRD #620) — the gap still
// stands (2026-07-18). Stop-and-issue per gre-development.md; tracked-by:
// #1362.
// export const deepCavernBat: CardDefinition = {
//     id: "69c68c95-b788-43b1-9f22-1b22c5a00b25",
//     name: "Deep-Cavern Bat",
//     rarity: "uncommon",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Bat"],
//     power: 1,
//     toughness: 1,
// };

export {};
