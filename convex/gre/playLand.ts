// Shared, pure play-land core (CR 305 / CR 302.6).
//
// Playing a land (or any permanent via the play-land action) is the ONE board
// transition that two distinct call sites must keep byte-identical:
//   * the authoritative `playCard` mutation in `convex/game.ts`, and
//   * the Bot's 1-ply move simulator `applyMoveForSearch` in `applyMove.ts`.
//
// Before this helper the two sequences had drifted: `applyMove.ts` called
// `markEnteredThisTurn` (so a manland animated the turn it was played read
// summoning-sick), while `game.ts` did not — so in a REAL game a Mishra's
// Factory played and animated turn 1 could illegally attack. Consolidating the
// canonical sequence here makes the drift structurally impossible: both paths
// call `applyPlayLand`, so they cannot diverge again.
//
// This is a leaf primitive: it performs the zone move + bookkeeping + trigger
// scan + SBA pass, but NOT the caller's surrounding concerns (game.ts owns
// validation / seq / persistence; applyMove owns its search framing).

import type {
    CardInstanceState,
    GameState,
    LandEntrySourceZone,
    PlayLandSourceZone,
    PlayerState,
} from "./state";
import {
    moveCard,
    markEnteredThisTurn,
    emitPermanentEntered,
    processPendingActionTriggers,
    shouldEnterTapped,
    applyEntersWithCounters,
    applyExistingGrantsTo,
    applySourceStaticEffects,
    getPlayer,
    payMayPayCost,
    normalizeMayPayCost,
    resetBattlefieldTransientState,
    clearExileLinksToEnteringSource,
} from "./state";
import { clearZoneCharacteristics } from "./zoneCharacteristics";
import { checkStateBasedActions } from "./sba";
import { canPlayLandsFromGraveyard, isPlayableLibraryTopLand } from "./rules";
import { checkAscendCityBlessing } from "./cityBlessing";
import { tryGetDefinition } from "../cards";
import type { MayPayCost } from "../cards/types";

/**
 * Canonical play-land transition. Moves `cardInstanceId` from the player's hand
 * to the battlefield and runs the full post-entry bookkeeping. Pure: mutates
 * the passed-in `state` / `player` in place (callers clone first) and returns
 * the now-on-battlefield instance.
 *
 * Sequence (must match both call sites — that's the whole point):
 *   1. moveCard hand → battlefield
 *   2. CR 305.2 — record the land drop (only when the card is a Land; the
 *      legality check upstream already enforces the per-turn limit, this just
 *      records the spend so the next getLegalActions returns no "play").
 *   3. CR 302.6 — start the control-continuity clock on EVERY played permanent
 *      via `markEnteredThisTurn`. Inert for noncreatures, but meaningful the
 *      moment the permanent becomes a creature: a manland (Mishra's Factory)
 *      animated the same turn it was played then correctly reads summoning-sick,
 *      while one controlled continuously since a prior turn (flag cleared at the
 *      prior cleanup) does not. Untap precedes the first main phase, so the flag
 *      survives into declare-attackers on turn 1.
 *   4. CR 614.1c — a land with its own `entersTapped`/`entersTappedUnless`
 *      (Nevinyrral's-Disk-style unconditional tap, fast lands, Arena of Glory,
 *      Starting Town) or forced tapped by a battlefield-scanned opponent
 *      replacement (Kismet) enters tapped. Evaluated via the SAME
 *      `shouldEnterTapped` oracle every other ETB site (resolved spell,
 *      reanimation, token creation) uses — and, like every one of those sites,
 *      evaluated BEFORE the card joins `player.battlefield` (captured from
 *      hand pre-move), so a board-conditional predicate counting "other
 *      lands" never double-counts the entering land against itself. A land
 *      played directly can never drift from a land that enters via casting
 *      an artifact-land or similar.
 *   5. CR 611.2 — absorb existing battlefield sources' keyword-grant /
 *      type-add / subtype-add static effects (Urborg, Tomb of Yawgmoth
 *      already in play makes a freshly PLAYED land a Swamp too), then push
 *      this land's OWN static effects out to every matching permanent already
 *      on the battlefield (Urborg/Yavimaya played AFTER other lands must
 *      still turn them into Swamps/Forests). Mirrors the identical two-call
 *      sequence `finalizeSpellResolution` runs for a CAST permanent — lands
 *      never go through that path (they're played, not cast), so without this
 *      a land-shaped static effect would silently never apply.
 *   6. CR 603.6a — emit PERMANENT_ENTERED so ETB triggers (e.g. Ankh of Mishra)
 *      see the land enter, then process pending action triggers.
 *   7. CR 704 — run state-based actions to a stable point.
 */
export function applyPlayLand(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState | null {
    // CR 614.1c — tapped-on-entry is decided from the PRE-move board (the
    // card is still in hand here), so a board-conditional predicate counting
    // "other lands" (fast lands) doesn't double-count the entering land
    // against itself once `moveCard` below pushes it onto the battlefield.
    const handCard = player.hand.find((c) => c.id === cardInstanceId);

    // CR 614.12 / ADR 0051 — a land carrying a land-entry pay-choice (shock
    // lands) suspends BEFORE the zone move on a stackless `land-entry-tapped`
    // PendingChoice. The card stays in hand for the choice window; priority is
    // frozen, so nothing observes the not-yet-entered land. `finalizeLandEntry`
    // completes the entry once the controller answers. Returns null (no
    // on-battlefield instance yet) — both callers (`playCard`, search
    // `applyMove`) ignore the return.
    const cardId = (handCard?.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (handCard && def?.entersTappedUnlessPay) {
        enqueueLandEntryChoice(
            state,
            player.id,
            handCard.id,
            def.entersTappedUnlessPay,
            handCard.card,
            "hand"
        );
        return null;
    }

    const willEnterTapped = handCard
        ? shouldEnterTapped(state, handCard)
        : false;

    const card = moveCard(player, cardInstanceId, "hand", "battlefield");
    return settleEnteredLand(state, player, card, willEnterTapped);
}

/** CR 400.7 / 601.3e (issue #1156) — moves a single card from `from`'s zone on
 *  ONE player to `to`'s zone on a DIFFERENT player (`moveCard`'s cross-player
 *  counterpart — that primitive only moves within a single player's own
 *  zones). Used exactly once: a cross-player exile grant (Dauthi Voidwalker,
 *  Robber of the Rich) lets a card leave an OPPONENT's exile straight onto
 *  the CASTER's battlefield. Both `"exile"` and `"battlefield"` are public
 *  zones (CR 400.2/403), so `knownTo` is unconditionally cleared, mirroring
 *  `moveCard`'s `PUBLIC_ZONES` branch for this specific from/to pair. Throws
 *  if the card isn't in `fromPlayer`'s `from` zone (mirrors `moveCard`). */
function moveCardAcrossPlayers(
    fromPlayer: PlayerState,
    toPlayer: PlayerState,
    cardInstanceId: string,
    from: "exile",
    to: "battlefield"
): CardInstanceState {
    const sourceZone = fromPlayer[from];
    const cardIndex = sourceZone.findIndex((c) => c.id === cardInstanceId);
    if (cardIndex === -1) {
        throw new Error(`Card ${cardInstanceId} not found in ${from}`);
    }
    const [card] = sourceZone.splice(cardIndex, 1);
    card.zone = to;
    delete card.knownTo;
    // CR 122.1e / 400.7 — leaving exile makes a new object with no counters;
    // a cross-player play (Dauthi Voidwalker's void-countered opponent land)
    // must not carry the void counter onto the caster's battlefield. Mirrors
    // the same clear in `moveCard`.
    delete card.counters;
    toPlayer[to].push(card);
    // CR 113.6c — mirrors `moveCard`'s battlefield branch: a static ability
    // that functions only OUTSIDE the battlefield switches off on arrival, so
    // the printed characteristics are restored. A no-op for every card
    // declaring none. Runs before the caller's `settleEnteredLand`, hence
    // before any entry-path layer-4 `type-add` grant it could clobber.
    clearZoneCharacteristics(card);
    return card;
}

/** CR 305 / 601.3e — play a LAND from exile under a play-from-exile permission
 *  (Headliner Scarlett / Expressive Iteration exiling a land, "you may play that
 *  card this turn"). Moves `cardInstanceId` from the player's exile to the
 *  battlefield and runs the identical land-entry settlement as {@link
 *  applyPlayLand} (records the CR 305.2 land drop, ETB triggers, SBAs). The
 *  caller (`playCard`) has already validated the permission (`findCastableExileCard`)
 *  and the "play" legality (land-drop count, sorcery timing). The stale
 *  cast-from-exile flags are dropped as the card leaves exile.
 *
 *  The interactive `entersTappedUnlessPay` pay-choice (shock lands, CR 614.12)
 *  IS wired here, exactly as on the hand and library-top origins: the entry
 *  suspends BEFORE the zone move and `finalizeLandEntry` completes it. It
 *  reaches this origin through any play-from-exile permission — hideaway
 *  (CR 702.75) can exile ANY card off the top four of your own library — and
 *  skipping it let such a land enter untapped for free (issue #1980). */
export function applyPlayLandFromExile(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState | null {
    // CR 601.3e / 400.7 (issue #1156) — the card may sit in a DIFFERENT
    // player's exile than the one playing it (a cross-player grant — Dauthi
    // Voidwalker's opponent-owned void-countered land, Robber of the Rich's
    // opponent-library land). `moveCard` only moves within a single player's
    // zones, so locate the actual exile owner first; falls back to `player`
    // for the ordinary same-player case (Headliner Scarlett / Expressive
    // Iteration exile their OWN card).
    const exileOwner =
        state.players.find((p) =>
            p.exile.some((c) => c.id === cardInstanceId)
        ) ?? player;
    const exileCard = exileOwner.exile.find((c) => c.id === cardInstanceId);
    if (!exileCard) return null;

    // CR 614.12 / ADR 0051 (issue #1980) — a land carrying the pay-choice
    // suspends BEFORE the zone move, exactly like the hand and library-top
    // origins. The card stays in exile (still face down if hideaway put it
    // there) for the choice window and `finalizeLandEntry` moves it, so the
    // grant flags below are consumed there instead — see
    // `consumeExilePlayGrant`.
    const exileCardId = (exileCard.card as { id?: string } | undefined)?.id;
    const exileDef = exileCardId ? tryGetDefinition(exileCardId) : undefined;
    if (exileDef?.entersTappedUnlessPay) {
        enqueueLandEntryChoice(
            state,
            player.id,
            exileCard.id,
            exileDef.entersTappedUnlessPay,
            // CR 406.3 — a hideaway-exiled card is FACE DOWN, readable only by
            // the players its `knownTo` names, while `pendingChoices` crosses
            // `projectPublicState` unredacted to BOTH viewers. Naming the land
            // in the prompt would therefore disclose the hidden card to the
            // opponent, the same leak `castDuringResolution`'s own Play/Decline
            // offer avoids by never naming it (`effects/interpreter.ts`).
            // Passing `undefined` falls back to the generic "This land"
            // wording. An ordinary face-up exile permission (Expressive
            // Iteration, Headliner Scarlett — no `knownTo` stamped, CR 406.3's
            // default) names the land like every other origin.
            isHiddenInExile(exileCard) ? undefined : exileCard.card,
            "exile"
        );
        return null;
    }

    // CR 614.1c — tapped-on-entry is decided from the PRE-move board.
    const willEnterTapped = shouldEnterTapped(state, exileCard);

    const card =
        exileOwner === player
            ? moveCard(player, cardInstanceId, "exile", "battlefield")
            : moveCardAcrossPlayers(
                  exileOwner,
                  player,
                  cardInstanceId,
                  "exile",
                  "battlefield"
              );
    consumeExilePlayGrant(card);
    return settleEnteredLand(state, player, card, willEnterTapped);
}

/** CR 406.3 — is this exiled card still FACE DOWN, i.e. examinable only by the
 *  players its `knownTo` names? Exiled cards are face UP by default (an empty
 *  / absent `knownTo`); hideaway (CR 702.75a) and friends stamp the restricted
 *  list. Used to decide whether a land-entry prompt may name the card, since
 *  `pendingChoices` reach both viewers unredacted (issue #1980). */
function isHiddenInExile(card: CardInstanceState): boolean {
    return (card.knownTo?.length ?? 0) > 0;
}

/** CR 601.3e — the play-from-exile permission is consumed the moment the card
 *  leaves exile for the battlefield; drop the now-stale grant flags. Shared by
 *  the immediate exile play (`applyPlayLandFromExile`) and the DELAYED one
 *  that resumes out of a CR 614.12 pay-choice (`finalizeLandEntry`), so the
 *  suspended path cannot leave a consumed permission behind (issue #1980). */
function consumeExilePlayGrant(card: CardInstanceState): void {
    delete card.castableFromExileBy;
    delete card.castableFromExileUntilTurn;
    // issue #1156 — the free-cast waiver (Dauthi Voidwalker) rides the same
    // permission window; a land has no mana cost to waive, but drop the stale
    // flag for hygiene, mirroring `removeFromZone`'s spell-side cleanup.
    delete card.castFromExileWithoutPayingManaCost;
    // CR 305.9 (issue #1689) — the land-inclusive marker rides the same
    // permission window; drop it too now that the grant is consumed.
    delete card.castableFromExileIncludesLand;
}

/** CR 305 / 305.1-analog — play a LAND from the GRAVEYARD under an
 *  unconditional, player-wide play-from-graveyard permission (Icetill
 *  Explorer, issue #1190; see `canPlayLandsFromGraveyard` in `rules.ts`).
 *  Moves `cardInstanceId` from the player's graveyard to the battlefield and
 *  runs the identical land-entry settlement as {@link applyPlayLand} /
 *  {@link applyPlayLandFromExile}. The caller (`playCard`) has already
 *  validated the permission and the "play" legality (land-drop count, sorcery
 *  timing) — this function only performs the zone move + bookkeeping. Unlike
 *  the exile path, there is no per-card grant to clear: the permission is
 *  read live off the battlefield every time, so nothing on the card itself
 *  needs to be consumed.
 *
 *  Like every other origin this wires the interactive `entersTappedUnlessPay`
 *  pay-choice (shock lands, CR 614.12), suspending BEFORE the zone move
 *  (issue #1980). The graveyard is a public zone (CR 400.2), so the prompt can
 *  always name the land. */
export function applyPlayLandFromGraveyard(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState | null {
    const graveyardCard = player.graveyard.find((c) => c.id === cardInstanceId);
    if (!graveyardCard) return null;

    // CR 614.12 / ADR 0051 — suspend on the pay-choice BEFORE the zone move,
    // exactly like the hand, library-top and exile paths; the land stays in
    // the graveyard for the window.
    const graveCardId = (graveyardCard.card as { id?: string } | undefined)?.id;
    const graveDef = graveCardId ? tryGetDefinition(graveCardId) : undefined;
    if (graveDef?.entersTappedUnlessPay) {
        enqueueLandEntryChoice(
            state,
            player.id,
            graveyardCard.id,
            graveDef.entersTappedUnlessPay,
            graveyardCard.card,
            "graveyard"
        );
        return null;
    }

    // CR 614.1c — tapped-on-entry is decided from the PRE-move board, exactly
    // like the hand and exile play paths.
    const willEnterTapped = shouldEnterTapped(state, graveyardCard);

    const card = moveCard(player, cardInstanceId, "graveyard", "battlefield");
    return settleEnteredLand(state, player, card, willEnterTapped);
}

/** CR 305 / 305.1-analog — play a LAND from the TOP of the player's own
 *  library under an unconditional, player-wide play-from-top permission
 *  (Courser of Kruphix; see `canPlayLandsFromTopOfLibrary` /
 *  `isPlayableLibraryTopLand` in `rules.ts`). Moves `cardInstanceId` from
 *  index 0 of the library to the battlefield and runs the identical land-entry
 *  settlement as {@link applyPlayLand} / {@link applyPlayLandFromExile} /
 *  {@link applyPlayLandFromGraveyard}. The caller has already validated the
 *  permission and the "play" legality (land-drop count, sorcery timing); like
 *  the graveyard path there is no per-card grant to consume, the permission
 *  being re-derived off the battlefield every time.
 *
 *  Defensively re-checks that `cardInstanceId` is still index 0 — the whole
 *  permission is positional (CR 400.2 keeps the rest of the library hidden),
 *  so a stale client id naming a card the library has since moved must be a
 *  no-op rather than a play from the middle of the deck.
 *
 *  Unlike the exile path, the interactive `entersTappedUnlessPay` pay-choice
 *  (shock lands, CR 614.12) IS wired here: Courser plus a shock land is a
 *  mainstream interaction, and letting it enter untapped for free would be a
 *  rules bug, not a deferral. The land stays at index 0 for the choice window
 *  (priority is frozen on the chooser, so nothing can reorder the library) and
 *  `finalizeLandEntry` completes the entry from there. */
export function applyPlayLandFromLibraryTop(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState | null {
    const top = player.library[0];
    if (!top || top.id !== cardInstanceId) return null;

    // CR 614.12 / ADR 0051 — suspend on the pay-choice BEFORE the zone move,
    // exactly like the hand path; the land stays on top for the window.
    const cardId = (top.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (def?.entersTappedUnlessPay) {
        enqueueLandEntryChoice(
            state,
            player.id,
            top.id,
            def.entersTappedUnlessPay,
            top.card,
            "library-top"
        );
        return null;
    }

    // CR 614.1c — tapped-on-entry is decided from the PRE-move board, exactly
    // like the hand, exile and graveyard play paths.
    const willEnterTapped = shouldEnterTapped(state, top);

    const card = moveCard(player, cardInstanceId, "library", "battlefield");
    return settleEnteredLand(state, player, card, willEnterTapped);
}

/** The zone a play-land action is sourcing its card from (CR 305.9 — hand
 *  unless an effect explicitly says otherwise). Defined in `gre/state.ts`
 *  (where `PendingChoice.landSourceZone` needs it) and re-exported here, this
 *  module's historic home, so every existing importer is unaffected. */
export type { PlayLandSourceZone, LandEntrySourceZone } from "./state";

/** Resolves WHICH zone `cardInstanceId` is being played from, or `null` when
 *  no permitted source holds it. The permission checks are the same ones
 *  `getLegalActions` uses, so this never widens legality — it only answers
 *  "given that the play is legal, which `applyPlayLandFrom*` performs it".
 *
 *  Exists because the three play-land call sites (`playCard` in game.ts, the
 *  Bot's `applyMoveForSearch` in applyMove.ts, and the ISMCTS coarse leaf in
 *  search.ts) each used to hard-code their own source resolution — the latter
 *  two hard-coded `"hand"` outright, so a bot holding a play-from-graveyard or
 *  play-from-top permission could never use it and, worse, `moveCard` threw
 *  `Card <id> not found in hand` if a move for one ever reached them. Routing
 *  all three through one resolver is what keeps the authoritative and
 *  simulated paths from drifting, exactly as `applyPlayLand` itself does for
 *  the settlement. */
export function resolvePlayLandSourceZone(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): PlayLandSourceZone | null {
    if (player.hand.some((c) => c.id === cardInstanceId)) return "hand";
    if (isPlayableLibraryTopLand(state, player, cardInstanceId)) {
        return "library-top";
    }
    if (
        player.graveyard.some((c) => c.id === cardInstanceId) &&
        canPlayLandsFromGraveyard(state, player)
    ) {
        return "graveyard";
    }
    const exileCard = state.players
        .flatMap((p) => p.exile)
        .find((c) => c.id === cardInstanceId);
    if (
        exileCard &&
        exileCard.castableFromExileBy === player.id &&
        exileCard.castableFromExileIncludesLand === true
    ) {
        return "exile";
    }
    return null;
}

/** Play a land from whichever permitted zone currently holds it — the single
 *  entry point every play-land call site should use. Dispatches to the
 *  matching `applyPlayLandFrom*` (or `applyPlayLand` for the ordinary hand
 *  drop); returns `null` when no permitted source holds the card, or when the
 *  entry suspended on a CR 614.12 pay-choice. */
export function applyPlayLandFromAnyZone(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState | null {
    switch (resolvePlayLandSourceZone(state, player, cardInstanceId)) {
        case "hand":
            return applyPlayLand(state, player, cardInstanceId);
        case "library-top":
            return applyPlayLandFromLibraryTop(state, player, cardInstanceId);
        case "graveyard":
            return applyPlayLandFromGraveyard(state, player, cardInstanceId);
        case "exile":
            return applyPlayLandFromExile(state, player, cardInstanceId);
        case null:
            return null;
    }
}

/** Post-move land-entry bookkeeping (steps 2–7 of `applyPlayLand`), shared by
 *  the normal path and the land-entry-choice finalizer so a shock land and a
 *  plain land settle through byte-identical logic. Assumes `card` is already
 *  on `player.battlefield`. */
function settleEnteredLand(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    willEnterTapped: boolean
): CardInstanceState {
    // CR 400.7 — the entering permanent is a NEW object. `moveCard` clears the
    // battlefield-only transient block ONLY on a departure to hand/library; a
    // battlefield→graveyard/exile departure deliberately PRESERVES it as
    // last-known information for death/LTB triggers. So a land played from the
    // graveyard (Icetill Explorer, Crucible of Worlds, Ramunap Excavator) or
    // from exile arrives still carrying `isTapped` / `damageMarked` /
    // `hasAttackedThisTurn` / granted abilities from its previous life — a land
    // that died TAPPED re-entered tapped. Every reanimation-style entry already
    // funnels through this same helper (`stageReanimatedOnBattlefield`); the
    // play-a-land entry is the one that didn't, so do it here, at the shared
    // settlement, rather than per-source. A from-hand play is a no-op (the card
    // has no battlefield history). Runs FIRST: `markEnteredThisTurn` and the
    // `willEnterTapped` write below must not be undone by the reset.
    resetBattlefieldTransientState(card);
    // CR 400.7 / 608.2h (issue #2001) — this is a genuine battlefield entry
    // (every `applyPlayLandFrom*` origin funnels here with the card already
    // moved to the battlefield). If this instance id held the battlefield
    // before and stamped an exile provenance link (a bounced-and-replayed
    // hideaway land, CR 702.75), that link belongs to a previous object —
    // drop it now, on THIS new object's entry, not at its departure. See
    // `clearExileLinksToEnteringSource`'s doc in state.ts.
    clearExileLinksToEnteringSource(state, card.id);

    // CR 305.2 — track the land drop.
    if (card.types.includes("Land")) {
        player.landsPlayedThisTurn = (player.landsPlayedThisTurn ?? 0) + 1;
    }

    // CR 302.6 — control-continuity clock (summoning sickness for manlands).
    markEnteredThisTurn(card, state.turn);

    // CR 702.131b / 702.131d — continuous Ascend check (`gre/cityBlessing.ts`),
    // run BEFORE the trigger scan below: "after a player gets the city's
    // blessing, continuous effects are reapplied before the game checks to see
    // if the game state or preceding events have matched any trigger
    // conditions". Gatherer (Ascend): "if your tenth permanent is a land you
    // play, players can't respond before you get the city's blessing".
    checkAscendCityBlessing(state);

    if (willEnterTapped) card.isTapped = true;

    // CR 121.6 / 614.1c (issue #1693) — the entry-counters self-replacement
    // applies at THIS entry site too. Every one of this helper's callers
    // (`applyPlayLand`, `applyPlayLandFromExile`, `applyPlayLandFromGraveyard`,
    // `applyPlayLandFromLibraryTop`, `finalizeLandEntry`'s play-source branch)
    // is a full permanent entry, so it
    // must run before the grant/static passes and before `emitPermanentEntered`
    // scans triggers — nothing may observe the permanent at zero counters.
    // Latent today (no shipped Land declares `entersWith`), wired so the site
    // cannot be the one that drifts when one does. The effect-entry branch of
    // `finalizeLandEntry` does NOT come through here — that land already got
    // its counters inside `stageReanimatedOnBattlefield`, so there is no
    // double application.
    // CR 702.44b (issue #2378) — a PLAYED land is never cast (CR 305.1: playing
    // a land uses no stack and is not a spell), so no mana was spent to cast
    // it and a sunburst count here is 0 by rule, not by accident. Stated
    // explicitly because `EntersWithCastValues.manaSpentToCast` is required.
    const cardId = (card.card as { id?: string } | undefined)?.id;
    applyEntersWithCounters(
        card,
        cardId ? (tryGetDefinition(cardId) ?? undefined) : undefined,
        { manaSpentToCast: {} },
        state
    );

    // CR 611.2 — two-way static-effect reconciliation (see step 5 above).
    applyExistingGrantsTo(state, card);
    applySourceStaticEffects(state, card);

    // CR 603.6a — ETB triggers see the permanent enter. CR 305.2 — `wasPlayed`
    // marks this as a PLAYED land (vs. one put onto the battlefield by an
    // effect) so "whenever you play a land" triggers (Fastbond, City of
    // Traitors) fire here but NOT on a fetch/tutor/reanimation entry.
    emitPermanentEntered(state, card, { wasPlayed: true });
    processPendingActionTriggers(state);

    // CR 704 — settle state-based actions.
    checkStateBasedActions(state);

    return card;
}

/** Human-readable label for a land-entry pay-choice cost (CR 614.12). Kept
 *  minimal — the client renders the button from `choice.cost`; this is the
 *  secondary prompt text. Covers the life / mana / sacrifice legs the shock
 *  cycle and any future `entersTappedUnlessPay` land might carry. */
function payCostText(cost: MayPayCost): string {
    const norm = normalizeMayPayCost(cost);
    const parts: string[] = [];
    if (norm.life !== undefined && norm.life > 0)
        parts.push(`${norm.life} life`);
    if (norm.mana) {
        for (const sym of ["W", "U", "B", "R", "G", "C"] as const) {
            const n = norm.mana[sym] ?? 0;
            for (let i = 0; i < n; i++) parts.push(`{${sym}}`);
        }
        const generic =
            (typeof norm.mana.X === "number" ? norm.mana.X : 0) +
            (norm.mana.C ?? 0);
        if (generic > 0 && !norm.mana.C) parts.unshift(`{${generic}}`);
    }
    if (norm.permanent) {
        // CR 118 threshold mode ("sacrifice any number … total power ≥ N") vs.
        // the fixed-cardinal "sacrifice N" (shock lands, cumulative upkeep) vs.
        // the return-to-hand leg (CR 400.7 / 118.9, ADR 0079).
        const leg = norm.permanent;
        parts.push(
            typeof leg.count === "object"
                ? `sacrifice creatures with total power ${leg.count.minTotalPower}`
                : leg.action === "return"
                  ? `return ${leg.count}`
                  : `sacrifice ${leg.count}`
        );
    }
    return parts.join(", ") || "the cost";
}

/** CR 614.12 / ADR 0051 — enqueue the stackless land-entry pay-choice for a
 *  shock land entering under `playerId`'s control. Freezes priority on the
 *  chooser. `landCardData` is the entering card's `.card` payload, forwarded
 *  onto the prompt so it can name the land — pass `undefined` when the card's
 *  identity must stay hidden (a still-face-down exiled card, CR 406.3), which
 *  falls back to the generic "This land" wording.
 *
 *  `sourceZone` is REQUIRED and is recorded on the choice as
 *  `PendingChoice.landSourceZone`: the explicit, fail-closed discriminator
 *  `finalizeLandEntry` reads to find the land again on submit. It is a
 *  parameter rather than something the finalizer re-derives because a sniff
 *  cannot distinguish "not in any zone I thought to look in" from "not
 *  suspended at all" — the hand-then-library-top sniff it replaced silently
 *  could not see an exile or graveyard origin, which is why neither dared
 *  raise this choice and a shock land played from exile entered untapped for
 *  free (issue #1980). Requiring it means a NEW play origin breaks the build
 *  here instead of falling through to a wrong zone. */
export function enqueueLandEntryChoice(
    state: GameState,
    playerId: string,
    landInstanceId: string,
    cost: MayPayCost,
    landCardData: unknown,
    sourceZone: LandEntrySourceZone
): void {
    const name =
        (landCardData as { name?: string } | undefined)?.name ?? "This land";
    state.pendingChoices = state.pendingChoices ?? [];
    state.pendingChoices.push({
        stackItemId: "",
        step: 0,
        choiceId: `land-entry-${landInstanceId}`,
        playerId,
        zoneOwnerId: playerId,
        kind: "land-entry-tapped",
        landInstanceId,
        landSourceZone: sourceZone,
        cost,
        count: 1,
        prompt: `You may pay ${payCostText(cost)}. If you don't, ${name} enters the battlefield tapped.`,
    });
    state.priorityPlayerId = playerId;
}

/** The land a suspended `land-entry-tapped` choice is waiting on, together
 *  with the player whose zone currently holds it. `owner` differs from the
 *  acting player only for the cross-player exile grant (CR 400.7 / 601.3e,
 *  issue #1156 — Dauthi Voidwalker letting a card leave an OPPONENT's exile
 *  straight onto the caster's battlefield). */
type SuspendedLandSource = {
    card: CardInstanceState;
    owner: PlayerState;
    zone: "hand" | "library" | "graveyard" | "exile";
};

/** Locates the card a suspended `land-entry-tapped` choice is waiting on, in
 *  whichever zone it was being PLAYED from (CR 305) when the choice
 *  interrupted the entry. Driven by the choice's own `landSourceZone`
 *  discriminator, NOT by a search: each origin suspends before its zone move,
 *  so the card is exactly where its enqueue site said it was.
 *
 *  Returns `undefined` for `"battlefield"` (the effect-entry case: the land is
 *  already in play, so `finalizeLandEntry` falls through to its
 *  already-on-battlefield completion) and for a zone that no longer holds the
 *  card at all. `undefined` for the DISCRIMINATOR itself means a choice
 *  persisted before the field existed (issue #1980): fall back to the exact
 *  hand-then-library-top sniff that shipped before, which is what such a
 *  choice was enqueued under. */
function locateSuspendedLandSource(
    state: GameState,
    player: PlayerState,
    landInstanceId: string,
    sourceZone: LandEntrySourceZone | undefined
): SuspendedLandSource | undefined {
    switch (sourceZone) {
        case "hand": {
            const card = player.hand.find((c) => c.id === landInstanceId);
            return card ? { card, owner: player, zone: "hand" } : undefined;
        }
        case "library-top": {
            // Position-strict (index 0), mirroring the play-from-top
            // permission itself (CR 400.2 keeps the rest of the library
            // hidden). Priority is frozen on the chooser for the whole choice
            // window, so nothing can reorder the library underneath it.
            const top = player.library[0];
            return top && top.id === landInstanceId
                ? { card: top, owner: player, zone: "library" }
                : undefined;
        }
        case "graveyard": {
            const card = player.graveyard.find((c) => c.id === landInstanceId);
            return card
                ? { card, owner: player, zone: "graveyard" }
                : undefined;
        }
        case "exile": {
            // CR 400.7 / 601.3e (issue #1156) — exile is the one origin whose
            // owner may not be the acting player, so resolve it by search
            // rather than assuming `player`, exactly as
            // `applyPlayLandFromExile` does on its immediate path.
            const owner = state.players.find((p) =>
                p.exile.some((c) => c.id === landInstanceId)
            );
            const card = owner?.exile.find((c) => c.id === landInstanceId);
            return owner && card ? { card, owner, zone: "exile" } : undefined;
        }
        case "battlefield":
            return undefined; // effect entry — already in play
        case undefined: {
            const handCard = player.hand.find((c) => c.id === landInstanceId);
            if (handCard) {
                return { card: handCard, owner: player, zone: "hand" };
            }
            const top = player.library[0];
            if (top && top.id === landInstanceId) {
                return { card: top, owner: player, zone: "library" };
            }
            return undefined;
        }
    }
}

/** CR 614.12 / ADR 0051 — complete a suspended land-entry after the controller
 *  answers the pay-choice. `accept` pays the cost (caller/validator has already
 *  gated affordability) to skip the land's OWN tapped clause; declining taps
 *  it. Any OTHER tapped source (Kismet) still applies independently, so the
 *  final tapped bit is `shouldEnterTapped(state, card) || !accept` — the land's
 *  own contribution is the pay-choice, everything else comes through the shared
 *  oracle. `sourceZone` is the choice's own `PendingChoice.landSourceZone` —
 *  the caller reads it off the pending choice before shifting it out of the
 *  queue. Mutates `state`; returns the now-on-battlefield land. */
export function finalizeLandEntry(
    state: GameState,
    playerId: string,
    landInstanceId: string,
    cost: MayPayCost,
    accept: boolean,
    sourceZone?: LandEntrySourceZone
): CardInstanceState {
    const player = getPlayer(state, playerId);
    if (accept) payMayPayCost(state, playerId, cost);

    // Play-land path (CR 305): the land is still in the zone it is being PLAYED
    // from for the choice window — hand, the top of the library (Courser of
    // Kruphix), the graveyard (Icetill Explorer) or exile (a hideaway /
    // impulse-draw play permission). All four suspend before their zone move
    // and settle identically; only the zone the move reads differs, and
    // `locateSuspendedLandSource` reads it off the choice's own discriminator
    // instead of sniffing (issue #1980).
    const playSource = locateSuspendedLandSource(
        state,
        player,
        landInstanceId,
        sourceZone
    );
    if (playSource) {
        // Move it and run the full land-entry settlement (records the land
        // drop). Kismet-style forced-tapped is read from the PRE-move board.
        // A shock land declares no own `entersTapped(Unless)`, so
        // `shouldEnterTapped` returns only the battlefield-scanned replacement.
        const forcedTapped = shouldEnterTapped(state, playSource.card);
        const willEnterTapped = forcedTapped || !accept;
        const card =
            playSource.owner === player
                ? moveCard(
                      player,
                      landInstanceId,
                      playSource.zone,
                      "battlefield"
                  )
                : moveCardAcrossPlayers(
                      playSource.owner,
                      player,
                      landInstanceId,
                      "exile",
                      "battlefield"
                  );
        // CR 601.3e — the delayed exile play consumes its permission on
        // arrival, exactly like the immediate one; without this the grant
        // survives on the now-on-battlefield card (issue #1980).
        if (playSource.zone === "exile") consumeExilePlayGrant(card);
        return settleEnteredLand(state, player, card, willEnterTapped);
    }

    // Effect-entry path (CR 614.12): the land was put onto the battlefield by an
    // effect (tutor / reanimation) and is ALREADY there, entered provisionally
    // tapped with its ETB deferred by `putReanimatedOnBattlefield`. Commit the
    // final tapped bit (paying skips only the land's OWN clause; Kismet still
    // applies independently, CR 616) and NOW emit the entry — but do NOT record
    // a land drop: only PLAYING a land does (CR 305.2).
    const card = findLandOnBattlefield(state, landInstanceId);
    if (!card) {
        throw new Error("land-entry target is no longer on the battlefield");
    }
    const forcedTapped = shouldEnterTapped(state, card);
    card.isTapped = forcedTapped || !accept;
    emitPermanentEntered(state, card);
    processPendingActionTriggers(state);
    checkStateBasedActions(state);
    return card;
}

/** Locate a permanent by instance id across every player's battlefield. Used by
 *  the effect-entry `finalizeLandEntry` path (the land is already in play). */
function findLandOnBattlefield(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === instanceId);
        if (found) return found;
    }
    return undefined;
}
