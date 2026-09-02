// LCI — black cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

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

// Deep-Cavern Bat — {1}{B} Creature — Bat, 1/1 (LCI, issue #2523).
//
// Elite Spellbinder's script (`stx/white.ts`) minus its `grantCastFromExile`
// clause, plus the linked-exile round trip Tidehollow Sculler ships
// (`ala/multicolor.ts`, issue #2522). No new Op, no new `SpellContext`
// primitive, no `resolve()`:
//
//   - `lookHand` (CR 400.2, issue #2383) — the PRIVATE whole-hand look. Not
//     redundant with the pick below: the look is its OWN game action and
//     still happens when the pick never raises (an all-lands hand matches the
//     nonland filter nowhere, so no choice is offered per CR 608.2b and the
//     Bat has still looked), and the knowledge it grants OUTLIVES the pick
//     window that `handPickZoneOwner` opens (issue #1698). It is a PRIVATE
//     look, so it must not become the Thoughtseize template's public
//     `reveal` (CR 701.20a): the hand is a hidden zone (CR 400.2) and the
//     grant is per-viewer (`markKnown`, ADR 0026).
//   - `choice` `choose-hand-card` — "You MAY exile" is an OPTIONAL pick,
//     `count: { min: 0, max: 1 }` — the Elite Spellbinder encoding, which
//     cites no rule for it either; the optionality is the Op's own `count`
//     range, not a CR clause. Chooser is the controller and
//     zone owner the announced opponent (`zoneOwnerId`).
//   - `moveZone` `cards` shape, `from: "hand"` -> `to: "exile"`, with
//     `linkToSource: true` (issue #1947) stamping `exiledBySourceId` = this
//     creature's own instance (CR 607 linked abilities).
//   - `leftTrigger` running the sixth `moveZone` shape,
//     `target: { exiledWithSource: true }` -> `to: "hand"` (issue #1323),
//     which routes the card out of the OWNER's exile pile into the OWNER's
//     hand (CR 400.7) — the exiled card belongs to the opponent, not to the
//     Bat's controller.
//
// "Target opponent" is a REAL target announced when the ETB trigger goes on
// the stack (CR 603.3d, the issue #1193 machinery), not a resolution-time
// choice.
//
// DOCUMENTED CR DIVERGENCE (a general mechanism for it is out of scope here,
// see the last paragraph) — the return is modelled as a leaves-the-
// battlefield TRIGGER, and strictly it is not one. CR 610.3: "Some one-shot
// effects cause an object to change zones 'until' a specified event occurs. A
// second one-shot effect is created immediately after the specified event.
// This second one-shot effect returns the object to its previous zone." A
// one-shot effect created that way is not an ability, so it never uses the
// stack and cannot be responded to; modelling it as a trigger puts it on the
// stack, where it can be. This repo
// already models the identical "until this ~ leaves the battlefield" wording
// that way — Banishing Light (`jou/white.ts`) — so following the established
// precedent is the right call for this card rather than inventing a second
// mechanism. A general untriggered CR 610.3 "until" return is out of scope
// for this card — it is a foundation, not a card-sized change. (Contrast
// Tidehollow Sculler, which prints two real triggered abilities and so has no
// divergence at all.)
//
// No `condition` on the leave trigger: the pick is optional, so the Bat
// routinely leaves with nothing linked, and the return is then a clean CR
// 608.2b no-op. Banishing Light's `holdsExileBundle` gate reads the
// `exileHeld` bundle store, which this card never populates.
//
// Visibility: entering exile clears `knownTo` (ADR 0026 public-zone rule), so
// the exiled card is face up to BOTH players — correct per CR 406.3, since
// the Bat's text never says "face down". The private look must not leak into
// that projection, and the hand cards that were NOT exiled stay known to the
// looker alone.
//
// The Oracle compiler has no grammar for either printed line yet, so Guard C
// is satisfied by declaring the fragments rather than by a round trip
// (PRD #2693).
// compiler-gap: When this creature enters, look at target opponent's hand. You may exile a nonland card from it until this creature leaves the battlefield. (#2693)
// compiler-gap: When this creature leaves the battlefield, return the exiled card to its owner's hand. (#2693)
export const deepCavernBat: CardDefinition = {
    id: "69c68c95-b788-43b1-9f22-1b22c5a00b25",
    name: "Deep-Cavern Bat",
    rarity: "uncommon",
    oracleText:
        "Flying\nWhen this creature enters, look at target opponent's hand. You may exile a nonland card from it until this creature leaves the battlefield.",
    manaCost: { generic: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Bat"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "deep-cavern-bat-exile",
            oracleText:
                "When this creature enters, look at target opponent's hand. You may exile a nonland card from it until this creature leaves the battlefield.",
            scope: "self",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                { op: "lookHand", player: { target: 0 } },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { excludeType: "Land" },
                    count: { min: 0, max: 1 },
                    prompt: "You may exile a nonland card from that player's hand.",
                    bind: "$taken",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$taken" },
                    player: { target: 0 },
                    from: "hand",
                    to: "exile",
                    linkToSource: true,
                },
            ],
        }),
        leftTrigger({
            id: "deep-cavern-bat-return",
            oracleText:
                "When this creature leaves the battlefield, return the exiled card to its owner's hand.",
            scope: "self",
            effects: [
                {
                    op: "moveZone",
                    target: { exiledWithSource: true },
                    to: "hand",
                },
            ],
        }),
    ],
};
