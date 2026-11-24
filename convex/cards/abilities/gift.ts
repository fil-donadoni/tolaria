// Gift (CR 702.174) — the keyword that means TWO abilities.
//
// CR 702.174a: "Gift is a keyword that represents two abilities. It is written
//              'Gift a [something].' The first ability is a static ability
//              that functions while the card with gift is on the stack, and
//              the second is either an ability that functions while the card
//              with gift is on the stack or a triggered ability that functions
//              while the card with gift is on the battlefield. The first
//              ability is always 'As an additional cost to cast this spell,
//              you may choose an opponent.'"
//
// ── Which half lives where ──────────────────────────────────────────────────
//
// COST HALF — a `kickers[]` entry with `keyword: "gift"` ({@link giftCost}),
// the Offspring shape (`offspring.ts`): an optional additional cost the
// cast-cost dialog offers as a toggle, paid at most once, never "kicked"
// (CR 702.33d), read back by `{ additionalCostPaid: "<id>" }`. Choosing the
// opponent is the whole cost, so the entry has no legs. This engine is
// two-player (ADR 0010), so the chosen player is the caster's one opponent
// and every delivery below names `"opponent"`; there is no choice to record.
//
// SECOND HALF — CR 702.174b: "On a permanent, the second ability represented
// by gift is 'When this permanent enters, if its gift cost was paid,
// [effect].' On an instant or sorcery spell, the second ability represented by
// gift is 'If this spell's gift cost was paid, [effect].'"
//
//   - permanent: {@link giftTrigger} — the twin trigger, linked to the cost
//     entry by `additionalCostTwin` and gated at check time AND at resolution
//     on the entry's own payment record, exactly as `offspringTrigger` is
//     (CR 603.4; that template's doc block is the authority for why both).
//   - instant / sorcery: {@link giftSpellOps} — the `if` branch the spell's
//     Effect Script OPENS with: CR 702.174j, "the effect of a gift ability
//     always happens before any other spell abilities of the card. If the
//     spell is countered or otherwise leaves the stack before resolving, the
//     gift effect doesn't happen" — which a branch inside the spell's own
//     script gives for free.
//
// CR 702.174c's "whenever a player gives a gift" is the ENGINE's, not this
// file's: `emitGiftGivenIfGiven` (`gre/gift.ts`) emits `GIFT_GIVEN` as either
// object resolves.
import type {
    AdditionalCostTwin,
    EffectOp,
    KickerCost,
    TriggeredAbility,
} from "../types";
import {
    EFFECT_TREASURE_TOKEN,
    FISH_TOKEN,
    FOOD_TOKEN,
    OCTOPUS_TOKEN,
} from "../sharedTokens";
import { enteredTrigger } from "./triggers/enteredTrigger";
import {
    additionalCostPaidCondition,
    withAdditionalCostTwin,
} from "./triggers/shared";

/** CR 702.174d–i — the [something] a "Gift a [something]" line names. */
export type GiftKind =
    | "card"
    | "food"
    | "tapped-fish"
    | "treasure"
    | "octopus"
    | "extra-turn";

/** Every {@link GiftKind}, in CR order. */
export const GIFT_KINDS: readonly GiftKind[] = [
    "food",
    "card",
    "tapped-fish",
    "extra-turn",
    "treasure",
    "octopus",
];

/** The `KickerCost.id` a gift card's cost entry uses — one per card, since no
 *  printed card has two instances of gift. */
export const GIFT_COST_ID = "gift";

/** The printed "Gift a [something]" — the keyword line, and the cast-cost
 *  dialog's toggle label. */
const GIFT_LINE: Record<GiftKind, string> = {
    food: "Gift a Food",
    card: "Gift a card",
    "tapped-fish": "Gift a tapped Fish",
    "extra-turn": "Gift an extra turn",
    treasure: "Gift a Treasure",
    octopus: "Gift an Octopus",
};

/** The CR text of each gift's effect, the stack line of its twin trigger. */
const GIFT_EFFECT_TEXT: Record<GiftKind, string> = {
    // CR 702.174d
    food: "the chosen player creates a Food token",
    // CR 702.174e
    card: "the chosen player draws a card",
    // CR 702.174f
    "tapped-fish":
        "the chosen player creates a tapped 1/1 blue Fish creature token",
    // CR 702.174g
    "extra-turn": "the chosen player takes an extra turn after this one",
    // CR 702.174h
    treasure: "the chosen player creates a Treasure token",
    // CR 702.174i
    octopus: "the chosen player creates an 8/8 blue Octopus creature token",
};

/** "Gift a [something]" → its kind, or null for a line no CR subrule defines. */
export function giftKindOfLine(line: string): GiftKind | null {
    return GIFT_KINDS.find((kind) => GIFT_LINE[kind] === line) ?? null;
}

/** CR 702.174a — the cost half: "As an additional cost to cast this spell,
 *  you may choose an opponent." */
export function giftCost(
    kind: GiftKind,
    id: string = GIFT_COST_ID
): KickerCost {
    return { id, keyword: "gift", description: GIFT_LINE[kind] };
}

/** CR 702.174d–i — what the chosen player receives, as Ops on already-shipped
 *  verbs. "The chosen player" is the controller's one opponent (two-player
 *  engine, ADR 0010). */
export function giftDeliveryOps(kind: GiftKind): EffectOp[] {
    switch (kind) {
        case "food":
            return [
                {
                    op: "createToken",
                    token: FOOD_TOKEN,
                    controller: "opponent",
                },
            ];
        case "card":
            return [{ op: "draw", player: "opponent", count: 1 }];
        case "tapped-fish":
            // CR 111.10 — "tapped" is the creating effect's own modification.
            return [
                {
                    op: "createToken",
                    token: { ...FISH_TOKEN, entersTapped: true },
                    controller: "opponent",
                },
            ];
        case "extra-turn":
            return [{ op: "extraTurn", player: "opponent" }];
        case "treasure":
            return [
                {
                    op: "createToken",
                    token: EFFECT_TREASURE_TOKEN,
                    controller: "opponent",
                },
            ];
        case "octopus":
            return [
                {
                    op: "createToken",
                    token: OCTOPUS_TOKEN,
                    controller: "opponent",
                },
            ];
    }
}

/** "If [the] gift cost was paid, [effect]" — read off the resolving object's
 *  own payment record (the spell, or the trigger's snapshot of it). */
function giftPaidBranch(kind: GiftKind, costId: string): EffectOp {
    return {
        op: "if",
        predicate: { left: { additionalCostPaid: costId }, op: "ge", right: 1 },
        then: giftDeliveryOps(kind),
    };
}

/** CR 702.174b/j — an instant or sorcery's gift ability: the Op list its
 *  Effect Script OPENS with, before every other spell ability of the card. */
export function giftSpellOps(
    kind: GiftKind,
    costId: string = GIFT_COST_ID
): EffectOp[] {
    return [giftPaidBranch(kind, costId)];
}

export interface GiftTriggerArgs {
    /** The card's name, for the oracle line shown on the stack. */
    cardName: string;
    kind: GiftKind;
    /** The `KickerCost.id` of the gift cost entry this trigger is the twin of.
     *  Defaults to {@link GIFT_COST_ID}. */
    costId?: string;
}

/** The JSON half of a permanent's gift trigger (CR 702.174b): id, stack text
 *  and Effect Script. Shared by {@link giftTrigger} and the Oracle compiler's
 *  compiled-trigger descriptor (`convex/oracle/lower.ts`). */
export function giftTriggerParts(args: GiftTriggerArgs): {
    id: string;
    costId: string;
    oracleText: string;
    effects: EffectOp[];
} {
    const costId = args.costId ?? GIFT_COST_ID;
    return {
        id: `gift-delivery-${costId}`,
        costId,
        oracleText: `When ${args.cardName} enters, if its gift cost was paid, ${GIFT_EFFECT_TEXT[args.kind]}.`,
        // CR 603.4, check 2 — the resolving item's own snapshot.
        effects: [giftPaidBranch(args.kind, costId)],
    };
}

/** CR 702.174b — a permanent's gift trigger. Add it to the card's
 *  `triggeredAbilities[]` beside the {@link giftCost} entry it names; the
 *  catalogue guard (`additionalCostKeywords.test.ts`) fails on either half
 *  without the other. */
export function giftTrigger(args: GiftTriggerArgs): TriggeredAbility {
    const parts = giftTriggerParts(args);
    const twin: AdditionalCostTwin = { keyword: "gift", costId: parts.costId };
    return withAdditionalCostTwin(
        enteredTrigger({
            id: parts.id,
            oracleText: parts.oracleText,
            scope: "self",
            // CR 603.4, check 1 — an unpaid gift cost announces nothing.
            conditionOnSelf: additionalCostPaidCondition(parts.costId),
            effects: parts.effects,
        }),
        twin
    );
}
