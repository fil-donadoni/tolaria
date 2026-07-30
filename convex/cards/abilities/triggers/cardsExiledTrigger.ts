// `cardsExiledTrigger` — factory for `CARDS_EXILED` triggered abilities
// (issue #1558, CR 400.1 / 603.3b / 608.2i — "whenever one or more cards are
// put into exile from your library and/or your graveyard"-style clauses,
// Laelia, the Blade Reforged).
//
// `CARDS_EXILED` is emitted ONCE per exile OCCURRENCE — a single primitive
// call / resolving instruction, however many cards it moved into exile at
// once — by every exile-producing call site in `state.ts` (see the event's
// own doc comment in `cards/types.ts`). That is exactly the batching the
// official Laelia ruling calls for: "This ability triggers only once for
// each time cards are put into exile this way, no matter how many cards were
// exiled at the same time." No extra batching machinery is needed here
// (mirrors `tokenCreatedTrigger`'s reasoning, issue #1345) — the choke point
// is already the batch.
//
// Mirrors `tokenCreatedTrigger`'s shape on purpose: `fromZones` narrows the
// per-card `fromZone` discriminator the way that factory's `filter` narrows
// `types`/`subtypes`; `scope` gates by whose zone the cards came from
// (`event.cards[].ownerId` relative to the trigger source's controller).

import type {
    CardsExiledEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Zone an exiled card can have come from (mirrors `CardsExiledEvent.cards[].fromZone`). */
export type CardsExiledFromZone =
    | "library"
    | "graveyard"
    | "battlefield"
    | "hand"
    | "stack";

/** Controller-relation scope for a `CARDS_EXILED` occurrence, relative to the
 *  trigger's source (CR 109.2) — compared against each exiled card's
 *  `ownerId` (for a library/graveyard/hand source this is also that zone's
 *  owner, CR 400.2). "you" is Laelia's "your library and/or your graveyard". */
export type CardsExiledScope = "you" | "opponents" | "any";

/** Flattened payload handed to a `cardsExiledTrigger`'s resolve callback. */
export interface CardsExiledInfo {
    /** The cards from this occurrence whose `fromZone` matched `fromZones`
     *  (an unfiltered-by-scope subset of `event.cards` — `resolve` has no
     *  `self` to re-derive the scope comparison, unlike `matches`/`condition`,
     *  which already gated the ability on a qualifying card existing). */
    cards: CardsExiledEvent["cards"];
}

export interface CardsExiledTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Controller-relation scope (CR 109.2) — see `CardsExiledScope`. */
    scope: CardsExiledScope;
    /** Which source zone(s) qualify (Laelia: `["library", "graveyard"]`). At
     *  least one card in the occurrence must have a `fromZone` in this list
     *  AND satisfy `scope` for the ability to fire. */
    fromZones: ReadonlyArray<CardsExiledFromZone>;
    /** CR 603.4 check-time predicate, evaluated after scope+fromZones pass. */
    condition?: (
        event: CardsExiledEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if; re-evaluated by the engine at resolve time. */
    interveningIf?: (
        event: CardsExiledEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect run when the trigger resolves from the stack. Mutually
     *  exclusive with `effects` — use exactly one. */
    resolve?: (
        ctx: SpellContext,
        event: CardsExiledEvent,
        info: CardsExiledInfo
    ) => void;
    /** Effect Script (ADR 0045) — declarative alternative to `resolve`. Rides
     *  straight to the interpreter with the trigger source's controller and
     *  `$source` bound, mirroring `tokenCreatedTrigger.effects`. Mutually
     *  exclusive with `resolve`. */
    effects?: EffectOp[];
}

function matchesCardsExiledScope(
    scope: CardsExiledScope,
    cardOwnerId: string,
    selfControllerId: string
): boolean {
    switch (scope) {
        case "you":
            return cardOwnerId === selfControllerId;
        case "opponents":
            return cardOwnerId !== selfControllerId;
        case "any":
            return true;
    }
}

/** Cards in `event.cards` whose `fromZone` is in `fromZones` AND satisfy
 *  `scope` against `selfControllerId`. Empty when nothing qualifies. */
function qualifyingCards(
    args: Pick<CardsExiledTriggerArgs, "fromZones" | "scope">,
    event: CardsExiledEvent,
    selfControllerId: string
): CardsExiledEvent["cards"] {
    return event.cards.filter(
        (c) =>
            args.fromZones.includes(c.fromZone) &&
            matchesCardsExiledScope(args.scope, c.ownerId, selfControllerId)
    );
}

/** Builds a `TriggeredAbility` listening for `CARDS_EXILED` events (issue
 *  #1558, CR 400.1 / 603.3b / 608.2i). The factory handles event-type
 *  narrowing, scope+fromZone gating, and CR 603.4 / 603.4d wiring so card
 *  authors write only the effect body. */
export function cardsExiledTrigger(
    args: CardsExiledTriggerArgs
): TriggeredAbility {
    const matches = (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (event.type !== "CARDS_EXILED") return false;
        if (qualifyingCards(args, event, self.controllerId).length === 0) {
            return false;
        }
        if (
            args.condition !== undefined &&
            !args.condition(event, self, state)
        ) {
            return false;
        }
        return true;
    };

    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "CARDS_EXILED",
        matches,
        // ADR 0045 — a declarative Effect Script bypasses the event-narrowing
        // `resolve` wrapper entirely, mirroring `tokenCreatedTrigger`.
        // Mutually exclusive with `resolve`.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "CARDS_EXILED") return;
                      const cards = event.cards.filter((c) =>
                          args.fromZones.includes(c.fromZone)
                      );
                      args.resolve!(ctx, event, { cards });
                  },
              }),
    };
    if (args.interveningIf !== undefined) {
        const userInterveningIf = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "CARDS_EXILED") return false;
            return userInterveningIf(event, self, state);
        };
    }
    return withTriggerGate(ability, args);
}
