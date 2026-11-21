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
//   - survivesZeroLoyalty → sba.ts::checkZeroLoyaltySBA (CR 704.5i)
//
// `player-guard` (`StaticPlayerGuard`, `playerHasShroud` below) is the
// PLAYER-scoped sibling (CR 702.18 shroud applied to a player, CR 115.4):
// players have no `staticAbilities`/per-object identity to carry a keyword,
// so it is materialized/derived by scanning battlefields (mirroring
// `StaticHandSizeOverride`'s player-scoped read) rather than matched against
// a candidate permanent. Same live-query model, same callers
// (`getLegalTargets`, `selectTarget`), issue #1128.

import { liveStaticDefinition } from "./constants";
import type { CardInstanceState } from "./state/declarations";
import type {
    Color,
    PlayerGuardAction,
    StaticEffect,
    StaticPermanentGuard,
    StaticPlayerGuard,
} from "../cards/types";
import { STATIC_EFFECT_CTX } from "./layers";
import { applySubstitution, substituteColorFilter } from "./textChanges";
import {
    HEXPROOF_KEYWORD,
    hasHexproofQuality,
    isHexproofFromAbility,
    parseHexproofQuality,
    type HexproofQuality,
} from "./hexproofQuality";

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
    /** Live colours of the source (CR 202.2; empty = colourless, CR 105.2c).
     *  Only consulted by `targetSourceColorFilter` guards. */
    colors?: ReadonlyArray<Color>;
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

/** True if `card`'s effective keywords include plain hexproof (CR 702.11b). */
function hasHexproof(card: CardInstanceState): boolean {
    return card.staticAbilities?.includes(HEXPROOF_KEYWORD) ?? false;
}

/** CR 702.11d — the qualities of every "hexproof from [quality]" ability on
 *  `card`, read through its colour-word text changes (CR 612.1 — a Sleight of
 *  Mind turning "hexproof from black" into "hexproof from blue"), the same
 *  rewritten text `protection.ts` reads. An unparseable quality contributes
 *  nothing here; the catalogue guard keeps one from shipping. */
function hexproofFromQualities(card: CardInstanceState): HexproofQuality[] {
    if (!card.staticAbilities?.some(isHexproofFromAbility)) return [];
    const abilities = applySubstitution(card).staticAbilities;
    const qualities: HexproofQuality[] = [];
    for (let i = 0; i < abilities.length; i++) {
        const ability = abilities[i];
        const quality = parseHexproofQuality(ability);
        if (quality) qualities.push(quality);
    }
    return qualities;
}

/** CR 702.11b/d — true when `src` is controlled by an opponent of `target`'s
 *  controller. An unknown source controller stays conservative and counts as
 *  an opponent (a synthetic caller can't prove ownership); every real call
 *  site threads the controller so the own-controller allowance holds. */
function isOpponentSource(
    src: GuardActionSource,
    target: CardInstanceState
): boolean {
    return (
        src.controllerId === undefined ||
        src.controllerId !== target.controllerId
    );
}

// CR 702.18 shroud — the PERMANENT-scoped keyword-string bridge, mirroring
// `hasHexproof` above. Every PRINTED-shroud card already pairs the
// `staticAbilities: ["shroud"]` reminder string with an explicit
// `permanent-guard` staticEffect (`cantBeTargeted: true`) declared on its
// `CardDefinition`, so this keyword-string read is a second, REDUNDANT path
// for those — harmless, since it agrees with the declared static effect.
// What it newly covers is the keyword-only path: a card that grants shroud
// DYNAMICALLY via `SpellContext.grantStaticAbility(target, "shroud", …)`
// (Skyshroud Blessing `pls/green.cards.ts`, Homarid Warrior / Svyelunite Priest
// `fem/blue.cards.ts`, Sylvan Safekeeper `jud/green.cards.ts`, Blurred Mongoose's own
// activated ability and the `usg/green.cards.ts` grant — the "GAP" the Mechanics
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

/** CR 202.2 — true when `sourceColors` (the targeting source's live colours)
 *  include a colour of `filter`, each filter colour read through the GUARDING
 *  permanent's colour-word text changes (CR 612.1 — a white→blue change on
 *  the guard bars blue sources instead). Reads both text-change carriers
 *  (`textChangesOf`), so the server and the wire-fed click gate agree. */
function sourceColorsMatch(
    filter: ReadonlyArray<Color>,
    guard: CardInstanceState,
    sourceColors: ReadonlyArray<Color>
): boolean {
    return filter.some((c) =>
        sourceColors.includes(substituteColorFilter(guard, c))
    );
}

/** CR 612.1 — the colour words a definition's `permanent-guard` source-colour
 *  filters put in the object's text ("white spells or abilities from white
 *  sources", Raiding Party), so a text-changing effect can name them. Lives
 *  here, beside the filter, so `gre/state.ts` reads no `StaticEffect` kind
 *  (ADR 0082). */
export function guardSourceColorWords(
    staticEffects: ReadonlyArray<StaticEffect> | undefined
): Color[] {
    const words: Color[] = [];
    const effectList = staticEffects ?? [];
    for (let i = 0; i < effectList.length; i++) {
        const effect = effectList[i];
        if (effect.kind === "permanent-guard")
            words.push(...(effect.targetSourceColorFilter ?? []));
    }
    return words;
}

type GuardClause = keyof Pick<
    StaticPermanentGuard,
    | "cantBeTargeted"
    | "cantBeEnchanted"
    | "indestructible"
    | "controlCantChange"
    | "survivesZeroLoyalty"
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
 *    - `targetSourceColorFilter`   — Raiding Party ("white spells or
 *                                    abilities from white sources"): source's
 *                                    COLOURS must intersect.
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
    if (clause === "cantBeTargeted" && isOpponentSource(src, target)) {
        // An opponent-controlled source is barred. A source controlled by the
        // permanent's own controller is allowed (own aura/pump can target it).
        if (hasHexproof(target)) return true;
        // CR 702.11d — "hexproof from [quality]": only [quality] spells, and
        // abilities from [quality] sources, are barred. `src.colors` is the
        // spell's own colours for a spell and its SOURCE's for an ability
        // (`targetingSourceFromCard` reads the object the ability comes from),
        // which is exactly the object CR 702.11d asks the quality of. No
        // colours known ⇒ colourless ⇒ no colour quality matches (CR 105.2c).
        const colors = src.colors ?? [];
        if (
            hexproofFromQualities(target).some((q) =>
                hasHexproofQuality(q, colors)
            )
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

    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const sourceList = player.battlefield;
        for (let j = 0; j < sourceList.length; j++) {
            const source = sourceList[j];
            const def = liveStaticDefinition(source);
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (let m = 0; m < effects.length; m++) {
                const effect = effects[m];
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
                    // CR 202.2 source-colour narrowing (Raiding Party): the
                    // source's live colours must intersect the filter, each
                    // filter colour read through the guarding permanent's
                    // colour-word text changes (CR 612.1). No source colours
                    // ⇒ a colour filter can't match (CR 105.2c).
                    if (
                        effect.targetSourceColorFilter &&
                        !sourceColorsMatch(
                            effect.targetSourceColorFilter,
                            source,
                            src.colors ?? []
                        )
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
    return playerGuardsOf(state, playerId).some((g) => g.cantBeTargeted);
}

/** The player half of a player-target gate: the id, and the keywords the
 *  player gained until end of turn (`PlayerState.keywordsUntilEndOfTurn`). The
 *  fat `PlayerState` and the projected wire `Player` both satisfy it. */
export interface PlayerKeywordView {
    id: string;
    keywordsUntilEndOfTurn?: ReadonlyArray<string>;
}

/** True when a keyword `player` gained until end of turn bars `src` from
 *  targeting them (CR 611.2a):
 *
 *  - `shroud` (CR 702.18a) — every source, the player's own included.
 *  - `hexproof` (CR 702.11c) — a source an opponent controls.
 *  - `hexproof from <quality>` — CR 702.11d defines the variant on a
 *    permanent; on a player it is the same narrowing of CR 702.11c: a
 *    [quality] spell an opponent controls, or an ability an opponent controls
 *    from a [quality] source. `src.colors` is the spell's colours or the
 *    ability source's, as for the permanent form above.
 *
 *  An unknown source controller counts as an opponent (`isOpponentSource`'s
 *  conservative reading). Pure, so the client's nameplate gate reads it
 *  against the projected players. */
export function playerKeywordBarsTargeting(
    player: PlayerKeywordView,
    src: GuardActionSource
): boolean {
    const keywords = player.keywordsUntilEndOfTurn;
    if (!keywords?.length) return false;
    if (keywords.includes(SHROUD_KEYWORD)) return true;
    const opponentSource =
        src.controllerId === undefined || src.controllerId !== player.id;
    if (!opponentSource) return false;
    if (keywords.includes(HEXPROOF_KEYWORD)) return true;
    const colors = src.colors ?? [];
    return keywords.some((keyword) => {
        const quality = parseHexproofQuality(keyword);
        return quality !== null && hasHexproofQuality(quality, colors);
    });
}

/** Every `player-guard` static effect currently guarding `playerId`: a scan of
 *  EVERY battlefield (a permanent either player controls can grant one), each
 *  effect's `appliesTo` resolved against its source, read live (CR 611.3a). */
function playerGuardsOf(
    state: BattlefieldView,
    playerId: string
): StaticPlayerGuard[] {
    const guards: StaticPlayerGuard[] = [];
    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const sourceList = player.battlefield;
        for (let j = 0; j < sourceList.length; j++) {
            const source = sourceList[j];
            const def = liveStaticDefinition(source);
            const effects = def?.staticEffects;
            if (!effects) continue;
            for (let k = 0; k < effects.length; k++) {
                const effect = effects[k];
                if (effect.kind !== "player-guard") continue;
                const appliesTo = effect.appliesTo ?? "controller";
                const targetPlayerId =
                    appliesTo === "controller"
                        ? source.controllerId
                        : source.chosenPlayerId;
                if (targetPlayerId === playerId) guards.push(effect);
            }
        }
    }
    return guards;
}

/** CR 101.2 — true when a spell or ability controlled by `causerControllerId`
 *  can't cause `playerId` to perform `action` ("Spells and abilities your
 *  opponents control can't cause you to discard cards or sacrifice
 *  permanents", Tamiyo, Collector of Tales): the "can't" wins over the effect
 *  directing it, so that part of the effect does nothing. Source-scoped — a
 *  player's own spells and abilities (`causerControllerId === playerId`) are
 *  never barred, and an undefined causer (a cost, a game rule) is not an
 *  opponent's spell or ability.
 *
 *  Producer census (issue #2607) — every effect-driven discard and sacrifice
 *  reaches one of four consulting sites in `gre/state.ts`: the discard
 *  chokepoint `discardToGraveyard` (effect origin) and its random-discard
 *  loop `discardCardsAtRandom`; the sacrifice funnel `removePermanentTo`
 *  (`"sacrifice"` with a causer — only `SpellContext.sacrifice` passes one);
 *  `SpellContext.requestMayPay` (a sacrifice/discard payment leg is an option
 *  the player can't take); and `SpellContext.requestChoice` (a
 *  `sacrifice-permanents` / `discard-hand` pick that could only feed a barred
 *  action is answered empty, so no prompt opens). */
export function isOpponentCauseProhibited(
    state: BattlefieldView,
    playerId: string,
    action: PlayerGuardAction,
    causerControllerId: string | undefined
): boolean {
    if (causerControllerId === undefined) return false;
    if (causerControllerId === playerId) return false;
    return playerGuardsOf(state, playerId).some(
        (g) => g.opponentsCantCause?.includes(action) ?? false
    );
}

/** CR 701.23 / CR 101.2 — true when a spell or ability controlled by
 *  `searcherId` can't cause its controller to search their library, because a
 *  `player-guard` with `opponentsCantSearch` protects a player who is that
 *  controller's opponent (Ashiok, Dream Render). The "can't" wins over the
 *  search instruction. An undefined causer (a game rule) is never barred. */
export function isOpponentSearchProhibited(
    state: BattlefieldView,
    searcherId: string | undefined
): boolean {
    if (searcherId === undefined) return false;
    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const sourceList = player.battlefield;
        for (let j = 0; j < sourceList.length; j++) {
            const source = sourceList[j];
            const effects = liveStaticDefinition(source)?.staticEffects;
            if (!effects) continue;
            for (let k = 0; k < effects.length; k++) {
                const effect = effects[k];
                if (effect.kind !== "player-guard") continue;
                if (!effect.opponentsCantSearch) continue;
                const guardedId =
                    (effect.appliesTo ?? "controller") === "controller"
                        ? source.controllerId
                        : source.chosenPlayerId;
                // The guarded player's own searches are never barred.
                if (guardedId !== undefined && guardedId !== searcherId) {
                    return true;
                }
            }
        }
    }
    return false;
}
