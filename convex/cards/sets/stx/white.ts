// stx — white cards (ADR 0043 colour split).

import type { CardDefinition, EffectOp } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Elite Spellbinder — {2}{W} Creature — Human Cleric, 3/1, flying (Vintage
// Cube hand disruption, issue #2383; the stub #679 left behind). "Flying. When
// this creature enters, look at target opponent's hand. You may exile a
// nonland card from it. For as long as that card remains exiled, its owner may
// play it. A spell cast this way costs {2} more to cast."
//
// DSL-first (ADR 0045) — four Ops, no resolve():
//   1. `lookHand` (CR 400.2, issue #2383) — the PRIVATE look. New Op: the
//      whole-hand sibling of `lookRandomHand` (Urza's Bauble) and the private
//      counterpart of the public `reveal` (CR 701.20) the Thoughtseize/Duress
//      template uses. Not redundant with the pick below, which already
//      exposes the hand to its chooser while it is head-of-queue
//      (`handPickExposed`, issue #1698): the look is its own game action and
//      still happens when the pick never raises — an all-lands hand matches
//      the nonland filter nowhere, so no choice is offered (CR 608.2b) and
//      Elite Spellbinder has still looked.
//   2. `choice` — the "you may exile a nonland card FROM IT" pick, a
//      `count: { min: 0, max: 1 }` optional pick over the SAME hand
//      (`zoneOwnerId`, the Grief/Thoughtseize shape) filtered to nonlands.
//   3. `moveZone` (CR 400.7) — hand → exile, face up: exile is a PUBLIC zone
//      (CR 400.2) and this card's Oracle grants no face-down clause, so both
//      players see what was taken.
//   4. `grantCastFromExile` (CR 601.3e) with `window: "while-exiled"` — "for
//      as long as that card remains exiled, ITS OWNER may play it", so the
//      grantee is the targeted opponent, not this card's controller (the
//      cross-player direction opposite to Dauthi Voidwalker's).
//
// CR 601.2f — "A spell cast this way costs {2} more to cast" is the Op's new
// `costIncrease` rider (issue #2383), NOT a `StaticCostModifier`: that kind is
// re-scanned off the battlefield at every cost computation and would stop
// taxing the moment Elite Spellbinder dies, is bounced or is exiled, while
// this tax belongs to the exiled CARD OBJECT and outlives its source. It is
// stamped on `CardInstanceState.castFromExileCostIncrease` and folded in by
// `getCostModifiers`, the one collector the payment path, the "cast"
// affordance and the Bot's tap planner already share.
//
// CR 305.9 (issue #1689) — the Oracle says "may PLAY it", so the grant is
// land-inclusive (`includesLand`). Inert in practice: step 2's filter can only
// ever exile a NONLAND card, and a card's types cannot change in exile. Kept
// because the flag encodes the granting text's own wording, which is what its
// field doc asks for.
const eliteSpellbinderTriggerEffects: EffectOp[] = [
    { op: "lookHand", player: { target: 0 } },
    {
        op: "choice",
        kind: "choose-hand-card",
        player: "controller",
        zoneOwnerId: { target: 0 },
        zone: "hand",
        filter: { excludeType: "Land" },
        count: { min: 0, max: 1 },
        prompt: "You may exile a nonland card from your opponent's hand.",
        bind: "$spellbound",
    },
    {
        op: "moveZone",
        cards: { ref: "$spellbound" },
        player: { target: 0 },
        from: "hand",
        to: "exile",
    },
    {
        op: "grantCastFromExile",
        card: { ref: "$spellbound" },
        player: { target: 0 },
        window: "while-exiled",
        includesLand: true,
        costIncrease: { X: 2 },
    },
];

export const eliteSpellbinder: CardDefinition = {
    id: "9d3a7998-ccac-45ad-a4e9-3a2cb057f63b",
    name: "Elite Spellbinder",
    rarity: "rare",
    oracleText:
        "Flying\nWhen this creature enters, look at target opponent's hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell cast this way costs {2} more to cast.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 3,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "elite-spellbinder-etb",
            oracleText:
                "When this creature enters, look at target opponent's hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell cast this way costs {2} more to cast.",
            scope: "self",
            // CR 603.3d — "target opponent" is a REAL target announced as the
            // trigger goes on the stack, never a relative `EffectPlayerRef`:
            // only a declared `targetRequirement` reaches the player-target
            // legality gate (protection from everything, shroud — CR 702.16b /
            // 702.18 via CR 115.4, issue #2801).
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: eliteSpellbinderTriggerEffects,
        }),
    ],
};
