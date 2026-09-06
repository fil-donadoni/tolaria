// The wire's copy of the CR 613 derivation (ADR 0082, PRD #2064 S5).
//
// `projectPublicState` used to ship whatever `syncLayers2to5` / `syncLayer6`
// last wrote onto each `CardInstanceState`. That made every projected
// characteristic a CACHE of the registry rather than a read of it, and the
// cache is what S6 deletes: the moment the materialised fields go, a projection
// that reads them ships nothing, and the client-side engine run
// (`src/lib/ai/state-adapter.ts`, ADR 0074) silently loses every granted and
// every removed keyword — a wrong-move bug in the Bot with no gate to catch it.
//
// So the projection derives. This module is the one place that does it, and it
// derives through the SAME two board passes the engine syncs through
// (`deriveLayers2to5Board`, `deriveLayer6Board`) and the SAME two field
// mappers the engine writes through (`layers2to5DerivedFields`,
// `layer6DerivedFields`). There is no second derivation and no second field
// list — a projected characteristic that disagreed with the engine's answer
// would have to come from one of those, and neither exists.
//
// WHY A CLONE. Both board passes perform the one-shot base capture
// (`ensureLayers2to5Base` / `ensureLayer6Base`) and the pre-S3/S4 legacy
// migrations, which MUTATE the permanents they are given and are correct
// exactly once. A query must not perform either on live state: the mutation
// path is where those belong, and running the layers-2-5 migration twice
// promotes this engine's own derived output into permanent ledger rows ("the
// effect applies twice, forever" — `ensureLayers2to5Base`). The passes
// therefore run over a SHALLOW clone of the board: one fresh object per player
// and per battlefield permanent, everything below shared. Nothing in the
// derivation writes below the permanent.

import type { CardInstanceState, GameState } from "./state";
import { deriveLayer6Board, layer6DerivedFields } from "./layer6";
import { deriveLayers2to5Board, layers2to5DerivedFields } from "./layers2to5";

/** The derived characteristics of one permanent, as the exact instance fields
 *  the wire has always carried. Shapes and names are unchanged — only the
 *  provenance is (PRD #2064 S5 AC 3: the client call sites stay untouched). */
export type WireCharacteristics = Partial<CardInstanceState>;

/** A shallow clone of the board: fresh player objects, a fresh array of fresh
 *  permanent objects, everything below shared with `state`. Cheap enough to pay
 *  once per projection, and the only thing standing between a read-only query
 *  and the one-shot migrations the derivation passes carry. */
function cloneBoard(state: GameState): GameState {
    return {
        ...state,
        players: state.players.map((player) => ({
            ...player,
            battlefield: player.battlefield.map((card) => ({ ...card })),
        })),
    } as GameState;
}

/** CR 613 — every battlefield permanent's derived characteristics, keyed by
 *  instance id, computed from `state.continuousEffects` and nothing else.
 *
 *  Layers 2-5 first and layer 6 second, in that order and with the layer-2-5
 *  answer written back onto the clone in between, because layer 6's predicates
 *  read the type line the lower layers produce (CR 613.1 composes layers over
 *  the output of the ones below). That is the order and the interleaving
 *  `gre/state.ts` calls the two syncs in.
 *
 *  Layer 7 is deliberately absent: P/T is not materialised on the instance at
 *  all — it is computed at read time by `getEffectivePower` /
 *  `getEffectiveToughness`, on both sides of the wire, from the registry the
 *  projection now carries. There is nothing to derive INTO a field here.
 *
 *  Permanents that are PHASED OUT (CR 702.26b) are not on the battlefield and
 *  get no entry: they are treated as though they do not exist, no continuous
 *  effect applies to them, and the projection ships their instance fields
 *  unchanged. */
export function deriveWireCharacteristics(
    state: GameState
): Map<string, WireCharacteristics> {
    const board = cloneBoard(state);
    const patches = new Map<string, WireCharacteristics>();

    // `deriveAll` — the sync's fast path skips a permanent whose fields already
    // hold its base, because it is about to write those same fields. A consumer
    // that reads the RESULT has nothing to read for a skipped permanent, and
    // falling back to the instance field is precisely what this module exists
    // to stop.
    for (const { card, result } of deriveLayers2to5Board(board, {
        deriveAll: true,
    })) {
        const fields = layers2to5DerivedFields(card, result);
        // Two of the sync's writes are NOT characteristics and are dropped
        // before the patch reaches the wire, because `deriveAll` would
        // otherwise put them on every permanent the sync's fast path skips —
        // measured at 884 bytes on a 16-permanent, 6.5 KB projection (13.5%) on
        // the hottest row in the system (#1780, #3051).
        //
        //  * `layers2to5Derived` is an ENGINE marker gating a one-shot pre-S4
        //    migration, not something any client renders. A skipped permanent
        //    ships without it today and is unharmed: the migration reads only
        //    ledger fields, and "skipped" means it carries none.
        //  * `printedSubtypes` is the pre-slice ALIAS of `baseSubtypes`, which
        //    rides the wire already — `layer4SubtypeBase` reads the alias only
        //    when `baseSubtypes` is absent, and it never is. Paying for the
        //    same array twice per permanent is the read-amplification class
        //    #1780 interned card ids to fix.
        delete fields.layers2to5Derived;
        delete fields.printedSubtypes;
        const patch: WireCharacteristics = {
            ...fields,
            // CR 613.1b — layer 2's answer. The engine applies it by RELOCATING
            // the permanent between battlefield arrays; a projection cannot
            // (and must not) move a card between the seats it is projecting, so
            // it carries the derived controller on the card and leaves the
            // array alone. The two can only disagree on a state no sync has run
            // over yet, which `getPublicState` never sees: every save point is
            // downstream of a sync.
            controllerId: result.controllerId,
            // THE BASES, alongside the derived output — not an afterthought.
            // `layer4TypeBase` and friends fall back to the OUTPUT field when
            // the base is absent, which is exactly the feedback loop
            // `baseSubtypes` / `baseStaticAbilities` were introduced to break:
            // a client handed `types: [Creature, Artifact]` and no `baseTypes`
            // re-derives the type-change entry on top of its own answer and
            // adds Artifact twice. The capture happened on the clone
            // (`ensureLayers2to5Base`), so without these three the wire would
            // carry a derivation the client cannot reproduce.
            baseControllerId: card.baseControllerId,
            baseTypes: card.baseTypes,
            baseSubtypes: card.baseSubtypes,
        };
        patches.set(card.id, patch);
        // Feed the layer-2-5 answer back into the clone so layer 6 derives
        // against it rather than against the pre-layer-4 type line.
        Object.assign(card, patch);
    }

    for (const { card, result } of deriveLayer6Board(board)) {
        patches.set(card.id, {
            ...patches.get(card.id),
            ...layer6DerivedFields(card, result),
            // The layer-6 base, for the reason the layer-2-5 bases ride along
            // above: `layer6Base` falls back to `staticAbilities`, so a wire
            // card carrying the DERIVED multiset and no base makes the client's
            // own `deriveLayer6` grant every keyword a second time and remove
            // printed ones that are no longer in what it reads as the base.
            baseStaticAbilities: card.baseStaticAbilities,
            // CR 611.2b — and the migration's OUTPUT with it. Supplying the
            // base above DISARMS the client's own legacy pass:
            // `deriveLayer6Board` reads `legacy = baseStaticAbilities ===
            // undefined`, so a client handed the base can never run
            // `migrateLegacyAbilityLossHolds` for itself. On a `game_state`
            // persisted before PRD #2064 S3 (#3004) that carries a
            // resolution-armed "loses all abilities" hold in
            // `abilitiesSuppressedBy` and no `abilityLossHolds`, the server
            // clone migrates and the client cannot — so the Brain would
            // re-derive the permanent WITH the abilities the resolution took
            // away and enumerate moves for a board that does not exist. The
            // ledger is the migration's product, and it costs nothing on every
            // state that already has one (absent → absent). Dies with S6,
            // alongside the migration itself.
            abilityLossHolds: card.abilityLossHolds,
        });
    }

    return patches;
}

/** Applies a permanent's derived characteristics, producing a fresh instance.
 *
 *  Call it BEFORE `slimCard`, never after. `WireCharacteristics` is a
 *  `Partial<CardInstanceState>`, so a future field mapper could name `knownTo`,
 *  `sourceLki`, `capturedBindings` or `stormSnapshot` — the four fields
 *  `slimCard` deletes — and reinstate one with no `tsc` error. Ordering the
 *  strip last makes that impossible instead of merely unlikely, which is the
 *  fail-closed default `slimCard`'s own header argues for (#1977/#1982).
 *
 *  Keys whose derived value is `undefined` are DELETED rather than assigned:
 *  the patch spells "this permanent has no granted subtypes" as
 *  `grantedSubtypes: undefined`, and spreading that onto the wire object would
 *  leave an explicit `undefined` where the field used to be absent. Convex
 *  drops undefined values on the way out, but the in-process consumers — the
 *  Bot's `projectedToGameState`, every projection test — see the object as it
 *  is built here, so it is stripped at the source. */
export function applyWireCharacteristics<T extends { id: string }>(
    projected: T,
    patch: WireCharacteristics | undefined
): T {
    if (!patch) return projected;
    const out = { ...projected, ...patch } as T & Record<string, unknown>;
    for (const key of Object.keys(patch)) {
        if ((patch as Record<string, unknown>)[key] === undefined) {
            delete out[key];
        }
    }
    return out as T;
}
