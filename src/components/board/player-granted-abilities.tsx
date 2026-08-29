import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Player, GrantedAbility } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { formatOracleText } from "~/lib/oracle-text";

/** Whether the viewer may activate `grant` right now, mirroring the gates
 *  `activatePlayerAbility` (convex/game.ts) enforces server-side.
 *
 *  CR 605.3a — "A player may activate an activated mana ability whenever they
 *  have priority, whenever they are casting a spell or activating an ability
 *  that requires a mana payment...". So a `useStack: false` grant (Channel's
 *  "Pay 1 life: Add {C}") is legal mid-payment as well as at priority; a
 *  stack-using grant needs priority AND a clear pendingCast/pendingActivation
 *  slot, exactly like the mutation's `else` branch.
 *
 *  `pendingChoice` blocks BOTH shapes: the mutation calls
 *  `assertNoPendingChoices(state)` with no `allowManaForMayPay` option — unlike
 *  its `tapUntap` / `tapForPayment` siblings, which pass one — so any queued
 *  resolution choice makes it throw, may-pay windows included. Without this the
 *  button would read enabled and the click would reject server-side, since
 *  `computeExpectedInput` (convex/gre/expectedInput.ts) hands the projected
 *  priority to the chooser while a choice is outstanding.
 *
 *  The client never has authority (ADR 0074): this only decides whether the
 *  button reads enabled, and the server re-validates every click. Two gates it
 *  deliberately does NOT mirror are `ability.activationPhaseRestriction` and
 *  mana-cost affordability — `PublicGrantedAbility` (convex/gameProjections.ts)
 *  carries neither on the wire, and widening the projection is out of scope for
 *  issue #2691. Channel, the only card in the catalogue that reaches
 *  `grantAbility`, has neither, so today the two sets coincide; a future
 *  player-scoped grant with a phase restriction or a mana cost would show an
 *  enabled button the server rejects — which `handleClick` swallows below. */
function canActivateGrant(
    grant: GrantedAbility,
    args: {
        playerId: string;
        priorityPlayerId?: string;
        pendingCastPlayerId?: string;
        pendingActivationPlayerId?: string;
        pendingChoice: boolean;
    }
): boolean {
    if (args.pendingChoice) return false;
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
 *  Add {C}." for the turn). Mounted by {@link BoardPlayer} in the viewer seat's
 *  above-plate stack, directly under the mana pool — the ability feeds the
 *  pool, so they read together.
 *
 *  Issue #2691: this component existed but had ZERO render sites. Its previous
 *  mount, `PlayerSideRow`, was deleted in `d2b1d2fe0` during the board rewrite
 *  and it was never re-mounted, so every player-level grant — the whole class,
 *  not just Channel — was unreachable until it silently expired at cleanup.
 *  The old `absolute left-full` positioning belonged to that deleted side row
 *  and is gone with it; `BoardPlayer` now owns the placement (see the comment
 *  at its mount for why that stack is zero-height).
 *
 *  Each control is ONE line, `max-w-full truncate`, so it can never exceed the
 *  seat's own width — which at landscape-compact is the ~48px
 *  `LANDSCAPE_SIDE_GUTTER` rail, the one place seat chrome is guaranteed not to
 *  overlap a card. Wrapping instead would grow the stack by a line per word;
 *  the full oracle text stays reachable as the button's `title`.
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
        pendingChoices,
    } = useGameContext();
    const activate = useMutation(api.game.activatePlayerAbility);
    const [busy, setBusy] = useState(false);

    const grants = player.grantedAbilities;
    const isMe = player.id === playerId;
    if (!isMe || !grants?.length) return null;

    const timing = {
        playerId,
        priorityPlayerId,
        pendingCastPlayerId: pendingCast?.playerId,
        pendingActivationPlayerId: pendingActivation?.playerId,
        pendingChoice: (pendingChoices?.length ?? 0) > 0,
    };

    const affordable = (grant: GrantedAbility) =>
        grant.cost.life === undefined || player.life >= grant.cost.life;

    const handleClick = async (grant: GrantedAbility) => {
        if (busy || !canActivateGrant(grant, timing) || !affordable(grant)) {
            return;
        }
        setBusy(true);
        try {
            await activate({
                gameId,
                playerId,
                grantedAbilityInstanceId: grant.id,
            });
        } catch {
            // Server-side guard rejected (priority shifted, the grant expired,
            // a choice queued up between render and click) — the next state
            // update re-derives the affordance.
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            data-testid="player-granted-abilities"
            className="flex w-full flex-col items-center gap-1"
        >
            {grants.map((grant) => {
                // Disabled, never hidden: the player should see that the
                // ability exists (and that it is unaffordable / mistimed)
                // rather than watch it vanish.
                const disabled =
                    busy ||
                    !canActivateGrant(grant, timing) ||
                    !affordable(grant);
                return (
                    <button
                        key={grant.id}
                        type="button"
                        data-granted-ability={grant.id}
                        onClick={() => void handleClick(grant)}
                        disabled={disabled}
                        title={grant.oracleText}
                        className={`pointer-events-auto max-w-full truncate text-xs text-display tracking-wide px-3 py-1.5 rounded-sm shadow-md transition-colors border ${
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
