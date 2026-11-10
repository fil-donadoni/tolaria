/**
 * CR 101.4 — the per-player "unless they pay" body of a
 * `forEach { select: { set: "players" }, simultaneous: true }` construct:
 * every player's payment DECISION first (APNAP order), then every
 * consequence together. Shared by the validator (which admits the shape) and
 * the interpreter (which splits the body into its two phases), so the two
 * can never disagree on which Op belongs to which pass.
 *
 * The admitted body is a tree of `if` nodes over two kinds of leaf:
 *
 *   - decision: a `mayPay` offered to the iterated player
 *     (`player: { ref: "$each" }`);
 *   - action: a `dealDamage` to the iterated player
 *     (`to: { player: { ref: "$each" } }`).
 *
 * "Deals 1 damage to that player unless they pay {B} or {3}" (Lim-Dûl's Hex)
 * reads `[mayPay {B} → $b, if !$b [mayPay {3} → $c, if !$c [dealDamage]]]`.
 * The interpreter runs the body twice per player: the DECIDE phase keeps only
 * the may-pays, the ACT phase only the damage. Every `if` survives into both
 * phases, so it is evaluated twice — which is why its predicate may only read
 * a binding (a may-pay outcome, frozen once answered): a predicate reading the
 * board could flip between the passes once an earlier player's damage landed.
 * In pre-order every decision precedes every action, so the re-sequencing
 * never moves an action ahead of a decision the original order put before it.
 *
 * Narrow and fail-closed for the same two reasons as the
 * `[choice, sacrifice | discard]` pair: (1) the action phase must not suspend,
 * or a prompt would land back among the already-applied actions —
 * `dealDamage` never suspends; (2) back-to-back application equals CR 101.4's
 * "simultaneously" only when no player's action can invalidate another's —
 * each player is dealt damage only on their own account. A body reaching any
 * other Op is rejected, never quietly walked sequentially.
 */
import type { EffectOp } from "../../cards/types";

type Leaf = "decide" | "act";

function refsEach(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>).ref === "$each"
    );
}

function leafKind(op: Record<string, unknown>): Leaf | undefined {
    if (op.op === "mayPay" && refsEach(op.player)) return "decide";
    if (op.op === "dealDamage") {
        const to = op.to as Record<string, unknown> | undefined;
        if (to && refsEach(to.player)) return "act";
    }
    return undefined;
}

/** A predicate that reads only a binding — `{ binding }` or
 *  `{ not: { binding } }` — and so evaluates identically in both phases. */
function isBindingPredicate(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const p = value as Record<string, unknown>;
    const keys = Object.keys(p);
    if (keys.length !== 1) return false;
    if (keys[0] === "binding") return typeof p.binding === "string";
    if (keys[0] === "not") return isBindingPredicate(p.not);
    return false;
}

/** Pre-order leaf kinds of an admissible list, or `undefined` when any node
 *  falls outside the shape. */
function leafSequence(ops: unknown): Leaf[] | undefined {
    if (!Array.isArray(ops)) return undefined;
    const out: Leaf[] = [];
    for (const value of ops) {
        if (typeof value !== "object" || value === null) return undefined;
        const op = value as Record<string, unknown>;
        if (op.op === "if") {
            if (!isBindingPredicate(op.predicate)) return undefined;
            if (!Array.isArray(op.then) || op.then.length === 0) {
                return undefined;
            }
            const then = leafSequence(op.then);
            const otherwise =
                op.else === undefined ? [] : leafSequence(op.else);
            if (!then || !otherwise) return undefined;
            out.push(...then, ...otherwise);
            continue;
        }
        const kind = leafKind(op);
        if (!kind) return undefined;
        out.push(kind);
    }
    return out;
}

/** The per-player may-pay-or-damage body (see the module doc). */
export function isSimultaneousPlayerMayPayBody(effects: unknown): boolean {
    const leaves = leafSequence(effects);
    if (!leaves) return false;
    const firstAct = leaves.indexOf("act");
    return (
        firstAct > 0 && leaves.slice(firstAct).every((kind) => kind === "act")
    );
}

/** One phase of an admitted may-pay body: the same tree with every leaf of
 *  the OTHER phase removed (an `if` left with nothing to run is dropped).
 *  Deterministic, so a re-walk derives identical lists and the pre-order
 *  cursor positions stay aligned across a suspend/resume. */
export function mayPayBodyPhase(
    effects: readonly EffectOp[],
    phase: Leaf
): EffectOp[] {
    const out: EffectOp[] = [];
    for (const op of effects) {
        if (op.op === "if") {
            const then = mayPayBodyPhase(op.then, phase);
            const otherwise = op.else
                ? mayPayBodyPhase(op.else, phase)
                : undefined;
            if (then.length === 0 && (otherwise?.length ?? 0) === 0) continue;
            out.push({
                ...op,
                then,
                ...(otherwise ? { else: otherwise } : {}),
            });
            continue;
        }
        if (leafKind(op as unknown as Record<string, unknown>) === phase) {
            out.push(op);
        }
    }
    return out;
}
