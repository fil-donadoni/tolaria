import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { orderLibrarySearchCards } from "~/lib/library-search-order";
import CardsPile from "./cards-pile";
import LibrarySearchConfirm from "./library-search-confirm";

/** Modal picker for a mid-resolution hand-zone choice (CR 608.2) whose
 *  picked-from hand belongs to ANOTHER player — Thoughtseize / Duress / Hymn
 *  to Tourach "target player reveals their hand. You choose a … card from
 *  it" (`choose-hand-card`, Seer's Vision), and "look at target player's hand
 *  and choose N cards from it. That player discards those cards."
 *  (`discard-hand`, Mind Warp / Leshrac's Sigil — the CASTER, not the hand's
 *  owner, is the chooser). Routes on "chooser ≠ zone owner", NOT `kind`
 *  (issue #1698 / #1719 review finding 1 — gating on
 *  `kind === "choose-hand-card"` alone missed the identical `discard-hand`
 *  shape and left Mind Warp/Leshrac's Sigil hanging with no reachable UI).
 *  `reveal-hand` is excluded — it owns its own dedicated modal
 *  (`RevealHandView`). `projectPublicState` exposes the zone owner's hand
 *  face-up to THIS chooser for as long as the choice is head-of-queue (issue
 *  #1698, `handPickZoneOwner` in `convex/gameProjections.ts`) — independent
 *  of any card-specific `reveal` op or continuous "hand revealed" static, so
 *  those cards cross the wire face-up here even when neither happens to be
 *  active at this exact moment (e.g. the source already sacrificed to pay its
 *  own ability's cost). A card's own `reveal` op (Thoughtseize/Duress)
 *  additionally makes the reveal PUBLIC and persistent — unaffected, still
 *  their job.
 *
 *  Reuses the SAME picker surface, display and highlight as the `search-library`
 *  fetch (a `CardsPile` grid + `LibrarySearchConfirm` Done, driven by the shared
 *  `usePendingChoiceBuffer`): the opponent's tiny top-of-board hand is never made
 *  clickable — the chooser picks from this dialog instead.
 *
 *  Own-hand picks (discard from your OWN hand, put-back-on-top) keep the
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
        head.kind !== "reveal-hand" &&
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

    // Eligible cards first (then type line, then name) — the SAME ordering the
    // filtered library search uses. The ring alone left the chooser scanning a
    // seven-card grid for the two legal picks (Inquisition of Kozilek's
    // "nonland card with mana value 3 or less"); front-loading them makes the
    // legal set readable at a glance. A hand has no game-significant order, so
    // reordering it costs nothing.
    const orderedCards = orderLibrarySearchCards(cards, eligibleIds);

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
            cards={orderedCards}
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
