import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { extractMutationErrorMessage } from "~/lib/mutation-error";

/** CR 113.6 / 702.29a — activation affordance for an activated ability whose
 *  source is a card in the viewer's OWN hand (Cycling's "{cost}, Discard this
 *  card: Draw a card"). Rendered over such a hand card when
 *  {@link getHandStackAbilities} judged the ability currently legal. Dispatches
 *  the SAME `activateAbility` mutation the battlefield / graveyard paths use —
 *  the server locates the source in its owner's hand via the `activateFromHand`
 *  seam (#689), discards it as part of the cost, and opens the
 *  `pendingActivation` mana-payment phase for the cycling cost; the global
 *  payment overlay finishes the tap. One button per eligible ability (a Cycling
 *  card has exactly one). Disabled while its own dispatch is in-flight so a
 *  double-click can't fire two activations. */
export default function HandActivateButton({
    cardInstanceId,
    abilities,
}: {
    cardInstanceId: string;
    abilities: { id: string; oracleText: string }[];
}) {
    const { gameId, playerId } = useGameContext();
    const activateAbility = useMutation(api.game.activateAbility);
    const [pending, setPending] = useState(false);

    if (abilities.length === 0) return null;

    return (
        <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-px">
            {abilities.map((a) => (
                <button
                    key={a.id}
                    type="button"
                    disabled={pending}
                    title={a.oracleText}
                    onClick={(e) => {
                        // The cycle button sits on the hand card; stop the click
                        // from also triggering the card's cast/play commit.
                        e.stopPropagation();
                        setPending(true);
                        activateAbility({
                            gameId,
                            playerId,
                            cardInstanceId,
                            abilityId: a.id,
                        })
                            .catch((err) => {
                                // Shown only when `getHandStackAbilities` judged
                                // the activation legal, so a rejection is an
                                // unexpected race (server is authoritative); log
                                // rather than crash.
                                console.error(extractMutationErrorMessage(err));
                            })
                            .finally(() => setPending(false));
                    }}
                    className="rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:opacity-50"
                >
                    Cycle
                </button>
            ))}
        </div>
    );
}
