import type { Player } from "~/types/game";
import { useBattlefieldInteraction } from "~/hooks/useBattlefieldInteraction";
import { rowLayout, type Placement } from "~/lib/board-layout";
import SpatialZone, { type SpatialItem } from "./spatial-zone";
import BoardNextBattlefieldCard from "./board-next-battlefield-card";

/** Battlefield row: full size + gap until overflow, then overlap, then scale.
 *  Vertically centered in its zone (`rowLayout`, #251). */
function battlefieldLayout(
    count: number,
    width: number,
    height: number
): Placement[] {
    return rowLayout({ count, width, centerY: height / 2 });
}

type BoardNextBattlefieldProps = {
    player: Player;
    /** Mirror the opponent's side to the top half. */
    mirror?: boolean;
    "data-testid"?: string;
};

/** One player's battlefield on the spatial board (PRD #249, slice #256).
 *
 *  Owns the per-player board-coupled visual-state AND interaction computation:
 *  it calls the shared {@link useBattlefieldInteraction} hook ONCE (which itself
 *  composes {@link useBattlefieldVisualState}, #256) and hands each permanent
 *  its {@link CardVisualState} (combat rings, tap, marked damage, legal-target
 *  highlight) plus its click handler to {@link BoardNextBattlefieldCard}. The
 *  click handler dispatches the SAME mutations as the classic board for tap /
 *  in-payment tap / mana-choice pick (#272); the hook's `overlays` node (the
 *  mana-choice picker + validation toast) is mounted here so the spatial board
 *  surfaces them. Isolating the hook in this component (rather than inside
 *  `board-next.tsx`'s item builder) keeps the rules-of-hooks contract clean —
 *  the hook runs unconditionally per mounted battlefield. The cards are
 *  positioned by the shared layout math via {@link SpatialZone}. */
export default function BoardNextBattlefield({
    player,
    mirror,
    "data-testid": testId,
}: BoardNextBattlefieldProps) {
    const {
        getVisualState,
        handleClickWithEvent,
        getActivatable,
        handleActivateAbility,
        overlays,
    } = useBattlefieldInteraction(player);

    const items: SpatialItem[] = player.battlefield.map((card) => ({
        key: card.id,
        node: (
            <BoardNextBattlefieldCard
                card={card}
                vs={getVisualState(card)}
                onClick={(e) => handleClickWithEvent(card, e)}
                activatableAbilities={getActivatable(card)}
                onActivateAbility={(abilityId, keepPriority) =>
                    handleActivateAbility(card.id, abilityId, keepPriority)
                }
            />
        ),
    }));

    return (
        <>
            <SpatialZone
                items={items}
                layout={battlefieldLayout}
                mirror={mirror}
                anchorKind="permanent"
                data-testid={testId}
            />
            {overlays}
        </>
    );
}
