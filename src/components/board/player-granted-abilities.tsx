import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Player, GrantedAbility } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { formatOracleText } from "~/lib/oracle-text";

/** Whether the viewer may activate `grant` right now, mirroring the SAME two
 *  gates `activatePlayerAbility` (convex/game.ts) enforces server-side.
 *
 *  CR 605.3a — "A player may activate an activated mana ability whenever they
 *  have priority, whenever they are casting a spell or activating an ability
 *  that requires a mana payment...". So a `useStack: false` grant (Channel's
 *  "Pay 1 life: Add {C}") is legal mid-payment as well as at priority; a
 *  stack-using grant needs priority AND a clear stack-item slot, exactly like
 *  the mutation's `else` branch. The client never has authority (ADR 0074) —
 *  this only decides whether the button reads enabled. */
function canActivateGrant(
    grant: GrantedAbility,
    args: {
        playerId: string;
        priorityPlayerId?: string;
        pendingCastPlayerId?: string;
        pendingActivationPlayerId?: string;
    }
): boolean {
    const hasPriority = args.priorityPlayerId === args.playerId;
    if (grant.useStack) {
        return (
            hasPriority &&
            args.pendingCastPlayerId === undefined &&
            args.pendingActivationPlayerId === undefined
        );
    }
    return (
        hasPriority ||
        args.pendingCastPlayerId === args.playerId ||
        args.pendingActivationPlayerId === args.playerId
    );
}

/** Activation controls for abilities granted to a PLAYER rather than to a
 *  permanent (`PlayerState.grantedAbilities`, e.g. Channel's "Pay 1 life:
 *  Add {C}." for the turn). Mounted by {@link BoardPlayer} inside the seat's
 *  own chrome wrapper, next to {@link PlayerManaPool} — the ability feeds the
 *  pool, so they read together.
 *
 *  Issue #2691: this component existed but had ZERO render sites. Its previous
 *  mount, `PlayerSideRow`, was deleted in `d2b1d2fe0` during the board rewrite
 *  and it was never re-mounted, so every player-level grant — the whole class,
 *  not just Channel — was unreachable until it silently expired at cleanup.
 *  The old `absolute left-full` positioning belonged to that deleted side row
 *  and is gone with it: the controls now sit in NORMAL FLOW above the
 *  nameplate, inheriting the wrapper's `play-area-center-x -translate-x-1/2`
 *  centering, so they cannot run off the edge at phone-portrait widths the way
 *  a `left-full` box does.
 *
 *  Renders nothing for the opponent's grants: a grant is public information
 *  (the projection hydrates it for both viewers) but only its holder may
 *  activate it, and a permanently-disabled opponent button is noise. */
export default function PlayerGrantedAbilities({ player }: { player: Player }) {
    const {
        gameId,
        playerId,
        priorityPlayerId,
        pendingCast,
        pendingActivation,
    } = useGameContext();
    const activate = useMutation(api.game.activatePlayerAbility);

    const grants = player.grantedAbilities;
    const isMe = player.id === playerId;
    if (!isMe || !grants?.length) return null;

    const timing = {
        playerId,
        priorityPlayerId,
        pendingCastPlayerId: pendingCast?.playerId,
        pendingActivationPlayerId: pendingActivation?.playerId,
    };

    const affordable = (grant: GrantedAbility) =>
        grant.cost.life === undefined || player.life >= grant.cost.life;

    const handleClick = (grant: GrantedAbility) => {
        if (!canActivateGrant(grant, timing) || !affordable(grant)) return;
        activate({
            gameId,
            playerId,
            grantedAbilityInstanceId: grant.id,
        });
    };

    return (
        <div
            data-testid="player-granted-abilities"
            className="mb-1 flex flex-col items-center gap-1"
        >
            {grants.map((grant) => {
                // Disabled, never hidden: the player should see that the
                // ability exists (and that it is unaffordable / mistimed)
                // rather than watch it vanish.
                const disabled =
                    !canActivateGrant(grant, timing) || !affordable(grant);
                return (
                    <button
                        key={grant.id}
                        data-granted-ability={grant.id}
                        onClick={() => handleClick(grant)}
                        disabled={disabled}
                        title={grant.oracleText}
                        className={`max-w-[min(18rem,70vw)] text-xs text-display tracking-wide px-3 py-1.5 rounded-sm shadow-md transition-colors border ${
                            disabled
                                ? "bg-surface-elevated border-border-subtle text-text-disabled cursor-not-allowed"
                                : "bg-accent-soft/30 border-accent/45 text-accent-strong hover:bg-accent-soft/50 cursor-pointer"
                        }`}
                    >
                        {formatOracleText(grant.oracleText)}
                    </button>
                );
            })}
        </div>
    );
}
