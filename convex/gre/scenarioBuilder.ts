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

import { getCardByName, tokenDefinitionId, tryGetDefinition } from "../cards";
import { basicLandsForColors, getCardColors } from "../cards/colors";
import { findTokenSpec } from "../cards/tokenCatalogue";
import type { Color } from "../cards/types";
import {
    resolveScenarioBattlefieldCounters,
    type ScenarioSpec,
} from "../debugScenarioSpec";
import {
    type CardInstanceState,
    type GameState,
    type PlayerState,
    allocInstanceId,
    applySourceStaticEffects,
    createTokenPermanents,
    exileFaceDownCard,
    getOpponentId,
} from "./state";
import { applyCopy } from "./copy";
import { resolveEntersWithCounters } from "../cards/entersWith";
import { turnFaceDown } from "./faceDown";
import { finalizeMulligan } from "./mulligan";
import { isPlaneswalker } from "./constants";
import type { Phase } from "./types";

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
                    exileFaceDownCard(player, instance.id, "exile", player.id);
                }
                // #946 (CR 601.3e / 608.2g) — grant "me" a this-turn play-
                // from-exile permission so a Play (land) / Cast (spell)
                // affordance appears; the current turn stamps the expiry so
                // it lapses at cleanup. CR 305.9 (issue #1689) — a cast
                // permission alone does NOT authorize playing a land (a land
                // is never cast), so this stamps `castableFromExileIncludesLand`
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
                    turnFaceDown(instance as CardInstanceState);
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
                    applyCopy(instance as CardInstanceState, source);
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
            applySourceStaticEffects(state, source);
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

    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
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

    return state;
}
