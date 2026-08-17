// Continuous "permanent-guard" static effects (CR 611 continuous effects).
//
// A `permanent-guard` static effect (convex/cards/types.ts `StaticPermanentGuard`)
// is a battlefield-wide protection bundle that is evaluated LIVE at each gate
// rather than timestamp-applied to the target's `staticAbilities`. This is the
// same live-query model used by `isProtectedFromColors` (CR 702.16b) and
// `isCombatDamageImmune` (Ebony Horse): the guard is queried at the moment the
// protected action is attempted, so its `applies` predicate observes the
// current board state — including mutable source state like tap status.
//
// Guardian Beast (ARN) is the first user: "As long as Guardian Beast is
// untapped, noncreature artifacts you control can't be enchanted, can't be the
// targets of spells or abilities, have indestructible, and their control can't
// be changed." The "as long as ~ is untapped" clause is why this can't reuse
// `keyword-grant`: that machinery applies/reverts on the source's
// enter/leave-the-battlefield only, never on a tap/untap transition, so a
// granted keyword would go stale. A live read of `source.isTapped` is correct
// by construction.
//
// Callers (one per guarded clause):
//   - cantBeTargeted   → rules.ts::getLegalTargets, game.ts::selectTarget
//   - cantBeEnchanted  → state.ts aura-resolution attach gate
//   - indestructible   → state.ts::regenerateOrDestroy
//   - controlCantChange→ state.ts::applyControlChange
//
// `player-guard` (`StaticPlayerGuard`, `playerHasShroud` below) is the
// PLAYER-scoped sibling (CR 702.18 shroud applied to a player, CR 115.4):
// players have no `staticAbilities`/per-object identity to carry a keyword,
// so it is materialized/derived by scanning battlefields (mirroring
// `StaticHandSizeOverride`'s player-scoped read) rather than matched against
// a candidate permanent. Same live-query model, same callers
// (`getLegalTargets`, `selectTarget`), issue #1128.

import type { CardInstanceState } from "./state";
import type { StaticPermanentGuard } from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";

/** A minimal read-only battlefield view — every game-state shape the engine
 *  passes here (fat `GameState`, projected public state) satisfies it. */
interface BattlefieldView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<CardInstanceState> }>;
}

/** The spell/ability source attempting a guarded targeting action (CR 109.5).
 *  Consulted by `cantBeTargeted` guards that narrow by the source's
 *  characteristics: card types (Artifact Ward), subtypes ("Aura spells" —
 *  Bartel Runeaxe / Tetsuo Umezawa), or spell-vs-ability ("can't be the target
 *  of spells" — Anti-Magic Aura). Unfiltered guards (Guardian Beast / shroud)
 *  ignore every field and block all sources. */
export interface GuardActionSource {
    /** Card types of the source (CR 109.5). */
    types?: ReadonlyArray<string>;
    /** Subtypes of the source (e.g. `["Aura"]` for an Aura spell). */
    subtypes?: ReadonlyArray<string>;
    /** True if the source is a spell on the stack / being cast; false for an
     *  activated or triggered ability. */
    isSpell?: boolean;
    /** Controller of the spell/ability source (CR 109.4). Only consulted by the
     *  controller-relative `hexproof` guard (CR 702.11b — "can't be the target
     *  of spells or abilities your OPPONENTS control"): the guard bars the
     *  action only when this differs from the guarded permanent's controller.
     *  When omitted the hexproof guard stays conservative and blocks (a
     *  synthetic caller with no controller info can't prove it's the owner). */
    controllerId?: string;
}

// CR 702.11 hexproof — the keyword that this module bridges to a guard. Read
// off the permanent's effective (layer-materialized) `staticAbilities`, the
// same array combat/rules gates read for `haste`/`flying`/`menace`, so a
// dynamically-granted hexproof (Instill Energy-style grantStaticAbility) is
// honoured identically to a printed one.
const HEXPROOF_KEYWORD = "hexproof";

/** True if `card`'s effective keywords include hexproof (CR 702.11). */
function hasHexproof(card: CardInstanceState): boolean {
    return card.staticAbilities?.includes(HEXPROOF_KEYWORD) ?? false;
}

// CR 702.18 shroud — the PERMANENT-scoped keyword-string bridge, mirroring
// `hasHexproof` above. Every PRINTED-shroud card already pairs the
// `staticAbilities: ["shroud"]` reminder string with an explicit
// `permanent-guard` staticEffect (`cantBeTargeted: true`) declared on its
// `CardDefinition`, so this keyword-string read is a second, REDUNDANT path
// for those — harmless, since it agrees with the declared static effect.
// What it newly covers is the keyword-only path: a card that grants shroud
// DYNAMICALLY via `SpellContext.grantStaticAbility(target, "shroud", …)`
// (Skyshroud Blessing `pls/green.ts`, Homarid Warrior / Svyelunite Priest
// `fem/blue.ts`, Sylvan Safekeeper `jud/green.ts`, Blurred Mongoose's own
// activated ability and the `usg/green.ts` grant — the "GAP" the Mechanics
// Registry's shroud row (`cards/mechanicsRegistry.ts`) used to document as
// decorative-only, issue #959) appends ONLY the bare string to `staticAbilities`
// with no accompanying `permanent-guard` static effect, so nothing read it.
// Bridging the string here — the same mechanism hexproof already uses —
// closes the gap for every dynamic-grant site at once instead of requiring
// each card to hand-author its own `permanent-guard` staticEffect. Unlike
// hexproof, shroud is UNFILTERED (CR 702.18 bars every spell/ability source,
// including the permanent's own controller's), so the check below needs no
// `actionSource`/controller narrowing.
const SHROUD_KEYWORD = "shroud";

/** True if `card`'s effective keywords include shroud (CR 702.18). */
function hasShroud(card: CardInstanceState): boolean {
    return card.staticAbilities?.includes(SHROUD_KEYWORD) ?? false;
}

type GuardClause = keyof Pick<
    StaticPermanentGuard,
    | "cantBeTargeted"
    | "cantBeEnchanted"
    | "indestructible"
    | "controlCantChange"
>;

/** True if any active `permanent-guard` static effect on the battlefield bars
 *  `clause` for `target`. Scans every source permanent, reads its card
 *  definition's `staticEffects`, and evaluates each guard's `applies` predicate
 *  live (so e.g. a tapped Guardian Beast stops guarding without any re-apply
 *  hook). CR 611 — a continuous effect from a source applies only while that
 *  source is on the battlefield, which is exactly the iteration set here.
 *
 *  `actionSource` — the spell/ability source attempting the guarded action
 *  (CR 109.5). Accepts either a bare `string[]` of the source's card types
 *  (legacy callers) or a `GuardActionSource` carrying types, subtypes, and
 *  whether the source is a spell. Only consulted by `cantBeTargeted` guards
 *  that carry a source filter:
 *    - `targetSourceTypeFilter`    — Artifact Ward ("abilities from artifact
 *                                    sources"): source's TYPES must intersect.
 *    - `targetSourceSubtypeFilter` — Bartel Runeaxe / Tetsuo Umezawa ("Aura
 *                                    spells"): source's SUBTYPES must intersect.
 *    - `targetSourceMustBeSpell`   — Anti-Magic Aura ("can't be the target of
 *                                    spells"): source must be a spell.
 *  A filtered guard whose filter can't be satisfied (e.g. no source info, or
 *  an ability when the guard is spell-only) does not match and is skipped.
 *  Unfiltered guards (Guardian Beast / shroud) ignore `actionSource` entirely
 *  and block every source. */
export function isGuardedAgainst(
    state: BattlefieldView,
    target: CardInstanceState,
    clause: GuardClause,
    actionSource?: ReadonlyArray<string> | GuardActionSource
): boolean {
    const src: GuardActionSource = Array.isArray(actionSource)
        ? { types: actionSource as ReadonlyArray<string> }
        : ((actionSource as GuardActionSource | undefined) ?? {});

    // CR 702.11b hexproof — the narrower, CONTROLLER-RELATIVE cousin of shroud:
    // the permanent can't be the target of spells or abilities its controller's
    // OPPONENTS control, but its own controller can still target it. Modelled on
    // the SAME `cantBeTargeted` targeting-legality path shroud uses (not a
    // second parallel mechanism), derived directly from the `hexproof` keyword
    // string so every card that declares `staticAbilities: ["hexproof"]` gets
    // the guard for free (engine derives the guard from the keyword — the
    // scalable choice for ~80k cards, and it matches how the keyword is already
    // authored on the card and censused as a keyword in the Mechanics Registry).
    // Only the `cantBeTargeted` clause is controller-relative; the enchant /
    // indestructible / control-change clauses have no hexproof analogue.
    if (clause === "cantBeTargeted" && hasHexproof(target)) {
        // An opponent-controlled source is barred. A source controlled by the
        // permanent's own controller is allowed (own aura/pump can target it).
        // Unknown source controller ⇒ stay conservative and block (a synthetic
        // caller can't prove ownership); every real call site threads the
        // controller so the own-controller allowance holds.
        if (
            src.controllerId === undefined ||
            src.controllerId !== target.controllerId
        ) {
            return true;
        }
    }

    // CR 702.18 shroud — the PERMANENT-scoped keyword-string bridge (see
    // `hasShroud` above). Unfiltered: bars every source, including the
    // permanent's own controller's, so no `actionSource` narrowing applies.
    if (clause === "cantBeTargeted" && hasShroud(target)) {
        return true;
    }

    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind !== "permanent-guard") continue;
                if (!effect[clause]) continue;
                if (clause === "cantBeTargeted") {
                    // CR 109.5 source-type narrowing (Artifact Ward): a filtered
                    // guard applies only to sources whose types intersect the
                    // filter. No source types ⇒ a typed filter can't match.
                    if (effect.targetSourceTypeFilter) {
                        const types = src.types ?? [];
                        if (
                            !effect.targetSourceTypeFilter.some((t) =>
                                types.includes(t)
                            )
                        )
                            continue;
                    }
                    // CR 109.5 source-subtype narrowing ("Aura spells"): the
                    // source's subtypes must intersect the filter.
                    if (effect.targetSourceSubtypeFilter) {
                        const subtypes = src.subtypes ?? [];
                        if (
                            !effect.targetSourceSubtypeFilter.some((s) =>
                                subtypes.includes(s)
                            )
                        )
                            continue;
                    }
                    // CR 113.3 spell-only narrowing (Anti-Magic Aura): the
                    // guard ignores activated/triggered abilities. When the
                    // caller doesn't say (isSpell undefined) we don't skip, so
                    // the guard stays conservative for synthetic callers.
                    if (
                        effect.targetSourceMustBeSpell &&
                        src.isSpell === false
                    ) {
                        continue;
                    }
                }
                if (effect.applies(target, source, STATIC_EFFECT_CTX)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** True if `playerId` currently has shroud (CR 702.18 applied to a player via
 *  CR 115.4 — "can't be the target of spells or abilities"). Scans EVERY
 *  battlefield (a `player-guard` static effect can be granted by a permanent
 *  either player controls — mirroring `effectiveMaxHandSize`'s
 *  `hand-size-override` scan in `gre/phases.ts`) for a `player-guard`
 *  `StaticEffect` whose `appliesTo` resolves to `playerId`, read live so a
 *  source leaving the battlefield drops the guard automatically (CR 611.2) —
 *  no per-instance apply/unapply bookkeeping.
 *
 *  Unlike `isGuardedAgainst`'s `cantBeTargeted` clause, shroud has no
 *  source-narrowing (no hexproof-style controller exception, no
 *  Artifact-Ward-style type/subtype filter, no spell-only filter): CR 702.18 shroud
 *  bars EVERY spell/ability source, including ones the guarded player
 *  controls, so the reader takes no `actionSource` parameter — callers don't
 *  need to thread one.
 *
 *  Pure function of `state` — safe to call from the client's targeting helper
 *  (`src/lib/targeting.ts`) against a projected `PublicGameState`, the same
 *  boundary relaxation `isGuardedAgainst` already crosses. */
export function playerHasShroud(
    state: BattlefieldView,
    playerId: string
): boolean {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (const effect of effects) {
                if (effect.kind !== "player-guard") continue;
                if (!effect.cantBeTargeted) continue;
                const appliesTo = effect.appliesTo ?? "controller";
                const targetPlayerId =
                    appliesTo === "controller"
                        ? source.controllerId
                        : source.chosenPlayerId;
                if (targetPlayerId === playerId) return true;
            }
        }
    }
    return false;
}
