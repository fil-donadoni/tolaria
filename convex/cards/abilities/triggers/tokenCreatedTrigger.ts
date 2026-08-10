// `tokenCreatedTrigger` — specialized factory for `TOKENS_CREATED` triggered
// abilities (CR 111 / 707.2, issue #1345 — "whenever you create one or more
// [X] tokens" triggers, e.g. Staff of the Storyteller's "Whenever you create
// one or more creature tokens, put a story counter on this artifact.").
//
// `TOKENS_CREATED` is emitted ONCE per `createTokenPermanents` call (a call
// already creates `count` copies of ONE `TokenSpec`) — see the event's own
// doc comment in `cards/types.ts`. That is exactly the batching the real
// card's "one or more" wording wants: creating 3 tokens in one resolution
// puts ONE story counter on Staff, not three. No extra batching machinery is
// needed here (contrast `delayedTrigger`'s repeating-timing "this-turn-..."
// precedent, which accumulates PER-OCCURRENCE events over a longer window) —
// the choke point is already the batch.
//
// Mirrors `enteredTrigger`'s shape on purpose: same scope-vs-filter-vs-
// condition-vs-interveningIf wiring, same `resolve` / `effects` mutual-
// exclusivity (ADR 0045). The scope vocabulary is intentionally narrower
// than `PermanentScope` — a token-creation event has no single "the affected
// permanent" identity to compare against `self` (`count` created tokens all
// share one spec), so "self" / "host" / "another-yours" / "any-other" don't
// apply; only the controller-relation axis does.

import type {
    CardType,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TokensCreatedEvent,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import type { PermanentFilter } from "../../filters";
import { matchesPermanentFilter, type MatchablePermanent } from "../../filters";
import { withTriggerGate } from "./shared";

/** Controller-relation scope for a `TOKENS_CREATED` event, relative to the
 *  trigger's source (CR 109.2). "you" is the common case (Staff of the
 *  Storyteller); "opponents" / "any" are provided for symmetry with every
 *  other scoped trigger factory even though no shipped card uses them yet. */
export type TokenCreatedScope = "you" | "opponents" | "any";

/** Flattened payload handed to a `tokenCreatedTrigger`'s resolve callback. */
export interface TokenCreatedInfo {
    /** Controller of the created tokens (the "you" in "whenever you create"). */
    controllerId: string;
    /** How many tokens this occurrence created (>= 1, the batched count). */
    count: number;
    /** Card types of the created tokens, snapshotted at emit time. */
    types: ReadonlyArray<CardType>;
    /** Card subtypes of the created tokens, snapshotted at emit time. */
    subtypes: ReadonlyArray<string>;
}

export interface TokenCreatedTriggerArgs {
    id: string;
    oracleText: string;
    /** Controller-relation scope (CR 109.2) — see `TokenCreatedScope`. */
    scope: TokenCreatedScope;
    /** Optional structural filter over the created tokens' snapshotted
     *  `types`/`subtypes` (CR 707.2 — e.g. `{ types: "Creature" }` narrows to
     *  "creature tokens", Staff of the Storyteller's exact clause). Combined
     *  with `scope` via AND. Matched against a synthesized `MatchablePermanent`
     *  built from the event's snapshot fields — `controllerRelation` on this
     *  filter is redundant with `scope` and not needed by any shipped card,
     *  but is honored for completeness since the same filter vocabulary is
     *  reused everywhere else. */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate, evaluated after scope+filter pass. */
    condition?: (
        event: TokensCreatedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if; re-evaluated by the engine at resolve time. */
    interveningIf?: (
        event: TokensCreatedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect run when the trigger resolves from the stack. Mutually
     *  exclusive with `effects` — use exactly one. */
    resolve?: (
        ctx: SpellContext,
        event: TokensCreatedEvent,
        created: TokenCreatedInfo
    ) => void;
    /** Effect Script (ADR 0045) — declarative alternative to `resolve`. Rides
     *  straight to the interpreter with the trigger source's controller and
     *  `$source` bound, mirroring `enteredTrigger.effects` — the source is
     *  always the permanent that HAS this "whenever you create ..." ability,
     *  never the created token(s). Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
}

function matchesTokenCreatedScope(
    scope: TokenCreatedScope,
    event: TokensCreatedEvent,
    self: PermanentView
): boolean {
    switch (scope) {
        case "you":
            return event.controllerId === self.controllerId;
        case "opponents":
            return event.controllerId !== self.controllerId;
        case "any":
            return true;
    }
}

/** Builds a `TriggeredAbility` listening for `TOKENS_CREATED` events
 *  (CR 111 / 707.2, issue #1345). The factory handles event-type narrowing,
 *  scope gating, filter matching, and CR 603.4 / 603.4 wiring so card
 *  authors write only the effect body. */
export function tokenCreatedTrigger(
    args: TokenCreatedTriggerArgs
): TriggeredAbility {
    const matches = (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (event.type !== "TOKENS_CREATED") return false;
        if (!matchesTokenCreatedScope(args.scope, event, self)) return false;
        if (args.filter !== undefined) {
            const subject: MatchablePermanent = {
                id: `${event.controllerId}-tokens-created`,
                types: event.types,
                subtypes: event.subtypes,
                staticAbilities: [],
                controllerId: event.controllerId,
                isToken: true,
            };
            if (
                !matchesPermanentFilter(subject, args.filter, {
                    selfInstanceId: self.id,
                    selfControllerId: self.controllerId,
                })
            ) {
                return false;
            }
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
        event: "TOKENS_CREATED",
        matches,
        // ADR 0045 — a declarative Effect Script bypasses the event-narrowing
        // `resolve` wrapper entirely, mirroring `enteredTrigger`. Mutually
        // exclusive with `resolve`.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "TOKENS_CREATED") return;
                      const created: TokenCreatedInfo = {
                          controllerId: event.controllerId,
                          count: event.count,
                          types: event.types,
                          subtypes: event.subtypes,
                      };
                      args.resolve!(ctx, event, created);
                  },
              }),
    };
    if (args.interveningIf !== undefined) {
        const userInterveningIf = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "TOKENS_CREATED") return false;
            return userInterveningIf(event, self, state);
        };
    }
    return withTriggerGate(ability, args);
}
