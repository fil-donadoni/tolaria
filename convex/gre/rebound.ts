// Rebound (CR 702.88) — a keyword that lets a spell cast from hand return for
// a second, free cast from exile at its caster's next upkeep instead of going
// to the graveyard as it resolves.
//
// 702.88a Rebound appears on some instants and sorceries. It represents a
//         static ability that functions while the spell is on the stack and may
//         create a delayed triggered ability. "Rebound" means "If this spell
//         was cast from your hand, instead of putting it into your graveyard as
//         it resolves, exile it and, at the beginning of your next upkeep, you
//         may cast this card from exile without paying its mana cost."
// 702.88b Casting a spell as an effect of its rebound ability follows the rules
//         for paying alternative costs in rules 601.2b and 601.2f–h.
//
// Two consequences the rule text does not spell out separately, both read off
// 702.88a's "was cast from your hand" clause:
//   • DECLINE leaves the card exiled forever — nothing moves it, so no zone
//     change (contrast Madness, which bins the card).
//   • The exile recast pays no mana cost and is NOT itself "cast from
//     your hand" — it never rebounds again, and resolves to the
//     graveyard exactly like an ordinary spell. Both follow from the
//     SAME gate: only a hand-cast spell gets exiled+rescheduled
//     (`finalizeSpellResolution`, state.ts), gated on the stack item's
//     `reboundFromHand` flag, which is stamped ONLY at a from-hand cast
//     commit (`reboundCastStackFlags`, game.ts) — AND consumed
//     (`delete`d) the instant it redirects the resolution, since the
//     SAME CardInstanceState object is what the exile recast later
//     re-pushes onto the stack; leaving a stale `true` on it would
//     silently re-trigger the redirect and rebound forever.
//
// Rebound is engine / cost-system infrastructure, like Flashback
// (`convex/gre/flashback.ts`) and Madness (`convex/gre/madness.ts`) — NOT an
// Effect Script Op: a card's on-resolution effect stays DSL/`resolve()`; only
// the resolution-time exile redirect, the next-upkeep delayed-trigger
// scheduling, and the alternative Cast/Decline pending-choice window live
// here.
//
// Timing model (mirrors Madness's reflexive-trigger shape, CR 702.35a, but
// scheduled via the DELAYED TRIGGER infra instead of an immediate
// event-driven collection — "next upkeep" may be turns away):
//   1. `finalizeSpellResolution` (state.ts) redirects a resolving hand-cast
//      rebound spell to exile (`markReboundExiled`) instead of the
//      graveyard, and schedules a caster-scoped `next-upkeep` delayed
//      trigger carrying the exiled card's instance id
//      (`DelayedTriggerInstance.reboundCardInstanceId`).
//   2. `fireDelayedTriggers` (phases.ts) branches on that marker: instead of
//      running an Effect Script (casting a spell is not an Op), it builds a
//      reflexive Cast/Decline StackItem (`buildReboundReflexiveTrigger`,
//      triggers.ts — mirrors `buildMadnessReflexiveTrigger`) and pushes it
//      onto the stack, so multiple rebound triggers firing at the same
//      upkeep get APNAP ordering for free from the delayed-trigger batch.
//   3. When that trigger RESOLVES (`resolveTopOfStackInner`),
//      `openReboundCastWindow` sets `castableFromExileBy` +
//      `castFromExileWithoutPayingManaCost` on the exiled card and raises a
//      BLOCKING `rebound-cast` pending choice (Cast / Decline) on the
//      caster — the same Madness Model A plumbing.
//   4. Accept ("Cast"): the client fires the ordinary `announceCast` on the
//      exiled card; `consumeReboundCastChoice` pops the choice so the normal
//      cast flow (targets / free mana) runs — `castRawManaCost`'s existing
//      `castFromExileWithoutPayingManaCost` waiver (game.ts) already reads
//      this exact stamp, so no new cost-resolution branch is needed.
//      Decline: `submitReboundDecline` → `declineRebound` leaves the card in
//      exile (CR 702.88c).
import { tryGetDefinition } from "../cards";
import type { CardInstanceState, GameState } from "./state";
import { getPlayer } from "./state";

/** CR 702.88 — true iff `card`'s definition declares the `rebound` keyword. */
export function hasRebound(card: CardInstanceState): boolean {
    const id = (card.card as { id?: string }).id;
    if (!id) return false;
    return tryGetDefinition(id)?.staticAbilities?.includes("rebound") ?? false;
}

/** CR 702.88a — mark a spell resolving from hand with rebound as exiled
 *  instead of graveyarded. Called by `finalizeSpellResolution` (state.ts)
 *  BEFORE the card is pushed onto its owner's exile zone. */
export function markReboundExiled(card: CardInstanceState): void {
    card.reboundExiled = true;
}

/** CR 702.88a — the reflexive Cast/Decline trigger has resolved: open the
 *  caster's single window as a blocking `rebound-cast` pending choice. Sets
 *  the shared cast-from-exile-for-free permission (`castableFromExileBy` +
 *  `castFromExileWithoutPayingManaCost`) on the card, records the open
 *  window, raises the prompt, and hands priority to the caster. Mirrors
 *  `openMadnessCastWindow` (madness.ts). */
export function openReboundCastWindow(
    state: GameState,
    card: CardInstanceState,
    ownerId: string
): void {
    card.castableFromExileBy = ownerId;
    card.castFromExileWithoutPayingManaCost = true;
    state.reboundCastWindow = { cardId: card.id, ownerId };
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    state.pendingChoices = [
        ...(state.pendingChoices ?? []),
        {
            stackItemId: "", // stackless — the reflexive trigger already resolved
            step: 0,
            choiceId: `rebound-cast-${card.id}`,
            playerId: ownerId,
            kind: "rebound-cast",
            cardInstanceId: card.id,
            subjectCardId: cardId,
            count: 1,
            prompt: def?.name
                ? `Cast ${def.name} again from exile without paying its mana cost, or leave it exiled?`
                : "Cast this card again from exile without paying its mana cost, or leave it exiled?",
        },
    ];
    state.priorityPlayerId = ownerId;
}

/** CR 702.88a accept — the caster cast the exiled card through the ordinary
 *  `announceCast` path: consume the head `rebound-cast` choice (if it is this
 *  card's, for this player) so the normal cast flow proceeds. A no-op when
 *  the head is a different choice / card / player. */
export function consumeReboundCastChoice(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (
        head?.kind === "rebound-cast" &&
        head.playerId === playerId &&
        head.cardInstanceId === cardInstanceId
    ) {
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
        state.reboundCastWindow = undefined;
    }
}

/** The still-exiled rebound card of the currently-open cast window, or
 *  undefined if the window is closed or its card has already left exile (it
 *  was cast). Used by the decline path to validate the window before
 *  resolving it. */
export function openReboundWindowCard(
    state: GameState
): { card: CardInstanceState; ownerId: string } | undefined {
    const win = state.reboundCastWindow;
    if (!win) return undefined;
    const owner = getPlayer(state, win.ownerId);
    const card = owner.exile.find(
        (c) => c.id === win.cardId && c.castableFromExileBy === win.ownerId
    );
    if (!card) return undefined;
    return { card, ownerId: win.ownerId };
}

/** CR 702.88c decline — the caster chose NOT to cast the card in its window:
 *  pop the `rebound-cast` choice. The card "remains exiled" — NO zone change,
 *  unlike Madness's decline (which bins to the graveyard). A no-op (choice +
 *  window just cleared) if the card already left exile because it was cast.
 *  Returns true iff a window was actually open. */
export function declineRebound(state: GameState): boolean {
    const open = openReboundWindowCard(state);
    const queue = state.pendingChoices ?? [];
    if (queue[0]?.kind === "rebound-cast") {
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }
    state.reboundCastWindow = undefined;
    if (!open) return false;
    clearReboundMarkers(open.card);
    return true;
}

/** Clears the rebound + cast-from-exile markers off `card` (on decline, the
 *  card stays exiled but is no longer castable). */
export function clearReboundMarkers(card: CardInstanceState): void {
    delete card.reboundExiled;
    delete card.castableFromExileBy;
    delete card.castFromExileWithoutPayingManaCost;
}
