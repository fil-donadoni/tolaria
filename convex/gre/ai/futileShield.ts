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
 *     spell (CR 608.3: resolving, it becomes a permanent; any enters trigger goes on the stack
 *     later, case 1 again), a creature in combat counts as two (a first-strike
 *     step and a regular one, CR 510.4), any marked damage counts;
 *   * only an ability whose WHOLE script is shield Ops on permanents
 *     qualifies — any other Op, a construct, a mode, a mana rider or an
 *     imperative `resolve()` keeps the move;
 *   * only a tap / mana cost qualifies — any other cost (a sacrifice, a
 *     discard, a life payment, a Drought tax) can itself be a payoff;
 *   * an announced TARGET keeps the move while any permanent listens for
 *     `BECAME_TARGET` — targeting can be the payoff (Sleeping Potion's own
 *     "sacrifice Sleeping Potion" clause);
 *   * a prevention shield is forgiven only for `next-n` to a permanent until
 *     end of turn; player-scoped and source-scoped shields are kept (a
 *     painland's mana ability damages its controller without the stack).
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
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { effectiveTriggeredAbilities } from "../copy";
import { getStaticAdditionalSacrifices } from "../state";
import { isSpellStackItem, PERMANENT_TYPES } from "../constants";
import { SOURCE_BINDING } from "../effects/interpreter";

/** The cost legs whose payment is a pure loss (mana, tapping the source).
 *  Any other key on the cost object fails closed. */
const LOSS_ONLY_COST_KEYS: ReadonlySet<string> = new Set(["tap", "mana"]);

/** CR 510.4 — up to two combat damage steps. */
const COMBAT_THREATS = 2;

type ShieldKind = "regeneration" | "prevention";

type Shield = { kind: ShieldKind; permanentId: string };

/** True when `move` activates an ability whose only outcome is a shield that
 *  no event can consume before it would be needed — see the module header. */
export function isFutileShieldMove(state: GameState, move: Move): boolean {
    if (move.kind !== "activate-ability") return false;
    if (state.gameOver) return false;
    const source = findPermanent(state, move.cardInstanceId);
    if (!source) return false;
    const ability = getEffectiveActivatedAbilities(source).find(
        (a) => a.ability.id === move.abilityId
    )?.ability;
    if (!ability) return false;
    if (!costIsLossOnly(state, source, ability)) return false;
    const shields = shieldsOf(ability, source.id, move.targets);
    if (!shields) return false;
    if (move.targets.length > 0 && anyBecameTargetListener(state)) return false;
    return shields.every((s) => shieldIsFutile(state, s));
}

function costIsLossOnly(
    state: GameState,
    source: CardInstanceState,
    ability: ActivatedAbility
): boolean {
    for (const [key, value] of Object.entries(ability.cost)) {
        if (value === undefined || value === false) continue;
        if (!LOSS_ONLY_COST_KEYS.has(key)) return false;
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
    targets: Extract<Move, { kind: "activate-ability" }>["targets"]
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
        const shield = shieldOf(op, sourceId, targets);
        if (!shield) return null;
        out.push(shield);
    }
    return out;
}

function shieldOf(
    op: EffectOp,
    sourceId: string,
    targets: Extract<Move, { kind: "activate-ability" }>["targets"]
): Shield | null {
    if (!("op" in op)) return null;
    if (op.op === "regenerate") {
        const permanentId = permanentNamed(op.target, sourceId, targets);
        return permanentId ? { kind: "regeneration", permanentId } : null;
    }
    if (op.op === "preventDamage" && op.mode === "next-n") {
        // CR 514.2 — only a shield that ends with this turn; a longer one can
        // meet a threat the bot never gets priority against in time.
        const duration = op.duration as { phase?: string };
        if (duration.phase !== "end-of-turn") return null;
        if ("player" in op.to) return null;
        const permanentId = permanentNamed(op.to, sourceId, targets);
        return permanentId ? { kind: "prevention", permanentId } : null;
    }
    return null;
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

function shieldIsFutile(state: GameState, shield: Shield): boolean {
    const permanent = findPermanent(state, shield.permanentId);
    if (!permanent) return false;
    const threats = threatsTo(state, permanent);
    if (shield.kind === "prevention") return threats === 0;
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
    return (permanent.regenerationShields ?? 0) >= threats;
}

/** An upper bound on the destruction / damage events that can reach
 *  `permanent` before its controller next holds priority — see the module
 *  header's three cases. */
function threatsTo(state: GameState, permanent: CardInstanceState): number {
    let threats = 0;
    for (const item of state.stack) {
        if (!isHarmlessStackItem(item)) threats++;
    }
    const combat = state.combat;
    if (
        combat &&
        (combat.attackerIds.includes(permanent.id) ||
            permanent.id in combat.blockerAssignments)
    ) {
        threats += COMBAT_THREATS;
    }
    if ((permanent.damageMarked ?? 0) > 0) threats++;
    return threats;
}

/** CR 608.3 — a permanent spell's resolution puts it onto the battlefield and
 *  nothing else; whatever it triggers goes on the stack and gives priority back
 *  (CR 117.3b). Every other stack object is presumed a threat. */
function isHarmlessStackItem(item: StackItem): boolean {
    if (!isSpellStackItem(item)) return false;
    return item.types.some((t) =>
        (PERMANENT_TYPES as readonly string[]).includes(t)
    );
}
