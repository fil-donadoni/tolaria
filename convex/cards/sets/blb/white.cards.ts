// blb — white cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { OFFSPRING_COST_ID, offspringTrigger } from "../../abilities/offspring";

// Intrepid Rabbit — {2}{W} Creature — Rabbit Soldier, 3/2. "Offspring {1} (You
// may pay an additional {1} as you cast this spell. If you do, when this
// creature enters, create a 1/1 token copy of it.)\nWhen this creature enters,
// target creature you control gets +1/+1 until end of turn." The first
// Offspring card (CR 702.175, issue #2079).
//
// ── Offspring's two linked abilities (CR 702.175a) ──────────────────────────
//
// The reminder text collapses them; the rule does not. "Offspring [cost]" means
// BOTH «You may pay an additional [cost] as you cast this spell» AND «When this
// permanent enters, if its offspring cost was paid, create a token that's a
// copy of it, except it's 1/1.» Each half is declared separately below, because
// each rides a different engine seam — and because CR 702.175b makes them
// separable by construction: a card with two instances would declare two cost
// entries with distinct ids and two triggers, one per id.
//
// COST HALF — a `kickers[]` entry (ADR 0079) carrying the ADR 0085
// discriminator `keyword: "offspring"`. CR 702.175a's cost clause is Kicker's
// cost clause word for word (CR 702.33a), so the shared announcement/payment
// path expresses it unchanged; what the discriminator buys is CR 702.33d —
// "kicked" is defined over KICKER costs alone, so the row says
// `countsAsKicked: false`, the payment lands in `unkickedCostPayments` and this
// spell is NOT a kicked spell on any surface. `multi` is absent and the table
// row forbids it: there is no "any number of times" clause in CR 702.175, and
// 702.175b's multiple instances are multiple ENTRIES, not one repeatable one.
// Offspring is an ADDITIONAL cost, not an alternative one (CR 601.2f): {2}{W}
// is still paid in full, plus {1}.
//
// TRIGGER HALF — `offspringTrigger` (`cards/abilities/offspring.ts`), the
// shared template. That file carries the whole derivation: the CR 603.4
// check-time gate, the resolution-time branch read off the stack item's own
// payment record rather than a declared `interveningIf` (issue #2042), the
// CR 707.2 "except it's 1/1" clause, and the CR 608.2h / 111.12 last-known
// -information read that keeps the token coming when the creature is killed in
// response to the trigger.
//
// ── The second line ─────────────────────────────────────────────────────────
//
// "When this creature enters, target creature you control gets +1/+1 until end
// of turn." A separate Oracle line, so a separate `TriggeredAbility`
// (CR 603.2), with its own `targetRequirement` — announced when the ability is
// put on the stack (CR 603.3d). The Rabbit itself is a legal target: it is a
// creature its controller controls and it is already on the battlefield when
// its own ETB trigger is put on the stack, so the ability never lacks a target
// on an otherwise empty board.
//
// Guard C (issue #2701) — the Oracle compiler's grammar reads no additional-
// cost keyword, so the offspring line is named for the corpus backlog PRD #2693
// ranks the next grammar rule by.
// compiler-gap: Offspring {1} (You may pay an additional {1} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.) (#2693)
export const intrepidRabbit: CardDefinition = {
    id: "4d70b99d-c8bf-4a56-8957-cf587fe60b81", // BLB 17
    name: "Intrepid Rabbit",
    rarity: "common",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Rabbit", "Soldier"],
    power: 3,
    toughness: 2,
    oracleText:
        "Offspring {1} (You may pay an additional {1} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nWhen this creature enters, target creature you control gets +1/+1 until end of turn.",
    kickers: [
        {
            id: OFFSPRING_COST_ID,
            keyword: "offspring",
            // The cast-cost dialog renders `description` verbatim on the
            // per-entry toggle (`CastCostKickerField`), so it must read as the
            // printed keyword line, not as a bare cost.
            description: "Offspring {1}",
            mana: { X: 1 },
        },
    ],
    triggeredAbilities: [
        // CR 702.175a's trigger half — the shared template.
        offspringTrigger({ cardName: "Intrepid Rabbit" }),
        enteredTrigger({
            id: "intrepid-rabbit-pump",
            oracleText:
                "When this creature enters, target creature you control gets +1/+1 until end of turn.",
            scope: "self",
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
    ],
};
