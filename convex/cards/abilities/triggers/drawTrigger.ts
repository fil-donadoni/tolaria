// `drawTrigger` — declarative factory for CR 121.1 "when you draw a card"
// triggered abilities. Listens to CARD_DRAWN, emitted by the engine's draw
// choke points (turn-based draw step, draw-look replacements, and the
// `drawCards` SpellContext primitive). Card authors describe whose draw counts
// (scope) and what to do; the factory narrows the event type and resolves the
// player scope so the per-card body never re-narrows.
//
// Scope semantics mirror the player-relation scopes used elsewhere:
//   * "your"      — only the source controller's draws (Fasting).
//   * "each"      — any player's draw (the drawing player is passed through).
//   * "opponents" — only an opponent's draw.
//
// A single CARD_DRAWN event represents a whole draw batch (count >= 1). The
// ability fires once per batch, matching "when you draw a card" oracle wording
// for one-shot self-destruction (Fasting) — it does not multiply by `count`.

import type {
    CardDrawnEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";

/** Whose draw fires the trigger, relative to the source's controller. */
export type DrawTriggerScope = "your" | "each" | "opponents";

export interface DrawTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Relation between the drawing player and the source controller. */
    scope: DrawTriggerScope;
    /** Optional CR 603.4 check-time predicate, after scope passes. */
    condition?: (
        event: CardDrawnEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if; re-evaluated at resolve time by the engine. */
    interveningIf?: (
        event: CardDrawnEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives the typed event and the id of the player
     *  who drew (resolved from scope). Mutually exclusive with `effects`. */
    resolve?: (
        ctx: SpellContext,
        event: CardDrawnEvent,
        drawingPlayerId: string
    ) => void;
    /** Effect Script (ADR 0045, issue #803) — declarative alternative to
     *  `resolve`, mirroring `phaseTrigger`'s `effects` opt-in. The script
     *  reads `ctx.controller`, which is the SOURCE's controller — valid only
     *  when `scope: "your"` (the drawing player IS the source controller).
     *  `each` / `opponents` triggers act on a drawing player who can differ
     *  from the source's controller (Sheoldred's "an opponent draws, they
     *  lose 2 life"); those stay imperative via `resolve`. Mutually
     *  exclusive with `resolve`. */
    effects?: EffectOp[];
}

/** True iff `drawerId` satisfies `scope` relative to the source's controller. */
function drawScopeMatches(
    scope: DrawTriggerScope,
    drawerId: string,
    selfControllerId: string
): boolean {
    if (scope === "your") return drawerId === selfControllerId;
    if (scope === "opponents") return drawerId !== selfControllerId;
    return true; // "each"
}

export function drawTrigger(args: DrawTriggerArgs): TriggeredAbility {
    const drawMatches = (
        event: CardDrawnEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (!drawScopeMatches(args.scope, event.playerId, self.controllerId)) {
            return false;
        }
        if (args.condition && !args.condition(event, self, state)) return false;
        return true;
    };

    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "CARD_DRAWN",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "CARD_DRAWN") return false;
            if (!drawMatches(event, self, state)) return false;
            // CR 603.4d — mirror the intervening-if into matches so the trigger
            // never enters the stack when already false at fire time.
            if (args.interveningIf && !args.interveningIf(event, self, state)) {
                return false;
            }
            return true;
        },
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "CARD_DRAWN") return;
                      args.resolve!(ctx, event, event.playerId);
                  },
              }),
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "CARD_DRAWN") return false;
            return cb(event, self, state);
        };
    }

    return ability;
}
