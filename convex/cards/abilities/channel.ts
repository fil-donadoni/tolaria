// `channelAbility` — a declarative factory for the Channel ability word
// (CR 207.2c preamble — "channel" is in the official ability-word glossary,
// `bun run cr grep "Channel"`), issue #2290.
//
// UNLIKE Cycling (CR 702.29a — a real keyword ability whose activation cost
// and effect are BOTH defined by the rules text, "[cost], Discard this card:
// Draw a card."), an ability word carries "no special rules meaning" (CR
// 207.2c) — the printed text after "Channel — " spells out a COMPLETE,
// bespoke activated ability per card. So this factory fixes only the three
// properties every Channel ability shares structurally, mirroring
// `cyclingActivationShell` (`cards/abilities/cycling.ts`): activatable from
// hand (CR 113.6j), the discard-this cost, and stack use (CR 602.1 — usable
// any time the activating player could cast an instant, since nothing here
// restricts timing further). Callers supply the printed mana cost, target
// requirement (if any) and the full Effect Script body.
//
// The reduction some Channel cards print ("This ability costs {1} less to
// activate for each legendary creature you control") is a PARAMETER, never
// baked in: of NEO's 23 Channel cards only the five legendary lands carry
// one, and Channel the ability word implies none — a factory defaulting it
// in would ship every future Channel card born with an unprinted discount.
// Named `selfReduction` for the MECHANISM (`ActivatedAbility.cost.selfReduction`,
// ADR 0096), never for the clause that motivated it.
//
// The Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) is the name
// authority: Channel is row `id: "channel"` (ability word, CR 207.2c). The
// row grants nothing by itself — it exists so the name has one authority, the
// same reason `Domain` earns a row despite carrying no independent rules text
// either. NOTE the homonym: an unrelated Alpha sorcery named "Channel" is
// already in the catalogue (`convex/cards/sets/lea/*.ts` or similar) — this
// factory and its abilities never collide with it in ids or identifiers.
import type {
    ActivatedAbility,
    CostReductionAmount,
    EffectOp,
    ManaCost,
    TargetRequirement,
} from "../types";

export function channelAbility(args: {
    id: string;
    /** The printed Channel activation cost (mana only — the discard-this
     *  leg is added by this factory, never repeated by the caller). */
    cost: ManaCost;
    /** The FULL printed Oracle text for this ability, including the
     *  "Channel — " prefix — unlike Cycling, there is no shared reminder-text
     *  template to render, so the caller states it verbatim. */
    oracleText: string;
    effects: EffectOp[];
    targetRequirement?: TargetRequirement;
    /** CR 601.2f self-host reduction on THIS ability (ADR 0096,
     *  `ActivatedAbility.cost.selfReduction`) — omitted by default. Named for
     *  the mechanism, never for "legendary" or any other specific clause: a
     *  future Channel card reducing on a different count still passes its own
     *  `CostReductionAmount` through this same parameter. */
    selfReduction?: CostReductionAmount;
}): ActivatedAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        // CR 113.6j — the discard-this cost, mirroring Cycling's non-mana
        // leg exactly (`discardThis` routes through the shared
        // `discardToGraveyard` choke point, so a "whenever you discard"
        // trigger fires from it, CR 701.8). No `cyclingCost` marker — that
        // flag exists only to disambiguate a "when you cycle this card"
        // trigger (CR 702.29c), which no Channel card carries.
        cost: {
            mana: args.cost,
            discardThis: true,
            ...(args.selfReduction
                ? { selfReduction: args.selfReduction }
                : {}),
        },
        // CR 113.6j — functions only while this card is in its owner's hand.
        activateFromHand: true,
        // CR 602.1 — not a mana ability: uses the stack, so it may be
        // responded to, and is activatable at instant speed (no timing
        // restriction is printed on any Channel card).
        useStack: true,
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        effects: args.effects,
    };
}
