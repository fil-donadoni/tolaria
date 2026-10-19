import type {
    ActivatedAbility,
    EffectComparisonOp,
    EffectPredicate,
    PermanentView,
    TriggerStateView,
} from "../cards/types";

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
 * `source` is the instance exactly as the mutation resolves it, from whichever
 * zone the ability functions in (a battlefield permanent, or the graveyard
 * card of an `activateFromGraveyard` ability); `state` is the live game state.
 */
export function activationPreconditionViolation(
    state: TriggerStateView,
    source: PermanentView,
    ability: Pick<ActivatedAbility, "canActivate" | "activationCondition">
): string | null {
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
 * `count`s of a public-cardinality zone. "controller" is the SOURCE's
 * controller (CR 109.5 — "your" on a permanent means its controller).
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
    // CR 404.2 / 402.3 — a graveyard's contents and a hand's SIZE are what
    // every player can see (a hand's cards are hidden, not how many there are).
    const sizeOf = (p: TriggerStateView["players"][number]): number =>
        spec.zone === "graveyard" ? (p.graveyard?.length ?? 0) : p.hand.length;
    const players =
        spec.acrossAllPlayers === true
            ? state.players
            : state.players.filter((p) => p.id === source.controllerId);
    const total = players.reduce((n, p) => n + sizeOf(p), 0);
    return total * ((spec.times as number | undefined) ?? 1);
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
]);

/**
 * CR 602.1b (issue #3685) — the activation-time subset of `EffectPredicate`,
 * as a list of errors (empty = accepted). The authority on what
 * `activationConditionHolds` can evaluate: a comparison (`left`, `op`,
 * `right`) whose operands are each an integer literal or a `count` over the
 * controller's (`controller: "controller"`) or every player's
 * (`acrossAllPlayers: true`) graveyard or hand, optionally scaled by `times`.
 *
 * Everything else is refused, because it means something only during
 * resolution or reads what this evaluator cannot see: a binding / picks /
 * announced-target predicate (nothing is bound or announced before the
 * ability is activated), a `ref` operand, a `filter` (the card filter matcher
 * lives on `SpellContext`), `countTypes`, and the `library` / `battlefield`
 * zones.
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
    if (s.zone !== "graveyard" && s.zone !== "hand") {
        errors.push(
            `count.zone ${JSON.stringify(s.zone)} — only "graveyard" and "hand" are counted at activation time`
        );
    }
    const scoped = s.controller === "controller";
    const everyone = s.acrossAllPlayers === true;
    if (scoped === everyone) {
        errors.push(
            'count needs exactly one scope: controller: "controller" or acrossAllPlayers: true'
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
