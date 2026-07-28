import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import CardsPile from "./cards-pile";
import LibrarySearchConfirm from "./library-search-confirm";

/** Modal picker for a mid-resolution `choose-hand-card` choice (CR 608.2)
 *  whose picked-from hand belongs to ANOTHER player — Thoughtseize / Duress /
 *  Hymn to Tourach "target player reveals their hand. You choose a … card from
 *  it," and "look at target player's hand and choose a card from it" (Seer's
 *  Vision). `projectPublicState` exposes the zone owner's hand face-up to
 *  THIS chooser for as long as the choice is head-of-queue (issue #1698,
 *  `handPickZoneOwner` in `convex/gameProjections.ts`) — independent of any
 *  card-specific `reveal` op or continuous "hand revealed" static, so those
 *  cards cross the wire face-up here even when neither happens to be active
 *  at this exact moment (e.g. the source already sacrificed to pay its own
 *  ability's cost). A card's own `reveal` op (Thoughtseize/Duress) additionally
 *  makes the reveal PUBLIC and persistent — unaffected, still their job.
 *
 *  Reuses the SAME picker surface, display and highlight as the `search-library`
 *  fetch (a `CardsPile` grid + `LibrarySearchConfirm` Done, driven by the shared
 *  `usePendingChoiceBuffer`): the opponent's tiny top-of-board hand is never made
 *  clickable — the chooser picks from this dialog instead.
 *
 *  Own-hand `choose-hand-card` picks (discard from your OWN hand) keep the
 *  in-hand toggle (`BoardHandCard`); this dialog gates on `zoneOwnerId` differing
 *  from the viewer, so it only opens for someone else's hand. */
export default function HandCardPick() {
    const { playerId, allPlayers, pendingChoices } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    const { isMinimized, minimize } = useMinimizedChoice();

    const head = pendingChoices?.[0];
    const zoneOwnerId = head?.zoneOwnerId;
    const active =
        !!head &&
        head.kind === "choose-hand-card" &&
        head.zone === "hand" &&
        head.playerId === playerId &&
        !!zoneOwnerId &&
        zoneOwnerId !== playerId;

    if (!active) return null;

    const owner = allPlayers.find((p) => p.id === zoneOwnerId);
    // Opponent hand: revealed (known) slots carry identity, unknown slots are
    // null — filter to the revealed cards. Thoughtseize reveals the whole hand,
    // so every slot is known here.
    const cards = (owner?.hand ?? []).filter(
        (c): c is CardInstance => c !== null
    );

    // `candidateIds` is the eligibility allow-list (Thoughtseize: nonland only).
    // Lands render dimmed + inert; nonlands are pickable — mirrors the filtered
    // `search-library` fetch (issue #933).
    const eligibleIds = head.candidateIds
        ? new Set(head.candidateIds)
        : undefined;

    const count = head.count;
    const min = typeof count === "number" ? count : count.min;
    const max = typeof count === "number" ? count : count.max;

    // Same clamp as the library search picker: a click on an ineligible card is
    // a no-op; at the cap a fresh pick replaces the oldest (count=1 case) and a
    // click on an already-picked card always deselects it.
    const onCardClick = (card: { id: string }) => {
        if (eligibleIds && !eligibleIds.has(card.id)) return;
        if (bufferCtx.buffer.includes(card.id)) {
            bufferCtx.toggle(card.id);
            return;
        }
        if (bufferCtx.buffer.length >= max) {
            if (max === 1) {
                bufferCtx.clear();
                bufferCtx.toggle(card.id);
            }
            return;
        }
        bufferCtx.toggle(card.id);
    };

    return (
        <CardsPile
            cards={cards}
            isFaceDown={false}
            layout="grid"
            title={head.prompt ?? "Choose a card"}
            forceOpen={!isMinimized}
            onMinimize={minimize}
            selectedIds={bufferCtx.buffer}
            eligibleIds={eligibleIds}
            onCardClick={onCardClick}
            footer={<LibrarySearchConfirm min={min} max={max} />}
        />
    );
}
