// Madness (CR 702.35) — a keyword-cast capability that lets a card be cast for
// an alternative "madness cost" out of exile in the window opened by a reflexive
// triggered ability that goes on the stack when the card is discarded, or else
// be put into its owner's graveyard.
//
// 702.35a Madness is a keyword that represents two abilities. The first is a
//         static ability that functions while the card with madness is in a
//         player's hand. The second is a triggered ability that functions when
//         the first ability is applied. "Madness [cost]" means "If a player
//         would discard this card, that player discards it, but exiles it
//         instead of putting it into their graveyard" and "When this card is
//         exiled this way, its owner may cast it by paying [cost] rather than
//         paying its mana cost. If that player doesn't, they put this card into
//         their graveyard."
// 702.35b Casting a spell using its madness ability follows the rules for
//         paying alternative costs in rules 601.2b and 601.2f–h.
//
// Like Flashback (`convex/gre/flashback.ts`) and Escape, Madness is engine /
// cost-system infrastructure, NOT an Effect Script Op — a card's on-resolution
// effect stays DSL/`resolve()`; only the discard→exile replacement, the
// reflexive cast-trigger, and the alternative CAST cost live here. The printed
// madness cost is `CardDefinition.madness`; the exiled instance is tagged
// `madnessExiled` (which distinguishes it from an Ice-Cauldron-style exile cast
// that pays the normal cost) and carries the shared `castableFromExileBy` cast
// permission — but ONLY while the reflexive trigger's cast window is open.
//
// Timing model (CR 702.35a, faithful — replaces the earlier impulse-window
// deviation, #1198):
//   1. The discard→exile replacement tags the card `madnessExiled` and
//      `madnessTriggerPending` (`markMadnessExiled`). The card is NOT yet
//      castable (no `castableFromExileBy`).
//   2. `collectTriggers` turns each pending tag into a reflexive triggered
//      ability StackItem (`buildMadnessReflexiveTrigger`, triggers.ts) off the
//      CARD_DISCARDED event, so it rides the normal APNAP stack placement and
//      both players may respond to it.
//   3. When that trigger RESOLVES (`resolveTopOfStack`), `openMadnessCastWindow`
//      sets `castableFromExileBy` on the exiled card and raises a BLOCKING
//      `madness-cast` pending choice (Cast / Decline) on the owner. Because a
//      pending choice freezes priority, the owner can NEVER lose the cast by
//      accidentally passing priority — the decision is explicit.
//   4. Accept ("Cast"): the client fires the ordinary `announceCast` on the
//      exiled card; `consumeMadnessCastChoice` pops the choice so the normal cast
//      flow (targets / mana) runs, and the card is cast for its madness cost.
//      Decline: `submitMadnessDecline` → `declineMadness` puts the card into its
//      owner's graveyard IMMEDIATELY (the "if the player doesn't cast the card
//      this way" clause). The bot's minimal policy always declines (brain.ts).
//
// During the CR 514.1 cleanup hand-size discard this engine grants no priority
// by default; `finalizeCleanupDiscard` implements the CR 514.3 exception (a
// triggered ability created during cleanup gives the active player priority,
// then a new cleanup step begins) so the iconic "discard the extra Rootwalla to
// hand size, cast it for {0}" line resolves during the discarding player's own
// end step, exactly per CR.
import type { ManaCost } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getPlayer, moveCard } from "./state";

/** The printed madness cost for `card` (CR 702.35a), or `undefined` when the
 *  card has no madness. `Madness {0}` is a real, present cost of `{}` (empty) —
 *  distinct from `undefined` (no madness at all). */
export function getMadnessCost(card: CardInstanceState): ManaCost | undefined {
    const id = (card.card as { id?: string }).id;
    if (!id) return undefined;
    return tryGetDefinition(id)?.madness;
}

/** Whether `card` has a madness cost of any shape (including `Madness {0}`). */
export function hasMadness(card: CardInstanceState): boolean {
    return getMadnessCost(card) !== undefined;
}

/** CR 702.35c — mark a card that just moved hand → exile as discarded via
 *  madness. It is exiled and awaits its reflexive cast-trigger (702.35a), which
 *  `collectTriggers` builds from the `madnessTriggerPending` tag off the
 *  CARD_DISCARDED event. The card is NOT castable yet: `castableFromExileBy` is
 *  only set once that trigger resolves (`openMadnessCastWindow`). Called by
 *  `discardToGraveyard` after it redirects the discard's destination to exile. */
export function markMadnessExiled(card: CardInstanceState): void {
    card.madnessExiled = true;
    card.madnessTriggerPending = true;
}

/** CR 702.35a — the reflexive trigger has resolved: open the owner's single
 *  cast window as a blocking `madness-cast` pending choice. Sets the shared
 *  cast-from-exile permission on the card, records the open window, raises the
 *  Cast/Decline prompt, and hands priority to the owner. Because the choice
 *  blocks priority, the owner can never lose the cast by passing priority — they
 *  either cast the card (`announceCast` consumes the choice) or decline it
 *  (`submitMadnessDecline` → graveyard). */
export function openMadnessCastWindow(
    state: GameState,
    card: CardInstanceState,
    ownerId: string
): void {
    card.castableFromExileBy = ownerId;
    delete card.madnessTriggerPending;
    state.madnessCastWindow = { cardId: card.id, ownerId };
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    state.pendingChoices = [
        ...(state.pendingChoices ?? []),
        {
            stackItemId: "", // stackless — the reflexive trigger already resolved
            step: 0,
            choiceId: `madness-cast-${card.id}`,
            playerId: ownerId,
            kind: "madness-cast",
            cardInstanceId: card.id,
            subjectCardId: cardId,
            cost: getMadnessCost(card) ?? {},
            count: 1,
            prompt: def?.name
                ? `Cast ${def.name} for its madness cost, or put it into your graveyard?`
                : "Cast this card for its madness cost, or put it into your graveyard?",
        },
    ];
    state.priorityPlayerId = ownerId;
}

/** CR 702.35a accept — the owner cast the exiled card through the ordinary
 *  `announceCast` path: consume the head `madness-cast` choice (if it is this
 *  card's, for this player) so the normal cast flow proceeds. A no-op when the
 *  head is a different choice / card / player. */
export function consumeMadnessCastChoice(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (
        head?.kind === "madness-cast" &&
        head.playerId === playerId &&
        head.cardInstanceId === cardInstanceId
    ) {
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
        state.madnessCastWindow = undefined;
    }
}

/** True iff `card` is an exiled madness card whose cast window is currently
 *  open for `playerId` (CR 702.35a). Drives the "cast" legal action for the
 *  exile — only during the reflexive trigger's window, never before or after. */
export function isMadnessCastable(
    card: CardInstanceState,
    playerId: string
): boolean {
    return card.madnessExiled === true && card.castableFromExileBy === playerId;
}

/** The still-exiled madness card of the currently-open cast window, or
 *  undefined if the window is closed or its card has already left exile (it was
 *  cast). Used by the priority-pass sites to validate the window before
 *  suspending on it or declining it. */
export function openMadnessWindowCard(
    state: GameState
): { card: CardInstanceState; ownerId: string } | undefined {
    const win = state.madnessCastWindow;
    if (!win) return undefined;
    const owner = getPlayer(state, win.ownerId);
    const card = owner.exile.find(
        (c) => c.id === win.cardId && c.castableFromExileBy === win.ownerId
    );
    if (!card) return undefined;
    return { card, ownerId: win.ownerId };
}

/** CR 702.35a decline — the owner chose NOT to cast the card in its window:
 *  pop the `madness-cast` choice and put the card into its owner's graveyard
 *  IMMEDIATELY ("if the player doesn't cast the card this way, they put it into
 *  their graveyard"). A no-op (choice + window just cleared) if the card already
 *  left exile because it was cast. Returns true iff a card was actually binned. */
export function declineMadness(state: GameState): boolean {
    const open = openMadnessWindowCard(state);
    // Pop the head madness-cast choice, if present (the decline mutation
    // validates it is the head before calling here).
    const queue = state.pendingChoices ?? [];
    if (queue[0]?.kind === "madness-cast") {
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }
    state.madnessCastWindow = undefined;
    if (!open) return false;
    clearMadnessMarkers(open.card);
    moveCard(
        getPlayer(state, open.ownerId),
        open.card.id,
        "exile",
        "graveyard"
    );
    return true;
}

/** Clears the madness + cast-from-exile markers off `card` (on cast to the
 *  stack, or when binned on decline). */
export function clearMadnessMarkers(card: CardInstanceState): void {
    delete card.madnessExiled;
    delete card.madnessTriggerPending;
    delete card.castableFromExileBy;
    delete card.castableFromExileUntilTurn;
}

// Re-exported for callers that only need the player type in a madness context.
export type { PlayerState };
