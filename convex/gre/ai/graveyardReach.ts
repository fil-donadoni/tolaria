// Graveyard REACHABILITY — the gate on the leaf evaluator's `graveyardReach`
// term (issue #3042, map #1892: evaluation fidelity).
//
// WHY THIS MODULE EXISTS. Before it, a card put into a graveyard was worth
// exactly zero to the Bot, whoever owned it and whatever it was. A CORRECT
// Entomb — a fat reanimation target buried with the reanimation spell already
// in hand — evaluated as a strict loss: the hand term dropped by the tutor,
// nothing came back, and the whole line ranked below doing nothing unless the
// reanimation happened to resolve inside the rollout horizon.
//
// THE GATING IS THE WHOLE DESIGN. An ungated graveyard term is worse than none
// at all: it would make a creature dying a wash (value merely moves from the
// `creatures` term into a graveyard term) and the bot would start chump-
// blocking and trading for free. So a graveyard is a DEAD ZONE BY DEFAULT and
// must evaluate as exactly zero; a card in it earns credit only to the extent
// its owner can actually REACH it. Two reach shapes, both read off the
// engine's own authorities rather than any per-card knowledge (ADR 0102 — no
// card names, no archetype classifier, no "is this a reanimator deck"):
//
//   1. SELF-REACHABLE — the card is usable out of the graveyard on its own:
//      castable from there (`graveyardCastMechanism`, the single authority
//      covering escape / flashback / retrace / a per-card grant / an intrinsic
//      permission / a player-wide permission / a permanent's permission), or
//      carrying an activated ability that activates from the graveyard
//      (`ActivatedAbility.activateFromGraveyard`, CR 113.6 — Ashen Ghoul).
//   2. RECURSION ACCESS — the player controls or holds a card that can move a
//      card OUT of a graveyard into a zone where it does something (the
//      `recursion` dimension of the fixed feature basis, `featureBasis.ts`).
//
// WHY THE RECURSION HALF READS THE OP, NOT THE `recursion` TAG. The tag is the
// right DIMENSION but the wrong PREDICATE here: it is emitted by
// `moveZonePoints` for ANY `moveZone` whose destination is the battlefield
// (Sneak Attack puts a creature there from HAND) and by `shuffleSelfIntoLibrary`
// (a card returning ITSELF to the library — no graveyard reach at all). Both
// are false positives, and a false positive on this predicate is precisely the
// failure the term must not have: it would credit a dead zone. So the walk asks
// the sharper question the tag summarises — is there a `moveZone` whose SOURCE
// is a graveyard and whose DESTINATION is a zone the card can act from? That is
// the same feature dimension, read exactly instead of approximately.

import type { CardDefinition, EffectOp } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { cardValueById } from "../cardValue";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { graveyardCastMechanismForMember } from "../castCost";
import { getPrintedEscape } from "../escape";
import { canPlayLandsFromGraveyard } from "../rules";
import { isLand } from "../constants";

/** A destination a recovered card can actually be used from. Returning a card
 *  to the LIBRARY (a shuffle-back, Elixir of Immortality) is deliberately not
 *  reach: it un-mills, it does not make the card playable, and crediting it
 *  would credit a graveyard nobody can spend. */
function isUsableDestination(to: string): boolean {
    return to === "battlefield" || to === "hand";
}

/** Does this single Op move a card OUT of a graveyard into a usable zone?
 *
 *  `moveZone` has four shapes (`cards/types.ts`) and they name their SOURCE
 *  differently:
 *
 *  - the picked-cards and whole-zone shapes carry an explicit `from`;
 *  - the filter-driven sweep carries `fromZones`;
 *  - the ANNOUNCED-TARGET shape carries neither in the general case — its
 *    `from` is a re-derivation hint for a graveyard-card snapshot, not the
 *    shape's source zone. What actually decides the source there is the
 *    announcement: `targetRequirement.zone`, which is exactly where "target
 *    card in YOUR GRAVEYARD" is declared (Regrowth) and where a bounce
 *    (target creature on the BATTLEFIELD → hand) is not. So the target shape
 *    is answered from the requirement that governs the script, threaded in as
 *    `targetZone`, and fails CLOSED when there is none to read.
 *
 *  A SELF-recovery — `target: { ref: "$source" }`, "return THIS card from your
 *  graveyard" (Ashen Ghoul, Bloodghast, Sword of the Meek, Enduring Innocence)
 *  — is deliberately NOT access, whatever zone it names. The card reaches
 *  exactly itself, and only while it is in the graveyard; read as access it
 *  credits the top of the WHOLE graveyard off a card sitting in hand or on the
 *  battlefield, which is the "credit a dead graveyard" failure this gate
 *  exists to prevent. It is real reach, so it is not discarded — it moves to
 *  `isSelfReachableInGraveyard`, where it applies to the one card it can
 *  actually return.
 *
 *  A target shape naming no zone at all is the `$ref` / `$source` case: the
 *  card moves something an EARLIER Op bound, and this shape's `from` admits
 *  only `"graveyard"` or `"exile"` with `"graveyard"` the documented default.
 *  Read naively that sweeps in every BLINK — measured on the catalogue (3,481
 *  cards): Ephemerate, Displacer Kitten, Guardian Scalelord all exile a
 *  permanent and return it, and grant no graveyard reach whatsoever. So the
 *  ref case is allowed only when the script does not EXILE anything itself
 *  (`scriptExiles`), which is exactly what separates a blink from Replenish /
 *  Shallow Grave / Ashen Ghoul returning a card that was already in the
 *  graveyard. A script that both exiles and reanimates under-counts; that is
 *  the correct direction to be wrong in — crediting a dead graveyard is the
 *  failure this gate exists to prevent. */
/** The DSL selector naming the script's OWN source object. `$source` is the
 *  spelling every card in the catalogue uses; `$self` is accepted alongside it
 *  so a future alias cannot silently turn a self-recovery back into blanket
 *  access. */
function isSelfTargetRef(target: unknown): boolean {
    if (typeof target !== "object" || target === null) return false;
    const ref = (target as { ref?: unknown }).ref;
    return ref === "$source" || ref === "$self";
}

function opIsGraveyardRecovery(
    op: EffectOp,
    targetZone: string | undefined,
    scriptExiles: boolean
): boolean {
    if (op.op !== "moveZone") return false;
    const shape = op as {
        to?: string;
        from?: string;
        fromZones?: readonly string[];
        target?: unknown;
    };
    if (typeof shape.to !== "string" || !isUsableDestination(shape.to)) {
        return false;
    }
    // Self-recovery is reach over ONE card — `isSelfReachableInGraveyard`'s,
    // never blanket access. Checked before every branch: the shape spells it
    // both with an explicit `from: "graveyard"` (Sword of the Meek) and
    // without one (Ashen Ghoul).
    if (isSelfTargetRef(shape.target)) return false;
    if (shape.fromZones) return shape.fromZones.includes("graveyard");
    if (shape.from !== undefined) return shape.from === "graveyard";
    if (shape.target === undefined) return false;
    if (targetZone === "graveyard") return true;
    // With no zone announced, only `to: "battlefield"` can still mean the
    // graveyard: a permanent already ON the battlefield cannot move there, so
    // the source is a non-battlefield zone (this shape admits `"graveyard"` or
    // `"exile"`, defaulting to graveyard) — while `to: "hand"` with no zone is
    // the ordinary BOUNCE of a battlefield permanent (Unsummon, Boomerang,
    // Repulse), which reaches no graveyard at all.
    return shape.to === "battlefield" && !scriptExiles;
}

/** Every nested Op array an Op carries — the ONE place the DSL's nesting
 *  constructs are enumerated, so the two walks below cannot drift apart and a
 *  new construct cannot be added to the DSL while only one of them learns
 *  about it. Beyond the four structural constructs (ADR 0045) this covers the
 *  three Ops that also carry scripts: `delayedTrigger` / `reflexiveTrigger`
 *  (their `effects`) and `divideIntoPiles` (both branches). Missing them was a
 *  live false NEGATIVE — Death or Glory reanimates from inside a
 *  `divideIntoPiles` branch — and a latent false POSITIVE, since `scriptExiles`
 *  is the only thing separating a blink from real recursion in the un-zoned
 *  `$ref` case. */
function childOpArrays(op: EffectOp): readonly (readonly EffectOp[])[] {
    switch (op.op) {
        case "if":
            return op.else ? [op.then, op.else] : [op.then];
        case "forEach":
            return [op.effects];
        case "optionChoice":
            return op.modes.map((mode) => mode.effects);
        case "coinFlip":
        case "coinFlipSync":
            return [op.win.effects, op.loss.effects];
        case "delayedTrigger":
        case "reflexiveTrigger":
            return [op.effects];
        case "divideIntoPiles":
            return [op.chosenEffect, op.otherEffect];
        default:
            return [];
    }
}

/** Does this script exile something it could then be RETURNING? A blink (exile
 *  a permanent, then put it back) is the shape that would otherwise read as
 *  graveyard recovery through the un-zoned `$ref` case above. Covers both
 *  spellings — the dedicated `exile` Op and a `moveZone` with `to: "exile"`.
 *
 *  It descends every nested script EXCEPT a delayed or reflexive trigger's,
 *  and that exception is the whole precision of the predicate: those fire
 *  LATER, so their exile cannot be the source of a return happening now. It is
 *  the "reanimate it, then exile it at end of turn" clause — Corpse Dance,
 *  Shallow Grave — and counting it read two genuine reanimation spells as
 *  blinks. A real blink exiles INLINE and returns the object it just bound,
 *  which this still sees. */
function scriptExiles(effects: readonly EffectOp[]): boolean {
    for (const op of effects) {
        if (op.op === "exile") return true;
        if (op.op === "moveZone" && (op as { to?: string }).to === "exile") {
            return true;
        }
        if (op.op === "delayedTrigger" || op.op === "reflexiveTrigger")
            continue;
        for (const child of childOpArrays(op)) {
            if (scriptExiles(child)) return true;
        }
    }
    return false;
}

/** Any Op in `effects`, at any nesting depth, that recovers from a graveyard. */
function scriptRecoversFromGraveyard(
    effects: readonly EffectOp[],
    targetZone: string | undefined,
    exiles: boolean = scriptExiles(effects)
): boolean {
    for (const op of effects) {
        if (opIsGraveyardRecovery(op, targetZone, exiles)) return true;
        for (const child of childOpArrays(op)) {
            // `exiles` is a property of the WHOLE script, so nested calls keep
            // the top-level answer rather than re-deriving it per branch.
            if (scriptRecoversFromGraveyard(child, targetZone, exiles)) {
                return true;
            }
        }
    }
    return false;
}

/** The mirror of `scriptRecoversFromGraveyard` for SELF-recovery: a `moveZone`
 *  that moves this script's own source out of a graveyard into a zone it can
 *  act from. Split out rather than folded in with a flag because the two
 *  answer different questions about different cards — this one is about the
 *  card in the graveyard, the other about a card that can reach one. */
function scriptSelfRecoversFromGraveyard(
    effects: readonly EffectOp[] | undefined
): boolean {
    if (!effects) return false;
    for (const op of effects) {
        if (op.op === "moveZone") {
            const shape = op as {
                to?: string;
                from?: string;
                target?: unknown;
            };
            if (
                typeof shape.to === "string" &&
                isUsableDestination(shape.to) &&
                isSelfTargetRef(shape.target) &&
                (shape.from === undefined || shape.from === "graveyard")
            ) {
                return true;
            }
        }
        for (const child of childOpArrays(op)) {
            if (scriptSelfRecoversFromGraveyard(child)) return true;
        }
    }
    return false;
}

/** Every script a definition can bring to bear: its spell script, its cast-time
 *  modes, and each activated / triggered ability's script — real `effects[]`
 *  first, else the `aiEffects` shadow script a `resolve()` card carries for
 *  exactly this kind of reader (issue #1431). */
function definitionRecoversFromGraveyard(def: CardDefinition): boolean {
    // Each script is paired with the `targetRequirement` that governs ITS
    // announcement — the spell's own for the card script and its modes, the
    // ability's own for an ability script. Reading the card-level requirement
    // for an ability (or vice versa) is how a bounce ability on a reanimation
    // spell would read as recovery.
    const spellZone = def.targetRequirement?.zone;
    const pairs: [readonly EffectOp[] | undefined, string | undefined][] = [
        [def.effects, spellZone],
        [def.aiEffects, spellZone],
        // A cast-time `SpellMode` carries no `aiEffects` shadow of its own.
        // A `SpellMode` announces its own target (Darigaaz's Charm's regrowth
        // mode declares `zone: "graveyard"` while the card does not), so the
        // mode's requirement governs the mode's script; the card-level one is
        // only the fallback.
        ...(def.modes ?? []).map(
            (m) =>
                [m.effects, m.targetRequirement?.zone ?? spellZone] as [
                    readonly EffectOp[] | undefined,
                    string | undefined,
                ]
        ),
        ...[
            ...(def.activatedAbilities ?? []),
            ...(def.triggeredAbilities ?? []),
        ].flatMap(
            (a) =>
                [
                    [a.effects, a.targetRequirement?.zone],
                    [a.aiEffects, a.targetRequirement?.zone],
                ] as [readonly EffectOp[] | undefined, string | undefined][]
        ),
    ];
    for (const [script, targetZone] of pairs) {
        if (script && scriptRecoversFromGraveyard(script, targetZone)) {
            return true;
        }
    }
    return false;
}

/** Memo keyed by REGISTRY id. The answer is a property of the frozen
 *  `CardDefinition` alone — no game state enters it — so it is computed once
 *  per card id for the life of the process. This is what keeps the term off
 *  the hot path's budget: `evaluate` runs per ISMCTS leaf, and walking every
 *  hand + battlefield card's full Effect Script per leaf is not affordable. */
const RECOVERY_BY_ID = new Map<string, boolean>();

function idRecoversFromGraveyard(cardId: string): boolean {
    const hit = RECOVERY_BY_ID.get(cardId);
    if (hit !== undefined) return hit;
    const def = tryGetDefinition(cardId);
    const answer = def ? definitionRecoversFromGraveyard(def) : false;
    RECOVERY_BY_ID.set(cardId, answer);
    return answer;
}

function instanceRecoversFromGraveyard(card: CardInstanceState): boolean {
    const id = (card.card as { id?: string }).id;
    return id ? idRecoversFromGraveyard(id) : false;
}

/** Latent worth of a graveyard card, memoized by REGISTRY id.
 *
 *  `cardValue` walks the card's whole Effect Script and queries the layer
 *  system for P/T on every call, and the term needs a value for every
 *  reachable card on every ISMCTS leaf. For a card in a GRAVEYARD the
 *  id-keyed `cardValueById` is the same derivation off the same
 *  `CardDefinition` — no continuous effect applies to it (CR 611.2c), so
 *  there is nothing live to read — which makes the answer a pure function of
 *  the id and safe to cache for the life of the process. */
const LATENT_BY_ID = new Map<string, number>();

export function latentGraveyardValue(card: CardInstanceState): number {
    const id = (card.card as { id?: string }).id;
    if (!id) return 0;
    const hit = LATENT_BY_ID.get(id);
    if (hit !== undefined) return hit;
    const value = cardValueById(id);
    LATENT_BY_ID.set(id, value);
    return value;
}

/** REACH SHAPE 2 — does `player` hold or control a card that can pull a card
 *  back out of a graveyard?
 *
 *  Read over the zones the Bot may LEGITIMATELY see: its own hand and the
 *  battlefield, both public to the evaluating seat under the determinization
 *  the search already performed. The library is deliberately excluded — a
 *  recursion spell the player has not drawn is not access, and reading it
 *  would price a graveyard off information no seat holds.
 *
 *  SYMMETRY. Called for BOTH seats by the evaluator, exactly like every other
 *  term: an opponent's filled graveyard credits the OPPONENT, and is gated on
 *  the OPPONENT's own reach by this same predicate — never assumed hostile,
 *  never assumed harmless. */
export function hasGraveyardRecursionAccess(player: PlayerState): boolean {
    for (const card of player.hand) {
        if (instanceRecoversFromGraveyard(card)) return true;
    }
    for (const perm of player.battlefield) {
        if (instanceRecoversFromGraveyard(perm)) return true;
    }
    return false;
}

/** REACH SHAPE 1 — is this card in `player`'s graveyard usable from there on
 *  its own, with no other card required?
 *
 *  Castability routes through `graveyardCastMechanism` (`castCost.ts`), the
 *  single authority on the question — the same function the enumerator and the
 *  cost path ask, so the evaluator can never come to believe a card is
 *  reachable that the Bot could not then actually cast. The activated-ability
 *  half reads `ActivatedAbility.activateFromGraveyard` (CR 113.6) off the
 *  registry definition, keyed by the id that survives the wire projection.
 *
 *  THE ONE SUBTRACTION — no double count with `graveyardEngineTerm`. A
 *  battlefield engine that GRANTS escape to the whole graveyard (CR 702.138,
 *  Underworld Breach) makes `graveyardCastMechanism` answer `"escape"` for
 *  every nonland card in it, and `graveyardEngineTerm` has already priced that
 *  pile — as throughput, which is the better model for it, since the fodder to
 *  pay the escape cost is the real limiter. So a granted escape is NOT reach
 *  here; only a PRINTED one is (`getPrintedEscape`, the same split
 *  `getEscapeCost` draws). Without this the two terms stack and every
 *  Breach board is valued twice. */
export function isSelfReachableInGraveyard(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    // PRECONDITION: `card` is in `player.graveyard` (every caller iterates it).
    // The caller iterates `player.graveyard`, so membership is established and
    // the checked entry point's O(n) scan would make the loop O(n²).
    const mechanism = graveyardCastMechanismForMember(
        state,
        player,
        card,
        player.id
    );
    if (mechanism !== undefined) {
        // Everything except a BATTLEFIELD-GRANTED escape is this term's to
        // credit; a granted one belongs to `graveyardEngineTerm` alone.
        if (mechanism !== "escape" || getPrintedEscape(card) !== undefined) {
            return true;
        }
    }
    // CR 305.9 — a LAND is played, never cast, so `graveyardCastMechanism` is
    // silent on it. The land half of the same question lives in
    // `canPlayLandsFromGraveyard` (Crucible of Worlds, Ramunap Excavator,
    // Yawgmoth's Will's land-inclusive permission).
    if (isLand(card) && canPlayLandsFromGraveyard(state, player)) return true;
    const id = (card.card as { id?: string }).id;
    const def = id ? tryGetDefinition(id) : undefined;
    if (!def) return false;
    // A graveyard-zone ability that returns THE CARD ITSELF (CR 113.6) — the
    // self-recovery `hasGraveyardRecursionAccess` deliberately refuses, landing
    // here where it applies to the one card it can actually return. Two
    // spellings: an ACTIVATED ability declaring `activateFromGraveyard`
    // (Ashen Ghoul), and a TRIGGERED ability scoped to the graveyard zone
    // whose script moves `$source` out of it (Bloodghast's landfall return,
    // Squee, Goblin Nabob, Sword of the Meek). Only triggered abilities carry
    // `zone` — an activated one says the same thing with
    // `activateFromGraveyard`, checked just above.
    if (
        (def.activatedAbilities ?? []).some(
            (ability) => ability.activateFromGraveyard === true
        )
    ) {
        return true;
    }
    return (def.triggeredAbilities ?? []).some(
        (ability) =>
            ability.zone === "graveyard" &&
            scriptSelfRecoversFromGraveyard(ability.effects)
    );
}
