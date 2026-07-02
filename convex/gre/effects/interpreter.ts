// Effect Script interpreter (ADR 0045, issues #800 / #802). Executes a card's
// `effects[]` — an ordered list of declarative Ops — by calling the existing
// SpellContext primitives, one Op at a time, top to bottom (CR 608.2c —
// follow the spell's instructions in the order written).
//
// One execution path: the compiled script is returned as a plain resolve
// closure through the same `getResolveFn` seam that serves imperative
// `resolve()` bodies and `effect` shorthands, so the stack-resolution engine
// (`gre/state.ts`) never knows which authoring mode a card used.
//
// This slice (#802) adds the STRUCTURAL CONSTRUCTS bind / ref / count on top
// of the flat-sequence core:
//   - an Op may carry `bind: "$x"` — the interpreter snapshots the object it
//     acts on (power / toughness / controller) at execution time, BEFORE any
//     zone change the Op performs (CR 608.2h / 603.10 last-known information);
//   - a numeric parameter may be a `{ ref: "$x.power" }` reading a snapshot,
//     or a `{ count: { zone, filter, controller } }` counting a selected set
//     ("draw a card for each …", CR 122);
//   - a player parameter may be `{ ref: "$x.controller" }` ("its controller").
// No expressions — the value grammar is exactly literal | ref | count
// (ADR 0045 frozen grammar). The `if` / `forEach` constructs land in later
// slices. The Op vocabulary is governed by `EFFECT_OP_REGISTRY` in
// `convex/cards/mechanicsRegistry.ts`; the interpreter-coverage guard test
// keeps `OP_EXECUTORS` and that census in exact 1:1 correspondence.

import type {
    EffectCountSpec,
    EffectOp,
    EffectPlayerRef,
    EffectTargetRef,
    EffectValue,
    PermanentFilter,
    SpellContext,
    TargetSelection,
} from "../../cards/types";

type OpOf<K extends EffectOp["op"]> = Extract<EffectOp, { op: K }>;

/** A snapshot of a bound object's characteristics, captured when the binding
 *  Op ran (CR 608.2h last-known information). Refs read from here, so the
 *  values survive the object changing zone. */
interface BoundSnapshot {
    power: number;
    toughness: number;
    controller: string;
}

/** Runtime environment threaded through one script execution: the live
 *  `bind` → snapshot map. Fresh per resolution — bindings never leak across
 *  spells. */
interface Env {
    bindings: Map<string, BoundSnapshot>;
}

/** Splits a `"$binding.property"` ref string into its parts, or `null` when
 *  malformed (the static validator rejects malformed refs long before this,
 *  so `null` here is a defensive skip). */
function parseRef(ref: string): { binding: string; property: string } | null {
    const dot = ref.indexOf(".");
    if (!ref.startsWith("$") || dot < 0) return null;
    return { binding: ref.slice(0, dot), property: ref.slice(dot + 1) };
}

/** Resolves a numeric Op parameter (ADR 0045 value grammar): a literal, a
 *  `ref` reading a bound snapshot's power/toughness, or a `count` of a
 *  selected set. Returns `undefined` when a ref names a binding that was never
 *  captured (its Op was skipped — CR 608.2b), so the caller skips too. */
function resolveValue(
    ctx: SpellContext,
    env: Env,
    value: EffectValue
): number | undefined {
    if (typeof value === "number") return value;
    if ("ref" in value) {
        const parsed = parseRef(value.ref);
        if (!parsed) return undefined;
        const snap = env.bindings.get(parsed.binding);
        if (!snap) return undefined;
        if (parsed.property === "power") return snap.power;
        if (parsed.property === "toughness") return snap.toughness;
        return undefined;
    }
    return countSet(ctx, env, value.count);
}

/** Counts a declaratively-selected set of cards (ADR 0045 `count` construct,
 *  CR 122 counting). Returns 0 when the controlling player cannot be resolved. */
function countSet(ctx: SpellContext, env: Env, spec: EffectCountSpec): number {
    const playerId = resolvePlayerRef(ctx, env, spec.controller);
    if (playerId === undefined) return 0;
    if (spec.zone === "battlefield") {
        const filter: PermanentFilter | undefined = spec.filter
            ? { types: spec.filter.type, subtypes: spec.filter.subtype }
            : undefined;
        return ctx.getBattlefieldIds(playerId, filter).length;
    }
    // graveyard (CR 404) — filter by card type and/or subtype (CR 205),
    // mirroring the battlefield branch. Both fields are ANDed; an absent
    // field imposes no constraint. Honouring `subtype` here (rather than
    // rejecting it in the validator) is deliberate: subtype-scoped
    // graveyard counts are legitimate ("for each Zombie in your graveyard").
    const cards = ctx.getGraveyardCards(playerId);
    const type = spec.filter?.type;
    const subtype = spec.filter?.subtype;
    return cards.filter(
        (c) =>
            (type === undefined || c.types.includes(type)) &&
            (subtype === undefined || c.subtypes.includes(subtype))
    ).length;
}

/** Resolves a player selector to a concrete player id, or undefined when the
 *  selector cannot be satisfied (a `{ target: n }` slot that is missing or
 *  was not chosen as a player, or a `{ ref }` whose binding was never
 *  captured — CR 608.2b, the Op is then skipped). */
function resolvePlayerRef(
    ctx: SpellContext,
    env: Env,
    ref: EffectPlayerRef
): string | undefined {
    if (ref === "controller") return ctx.controller;
    if (ref === "opponent") {
        // CR 102.2 — two-player games: the one player who isn't the
        // controller. Solo games model two seats, so this holds there too.
        return ctx.allPlayerIds.find((id) => id !== ctx.controller);
    }
    if ("ref" in ref) {
        const parsed = parseRef(ref.ref);
        if (!parsed) return undefined;
        const snap = env.bindings.get(parsed.binding);
        if (!snap) return undefined;
        return parsed.property === "controller" ? snap.controller : undefined;
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

/** Captures a snapshot of `target`'s current characteristics into `env` under
 *  `name`. Called by object-moving Ops BEFORE the zone change, so a later ref
 *  reads last-known information (CR 608.2h). */
function bindSnapshot(
    ctx: SpellContext,
    env: Env,
    name: string,
    target: TargetSelection
): void {
    env.bindings.set(name, {
        power: ctx.getPower(target),
        toughness: ctx.getToughness(target),
        controller: ctx.getController(target),
    });
}

/** One executor per Op, keyed by Op name. Each executor is a thin adapter
 *  from the declarative Op shape onto exactly one SpellContext primitive —
 *  no game logic lives here (ADR 0045 "one execution path"). Kept in exact
 *  1:1 correspondence with `EFFECT_OP_REGISTRY` by a guard test. */
export const OP_EXECUTORS: {
    [K in EffectOp["op"]]: (ctx: SpellContext, op: OpOf<K>, env: Env) => void;
} = {
    // CR 120 — damage to an announced target or to a relative player.
    dealDamage(ctx, op, env) {
        const amount = resolveValue(ctx, env, op.amount);
        if (amount === undefined || amount <= 0) return; // 0 damage is a no-op
        if ("player" in op.to) {
            const playerId = resolvePlayerRef(ctx, env, op.to.player);
            if (playerId === undefined) return;
            ctx.dealDamage({ type: "player", id: playerId }, amount);
            return;
        }
        const target = resolveTargetRef(ctx, op.to);
        if (target) ctx.dealDamage(target, amount);
    },
    // CR 121.1 — draw from the top of the library.
    draw(ctx, op, env) {
        const playerId = resolvePlayerRef(ctx, env, op.player);
        if (playerId === undefined) return;
        const count = resolveValue(ctx, env, op.count);
        if (count === undefined || count <= 0) return;
        ctx.drawCards(playerId, count);
    },
    // CR 119.3a — life gain.
    gainLife(ctx, op, env) {
        const playerId = resolvePlayerRef(ctx, env, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, env, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.gainLife(playerId, amount);
    },
    // CR 119.3b — life loss (not damage).
    loseLife(ctx, op, env) {
        const playerId = resolvePlayerRef(ctx, env, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, env, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.loseLife(playerId, amount);
    },
    // CR 701.8 — destroy, through the replacement layer (regeneration /
    // indestructible / destroy replacements, ADR 0020).
    destroy(ctx, op, env) {
        const target = resolveTargetRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, env, op.bind, target);
        ctx.destroy(target);
    },
    // CR 701.13 — exile to the target's owner's exile zone (CR 406). The
    // snapshot is taken before the move, so "its controller / its power"
    // refs read last-known information (CR 608.2h; Swords to Plowshares).
    exile(ctx, op, env) {
        const target = resolveTargetRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, env, op.bind, target);
        ctx.exile(target);
    },
};

/** Executes a flat Op sequence in order (CR 608.2c). Ops whose selector or
 *  ref cannot be satisfied are skipped individually — the rest of the script
 *  still runs (CR 608.2b, "the spell does as much as it can"). */
export function runEffectScript(
    ctx: SpellContext,
    effects: readonly EffectOp[]
): void {
    const env: Env = { bindings: new Map() };
    for (const op of effects) {
        (OP_EXECUTORS[op.op] as (c: SpellContext, o: EffectOp, e: Env) => void)(
            ctx,
            op,
            env
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
