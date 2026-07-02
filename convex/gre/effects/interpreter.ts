// Effect Script interpreter (ADR 0045, issue #800). Executes a card's
// `effects[]` — an ordered, flat list of declarative Ops — by calling the
// existing SpellContext primitives, one Op at a time, top to bottom
// (CR 608.2c — follow the spell's instructions in the order written).
//
// One execution path: the compiled script is returned as a plain resolve
// closure through the same `getResolveFn` seam that serves imperative
// `resolve()` bodies and `effect` shorthands, so the stack-resolution engine
// (`gre/state.ts`) never knows which authoring mode a card used.
//
// This slice is the FLAT-SEQUENCE CORE. The four frozen structural
// constructs (bind/ref/if/forEach, ADR 0045) are intentionally absent —
// they land in follow-up slices (#802/#805/#806/#807). The Op vocabulary is
// governed by `EFFECT_OP_REGISTRY` in `convex/cards/mechanicsRegistry.ts`;
// the interpreter-coverage guard test keeps `OP_EXECUTORS` and that census
// in exact 1:1 correspondence.

import type {
    EffectOp,
    EffectPlayerRef,
    EffectTargetRef,
    SpellContext,
    TargetSelection,
} from "../../cards/types";

type OpOf<K extends EffectOp["op"]> = Extract<EffectOp, { op: K }>;

/** Resolves a player selector to a concrete player id, or undefined when the
 *  selector cannot be satisfied (a `{ target: n }` slot that is missing or
 *  was not chosen as a player — CR 608.2b, the Op is then skipped). */
function resolvePlayerRef(
    ctx: SpellContext,
    ref: EffectPlayerRef
): string | undefined {
    if (ref === "controller") return ctx.controller;
    if (ref === "opponent") {
        // CR 102.2 — two-player games: the one player who isn't the
        // controller. Solo games model two seats, so this holds there too.
        return ctx.allPlayerIds.find((id) => id !== ctx.controller);
    }
    const target = ctx.targets[ref.target];
    return target && target.type === "player" ? target.id : undefined;
}

/** Resolves an object selector to the announced TargetSelection, or
 *  undefined when the slot is missing (illegal / removed at resolution —
 *  CR 608.2b, the Op is then skipped). */
function resolveTargetRef(
    ctx: SpellContext,
    ref: EffectTargetRef
): TargetSelection | undefined {
    return ctx.targets[ref.target];
}

/** One executor per Op, keyed by Op name. Each executor is a thin adapter
 *  from the declarative Op shape onto exactly one SpellContext primitive —
 *  no game logic lives here (ADR 0045 "one execution path"). Kept in exact
 *  1:1 correspondence with `EFFECT_OP_REGISTRY` by a guard test. */
export const OP_EXECUTORS: {
    [K in EffectOp["op"]]: (ctx: SpellContext, op: OpOf<K>) => void;
} = {
    // CR 120 — damage to an announced target or to a relative player.
    dealDamage(ctx, op) {
        if ("player" in op.to) {
            const playerId = resolvePlayerRef(ctx, op.to.player);
            if (playerId === undefined) return;
            ctx.dealDamage({ type: "player", id: playerId }, op.amount);
            return;
        }
        const target = resolveTargetRef(ctx, op.to);
        if (target) ctx.dealDamage(target, op.amount);
    },
    // CR 121.1 — draw from the top of the library.
    draw(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId !== undefined) ctx.drawCards(playerId, op.count);
    },
    // CR 119.3a — life gain.
    gainLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId !== undefined) ctx.gainLife(playerId, op.amount);
    },
    // CR 119.3b — life loss (not damage).
    loseLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId !== undefined) ctx.loseLife(playerId, op.amount);
    },
    // CR 701.8 — destroy, through the replacement layer (regeneration /
    // indestructible / destroy replacements, ADR 0020).
    destroy(ctx, op) {
        const target = resolveTargetRef(ctx, op.target);
        if (target) ctx.destroy(target);
    },
};

/** Executes a flat Op sequence in order (CR 608.2c). Ops whose selector
 *  cannot be satisfied are skipped individually — the rest of the script
 *  still runs (CR 608.2b, "the spell does as much as it can"). */
export function runEffectScript(
    ctx: SpellContext,
    effects: readonly EffectOp[]
): void {
    for (const op of effects) {
        (OP_EXECUTORS[op.op] as (c: SpellContext, o: EffectOp) => void)(
            ctx,
            op
        );
    }
}

/** Compiles an Effect Script into a plain resolve closure so it flows
 *  through the exact same dispatch seam (`getResolveFn`) as imperative
 *  cards — the engine never grows a second resolution path. */
export function compileEffectScript(
    effects: readonly EffectOp[]
): (ctx: SpellContext) => void {
    return (ctx) => runEffectScript(ctx, effects);
}
