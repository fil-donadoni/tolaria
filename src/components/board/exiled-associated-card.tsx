import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import CardImage from "../cards/card-image";
import ExileCastButton from "./exile-cast-button";

/** An exiled card pinned to the battlefield permanent it is associated with —
 *  the Arena / Banishing Light treatment. Mechanism-agnostic: the parent
 *  ({@link BoardBattlefieldCard}) mounts this for any exile card whose
 *  projected `exiledByPermanentId` points at the host, regardless of WHY it is
 *  linked (exile-and-return like Banishing Light / Tawnos's Coffin, noted-mana
 *  batteries like Ice Cauldron, future Dauthi-Voidwalker-style exilers). The
 *  exiled card reads as attached rather than floating loose in the Exile pile
 *  (it is de-duplicated from that pile in `player-exile.tsx`).
 *
 *  Cast-from-exile is an OPTIONAL affordance: when the viewing player may cast
 *  it (`castableFromExileBy`), the same {@link ExileCastButton} rides on the
 *  overlay (Ice Cauldron, Dauthi); exilers with no cast permission (Banishing
 *  Light) simply render the pinned card. Pointer events are stopped so
 *  interacting with the exiled card never taps the host underneath. Opponents
 *  see the face-down projection unchanged. */
export default function ExiledAssociatedCard({
    exiledCard,
}: {
    exiledCard: CardInstance;
}) {
    const { playerId } = useGameContext();
    const castable = exiledCard.castableFromExileBy === playerId;

    return (
        <div
            // Pinned up-and-left and tucked partly behind the host, matching the
            // aura-on-host treatment so the association reads at a glance.
            className="absolute -top-[26%] -left-[26%] w-[64%] h-[64%] z-20"
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={(e) => e.stopPropagation()}
            onPointerLeave={(e) => e.stopPropagation()}
        >
            <div className="relative w-full h-full rounded-sm overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.6)] ring-1 ring-accent/60">
                <CardImage card={exiledCard} />
                {castable ? <ExileCastButton card={exiledCard} /> : null}
            </div>
        </div>
    );
}
