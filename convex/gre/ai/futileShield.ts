/**
 * "Can the shield this activation creates ever be used?" — a root-move prune
 * for the bot (issue #5493).
 *
 * THE DECISION IT SERVES. A regeneration shield (CR 701.19a) is a
 * replacement effect for the NEXT time the permanent "would be destroyed this
 * turn", and it ends with the turn (CR 514.2). A "prevent the next N damage
 * to <permanent> this turn" shield (CR 615.1a) is the same shape for damage.
 * Neither does anything unless a destruction / damage event reaches its
 * permanent before cleanup. The bot used to activate "{G}: Regenerate" in
 * response to an Aura that destroys nothing (Sleeping Potion), paying mana for
 * a shield that could never apply: the dominance probe
 * (`isDominatedNoOpMove`) sees the shield as a real state delta, and the
 * evaluator reads nothing that tells a shielded creature from a bare one, so
 * the activation and `pass` tie and the pick falls to rollout noise.
 *
 * WHY "NO THREAT NOW" IS ENOUGH. Every destruction or damage event that can
 * reach the permanent before the turn ends comes from one of three places,
 * and the bot gets priority before each of them:
 *
 *   1. An object ON THE STACK resolving. Anything cast or put on the stack
 *      after this decision gives the bot priority again before it resolves —
 *      the active player receives priority after every resolution
 *      (CR 117.3b) — so only what is ALREADY there can catch a passing bot
 *      unshielded.
 *   2. COMBAT damage — and the bot gets priority in the declare-blockers step
 *      (CR 509.2) before any is dealt, so only a creature already attacking or
 *      blocking is exposed now.
 *   3. The lethal-damage state-based action (CR 704.5g — "Regeneration can
 *      replace this event") on damage ALREADY marked.
 *
 * With none of those, `pass` dominates the activation: the bot can always
 * make it later, when a threat appears, at the same price.
 *
 * IT FAILS CLOSED. A wrongly-pruned line is invisible (the bot never
 * considers a play); a wrongly-kept one costs a little search width. So every
 * unproven input answers `false` and leaves the move searchable:
 *
 *   * threats are OVER-counted — every stack object counts except a permanent
 *     spell (CR 608.3: resolving, it becomes a permanent; any enters trigger
 *     goes on the stack later, case 1 again) and an object whose whole script
 *     only taps, keeps from untapping, draws or gains life (Sleeping Potion's
 *     own "tap enchanted creature" trigger, read through its `aiEffects`
 *     shadow script); a creature in combat counts as two (a first-strike step
 *     and a regular one, CR 510.4); any marked damage counts;
 *   * a tap / keep-from-untapping script is NOT harmless against a {T}-cost
 *     shield — tapping its source closes the window to activate it later.
 *     Tapping the activation's MANA sources is not modelled: a narrowing;
 *   * only an ability whose WHOLE script is shield Ops on permanents
 *     qualifies — any other Op, a construct, a mode, a mana rider or an
 *     imperative `resolve()` keeps the move;
 *   * only a tap / mana cost, or a sacrifice nothing reads (below),
 *     qualifies — any other cost (a discard, a life payment, a Drought tax)
 *     can itself be a payoff;
 *   * an announced TARGET keeps the move while any permanent listens for
 *     `BECAME_TARGET` — targeting can be the payoff (Sleeping Potion's own
 *     "sacrifice Sleeping Potion" clause);
 *   * a prevention shield is forgiven only for `next-n` to a permanent until
 *     end of turn; player-scoped and source-scoped shields are kept (a
 *     painland's mana ability damages its controller without the stack).
 *
 * LAND-TYPE CHANGES (issue #6915). An until-end-of-turn `setSubtype` to a
 * basic land type on a land (CR 305.7 — the land loses its old land types
 * and the abilities its rules text generated, and gains the new type's
 * intrinsic mana ability, CR 305.6) is the same this-turn shape: the Op is
 * signed `neutral` on purpose (fixing, mana denial and landwalk all share it),
 * so with nothing to read the new type it ties with `pass`. It is pruned only
 * when no consumer exists before the bot next holds priority — every one of
 * these keeps the move:
 *
 *   * anything on the stack (an object may read the type as it resolves);
 *   * a landwalker while blocks can still be declared this turn (CR 702.14c
 *     is checked at the declaration, CR 509.1b), or an extra phase queued;
 *   * a type-reading card — Oracle text naming a basic land type or "land
 *     type(s)" — on any battlefield or in the mover's hand or graveyard;
 *     the land-type changes themselves are read out of the text first;
 *   * a land with any ability beyond an uncosted mana ability (stripping it
 *     is a payoff);
 *   * an UNTAPPED land of another player (its mana changes colour before the
 *     bot's next priority — the opponent taps it after the bot passes);
 *   * an UNTAPPED land of the mover's own whose new colour turns a cost in
 *     hand, or a non-mana activation on the mover's battlefield, from
 *     unpayable to payable (`canPayCost` with the land's unit replaced).
 *     Combinations of several costs, and cards cast from other zones, are
 *     not modelled: a narrowing.
 *
 * DEFENSIVE KEYWORD GRANTS (issue #6942). An until-end-of-turn grant of
 * shroud, hexproof, indestructible or protection (`isDefensiveKeyword`) is
 * the same this-turn shape: it answers a threat or buys nothing, and the bot
 * used to sacrifice its lands to Sylvan Safekeeper in response to a creature
 * spell. Pruned when, before the bot next holds priority:
 *
 *   * the permanent already has that keyword, or an identical grant to it
 *     sits on the stack ABOVE every threat — a second instance is redundant
 *     (CR 702.11h, 702.12c, 702.16m, 702.18b); a threat placed above the
 *     pending grant keeps the move;
 *   * the cost sacrifices a permanent and no threat it can answer exists
 *     (a tap / mana grant stays priced by the quiet-position valuation,
 *     `defensiveGrants.ts`). Shroud and hexproof only stop
 *     targeting (CR 702.18a, 702.11b), so only a stack object TARGETING the
 *     permanent threatens; indestructible and protection share the shield
 *     count above. Protection on a permanent something is attached to keeps
 *     the move — the Aura or Equipment falls off (CR 702.16c, 702.16d).
 *
 * A SACRIFICE cost (issue #6942) is a pure loss too unless something reads
 * what it puts into a graveyard: it qualifies only while no card on any
 * battlefield, nor in the mover's hand or graveyard, names a graveyard,
 * dying, sacrificing, leaving the battlefield or threshold in its Oracle text
 * (the source's own sacrifice-cost ability excepted). Any other cost leg
 * still fails closed.
 *
 * Covers printed AND granted activations (Zombie Master's "{B}: Regenerate
 * this permanent."), via `getEffectiveActivatedAbilities`. Casting a
 * shield-only spell is not covered: a cast can trigger "whenever you cast"
 * payoffs.
 *
 * SCOPE. Bot decision quality only — the engine still offers the activation,
 * and a human may still make it.
 */

import type {
    ActivatedAbility,
    EffectOp,
    EffectObjectSelector,
} from "../../cards/types";
import type { CardInstanceState, GameState, StackItem } from "../state";
import type { Move } from "../moves";
import { findPermanent } from "../lookup";
import {
    getEffectiveActivatedAbilities,
    resolveGrantedActivatedAbility,
} from "../activatedAbilities";
import { effectiveTriggeredAbilities, findTriggeredAbility } from "../copy";
import { tryGetDefinition } from "../../cards";
import { getStaticAdditionalSacrifices } from "../state";
import {
    isLand,
    isManaAbilityDefinition,
    isSpellStackItem,
    PERMANENT_TYPES,
} from "../constants";
import { LAND_SUBTYPE_MANA } from "../manaColors";
import {
    canPayCost,
    getProducibleManaUnits,
    manaUnitsFor,
} from "../manaAvailability";
import { SOURCE_BINDING } from "../effects/interpreter";
import { getEffectivePower } from "../layers";
import { isProtectionAbility } from "../protection";
import { misdirectedTargetCount } from "./beneficence";
import { isDefensiveKeyword } from "./defensiveGrants";

/** The cost legs whose payment is a pure loss (mana, tapping the source).
 *  Any other key on the cost object fails closed. */
const LOSS_ONLY_COST_KEYS: ReadonlySet<string> = new Set(["tap", "mana"]);

/** The sacrifice-another-permanent cost legs (CR 118.5) — a pure loss only
 *  while nothing reads the graveyard trip (`sacrificeIsLossOnly`). */
const SACRIFICE_COST_KEYS: ReadonlySet<string> = new Set([
    "sacrificeFilter",
    "sacrificeFilterCount",
]);

/** Oracle words of a card that can turn a sacrifice into a payoff: a dies /
 *  leaves / sacrifice trigger, a graveyard count (threshold), a graveyard
 *  reader. */
const SACRIFICE_PAYOFF_WORDS =
    /graveyard|\bdies\b|\bdie\b|sacrific|leaves the battlefield|threshold/i;

/** CR 702.18a / 702.11b — keywords whose whole effect is to stop targeting. */
const TARGETING_ONLY_KEYWORDS: ReadonlySet<string> = new Set([
    "shroud",
    "hexproof",
]);
/** CR 510.4 — up to two combat damage steps. */
const COMBAT_THREATS = 2;

type ShieldKind =
    | "regeneration"
    | "prevention"
    | "pump"
    | "landType"
    | "keyword";

type Shield = {
    kind: ShieldKind;
    permanentId: string;
    subtype?: string;
    keyword?: string;
};

/** The this-turn effects `move` creates when it activates an ability whose
 *  WHOLE script is shields / until-end-of-turn P/T changes paid for with a
 *  loss-only cost; `null` for any other move. Shared by both prunes below. */
function thisTurnEffectsOf(
    state: GameState,
    move: Move
): {
    shields: Shield[];
    tapCost: boolean;
    sacrificeCost: boolean;
    moverId: string;
} | null {
    if (move.kind !== "activate-ability") return null;
    if (state.gameOver) return null;
    const source = findPermanent(state, move.cardInstanceId);
    if (!source) return null;
    const ability = getEffectiveActivatedAbilities(source).find(
        (a) => a.ability.id === move.abilityId
    )?.ability;
    if (!ability) return null;
    if (!costIsLossOnly(state, source, ability)) return null;
    const shields = shieldsOf(
        ability,
        source.id,
        move.targets,
        ability.cost.tap === true
    );
    if (!shields) return null;
    return {
        shields,
        tapCost: ability.cost.tap === true,
        sacrificeCost: ability.cost.sacrificeFilter !== undefined,
        moverId: source.controllerId,
    };
}

/** True when `move` activates an ability whose only outcome is a this-turn
 *  shield or P/T change that no event can consume before it would be needed —
 *  see the module header. */
export function isFutileThisTurnMove(state: GameState, move: Move): boolean {
    const effects = thisTurnEffectsOf(state, move);
    if (!effects) return false;
    if (move.kind !== "activate-ability") return false;
    if (move.targets.length > 0 && anyBecameTargetListener(state)) return false;
    return effects.shields.every((s) =>
        shieldIsFutile(
            state,
            s,
            effects.tapCost,
            effects.sacrificeCost,
            effects.moverId
        )
    );
}

/** True when `move` is a this-turn shield / P/T activation aimed against its
 *  sign: a protecting shield or a positive pump at the opponent's permanent, a
 *  negative pump at the mover's own. Pruned rather than ranked — a misdirected
 *  variant of a script that buys nothing for the mover ties with `pass` and
 *  can win on rollout noise, and when no correctly-signed target exists
 *  nothing else is left to prefer. A neutral or unreadable sign is kept. */
export function isMisdirectedThisTurnMove(
    state: GameState,
    move: Move,
    botId: string
): boolean {
    if (!thisTurnEffectsOf(state, move)) return false;
    return misdirectedTargetCount(state, move, botId) > 0;
}

function costIsLossOnly(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    let sacrifices = false;
    for (const [key, value] of Object.entries(ability.cost)) {
        if (value === undefined || value === false) continue;
        if (SACRIFICE_COST_KEYS.has(key)) {
            sacrifices = true;
            continue;
        }
        if (!LOSS_ONLY_COST_KEYS.has(key)) return false;
    }
    if (sacrifices && !sacrificeIsLossOnly(state, source, ability)) {
        return false;
    }
    // A Drought-style static tax (CR 118.8) adds a sacrifice to the payment.
    return (
        getStaticAdditionalSacrifices(
            state,
            ability.cost.mana,
            source,
            "ability"
        ).length === 0
    );
}

/** Every shield the ability's script creates, or `null` when the script does
 *  anything else (or is not a plain Op list). */
function shieldsOf(
    ability: ActivatedAbility,
    sourceId: string,
    targets: Extract<Move, { kind: "activate-ability" }>["targets"],
    tapCost: boolean
): Shield[] | null {
    if (ability.resolve || ability.resolveSteps || ability.effect) return null;
    if (
        ability.manaProduced ||
        ability.manaAmount ||
        ability.manaChoices ||
        ability.getManaChoices
    ) {
        return null;
    }
    if (ability.modes && ability.modes.length > 0) return null;
    const effects = ability.effects;
    if (!effects || effects.length === 0) return null;
    const out: Shield[] = [];
    for (const op of effects) {
        // CR 608.2d — the land type "of your choice" is an `optionChoice`
        // whose every mode is one land-type change; each mode is a shield.
        if ("op" in op && op.op === "optionChoice") {
            if (op.modes.length === 0) return null;
            for (const mode of op.modes) {
                if (mode.effects.length !== 1) return null;
                const shield =
                    landTypeChangeOf(mode.effects[0]!, sourceId, targets) ??
                    keywordGrantOf(mode.effects[0]!, sourceId, targets);
                if (!shield) return null;
                out.push(shield);
            }
            continue;
        }
        const shield = shieldOf(op, sourceId, targets, tapCost);
        if (!shield) return null;
        out.push(shield);
    }
    return out;
}

function shieldOf(
    op: EffectOp,
    sourceId: string,
    targets: Extract<Move, { kind: "activate-ability" }>["targets"],
    tapCost: boolean
): Shield | null {
    if (!("op" in op)) return null;
    if (op.op === "regenerate") {
        const permanentId = permanentNamed(op.target, sourceId, targets);
        return permanentId ? { kind: "regeneration", permanentId } : null;
    }
    if (op.op === "preventDamage" && op.mode === "next-n") {
        // CR 514.2 — only a shield that ends with this turn; a longer one can
        // meet a threat the bot never gets priority against in time.
        if (
            op.duration.phase !== "end-of-turn" ||
            (op.duration.skip ?? 0) > 0
        ) {
            return null;
        }
        if ("player" in op.to) return null;
        const permanentId = permanentNamed(op.to, sourceId, targets);
        return permanentId ? { kind: "prevention", permanentId } : null;
    }
    if (op.op === "pump") {
        // A pump is pruned only when it taps its source: the loss is the
        // source's attack or block, which no later activation recovers. A
        // mana-only pump can be made later at the same price, and the locked
        // verdicts keep it a candidate.
        if (!tapCost) return null;
        // CR 611.2 — only an until-end-of-turn change; a longer one outlives
        // the turn and can be consumed after the bot's next priority.
        if (
            op.duration.phase !== "end-of-turn" ||
            (op.duration.skip ?? 0) > 0
        ) {
            return null;
        }
        // CR 704.5f — toughness 0 or less puts the creature into its owner's
        // graveyard by itself, with no combat or stack object needed: a
        // shrink that can lower toughness is its own payoff. Only a literal
        // non-negative toughness change is provably inert on its own.
        if (typeof op.toughness !== "number" || op.toughness < 0) return null;
        const permanentId = permanentNamed(op.target, sourceId, targets);
        return permanentId ? { kind: "pump", permanentId } : null;
    }
    return (
        landTypeChangeOf(op, sourceId, targets) ??
        keywordGrantOf(op, sourceId, targets)
    );
}

/** CR 611.2a — an until-end-of-turn grant of one defensive keyword
 *  (`isDefensiveKeyword`) to a permanent; `null` for any other Op or shape. */
function keywordGrantOf(
    op: EffectOp,
    sourceId: string,
    targets: Extract<Move, { kind: "activate-ability" }>["targets"]
): Shield | null {
    if (!("op" in op) || op.op !== "grantAbility") return null;
    if (op.grantedActivatedId || op.grantedTriggeredId) return null;
    if (op.attackRequirement) return null;
    const keyword = op.ability;
    if (!keyword || !isDefensiveKeyword(keyword)) return null;
    if (
        !op.duration ||
        op.duration.phase !== "end-of-turn" ||
        (op.duration.skip ?? 0) > 0
    ) {
        return null;
    }
    const permanentId = permanentNamed(op.target, sourceId, targets);
    return permanentId ? { kind: "keyword", permanentId, keyword } : null;
}

/** CR 305.7 — an until-end-of-turn change of a permanent's land type to one
 *  literal basic land type; `null` for any other Op or shape. */
function landTypeChangeOf(
    op: EffectOp,
    sourceId: string,
    targets: Extract<Move, { kind: "activate-ability" }>["targets"]
): Shield | null {
    if (!("op" in op) || op.op !== "setSubtype") return null;
    if (!Array.isArray(op.subtypes) || op.subtypes.length !== 1) return null;
    const subtype = op.subtypes[0]!;
    if (!(subtype in LAND_SUBTYPE_MANA)) return null;
    if (op.family === "creature") return null;
    // CR 611.2a — only a change that ends with this turn.
    if (
        !op.duration ||
        op.duration.phase !== "end-of-turn" ||
        (op.duration.skip ?? 0) > 0
    ) {
        return null;
    }
    const permanentId = permanentNamed(op.target, sourceId, targets);
    return permanentId ? { kind: "landType", permanentId, subtype } : null;
}

/** The battlefield permanent a selector names: `$source`, or an announced
 *  slot holding a permanent. A player slot or any other ref answers `null`. */
function permanentNamed(
    selector: EffectObjectSelector,
    sourceId: string,
    targets: Extract<Move, { kind: "activate-ability" }>["targets"]
): string | null {
    if ("ref" in selector) {
        return selector.ref === SOURCE_BINDING ? sourceId : null;
    }
    const slot = targets[selector.target];
    return slot?.type === "permanent" ? slot.id : null;
}

function anyBecameTargetListener(state: GameState): boolean {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            for (const trigger of effectiveTriggeredAbilities(card)) {
                const events = Array.isArray(trigger.event)
                    ? trigger.event
                    : [trigger.event];
                if (events.includes("BECAME_TARGET")) return true;
            }
        }
    }
    return false;
}

function shieldIsFutile(
    state: GameState,
    shield: Shield,
    tapCost: boolean,
    sacrificeCost: boolean,
    moverId: string
): boolean {
    const permanent = findPermanent(state, shield.permanentId);
    if (!permanent) return false;
    if (shield.kind === "landType") {
        return landTypeChangeIsFutile(
            state,
            permanent,
            shield.subtype!,
            moverId
        );
    }
    if (shield.kind === "keyword") {
        return keywordGrantIsFutile(
            state,
            permanent,
            shield.keyword!,
            tapCost,
            sacrificeCost
        );
    }
    const threats = threatsTo(state, permanent, tapCost, shield.kind);
    // A P/T change is consumed by combat damage involving the creature (even
    // an unblocked attacker deals its power to the player) or a marked-damage
    // check, so it shares the prevention shield's zero-threat test.
    if (shield.kind === "prevention" || shield.kind === "pump") {
        return threats === 0;
    }
    // CR 701.19c — "can't be regenerated" makes any shield inapplicable; an
    // exile-on-death replacement suppresses it the same way. A continuous
    // auto-regeneration replacement already answers every destruction.
    if (
        permanent.cantBeRegeneratedThisTurn === true ||
        permanent.exileOnDeath === true ||
        permanent.staticAbilities.includes("auto-regenerate")
    ) {
        return true;
    }
    const shields =
        (permanent.regenerationShields ?? 0) +
        pendingRegenerationShields(state, permanent.id);
    return shields >= threats;
}

/** Regeneration shields already on the stack for `permanentId`: an object
 *  whose whole script is `regenerate` Ops naming it (CR 701.19a). Only those
 *  ABOVE every threatening object count — they resolve first (CR 608.1), so
 *  the shield stands before any threat below them; one under a threat comes
 *  too late for it, and is not counted. */
function pendingRegenerationShields(
    state: GameState,
    permanentId: string
): number {
    let pending = 0;
    // The top of the stack is its last element; stop at the first threat.
    for (let i = state.stack.length - 1; i >= 0; i--) {
        const item = state.stack[i]!;
        if (!isHarmlessStackItem(item, false)) break;
        const script = stackItemScript(item);
        if (!script || script.length === 0) continue;
        const sourceId = item.triggerSourceId ?? item.id;
        const targets = item.targets ?? [];
        if (
            script.every(
                (op) =>
                    "op" in op &&
                    op.op === "regenerate" &&
                    permanentNamed(op.target, sourceId, targets) === permanentId
            )
        ) {
            pending += script.length;
        }
    }
    return pending;
}

/** Is a defensive keyword grant to `permanent` provably unused before the bot
 *  next holds priority — see the module header. */
function keywordGrantIsFutile(
    state: GameState,
    permanent: CardInstanceState,
    keyword: string,
    tapCost: boolean,
    sacrificeCost: boolean
): boolean {
    // CR 702.11h / 702.12c / 702.16m / 702.18b — a second instance is
    // redundant; an effect that strips the first strips a later grant too.
    if (permanent.staticAbilities.includes(keyword)) return true;
    // CR 702.16c / 702.16d — protection drops what is attached to it.
    if (isProtectionAbility(keyword) && anyAttachedTo(state, permanent.id)) {
        return false;
    }
    const targetingOnly = TARGETING_ONLY_KEYWORDS.has(keyword);
    // The top of the stack is its last element. An identical grant met
    // before any threat resolves first (CR 608.1) and answers everything
    // below it; a threat met first resolves before any pending grant.
    for (let i = state.stack.length - 1; i >= 0; i--) {
        const item = state.stack[i]!;
        if (isPendingKeywordGrant(item, permanent.id, keyword)) return true;
        const threat = targetingOnly
            ? targetsPermanent(item, permanent.id) ||
              (tapCost && !isHarmlessStackItem(item, true))
            : !isHarmlessStackItem(item, tapCost);
        if (threat) return false;
    }
    // No threat at all: pruned for a sacrifice cost only. A tap / mana grant
    // stays with the quiet-position valuation (`defensiveGrants.ts`) and the
    // verdicts that pin it (issue #1890).
    if (!sacrificeCost) return false;
    // CR 702.18a / 702.11b — combat and marked damage are not theirs to stop.
    if (targetingOnly) return true;
    return threatsTo(state, permanent, tapCost, "keyword") === 0;
}

/** A stack object whose whole script grants `keyword` to `permanentId`. */
function isPendingKeywordGrant(
    item: StackItem,
    permanentId: string,
    keyword: string
): boolean {
    const script = stackItemScript(item);
    if (!script || script.length === 0) return false;
    const sourceId = item.triggerSourceId ?? item.id;
    const targets = item.targets ?? [];
    return script.every(
        (op) =>
            "op" in op &&
            op.op === "grantAbility" &&
            op.ability === keyword &&
            permanentNamed(op.target, sourceId, targets) === permanentId
    );
}

function targetsPermanent(item: StackItem, permanentId: string): boolean {
    return (item.targets ?? []).some((t) => t.id === permanentId);
}

function anyAttachedTo(state: GameState, permanentId: string): boolean {
    return state.players.some((p) =>
        p.battlefield.some((c) => c.attachedTo === permanentId)
    );
}

/** CR 118.5 — a sacrifice is a pure loss while no card can read the
 *  permanent's trip to the graveyard. An unknown definition or Oracle text
 *  reads as a reader. */
function sacrificeIsLossOnly(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    for (const player of state.players) {
        const zones =
            player.id === source.controllerId
                ? [player.battlefield, player.hand, player.graveyard]
                : [player.battlefield];
        for (const zone of zones) {
            for (const card of zone) {
                const def = tryGetDefinition(card.card.id as string);
                if (!def || def.oracleText === undefined) return false;
                const text =
                    card.id === source.id && ability.oracleText
                        ? def.oracleText.replace(ability.oracleText, "")
                        : def.oracleText;
                if (SACRIFICE_PAYOFF_WORDS.test(text)) return false;
            }
        }
    }
    return true;
}

/** Phases from which a declare-blockers step can still come this turn. */
const BLOCKS_AHEAD_PHASES: ReadonlySet<string> = new Set([
    "MULLIGAN",
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
]);

/** A basic land type, its landwalk ("gains mountainwalk"), or "land type(s)"
 *  in Oracle text — a card that reads the type a land-type change writes. */
const LAND_TYPE_WORDS =
    /\b(plains|islands?|swamps?|mountains?|forests?)(walk)?\b|\bland types?\b/i;

/** Is an until-end-of-turn change of `land` to `subtype` provably unused
 *  before `moverId` next holds priority — see the module header. */
function landTypeChangeIsFutile(
    state: GameState,
    land: CardInstanceState,
    subtype: string,
    moverId: string
): boolean {
    if (!isLand(land)) return false;
    if (state.stack.length > 0) return false;
    if (!hasOnlyPlainManaAbilities(land)) return false;
    if (landwalkCanStillMatter(state)) return false;
    if (anyLandTypeReader(state, moverId)) return false;
    if (!land.isTapped) {
        if (land.controllerId !== moverId) return false;
        if (retypeUnlocksACost(state, land, subtype, moverId)) return false;
    }
    return true;
}

/** CR 305.7 strips what a land's rules text generated: a land is "plain" when
 *  that is nothing beyond uncosted, script-free mana abilities. */
function hasOnlyPlainManaAbilities(land: CardInstanceState): boolean {
    if (land.staticAbilities.length > 0) return false;
    if (effectiveTriggeredAbilities(land).length > 0) return false;
    const def = tryGetDefinition(land.card.id as string);
    if (!def || (def.staticEffects?.length ?? 0) > 0) return false;
    return getEffectiveActivatedAbilities(land).every(
        ({ ability }) =>
            isManaAbilityDefinition(ability) &&
            !ability.effects &&
            !ability.resolve &&
            Object.entries(ability.cost).every(
                ([key, value]) =>
                    value === undefined || value === false || key === "tap"
            )
    );
}

/** CR 702.14c / 509.1b — a landwalker reads the defender's land types when
 *  blockers are declared; any landwalker keeps the change while such a
 *  declaration can still come this turn. */
function landwalkCanStillMatter(state: GameState): boolean {
    const blocksAhead =
        BLOCKS_AHEAD_PHASES.has(state.phase) ||
        (state.phase === "DECLARE_BLOCKERS" &&
            !state.combat?.blockersConfirmed) ||
        (state.extraPhases?.length ?? 0) > 0;
    if (!blocksAhead) return false;
    return state.players.some((p) =>
        p.battlefield.some((c) =>
            c.staticAbilities.some((k) => /walk$/i.test(k))
        )
    );
}

function anyLandTypeReader(state: GameState, moverId: string): boolean {
    for (const player of state.players) {
        const zones =
            player.id === moverId
                ? [player.battlefield, player.hand, player.graveyard]
                : [player.battlefield];
        for (const zone of zones) {
            if (zone.some(readsLandTypes)) return true;
        }
    }
    return false;
}

/** Does the card's Oracle text, less its own land-type-change abilities, name
 *  a land type? An unknown definition reads as a reader. */
function readsLandTypes(card: CardInstanceState): boolean {
    const def = tryGetDefinition(card.card.id as string);
    if (!def) return true;
    if (def.oracleText === undefined) return true;
    let text = def.oracleText;
    for (const ability of def.activatedAbilities ?? []) {
        if (ability.oracleText && isLandTypeChangeScript(ability.effects)) {
            text = text.replace(ability.oracleText, "");
        }
    }
    return LAND_TYPE_WORDS.test(text);
}

function isLandTypeChangeScript(
    effects: readonly EffectOp[] | undefined
): boolean {
    if (!effects || effects.length === 0) return false;
    return effects.every((op) => {
        if (!("op" in op)) return false;
        if (op.op === "optionChoice") {
            return op.modes.every((m) => isLandTypeChangeScript(m.effects));
        }
        return op.op === "setSubtype";
    });
}

/** Does replacing `land`'s mana unit with `subtype`'s colour (CR 305.6) turn
 *  any cost the mover holds from unpayable to payable? An unreadable census
 *  answers `true`. */
function retypeUnlocksACost(
    state: GameState,
    land: CardInstanceState,
    subtype: string,
    moverId: string
): boolean {
    const player = state.players.find((p) => p.id === moverId);
    if (!player) return true;
    const units = manaUnitsFor(state, player);
    const own = getProducibleManaUnits(land, moverId)[0];
    const at = own
        ? units.findIndex(
              (u) => u.size === own.size && [...own].every((c) => u.has(c))
          )
        : -1;
    if (at < 0) return true;
    const retyped = units.map((u, i) =>
        i === at ? new Set([LAND_SUBTYPE_MANA[subtype]!]) : u
    );
    const opts = { life: player.life };
    return demandedCosts(player).some(
        (cost) =>
            !canPayCost(units, cost, opts) && canPayCost(retyped, cost, opts)
    );
}

/** The mana costs the mover may want to pay this turn: every card in hand and
 *  every non-mana activation on its battlefield. */
function demandedCosts(player: GameState["players"][number]) {
    const costs: NonNullable<ActivatedAbility["cost"]["mana"]>[] = [];
    for (const card of player.hand) {
        const cost = tryGetDefinition(card.card.id as string)?.manaCost;
        if (cost) costs.push(cost);
    }
    for (const card of player.battlefield) {
        for (const { ability } of getEffectiveActivatedAbilities(card)) {
            if (ability.cost.mana && !isManaAbilityDefinition(ability)) {
                costs.push(ability.cost.mana);
            }
        }
    }
    return costs;
}

/** An upper bound on the destruction / damage events that can reach
 *  `permanent` before its controller next holds priority — see the module
 *  header's three cases. */
function threatsTo(
    state: GameState,
    permanent: CardInstanceState,
    tapCost: boolean,
    kind: ShieldKind
): number {
    let threats = 0;
    for (const item of state.stack) {
        if (!isHarmlessStackItem(item, tapCost)) threats++;
    }
    // A P/T change is consumed by the creature's own combat damage, so any
    // participation counts; a shield only by damage dealt TO it.
    const inCombat =
        kind === "pump"
            ? takesPartInCombat(state, permanent)
            : combatDamageCanReach(state, permanent);
    if (inCombat) threats += COMBAT_THREATS;
    // CR 509.1b — power also decides whether a creature may block (a
    // "can't be blocked by creatures with power N or less" attacker), and the
    // bot gets no priority between declaring blockers and the restriction
    // check, so while blocks are open a pump is never provably idle.
    if (
        kind === "pump" &&
        state.combat &&
        !state.combat.blockersConfirmed &&
        state.combat.attackerIds.length > 0
    ) {
        threats++;
    }
    if ((permanent.damageMarked ?? 0) > 0) threats++;
    return threats;
}

function takesPartInCombat(
    state: GameState,
    permanent: CardInstanceState
): boolean {
    const combat = state.combat;
    return (
        !!combat &&
        (combat.attackerIds.includes(permanent.id) ||
            permanent.id in combat.blockerAssignments)
    );
}

/** Can combat damage be dealt TO `permanent`? Before blockers are confirmed
 *  every participant may still be blocked or blocking, so it answers `true`.
 *  Once they are, an attacker nothing blocks, and a creature whose opposing
 *  creatures all have no positive power (CR 510.1a — a creature with 0 or less
 *  power assigns no combat damage), are out of reach. An opposing creature
 *  that cannot be found keeps the shield. */
function combatDamageCanReach(
    state: GameState,
    permanent: CardInstanceState
): boolean {
    if (!takesPartInCombat(state, permanent)) return false;
    const combat = state.combat;
    if (!combat || !combat.blockersConfirmed) return true;
    const opposingIds: string[] = [];
    if (combat.attackerIds.includes(permanent.id)) {
        for (const [blockerId, blocked] of Object.entries(
            combat.blockerAssignments
        )) {
            if (blocked.includes(permanent.id)) opposingIds.push(blockerId);
        }
    }
    opposingIds.push(...(combat.blockerAssignments[permanent.id] ?? []));
    return opposingIds.some((id) => {
        const opposing = findPermanent(state, id);
        return !opposing || getEffectivePower(state, opposing) > 0;
    });
}

/** CR 608.3 — a permanent spell's resolution puts it onto the battlefield and
 *  nothing else; whatever it triggers goes on the stack and gives priority back
 *  (CR 117.3b). Any other object is harmless only when its whole script is
 *  provably harmless Ops; anything unreadable is presumed a threat. */
function isHarmlessStackItem(item: StackItem, tapCost: boolean): boolean {
    if (
        isSpellStackItem(item) &&
        item.types.some((t) =>
            (PERMANENT_TYPES as readonly string[]).includes(t)
        )
    ) {
        return true;
    }
    const script = stackItemScript(item);
    if (!script || script.length === 0) return false;
    const harmless = tapCost ? NON_TAPPING_HARMLESS_OPS : HARMLESS_OPS;
    return script.every((op) => isHarmlessOp(op, harmless));
}

/** An `optionChoice` is harmless when every mode is (CR 608.2d — the mode is
 *  picked on resolution, so any of them may happen). */
function isHarmlessOp(op: EffectOp, harmless: ReadonlySet<string>): boolean {
    if (!("op" in op)) return false;
    if (op.op === "optionChoice") {
        return (
            op.modes.length > 0 &&
            op.modes.every(
                (m) =>
                    m.effects.length > 0 &&
                    m.effects.every((inner) => isHarmlessOp(inner, harmless))
            )
        );
    }
    return harmless.has(op.op);
}

/** Ops that neither tap a permanent nor destroy or damage one: a shield
 *  (CR 701.19a / 615.1a) only protects, and a land-type change (CR 305.7)
 *  only rewrites a type line and strips abilities (CR 305.7) — a creature
 *  that shrinks for losing "as long as you control a Forest" dies only on
 *  damage already marked, which the bound counts on its own. */
const NON_TAPPING_HARMLESS_OPS: ReadonlySet<string> = new Set([
    "draw",
    "gainLife",
    "regenerate",
    "preventDamage",
    "setSubtype",
]);

/** Ops that can neither destroy a permanent nor deal damage. */
const HARMLESS_OPS: ReadonlySet<string> = new Set([
    ...NON_TAPPING_HARMLESS_OPS,
    "tapUntap",
    "skipNextUntap",
]);

/** The script a stack object resolves — `effects`, else the `aiEffects`
 *  shadow script a `resolve()` ability carries for the bot (PRD #1423). A
 *  modal object, a delayed trigger or an unknown source answers `undefined`
 *  (presumed a threat). */
function stackItemScript(item: StackItem): readonly EffectOp[] | undefined {
    if (item.delayedTriggerId) return undefined;
    if (item.chosenModeIds?.length) return undefined;
    const cardId = (item.card as { id?: string }).id;
    const cardDef = cardId ? tryGetDefinition(cardId) : undefined;
    if (item.triggeredAbilityId) {
        const ability = findTriggeredAbility(item, item.triggeredAbilityId);
        return ability?.effects ?? ability?.aiEffects;
    }
    if (item.abilityId) {
        const ability = item.grantedSourceCardId
            ? resolveGrantedActivatedAbility(
                  item.grantedSourceCardId,
                  item.abilityId,
                  item.grantedAbilityOrigin
              )
            : cardDef?.activatedAbilities?.find((a) => a.id === item.abilityId);
        return ability?.effects ?? ability?.aiEffects;
    }
    return cardDef?.effects ?? cardDef?.aiEffects;
}

/** Would one more land of `subtype`'s colour (CR 305.6) turn a cost `player`
 *  holds from unpayable to payable? The target land is not needed here, so a
 *  retype that replaces a unit is approximated by an added one. */
function subtypeFillsADemandedCost(
    state: GameState,
    player: GameState["players"][number],
    subtype: string
): boolean {
    const color = LAND_SUBTYPE_MANA[subtype];
    if (!color) return false;
    const units = manaUnitsFor(state, player);
    const widened = [...units, new Set([color])];
    const opts = { life: player.life };
    return demandedCosts(player).some(
        (cost) =>
            !canPayCost(units, cost, opts) && canPayCost(widened, cost, opts)
    );
}

/** Can retyping a land to `subtype` (CR 305.7) matter to `moverId` before it
 *  next holds priority? One more land of its colour paying a cost the mover
 *  holds and cannot pay today, or a reader of land types / a landwalker
 *  anywhere. The choice-node counterpart of `landTypeChangeIsFutile`. An
 *  unreadable census answers `true`. */
export function landTypeCanMatter(
    state: GameState,
    moverId: string,
    subtype: string
): boolean {
    const player = state.players.find((p) => p.id === moverId);
    if (!player || !(subtype in LAND_SUBTYPE_MANA)) return true;
    if (landwalkCanStillMatter(state) || anyLandTypeReader(state, moverId)) {
        return true;
    }
    return subtypeFillsADemandedCost(state, player, subtype);
}

/** The basic land types a land-type-change script can write, through its modes. */
function landTypesWritten(effects: readonly EffectOp[]): string[] {
    return effects.flatMap((op) => {
        if (!("op" in op)) return [];
        if (op.op === "optionChoice") {
            return op.modes.flatMap((m) => landTypesWritten(m.effects));
        }
        return op.op === "setSubtype" && Array.isArray(op.subtypes)
            ? op.subtypes.filter((t) => t in LAND_SUBTYPE_MANA)
            : [];
    });
}

/** True when `move` activates a land-type change (CR 305.7) paid for with a
 *  loss-only cost, one type of which pays a cost its controller holds and
 *  cannot pay today. Its payoff is spent THIS turn on something only the
 *  retype enables, so holding the activation for a later window forfeits it. */
export function isCostUnlockingLandTypeChange(
    state: GameState,
    move: Move
): boolean {
    if (move.kind !== "activate-ability" || state.gameOver) return false;
    const source = findPermanent(state, move.cardInstanceId);
    const ability = source
        ? getEffectiveActivatedAbilities(source).find(
              (a) => a.ability.id === move.abilityId
          )?.ability
        : undefined;
    if (!source || !ability || !costIsLossOnly(state, source, ability)) {
        return false;
    }
    if (!isLandTypeChangeScript(ability.effects)) return false;
    const player = state.players.find((p) => p.id === source.controllerId);
    return (
        !!player &&
        landTypesWritten(ability.effects ?? []).some((t) =>
            subtypeFillsADemandedCost(state, player, t)
        )
    );
}
