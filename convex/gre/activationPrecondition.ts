import { countControlledMatching } from "../cards/controlledCount";
import { CARD_TYPES } from "../cards/types";
import type { PermanentFilter } from "../cards/filters";
import type {
    ActivatedAbility,
    CardType,
    Color,
    EffectComparisonOp,
    EffectPredicate,
    PermanentView,
    TriggerStateView,
} from "../cards/types";
import { activationRestrictionViolation } from "./activationRestrictions";
import { COLORED_MANA_COLORS, isManaAbilityDefinition } from "./constants";

/**
 * CR 602.1b / 602.5 — an activated ability's own printed restriction ("Activate only
 * if…", "Activate no more than twice each turn"), carried either as DATA
 * (`activationCondition`, an `EffectPredicate`, issue #3685) or as a
 * `canActivate` closure on the definition. Returns the rejection message, or
 * `null` when the ability carries neither or every one it carries currently
 * holds — both must hold when an ability carries both.
 *
 * The ONE authority the activation mutations (`gre/activation.ts`,
 * `game.ts`), the Bot (`enumerateAbilityMoves` in `gre/moves.ts`,
 * `hasFlexibleActivation` in `gre/evaluate.ts`) and the client affordance
 * (`getStackAbilities` and its siblings in `src/lib/card-utils.ts`) all read —
 * the `loyaltyActivationViolation` / `classLevelActivationViolation` shape, so
 * the enumerator can never offer an activation the server rejects, nor refuse
 * one the server would accept (issue #3441: before this, both Bot sites skipped
 * EVERY ability carrying a closure, and 21 shipped abilities were unreachable).
 *
 * It also answers CR 602.5's OTHER half — a prohibition imposed from outside
 * the ability, by an `activation-restriction` static on the battlefield
 * (Cursed Totem, `activationRestrictionViolation`) — checked first, so every
 * one of those consumers honours it with no second gate to forget.
 *
 * `source` is the instance exactly as the mutation resolves it, from whichever
 * zone the ability functions in (a battlefield permanent, or the graveyard
 * card of an `activateFromGraveyard` ability); `state` is the live game state.
 */
export function activationPreconditionViolation(
    state: TriggerStateView,
    source: PermanentView,
    ability: Pick<
        ActivatedAbility,
        | "canActivate"
        | "activationCondition"
        | "useStack"
        | "manaProduced"
        | "manaChoices"
        | "manaColorSource"
    >
): string | null {
    const restricted = activationRestrictionViolation(
        state,
        source.id,
        isManaAbilityDefinition(ability)
    );
    if (restricted !== null) return restricted;
    if (
        ability.activationCondition !== undefined &&
        !activationConditionHolds(state, source, ability.activationCondition)
    ) {
        return "Ability cannot be activated right now";
    }
    if (ability.canActivate === undefined) return null;
    return ability.canActivate(source, state)
        ? null
        : "Ability cannot be activated right now";
}

/**
 * CR 602.1b (issue #3685) — evaluates an `activationCondition` against the
 * activation-time game state. There is no `SpellContext` here (nothing has
 * been announced or bound), so this reads only the subset
 * `activationConditionErrors` accepts: a comparison of literal integers and
 * `count`s of a public-cardinality zone or of the battlefield. "controller" is
 * the SOURCE's controller (CR 109.5 — "your" on a permanent means its
 * controller); "opponent" is that controller's one opponent.
 *
 * Fail-CLOSED on anything outside that subset — the validator rejects it at
 * authoring time, so reaching it here means a definition skipped validation,
 * and an unreadable restriction must never let an activation through.
 */
export function activationConditionHolds(
    state: TriggerStateView,
    source: PermanentView,
    condition: EffectPredicate
): boolean {
    // The validator IS the subset's definition, so the evaluator cannot drift
    // from it: an unvalidated wrong zone or a `filter` refuses, never counts.
    if (activationConditionErrors(condition).length > 0) return false;
    if (!("op" in condition)) return false;
    const left = activationConditionValue(state, source, condition.left);
    const right = activationConditionValue(state, source, condition.right);
    if (left === undefined || right === undefined) return false;
    return compare(left, condition.op, right);
}

/** One numeric operand of an activation condition, or `undefined` for a shape
 *  outside the activation-time subset. */
function activationConditionValue(
    state: TriggerStateView,
    source: PermanentView,
    value: unknown
): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value !== "object" || value === null || !("count" in value)) {
        return undefined;
    }
    const spec = (value as { count: Record<string, unknown> }).count;
    const filter = battlefieldFilterOf(spec.filter);
    // CR 404.2 / 402.3 — a graveyard's contents and a hand's SIZE are what
    // every player can see (a hand's cards are hidden, not how many there are).
    // CR 110.1 — the battlefield is public: the permanents a player controls
    // that the filter matches.
    const sizeOf = (p: TriggerStateView["players"][number]): number =>
        spec.zone === "battlefield"
            ? countControlledMatching(p, filter, source)
            : spec.zone === "graveyard"
              ? (p.graveyard?.length ?? 0)
              : p.hand.length;
    const players = scopedPlayers(state, source, spec);
    if (players === undefined) return undefined;
    const total = players.reduce((n, p) => n + sizeOf(p), 0);
    return total * ((spec.times as number | undefined) ?? 1);
}

/**
 * CR 109.5 — whose zone a `count` reads. "opponent" is the controller's ONE
 * opponent, as the interpreter resolves it in the two-seat games this engine
 * runs; a table with any other number of opponents is outside what the
 * comparison means ("an opponent controls more lands than you" is a claim
 * about SOME opponent, not their sum), so it reads as `undefined` and the
 * restriction fails closed.
 */
function scopedPlayers(
    state: TriggerStateView,
    source: PermanentView,
    spec: Record<string, unknown>
): TriggerStateView["players"] | undefined {
    if (spec.acrossAllPlayers === true) return state.players;
    if (spec.controller === "opponent") {
        const opponents = state.players.filter(
            (p) => p.id !== source.controllerId
        );
        return opponents.length === 1 ? opponents : undefined;
    }
    return state.players.filter((p) => p.id === source.controllerId);
}

/** The activation-time `filter` (literal `type` / `color` only — the validator
 *  refuses every other key) as the `PermanentFilter` the board count reads.
 *  Both fields are any-of in either vocabulary. */
function battlefieldFilterOf(filter: unknown): PermanentFilter {
    if (typeof filter !== "object" || filter === null) return {};
    const f = filter as {
        type?: CardType | CardType[];
        color?: Color | Color[];
    };
    return {
        ...(f.type !== undefined ? { types: f.type } : {}),
        ...(f.color !== undefined ? { colors: f.color } : {}),
    };
}

/** CR 107 — number comparison. */
function compare(left: number, op: EffectComparisonOp, right: number): boolean {
    switch (op) {
        case "eq":
            return left === right;
        case "ne":
            return left !== right;
        case "lt":
            return left < right;
        case "le":
            return left <= right;
        case "gt":
            return left > right;
        case "ge":
            return left >= right;
    }
}

const COMPARISON_OPS: ReadonlySet<string> = new Set<EffectComparisonOp>([
    "eq",
    "ne",
    "lt",
    "le",
    "gt",
    "ge",
]);

/** The `count` spec keys an activation condition may carry. */
const COUNT_KEYS: ReadonlySet<string> = new Set([
    "zone",
    "controller",
    "acrossAllPlayers",
    "times",
    "filter",
]);

/** The `filter` keys a battlefield count may carry at activation time: the
 *  fields every board view reads (CR 205.2a types, CR 105.2 colours). A
 *  supertype is not on the raw engine view (CR 205.4a), a subtype ref or a
 *  name ref needs a binding, and the rest have no activation-time reading. */
const BATTLEFIELD_FILTER_KEYS: ReadonlySet<string> = new Set(["type", "color"]);

const TYPE_WORDS: ReadonlySet<string> = new Set(CARD_TYPES);
const COLOR_WORDS: ReadonlySet<string> = new Set(COLORED_MANA_COLORS);

/**
 * CR 602.1b (issue #3685) — the activation-time subset of `EffectPredicate`,
 * as a list of errors (empty = accepted). The authority on what
 * `activationConditionHolds` can evaluate: a comparison (`left`, `op`,
 * `right`) whose operands are each an integer literal or a `count` over the
 * controller's (`controller: "controller"`), the opponent's
 * (`controller: "opponent"`) or every player's (`acrossAllPlayers: true`)
 * graveyard, hand or battlefield, optionally scaled by `times`. Only a
 * battlefield count carries a `filter`, of literal `type` / `color` only
 * (issue #5258 — "Activate only if you control five or more lands").
 *
 * Everything else is refused, because it means something only during
 * resolution or reads what this evaluator cannot see: a binding / picks /
 * announced-target predicate (nothing is bound or announced before the
 * ability is activated), a `ref` operand, a hidden-zone `filter` or any other
 * filter key (the full card filter matcher lives on `SpellContext`),
 * `countTypes`, and the `library` zone.
 */
export function activationConditionErrors(condition: unknown): string[] {
    if (typeof condition !== "object" || condition === null) {
        return ["activationCondition must be an EffectPredicate object"];
    }
    const pred = condition as Record<string, unknown>;
    const keys = Object.keys(pred).sort().join(",");
    if (keys !== "left,op,right") {
        return [
            `activationCondition accepts only a comparison predicate { left, op, right } — got { ${keys} }, which needs a resolution context (bindings, picks, announced targets) an activation does not have`,
        ];
    }
    const errors: string[] = [];
    if (typeof pred.op !== "string" || !COMPARISON_OPS.has(pred.op)) {
        errors.push(
            `activationCondition: unknown comparison op ${JSON.stringify(pred.op)}`
        );
    }
    for (const side of ["left", "right"] as const) {
        errors.push(
            ...operandErrors(pred[side]).map(
                (e) => `activationCondition.${side}: ${e}`
            )
        );
    }
    return errors;
}

function operandErrors(value: unknown): string[] {
    if (typeof value === "number") {
        return Number.isInteger(value) ? [] : ["a literal must be an integer"];
    }
    if (
        typeof value !== "object" ||
        value === null ||
        Object.keys(value).join(",") !== "count"
    ) {
        return [
            `operand ${JSON.stringify(value)} is neither an integer nor a { count } — only those two are readable at activation time`,
        ];
    }
    const spec = (value as { count: unknown }).count;
    if (typeof spec !== "object" || spec === null) {
        return ["count must be an EffectCountSpec object"];
    }
    const s = spec as Record<string, unknown>;
    const errors: string[] = [];
    for (const key of Object.keys(s)) {
        if (!COUNT_KEYS.has(key)) {
            errors.push(
                `count.${key} is not readable at activation time (accepted: ${[...COUNT_KEYS].join(", ")})`
            );
        }
    }
    if (
        s.zone !== "graveyard" &&
        s.zone !== "hand" &&
        s.zone !== "battlefield"
    ) {
        errors.push(
            `count.zone ${JSON.stringify(s.zone)} — only "graveyard", "hand" and "battlefield" are counted at activation time`
        );
    }
    if (s.filter !== undefined) {
        errors.push(...filterErrors(s.zone, s.filter));
    }
    const scoped = s.controller === "controller" || s.controller === "opponent";
    const everyone = s.acrossAllPlayers === true;
    if (scoped === everyone) {
        errors.push(
            'count needs exactly one scope: controller: "controller" | "opponent" or acrossAllPlayers: true'
        );
    }
    if (
        s.times !== undefined &&
        !(
            typeof s.times === "number" &&
            Number.isInteger(s.times) &&
            s.times > 0
        )
    ) {
        errors.push("count.times must be a positive integer");
    }
    return errors;
}

/** A battlefield count's `filter`: literal card types and colours, nothing
 *  else (`BATTLEFIELD_FILTER_KEYS`). */
function filterErrors(zone: unknown, filter: unknown): string[] {
    if (zone !== "battlefield") {
        return [
            `count.filter on ${JSON.stringify(zone)} — only a battlefield count is filtered at activation time`,
        ];
    }
    if (typeof filter !== "object" || filter === null) {
        return ["count.filter must be an EffectCardFilter object"];
    }
    const errors: string[] = [];
    for (const [key, value] of Object.entries(filter)) {
        if (!BATTLEFIELD_FILTER_KEYS.has(key)) {
            errors.push(
                `count.filter.${key} is not readable at activation time (accepted: ${[...BATTLEFIELD_FILTER_KEYS].join(", ")})`
            );
            continue;
        }
        const vocabulary = key === "type" ? TYPE_WORDS : COLOR_WORDS;
        const values: unknown[] = Array.isArray(value) ? value : [value];
        if (
            values.length === 0 ||
            !values.every((v) => typeof v === "string" && vocabulary.has(v))
        ) {
            errors.push(
                `count.filter.${key} must be a literal ${key === "type" ? "card type" : "colour"} or a non-empty list of them`
            );
        }
    }
    return errors;
}
