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
// CR 120.3 — cards are drawn ONE AT A TIME. The engine emits one CARD_DRAWN
// event per card (see `emitCardDrawn`), so a "whenever you draw a card"
// trigger fires once per card: Sheoldred on Griselbrand's draw-7 fires 7
// times (gain 14 / opponent loses 14), not once. Each event carries count 1;
// a "whenever one or more" collapse is opt-in via `oncePerEventBatch`.

import type {
    CardDrawnEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

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
     *  `resolve`, mirroring `phaseTrigger`'s `effects` opt-in. A script that
     *  reads a player via the plain `"controller"` selector gets the
     *  SOURCE's controller — correct only when `scope: "your"` (the drawing
     *  player IS the source controller). `each` / `opponents` triggers act
     *  on a drawing player who can differ from the source's controller
     *  (Sheoldred's "an opponent draws, they lose 2 life"; Phyrexian
     *  Tyranny's "a player draws … unless THEY pay") — issue #1946 unblocks
     *  those scopes for DSL scripts too: read the drawing player via
     *  `{ ref: "$event.playerId" }` (a censused `EVENT_FIELD_REGISTRY` row
     *  for `CARD_DRAWN`, ADR 0049, mirroring `PHASE_BEGIN.activePlayerId`,
     *  issue #1066) instead of `"controller"` — that ref resolves straight
     *  off the firing event, bypassing `ctx.controller` entirely, so it is
     *  correct under any scope. Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
}

/** Reusable "this is exactly the drawing player's Nth draw this turn" trigger
 *  condition (issue #781, CR 121.1). Reads `CardDrawnEvent.drawIndexThisTurn`
 *  — the 0-based ordinal of THIS draw among the drawing player's draws this
 *  turn, stamped by `emitCardDrawn` (`gre/state.ts`) — the draw-side
 *  counterpart of `nthSpellThisTurn`'s `SpellCastEvent.casterSpellCountThisTurn`
 *  (`spellCastTrigger.ts`). For the drawing player's Nth draw the index is
 *  exactly N-1, so `nthDrawThisTurn(2)` is Faerie Mastermind's "whenever an
 *  opponent draws their SECOND card each turn" (CR 121.1); `nthDrawThisTurn(1)`
 *  is "their first card", and so on for any future card sharing the template.
 *  An undefined field (a pre-#781 hand-built test fixture, or an emitter that
 *  predates it) reads as the drawing player's FIRST draw (index 0), mirroring
 *  `nthSpellThisTurn`'s own fallback convention. Pass the result to
 *  `drawTrigger`'s `condition` — combine with `scope: "opponents"` for Faerie
 *  Mastermind's exact template (an OPPONENT'S draw counts, the effect still
 *  acts on the source's own controller). */
export function nthDrawThisTurn(
    n: number
): NonNullable<DrawTriggerArgs["condition"]> {
    return (event) => (event.drawIndexThisTurn ?? 0) === n - 1;
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

    return withTriggerGate(ability, args);
}
