// `librarySearchedTrigger` — factory for `LIBRARY_SEARCHED` triggered
// abilities (CR 603.2 / 701.19a, issue #788 — the residual "whenever an
// opponent searches their library" trigger condition; the sibling
// "becomes the target of a spell/ability an opponent controls"
// (`BECAME_TARGET`, issue #1265, Leovold, Emissary of Trest) and "whenever
// you create one or more tokens" (`TOKENS_CREATED`, issue #1345,
// `tokenCreatedTrigger`) variants already shipped).
//
// `LIBRARY_SEARCHED` is emitted ONCE per completed `search-library`
// PendingChoice commit (`gre/pendingChoiceSubmit.ts`) — the single choke
// point EVERY library search funnels through, whether authored as a DSL
// `choice(kind: "search-library")` Op (every shipped tutor/fetchland) or an
// imperative `resolve()` closure, and regardless of whether the search
// finds anything (CR 701.19a — the ACT of searching is the trigger
// condition, not the result). See the event's own doc comment in
// `cards/types.ts`.
//
// Mirrors `tokenCreatedTrigger`'s shape on purpose: same scope-vs-condition-
// vs-interveningIf wiring, same `resolve`/`effects` mutual exclusivity
// (ADR 0045). No per-search structural filter is offered (unlike
// `tokenCreatedTrigger`'s `types`/`subtypes` token filter) — no shipped card
// narrows by WHAT was searched for, only WHO searched.

import type {
    EffectOp,
    GameEvent,
    LibrarySearchedEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Controller-relation scope for a `LIBRARY_SEARCHED` event, relative to the
 *  trigger's source (CR 109.2). "opponents" is Wan Shi Tong, Librarian's
 *  "whenever an opponent searches their library"; "you" / "any" are
 *  provided for symmetry with every other scoped trigger factory even
 *  though no shipped card uses them yet. */
export type LibrarySearchedScope = "you" | "opponents" | "any";

/** Flattened payload handed to a `librarySearchedTrigger`'s resolve callback. */
export interface LibrarySearchedInfo {
    /** The player who performed the search (CR 701.19a). */
    playerId: string;
}

export interface LibrarySearchedTriggerArgs {
    id: string;
    oracleText: string;
    /** Controller-relation scope (CR 109.2) — see `LibrarySearchedScope`. */
    scope: LibrarySearchedScope;
    /** CR 603.4 check-time predicate, evaluated after scope passes. */
    condition?: (
        event: LibrarySearchedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if; re-evaluated by the engine at resolve time. */
    interveningIf?: (
        event: LibrarySearchedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect run when the trigger resolves from the stack. Mutually
     *  exclusive with `effects` — use exactly one. */
    resolve?: (
        ctx: SpellContext,
        event: LibrarySearchedEvent,
        info: LibrarySearchedInfo
    ) => void;
    /** Effect Script (ADR 0045) — declarative alternative to `resolve`. Rides
     *  straight to the interpreter with the trigger source's controller and
     *  `$source` bound, mirroring `tokenCreatedTrigger.effects` — the source
     *  is always the permanent that HAS this "whenever an opponent
     *  searches..." ability, never the searching player. Mutually exclusive
     *  with `resolve`. */
    effects?: EffectOp[];
}

function matchesLibrarySearchedScope(
    scope: LibrarySearchedScope,
    event: LibrarySearchedEvent,
    self: PermanentView
): boolean {
    // CR 701.19a (bugfix, issue #788 post-review) — "searches THEIR
    // library" requires the searcher to be searching their OWN library.
    // `event.playerId` (the searcher) and `event.libraryOwnerId` (whose
    // library) differ for a Jester's Cap/Jester's Mask/Lobotomy-shaped
    // "search TARGET PLAYER's library" (the caster searches an opponent's
    // library) — that is a materially different condition from "an
    // opponent searches their own library" and must never satisfy any
    // scope here, so it's gated out before the scope switch runs at all.
    if (event.playerId !== event.libraryOwnerId) return false;
    switch (scope) {
        case "you":
            return event.playerId === self.controllerId;
        case "opponents":
            return event.playerId !== self.controllerId;
        case "any":
            return true;
    }
}

/** Builds a `TriggeredAbility` listening for `LIBRARY_SEARCHED` events
 *  (CR 603.2 / 701.19a, issue #788). The factory handles event-type
 *  narrowing, scope gating, and CR 603.4 wiring so card authors
 *  write only the effect body. */
export function librarySearchedTrigger(
    args: LibrarySearchedTriggerArgs
): TriggeredAbility {
    const matches = (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (event.type !== "LIBRARY_SEARCHED") return false;
        if (!matchesLibrarySearchedScope(args.scope, event, self)) {
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
        event: "LIBRARY_SEARCHED",
        matches,
        // ADR 0045 — a declarative Effect Script bypasses the event-narrowing
        // `resolve` wrapper entirely, mirroring `tokenCreatedTrigger`.
        // Mutually exclusive with `resolve`.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "LIBRARY_SEARCHED") return;
                      args.resolve!(ctx, event, { playerId: event.playerId });
                  },
              }),
    };
    if (args.interveningIf !== undefined) {
        const userInterveningIf = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "LIBRARY_SEARCHED") return false;
            return userInterveningIf(event, self, state);
        };
    }
    return withTriggerGate(ability, args);
}
