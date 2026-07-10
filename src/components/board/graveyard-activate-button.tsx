import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { extractMutationErrorMessage } from "~/lib/mutation-error";

/** CR 113.6 / 602.5b — activation affordance for an activated ability whose
 *  source is a card in the viewer's OWN graveyard (Ashen Ghoul's "{B}: Return
 *  this card from your graveyard to the battlefield"). Rendered over such a card
 *  in the Graveyard reveal dialog when {@link getGraveyardStackAbilities} judged
 *  the ability currently legal (correct phase, your turn, the
 *  creatures-above-in-graveyard gate satisfied). Dispatches the SAME
 *  `activateAbility` mutation the battlefield path uses — the server locates the
 *  source in its owner's graveyard via the `activateFromGraveyard` seam (#737),
 *  opens the `pendingActivation` mana-payment phase for the {B}, and the global
 *  payment overlay finishes the tap. One button per eligible ability (Ashen
 *  Ghoul has exactly one). Calls `onCommitted` after dispatch so the host can
 *  close the reveal dialog. */
export default function GraveyardActivateButton({
    cardInstanceId,
    abilities,
    onCommitted,
}: {
    cardInstanceId: string;
    abilities: { id: string; oracleText: string }[];
    onCommitted?: () => void;
}) {
    const { gameId, playerId } = useGameContext();
    const activateAbility = useMutation(api.game.activateAbility);

    if (abilities.length === 0) return null;

    return (
        <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-px">
            {abilities.map((a) => (
                <button
                    key={a.id}
                    type="button"
                    title={a.oracleText}
                    onClick={() => {
                        activateAbility({
                            gameId,
                            playerId,
                            cardInstanceId,
                            abilityId: a.id,
                        }).catch((err) => {
                            // The button is only shown when
                            // `getGraveyardStackAbilities` judged the activation
                            // legal, so a rejection is an unexpected race
                            // (server is authoritative); log rather than crash.
                            console.error(extractMutationErrorMessage(err));
                        });
                        onCommitted?.();
                    }}
                    className="rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong"
                >
                    Activate
                </button>
            ))}
        </div>
    );
}
