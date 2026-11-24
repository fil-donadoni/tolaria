// Sequencing dominance at the root (issue #10645).
//
// A cost reducer cast BEFORE the spell it discounts is a line the search
// cannot tell from the spell cast alone. Ruby Medallion and Gray Ogre on four
// Mountains: the Medallion then the Ogre at {1}{R} casts both, the Ogre at
// {2}{R} first leaves one Mountain and the Medallion in hand. Both lines put
// the Ogre on the battlefield; the only difference is the Medallion, which
// `evaluate` prices at its flat permanent worth when nothing in hand is left
// for it to discount (`costModifierStandingWorth` reads the hand, and the hand
// is empty). That is a few margin points, and the root decision is read from
// subtree means that rollout noise and the Medallion line's own `pass` child
// move by more, so the full-cost cast won at every budget measured.
//
// The line is not a preference, it is a DOMINANCE, so it is proved here and
// the dominated cast is dropped from the root move list, in the family of
// `dominance.ts` (issue #1887): the search never spends a visit on it, and no
// root rule is added (ADR 0124 §5).
//
// ── The proof ─────────────────────────────────────────────────────────────
// At the mover's own sorcery-speed window (CR 307.1: its main phase, it holds
// priority, the stack empty, nothing pending), the cast X is dominated by a
// cast R of a PURE SELF COST REDUCER (`isPureSelfCostReducer`) when, on
// clones:
//
//   A. X is cast and resolves;
//   B. R is cast and resolves, priority returns to the mover (CR 117.3b), and
//      the SAME announcement of X (card, targets, X, mode — every field but
//      the tap plan, which the discount changes, CR 601.2f) is legal and is
//      cast and resolves;
//
// and the two settled states are equal under the fail-closed whole-state
// compare `dominance.ts` uses (`stripBookkeeping` + `deepEqual`) once R is
// taken out of A's hand and B's battlefield and the mover's LANDS that were
// untapped before either line are read untapped on both sides — tapping a
// land for mana is the cost each line paid. A creature or other non-land
// source tapped for mana is not forgiven (it could have attacked or blocked),
// so a line paid that way is never proved.
//
// Equality says B holds everything A holds plus R on the battlefield. One more
// thing A could hold is mana: whatever its untapped lands still pay for. So
// every move the mover holds after A (pass aside, the tap plan aside) must
// also be held after B — anything A still casts, activates or plays is a
// reason to keep X searchable, R itself included (X first then R is then the
// same line as B, and the search will find it). And since what is legal NOW
// is not all the leftover mana pays for — a combat trick, an activation gated
// to another step — a line that keeps more untapped lands than B is refused
// outright while the mover holds any instant-speed option at all
// (`holdsInstantSpeedOption`).
//
// ── Why R on the battlefield is never worse than R in hand ────────────────
// R's only text is static cost reductions that apply to spells its controller
// casts and to no spell an opponent casts (`isPureSelfCostReducer` asks R's
// own `appliesToSpell` about each known spell with the opponent as announcer).
// On the battlefield it lowers nothing but the mover's costs (CR 601.2f).
// Documented narrowings, accepted: a card in hand is hidden information and
// discard or pitch fodder, and a permanent can be removed. The first two are
// small, the last costs the opponent a card.
//
// Deterministic and pure: probes run on clones, in enumeration order.

import type { CardDefinition } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { checkStateBasedActions } from "../sba";
import { cloneGameState } from "../clone";
import { hasInstantSpeed, isLand, isManaAbilityDefinition } from "../constants";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { hasCardSelfFlashPermission } from "../../cards/castRestrictions";
import { STATIC_EFFECT_CTX } from "../layers";
import { getEffectiveStaticEffects, resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";
import type { Move } from "../moves";
import { declaresSpellCostModifier } from "./costModifierPricing";
import { applyProbeCast, deepEqual, stripBookkeeping } from "./dominance";
import type { MoveEnumerator } from "./transientDamage";

type CastMove = Extract<Move, { kind: "cast-spell" }>;

/** Bound on stack resolutions per line, as in `dominance.ts`. */
const MAX_SETTLE_STEPS = 8;

/** The definition keys a pure self cost reducer may carry: its name, its
 *  type line, its cost, its printed text and its statics. An allowlist, so a
 *  definition field added tomorrow (an ability, a trigger, an entry effect)
 *  refuses the proof until someone reads it. */
const REDUCER_DEFINITION_KEYS: ReadonlySet<string> = new Set([
    "id",
    "name",
    "types",
    "subtypes",
    "supertypes",
    "manaCost",
    "oracleText",
    "rarity",
    "setCode",
    "staticEffects",
]);

function definitionOf(card: CardInstanceState): CardDefinition | null {
    return tryGetDefinition((card.card as { id?: string }).id ?? "");
}

/** True when `card`, a card in `moverId`'s hand, is a PURE SELF COST
 *  REDUCER: a non-creature, non-land permanent whose whole text is static
 *  spell cost reductions (CR 601.2f) — no increase, no total-cost floor or
 *  raise, no per-spell tax — none of which applies to any known spell when an
 *  opponent is the one casting it. `knownSpells` are the spells the question
 *  is asked about (the mover's hand); a symmetric reduction (Helm of
 *  Awakening) answers yes for them under the opponent and is refused. */
export function isPureSelfCostReducer(
    card: CardInstanceState,
    moverId: string,
    opponentId: string,
    knownSpells: readonly CardInstanceState[]
): boolean {
    const def = definitionOf(card);
    if (!def || !declaresSpellCostModifier(def)) return false;
    const keys = Object.keys(def);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = (def as unknown as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (!REDUCER_DEFINITION_KEYS.has(key)) return false;
    }
    if (card.controllerId !== moverId) return false;
    const effects = getEffectiveStaticEffects(def, undefined);
    for (let i = 0; i < effects.length; i++) {
        const effect = effects[i];
        if (effect.kind !== "cost-modifier") return false;
        if (
            effect.costReduction === undefined ||
            effect.costIncrease !== undefined ||
            effect.raiseTotalCostTo !== undefined ||
            effect.perOtherSpellCastByAnnouncerThisTurn !== undefined
        ) {
            return false;
        }
        for (let j = 0; j < knownSpells.length; j++) {
            const spell = knownSpells[j];
            if (isLand(spell)) continue;
            if (
                effect.appliesToSpell?.(
                    spell,
                    STATIC_EFFECT_CTX,
                    card,
                    opponentId
                )
            ) {
                return false;
            }
        }
    }
    return true;
}

/** The mover's own sorcery-speed window (CR 307.1). */
function isOwnSorceryWindow(state: GameState, pid: string): boolean {
    return (
        !state.gameOver &&
        state.activePlayerId === pid &&
        state.priorityPlayerId === pid &&
        (state.phase === "PRECOMBAT_MAIN" ||
            state.phase === "POSTCOMBAT_MAIN") &&
        state.stack.length === 0 &&
        (state.pendingChoices?.length ?? 0) === 0 &&
        !state.pendingTarget &&
        !state.pendingCast &&
        !state.pendingActivation &&
        !state.pendingCompanionPay
    );
}

/** Cast `move` on `probe` and resolve the stack to empty (CR 608.1), SBAs
 *  after each resolution (CR 704.3), then hand priority back to the active
 *  player (CR 117.3b). `false` when the line cannot be settled without a
 *  decision: a choice, a target, a game end, or too many resolutions. */
function castAndSettle(probe: GameState, pid: string, move: CastMove): boolean {
    if (!applyProbeCast(probe, pid, move)) return false;
    let steps = 0;
    while (probe.stack.length > 0) {
        if (steps++ >= MAX_SETTLE_STEPS) return false;
        if (
            probe.gameOver ||
            probe.pendingCast ||
            probe.pendingTarget ||
            probe.pendingActivation ||
            probe.pendingCompanionPay ||
            (probe.pendingChoices?.length ?? 0) > 0
        ) {
            return false;
        }
        resolveTopOfStack(probe);
        checkStateBasedActions(probe);
    }
    if (
        probe.gameOver ||
        probe.pendingTarget ||
        (probe.pendingChoices?.length ?? 0) > 0
    ) {
        return false;
    }
    probe.priorityPlayerId = probe.activePlayerId;
    probe.passCount = 0;
    return true;
}

/** A move's identity with its tap plan left out: the announcement it makes,
 *  whatever sources pay for it. */
function announcementKey(move: Move): string {
    return JSON.stringify({ ...move, tapPlan: undefined });
}

/** `state` as the compare reads it: a copy with the bookkeeping stripped,
 *  `reducerId` taken out of `zone`, and the mover's lands in `untapped` read
 *  untapped. `null` when the reducer is not where the line left it. */
function compared(
    state: GameState,
    moverId: string,
    reducerId: string,
    zone: "hand" | "battlefield",
    untapped: ReadonlySet<string>
): GameState | null {
    const copy = cloneGameState(state);
    stripBookkeeping(copy, moverId);
    const mover = copy.players.find((p) => p.id === moverId);
    if (!mover) return null;
    const from = mover[zone];
    const i = from.findIndex((c) => c.id === reducerId);
    if (i === -1) return null;
    from.splice(i, 1);
    const permList = mover.battlefield;
    for (let j = 0; j < permList.length; j++) {
        const perm = permList[j];
        if (perm.isTapped && isLand(perm) && untapped.has(perm.id)) {
            perm.isTapped = false;
        }
    }
    return copy;
}

/** True when every move `pid` holds in `a` (pass aside) is also held in
 *  `b`, tap plans aside. */
function optionsCovered(
    a: GameState,
    b: GameState,
    pid: string,
    enumerate: MoveEnumerator
): boolean {
    const held = new Set(enumerate(b, pid).map(announcementKey));
    const need = enumerate(a, pid);
    for (let i = 0; i < need.length; i++) {
        const move = need[i];
        if (move.kind === "pass") continue;
        if (!held.has(announcementKey(move))) return false;
    }
    return true;
}

/** Untapped lands `pid` controls in `state`. */
function untappedLandCount(state: GameState, pid: string): number {
    const mover = state.players.find((p) => p.id === pid);
    return mover
        ? mover.battlefield.filter((c) => isLand(c) && !c.isTapped).length
        : 0;
}

/** True when `pid` holds anything mana left untapped could pay for at
 *  instant speed later this turn, outside what is legal right now: an
 *  instant or flash card in hand, graveyard or exile, any card in hand
 *  carrying an activated ability, or a non-mana activated ability on any
 *  card it holds. `except` names the two cards the proof is about. Coarse on
 *  purpose — fail-closed: what it cannot rule out keeps the spell searchable. */
function holdsInstantSpeedOption(
    state: GameState,
    pid: string,
    except: ReadonlySet<string>
): boolean {
    const mover = state.players.find((p) => p.id === pid);
    if (!mover) return true;
    const zones = [mover.hand, mover.battlefield, mover.graveyard, mover.exile];
    for (let z = 0; z < zones.length; z++) {
        const zone = zones[z];
        for (let i = 0; i < zone.length; i++) {
            const card = zone[i];
            if (except.has(card.id)) continue;
            const abilities = getEffectiveActivatedAbilities(card);
            if (zone === mover.hand && !isLand(card) && abilities.length > 0) {
                return true;
            }
            if (
                abilities.some(
                    ({ ability }) => !isManaAbilityDefinition(ability)
                )
            ) {
                return true;
            }
            if (
                zone !== mover.battlefield &&
                !isLand(card) &&
                (hasInstantSpeed(card) || hasCardSelfFlashPermission(card))
            ) {
                return true;
            }
        }
    }
    return false;
}

/** Is `spell` dominated by casting `reducer` first? The proof in the module
 *  header. Any doubt, or a probe that throws, answers `false`. */
function reducerFirstDominates(
    state: GameState,
    pid: string,
    reducer: CastMove,
    spell: CastMove,
    enumerate: MoveEnumerator
): boolean {
    const mover = state.players.find((p) => p.id === pid);
    if (!mover) return false;
    const untapped = new Set(
        mover.battlefield
            .filter((c) => !c.isTapped && isLand(c))
            .map((c) => c.id)
    );
    try {
        const a = cloneGameState(state);
        if (!castAndSettle(a, pid, spell)) return false;
        const b = cloneGameState(state);
        if (!castAndSettle(b, pid, reducer)) return false;
        const wanted = announcementKey(spell);
        const followUp = enumerate(b, pid).find(
            (m): m is CastMove =>
                m.kind === "cast-spell" && announcementKey(m) === wanted
        );
        if (!followUp || !castAndSettle(b, pid, followUp)) return false;
        const left = compared(a, pid, reducer.cardInstanceId, "hand", untapped);
        const right = compared(
            b,
            pid,
            reducer.cardInstanceId,
            "battlefield",
            untapped
        );
        if (!left || !right || !deepEqual(left, right)) return false;
        // The mana the spell-first line keeps beyond the reducer line's can
        // pay for something that is not legal yet (a combat trick, an
        // activation with a timing gate): `optionsCovered` sees only now.
        if (
            untappedLandCount(a, pid) > untappedLandCount(b, pid) &&
            holdsInstantSpeedOption(
                state,
                pid,
                new Set([reducer.cardInstanceId, spell.cardInstanceId])
            )
        ) {
            return false;
        }
        return optionsCovered(a, b, pid, enumerate);
    } catch {
        return false;
    }
}

/** The casts in `moves` that a cost reducer cast first provably dominates
 *  (issue #10645): for each, a cast in `moves` of a pure self cost reducer
 *  from `pid`'s hand reaches the same position plus the reducer on the
 *  battlefield. Empty outside the mover's own sorcery-speed window or with no
 *  such reducer on offer, which is every position but the one this is for —
 *  the cheap gate runs before any clone. Never contains a reducer's own cast
 *  or `pass`. Pure. */
export function reducerFirstDominatedCasts(
    state: GameState,
    pid: string,
    moves: readonly Move[],
    enumerate: MoveEnumerator
): Set<Move> {
    const dominated = new Set<Move>();
    if (!isOwnSorceryWindow(state, pid)) return dominated;
    const mover = state.players.find((p) => p.id === pid);
    const opponent = state.players.find((p) => p.id !== pid);
    if (!mover || !opponent) return dominated;
    const reducers: CastMove[] = [];
    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        if (move.kind !== "cast-spell" || move.targets.length > 0) continue;
        const card = mover.hand.find((c) => c.id === move.cardInstanceId);
        if (card && isPureSelfCostReducer(card, pid, opponent.id, mover.hand)) {
            reducers.push(move);
        }
    }
    if (reducers.length === 0) return dominated;
    const reducerCards = new Set(reducers.map((r) => r.cardInstanceId));
    for (let i = 0; i < moves.length; i++) {
        const spell = moves[i];
        if (spell.kind !== "cast-spell") continue;
        if (reducerCards.has(spell.cardInstanceId)) continue;
        if (!mover.hand.some((c) => c.id === spell.cardInstanceId)) continue;
        for (let j = 0; j < reducers.length; j++) {
            if (
                reducerFirstDominates(state, pid, reducers[j], spell, enumerate)
            ) {
                dominated.add(spell);
                break;
            }
        }
    }
    return dominated;
}
