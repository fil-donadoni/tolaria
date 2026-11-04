// Miracle (CR 702.94) — a static ability that functions while the card is in
// its owner's hand, linked to a triggered ability (CR 603.11).
//
// 702.94a Miracle is a static ability linked to a triggered ability. (See
//         rule 603.11.) "Miracle [cost]" means "You may reveal this card from
//         your hand as you draw it if it's the first card you've drawn this
//         turn. When you reveal this card this way, you may cast it by paying
//         [cost] rather than its mana cost."
// 702.94b If a player chooses to reveal a card using its miracle ability, they
//         play with that card revealed until that card leaves their hand, that
//         ability resolves, or that ability otherwise leaves the stack.
//
// This module owns only the three things Miracle adds (ADR 0088 — share the
// primitive, not the shape); every primitive below them is shared:
//
//   1. THE REVEAL WINDOW, raised at the draw itself. When a draw commits and
//      the card it put into hand is the drawing player's FIRST card this turn
//      (`PlayerState.drawnThisTurn`), and that card has a miracle cost, the
//      player is asked — before the drawing effect draws anything else —
//      whether to reveal it (`miracleRevealCandidate`). Never a CARD_DRAWN
//      trigger: that would resolve after the whole effect, so on "draw two
//      cards" the player would decide having already seen the second card,
//      and a stack object would exist before the reveal CR 603.11 keys it on.
//      Two shapes, one `miracle-reveal` kind: the DSL `draw` Op raises it
//      stack-coupled (`SpellContext.requestMiracleReveal`) and resumes at the
//      next card; the turn-based draw and the synchronous draw primitive raise
//      it STACKLESS (`offerStacklessMiracleReveal`). The choice is a PRIVATE
//      CHOICE (`privateToChooser`): it exists only when a miracle card was
//      drawn, so its presence on the opponent's screen would disclose that.
//   2. THE REVEAL itself (`revealForMiracle`): the card becomes known to every
//      player (`grantKnowledgeToAll` — CR 702.94b needs no state of its own:
//      knowledge in this engine is never revoked, so "until it leaves your
//      hand" is the physical half of a paper reveal) and the dedicated
//      MIRACLE_REVEALED event is emitted. Only this module emits it, so an
//      unrelated reveal effect can never fire the linked ability.
//   3. THE LINKED TRIGGERED ABILITY (`buildMiracleTrigger`), collected off that
//      event by `collectTriggers` and put on the stack through the normal path
//      (both players get priority; it can be responded to or countered). Its
//      body is the shared `castDuringResolution` Op casting the card from
//      HAND for its `alternativeCost` (the miracle cost, cost modifiers still
//      applied — CR 601.2f), cast during resolution and outside priority
//      (CR 608.2g), so a sorcery's own timing (CR 307.1) never applies: a
//      revealed sorcery is castable on an opponent's turn. Declining, or the
//      card having left the hand, leaves an ordinary card — the window does
//      not survive the resolution.
import type { EffectOp, ManaCost } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { printManaCost } from "../oracle/manaCost";
import type {
    CardInstanceState,
    GameState,
    PendingChoice,
    StackItem,
} from "./state";
import { grantKnowledgeToAll, planResolutionCastPayment } from "./state";
import { allocInstanceId, getPlayer } from "./lookup";
import { INLINE_DELAYED_TRIGGER_ID } from "./effects/interpreter";

/** The printed miracle cost of `card` (CR 702.94a), or `undefined` when the
 *  card has no miracle. */
export function getMiracleCost(card: CardInstanceState): ManaCost | undefined {
    const id = (card.card as { id?: string }).id;
    if (!id) return undefined;
    return tryGetDefinition(id)?.miracle;
}

/** CR 702.94a — the card a just-committed draw makes eligible for a miracle
 *  reveal, or `undefined`. `drawnBefore` is the length of the drawing
 *  player's `drawnThisTurn` BEFORE the draw committed: only a draw that
 *  started from zero can have drawn "the first card you've drawn this turn",
 *  and that card is `drawnThisTurn[0]`. It must still be in its owner's hand
 *  (a replacement may have sent the draw elsewhere) and have a miracle cost. */
export function miracleRevealCandidate(
    state: GameState,
    playerId: string,
    drawnBefore: number
): CardInstanceState | undefined {
    if (drawnBefore !== 0) return undefined;
    const player = getPlayer(state, playerId);
    const firstId = player.drawnThisTurn?.[0];
    if (firstId === undefined) return undefined;
    const card = player.hand.find((c) => c.id === firstId);
    if (!card || getMiracleCost(card) === undefined) return undefined;
    return card;
}

/** Whether `playerId` could pay `card`'s miracle cost right now — the same
 *  auto-tap plan (cost modifiers applied, CR 601.2f) the linked trigger's
 *  cast would pay through (`planResolutionCastPayment`). Read by the Bot's
 *  reveal policy: it reveals only a card it can then cast. */
export function canPayMiracleCost(
    state: GameState,
    playerId: string,
    card: CardInstanceState
): boolean {
    const cost = getMiracleCost(card);
    if (cost === undefined) return false;
    const payer = getPlayer(state, playerId);
    return (
        planResolutionCastPayment(state, payer, card, cost, undefined) !== null
    );
}

/** How many cards `playerId` has drawn this turn — the `drawnBefore` a draw
 *  site snapshots before committing, for {@link miracleRevealCandidate}. */
export function drawnThisTurnCount(state: GameState, playerId: string): number {
    return getPlayer(state, playerId).drawnThisTurn?.length ?? 0;
}

/** The reveal prompt. Private to its chooser, so it may name the card. */
export function miracleRevealPrompt(card: CardInstanceState): string {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    const cost = def?.miracle ? ` (miracle ${printManaCost(def.miracle)})` : "";
    return def?.name
        ? `Reveal ${def.name} for its miracle ability${cost}?`
        : "Reveal this card for its miracle ability?";
}

/** The `miracle-reveal` entry for `card`, without its stack coupling. The
 *  DSL `draw` Op's request fills `stackItemId`/`step`; the stackless sites
 *  leave `stackItemId: ""`. */
export function miracleRevealChoice(
    card: CardInstanceState,
    playerId: string,
    coupling: { stackItemId: string; step: number; choiceId: string }
): PendingChoice {
    return {
        ...coupling,
        playerId,
        kind: "miracle-reveal",
        cardInstanceId: card.id,
        // Private to the chooser (the entry never reaches the opponent), so
        // pinning the hand card discloses nothing.
        subjectCardId: (card.card as { id?: string }).id,
        count: 1,
        prompt: miracleRevealPrompt(card),
        privateToChooser: true,
    };
}

/** CR 702.94a — raise a STACKLESS reveal window for the card a just-committed
 *  draw put into `playerId`'s hand, when it qualifies. Used by the draw sites
 *  that cannot suspend a resolution: the turn-based draw step (CR 504.1) and
 *  the synchronous `SpellContext.drawCards` primitive. Hands priority to the
 *  drawing player, who must answer before anything else happens. Returns
 *  true when a window was raised. */
export function offerStacklessMiracleReveal(
    state: GameState,
    playerId: string,
    drawnBefore: number
): boolean {
    const card = miracleRevealCandidate(state, playerId, drawnBefore);
    if (!card) return false;
    state.pendingChoices = [
        ...(state.pendingChoices ?? []),
        miracleRevealChoice(card, playerId, {
            stackItemId: "",
            step: 0,
            choiceId: `miracle-reveal-${card.id}`,
        }),
    ];
    state.priorityPlayerId = state.pendingChoices[0].playerId;
    return true;
}

/** True for a stackless `miracle-reveal` — raised outside any resolution's
 *  suspension, so a resolving `resolve()` that drew it is NOT parked on it
 *  (the stackless land-entry precedent, `isStacklessLandEntryPay`). */
export function isStacklessMiracleReveal(choice: PendingChoice): boolean {
    return choice.kind === "miracle-reveal" && choice.stackItemId === "";
}

/** CR 702.94a / 702.94b — `playerId` reveals `cardInstanceId` from their hand
 *  for its miracle ability: every player now knows the card (the "play with
 *  that card revealed" of 702.94b), and the dedicated MIRACLE_REVEALED event
 *  is emitted for `collectTriggers` to turn into the linked triggered ability
 *  (CR 603.11). A no-op when the card is no longer in that hand. */
export function revealForMiracle(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const player = getPlayer(state, playerId);
    if (!player.hand.some((c) => c.id === cardInstanceId)) return;
    grantKnowledgeToAll(state, playerId, [cardInstanceId]);
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        { type: "MIRACLE_REVEALED", playerId, cardInstanceId },
    ];
}

/** The oracle text the linked triggered ability renders with on the stack. */
function miracleTriggerText(cost: ManaCost): string {
    return `When you reveal this card this way, you may cast it by paying ${printManaCost(cost)} rather than its mana cost.`;
}

/** CR 702.94a / 603.11 — the linked triggered ability a miracle reveal fires:
 *  "When you reveal this card this way, you may cast it by paying [cost]
 *  rather than its mana cost." Engine-owned (the keyword's, not a card-def
 *  row), so it rides the inline-body machinery: its body is the shared
 *  `castDuringResolution` Op casting the revealed card (bound through the
 *  payload) from HAND for its miracle cost. Controlled by the card's owner,
 *  who revealed it. `undefined` when the card has no miracle cost. */
export function buildMiracleTrigger(
    state: GameState,
    card: CardInstanceState,
    ownerId: string
): StackItem | undefined {
    const cost = getMiracleCost(card);
    if (cost === undefined) return undefined;
    const cast: EffectOp = {
        op: "castDuringResolution",
        player: "controller",
        card: { ref: "$miracleCard" },
        source: "hand",
        alternativeCost: cost,
    };
    return {
        id: allocInstanceId(state),
        card: { id: (card.card as { id?: string }).id ?? "" },
        controllerId: ownerId,
        ownerId,
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: ownerId,
        triggerSourceId: card.id,
        delayedTriggerId: INLINE_DELAYED_TRIGGER_ID,
        delayedEffects: [cast],
        // Payload keys drop the `$` sigil (Convex reserves it on field names);
        // `runDelayedTriggerBody` restores it.
        delayedPayload: { miracleCard: [card.id] },
        delayedOracleText: miracleTriggerText(cost),
        // CR 603.3b — an ORDINARY triggered ability on the inline-body
        // machinery, put on the stack in APNAP order with every other ability
        // that triggered on the same draw (an opponent's "whenever an opponent
        // draws a card" lands above it), never pushed afterwards as an
        // engine-internal firing. This flag is the marker `isPlainTrigger`
        // reads for exactly that, as for the `reflexiveTrigger` Op's items.
        reflexiveTrigger: true,
    };
}
