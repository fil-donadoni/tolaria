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
import { INDEFINITE_SOURCE_ID } from "./layer6";
import { basicLandsForColors, getCardColors } from "../cards/colors";
import { findTokenSpec, listTokenCatalogue } from "../cards/tokenCatalogue";
import type { Color } from "../cards/types";
import {
    resolveScenarioBattlefieldCounters,
    type ScenarioCard,
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
                    turnFaceDown(instance as CardInstanceState, "morph");
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

// ---- specFromState — lower a live position into a ScenarioSpec (#2148) ----
//
// The inverse of `buildStateFromScenario` above, kept in the SAME file so the
// two can't drift apart. `dropped[]` is the feature, not decoration: a
// `ScenarioSpec` can express only what the table in `buildStateFromScenario`
// consumes (battlefield/hand/graveyard/exile placement, tapped, counters,
// attachments, damage, phase, turn, poison/life/experience, one companion
// slot). Everything else a live `GameState` can hold — the stack, mana pool,
// a mid-flight payment, combat beyond an empty DECLARE_ATTACKERS seed,
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

const COMBAT_PHASES_NEEDING_SETUP: Phase[] = [
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
];

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
 *  `applySourceStaticEffects` across the whole battlefield on every load
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
const CARD_STATE_ALLOWLIST = new Set<string>([
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
    "damageMarked",
    "attachedTo",
    "attackedDuringLastTurn",
    "faceDown",
    // Rebuild BEHAVIOUR: `buildStateFromScenario` restamps it by calling
    // `turnFaceDown` for a `faceDown` entry (issue #2904), so it is never
    // spec-keyed data and never dropped.
    "faceDownBy",
    "faceDownOf",
    "copiedFrom",
    "castableFromExileBy",
    "castableFromExileUntilTurn",
    "castableFromExileIncludesLand",
    // Rebuild behaviour, not spec-keyed data: `applySourceStaticEffects`
    // (CR 611.2) re-derives every CONTINUOUS grant/strip from a
    // still-present battlefield source on every load, exactly as the
    // original build did — see `reportCharacteristicDrift`'s doc.
    // `reportCardResidue` below still catches the one shape that ISN'T
    // re-derived: a `duration`-scoped (temporary) grant.
    "enteredOnTurn",
    "chosenPlayerId",
    "staticSeq",
    "grantedStaticAbilities",
    "grantedActivatedAbilities",
    "grantedTriggeredAbilities",
    "removedKeywords",
    "abilitiesSuppressedBy",
    // Same class, PRD #2064 S3: `baseStaticAbilities` is the pre-layer-6
    // keyword multiset and `abilityLossHolds` the resolving-ability ledger.
    // The base is re-captured from the reloaded `staticAbilities` at the first
    // `syncLayer6`, so it is rebuild behaviour, never spec-keyed data. A hold
    // whose source has left is caught by `reportCardResidue` below, on the same
    // rule as a duration-scoped grant.
    "baseStaticAbilities",
    "abilityLossHolds",
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
 *  has no source permanent for `applySourceStaticEffects` to replay — and an
 *  `auraId`-scoped entry whose aura has since left BOTH battlefields, which
 *  leaves `applySourceStaticEffects` nothing to walk on reload either. */
function reportTemporaryGrantResidue(
    state: GameState,
    card: CardInstanceState,
    label: string,
    dropped: string[]
): void {
    const fields = [
        "grantedStaticAbilities",
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
                `${label}: ${field} sourced from an aura no longer on either battlefield — applySourceStaticEffects has nothing to replay it from on reload; not spec-expressible`
            );
        }
    }
}

/** True when `sourceId` is still a permanent on EITHER player's battlefield
 *  in the LIVE state being lowered — the precondition for
 *  `applySourceStaticEffects` to re-derive a source-keyed grant/removal on
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
 *  `granted*` entry: `applySourceStaticEffects` re-derives the strip on
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
    const danglingRemoved = (card.removedKeywords ?? []).filter(
        (r) =>
            r.sourceId !== INDEFINITE_SOURCE_ID &&
            !sourceStillOnBattlefield(state, r.sourceId)
    );
    if (danglingRemoved.length > 0) {
        dropped.push(
            `${label}: removedKeywords stripped by a source no longer on either battlefield (${danglingRemoved
                .map((r) => r.keyword)
                .sort()
                .join(
                    ", "
                )}) — applySourceStaticEffects has nothing to replay it from on reload; not spec-expressible`
        );
    }
    const danglingSuppressed = (card.abilitiesSuppressedBy ?? []).filter(
        (s) =>
            s.sourceId !== INDEFINITE_SOURCE_ID &&
            !sourceStillOnBattlefield(state, s.sourceId)
    );
    if (danglingSuppressed.length > 0) {
        dropped.push(
            `${label}: abilitiesSuppressedBy a source no longer on either battlefield — applySourceStaticEffects has nothing to replay it from on reload; not spec-expressible`
        );
    }
}

/** Generic "continuous effect residue" detector — the fallback for the many
 *  optional `CardInstanceState` fields NOT named individually above
 *  (`temporaryPTMods`, `animation`, `controlChanges`, `chosenMana`,
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

    if (zone === "battlefield") {
        if (card.isTapped) entry.tapped = true;
        if (card.damageMarked) entry.damageMarked = card.damageMarked;
        if (card.counters && Object.keys(card.counters).length > 0) {
            entry.counters = { ...card.counters };
        }
        if (card.attackedDuringLastTurn) entry.attackedLastTurn = true;
        if (card.isSummoningSick) entry.summoningSick = true;

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
const GAME_STATE_ALLOWLIST = new Set<string>([
    // Structural — always present, not itself residue.
    "players",
    // Lowered into the spec directly.
    "turn",
    "phase",
    "rngSeed",
    // Covered by a bespoke `dropped` message below.
    "stack",
    "activePlayerId",
    "priorityPlayerId",
    "passCount",
    "combat",
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
const PLAYER_STATE_ALLOWLIST = new Set<string>([
    "id",
    "name",
    "bgColor",
    "life",
    "hand",
    "library",
    "graveyard",
    "exile",
    "battlefield",
    "manaPool",
    "restrictedMana",
    "poisonCounters",
    "experienceCounters",
    "companion",
    "lastDrawnCardId",
    // Wire-projection-only additions — see this Set's doc comment.
    "librarySearch",
    "libraryPeek",
    "revealedHand",
]);

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
 * (the stack, mana pool, a mid-flight payment, combat beyond an empty
 * DECLARE_ATTACKERS seed, delayed triggers, per-card continuous-effect
 * residue, library contents, …) rather than silently omitting it — the whole
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
    const meHand = me.hand.map((card) =>
        lowerCard(state, me, card, "hand", "me", dropped)
    );
    const meLastDrawnIdx = me.lastDrawnCardId
        ? me.hand.findIndex((c) => c.id === me.lastDrawnCardId)
        : -1;
    const markLastDrawn = meLastDrawnIdx !== -1;
    if (markLastDrawn && meLastDrawnIdx !== meHand.length - 1) {
        const [entry] = meHand.splice(meLastDrawnIdx, 1);
        meHand.push(entry);
    }
    cards.push(...meHand);
    for (const card of opp.hand) {
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
    };
    if (markLastDrawn) spec.markLastDrawn = true;

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
    if (state.activePlayerId !== opts.mySeatId) {
        dropped.push(
            `active player is "opp" — buildStateFromScenario has no field to choose the turn holder; the rebuilt state's active player is whatever the fresh base game started with (normally "me")`
        );
    }
    if (
        state.priorityPlayerId !== state.activePlayerId ||
        state.passCount !== 0
    ) {
        dropped.push(
            `priority: held by ${
                state.priorityPlayerId === state.activePlayerId
                    ? "the active player, with a pass already banked"
                    : "the non-active player"
            } (passCount=${state.passCount}) — buildStateFromScenario always resets priority to the active player with passCount 0`
        );
    }
    const combat = state.combat;
    if (
        combat &&
        (combat.attackerIds.length > 0 ||
            combat.confirmed ||
            Object.keys(combat.blockerAssignments).length > 0 ||
            combat.blockersConfirmed)
    ) {
        dropped.push(
            `combat: attackers/blockers already declared — a scenario spec can only seed an EMPTY DECLARE_ATTACKERS combat object; use a blade "setup" step (declare-attackers) to reach a declared-combat position`
        );
    } else if (COMBAT_PHASES_NEEDING_SETUP.includes(state.phase)) {
        dropped.push(
            `phase "${state.phase}": buildStateFromScenario only re-seeds "combat" for phase "DECLARE_ATTACKERS" — loading this spec lands on ${state.phase} with NO combat object; use a blade "setup" step instead`
        );
    }
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

    for (const [label, p] of [
        ["me", me],
        ["opp", opp],
    ] as const) {
        const floating = Object.entries(p.manaPool).filter(([, n]) => n !== 0);
        if (floating.length > 0) {
            dropped.push(
                `${label}'s mana pool: ${floating
                    .map(([c, n]) => `${n}${c}`)
                    .join(
                        " "
                    )} — not lowered (mana pool isn't spec-expressible)`
            );
        }
        if (p.restrictedMana && p.restrictedMana.length > 0) {
            dropped.push(`${label} has restricted floating mana — not lowered`);
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
