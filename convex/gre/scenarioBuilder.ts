/**
 * Pure `GameState` builder for debug scenarios (issue #1424, PRD #1423).
 *
 * Factored out of the `debugSetupScenario` Convex mutation (`convex/game.ts`)
 * so the exact same state-construction logic is callable from a vitest test
 * (no Convex runtime, no `ctx.db`) AND from the mutation — the blade-scenario
 * harness (#1423) builds a scenario's `GameState` in-process via this
 * function. `debugSetupScenario` now delegates to it: a pure refactor, zero
 * behavior change to the Debug panel or existing scenarios.
 *
 * Pure and synchronous: no `ctx`, no `await`. Takes an already-fetched base
 * `GameState` (a fresh game's snapshot, mulligan phase and all) and a
 * `ScenarioSpec`, and returns a NEW state with the scenario applied — the
 * input is never mutated (the function clones internally).
 */

import {
    getCardByName as getCatalogueCardByName,
    tokenDefinitionId,
    tryGetDefinition,
} from "../cards";
import { isInsetSpellDefinitionId } from "../cards/insetSpell";

/** CR 715.4 — the name→card resolution EVERY builder in this module uses, with
 *  the one thing a scenario may never name: an inset spell.
 *
 *  "In every zone except the stack, and while on the stack not as an Adventure,
 *  an adventurer card has only its normal characteristics." A scenario places
 *  cards into hands, battlefields, graveyards, libraries and exile — never onto
 *  the stack as an Adventure — so an entry naming "Petty Theft" would seed an
 *  Instant that is not a card in any zone the rules admit, with no card-index
 *  row and no path back to its front face. The validators
 *  (`debugScenarios.ts`, `debugScenarioGenerator.ts`) reject it first with a
 *  readable message; this is the backstop that makes the builder itself
 *  fail closed, because a spec can also arrive from a seeded backlog file that
 *  never passed through them (PR #3302 review finding 5). */
function getCardByName(name: string) {
    const def = getCatalogueCardByName(name);
    if (isInsetSpellDefinitionId(def.id)) {
        throw new Error(
            `"${name}" is an Adventure, not a card that can be placed in a zone (CR 715.4)`
        );
    }
    return def;
}
import { INDEFINITE_SOURCE_ID } from "./layer6";
import { basicLandsForColors, getCardColors } from "../cards/colors";
import { findTokenSpec, listTokenCatalogue } from "../cards/tokenCatalogue";
import type { Color } from "../cards/types";
import {
    resolveScenarioBattlefieldCounters,
    type ScenarioCard,
    type ScenarioRestrictedMana,
    type ScenarioSpec,
} from "../debugScenarioSpec";
import {
    type CardInstanceState,
    type GameState,
    type PlayerState,
    type RestrictedMana,
    allocInstanceId,
    beginApplyingStaticEffects,
    createTokenPermanents,
    exileFaceDownCard,
    getOpponentId,
} from "./state";
import { applyCopy } from "./copy";
import { refreshOffBattlefieldCharacteristics } from "./zoneCharacteristics";
import { resolveEntersWithCounters } from "../cards/entersWith";
import { turnFaceDown } from "./faceDown";
import { finalizeMulligan } from "./mulligan";
import { isPlaneswalker, PLACEHOLDER_CARD_ID } from "./constants";
import { MANA_COLORS } from "./manaColors";
import {
    markAttacking,
    markDeclaredBlockers,
    recordAttackerDeclared,
    validateDeclaredBlockers,
} from "./combat";
import { recordBlockedAttackers } from "./banding";
import type { Phase } from "./types";

/** CR 106.4 / 603.3 / 502.1 (issue #3451) — stamp one battlefield entry's
 *  TAP STATE onto the instance the rebuild just placed: the two markers that
 *  make a tap irreversible (`manaCommitted`, `tapTriggerCommitted` — either one
 *  makes `tapUntap`'s untap-to-refund toggle refuse the source) plus the
 *  CR 502.1 untap-step snapshot an "if ~ started the turn untapped" upkeep
 *  trigger reads (Rasputin Dreamweaver).
 *
 *  All three are written only when the entry asks for them: absent means the
 *  engine's own default (a reversible tap, a permanent that did not start the
 *  turn untapped), which is the minimal shape `specFromState` produces.
 *
 *  What is deliberately NOT staged here is the tap's UNDO BOOKKEEPING —
 *  `chosenMana`, `tapBonusMana`, `manaPaidThisTap`, `lifePaidThisTap`,
 *  `exertedThisTap`, `manaCounterRemoval`. Those exist so `untapSourceFromPayment`
 *  can give back exactly what a tap took — and a REBUILT position has no tap to
 *  give anything back for. Staging them would let a rebuilt untap ADD life,
 *  counters and cost mana that this position never paid; see
 *  `CARD_STATE_ALLOWLIST`. (Issue #3451 argued this from the mana pool being
 *  unlowerable; issue #3460 lowered the pool, and the argument is unchanged —
 *  it never rested on the pool's contents but on the absent tap. A captured
 *  pool now arrives in full, and it arrives with no undo ledger behind it,
 *  which is exactly right: nothing was taken to give back.) */
function applyTapState(card: CardInstanceState, entry: ScenarioCard): void {
    if (entry.manaCommitted) card.manaCommitted = true;
    if (entry.tapTriggerCommitted) card.tapTriggerCommitted = true;
    if (entry.startedTurnUntapped) card.startedTurnUntapped = true;
}

/** CR 602.5 (issue #3448) — the per-turn activation tallies a scenario entry
 *  declares, cleaned of the counts that say nothing: a key at zero or below
 *  means "not activated this turn", which is exactly what an ABSENT key
 *  already means, so keeping one would rebuild into a spec `specFromState`
 *  never writes and make the round trip non-minimal. Returns `undefined` when
 *  nothing survives, so the caller leaves the instance's `activationsThisTurn`
 *  unset (the builder's minimal shape, as `counters` does). */
function resolveScenarioActivations(
    activations: Record<string, number> | undefined
): Record<string, number> | undefined {
    if (!activations) return undefined;
    const out: Record<string, number> = {};
    for (const [abilityId, count] of Object.entries(activations)) {
        if (count > 0) out[abilityId] = count;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** CR 608.2 / 514.2 (issue #3453) — re-key one card entry's per-turn
 *  triggered-ability resolution tallies onto the instance the rebuild just
 *  allocated, writing `GameState.abilityResolutionCounts`'s own
 *  `${sourceInstanceId}:${abilityId}` keys.
 *
 *  The game-level store is keyed by an instance id, which this rebuild
 *  reassigns; that is the whole reason the spec carries the tally on the CARD
 *  and re-keys here rather than lowering the map verbatim. Counts at or below
 *  zero are skipped for the same reason `resolveScenarioActivations` drops
 *  them: an absent key already means "hasn't resolved this turn", so keeping
 *  one would rebuild into a spec `specFromState` never writes. */
function seedAbilityResolutions(
    state: GameState,
    instanceId: string,
    resolutions: Record<string, number> | undefined
): void {
    if (!resolutions) return;
    for (const [abilityId, count] of Object.entries(resolutions)) {
        if (count <= 0) continue;
        const counts = (state.abilityResolutionCounts ??= {});
        counts[`${instanceId}:${abilityId}`] = count;
    }
}

/** The inverse of {@link seedAbilityResolutions}: this card's slice of
 *  `GameState.abilityResolutionCounts`, keyed by ability id alone. The store's
 *  key splits at the FIRST colon — an instance id never contains one
 *  (`allocInstanceId`), an ability id may. */
function lowerAbilityResolutions(
    state: GameState,
    instanceId: string
): Record<string, number> | undefined {
    const counts = state.abilityResolutionCounts;
    if (!counts) return undefined;
    const prefix = `${instanceId}:`;
    const out: Record<string, number> = {};
    for (const [key, count] of Object.entries(counts)) {
        if (count > 0 && key.startsWith(prefix)) {
            out[key.slice(prefix.length)] = count;
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Create a scenario entry's TOKEN permanents (CR 111 / 707.2) and apply the
 * per-entry battlefield knobs to each copy.
 *
 * A token is not a card, so it can't go through `makeInstance`/`getCardByName`:
 * its characteristics live in a `TokenSpec` resolved from the token catalogue
 * (`cards/tokenCatalogue.ts`) and it is created through the engine's own
 * `createTokenPermanents` — the same primitive a real card's `createToken`
 * uses, so the placed token gets its synthesized + registered definition, its
 * art, its `entersWith` counters and its activated abilities exactly as if a
 * card had made it.
 *
 * Throws on an unknown token key, mirroring `getCardByName`'s behaviour for an
 * unknown card name: a scenario that references a token shape the pool can't
 * create is a spec error, not a silently-empty board.
 *
 * Returns the created instances so the caller can queue any `attachedTo`.
 */
function placeScenarioTokens(
    state: GameState,
    entry: ScenarioSpec["cards"][number],
    player: PlayerState
): CardInstanceState[] {
    const spec = findTokenSpec(entry.name);
    if (!spec) {
        throw new Error(
            `Unknown token: "${entry.name}". Token names come from the token catalogue (cards/tokenCatalogue.ts).`
        );
    }
    // CR 111.7 — a token in any zone other than the battlefield ceases to
    // exist, so a token entry is battlefield-only regardless of `zone`.
    const ids = new Set(
        createTokenPermanents(state, spec, player.id, entry.count ?? 1)
    );
    const created = player.battlefield.filter((c) => ids.has(c.id));
    for (const token of created) {
        token.isTapped = entry.tapped ?? false;
        // CR 302.6 — `createTokenPermanents` marks every fresh token
        // summoning-sick (it just entered). A scenario stages an ALREADY-SET-UP
        // board, so the default flips to "has been here since your last turn"
        // unless the spec explicitly asks for a just-created token.
        token.isSummoningSick = entry.summoningSick ?? false;
        // CR 400.7 (issue #1824) — `createTokenPermanents` also stamps
        // `enteredOnTurn = state.turn`, and that stamp (not `isSummoningSick`)
        // is what `hasControlledSinceTurnStart` reads. Clearing it in lockstep
        // with the flag above keeps the two facts consistent: a token staged
        // as pre-existing must not still read as having entered this turn.
        if (token.isSummoningSick) {
            token.enteredOnTurn = state.turn;
        } else {
            delete token.enteredOnTurn;
        }
        if (entry.damageMarked && entry.damageMarked > 0) {
            token.damageMarked = entry.damageMarked;
        }
        if (entry.attackedLastTurn) token.attackedDuringLastTurn = true;
        // CR 106.4 / 603.3 / 502.1 (issue #3451) — the tap-state trio, applied
        // on the token path for the same reason as the card path below: a
        // Treasure or a mana-producing creature token is a tappable source
        // whose tap can already be committed, and any token can be a Rasputin's
        // "started the turn untapped" subject.
        applyTapState(token, entry);
        const tokenActivations = resolveScenarioActivations(entry.activations);
        if (tokenActivations) token.activationsThisTurn = tokenActivations;
        // CR 608.2 (issue #3453) — a token can be a trigger source with an
        // escalating per-turn tally of its own (a copy of Scythecat Cub), so
        // the token branch re-keys it exactly as the card branch does.
        seedAbilityResolutions(state, token.id, entry.abilityResolutions);
        // An explicit `counters` REPLACES whatever the spec's `entersWith`
        // seeded (the scenario is staging a specific board); no counters in the
        // spec leaves the token's own entry counters in place.
        if (entry.counters) {
            const counters = resolveScenarioBattlefieldCounters(
                entry.counters,
                {
                    isPlaneswalker: isPlaneswalker(token),
                    printedLoyalty: undefined,
                }
            );
            if (counters) token.counters = counters;
        }
    }
    return created;
}

/**
 * Build the scenario board state from a base `GameState` and a
 * `ScenarioSpec`. Mirrors `debugSetupScenario`'s handler body exactly (see
 * `convex/game.ts`) minus the Convex-specific admin gate and persistence —
 * those stay in the mutation, which delegates the state-construction work
 * here.
 */
export function buildStateFromScenario(
    baseState: GameState,
    spec: ScenarioSpec
): GameState {
    const state = structuredClone(baseState);
    // If the game is still in the pre-game mulligan phase (CR 103.5),
    // confirm the mulligan for both players so the scenario takes over a
    // clean turn-1 state. The scenario's own `phase` override (later below)
    // wins if specified.
    if (state.mulligan) {
        finalizeMulligan(state);
    }

    const p1 = state.players[0];
    const p2 = state.players[1];

    // Clear battlefields, hands, graveyards, exile, and any companion slot
    // the underlying deck's sideboard auto-declared at game init (CR
    // 702.139c, ADR 0064) — a scenario is a deterministic full board
    // reset, so a stale companion from whatever deck started this game
    // must not leak through. `spec.companion` (below) re-declares one
    // explicitly when the scenario wants to exercise it.
    p1.battlefield = [];
    p2.battlefield = [];
    p1.hand = [];
    p2.hand = [];
    p1.graveyard = [];
    p2.graveyard = [];
    p1.exile = [];
    p2.exile = [];
    p1.companion = undefined;
    p2.companion = undefined;
    // CR 121.1 / 400.7 (issue #3240) — the PER-TURN player tallies go with the
    // zones, for the same reason: a scenario PLACES a position, it does not
    // replay the turn that reached it, so nothing has been drawn and nothing
    // has left a graveyard "this turn" on a freshly-built board.
    //
    // This is not hygiene, it is correctness of the artefact. The opening hand
    // is dealt through `drawCard` (`gre/setup.ts`) and `finalizeMulligan` walks
    // to UPKEEP via `advancePhase`, never `advanceTurn` — so without this clear
    // every scenario arrives on turn 1 carrying SEVEN drawn cards, and the
    // first "if you've drawn more than one card this turn" trigger (Proft's
    // Eidetic Memory) fires for 7 on a board where the player has drawn
    // nothing. `markLastDrawn` below re-seeds the draw tally deliberately when
    // the spec asks for it, so the two stay consistent.
    p1.drawnThisTurn = undefined;
    p2.drawnThisTurn = undefined;
    p1.leftGraveyardThisTurn = undefined;
    p2.leftGraveyardThisTurn = undefined;
    // CR 305.2 (issue #3446) — the land drop is a per-turn tally of the same
    // family, and it is cleared here for the same reason: a scenario places a
    // position rather than replaying the turn that reached it, so the board a
    // spec describes must not inherit the LOADED game's spent drop. `spec.
    // landsPlayed` below re-seeds it deliberately, which is what lets a
    // post-land-drop main-phase decision be captured at all.
    p1.landsPlayedThisTurn = undefined;
    p2.landsPlayedThisTurn = undefined;
    // CR 106.4 (issue #3460) — floating mana joins the per-turn family above,
    // and it is the member with the shortest life of all: "each player's mana
    // pool empties at the end of each step and phase". A scenario places a
    // position, so the pool it describes is the one `spec.manaPool` /
    // `spec.restrictedMana` name below and nothing else — without this clear
    // `debugSetupScenario`, which rebuilds onto the LIVE game, hands the
    // rebuilt board whatever that game happened to be holding, and a captured
    // position with an empty pool could not be placed at all.
    p1.manaPool = {};
    p2.manaPool = {};
    p1.restrictedMana = undefined;
    p2.restrictedMana = undefined;
    // CR 120.3a / 119.3 / 700.4 / 508.1a / 608.2 (issue #3453) — the GAME-level
    // per-turn ledgers go with the per-player ones, for exactly the reason
    // above and one more: `debugSetupScenario` rebuilds onto the LIVE game, so
    // without this clear a position captured before any creature died loads
    // into a game where three did, and Scavenging Ghoul's "if a creature died
    // this turn" fires on a board the spec says is quiet. Each is re-seeded
    // deliberately below from its own spec field, so a CAPTURED position
    // round-trips and a hand-written one places what it names.
    state.deathsThisTurn = undefined;
    state.creatureAttackedThisTurn = undefined;
    state.damageDealtToPlayerThisTurn = undefined;
    state.artifactDamageToPlayerThisTurn = undefined;
    state.lifeGainedThisTurn = undefined;
    state.abilityResolutionCounts = undefined;
    // NOT exhaustive, and deliberately so: the cast tallies issue #3449
    // widened (`state.spellsCastThisTurn`, the two per-seat pairs) are NOT
    // cleared here, because that issue chose "absent means unchanged" for them
    // and pinned the choice in a test. Each widening under PRD #3397 clears
    // its own fields; the leak that convention leaves for a HAND-WRITTEN spec
    // is recorded in
    // `docs/findings/3446-scenario-builder-per-turn-clear-is-a-denylist.md`,
    // not silently fixed here.
    // CR 608.2h / 111.12 (ADR 0086) — the departure ledger of last-known
    // COPIABLE values is keyed by the instance id a permanent had on the
    // battlefield, and the placement loop below reassigns every id. A carried
    // entry therefore names an object that no longer exists on the rebuilt
    // board: dead weight at best, and a stale answer to `createTokenCopyOf`'s
    // fallback at worst. The rebuilt board has no departures, so the correct
    // value is empty and the engine re-stamps it at the next one
    // (`removePermanentTo`) — which is why `specFromState` allowlists this key
    // as rebuild bookkeeping rather than lowering it.
    state.lastKnownCopiable = undefined;
    // CR 514.3a (issue #2472) — the "this turn's cleanup bookkeeping has run"
    // marker is compared against `state.turn`, so a marker inherited from the
    // loaded game and equal to the rebuilt turn number would suppress this
    // turn's once-per-turn cleanup steps (the `skip` countdown and the
    // `attackedDuringLastTurn` roll-forward). A scenario places a position
    // BEFORE its cleanup, never inside one, so the rebuilt turn's bookkeeping
    // has by construction not run: cleared here, re-stamped by
    // `finalizeCleanup` when the turn actually ends.
    state.cleanupBookkeepingTurn = undefined;

    // CR 508.1c (issue #3450) — Arboria's turn history joins the per-turn
    // family above, and the frozen LAST-turn flag with it: a scenario places
    // a position rather than replaying the two turns that reached it, so the
    // board a spec describes must not inherit the loaded game's history.
    // `spec.qualifyingActionThisTurn` / `…LastTurn` below re-seed them
    // deliberately, which is what lets an Arboria position be captured at all
    // — without the clear, "no qualifying action last turn" (the state that
    // FORBIDS attacking that player) is the one value a spec could not place.
    p1.qualifyingActionThisTurn = undefined;
    p2.qualifyingActionThisTurn = undefined;
    p1.qualifyingActionLastTurn = undefined;
    p2.qualifyingActionLastTurn = undefined;
    // Revolt, an ability word (CR 207.2c) — same family, same reason: it is
    // set by any permanent leaving the battlefield this turn and reset by
    // `advanceTurn`, so a rebuilt position inheriting it would hand Fatal Push
    // a fourth mana value of reach the captured board never gave it.
    p1.permanentYouControlledLeftThisTurn = undefined;
    p2.permanentYouControlledLeftThisTurn = undefined;

    // CR 104 (issue #3314) — a scenario starts a LIVE position, so the
    // game-over flag goes with the zones above. `debugSetupScenario` persists
    // exactly what comes back from here, and `assertGameNotOver`
    // (`convex/gre/activation.ts`) rejects every mutation while the flag
    // stands: a
    // scenario loaded into a finished game would otherwise place the board the
    // spec names on top of a dead game — the panel shows a normal board and a
    // normal phase banner, and the first click dies with "Game is over".
    //
    // A solo game reaches that state on its own the moment both libraries run
    // out (CR 104.3c), which is exactly the position a scenario is loaded to
    // rescue. `libraryCount` fixes the CAUSE of that draw but cannot revive the
    // game, because the flag survives the rebuild — the two are independent,
    // and only this line makes the reset total.
    //
    // The inverse `specFromState` reports `gameOver` as DROPPED rather than
    // lowering it into the spec; clearing it here is what makes that note true
    // in both directions — a finished game is neither captured nor carried.
    state.gameOver = undefined;

    // Helper to create an instance from a card name
    function makeInstance(
        cardName: string,
        controllerId: string,
        zone: "hand" | "battlefield" | "library" | "graveyard" | "exile",
        opts?: { tapped?: boolean }
    ) {
        const def = getCardByName(cardName);
        return {
            id: allocInstanceId(state),
            card: { id: def.id },
            types: def.types,
            subtypes: def.subtypes ?? [],
            power: def.power,
            toughness: def.toughness,
            staticAbilities: def.staticAbilities ?? [],
            controllerId,
            ownerId: controllerId,
            zone,
            isTapped: opts?.tapped ?? false,
            isSummoningSick: false,
        };
    }

    // Base lands seeded by `landCount`/`libraryCount` match the COLORS of
    // the cards placed in the scenario (CR 202.2): a mono-red board seeds
    // Mountains, a UW board alternates Islands and Plains — so the placed
    // cards are actually castable. A colourless/empty board falls back to
    // Plains (the historical behaviour).
    const colorsPresent = new Set<Color>();
    for (const entry of spec.cards) {
        if (entry.token) {
            // A token has no printed mana cost; its colors are declared on the
            // spec (CR 110.5). An unknown token key contributes nothing — the
            // placement loop below is what surfaces the error.
            for (const c of findTokenSpec(entry.name)?.colors ?? []) {
                colorsPresent.add(c);
            }
            continue;
        }
        const def = getCardByName(entry.name);
        for (const c of getCardColors(def)) colorsPresent.add(c);
    }
    const basicLandCycle = basicLandsForColors(colorsPresent);
    const basicLandAt = (i: number) =>
        basicLandCycle[i % basicLandCycle.length];

    // Fill libraries with filler basics if requested — BEFORE the placement
    // loop, so a scenario can do both. This used to run AFTER placement and
    // reset `player.library` outright, which silently DELETED every card the
    // spec had placed in the library zone (the Debug panel's save form offers
    // both fields, so the combination is the common case, not an exotic one).
    // Seeding first makes `libraryCount` mean "this many filler basics", and
    // an entry's `position` then indexes into the already-filled pile.
    if (spec.libraryCount !== undefined) {
        p1.library = [];
        p2.library = [];
        for (let i = 0; i < spec.libraryCount; i++) {
            const name = basicLandAt(i);
            p1.library.push(makeInstance(name, p1.id, "library"));
            p2.library.push(makeInstance(name, p2.id, "library"));
        }
    }

    // CR 400.2 (issue #3452, PRD #3397) — cards a seat HOLDS whose identity is
    // unknown. The hand is a hidden zone, so a position captured from one
    // seat's view (`lowerDecision`) counts the other's hand and cannot name
    // it; seeding the count back is what keeps the rebuilt hand the SIZE it
    // was in play, which the evaluation's `hand` term reads.
    //
    // These are NOT `libraryCount`'s filler basics. A basic is castable and
    // carries its own `cardValue`, so it would substitute a plausible number
    // for the captured one; an opaque placeholder resolves to no
    // `CardDefinition` (`getLegalActions` returns nothing for one — `rules.ts`
    // checks the sentinel id explicitly), so it can never be cast, targeted or
    // revealed, and it values exactly as the same shape did in the search that
    // produced the decision.
    //
    // BEFORE the placement loop, the `libraryCount` ordering: seeding after it
    // would either delete what the spec placed by name or push a placeholder
    // to the end of "me"'s hand, where `markLastDrawn` (CR 121.1) reads the
    // last entry. So a seat may hold both named and hidden cards, and the
    // named ones are the later entries.
    if (spec.hiddenHand) {
        seedHiddenHand(p1, spec.hiddenHand.me);
        seedHiddenHand(p2, spec.hiddenHand.opp);
    }

    function seedHiddenHand(player: PlayerState, count: number | undefined) {
        for (let i = 0; i < (count ?? 0); i++) {
            player.hand.push({
                id: allocInstanceId(state),
                card: { id: PLACEHOLDER_CARD_ID },
                types: [],
                subtypes: [],
                staticAbilities: [],
                controllerId: player.id,
                ownerId: player.id,
                zone: "hand",
                isTapped: false,
            });
        }
    }

    // Auras/Equipment whose `attachedTo` host must be resolved by name once
    // every card has been placed (the host may appear later in `spec.cards`).
    const pendingAttach: {
        aura: CardInstanceState;
        hostName: string;
        ownerId: string;
    }[] = [];

    // A scenario PLACES a board, it never plays one out: token creation emits
    // a `TOKENS_CREATED` event (CR 111, issue #1345) that a "whenever you
    // create one or more tokens" trigger would pick up on a freshly-loaded
    // board — and, since issue #2300, a per-token `PERMANENT_ENTERED`
    // (CR 603.6a) that every ETB trigger in the catalogue would pick up too.
    // Snapshot the queue and restore it after placement, which discards BOTH:
    // `emitPermanentEntered` appends by REBINDING `state.pendingEvents` to a
    // fresh array rather than mutating the one captured here, so restoring the
    // captured reference genuinely drops every event placement queued. Nothing
    // drains the queue in between (no `processPendingActionTriggers` call on
    // this path), so no trigger can reach the stack before the restore.
    // Non-token placement below is a raw `battlefield.push` that emits nothing,
    // so the span only ever has token entries to swallow.
    const basePendingEvents = state.pendingEvents;

    // Place requested cards
    for (const entry of spec.cards) {
        const player = entry.owner === "me" ? p1 : p2;
        const zone = entry.zone ?? "battlefield";
        const count = entry.count ?? 1;
        // CR 111 / 707.2 — a TOKEN entry names a shape in the token catalogue,
        // not a card in the registry, and is created through the engine's own
        // token primitive (which synthesizes + registers its CardDefinition,
        // resolves art and applies `entersWith` counters).
        if (entry.token) {
            for (const token of placeScenarioTokens(state, entry, player)) {
                if (entry.attachedTo) {
                    pendingAttach.push({
                        aura: token,
                        hostName: entry.attachedTo,
                        ownerId: player.id,
                    });
                }
            }
            continue;
        }
        for (let i = 0; i < count; i++) {
            const instance = makeInstance(entry.name, player.id, zone, {
                tapped: entry.tapped,
            });
            // CR 602.5 (issue #3448) — applied BEFORE the zone dispatch on
            // purpose: the tally is not battlefield-only. The engine preserves
            // it on a card that LEAVES the battlefield and clears it on the way
            // back in (`resetBattlefieldTransientState`, CR 400.7 — what
            // re-enters is a new object), so a graveyard / exile entry can
            // carry one and lowering it must be lossless in every zone.
            const activations = resolveScenarioActivations(entry.activations);
            if (activations) {
                (instance as CardInstanceState).activationsThisTurn =
                    activations;
            }
            // CR 608.2 / 514.2 (issue #3453) — before the zone dispatch too,
            // and for a sharper reason than `activations` above: the tally
            // belongs to the ability's SOURCE, and a trigger whose source has
            // since died is exactly the shape that needs it (the source sits
            // in a graveyard while its tally still gates the next resolution
            // this turn).
            seedAbilityResolutions(
                state,
                instance.id,
                entry.abilityResolutions
            );
            if (zone === "hand") {
                player.hand.push(instance);
            } else if (zone === "library") {
                // Appended to the BOTTOM of the existing deck by default
                // (library index 0 = top, where `drawCard` reads), or spliced
                // at an explicit `position` (1 = top, -1 = bottom; negatives
                // count from the bottom) so a mill/tutor/fetch can find a
                // known target at a known depth. `libraryCount` (if set)
                // resets the library AFTER this loop, so a scenario seeding
                // a specific library card must leave `libraryCount` unset.
                const lib = player.library;
                if (entry.position !== undefined) {
                    const p = entry.position;
                    const idx =
                        p >= 0
                            ? Math.min(Math.max(p - 1, 0), lib.length)
                            : Math.max(lib.length + p + 1, 0);
                    lib.splice(idx, 0, instance as CardInstanceState);
                } else {
                    lib.push(instance as CardInstanceState);
                }
            } else if (zone === "graveyard") {
                player.graveyard.push(instance);
            } else if (zone === "exile") {
                player.exile.push(instance as CardInstanceState);
                // ADR 0026 slice 6 — face-down exile (impulse-draw): stamp
                // the card known to its controller only via the primitive
                // (reuses knownTo; opponents see a face-down card).
                if (entry.faceDownExile) {
                    // The spec knob is literally named `faceDownExile`, so it
                    // stages the CR 406.3 shape rather than the impulse idiom
                    // that shares the primitive (issue #2904) — a scenario
                    // asking for a face-down exile wants to SEE one.
                    exileFaceDownCard(
                        player,
                        instance.id,
                        "exile",
                        player.id,
                        "face-down-exile"
                    );
                }
                // #946 (CR 601.3 / 305.1-analog / 608.2g) — grant "me" a
                // this-turn play-from-exile permission so a Play (land) /
                // Cast (spell) affordance appears; the current turn stamps
                // the expiry so it lapses at cleanup. CR 305.9 (issue
                // #1689) — a cast permission alone does NOT authorize playing
                // a land (a land is never cast), so this stamps
                // `castableFromExileIncludesLand`
                // ONLY when the scenario explicitly asks for the LAND-
                // INCLUSIVE grant shape (Headliner Scarlett / Expressive
                // Iteration). Defaulting to cast-only (omitted) mirrors the
                // real-card default (`grantCastFromExile`'s `includesLand`
                // opts default false, Ice Cauldron / Robber of the Rich /
                // Ragavan) — and lets the Debug panel stage BOTH shapes,
                // including the cast-only-land dead-affordance case this
                // issue is about.
                if (entry.castableFromExile) {
                    const exiled = instance as CardInstanceState;
                    exiled.castableFromExileBy = player.id;
                    exiled.castableFromExileUntilTurn = state.turn;
                    if (entry.castableFromExileIncludesLand) {
                        exiled.castableFromExileIncludesLand = true;
                    }
                }
            } else {
                if (entry.damageMarked && entry.damageMarked > 0) {
                    (instance as CardInstanceState).damageMarked =
                        entry.damageMarked;
                }
                if (entry.faceDown) {
                    // issue #2904 — the scenario spec says "face down", not
                    // WHICH mechanic did it. `morph` (CR 702.37) is the only
                    // shipped keyword that makes a face-down permanent, so a
                    // staged one stands in for a morph; the producer is
                    // display-only (it picks the rendered face) and changes no
                    // rules read, so a mismatch with the staged card's own
                    // printed text costs nothing.
                    turnFaceDown(state, instance as CardInstanceState, "morph");
                }
                // Canonicalize the loyalty counter key and seed a
                // planeswalker's printed starting loyalty (CR 306.5b) — this
                // path bypasses the ETB loyalty seed in `gre/state.ts`, and
                // the editor's free-text counter type must fold onto the
                // engine's lowercase `loyalty` key to be treated as real
                // loyalty (see `resolveScenarioBattlefieldCounters`).
                // CR 121.6 / 614.1c (issue #1693) — a debug board PLACES a
                // permanent instead of entering it through an entry site, so
                // nothing would otherwise run the entry-counters replacement:
                // dropping a Clockwork Beast onto a scenario board gave a 0/4,
                // reproducing the very symptom the scenario exists to demo.
                // An explicit `entry.counters` still wins (the editor is
                // staging a specific board); the declared entry counters are
                // only the DEFAULT when the spec says nothing. No cast-time
                // values exist for a placed permanent (CR 107.3b).
                // A FACE-DOWN permanent is a 2/2 with no name, no text and no
                // abilities (CR 708.2), so the face-up card's entry counters
                // must NOT be defaulted onto it — that would stage a "2/2"
                // secretly holding seven +1/+0 counters.
                const battlefieldDef = getCardByName(entry.name);
                const resolvedCounters = resolveScenarioBattlefieldCounters(
                    entry.counters ??
                        (entry.faceDown
                            ? undefined
                            : // CR 702.44b (issue #2378) — a debug board PLACES
                              // a permanent; nothing was cast, so no mana was
                              // spent and the sunburst count defaults to 0. A
                              // scenario that wants charge counters on a
                              // Sunburst permanent states them in `counters`.
                              resolveEntersWithCounters(battlefieldDef, {
                                  manaSpentToCast: {},
                              })),
                    {
                        isPlaneswalker: isPlaneswalker(
                            instance as CardInstanceState
                        ),
                        printedLoyalty: battlefieldDef.loyalty,
                    }
                );
                if (resolvedCounters) {
                    (instance as CardInstanceState).counters = resolvedCounters;
                }
                if (entry.attackedLastTurn) {
                    (instance as CardInstanceState).attackedDuringLastTurn =
                        true;
                }
                // CR 106.4 / 603.3 / 502.1 (issue #3451) — the tap-state trio.
                applyTapState(instance as CardInstanceState, entry);
                // CR 302.6 / 400.7 — entered this turn: starts the
                // control-continuity clock so a manland animated the same turn
                // reads sick (#545). The `enteredOnTurn` stamp is the OTHER
                // half of that clock (issue #1824): `hasControlledSinceTurnStart`
                // reads it, NOT `isSummoningSick`, so staging a creature as
                // summoning-sick while leaving the stamp unwritten made it
                // read "controlled since the beginning of the turn" — the two
                // facts disagreeing on the same board. A scenario stages an
                // ALREADY-SET-UP board, so the non-sick default correctly
                // leaves `enteredOnTurn` unset (present since before the turn).
                if (entry.summoningSick) {
                    (instance as CardInstanceState).isSummoningSick = true;
                    (instance as CardInstanceState).enteredOnTurn = state.turn;
                }
                // CR 707.2 — make this permanent a copy of another card, so
                // the debug board can exercise the two-face copy preview
                // (Current = copied object, Original = printed identity).
                if (entry.copyOf) {
                    const sourceDef = getCardByName(entry.copyOf);
                    // applyCopy only reads the source's presented def id
                    // (`source.card.id`), so a minimal stand-in suffices.
                    const source = {
                        card: { id: sourceDef.id },
                    } as unknown as CardInstanceState;
                    applyCopy(state, instance as CardInstanceState, source);
                }
                // CR 303.4 / 701.3 — queue this Aura/Equipment for
                // attachment; the host is resolved by name after every card
                // is placed (it may be listed later in `spec.cards`).
                if (entry.attachedTo) {
                    pendingAttach.push({
                        aura: instance as CardInstanceState,
                        hostName: entry.attachedTo,
                        ownerId: player.id,
                    });
                }
                player.battlefield.push(instance);
            }
        }
    }

    state.pendingEvents = basePendingEvents;

    // Add lands (only if explicitly requested)
    const landCount = spec.landCount ?? 0;
    for (let i = 0; i < landCount; i++) {
        const name = basicLandAt(i);
        p1.battlefield.push(makeInstance(name, p1.id, "battlefield"));
        p2.battlefield.push(makeInstance(name, p2.id, "battlefield"));
    }

    // CR 303.4 / 701.3 — resolve queued Aura/Equipment attachments now that
    // every permanent is on the battlefield. The host is matched by card id
    // (derived from the given name), searching the aura owner's battlefield
    // first and the opponent's second; the first match wins.
    for (const { aura, hostName, ownerId } of pendingAttach) {
        // The host may be a TOKEN (enchant a Saproling): a token's placed
        // instance carries the content-derived definition id of its shape, so
        // the same by-def-id match works once the name is resolved through the
        // token catalogue instead of the card registry.
        const hostTokenSpec = findTokenSpec(hostName);
        const hostDefId = hostTokenSpec
            ? tokenDefinitionId(hostTokenSpec)
            : getCardByName(hostName).id;
        const owner = state.players.find((pl) => pl.id === ownerId);
        const opp = state.players.find((pl) => pl.id !== ownerId);
        const findHost = (pl: PlayerState | undefined) =>
            pl?.battlefield.find(
                (c) =>
                    c.id !== aura.id &&
                    (c.card as { id?: string }).id === hostDefId
            );
        const host = findHost(owner) ?? findHost(opp);
        if (host) aura.attachedTo = host.id;
    }

    // CR 702.139c / ADR 0064 (issue #1392) — directly declare a companion
    // into the requested slot. Mirrors `buildCompanionInstance`'s shape
    // (game init) exactly, since the scenario's synthetic board never
    // runs through `selectCompanion`/the sideboard.
    if (spec.companion) {
        const companionOwner = spec.companion.owner === "opp" ? p2 : p1;
        const def = getCardByName(spec.companion.name);
        companionOwner.companion = {
            instance: {
                id: allocInstanceId(state),
                card: { id: def.id },
                types: def.types,
                subtypes: def.subtypes ?? [],
                power: def.power,
                toughness: def.toughness,
                staticAbilities: def.staticAbilities ?? [],
                controllerId: companionOwner.id,
                ownerId: companionOwner.id,
                // CR 702.139 — nominal tag only; the companion slot is
                // not a real zone (mirrors `buildCompanionInstance`).
                zone: "exile" as const,
                isTapped: false,
            },
            used: spec.companion.used ?? false,
        };
    }

    // Mark "me"'s last hand card as drawn this turn (Jandor's Ring's
    // "discard the last card you drew this turn" cost). Cleared at the
    // next turn start by advanceTurn.
    if (spec.markLastDrawn && p1.hand.length > 0) {
        p1.lastDrawnCardId = p1.hand[p1.hand.length - 1].id;
        // CR 121.1 (issue #3240) — `lastDrawnCardId` and `drawnThisTurn` are
        // two readings of the same fact, and the reset above emptied the
        // second. Re-seed it with exactly the card just declared as drawn, so
        // "the last card you drew this turn" and "the number of cards you've
        // drawn this turn" cannot disagree on a scenario board.
        p1.drawnThisTurn = [p1.lastDrawnCardId];
    }

    // CR 611.2 — replay continuous keyword-grant / activated-grant static
    // effects across the freshly-built battlefield. The placement loop
    // bypasses `finalizeSpellResolution`'s entry hooks, so a Zombie Master
    // dropped via the scenario doesn't naturally reach its Zombies. One
    // pass per source is enough: each call walks every permanent and
    // pushes matching grants — order-independent because the predicate is
    // a function of subtype/id, not of timestamp.
    for (const player of state.players) {
        for (const source of player.battlefield) {
            beginApplyingStaticEffects(state, source);
        }
    }

    // The placement loop bypasses ETB triggers, so "as ~ enters, choose an
    // opponent" (Cursed Rack, The Rack — #292) never resolved. Auto-pick
    // the controller's opponent so the scenario exercises the stored choice
    // (2-player: a single opponent, so no ambiguity).
    for (const player of state.players) {
        for (const source of player.battlefield) {
            if (source.chosenPlayerId !== undefined) continue;
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : undefined;
            const choosesOpponent = def?.triggeredAbilities?.some((t) =>
                t.id.endsWith("-choose-opponent")
            );
            if (choosesOpponent) {
                source.chosenPlayerId = getOpponentId(
                    state,
                    source.controllerId
                );
            }
        }
    }

    // Set the turn number if requested (turn 1 skips the draw step).
    if (spec.turn !== undefined) {
        state.turn = spec.turn;
    }

    // CR 506.4/508.1 — `state.combat` holds attacker/blocker ids that point
    // at THIS turn's battlefield instances. The placement loop above clears
    // every zone and reassigns fresh instance ids (`allocInstanceId`), so any
    // `combat` inherited from the base state (e.g. loading a
    // `PRECOMBAT_MAIN` scenario onto a game that was mid-combat) references
    // ids that no longer exist on the rebuilt board. Clear it unconditionally
    // and only re-seed it below when the target phase needs it (issue #1432
    // review finding #3) — this fixes the shared builder, so it closes the
    // class for `debugSetupScenario` too, not just the blade loader.
    state.combat = undefined;

    // Set phase if requested
    if (spec.phase) {
        state.phase = spec.phase as Phase;
        if (spec.phase === "DECLARE_ATTACKERS") {
            state.combat = {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
        }
    }

    // CR 102.1 / 117.1 / 117.4 (issue #3454) — the turn holder, the priority
    // holder and the passes already banked. These decide WHICH decision the
    // rebuilt position poses, and before this field existed the rebuild could
    // only ever pose the active player's own turn: an instant-speed decision
    // taken during the opponent's turn (holding up removal, a combat trick,
    // declining to act under an attack) came back offering the sorcery-speed
    // moves the seat did not have (CR 307.1), while `pass` existed in both
    // lists — so the pick still resolved and nothing downstream noticed the
    // answer was to another question. The verdict quiz refused that whole
    // class outright rather than file it (PRD #3397).
    //
    // All three follow this builder's standing convention for an optional
    // field: ABSENT means unchanged, exactly as `phase` and `turn` above do.
    // So a spec written before #3454 keeps its meaning — it inherits the base
    // state's turn holder and gets a fresh priority round, which is what it
    // has always got. `specFromState` below always lowers all three
    // explicitly, so a CAPTURED position round-trips regardless.
    if (spec.activePlayer) {
        state.activePlayerId = spec.activePlayer === "me" ? p1.id : p2.id;
    }
    // Priority defaults to the active player — the start of a fresh round, the
    // pre-#3454 behaviour. `activePlayer: "opp"` with `priority: "me"` is the
    // shape a combat-trick verdict needs, and the caller states it.
    state.priorityPlayerId = spec.priority
        ? spec.priority === "me"
            ? p1.id
            : p2.id
        : state.activePlayerId;
    state.passCount = spec.passCount ?? 0;
    state.pendingCast = undefined;
    state.stack = [];

    // Pin the PRNG so the next random draw is deterministic (CR 705 /
    // ADR 0023) — e.g. force a Bottle of Suleiman coin flip to WIN/LOSE.
    if (spec.rngSeed !== undefined) {
        state.rngSeed = spec.rngSeed;
        state.rngCounter = 0;
    }

    // Seed poison counters (CR 122). A player reaching ten or more loses
    // the game (CR 704.5c) on the next SBA sweep.
    if (spec.poison) {
        if (spec.poison.me) p1.poisonCounters = spec.poison.me;
        if (spec.poison.opp) p2.poisonCounters = spec.poison.opp;
    }

    // Seed starting life totals (CR 119.1, issue #2147). Otherwise both
    // players keep the base state's default (20) regardless of what the
    // scenario is trying to pin — the class of bug this field exists to
    // close. `!== undefined` (not truthy, unlike poison/experience above):
    // 0 life is a real, if degenerate, position (a lethal-check scenario one
    // point past the line), not "absent".
    if (spec.life) {
        if (spec.life.me !== undefined) p1.life = spec.life.me;
        if (spec.life.opp !== undefined) p2.life = spec.life.opp;
    }

    // Seed experience counters (CR 122.1, issue #1969). No rule removes them
    // and no SBA reads them — they exist only for the cards that count them,
    // so a scenario seeds them to start at the scaling state under test.
    if (spec.experience) {
        if (spec.experience.me) p1.experienceCounters = spec.experience.me;
        if (spec.experience.opp) p2.experienceCounters = spec.experience.opp;
    }

    // Seed land drops already spent (CR 305.2 / 305.2a, issue #3446). Playing
    // a land is a special action (CR 116.2a) gated on this tally, so this is
    // the whole difference between a rebuilt main phase that still offers the
    // drop and the post-drop position the Bot actually decided in — the single
    // most common decision it makes (PRD #3397). Truthy-checked like poison /
    // experience above: 0 is what the clear already left.
    if (spec.landsPlayed) {
        if (spec.landsPlayed.me) p1.landsPlayedThisTurn = spec.landsPlayed.me;
        if (spec.landsPlayed.opp) {
            p2.landsPlayedThisTurn = spec.landsPlayed.opp;
        }
    }

    // Seed floating mana (CR 106.4 / 106.6, issue #3460, PRD #3397). Mana is
    // not bookkeeping: it decides what is castable RIGHT NOW, so this is the
    // difference between a rebuilt mid-turn position that can pay for the
    // spell under judgement and one that silently cannot.
    //
    // `> 0` per colour: the engine's own payment path clamps at zero
    // (`payManaCostForSpell` spends `min(pool, required)`) and an emptied pool
    // holds zeros, so a non-positive entry is never a state the engine
    // produced and never one the builder should place.
    const seedPool = (
        player: PlayerState,
        seat: "me" | "opp",
        pool: Record<string, number> | undefined
    ) => {
        if (!pool) return;
        for (const [color, amount] of Object.entries(pool)) {
            // CR 105.1 / 106.1b — a key outside the six mana types is mana no
            // payment path can ever spend (every one of them consults
            // `MANA_COLORS`), so seeding it would place a pool that reads as
            // five mana on a board that can spend none. THROWN rather than
            // dropped, the treatment an unresolvable card name already gets:
            // the tolerant load path drops it for a stored row, and a
            // hand-written spec (a blade entry, a backlog file, a
            // `debugSetupScenario` call) reaches here without passing through
            // it at all.
            if (!(MANA_COLORS as readonly string[]).includes(color)) {
                throw new Error(
                    `Scenario manaPool.${seat}: "${color}" is not a mana type the engine can spend (CR 105.1 — ${MANA_COLORS.join("/")}).`
                );
            }
            if (amount > 0) player.manaPool[color] = amount;
        }
    };
    seedPool(p1, "me", spec.manaPool?.me);
    seedPool(p2, "opp", spec.manaPool?.opp);

    // CR 106.6 — the restricted units, placed in the parallel pool the engine
    // enforces restrictions from. Riders are written only when true because
    // the engine types them `?: true` (an absent rider and a false one are the
    // same claim); a unit with no usable amount is skipped for the same reason
    // the fungible pool drops one.
    const seedRestricted = (
        player: PlayerState,
        seat: "me" | "opp",
        units: ScenarioRestrictedMana[] | undefined
    ) => {
        if (!units) return;
        const placed: RestrictedMana[] = [];
        for (const unit of units) {
            if (!(MANA_COLORS as readonly string[]).includes(unit.color)) {
                throw new Error(
                    `Scenario restrictedMana.${seat}: "${unit.color}" is not a mana type the engine can spend (CR 105.1 — ${MANA_COLORS.join("/")}).`
                );
            }
            if (unit.amount <= 0) continue;
            const next: RestrictedMana = {
                color: unit.color,
                amount: unit.amount,
            };
            if (unit.restriction !== undefined) {
                next.restriction = unit.restriction;
            }
            if (unit.cantBeCounteredRider) next.cantBeCounteredRider = true;
            if (unit.hasteRider) next.hasteRider = true;
            placed.push(next);
        }
        if (placed.length > 0) player.restrictedMana = placed;
    };
    seedRestricted(p1, "me", spec.restrictedMana?.me);
    seedRestricted(p2, "opp", spec.restrictedMana?.opp);

    // Seed what has already been CAST (issue #3449, PRD #3397). Three tallies
    // a rebuilt position otherwise opens at zero:
    //
    //  - the per-seat per-turn count (CR 601.2i), what a "whenever you cast
    //    your second spell each turn" trigger reads — Ledger Shredder, whose
    //    effect is the CR 701.50 connive keyword;
    //  - the per-seat LIFETIME count, never reset, which gates a COST and
    //    therefore legality (CR 118.9): Once Upon a Time is free only while
    //    the caster's tally is 0, so a position captured after the seat's
    //    first spell rebuilt as a FREE cast it never had;
    //  - Storm's game-level count (CR 702.40a), which decides how many copies
    //    every storm spell makes — judged at 0, every storm decision in the
    //    corpus was a different decision.
    //
    // `!== undefined` (like `life`, unlike poison/experience): an explicit 0 is
    // a real, load-bearing claim here — "this seat has cast nothing yet" is
    // exactly the state Once Upon a Time's free cast needs, and on the live
    // game `debugSetupScenario` builds onto it differs from omitting the field.
    if (spec.spellsCastThisTurn) {
        if (spec.spellsCastThisTurn.me !== undefined) {
            p1.spellsCastThisTurn = spec.spellsCastThisTurn.me;
        }
        if (spec.spellsCastThisTurn.opp !== undefined) {
            p2.spellsCastThisTurn = spec.spellsCastThisTurn.opp;
        }
    }
    if (spec.spellsCastThisGame) {
        if (spec.spellsCastThisGame.me !== undefined) {
            p1.spellsCastThisGame = spec.spellsCastThisGame.me;
        }
        if (spec.spellsCastThisGame.opp !== undefined) {
            p2.spellsCastThisGame = spec.spellsCastThisGame.opp;
        }
    }
    if (spec.stormCount !== undefined) {
        state.spellsCastThisTurn = spec.stormCount;
    }

    // Seed what has already HAPPENED this turn (issue #3453, PRD #3397) — the
    // retrospective tallies a card still reads after the fact: damage taken
    // (CR 120.3a, Simulacrum), the artifact-sourced share of it (Reverse
    // Polarity), life gained (CR 119.3 — the intervening-if of Crested
    // Sunmare / Ocelot Pride, CR 603.4), creatures died (CR 700.4, Scavenging
    // Ghoul) and whether anyone attacked (CR 508.1a, Keldon Twilight).
    //
    // Written in the engine's own shape: a per-seat pair becomes a
    // `playerId → amount` record with the zero entries omitted, which is what
    // the engine's own `?? 0` readers treat as "none", and an absent tally is
    // left cleared rather than inherited (the clear at the top of this
    // function).
    const seedSeatTally = (
        pair: { me?: number; opp?: number } | undefined,
        assign: (tally: Record<string, number> | undefined) => void
    ) => {
        if (!pair) return;
        const tally: Record<string, number> = {};
        // `> 0` rather than truthy: a negative from a hand-written spec is not
        // a tally any engine reader could have produced, and the validator
        // carries no `min` (only the admin form does).
        if (pair.me && pair.me > 0) tally[p1.id] = pair.me;
        if (pair.opp && pair.opp > 0) tally[p2.id] = pair.opp;
        assign(Object.keys(tally).length > 0 ? tally : undefined);
    };
    seedSeatTally(spec.damageDealtToPlayerThisTurn, (t) => {
        state.damageDealtToPlayerThisTurn = t;
    });
    seedSeatTally(spec.artifactDamageToPlayerThisTurn, (t) => {
        state.artifactDamageToPlayerThisTurn = t;
    });
    seedSeatTally(spec.lifeGainedThisTurn, (t) => {
        state.lifeGainedThisTurn = t;
    });
    if (spec.deathsThisTurn !== undefined) {
        state.deathsThisTurn =
            spec.deathsThisTurn > 0 ? spec.deathsThisTurn : undefined;
    }
    if (spec.creatureAttackedThisTurn !== undefined) {
        state.creatureAttackedThisTurn = spec.creatureAttackedThisTurn
            ? true
            : undefined;
    }

    // Seed the per-seat turn history (issue #3450, PRD #3397).
    //
    //  - Arboria's qualifying-action flags (CR 508.1c). The LAST-turn one
    //    gates attack legality, so a rebuild that opens at "no action" —
    //    or, without the clear above, at the loaded game's value — enumerates
    //    a different set of attacks than the Bot was choosing between.
    //  - `turnsTaken` (CR 500.1, extra turns CR 500.7): the seat's OWN turn
    //    count, roughly half of `turn` in normal play — `advanceTurn` bumps
    //    it only for the new active player.
    //  - Revolt, an ability word (CR 207.2c): a permanent this seat
    //    controlled left the battlefield this turn. Gates a cost and a mode.
    //
    // The two flag pairs and Revolt are truthy-checked like `landsPlayed`:
    // false is exactly what the clear above already left, so an absent field
    // round-trips to the same position. `turnsTaken` is NOT cleared (it is a
    // lifetime count, like `spellsCastThisGame`), so it takes the `!==
    // undefined` treatment `life` does — an explicit value must be able to
    // overwrite the base state's own.
    if (spec.qualifyingActionThisTurn) {
        if (spec.qualifyingActionThisTurn.me) {
            p1.qualifyingActionThisTurn = true;
        }
        if (spec.qualifyingActionThisTurn.opp) {
            p2.qualifyingActionThisTurn = true;
        }
    }
    if (spec.qualifyingActionLastTurn) {
        if (spec.qualifyingActionLastTurn.me) {
            p1.qualifyingActionLastTurn = true;
        }
        if (spec.qualifyingActionLastTurn.opp) {
            p2.qualifyingActionLastTurn = true;
        }
    }
    if (spec.revolt) {
        if (spec.revolt.me) p1.permanentYouControlledLeftThisTurn = true;
        if (spec.revolt.opp) p2.permanentYouControlledLeftThisTurn = true;
    }
    if (spec.turnsTaken) {
        if (spec.turnsTaken.me !== undefined) {
            p1.turnsTaken = spec.turnsTaken.me;
        }
        if (spec.turnsTaken.opp !== undefined) {
            p2.turnsTaken = spec.turnsTaken.opp;
        }
    }

    // CR 113.6c (issue #3278) — materialise off-battlefield characteristics on
    // everything the placement loop above put in a hidden zone, LAST, so it
    // sees the final contents of every zone (library seeding, face-down exile
    // and the `libraryCount` reset all run above it).
    //
    // The builder has to do this ITSELF rather than leave it to the next
    // state-based-action sweep: `debugSetupScenario` (`convex/game.ts`)
    // persists exactly what comes back from here, so a Grist placed in a
    // graveyard would sit in the SAVED state as a bare Planeswalker card until
    // some later action happened to run the sweep — and the first thing a
    // scenario is loaded to do is a read (Animate Dead's graveyard-target
    // legality), which would then miss it. `makeInstance` above aliases
    // `types` straight to the shared `CardDefinition.types` array; the sweep
    // ASSIGNS fresh arrays, so it cannot corrupt the registry.
    // CR 508.1 / 509.1 (issue #3458) — a combat that has already been
    // declared, seeded LAST so the turn holder (`spec.activePlayer`) and every
    // permanent it names are final.
    seedDeclaredCombat(state, spec);

    refreshOffBattlefieldCharacteristics(state);

    return state;
}

/** The definition id a combat reference resolves to — a token shape's
 *  content-derived id when the name is a token-catalogue key, the card's
 *  otherwise. The same two-step `attachedTo`'s host resolution uses, so one
 *  spelling of a name means one thing everywhere in the spec. */
function combatDefId(name: string): string {
    const tokenSpec = findTokenSpec(name);
    return tokenSpec ? tokenDefinitionId(tokenSpec) : getCardByName(name).id;
}

/**
 * The permanents `names` names, one DISTINCT instance per entry, searched in
 * the given battlefields in order (issue #3458).
 *
 * A repeated name therefore names a second instance — which is the ordinary
 * case in combat (two Savannah Lions attacking) and the reason a name list,
 * rather than a name set, is the shape. A name with no unconsumed match is a
 * THROW, never a silently shorter list: a rebuild missing an attacker is a
 * different position under the same label, and the verdict quiz would report
 * it as an unexplained `different-decision` far from the cause.
 */
function resolveCombatants(
    battlefields: CardInstanceState[][],
    names: string[],
    role: string
): CardInstanceState[] {
    const taken = new Set<string>();
    return names.map((name) => {
        const defId = combatDefId(name);
        for (const battlefield of battlefields) {
            const found = battlefield.find(
                (card) =>
                    !taken.has(card.id) &&
                    (card.card as { id?: string }).id === defId
            );
            if (found) {
                taken.add(found.id);
                return found;
            }
        }
        throw new Error(
            `buildStateFromScenario: combat names "${name}" as ${role}, but no such untaken permanent is on the battlefield it must be on.`
        );
    });
}

/**
 * CR 508.1 / 509.1 (issue #3458, PRD #3397) — seed a combat that has already
 * been DECLARED, the position class `phase: "DECLARE_ATTACKERS"` alone could
 * never express: it seeds an EMPTY, unconfirmed combat object, so every
 * decision taken after attackers were declared rebuilt as an undeclared attack
 * step — offering `attack:` moves the seat no longer had and dropping the block
 * it owed.
 *
 * SEEDED, not replayed. The blade suite's `declare-attackers` setup step walks
 * a PRE-attack board forward through the engine's own move application
 * (`combatSetup.ts`, ADR 0070 §4), which is the right shape there: the board it
 * starts from has not attacked yet. This one starts from a CAPTURED board that
 * already carries every consequence of the declaration — the CR 508.1f taps,
 * the counters its triggers put — so re-running the move would apply them a
 * second time and rebuild a position that never existed. What is borrowed
 * instead is the engine's combat PRIMITIVES: `markAttacking` (never the
 * `attackerIds`/`isAttacking` pair by hand — issue #1195's half-attacking
 * permanent), `recordAttackerDeclared`, `markDeclaredBlockers` and
 * `recordBlockedAttackers`.
 *
 * Runs after the turn holder is final (`spec.activePlayer`): attackers are
 * matched on the ACTIVE player's battlefield (CR 508.1a) and blockers on the
 * defending player's (CR 509.1a), so neither needs an owner in the spec.
 *
 * COHERENCE is the caller's job, as it already is for `phase` and `passCount`:
 * a spec may name a tapped attacker or a combat at `PRECOMBAT_MAIN`, and the
 * builder places what is written rather than guessing what a hand-authored
 * position was meant to mean. `specFromState` only ever lowers a combat a live
 * game reached.
 */
function seedDeclaredCombat(state: GameState, spec: ScenarioSpec): void {
    const combat = spec.combat;
    if (!combat) return;
    const active = state.players.find((p) => p.id === state.activePlayerId);
    const defending = state.players.find((p) => p.id !== state.activePlayerId);
    if (!active || !defending) return;

    const attackers = resolveCombatants(
        [active.battlefield],
        combat.attackers ?? [],
        "an attacker"
    );
    const blockerEntries = combat.blockers ?? [];
    // PRESENCE, not content: an empty-but-present combat object is the OPEN
    // declare-attackers step, a real position `specFromState` lowers as itself
    // (`attackers: []`, `confirmed: false`). Reading content instead would
    // rebuild it as no combat at all.
    const declared =
        combat.attackers !== undefined ||
        combat.blockers !== undefined ||
        combat.confirmed !== undefined ||
        combat.blockersConfirmed !== undefined;

    if (declared) {
        // The phase branch above seeds this for `DECLARE_ATTACKERS` only, and
        // a declared combat outlives that step (CR 508.1k) — so the object is
        // created here for whatever phase the spec names.
        state.combat = state.combat ?? {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        for (const attacker of attackers) markAttacking(state, attacker);
        state.combat.confirmed = combat.confirmed ?? false;

        const blockers = resolveCombatants(
            [defending.battlefield],
            blockerEntries.map((entry) => entry.blocker),
            "a blocker"
        );
        blockerEntries.forEach((entry, index) => {
            const blocker = blockers[index];
            state.combat!.blockerAssignments[blocker.id] = entry.blocking.map(
                (attackerIndex) => {
                    const attacker = attackers[attackerIndex];
                    if (!attacker) {
                        throw new Error(
                            `buildStateFromScenario: blocker "${entry.blocker}" blocks attacker #${attackerIndex}, which the combat's ${attackers.length} attacker(s) do not include.`
                        );
                    }
                    return attacker.id;
                }
            );
        });
        // CR 509.1g — `isBlocking`/`hasBlockedThisTurn` for every assignment,
        // through the one function allowed to write them.
        markDeclaredBlockers(state);
        // CR 509.1a/509.1c — the half of `combatSetup.ts`'s "every way this can
        // fail to find purchase THROWS" that a seeded declaration CAN still
        // check: the count-aware restrictions and the battlefield-wide blocker
        // cap, read off an already-declared state. Per-blocker EVASION is
        // deliberately not re-run (CR 509.1b): a legal live block whose
        // flying/reach grant the spec could not carry would be rejected here
        // on a board whose residue is already reported, and the rebuild would
        // throw on a position that really happened.
        const legalBlocks = validateDeclaredBlockers(state);
        if (!legalBlocks.ok) {
            throw new Error(
                `buildStateFromScenario: the declared blocks are illegal — ${legalBlocks.reason}`
            );
        }
        state.combat.blockersConfirmed = combat.blockersConfirmed ?? false;
        if (state.combat.blockersConfirmed) {
            // CR 509.1h — an attacker stays BLOCKED even once every blocker
            // has left combat, so the record is taken at confirmation rather
            // than re-derived from the live assignments later.
            recordBlockedAttackers(state);
        }
    }

    // CR 506.4 / 508.4 — the per-turn record, applied INDEPENDENTLY of the
    // declaration above and therefore naming every creature that carries it,
    // current attackers included. The two are not derivable from each other: a
    // creature removed from combat keeps the flag with no declaration left
    // (Erg Raiders, Whirling Dervish), and a creature PUT onto the battlefield
    // attacking is "attacking" but, per CR 508.4, "for the purposes of trigger
    // events and effects, they never `attacked`" — so it is in `attackerIds`
    // and must NOT gain the flag. Searched on BOTH battlefields, unlike the
    // declaration: the flag travels with the creature through a control
    // change, and it names a FACT about the card rather than a role in this
    // combat.
    // PER SEAT (CR 506.4): both players can control a creature of the same name
    // that attacked this turn, so each seat's list is resolved against that
    // seat's own battlefield — `"me"` is `players[0]`, the spec's standing
    // convention. A flat list across both would bind the first copy it found
    // and hand the record to the wrong side.
    const seats = [
        { player: state.players[0], seat: "me" as const },
        { player: state.players[1], seat: "opp" as const },
    ];
    for (const { player, seat } of seats) {
        for (const card of resolveCombatants(
            [player.battlefield],
            combat.attackedThisTurn?.[seat] ?? [],
            `${seat}'s, having attacked this turn`
        )) {
            recordAttackerDeclared(state, card);
        }
        for (const card of resolveCombatants(
            [player.battlefield],
            combat.blockedThisTurn?.[seat] ?? [],
            `${seat}'s, having blocked this turn`
        )) {
            card.hasBlockedThisTurn = true;
        }
    }
}

// ---- specFromState — lower a live position into a ScenarioSpec (#2148) ----
//
// The inverse of `buildStateFromScenario` above, kept in the SAME file so the
// two can't drift apart. `dropped[]` is the feature, not decoration: a
// `ScenarioSpec` can express only what the table in `buildStateFromScenario`
// consumes (battlefield/hand/graveyard/exile placement, tapped, counters,
// attachments, damage, phase, turn, the turn holder / priority holder / pass
// count, poison/life/experience, lands already played, the spells-cast
// tallies and the storm count, the retrospective per-turn tallies — damage
// taken, life gained, deaths, whether anyone attacked, each ability's
// resolutions — one companion slot). Everything else a live
// `GameState` can hold — the stack, a mid-flight payment, combat beyond an empty DECLARE_ATTACKERS seed,
// delayed triggers, a per-card continuous effect the spec has no field for —
// is reported here rather than silently discarded, so a caller never mistakes
// a lossy capture for a complete one.

/** Options for {@link specFromState}. */
export type SpecFromStateOptions = {
    /** Which live `state.players[].id` becomes `"me"` in the lowered spec.
     *  `ScenarioSpec`'s `"me"` is ALWAYS `players[0]` by convention
     *  (`gre/ai/blade/types.ts`), which has no general relationship to a live
     *  game's seat order — get this wrong and every card in the capture comes
     *  out mirrored to the wrong side. */
    mySeatId: string;
};

export type SpecFromStateResult = {
    spec: ScenarioSpec;
    /** Every fact about `state` this lowering could NOT express, in
     *  human-readable form. Empty only for a genuinely quiescent position:
     *  nothing on the stack, no pending decision, combat not yet declared,
     *  and no per-card continuous-effect residue. */
    dropped: string[];
};

/** Every distinct token shape, reverse-indexed by its synthesized definition
 *  id — the inverse of `findTokenSpec` (key -> spec). Memoized like
 *  `listTokenCatalogue` itself: the pool is static for the life of the
 *  process. */
let tokenKeyByDefId: Map<string, string> | undefined;
function tokenKeyForDefId(defId: string): string | undefined {
    if (!tokenKeyByDefId) {
        tokenKeyByDefId = new Map(
            listTokenCatalogue().map((entry) => [entry.defId, entry.key])
        );
    }
    return tokenKeyByDefId.get(defId);
}

/** Resolve a definition id to the NAME a `ScenarioCard.name` would carry —
 *  the token-catalogue key for a token, the printed card name otherwise.
 *  Throws like `getCardByName` does on an unresolvable id: a live definition
 *  this can't name back is a bug in the lowering, not a "can't express this"
 *  case (that's what `dropped` is for). */
function displayNameForDefId(defId: string, isToken: boolean): string {
    if (isToken) {
        const key = tokenKeyForDefId(defId);
        if (!key) {
            throw new Error(
                `specFromState: token definition "${defId}" has no token-catalogue entry.`
            );
        }
        return key;
    }
    const def = tryGetDefinition(defId);
    if (!def) {
        throw new Error(
            `specFromState: definition "${defId}" is not in the runtime registry.`
        );
    }
    return def.name;
}

/** The identity `card` currently PRESENTS as — post-copy, post-face-down
 *  sentinel — i.e. what `card.card.id` (or its token defId) names right now.
 *  This is what an `attachedTo` reference must resolve to: the builder
 *  matches a host by its PRESENTED def id (CR 707.2 — a copy's copiable
 *  identity, not its printed name), never the pre-copy identity. */
function presentedName(card: CardInstanceState): string {
    const defId = (card.card as { id?: string }).id ?? "";
    return displayNameForDefId(defId, card.isToken === true);
}

/** The name (and `copyOf`, when it's a legitimately-lowerable copy) to place
 *  THIS card under in the spec — the identity `buildStateFromScenario` would
 *  CREATE it from, before any `faceDown`/`copyOf` knob is applied. */
function entryIdentity(card: CardInstanceState): {
    name: string;
    copyOf?: string;
} {
    if (card.faceDown && card.faceDownOf) {
        // `faceDownOf` is the pre-face-down identity `turnFaceDown` swapped
        // out; `card.card.id` itself is just the FACE_DOWN sentinel. A token
        // stays a token underneath a face-down mask (`isToken` is permanent
        // on the instance), so its faceDownOf is still a TOKEN defId.
        return {
            name: displayNameForDefId(card.faceDownOf, card.isToken === true),
        };
    }
    if (card.copiedFrom) {
        if (card.isToken) {
            // Unsupported combination — `lowerCard` reports it and falls
            // back to the token's own original (pre-copy) shape.
            return { name: displayNameForDefId(card.copiedFrom, true) };
        }
        return {
            name: displayNameForDefId(card.copiedFrom, false),
            copyOf: presentedName(card),
        };
    }
    return { name: presentedName(card) };
}

/** Order-sensitive twin of {@link sameStringSet} — for id lists whose ORDER is
 *  the claim (issue #3458: the builder binds combat names positionally). */
function sameStringList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameStringSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

/** Flags a permanent whose live power/toughness/types/subtypes have DRIFTED
 *  from its own presented definition — an animation, a layer-7 set/pump
 *  effect, or a layer-4 type add the spec has no field for.
 *  `buildStateFromScenario` always rebuilds these four characteristics fresh
 *  from the definition (`makeInstance` / `rebuildCopiableValuesAndReplayOverlays`),
 *  so an un-flagged drift here would silently vanish on load.
 *
 *  Deliberately does NOT compare `staticAbilities`: a lord/anthem-style
 *  keyword grant sourced from another STILL-PRESENT battlefield permanent is
 *  rebuild behaviour, not spec-keyed data — `buildStateFromScenario` re-runs
 *  `beginApplyingStaticEffects` across the whole battlefield on every load
 *  (same as the original build did), so it re-derives that exact grant for
 *  free as long as the granting source and the attachment/board state that
 *  feeds it are captured (which they always are). See `reportCardResidue`
 *  for the ONE keyword-grant shape that ISN'T re-derived: a temporary
 *  (`duration`-scoped) grant from a one-shot resolved effect. */
function reportCharacteristicDrift(
    card: CardInstanceState,
    label: string,
    dropped: string[]
): void {
    const defId = (card.card as { id?: string }).id ?? "";
    const def = tryGetDefinition(defId);
    if (!def) return; // unresolvable id already threw upstream of this call
    const drifted: string[] = [];
    if (card.power !== def.power) drifted.push("power");
    if (card.toughness !== def.toughness) drifted.push("toughness");
    if (!sameStringSet(card.types, def.types)) drifted.push("types");
    if (!sameStringSet(card.subtypes, def.subtypes ?? [])) {
        drifted.push("subtypes");
    }
    if (drifted.length > 0) {
        dropped.push(
            `${label}: ${drifted.join("/")} differ from the printed baseline (an animation or a layer 4/7 effect) — the rebuilt permanent shows only the printed values`
        );
    }
}

/** Fields `specFromState` reads and lowers explicitly, PLUS fields that are
 *  rebuild BEHAVIOUR rather than spec-keyed data (`enteredOnTurn` is derived
 *  from `isSummoningSick`; `chosenPlayerId` is the ETB "choose an opponent"
 *  auto-pick `buildStateFromScenario` re-runs on every load — see its own
 *  comments), PLUS the wire-projection-only additions present when the
 *  caller bridges a PROJECTED client state (`FullGameState`) into this
 *  function instead of a raw engine `GameState` — never real engine state,
 *  so never "dropped". Anything else present on a card instance is live
 *  continuous-effect residue the spec has no field for. */
export const CARD_STATE_ALLOWLIST = new Set<string>([
    // Structural fields `buildStateFromScenario` itself always sets.
    "id",
    "card",
    "controllerId",
    "ownerId",
    "zone",
    "types",
    "subtypes",
    "power",
    "toughness",
    "staticAbilities",
    // Lowered explicitly by `lowerCard` below.
    "isTapped",
    "isToken",
    "isSummoningSick",
    "counters",
    // CR 602.5 (issue #3448) — lowered by `lowerCard` in EVERY zone, not just
    // on the battlefield: the engine keeps the tally on a card that has left
    // play (it is cleared on re-entry, CR 400.7), so a fetchland in the
    // graveyard legitimately carries the count it spent.
    "activationsThisTurn",
    "damageMarked",
    "attachedTo",
    "attackedDuringLastTurn",
    // CR 106.4 / 603.3 / 502.1 (issue #3451) — the tap-state trio, lowered by
    // `lowerCard` into the `ScenarioCard` keys of the same name and re-stamped
    // by `applyTapState`.
    "manaCommitted",
    "tapTriggerCommitted",
    "startedTurnUntapped",
    // CR 106.4 / 605.1a / 605.4 / 122.6 / 701.43b (issue #3451) — the tap's
    // UNDO BOOKKEEPING. Six records, one class: each is written when a source
    // is tapped for mana and consumed by exactly one thing, the reversal of
    // that tap (`untapSourceFromPayment` and the two inline copies of it in
    // `game.ts` — `refundChosenManaOutput`, `refundTapBonusMana`,
    // `restoreManaPaidOnUntap`, `restoreLifePaidOnUntap`, `restoreExertOnUntap`,
    // and the `manaCounterRemoval` counter restore).
    //
    // They are rebuild bookkeeping, not spec-keyed data, and the argument is
    // the untap path's own: each is written once by a tap and read once by that
    // tap's reversal, and a REBUILT position has no tap to reverse. What the
    // reversal gives back is a resource this position never took — the produced
    // mana above all. (Issue #3451 stated that second half as "the mana pool is
    // the one thing `specFromState` cannot lower"; issue #3460 lowered it, and
    // the conclusion does not move — a captured pool is placed as captured, and
    // the ABSENCE of an undo ledger beside it is what keeps a rebuilt untap from
    // handing back mana no tap in this position ever produced.)
    //
    // Lowering them would therefore make the rebuilt undo strictly WORSE than
    // dropping them, and asymmetrically so: the two pool subtractions clamp at
    // zero (`Math.max(0, …)`), while the life restore, the charge-counter
    // restore and the cost-mana refund are unclamped additions — a rebuilt
    // untap-toggle would MINT life, counters and mana. Absent, the same toggle
    // is a plain untap.
    //
    // What genuinely must survive is not the amount but the IRREVERSIBILITY,
    // and that is `manaCommitted` / `tapTriggerCommitted` three lines up, which
    // ARE lowered. (`chosenMana` has one non-undo reader — `getManaColor`'s
    // colour preference inside `commitLandsForCost`, whose four call sites each
    // filter on `isTapped && !manaCommitted`, i.e. they only ever inspect
    // sources whose mana is still floating in the pool a rebuild does not
    // have.)
    //
    // `exertedThisTap` closes the UNDO half of the exert only: its behavioural
    // half, `skipNextUntap` (CR 701.43a — the permanent that does not untap
    // next untap step), is neither lowered nor allowlisted and keeps its own
    // `dropped[]` line. That is a separate hole, not one this row hides.
    //
    // All nine rows here — the trio above included — describe BATTLEFIELD
    // facts, and all nine are cleared on the way back IN
    // (`resetBattlefieldTransientState`, CR 400.7) rather than on the way out,
    // so a card that has since left play can still carry one. The rows are
    // deliberately global anyway: off the battlefield every one of them is dead
    // state — the untap-toggle reads a battlefield source, `commitLandsForCost`
    // walks the battlefield, and an "if ~ started the turn untapped" upkeep
    // trigger needs its source on the battlefield to fire at all — so lowering
    // them in a graveyard or a hand would stage noise, not fidelity. This is
    // the one place the trio differs from `activationsThisTurn` three rows up,
    // which IS lowered in every zone precisely because a departed card's tally
    // is still read (CR 602.5).
    "chosenMana",
    "tapBonusMana",
    "manaPaidThisTap",
    "lifePaidThisTap",
    "exertedThisTap",
    "manaCounterRemoval",
    // CR 508.1k / 509.1g / 506.4 (issue #3458) — the four combat flags.
    // `isAttacking` / `isBlocking` are rebuild BEHAVIOUR: the builder seeds
    // them through `markAttacking` / `markDeclaredBlockers` from
    // `spec.combat`'s own declaration, never from a card entry.
    // `hasAttackedThisTurn` / `hasBlockedThisTurn` are spec-keyed data, lowered
    // by `lowerCombat` into `combat.attackedThisTurn` / `blockedThisTurn`
    // (they outlive the combat object, so they are named rather than derived).
    "isAttacking",
    "isBlocking",
    "hasAttackedThisTurn",
    "hasBlockedThisTurn",
    "faceDown",
    // Rebuild BEHAVIOUR: `buildStateFromScenario` restamps it by calling
    // `turnFaceDown` for a `faceDown` entry (issue #2904), so it is never
    // spec-keyed data and never dropped.
    "faceDownBy",
    "faceDownOf",
    "copiedFrom",
    "castableFromExileBy",
    "castableFromExileUntilTurn",
    // CR 702.185a/b (issue #1268) — the Warp trio: the cast-instance marker on
    // a permanent still awaiting its end step, the "warped card in exile"
    // referent, and the grant's LOWER turn bound. Spec-keyed state like the
    // three exile-grant keys around them, not continuous-effect residue.
    "castableFromExileFromTurn",
    "warped",
    "warpExiled",
    "castableFromExileIncludesLand",
    // Rebuild behaviour, not spec-keyed data: `beginApplyingStaticEffects`
    // (CR 611.2) re-derives every CONTINUOUS grant/strip from a
    // still-present battlefield source on every load, exactly as the
    // original build did — see `reportCharacteristicDrift`'s doc.
    // `reportCardResidue` below still catches the one shape that ISN'T
    // re-derived: a `duration`-scoped (temporary) grant.
    "enteredOnTurn",
    "chosenPlayerId",
    "staticSeq",
    "grantedActivatedAbilities",
    "grantedTriggeredAbilities",
    "abilitiesSuppressedBy",
    // Same class, PRD #2064 S3: `baseStaticAbilities` is the pre-layer-6
    // keyword multiset and `abilityLossHolds` the resolving-ability ledger.
    // The base is re-captured from the reloaded `staticAbilities` at the first
    // `syncLayer6`, so it is rebuild behaviour, never spec-keyed data. A hold
    // whose source has left is caught by `reportCardResidue` below, on the same
    // rule as a duration-scoped grant.
    "baseStaticAbilities",
    "abilityLossHolds",
    // WIRE-ONLY keys (ADR 0082 decision 4, PRD #2064 S6b-part-2). These are not
    // `CardInstanceState` fields at all any more — they are derived
    // characteristics `gre/wireCharacteristics.ts` materialises onto the
    // projected card so the client's 53 call sites keep working. This scan runs
    // over a card that may have come through `projectFullState`, so it sees
    // them; they are the definition of rebuild behaviour, since the next
    // derivation on the loaded board produces them again from scratch.
    "grantedStaticAbilities",
    "removedKeywords",
    "textChanges",
    "grantedTypes",
    "suppressedTypes",
    "grantedSubtypes",
    "grantedSubtypesAdd",
    "printedSubtypes",
    // Same class again, PRD #2064 S4, for layers 2-5: `baseControllerId`,
    // `baseTypes` and `baseSubtypes` are the pre-layer bases, re-captured from
    // the reloaded `controllerId` / `types` / `subtypes` at the first
    // `syncLayers2to5`; `printedSubtypes` is now that base's derived twin, kept
    // only for the pre-split consult sites. All four are rebuild behaviour, not
    // spec-keyed data. The layer-2-to-5 LEDGERS are deliberately NOT here —
    // `textChangeHolds`, `typeLineHolds`, `subtypeAddHolds` and
    // `supertypeHolds` hold effects nothing on the board can re-derive, so a
    // spec that drops one has genuinely dropped state and the generic scan
    // must keep reporting it.
    "baseControllerId",
    "baseTypes",
    "baseSubtypes",
    // Privacy field — never present on a real read (`slimCard` deletes it
    // even in the full debug projection); read separately (raw states only)
    // to derive `faceDownExile`.
    "knownTo",
    // Wire-projection-only additions.
    "legalActions",
    "canTurnFaceUp",
    "knownCardId",
    "seenByOpponent",
    "phyrexianOptions",
    "flashSurchargeRequired",
    "printedCostCastUnavailable",
    "exiledByPermanentId",
    "castKind",
    "flashbackExileMaxX",
]);

/** The three `key -> template` grant arrays (`grantedStaticAbilities`,
 *  `grantedActivatedAbilities`, `grantedTriggeredAbilities`) are allowlisted
 *  wholesale (rebuild behaviour — see `CARD_STATE_ALLOWLIST`'s comment) for
 *  the common CONTINUOUS case: `auraId`-sourced WITH the aura still on
 *  either battlefield, or no `duration`/`auraId` at all (a lord/anthem still
 *  on the battlefield). Two shapes AREN'T re-derived — the same source-keyed
 *  escape as `reportDanglingStripperResidue` one field over (CR 611.2,
 *  issue #2148 review finding on #2866): a `duration`-scoped entry — a
 *  ONE-SHOT resolved effect's "gains flying until end of turn" grant, which
 *  has no source permanent for `beginApplyingStaticEffects` to replay — and an
 *  `auraId`-scoped entry whose aura has since left BOTH battlefields, which
 *  leaves `beginApplyingStaticEffects` nothing to walk on reload either. */
function reportTemporaryGrantResidue(
    state: GameState,
    card: CardInstanceState,
    label: string,
    dropped: string[]
): void {
    // `grantedStaticAbilities` left this list with PRD #2064 S6b-part-2: the
    // field is gone from `CardInstanceState` and every provenance it carried is
    // a registry entry, whose own expiry ends it (a `source` entry whose source
    // has left simply stops applying — there is no residue to report).
    const fields = [
        "grantedActivatedAbilities",
        "grantedTriggeredAbilities",
    ] as const;
    for (const field of fields) {
        const grants = card[field] as
            | { duration?: unknown; auraId?: string }[]
            | undefined;
        if (grants?.some((g) => g.duration !== undefined)) {
            dropped.push(
                `${label}: a temporary (until-end-of-turn) ${field} entry — not spec-expressible, dropped`
            );
        }
        if (
            grants?.some(
                (g) =>
                    g.auraId !== undefined &&
                    !sourceStillOnBattlefield(state, g.auraId)
            )
        ) {
            dropped.push(
                `${label}: ${field} sourced from an aura no longer on either battlefield — beginApplyingStaticEffects has nothing to replay it from on reload; not spec-expressible`
            );
        }
    }
}

/** True when `sourceId` is still a permanent on EITHER player's battlefield
 *  in the LIVE state being lowered — the precondition for
 *  `beginApplyingStaticEffects` to re-derive a source-keyed grant/removal on
 *  reload (CR 611.2). */
function sourceStillOnBattlefield(state: GameState, sourceId: string): boolean {
    return state.players.some((p) =>
        p.battlefield.some((c) => c.id === sourceId)
    );
}

/** `removedKeywords`/`abilitiesSuppressedBy` are source-keyed (`sourceId`),
 *  not duration-keyed like the three `granted*` arrays above.
 *
 *  PRD #2064 S3 — both are now `syncLayer6`'s DERIVED OUTPUT, so a
 *  reconstructible entry is one whose PRODUCER survives the round trip, and the
 *  producer of a duration-scoped strip (Shelkin Brownie) is the
 *  `temporaryRemovedKeywords` row, not a battlefield source. Such an entry is
 *  stamped with the `INDEFINITE_SOURCE_ID` sentinel — no permanent can bear
 *  that id, so the dangling test would flag every one of them. They are skipped
 *  here and caught, as they always were, by the generic scan over
 *  `temporaryRemovedKeywords` (which is NOT in `CARD_STATE_ALLOWLIST`).
 *
 *  Their rebuild path mirrors a continuous
 *  `granted*` entry: `beginApplyingStaticEffects` re-derives the strip on
 *  every load PROVIDED the stripping source is still a battlefield
 *  permanent for the reload to walk. When `sourceId` names nothing on
 *  either battlefield the entry can't be re-derived — report it, the same
 *  escape hatch as `reportTemporaryGrantResidue` one field over (issue
 *  #2148 review finding). */
function reportDanglingStripperResidue(
    state: GameState,
    card: CardInstanceState,
    label: string,
    dropped: string[]
): void {
    // The `removedKeywords` half of this report went with PRD #2064
    // S6b-part-2: a strip is a registry entry now, and an entry whose `source`
    // expiry names a permanent that is no longer on either battlefield is not
    // dangling residue — it is an effect that has ENDED, and the derivation
    // simply stops producing it. Nothing survives a reload to report.
    const danglingSuppressed = (card.abilitiesSuppressedBy ?? []).filter(
        (s) =>
            s.sourceId !== INDEFINITE_SOURCE_ID &&
            !sourceStillOnBattlefield(state, s.sourceId)
    );
    if (danglingSuppressed.length > 0) {
        dropped.push(
            `${label}: abilitiesSuppressedBy a source no longer on either battlefield — beginApplyingStaticEffects has nothing to replay it from on reload; not spec-expressible`
        );
    }
}

/** Generic "continuous effect residue" detector — the fallback for the many
 *  optional `CardInstanceState` fields NOT named individually above
 *  (`animation`, `controlChanges`, `chosenMana`,
 *  `regenerationShields`, …): any key present that isn't in the allowlist is
 *  live state the spec has no field for. */
function reportCardResidue(
    state: GameState,
    card: CardInstanceState,
    label: string,
    dropped: string[]
): void {
    reportTemporaryGrantResidue(state, card, label, dropped);
    reportDanglingStripperResidue(state, card, label, dropped);
    const extra = Object.keys(card).filter(
        (key) =>
            !CARD_STATE_ALLOWLIST.has(key) &&
            (card as Record<string, unknown>)[key] !== undefined
    );
    if (extra.length > 0) {
        dropped.push(
            `${label}: live-only state not captured (${extra.sort().join(", ")})`
        );
    }
}

type LowerableZone = "battlefield" | "hand" | "graveyard" | "exile";

/** Lower one card instance into its `ScenarioCard` entry, reporting anything
 *  it can't express onto `dropped`. */
function lowerCard(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    zone: LowerableZone,
    owner: "me" | "opp",
    dropped: string[]
): ScenarioCard {
    const { name, copyOf } = entryIdentity(card);
    const label = `${name} (${owner}${zone === "battlefield" ? "" : `, ${zone}`})`;

    const entry: ScenarioCard = { name, owner };
    if (card.isToken) entry.token = true;
    if (zone !== "battlefield") entry.zone = zone;

    // CR 602.5 (issue #3448) — outside the battlefield branch below because
    // the engine keeps this tally on a card that has left play (cleared on
    // re-entry, CR 400.7), so a graveyard / exile card can carry one. Without
    // it a position whose once-each-turn ability is already spent rebuilds
    // with that ability legal again: an extra candidate, which is exactly the
    // mismatch the verdict quiz refuses on (PRD #3397).
    const activations = resolveScenarioActivations(card.activationsThisTurn);
    if (activations) entry.activations = activations;

    // CR 608.2 / 514.2 (issue #3453) — this card's slice of the game-level
    // per-turn resolution tally, lowered in EVERY zone for the same reason:
    // the tally survives its source leaving the battlefield (nothing clears it
    // before CLEANUP), and a dies-trigger's own source sits in a graveyard
    // while its next resolution this turn still reads it. Without it an
    // escalating ability rebuilds as its FIRST resolution — a different
    // effect, on a board that looks identical.
    const abilityResolutions = lowerAbilityResolutions(state, card.id);
    if (abilityResolutions) entry.abilityResolutions = abilityResolutions;

    if (zone === "battlefield") {
        if (card.isTapped) entry.tapped = true;
        if (card.damageMarked) entry.damageMarked = card.damageMarked;
        if (card.counters && Object.keys(card.counters).length > 0) {
            entry.counters = { ...card.counters };
        }
        if (card.attackedDuringLastTurn) entry.attackedLastTurn = true;
        if (card.isSummoningSick) entry.summoningSick = true;
        // CR 106.4 / 603.3 (issue #3451) — the two tap-irreversibility markers.
        // A tapped land whose mana is already spent, or whose tap put a trigger
        // on the stack, is one `tapUntap` refuses to untap; a rebuild that drops
        // the marker offers that untap, and (for `manaCommitted`) also lets
        // `commitLandsForCost` attribute the NEXT payment to this
        // already-spent source instead of the one it just tapped.
        if (card.manaCommitted) entry.manaCommitted = true;
        if (card.tapTriggerCommitted) entry.tapTriggerCommitted = true;
        // CR 502.1 (issue #3451) — the untap-step snapshot. Not derivable from
        // `tapped` in either direction, and the rebuild runs no untap step, so
        // an unlowered Rasputin Dreamweaver rebuilds with its upkeep
        // intervening-if reading FALSE on a board where it was true.
        if (card.startedTurnUntapped) entry.startedTurnUntapped = true;

        if (card.faceDown) {
            if (card.isToken) {
                // CR 111 / 708.2 — the token branch of the builder never
                // reads `faceDown`; a face-down token can't be lowered as
                // such. Fall back to a face-up token of its true shape.
                dropped.push(
                    `${label}: a face-down TOKEN — the scenario spec's token entries don't support faceDown; lowered as a face-up "${name}" token, face-down status dropped`
                );
            } else {
                entry.faceDown = true;
                if (card.copiedFrom) {
                    dropped.push(
                        `${label}: face-down AND a copy — this combination can't be lowered precisely (turning face down erases the copiable identity the builder would need); kept face-down as "${name}", copy status dropped`
                    );
                }
            }
        } else if (card.copiedFrom) {
            if (card.isToken) {
                dropped.push(
                    `${label}: a TOKEN copying another object — the scenario spec can't express a token-as-copy; lowered as a plain "${name}" token, copy status dropped`
                );
            } else if (copyOf) {
                entry.copyOf = copyOf;
            }
        }

        if (card.attachedTo) {
            const host = [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].find((c) => c.id === card.attachedTo);
            if (host) {
                entry.attachedTo = presentedName(host);
            } else {
                dropped.push(
                    `${label}: attachedTo references "${card.attachedTo}", not found on either battlefield — attachment dropped`
                );
            }
        }

        reportCharacteristicDrift(card, label, dropped);
    } else if (zone === "exile") {
        if (card.castableFromExileBy) {
            if (card.castableFromExileBy === player.id) {
                entry.castableFromExile = true;
                if (card.castableFromExileIncludesLand) {
                    entry.castableFromExileIncludesLand = true;
                }
            } else {
                dropped.push(
                    `${label}: castable from exile by a DIFFERENT player than the pile's owner — the scenario spec always grants the permission to the pile's own owner; not lowered`
                );
            }
        }
        if (card.knownTo?.includes(player.id)) {
            entry.faceDownExile = true;
        }
    }

    reportCardResidue(state, card, label, dropped);
    return entry;
}

/** `state.combat` sub-fields `lowerCombat` carries into `spec.combat`, PLUS
 *  the one it re-derives at seed time (`blockedAttackerIds`, rebuilt by
 *  `recordBlockedAttackers` from the assignments — CR 509.1h). Anything else
 *  present on a live combat is a fact the spec has no field for, named by
 *  `reportCombatResidue` instead of vanishing: the mirror of
 *  `CARD_STATE_ALLOWLIST` / `reportCardResidue` one level up. */
const COMBAT_STATE_ALLOWLIST = new Set<string>([
    "attackerIds",
    "confirmed",
    "blockerAssignments",
    "blockersConfirmed",
    "blockedAttackerIds",
]);

/**
 * The prefix every combat loss `lowerCombat` reports carries (issue #3458
 * review).
 *
 * It is a CONTRACT, not a formatting habit: `lowerDecision`
 * (`gre/ai/verdicts/lowering.ts`) refuses a verdict whose lowering dropped any
 * combat fact, because the candidate-list comparison it otherwise relies on
 * cannot see one. An attack redirected at a planeswalker (CR 508.1b) admits
 * exactly the same blocks as an attack on the face (CR 509.1a), so the two
 * lists match move for move while the boards differ — the same argument the
 * `stack-not-empty` site already makes. Exported so the refusal keys off this
 * constant rather than off a string literal repeated in another file.
 */
export const COMBAT_DROPPED_PREFIX = "combat:";

/** Generic "combat state the spec has no field for" detector — `attackTargets`
 *  (CR 508.1b), `exertedIds` (CR 508.1g), a parked attack tax, the damage-
 *  assignment step's four fields, attacking bands (CR 702.22c). */
function reportCombatResidue(
    combat: NonNullable<GameState["combat"]>,
    dropped: string[]
): void {
    const extra = Object.keys(combat).filter(
        (key) =>
            !COMBAT_STATE_ALLOWLIST.has(key) &&
            (combat as Record<string, unknown>)[key] !== undefined
    );
    if (extra.length > 0) {
        dropped.push(
            `combat: live-only state not captured (${extra.sort().join(", ")})`
        );
    }
}

/**
 * CR 508.1 / 509.1 / 506.4 (issue #3458) — lower the declared combat and the
 * per-turn attacked/blocked record onto `spec`, reporting what it cannot carry.
 *
 * The four declaration fields are written whenever `state.combat` EXISTS, even
 * all-empty: the builder creates its combat object from their presence, so an
 * empty-but-present combat (the open declare-attackers step) round-trips as
 * itself rather than as no combat at all.
 */
function lowerCombat(
    state: GameState,
    spec: ScenarioSpec,
    dropped: string[],
    mySeatId: string
): void {
    const onBattlefield = (id: string): CardInstanceState | undefined =>
        state.players[0].battlefield.find((c) => c.id === id) ??
        state.players[1].battlefield.find((c) => c.id === id);
    // The SPEC's frame, not the live one: "me" is `players[0]` on the rebuild
    // whichever live seat it was, so every list below must be emitted in that
    // order for the builder's own resolution to land on the same permanents.
    const seatOrder = [
        state.players.find((p) => p.id === mySeatId)!,
        state.players.find((p) => p.id !== mySeatId)!,
    ];
    const activeSide = seatOrder.find((p) => p.id === state.activePlayerId);
    const defendingSide = seatOrder.find((p) => p.id !== state.activePlayerId);

    /** The instances the BUILDER's `resolveCombatants` would bind these names
     *  to — first untaken match by presented name, in the given battlefield
     *  order. `null` when a name has no match at all. */
    const asTheBuilderWould = (
        battlefields: CardInstanceState[][],
        names: string[]
    ): string[] | null => {
        const taken = new Set<string>();
        const ids: string[] = [];
        for (const name of names) {
            const found = battlefields
                .flat()
                .find((c) => !taken.has(c.id) && presentedName(c) === name);
            if (!found) return null;
            taken.add(found.id);
            ids.push(found.id);
        }
        return ids;
    };

    /** A name list is only lowered if the builder would bind it back to the
     *  SAME permanents. Two same-named creatures where only one is in combat
     *  is ordinary (two Savannah Lions, one held back), and a name cannot say
     *  which — the rebuild would hand the combat role to the other copy along
     *  with every per-instance fact the entry carried (its counters, its
     *  damage, its tapped state), and the candidate list would still match
     *  because `describeMove` renders both as the same sentence. Reported, so
     *  the verdict path refuses instead of judging another board. */
    const bindsBack = (
        battlefields: CardInstanceState[][],
        names: string[],
        liveIds: string[],
        role: string
    ): boolean => {
        const rebound = asTheBuilderWould(battlefields, names);
        if (rebound && sameStringList(rebound, liveIds)) return true;
        dropped.push(
            `${COMBAT_DROPPED_PREFIX} two identically-named permanents differ in their ${role} role — a presented card name cannot say WHICH one, so the rebuild would bind the other copy`
        );
        return false;
    };

    const combat = state.combat;
    const lowered: NonNullable<ScenarioSpec["combat"]> = {};
    const attackerIds: string[] = [];

    if (combat) {
        for (const id of combat.attackerIds) {
            const attacker = onBattlefield(id);
            if (!attacker) {
                dropped.push(
                    `${COMBAT_DROPPED_PREFIX} an attacker is on no battlefield — not lowered`
                );
                continue;
            }
            if (attacker.faceDown) {
                // A face-down permanent PRESENTS as the CR 708.2 sentinel,
                // which is not a catalogue name the builder could resolve —
                // and the card entry beside it is lowered under its real name
                // plus `faceDown`, so neither spelling names the placed
                // instance. Reported rather than named wrong.
                dropped.push(
                    `${COMBAT_DROPPED_PREFIX} a FACE-DOWN permanent is in combat — a face-down creature has no card name for the spec to reference`
                );
                continue;
            }
            attackerIds.push(id);
        }
        lowered.attackers = attackerIds.map((id) =>
            presentedName(onBattlefield(id)!)
        );
        lowered.confirmed = combat.confirmed;
        lowered.blockers = [];
        const blockerIds: string[] = [];
        for (const [blockerId, blockedIds] of Object.entries(
            combat.blockerAssignments
        )) {
            const blocker = onBattlefield(blockerId);
            if (!blocker) {
                dropped.push(
                    `${COMBAT_DROPPED_PREFIX} a blocker is on no battlefield — its assignment is not lowered`
                );
                continue;
            }
            if (blocker.faceDown) {
                dropped.push(
                    `${COMBAT_DROPPED_PREFIX} a FACE-DOWN permanent is in combat — a face-down creature has no card name for the spec to reference`
                );
                continue;
            }
            // The attackers it was declared against, as INDEXES into the list
            // above — the one edge two identical attacking creatures make a
            // name unable to state (CR 509.1a).
            const blocking = blockedIds
                .map((id) => attackerIds.indexOf(id))
                .filter((index) => index !== -1);
            if (blocking.length !== blockedIds.length) {
                dropped.push(
                    `${COMBAT_DROPPED_PREFIX} "${presentedName(blocker)}" blocks a creature that is no longer among the declared attackers — that assignment is not lowered`
                );
            }
            if (blocking.length === 0) {
                // CR 509.1g — a blocking creature blocks at least one
                // attacker. An entry whose array is empty is `isBlocking`
                // with nothing to carry it, so the flag would come back unset.
                dropped.push(
                    `${COMBAT_DROPPED_PREFIX} "${presentedName(blocker)}" is recorded as blocking nothing — the spec has no entry for a blocker with no attacker, so it comes back NOT blocking`
                );
                continue;
            }
            lowered.blockers.push({
                blocker: presentedName(blocker),
                blocking,
            });
            blockerIds.push(blockerId);
        }
        lowered.blockersConfirmed = combat.blockersConfirmed;

        // CR 509.1h — the rebuild re-derives this from the assignments through
        // the engine's own `recordBlockedAttackers`, so it is not a spec field.
        // Two shapes that derivation cannot reach: an attacker still recorded
        // as blocked whose blockers have all left combat (exactly what
        // CR 509.1h keeps true), and a record standing while the declaration
        // is not confirmed, which the seed never re-derives at all.
        const stillAssigned = new Set(
            Object.values(combat.blockerAssignments).flat()
        );
        const orphanBlocked = (combat.blockedAttackerIds ?? []).filter(
            (id) => !stillAssigned.has(id)
        );
        if (orphanBlocked.length > 0) {
            dropped.push(
                `${COMBAT_DROPPED_PREFIX} ${orphanBlocked.length} attacker(s) recorded as blocked (CR 509.1h) with no blocker still assigned — the rebuild re-derives blocked status from the assignments, so they come back UNBLOCKED`
            );
        } else if (
            !combat.blockersConfirmed &&
            (combat.blockedAttackerIds ?? []).length > 0
        ) {
            dropped.push(
                `${COMBAT_DROPPED_PREFIX} blocked attackers are recorded (CR 509.1h) while the block declaration is not confirmed — the rebuild only re-derives the record at confirmation, so it comes back empty`
            );
        }

        // The name lists are only a faithful reference if the builder's own
        // resolution binds them back to THESE permanents.
        bindsBack(
            [activeSide?.battlefield ?? []],
            lowered.attackers,
            attackerIds,
            "attacking"
        );
        bindsBack(
            [defendingSide?.battlefield ?? []],
            lowered.blockers.map((entry) => entry.blocker),
            blockerIds,
            "blocking"
        );
        reportCombatResidue(combat, dropped);
    }

    // CR 506.4 / 508.4 — the per-turn record, lowered as the COMPLETE list of
    // creatures carrying it rather than as the declaration's complement. It is
    // not derivable from `attackers` in either direction: a creature removed
    // from combat (or a combat phase that has ended) keeps the flag with no
    // declaration left to read it off, and a creature PUT onto the battlefield
    // attacking is in `attackerIds` while carrying no flag at all — CR 508.4
    // says such a creature is "attacking" but "for the purposes of trigger
    // events and effects, they never `attacked`". The builder marks these
    // independently of the declaration for exactly that reason.
    const attackedThisTurn: { me?: string[]; opp?: string[] } = {};
    const blockedThisTurn: { me?: string[]; opp?: string[] } = {};
    for (const [index, player] of seatOrder.entries()) {
        const seat = index === 0 ? ("me" as const) : ("opp" as const);
        const attacked = player.battlefield.filter(
            (card) => card.hasAttackedThisTurn && !card.faceDown
        );
        const blocked = player.battlefield.filter(
            (card) => card.hasBlockedThisTurn && !card.faceDown
        );
        if (attacked.length > 0) {
            attackedThisTurn[seat] = attacked.map(presentedName);
            bindsBack(
                [player.battlefield],
                attackedThisTurn[seat],
                attacked.map((card) => card.id),
                "attacked-this-turn"
            );
        }
        if (blocked.length > 0) {
            blockedThisTurn[seat] = blocked.map(presentedName);
            bindsBack(
                [player.battlefield],
                blockedThisTurn[seat],
                blocked.map((card) => card.id),
                "blocked-this-turn"
            );
        }
    }
    if (attackedThisTurn.me || attackedThisTurn.opp) {
        lowered.attackedThisTurn = attackedThisTurn;
    }
    if (blockedThisTurn.me || blockedThisTurn.opp) {
        lowered.blockedThisTurn = blockedThisTurn;
    }

    if (Object.keys(lowered).length > 0) spec.combat = lowered;
}

/** CR 400.2 (issue #3452) — the hand cards that HAVE an identity to lower.
 *  A view that could not see a card holds an opaque placeholder in its place
 *  (`PLACEHOLDER_CARD_ID`, seeded by the vs-AI adapter and by `determinize`);
 *  those carry no name, so they are counted into the spec's `hiddenHand`
 *  rather than named in `cards`. The difference between this list and the
 *  hand is the count. */
function visibleHand(player: PlayerState): CardInstanceState[] {
    return player.hand.filter(
        (card) => (card.card as { id?: string }).id !== PLACEHOLDER_CARD_ID
    );
}

function zoneCards(
    player: PlayerState,
    zone: "battlefield" | "graveyard" | "exile"
): CardInstanceState[] {
    if (zone === "battlefield") return player.battlefield;
    return zone === "graveyard" ? player.graveyard : player.exile;
}

/** `GameState` top-level fields that are ALREADY accounted for elsewhere in
 *  `specFromState` — either lowered into the spec, covered by one of the
 *  bespoke `dropped` messages below (`stack`, `combat`, `pendingCast`, …),
 *  or pure rebuild bookkeeping that `buildStateFromScenario`/
 *  `saveGameState` always regenerate fresh from the REBUILT board rather
 *  than restore from spec data (id/seq allocators, the `expectedInput`
 *  cache — ADR 0047 — and `mulligan`, which describes the RELOAD TARGET
 *  game, not the position being captured; mirrors `enteredOnTurn`/
 *  `chosenPlayerId` in `CARD_STATE_ALLOWLIST`'s own three-way split), PLUS
 *  the wire-projection-only addition present when the caller bridges a
 *  PROJECTED client state (`FullGameState`) into this function instead of a
 *  raw engine `GameState` (`debug-copy-scenario.tsx` — the only production
 *  caller feeds `getFullState`'s `projectFullState` result, never a raw
 *  engine state) — never real engine state, so never "dropped" (issue #2866
 *  review finding: the field appeared in `dropped` on every real click,
 *  since `GAME_STATE_ALLOWLIST` had no such section though
 *  `CARD_STATE_ALLOWLIST` already does, mirrored below).
 *
 *  Before this allowlist existed the field-by-field checks below were the
 *  ONLY thing standing between a new `GameState` field and silent data
 *  loss — the shape `CardInstanceState` has had all along via
 *  `CARD_STATE_ALLOWLIST` + `reportCardResidue`. `reportGameStateResidue`
 *  below is the generic catch: anything present on `state` outside this
 *  set is live state the spec has no field for, named automatically
 *  instead of requiring someone to remember to add a check (issue #2148
 *  review finding). */
export const GAME_STATE_ALLOWLIST = new Set<string>([
    // Structural — always present, not itself residue.
    "players",
    // Lowered into the spec directly.
    "turn",
    "phase",
    "rngSeed",
    // CR 102.1 / 117.1 / 117.4 (issue #3454) — lowered directly too, into
    // `activePlayer` / `priority` / `passCount`.
    "activePlayerId",
    "priorityPlayerId",
    "passCount",
    // CR 702.40a (issue #3449) — lowered into `stormCount`, the Storm tally of
    // spells cast by any player this turn.
    "spellsCastThisTurn",
    // CR 120.3a / 119.3 / 700.4 / 508.1a (issue #3453) — the retrospective
    // per-turn tallies, each lowered into the spec field of the SAME NAME and
    // rebuilt from it, so none of them is live-only residue any more.
    "damageDealtToPlayerThisTurn",
    "artifactDamageToPlayerThisTurn",
    "lifeGainedThisTurn",
    "deathsThisTurn",
    "creatureAttackedThisTurn",
    // CR 608.2 (issue #3453) — lowered PER CARD, into each source's own
    // `abilityResolutions` entry, because the store's key carries an instance
    // id the rebuild reallocates. Allowlisted for the shape that round-trips,
    // like `drawnThisTurn` below; the tallies whose source is in no lowered
    // zone at all keep their own bespoke report in `specFromState`, since a
    // blanket entry here would swallow them silently.
    "abilityResolutionCounts",
    // CR 508.1 / 509.1 (issue #3458) — lowered into `combat`, whose own
    // sub-fields have their own allowlist (`COMBAT_STATE_ALLOWLIST`).
    "combat",
    // Covered by a bespoke `dropped` message below.
    "stack",
    "pendingCast",
    "pendingActivation",
    "pendingCompanionPay",
    "pendingTarget",
    "pendingChoices",
    "pendingTriggerBatch",
    "pendingReflexiveTriggers",
    "madnessCastWindow",
    "reboundCastWindow",
    "delayedTriggers",
    "emblems",
    "gameOver",
    "extraTurns",
    "extraPhases",
    "extraCombatsThisTurn",
    "autoPassPlayers",
    "singleShotAutoPass",
    "queuedEndTurn",
    // Rebuild bookkeeping — internal id/seq allocators and derived caches
    // `buildStateFromScenario`/`saveGameState` always regenerate fresh from
    // the rebuilt board; their absolute value on the LIVE state carries no
    // game-visible meaning of its own to preserve.
    "mulligan",
    "rngCounter",
    "nextGrantSeq",
    "nextDelayedSeq",
    "nextTokenSeq",
    "nextEmblemSeq",
    "nextWorldSeq",
    "nextInstanceId",
    "pendingEvents",
    "expectedInput",
    // CR 608.2h / 111.12 (ADR 0086, issue #3453) — the last-known COPIABLE
    // values of permanents that have LEFT the battlefield, keyed by the
    // instance id each had there. Rebuild bookkeeping by the same test as the
    // allocators above: `buildStateFromScenario` reassigns every id and the
    // rebuilt board has no departures, so not one key could still name an
    // object — the value carries no game-visible meaning to preserve, and the
    // builder clears it for exactly that reason. Its single consumer is a
    // `createTokenCopyOf` call from a resolving ability (`lastKnownCopiable:
    // true`), i.e. an item ON THE STACK or a delayed trigger — both already
    // reported as not lowered, so the loss is named where it is real.
    "lastKnownCopiable",
    // CR 514.3a (issue #2472, issue #3453) — the within-cleanup resume marker,
    // meaningful only while it EQUALS `state.turn`, which only holds inside
    // that turn's CLEANUP step. A scenario places a position before its
    // cleanup, so the rebuild's correct value is "not run yet" — the builder
    // clears it and `finalizeCleanup` re-stamps it when the turn ends. The one
    // position where the live value is load-bearing, a capture taken in the
    // CR 514.3a priority window itself, gets its own bespoke report below.
    "cleanupBookkeepingTurn",
    // Wire-projection-only addition — see this Set's doc comment.
    "seq",
]);

/** `PlayerState` fields already accounted for elsewhere in `specFromState` —
 *  see `GAME_STATE_ALLOWLIST`'s doc for the same three-way split, INCLUDING
 *  its wire-projection-only tail: `FullPlayer` (`gameProjections.ts`) adds
 *  `librarySearch`/`libraryPeek`/`revealedHand` while a search/peek/reveal
 *  choice is live (undefined otherwise, so harmless then — spurious in
 *  `dropped` the moment one of those choices is on the stack when the
 *  projected state is bridged in). `name`/`bgColor` describe the RELOAD
 *  TARGET game's own player record, not the captured position. */
export const PLAYER_STATE_ALLOWLIST = new Set<string>([
    "id",
    "name",
    "bgColor",
    "life",
    "hand",
    "library",
    "graveyard",
    "exile",
    "battlefield",
    // CR 106.4 / 106.6 (issue #3460) — lowered into the spec's own `manaPool`
    // and `restrictedMana` pairs and rebuilt from them, so neither is
    // live-only residue any more. `manaPool` is a blanket entry (every pool is
    // expressible); `restrictedMana` is not quite — an INSTANCE-keyed unit
    // (Ice Cauldron) survives no rebuild and is reported by its own check in
    // `specFromState`, the `drawnThisTurn` shape.
    "manaPool",
    "restrictedMana",
    "poisonCounters",
    "experienceCounters",
    // CR 305.2 (issue #3446) — lowered by `specFromState` into `landsPlayed`
    // and rebuilt from it, so it is no longer live-only residue.
    "landsPlayedThisTurn",
    // CR 601.2i / 118.9 (issue #3449) — lowered into the spec's own
    // `spellsCastThisTurn` / `spellsCastThisGame` per-seat pairs. Any value of
    // either is expressible, so these are blanket entries, unlike
    // `drawnThisTurn` below whose expressible shape is a single card.
    "spellsCastThisTurn",
    "spellsCastThisGame",
    // CR 508.1c / 500.1 (issue #3450) — Arboria's two qualifying-action flags
    // and the seat's own turn count, lowered into the spec keys of the same
    // name. Blanket entries: every value of each is expressible.
    "qualifyingActionThisTurn",
    "qualifyingActionLastTurn",
    "turnsTaken",
    // Revolt, an ability word (CR 207.2c) — lowered into the spec's `revolt`
    // pair, named for the mechanic the way `stormCount` is.
    "permanentYouControlledLeftThisTurn",
    "companion",
    "lastDrawnCardId",
    // CR 121.1 (issue #3240) — the spec CAN express this, but only in the one
    // shape `markLastDrawn` lowers and rebuilds: the single most recently drawn
    // card. Allowlisted here so that shape stops reading as residue; a LONGER
    // tally is still genuinely live-only and is reported by its own check in
    // `reportPlayerStateResidue`, because a blanket allowlist entry would
    // silently swallow "you drew seven cards this turn".
    "drawnThisTurn",
    // Wire-projection-only additions — see this Set's doc comment.
    "librarySearch",
    "libraryPeek",
    "revealedHand",
]);

/** CR 106.6 (issue #3460) — how `specFromState` treats every field of a
 *  `RestrictedMana` unit, `satisfies Record<keyof RestrictedMana, …>` so a
 *  SEVENTH field reds `tsc` here instead of vanishing from a capture in silence
 *  (a third rider is the obvious candidate — `hasteRider` itself arrived with
 *  issue #3354). The mirror is load-bearing precisely BECAUSE `restrictedMana`
 *  is a blanket `PLAYER_STATE_ALLOWLIST` entry: before this widening any
 *  non-empty pool produced a `dropped` line, so no unit field could be lost
 *  unreported; now the lowering copies the keys it knows, and this is what
 *  stands between a new one and a silent loss.
 *
 *  `tsc` catches the CLASSIFICATION; the disposition sweep in
 *  `scenarioBuilder.test.ts` catches a key classified `lowered` that the mapper
 *  below does not actually copy. */
export const RESTRICTED_MANA_KEY_DISPOSITION = {
    color: "lowered",
    amount: "lowered",
    restriction: "lowered",
    cantBeCounteredRider: "lowered",
    hasteRider: "lowered",
    /** An INSTANCE id — no rebuild can honour it, so the unit carrying one is
     *  reported in `dropped` rather than lowered. */
    castableCardId: "reported",
} as const satisfies Record<keyof RestrictedMana, "lowered" | "reported">;

/** Generic "top-level state residue" detector for `GameState`, the same
 *  shape as `reportCardResidue` one level up: any key present on `state`
 *  that isn't in `GAME_STATE_ALLOWLIST` is live state the spec has no field
 *  for at all. */
function reportGameStateResidue(state: GameState, dropped: string[]): void {
    const extra = Object.keys(state).filter(
        (key) =>
            !GAME_STATE_ALLOWLIST.has(key) &&
            (state as Record<string, unknown>)[key] !== undefined
    );
    if (extra.length > 0) {
        dropped.push(
            `game state: live-only state not captured (${extra.sort().join(", ")})`
        );
    }
}

/** Generic "player-level state residue" detector for `PlayerState` — the
 *  `me`/`opp` counterpart of `reportGameStateResidue`. */
function reportPlayerStateResidue(
    label: "me" | "opp",
    player: PlayerState,
    dropped: string[]
): void {
    const extra = Object.keys(player).filter(
        (key) =>
            !PLAYER_STATE_ALLOWLIST.has(key) &&
            (player as Record<string, unknown>)[key] !== undefined
    );
    if (extra.length > 0) {
        dropped.push(
            `${label}: live-only player state not captured (${extra.sort().join(", ")})`
        );
    }
    // CR 121.1 (issue #3240) — the narrow half of the `drawnThisTurn`
    // allowlist entry above. `markLastDrawn` lowers exactly one card, so
    // anything else in the tally survives no round trip and must say so.
    const drawn = player.drawnThisTurn ?? [];
    const expressible =
        drawn.length === 0 ||
        (drawn.length === 1 && drawn[0] === player.lastDrawnCardId);
    if (!expressible) {
        dropped.push(
            `${label}: drawnThisTurn beyond the single markLastDrawn card not captured (${drawn.length} drawn)`
        );
    }
}

/**
 * The inverse of {@link buildStateFromScenario}: lower a live `GameState`
 * into a `ScenarioSpec` a human (or the blade suite) can read, plus
 * everything that spec could NOT capture. Pure — no `ctx`, no mutation of
 * `state`.
 *
 * `opts.mySeatId` decides which live seat becomes `"me"` (`ScenarioSpec`'s
 * `"me"` is always `players[0]`, which has no relationship to a live game's
 * seat order — get this wrong and the capture comes out mirrored, #2148).
 *
 * Lossy by construction: `dropped` names every fact the spec couldn't carry
 * (the stack, a mid-flight payment, an instance-keyed restricted-mana
 * permission, delayed triggers, per-card continuous-effect residue, library
 * contents, …) rather than silently omitting it — the whole
 * point of this function per issue #2148.
 */
export function specFromState(
    state: GameState,
    opts: SpecFromStateOptions
): SpecFromStateResult {
    const me = state.players.find((p) => p.id === opts.mySeatId);
    if (!me) {
        throw new Error(
            `specFromState: mySeatId "${opts.mySeatId}" matches neither player.`
        );
    }
    const opp = state.players.find((p) => p.id !== opts.mySeatId);
    if (!opp) {
        throw new Error("specFromState: state does not have two players.");
    }

    const dropped: string[] = [];
    const cards: ScenarioCard[] = [];

    for (const zone of ["battlefield", "graveyard", "exile"] as const) {
        for (const card of zoneCards(me, zone)) {
            cards.push(lowerCard(state, me, card, zone, "me", dropped));
        }
        for (const card of zoneCards(opp, zone)) {
            cards.push(lowerCard(state, opp, card, zone, "opp", dropped));
        }
    }

    // Hand needs special handling for `markLastDrawn` (CR 121.1's "last card
    // drawn this turn" — the builder only supports the "me" seat, and only
    // as "whichever entry ends up LAST in the placement order", so the
    // matching entry is moved to the end of "me"'s hand placements below.
    //
    // CR 400.2 (issue #3452) — a hand card the CAPTURING view could not see is
    // an opaque placeholder (`PLACEHOLDER_CARD_ID`), which has no name to
    // lower and which `lowerCard` would throw on. It is COUNTED into
    // `hiddenHand` instead of dropped, and the builder seeds the count back as
    // placeholders of the same shape. This function is the single place that
    // count is taken: the caller no longer strips them first (`lowerDecision`
    // used to, and reported the loss in `dropped[]`), so a headless caller
    // passing a raw engine state — which has no placeholders — is unaffected
    // and every caller gets the same fidelity.
    const meNamedHand = visibleHand(me);
    const oppNamedHand = visibleHand(opp);
    const meHand = meNamedHand.map((card) =>
        lowerCard(state, me, card, "hand", "me", dropped)
    );
    const meLastDrawnIdx = me.lastDrawnCardId
        ? meNamedHand.findIndex((c) => c.id === me.lastDrawnCardId)
        : -1;
    const markLastDrawn = meLastDrawnIdx !== -1;
    if (markLastDrawn && meLastDrawnIdx !== meHand.length - 1) {
        const [entry] = meHand.splice(meLastDrawnIdx, 1);
        meHand.push(entry);
    }
    cards.push(...meHand);
    for (const card of oppNamedHand) {
        cards.push(lowerCard(state, opp, card, "hand", "opp", dropped));
    }
    if (
        opp.lastDrawnCardId &&
        opp.hand.some((c) => c.id === opp.lastDrawnCardId)
    ) {
        dropped.push(
            `opp's lastDrawnCardId — the scenario spec's "markLastDrawn" only supports the "me" seat; not lowered`
        );
    }

    const spec: ScenarioSpec = {
        cards,
        turn: state.turn,
        phase: state.phase,
        rngSeed: state.rngSeed,
        // CR 119.1 (issue #2147) — always explicit: 0 life is a real
        // position, not "absent" (mirrors the builder's own `!== undefined`
        // check), and the default (20) is only a coincidence, never a signal.
        life: { me: me.life, opp: opp.life },
        // CR 102.1 / 117.1 / 117.4 (issue #3454) — always explicit, for the
        // same reason as `life` above: "me is active with a fresh priority
        // round" is a real position, never "absent", and a captured spec must
        // rebuild the decision it was captured from rather than inherit
        // whatever game it is loaded into.
        activePlayer: state.activePlayerId === opts.mySeatId ? "me" : "opp",
        priority: state.priorityPlayerId === opts.mySeatId ? "me" : "opp",
        passCount: state.passCount,
        // Issue #3449 — what has already been cast, always explicit, for the
        // same reason as `life` and the three above and NOT the truthy-guarded
        // convention poison/experience follow. The builder leaves an omitted
        // field UNCHANGED, and `debugSetupScenario` rebuilds onto the LIVE
        // game rather than a fresh base: a position genuinely captured at
        // storm count 0, lowered as an absence and loaded mid-turn, would
        // inherit that game's count and make every storm spell in it copy
        // itself (CR 702.40a). Zero is a claim here, so it is written.
        spellsCastThisTurn: {
            me: me.spellsCastThisTurn ?? 0,
            opp: opp.spellsCastThisTurn ?? 0,
        },
        spellsCastThisGame: {
            me: me.spellsCastThisGame ?? 0,
            opp: opp.spellsCastThisGame ?? 0,
        },
        // CR 702.40a — the game-level Storm tally, NOT the sum of the two
        // seats above: `emitSpellCastEvent` increments it for every cast,
        // including one whose caster matches no seated player, so it is
        // captured as itself.
        stormCount: state.spellsCastThisTurn ?? 0,
        // Issue #3453 — what has already HAPPENED this turn, always explicit
        // for the same reason as the tallies above: the builder clears these
        // ledgers on every rebuild, so an omitted field is a claim of zero
        // either way, and writing it keeps the captured position readable as
        // the position it was rather than as an absence.
        damageDealtToPlayerThisTurn: {
            me: state.damageDealtToPlayerThisTurn?.[me.id] ?? 0,
            opp: state.damageDealtToPlayerThisTurn?.[opp.id] ?? 0,
        },
        artifactDamageToPlayerThisTurn: {
            me: state.artifactDamageToPlayerThisTurn?.[me.id] ?? 0,
            opp: state.artifactDamageToPlayerThisTurn?.[opp.id] ?? 0,
        },
        lifeGainedThisTurn: {
            me: state.lifeGainedThisTurn?.[me.id] ?? 0,
            opp: state.lifeGainedThisTurn?.[opp.id] ?? 0,
        },
        deathsThisTurn: state.deathsThisTurn ?? 0,
        creatureAttackedThisTurn: state.creatureAttackedThisTurn ?? false,
        // CR 500.1 (issue #3450) — always explicit, like `life` and the
        // tallies above: the builder does not clear `turnsTaken` (it is a
        // lifetime count), so lowering it as an absence would let a captured
        // position inherit the turn count of whatever game it is loaded into.
        turnsTaken: { me: me.turnsTaken ?? 0, opp: opp.turnsTaken ?? 0 },
    };
    if (markLastDrawn) spec.markLastDrawn = true;

    // CR 400.2 (issue #3452) — omitted when neither seat holds a card the
    // capturing view could not see, the `landsPlayed` convention rather than
    // `life`'s: the builder CLEARS both hands before seeding, so an absent
    // field round-trips to exactly the same position and every spec captured
    // from a perfect-information state stays byte-identical to what it was.
    const meHidden = me.hand.length - meNamedHand.length;
    const oppHidden = opp.hand.length - oppNamedHand.length;
    if (meHidden || oppHidden) {
        spec.hiddenHand = {};
        if (meHidden) spec.hiddenHand.me = meHidden;
        if (oppHidden) spec.hiddenHand.opp = oppHidden;
    }

    if (me.poisonCounters || opp.poisonCounters) {
        spec.poison = {};
        if (me.poisonCounters) spec.poison.me = me.poisonCounters;
        if (opp.poisonCounters) spec.poison.opp = opp.poisonCounters;
    }
    if (me.experienceCounters || opp.experienceCounters) {
        spec.experience = {};
        if (me.experienceCounters) spec.experience.me = me.experienceCounters;
        if (opp.experienceCounters) {
            spec.experience.opp = opp.experienceCounters;
        }
    }
    // CR 305.2 (issue #3446) — omitted when neither seat has played a land,
    // unlike `life` above: 0 is not a coincidence here but exactly what the
    // builder's own clear leaves, so an absent field round-trips to the same
    // position and the spec stays minimal.
    if (me.landsPlayedThisTurn || opp.landsPlayedThisTurn) {
        spec.landsPlayed = {};
        if (me.landsPlayedThisTurn) {
            spec.landsPlayed.me = me.landsPlayedThisTurn;
        }
        if (opp.landsPlayedThisTurn) {
            spec.landsPlayed.opp = opp.landsPlayedThisTurn;
        }
    }

    // CR 508.1c / 207.2c (issue #3450) — the three FLAGS, omitted when
    // neither seat carries them for the same reason `landsPlayed` is: false
    // is exactly what the builder's own clear leaves, so an absence
    // round-trips to the same position and the spec stays minimal.
    if (me.qualifyingActionThisTurn || opp.qualifyingActionThisTurn) {
        spec.qualifyingActionThisTurn = {};
        if (me.qualifyingActionThisTurn) {
            spec.qualifyingActionThisTurn.me = true;
        }
        if (opp.qualifyingActionThisTurn) {
            spec.qualifyingActionThisTurn.opp = true;
        }
    }
    if (me.qualifyingActionLastTurn || opp.qualifyingActionLastTurn) {
        spec.qualifyingActionLastTurn = {};
        if (me.qualifyingActionLastTurn) {
            spec.qualifyingActionLastTurn.me = true;
        }
        if (opp.qualifyingActionLastTurn) {
            spec.qualifyingActionLastTurn.opp = true;
        }
    }
    if (
        me.permanentYouControlledLeftThisTurn ||
        opp.permanentYouControlledLeftThisTurn
    ) {
        spec.revolt = {};
        if (me.permanentYouControlledLeftThisTurn) spec.revolt.me = true;
        if (opp.permanentYouControlledLeftThisTurn) spec.revolt.opp = true;
    }

    // CR 702.139c / ADR 0064 — the spec has exactly ONE companion slot; a
    // live game can have one PER SEAT.
    const companions = [
        me.companion ? { owner: "me" as const, ...me.companion } : undefined,
        opp.companion ? { owner: "opp" as const, ...opp.companion } : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (companions.length > 0) {
        const [first, ...rest] = companions;
        spec.companion = {
            name: displayNameForDefId(
                (first.instance.card as { id?: string }).id ?? "",
                false
            ),
            owner: first.owner,
            used: first.used,
        };
        for (const extra of rest) {
            dropped.push(
                `${extra.owner}'s companion — the scenario spec supports only ONE companion slot; not lowered`
            );
        }
    }

    // ---- global state the table in buildStateFromScenario doesn't cover --

    if (state.stack.length > 0) {
        dropped.push(
            `stack: ${state.stack.length} item(s) — the spell/ability stack isn't spec-expressible (see the blade suite's "setup" steps for a response-window position instead)`
        );
    }
    // The turn holder, the priority holder and the pass count used to be two
    // `dropped[]` notes here; issue #3454 gave the spec `activePlayer`,
    // `priority` and `passCount`, and the lowering above carries all three —
    // so they are no longer losses to report.
    // CR 508.1 / 509.1 (issue #3458) — the declaration and the per-turn combat
    // record. Two `dropped[]` notes used to stand here ("a scenario spec can
    // only seed an EMPTY DECLARE_ATTACKERS combat object" and its phase
    // sibling), and they took out every blocking decision, every combat trick
    // and every post-declaration response — the class PRD #3397 most needs
    // rows for. The spec carries the fact now, so the notes are gone rather
    // than relaxed; what remains reported is only what `spec.combat` genuinely
    // cannot express (`reportCombatResidue` below).
    lowerCombat(state, spec, dropped, opts.mySeatId);
    if (state.pendingCast) {
        dropped.push(
            `pendingCast: a spell payment is mid-flight — not lowered`
        );
    }
    if (state.pendingActivation) {
        dropped.push(
            `pendingActivation: an ability payment is mid-flight — not lowered`
        );
    }
    if (state.pendingCompanionPay) {
        dropped.push(
            `pendingCompanionPay: a companion summon is mid-flight — not lowered`
        );
    }
    if (state.pendingTarget) {
        dropped.push(
            `pendingTarget: a target selection is mid-flight — not lowered`
        );
    }
    if (state.pendingChoices && state.pendingChoices.length > 0) {
        dropped.push(
            `pendingChoices: ${state.pendingChoices.length} choice(s) awaiting input — not lowered`
        );
    }
    if (state.pendingTriggerBatch && state.pendingTriggerBatch.length > 0) {
        dropped.push(
            `pendingTriggerBatch: ${state.pendingTriggerBatch.length} unordered trigger(s) — not lowered`
        );
    }
    if (
        state.pendingReflexiveTriggers &&
        state.pendingReflexiveTriggers.length > 0
    ) {
        dropped.push(
            `pendingReflexiveTriggers: ${state.pendingReflexiveTriggers.length} — not lowered`
        );
    }
    if (state.madnessCastWindow) {
        dropped.push(
            `madnessCastWindow: an open Madness cast window — not lowered`
        );
    }
    if (state.reboundCastWindow) {
        dropped.push(
            `reboundCastWindow: an open Rebound cast window — not lowered`
        );
    }
    if (state.delayedTriggers && state.delayedTriggers.length > 0) {
        dropped.push(
            `delayedTriggers: ${state.delayedTriggers.length} pending — not lowered`
        );
    }
    if (state.emblems && state.emblems.length > 0) {
        dropped.push(
            `emblems: ${state.emblems.length} — command-zone emblems aren't spec-expressible`
        );
    }
    if (state.gameOver) {
        dropped.push(
            `gameOver — capturing a finished game as a scenario is unusual; the game-over state itself isn't lowered`
        );
    }
    if (
        (state.extraTurns && state.extraTurns.length > 0) ||
        (state.autoPassPlayers && state.autoPassPlayers.length > 0) ||
        state.singleShotAutoPass ||
        (state.queuedEndTurn && state.queuedEndTurn.length > 0)
    ) {
        dropped.push(
            `turn-scheduling state (extra turns / auto-pass intents) — not lowered`
        );
    }
    // CR 500.8 — its OWN message, not folded into the line above: a state
    // carrying only a Pass-Turn intent must not be reported as owing an extra
    // phase. The queue and its marker counter are deliberately not lowered —
    // a spec captures a BOARD, and a position mid-extra-combat (or owing one)
    // is turn-structure state the spec vocabulary has no field for. A preset
    // scenario for an extra-combat card captures the PRE-ATTACK setup instead
    // (ADR 0111).
    if (
        (state.extraPhases && state.extraPhases.length > 0) ||
        state.extraCombatsThisTurn
    ) {
        dropped.push(
            `turn-structure state (extra phases — CR 500.8) — not lowered`
        );
    }

    // CR 608.2 (issue #3453) — the per-turn resolution tallies whose SOURCE is
    // in no zone this function lowers (a library card, or an object that has
    // left the game entirely). `lowerCard` carries every tally whose source it
    // can see; these have nowhere to ride, and the allowlist entry for
    // `abilityResolutionCounts` would otherwise swallow them without a word.
    const loweredIds = new Set<string>();
    for (const p of [me, opp]) {
        for (const card of [
            ...p.battlefield,
            ...p.hand,
            ...p.graveyard,
            ...p.exile,
        ]) {
            loweredIds.add(card.id);
        }
    }
    const orphanedResolutions = Object.entries(
        state.abilityResolutionCounts ?? {}
    ).filter(
        // `count > 0` for the same reason the two functions above use it: a
        // zero entry says "hasn't resolved this turn", which is what an absent
        // key says, so losing one loses nothing.
        ([key, count]) =>
            count > 0 && !loweredIds.has(key.slice(0, key.indexOf(":")))
    );
    if (orphanedResolutions.length > 0) {
        dropped.push(
            `abilityResolutionCounts: ${orphanedResolutions.length} tally(ies) whose trigger source is in no lowered zone — the per-turn resolution count rides on its source card, and this one has none to ride on; not lowered`
        );
    }

    // CR 514.3a (issue #3453) — a capture taken INSIDE the extra cleanup
    // step's priority window is the one position where this marker is
    // load-bearing: it says the turn's once-per-turn cleanup bookkeeping has
    // already run, and the rebuild (which clears it) would run it a second
    // time. Reported rather than lowered because the spec has no field for the
    // marker — NOT because such a position is unreachable: `phase` is a free
    // string the builder assigns straight onto `state.phase`, and this very
    // capture lowers `phase: "CLEANUP"` (`SCENARIO_PHASES` constrains only the
    // admin select and the generator's enum).
    if (
        state.phase === "CLEANUP" &&
        state.cleanupBookkeepingTurn === state.turn
    ) {
        dropped.push(
            `cleanupBookkeepingTurn: captured inside the CR 514.3a extra cleanup step, whose once-per-turn bookkeeping has already run — a rebuild runs it again; not lowered`
        );
    }

    for (const [label, p] of [
        ["me", me],
        ["opp", opp],
    ] as const) {
        // CR 106.4 (issue #3460) — the floating pool, LOWERED since this
        // widening rather than reported: it decides what the seat can cast this
        // instant, so a rebuild that emptied it posed a different question than
        // the one judged. Omitted when empty, like `landsPlayed`: the builder
        // clears both pools, so an absence round-trips to the same position.
        const floating = Object.entries(p.manaPool).filter(([, n]) => n > 0);
        if (floating.length > 0) {
            spec.manaPool ??= {};
            spec.manaPool[label] = Object.fromEntries(floating);
        }
        // CR 106.6 — the restricted units. Everything the spec can name is
        // lowered; a unit whose permission is keyed to a card INSTANCE (Ice
        // Cauldron's `castableCardId`) is the one shape it cannot, so it is
        // reported on its own rather than swallowed by the blanket allowlist
        // entry — the `drawnThisTurn` precedent (issue #3240), where the
        // expressible shape is allowlisted and the rest still speaks up.
        const restricted = p.restrictedMana ?? [];
        // `amount > 0` on the type-keyed half only: a zero-amount unit carries
        // no mana, so dropping it loses nothing — but an INSTANCE-keyed unit is
        // reported whatever its amount, because the thing being lost is the
        // PERMISSION, not the mana.
        const typeKeyed = restricted.filter(
            (u) => u.castableCardId === undefined && u.amount > 0
        );
        if (typeKeyed.length > 0) {
            spec.restrictedMana ??= {};
            spec.restrictedMana[label] = typeKeyed.map((u) => {
                const unit: ScenarioRestrictedMana = {
                    color: u.color,
                    amount: u.amount,
                };
                if (u.restriction !== undefined) {
                    unit.restriction = u.restriction;
                }
                if (u.cantBeCounteredRider) unit.cantBeCounteredRider = true;
                if (u.hasteRider) unit.hasteRider = true;
                return unit;
            });
        }
        const instanceKeyed = restricted.filter(
            (u) => u.castableCardId !== undefined
        ).length;
        if (instanceKeyed > 0) {
            dropped.push(
                `${label}: ${instanceKeyed} restricted mana unit(s) whose spend permission names a card INSTANCE (Ice Cauldron — CR 106.6) — every rebuild reassigns instance ids, so the permission would name an object the rebuilt board doesn't contain; not lowered`
            );
        }
        if (p.library.length > 0) {
            dropped.push(
                `${label}'s library: ${p.library.length} card(s) — library contents/order are out of scope for a scenario spec`
            );
        }
        reportPlayerStateResidue(label, p, dropped);
    }

    reportGameStateResidue(state, dropped);

    return { spec, dropped };
}
