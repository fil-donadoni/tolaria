// PIP — white cards, split by colour per ADR 0043. The registry's
// `import * as pip from "./sets/pip"` resolves through pip/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import {
    additionalCostPaidCondition,
    withAdditionalCostTwin,
} from "../../abilities/triggers/shared";

// Securitron Squadron — {1}{W} Artifact Creature — Robot, 2/2. "Squad {3} (As
// an additional cost to cast this spell, you may pay {3} any number of times.
// When this creature enters, create that many tokens that are copies of
// it.)\nVigilance\nWhenever a creature token you control enters, put a +1/+1
// counter on it." The first Squad card (CR 702.157, issue #3220).
//
// ── Squad's two linked abilities (CR 702.157a) ─────────────────────────────
//
// The reminder text collapses them; the rule does not. "Squad [cost]" means
// BOTH «As an additional cost to cast this spell, you may pay [cost] any
// number of times» AND «When this creature enters, if its squad cost was paid,
// create a token that's a copy of it for each time its squad cost was paid.»
// Each half is declared separately below, because each rides a different
// engine seam.
//
// COST HALF — a `kickers[]` entry (ADR 0079). Squad's cost clause is the same
// clause as Multikicker's, differently worded (CR 702.33c "any number of
// times"), so it is the SAME repeatability axis: `multi: true`. What separates it from a Kicker is
// CR 702.33d — "kicked" is defined over KICKER costs alone — so the entry
// carries the ADR 0085 discriminator `keyword: "squad"`, whose
// ADDITIONAL_COST_KEYWORDS row (`gre/kicker.ts`) says `countsAsKicked: false`.
// The payment therefore lands in `StackItem.unkickedCostPayments` and is
// invisible to `wasKicked`, `{ kickerCount: true }` and every other
// kicked-ness reader, while the per-id `{ additionalCostPaid: "squad" }` still
// reads it (`additionalCostPaidCount` sums across both records). Squad is an
// ADDITIONAL cost, not an alternative one (CR 601.2f): {1}{W} is still paid,
// plus {3} per squad payment.
//
// TRIGGER HALF — an `enteredTrigger({ scope: "self" })` with a CR 603.4
// INTERVENING IF ("if its squad cost was paid"), expressed as the shared
// check-time predicate `additionalCostPaidCondition("squad")` over the
// permanent's own snapshotted record — the exact gate the Planeshift
// Battlemage cycle uses (`pls/blue.ts`, issue #2015). With zero payments the
// ability never goes on the stack at all, which is what CR 603.4 asks for and
// what a resolution-time `if` alone could not give (the trigger would still
// have been announced). The `if` inside `effects[]` is ADR 0079's documented
// resolution-time answer and covers strictly more (an ability COPY put on the
// stack without re-running `matches`, CR 707.10) — here it is unnecessary
// because `count` is the payment tally itself: zero payments means a
// non-positive count, and the Op skips a non-positive count.
//
// The body is ONE already-exercised Op — no new verb. `createTokenCopy` with
// `source: { ref: "$source" }` reads the creature as it now sits on the
// battlefield and `count: { additionalCostPaid: "squad" }` creates exactly one
// copy per payment, all through a single `createTokenPermanents` call, so they
// enter SIMULTANEOUSLY (CR 603.6a). The copies carry no squad count of their
// own: CR 707.2 copies COPIABLE values, and a payment record is not one —
// `createTokenCopyOf` builds each token from a fresh placeholder that
// `applyCopy` overwrites, so a token creates no further tokens with no
// suppression code anywhere.
//
// CR 702.157b (multiple instances paid and triggered separately) needs nothing
// extra: the record is keyed by `KickerCost.id`, so two squad entries would
// already be two independent counts with two independent intervening-ifs —
// the plurality ADR 0079 built for "Kicker {A} and/or {B}". CR 400.7: the
// count does not survive a re-entry, because `resetBattlefieldTransientState`
// already deletes `unkickedCostPayments` on every zone change.
//
// ── The third line ─────────────────────────────────────────────────────────
//
// "Whenever a creature token you control enters, put a +1/+1 counter on it."
// Scope `yours` + `isToken` filter (CR 603.6a); "IT" is the TRIGGERING
// permanent, not a target — the clause announces nothing (CR 603.3d) — so it
// is named with the censused `$event.instanceId` object ref (ADR 0049,
// EVENT_FIELD_REGISTRY), legal here because `enteredTrigger` declares a SCALAR
// `event: "PERMANENT_ENTERED"`. Scope is `yours` and NOT `another-yours`: the
// squad tokens are creature tokens their controller controls, and this card's
// own arrival is not a token, so self-exclusion would only cost correctness on
// a token copy of this card watching its own entry.
//
// That interaction is the card's whole point and is intended: the squad tokens
// are copies of this creature, so each of them ALSO has this trigger, and all
// of them entered simultaneously — every copy sees every token in the set,
// itself included (CR 603.6a). N squad payments therefore put N+1 counters on
// each of the N tokens (the original's trigger plus each token's own).
//
// Guard C (issue #2701) — the Oracle compiler's grammar reads neither an
// additional-cost keyword nor an event-ref ETB trigger, so both fragments are
// named for the corpus backlog PRD #2693 ranks the next grammar rule by.
// compiler-gap: Squad {3} (As an additional cost to cast this spell, you may pay {3} any number of times. When this creature enters, create that many tokens that are copies of it.) (#2693)
// compiler-gap: Whenever a creature token you control enters, put a +1/+1 counter on it. (#2693)
export const securitronSquadron: CardDefinition = {
    id: "b689a206-aec3-4a31-95cf-3d4b840db04c", // PIP 23
    name: "Securitron Squadron",
    rarity: "rare",
    manaCost: { X: 1, W: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Robot"],
    power: 2,
    toughness: 2,
    oracleText:
        "Squad {3} (As an additional cost to cast this spell, you may pay {3} any number of times. When this creature enters, create that many tokens that are copies of it.)\nVigilance\nWhenever a creature token you control enters, put a +1/+1 counter on it.",
    staticAbilities: ["vigilance"],
    kickers: [
        {
            id: "squad",
            keyword: "squad",
            // The cast-cost dialog renders `description` verbatim on the
            // per-entry toggle (`CastCostKickerField`), so it must read as the
            // printed keyword line, not as a bare cost.
            description: "Squad {3}",
            multi: true,
            mana: { X: 3 },
        },
    ],
    triggeredAbilities: [
        // CR 702.157a's trigger half — see the card-level comment. Stamped as
        // the TWIN of the cost entry above (issue #2079): the catalogue guard
        // `cards/__tests__/additionalCostKeywords.test.ts` reads
        // `ADDITIONAL_COST_KEYWORDS.squad.requiresTrigger` and fails, in BOTH
        // directions, on a cost entry with no twin or a twin with no entry.
        // Before the marker existed the guard could only ask whether the card
        // had ANY triggered ability at all.
        withAdditionalCostTwin(
            enteredTrigger({
                id: "securitron-squadron-squad",
                oracleText:
                    "When this creature enters, if its squad cost was paid, create a token that's a copy of it for each time its squad cost was paid.",
                scope: "self",
                // CR 603.4 check-time gate: zero payments, no ability on the
                // stack.
                conditionOnSelf: additionalCostPaidCondition("squad"),
                effects: [
                    {
                        op: "createTokenCopy",
                        source: { ref: "$source" },
                        controller: "controller",
                        count: { additionalCostPaid: "squad" },
                    },
                ],
            }),
            { keyword: "squad", costId: "squad" }
        ),
        enteredTrigger({
            id: "securitron-squadron-token-counter",
            oracleText:
                "Whenever a creature token you control enters, put a +1/+1 counter on it.",
            scope: "yours",
            filter: { types: ["Creature"], isToken: true },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$event.instanceId" },
                    count: 1,
                },
            ],
        }),
    ],
};
