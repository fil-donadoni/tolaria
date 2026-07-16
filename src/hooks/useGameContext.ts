import { createContext, useContext } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Phase } from "@convex/gre/types";
import type { EmblemInstance } from "@convex/cards/types";
import type {
    CardInstance,
    Combat,
    GameOver,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingTarget,
    Player,
    StackItem,
} from "~/types/game";

type GameContext = {
    gameId: Id<"games">;
    playerId: string;
    activePlayerId: string;
    priorityPlayerId: string;
    phase: Phase;
    turn: number;
    stackCount: number;
    pendingCast?: PendingCast;
    pendingActivation?: PendingActivation;
    pendingTarget?: PendingTarget;
    pendingChoices?: PendingChoice[];
    /** CR 603.3b / ADR 0058 — the off-stack simultaneous-trigger batch (slimmed
     *  stack items), non-empty only while a `trigger-order` choice is active. The
     *  ordering picker maps each candidate id to its ability oracle text through
     *  this list (`triggeredAbilityId` / `grantedTriggeredAbilities`). */
    pendingTriggerBatch?: StackItem[];
    autoPassPlayers?: string[];
    queuedEndTurn?: string[];
    combat?: Combat;
    /** Melee (#669) — the attacking (active) player declares blocks this
     *  combat. Flows from the projected GameState so block-declaration UI flips
     *  to the right seat. */
    meleeCombat?: boolean;
    /** Player ids under Abeyance's turn-scoped "can't activate abilities that
     *  aren't mana abilities" lock (CR 602.1 / 605.1a, issue #1124). Forwarded
     *  from the wire `GameState.cannotActivateAbilitiesThisTurn` to
     *  `buildTriggerStateView` call sites so `getStackAbilities` can hide the
     *  affected controller's non-mana abilities as a UI hint. */
    cannotActivateAbilitiesThisTurn?: string[];
    gameOver?: GameOver;
    allPlayers: Player[];
    /** CR 114 (issue #1221) — command-zone emblems, forwarded from the wire
     *  `GameState.emblems`. Owner-scoped continuous statics (an emblem anthem)
     *  are threaded into `effectivePower`/`effectiveToughness` so the buff shows
     *  client-side; without this the P/T reducer recomputes without the emblem
     *  and the buff is invisible. */
    emblems?: EmblemInstance[];
    /** CR 702.26 — permanents currently phased out (host + attachments),
     *  flattened across all bundles. Each card keeps its `controllerId` so the
     *  battlefield renders it dimmed/inert on the controller's side rather than
     *  letting it vanish. Empty/absent when nothing is phased. */
    phasedOutCards?: CardInstance[];
    showAllCards: boolean;
    debugAllActions: boolean;
    /** Re-point the client session to another game in-place (state swap, no
     *  full-page reload). Used by the sideboarding flow to enter G2/G3 without
     *  a `window.location.reload()` — a reload re-requests `/game` from the
     *  host, which 404s on static hosts lacking an SPA fallback. */
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
};

export const GameContext = createContext<GameContext | null>(null);

export function useGameContext(): GameContext {
    const ctx = useContext(GameContext);
    if (!ctx)
        throw new Error(
            "useGameContext must be used within GameContext.Provider"
        );
    return ctx;
}
