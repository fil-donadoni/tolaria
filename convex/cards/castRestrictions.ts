// Shared, frontend-safe evaluation of battlefield-scanned, player-scoped
// casting restrictions (CR 601.3a / 601.2) — Brand of Ill Omen (#669).
//
// Lives under `convex/cards/` (NOT `convex/gre/`) so the React client can call
// it directly to gray out a hand card the player can't legally cast, while the
// GRE (`getLegalActions`) and the cast mutation (`playCard` / cast path) call it
// server-side. A `cast-restriction` static declared by ANY permanent can forbid
// a player from casting a class of spell — the player-scoped analogue of how
// `global-attack-restriction` (Moat) scans all permanents to forbid attacks.
//
// Mirrors `attackRestrictions.ts`: the same shared, state-free
// `StaticEffectContext` and the same "scan every battlefield, return the first
// matching source's oracle text" shape. Read-time only: a `cast-restriction`
// never mutates a permanent (`applySourceStaticEffects` ignores the kind), so
// it carries no per-instance flag and auto-reverts when the source leaves play.

import { tryGetDefinition } from ".";
import { getEffectiveColors } from "./effectiveColors";
import { matchesPermanentFilter } from "./filters";
import type { MatchablePermanent } from "./filters";
import { liveSupertypesOf } from "./snowReads";
import type { SupertypeView } from "./snowReads";
import type {
    CardType,
    CastCondition,
    ManaCost,
    PermanentView,
    StaticEffectContext,
} from "./types";

/** Pure, state-free `StaticEffectContext` shared by the engine and the client
 *  for cast-restriction predicates. Mirrors `ATTACK_RESTRICTION_CTX` in
 *  `attackRestrictions.ts` — only the helpers a cast-restriction predicate
 *  needs (`isCreature`, `getPrintedTypes`, `getColors`, `getName`) carry real
 *  logic; the rest delegate to the same registry lookups. */
export const CAST_RESTRICTION_CTX: StaticEffectContext = {
    // CR 613.1d layer 5 — the single colour authority
    // (`./effectiveColors.ts`), `grantedColors` included (this copy dropped
    // them: a "you can't cast black spells" restriction must see a colour a
    // layer-5 grant added).
    getColors: getEffectiveColors,
    isCreature(card: PermanentView): boolean {
        return card.types.includes("Creature");
    },
    hasSubtype(card: PermanentView, subtype: string): boolean {
        return card.subtypes.includes(subtype);
    },
    hasSupertype(card: PermanentView, supertype: string): boolean {
        const embedded = (card.card as { supertypes?: string[] }).supertypes;
        if (embedded) return embedded.includes(supertype);
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return def?.supertypes?.includes(supertype as never) ?? false;
    },
    getManaValue(card: PermanentView): number {
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ??
            (cardId ? tryGetDefinition(cardId)?.manaCost : undefined);
        if (!cost) return 0;
        let total = 0;
        for (const [k, v] of Object.entries(cost)) {
            if (k === "xFactor") continue;
            if (typeof v === "number") total += v;
        }
        return total;
    },
    getPrintedTypes(card: PermanentView): CardType[] {
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return (def?.types ?? []) as CardType[];
    },
    getName(card: PermanentView): string {
        const embedded = (card.card as { name?: string }).name;
        if (embedded) return embedded;
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        return def?.name ?? "";
    },
    getCounterCount(card: PermanentView, type: string): number {
        return card.counters?.[type] ?? 0;
    },
};

/** Minimal board view the scan needs — each player's battlefield as
 *  `PermanentView`-compatible instances. Both `GameState` (server) and the
 *  client's `Player[]` satisfy this structurally. */
export interface CastRestrictionStateView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
    /** CR 601.3a / 514.2 — players under a turn-scoped "can't cast spells this
     *  turn" lock (Xantid Swarm, issue #1057; Abeyance narrows it via
     *  `cardTypes`, issue #1124). A per-player turn flag set by an effect and
     *  cleared at CLEANUP — distinct from the battlefield-scanned,
     *  permanent-sourced `cast-restriction` statics below. Survives the wire
     *  projection (`projectPublicState` spreads it), so the client's cast gate
     *  reads it too. An omitted/empty `cardTypes` forbids every spell. */
    cannotCastSpellsThisTurn?: ReadonlyArray<{
        playerId: string;
        cardTypes?: readonly CardType[];
    }>;
    /** CR 601.3e (Teferi, Time Raveler +1) — per-player "cast spells of these
     *  types as though they had flash" grants. Read by `hasCastTimingFlashGrant`
     *  to widen a sorcery-speed card's timing window. Survives the wire
     *  projection (`projectPublicState` spreads it), so the client's cast gate
     *  reads it too. An omitted/empty `cardTypes` grants flash for every spell. */
    castTimingFlashGrants?: ReadonlyArray<{
        playerId: string;
        cardTypes?: readonly CardType[];
    }>;
}

/** Scans EVERY permanent on the battlefield for `cast-timing-lock` static
 *  effects (CR 601.3a — Teferi, Time Raveler's static: "Each opponent can cast
 *  spells only any time they could cast a sorcery") and returns `true` when one
 *  restricts `casterId` to sorcery-speed casting. The TIMING analogue of
 *  `castProhibitionReason` (which forbids a CLASS of spell). Used by the GRE
 *  (`getLegalActions`), the cast mutation, and the client so all three agree.
 *  The lock narrows WHEN a spell can be cast; the caller (`getLegalActions`)
 *  combines it with the phase/stack/priority timing check it already has. */
export function isCastTimingSorcerySpeedLocked(
    casterId: string,
    state: CastRestrictionStateView
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "cast-timing-lock") continue;
                if (
                    effect.locks(
                        casterId,
                        source,
                        state as never,
                        CAST_RESTRICTION_CTX
                    )
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** CR 601.3e — `true` when `casterId` holds a `castTimingFlashGrant` (Teferi's
 *  +1) covering `spell`: an entry for that player whose `cardTypes` intersect
 *  the spell's printed types (or an entry with no `cardTypes`, covering every
 *  spell). Lets the caller treat an otherwise sorcery-speed spell as if it had
 *  flash. */
export function hasCastTimingFlashGrant(
    casterId: string,
    spell: PermanentView,
    state: CastRestrictionStateView
): boolean {
    const grants = state.castTimingFlashGrants;
    if (!grants) return false;
    const printedTypes = CAST_RESTRICTION_CTX.getPrintedTypes(spell);
    for (const g of grants) {
        if (g.playerId !== casterId) continue;
        if (!g.cardTypes || g.cardTypes.some((t) => printedTypes.includes(t))) {
            return true;
        }
    }
    return false;
}

/** Adapts a `PermanentView` — the board shape `GameState`, the client's
 *  `Player[]` and the wire-projected state all satisfy — to the
 *  `MatchablePermanent` `matchesPermanentFilter` reads.
 *
 *  Live-first, printed-fallback: `supertypes` come from `liveSupertypesOf`
 *  (CR 205.4a — honouring Melting / Arcum's Weathervane supertype mutations,
 *  not just the printed line), `staticAbilities` from the instance where an
 *  aura/layer-6 grant wrote them and from the definition otherwise, colours
 *  from the single layer-5 authority `CAST_RESTRICTION_CTX.getColors`.
 *
 *  `enteredThisTurn` / `controlledSinceTurnStart` are deliberately NOT
 *  populated: both need data outside this board view (`GameState.turn`, the
 *  `controlChangedThisTurn` ledger).
 *
 *  DO NOT use either field in a `CastCondition.filter` until they are.
 *  `matchesPermanentFilter` (`./filters.ts`) compares
 *  `filter.X !== (card.X === true)`, so an ABSENT datum reads `false` and the
 *  direction depends on what the filter asserts: `X: true` matches nothing
 *  (fail CLOSED — the spell stays uncastable, harmless), but `X: false`
 *  matches EVERY permanent (fail OPEN — the condition is satisfied by
 *  anything and the spell becomes freely castable). No live card hits this
 *  today; the note is here so the next author doesn't write the fail-open
 *  half. Populating the two fields here — which needs `CastRestrictionStateView`
 *  widened with `turn` and the control ledger — is the real fix. */
function toMatchablePermanent(perm: PermanentView): MatchablePermanent {
    const granted = (perm as { staticAbilities?: readonly string[] })
        .staticAbilities;
    const cardId = (perm.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return {
        id: perm.id,
        name: CAST_RESTRICTION_CTX.getName(perm),
        types: perm.types,
        subtypes: perm.subtypes,
        supertypes: liveSupertypesOf(perm as unknown as SupertypeView),
        staticAbilities: granted ?? def?.staticAbilities ?? [],
        controllerId: perm.controllerId,
        isToken: perm.isToken,
        colors: CAST_RESTRICTION_CTX.getColors(perm),
        power: perm.power,
        toughness: perm.toughness,
        isAttacking: perm.isAttacking,
        isBlocking: perm.isBlocking,
        isTapped: perm.isTapped,
    };
}

/** Whether a single `CastCondition` currently holds for `casterId`.
 *
 *  The `switch` on `kind` is the EXPLICIT, fail-CLOSED discriminator (see
 *  `CastCondition`): a `kind` this evaluator does not recognise returns
 *  `false`, so the spell is uncastable and the omission is loud, rather than
 *  returning `true` and silently dropping the card's Oracle clause. */
function castConditionMet(
    condition: CastCondition,
    casterId: string,
    state: CastRestrictionStateView
): boolean {
    switch (condition.kind) {
        // CR 109.4 / 205.4a — "…only if you control <filter>". Control, not
        // ownership: scan EVERY battlefield and keep the permanents whose
        // live `controllerId` is the caster's, so a permanent stolen by
        // Control Magic counts for its new controller (`applyControlChange`
        // flips `controllerId` and moves the instance together).
        case "control": {
            const need = Math.max(1, condition.minCount ?? 1);
            let found = 0;
            for (const player of state.players) {
                for (const perm of player.battlefield) {
                    if (perm.controllerId !== casterId) continue;
                    // No `supertypesOf` fallback is injected:
                    // `toMatchablePermanent` ALWAYS sets `supertypes` (live,
                    // snow-aware), and `matchesPermanentFilter` reads
                    // `card.supertypes ?? ctx?.supertypesOf?.(card)` — so the
                    // callback could never fire, and a `MatchablePermanent`
                    // carries no `card`/`grantedSupertypes` for
                    // `liveSupertypesOf` to read anyway.
                    if (
                        !matchesPermanentFilter(
                            toMatchablePermanent(perm),
                            condition.filter,
                            { selfControllerId: casterId }
                        )
                    ) {
                        continue;
                    }
                    found += 1;
                    if (found >= need) return true;
                }
            }
            return false;
        }
        default:
            // Fail CLOSED (CR 601.3a): an unrecognised discriminator means
            // this build cannot evaluate the card's cast clause, so it must
            // not let the spell through.
            return false;
    }
}

/** CR 601.3a — the card's OWN cast condition ("Cast this spell only if you
 *  control a snow land", Blizzard). Returns the condition's player-facing
 *  `reason` when it is currently UNMET, else `undefined`.
 *
 *  Read from the `CardDefinition` of the would-be-cast `spell`, so it survives
 *  the wire projection (which strips `card.card` to `{ id }`) — the definition
 *  is re-resolved through `tryGetDefinition` exactly as every other read in
 *  this module does. Called by `castProhibitionReason` — the single shared
 *  gate; see its docstring for the two chokepoints that reach it. */
export function castConditionUnmetReason(
    casterId: string,
    spell: PermanentView,
    state: CastRestrictionStateView
): string | undefined {
    const cardId = (spell.card as { id?: string }).id;
    if (!cardId) return undefined;
    const condition = tryGetDefinition(cardId)?.castCondition;
    if (!condition) return undefined;
    return castConditionMet(condition, casterId, state)
        ? undefined
        : condition.reason;
}

/** The single shared cast gate (CR 601.3a). Returns a player-facing reason when
 *  `casterId` may not cast `spell` right now, else `undefined` — folding the
 *  card's OWN `castCondition`, the per-player turn lock, and a battlefield scan
 *  for `cast-restriction` statics into one answer.
 *
 *  It is the single EVALUATOR, but it is NOT reached through a single call
 *  site. Two chokepoints call it, and a cast-legality change must keep both
 *  wired:
 *
 *   1. `getLegalActions` (`convex/gre/rules.ts`) — the ANNOUNCE path, shared by
 *      the GRE, the cast mutation (via `assertLegalAction`), the wire
 *      `legalActions` the client's Cast affordance reads, and the Bot's
 *      `enumerateCastMoves`.
 *   2. `castChosenSpell` / `castFaceDown` (`convex/gre/state.ts`) — the
 *      RESOLUTION-TIME cast primitives. Casting during a resolution
 *      (`castDuringResolution`, CR 608.2g), Word of Command's controlled cast
 *      and Illusionary Mask's face-down cast never produce a legal ACTION at
 *      all, so they never pass through `getLegalActions`; before issue #2102's
 *      review they bypassed this gate entirely.
 *
 *  The client also calls it directly to gray out an uncastable hand card. Every
 *  caller CALLS this function — none re-implements a restriction — so there is
 *  still exactly one place a rule is evaluated. */
export function castProhibitionReason(
    casterId: string,
    spell: PermanentView,
    state: CastRestrictionStateView
): string | undefined {
    // CR 601.3a (issue #2102) — the card's OWN "Cast this spell only if
    // <board predicate>" clause (Blizzard). Checked FIRST and inside this
    // shared gate on purpose: one declaration on the card then covers server,
    // client and bot through both chokepoints above, with no second
    // implementation to drift.
    const conditionUnmet = castConditionUnmetReason(casterId, spell, state);
    if (conditionUnmet !== undefined) return conditionUnmet;
    // CR 601.3a (issue #1057) — a turn-scoped per-player cast lock (Xantid
    // Swarm: "defending player can't cast spells this turn"; Abeyance, issue
    // #1124, narrows it to instant/sorcery via `cardTypes`). Unlike the
    // permanent-sourced statics scanned below, this is a PlayerState-turn flag
    // set by an effect and cleared at CLEANUP (CR 514.2), so it is checked
    // directly rather than via a battlefield scan. Lands are unaffected —
    // rules.ts only calls this on the spell-cast path, never on land plays.
    const lock = state.cannotCastSpellsThisTurn?.find(
        (e) => e.playerId === casterId
    );
    if (lock) {
        const printedTypes = CAST_RESTRICTION_CTX.getPrintedTypes(spell);
        if (
            !lock.cardTypes ||
            lock.cardTypes.some((t) => printedTypes.includes(t))
        ) {
            return "That player can't cast spells this turn.";
        }
    }
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "cast-restriction") continue;
                if (
                    effect.forbids(
                        casterId,
                        spell,
                        source,
                        state as never,
                        CAST_RESTRICTION_CTX
                    )
                ) {
                    return effect.oracleText;
                }
            }
        }
    }
    return undefined;
}
