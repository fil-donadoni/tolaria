// Effect Script interpreter (ADR 0045, issues #800 / #802 / #805). Executes a
// card's `effects[]` — an ordered list of declarative Ops — by calling the
// existing SpellContext primitives, one Op at a time, top to bottom (CR 608.2c
// — follow the spell's instructions in the order written).
//
// One execution path: the compiled script is returned as a plain resolve
// closure through the same `getResolveFn` seam that serves imperative
// `resolve()` bodies and `effect` shorthands, so the stack-resolution engine
// (`gre/state.ts`) never knows which authoring mode a card used.
//
// SUSPENSION / RESUME (issue #805). A `choice` Op requests a mid-resolution
// player decision through `SpellContext.requestChoice` — the SAME Pending
// Choice pipeline imperative cards use (CR 608.2 / 101.4): the engine
// enqueues a PendingChoice, the generic prompt UI renders it, and the generic
// `submitResolutionChoice` mutation commits the picks. The interpreter
// checkpoints the CURRENT Op index in the stack item's `resolutionStep`
// (via the `setScriptCheckpoint` plumbing) BEFORE executing each Op, exactly
// as the engine does for `resolveSteps`, so:
//   - on suspension the item stays on the stack with the checkpoint set;
//   - on resume execution restarts AT the suspended Op (earlier Ops — which
//     may be irreversible — never re-run, CR 608.3);
//   - `requestChoice` keys its `collectedChoices` entry under the Op index,
//     so the re-executed choice Op reads the submitted picks back instead of
//     re-prompting.
//
// BINDINGS (ADR 0045 `bind` construct) survive suspension because they are
// stored IN `collectedChoices` — the stack item's already-persisted,
// already-wire-safe answer store (serialized by `serialize.ts`, cleared by
// the engine on completion). Two binding families:
//   - SNAPSHOT bindings (destroy/exile `bind`, the implicit `$source`): the
//     bound object's power/toughness/controller captured BEFORE any zone
//     change (CR 608.2h / 603.10 last-known information), written through
//     `noteChoice` as the string triple [power, toughness, controller];
//   - PICKS bindings (a `choice` Op's `bind`): the chooser's submitted
//     instance ids — these ARE the `requestChoice` entry (the Op uses its
//     binding name as the choiceId), so no extra write is needed.
// Refs read through `recallChoice`, which scans every step's entries — the
// static validator guarantees a ref's position (numeric / player / picks)
// agrees with its binding's family, so the stored array's interpretation is
// unambiguous. No new GameState or StackItem field is introduced: the
// serialization drift guard needs nothing.
//
// The value grammar is exactly literal | ref | count (ADR 0045 frozen
// grammar). The `if` / `forEach` constructs land in later slices. The Op
// vocabulary is governed by `EFFECT_OP_REGISTRY` in
// `convex/cards/mechanicsRegistry.ts`; the interpreter-coverage guard test
// keeps `OP_EXECUTORS` and that census in exact 1:1 correspondence.

import type {
    EffectCardFilter,
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

/** An executor's outcome: `undefined` = the Op ran (or was skipped per
 *  CR 608.2b) and the script continues; `"suspend"` = the Op enqueued a
 *  Pending Choice and the script must stop HERE — the engine leaves the item
 *  on the stack and the checkpointed Op re-runs on resume. */
type OpOutcome = void | "suspend";

/** Snapshot-triple layout inside `collectedChoices` (see module doc):
 *  [0] power, [1] toughness, [2] controller — all strings (the store is the
 *  same `string[]` shape every collected answer uses). */
const SNAP_POWER = 0;
const SNAP_TOUGHNESS = 1;
const SNAP_CONTROLLER = 2;

/** Splits a `"$binding.property"` ref string into its parts, or `null` when
 *  the ref carries no property (`"$binding"` — the bare shape a PICKS ref
 *  uses) or is malformed. The static validator rejects position/shape
 *  mismatches long before this, so `null` here is a defensive skip. */
function parseRef(ref: string): { binding: string; property: string } | null {
    const dot = ref.indexOf(".");
    if (!ref.startsWith("$") || dot < 0) return null;
    return { binding: ref.slice(0, dot), property: ref.slice(dot + 1) };
}

/** Reads a binding's stored value array from the stack item's persisted
 *  answer store, or undefined when the binding was never captured (its Op was
 *  skipped or its choice found no candidates — CR 608.2b, the reader skips
 *  too). Snapshot bindings were written by `bindSnapshot`; picks bindings are
 *  the `requestChoice` entry keyed by the binding name. */
function readBinding(ctx: SpellContext, name: string): string[] | undefined {
    return ctx.recallChoice(name);
}

/** Resolves a numeric Op parameter (ADR 0045 value grammar): a literal, a
 *  `ref` reading a bound snapshot's power/toughness, or a `count` of a
 *  selected set. Returns `undefined` when a ref names a binding that was never
 *  captured (its Op was skipped — CR 608.2b), so the caller skips too. */
function resolveValue(
    ctx: SpellContext,
    value: EffectValue
): number | undefined {
    if (typeof value === "number") return value;
    if ("ref" in value) {
        const parsed = parseRef(value.ref);
        if (!parsed) return undefined;
        const snap = readBinding(ctx, parsed.binding);
        if (!snap) return undefined;
        if (parsed.property === "power") return Number(snap[SNAP_POWER]);
        if (parsed.property === "toughness") {
            return Number(snap[SNAP_TOUGHNESS]);
        }
        return undefined;
    }
    return countSet(ctx, value.count);
}

/** Maps the JSON-pure `EffectCardFilter` onto the engine's `PermanentFilter`
 *  shape (shared by the `count` construct and the `choice` Op's battlefield
 *  candidates). */
function toPermanentFilter(
    filter: EffectCardFilter | undefined
): PermanentFilter | undefined {
    if (!filter) return undefined;
    return { types: filter.type, subtypes: filter.subtype };
}

/** Counts a declaratively-selected set of cards (ADR 0045 `count` construct,
 *  CR 122 counting). Returns 0 when the controlling player cannot be resolved. */
function countSet(ctx: SpellContext, spec: EffectCountSpec): number {
    const playerId = resolvePlayerRef(ctx, spec.controller);
    if (playerId === undefined) return 0;
    if (spec.zone === "battlefield") {
        return ctx.getBattlefieldIds(playerId, toPermanentFilter(spec.filter))
            .length;
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
        const snap = readBinding(ctx, parsed.binding);
        if (!snap) return undefined;
        return parsed.property === "controller"
            ? snap[SNAP_CONTROLLER]
            : undefined;
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

/** Resolves a bare picks ref (`{ ref: "$picked" }`) to the instance ids a
 *  `choice` Op recorded, or undefined when the binding was never captured
 *  (the choice found no candidates / its player selector failed — CR 608.2b,
 *  the consuming Op skips). */
function resolvePicks(
    ctx: SpellContext,
    ref: { ref: string }
): string[] | undefined {
    // A picks ref is the bare binding name — no property (the validator
    // enforces the shape).
    if (!ref.ref.startsWith("$") || ref.ref.includes(".")) return undefined;
    return readBinding(ctx, ref.ref);
}

/** Captures a snapshot of `target`'s current characteristics under `name`,
 *  persisted in the stack item's `collectedChoices` (via `noteChoice`) so it
 *  survives a later suspension and a DB round-trip. Called by object-moving
 *  Ops BEFORE the zone change, so a later ref reads last-known information
 *  (CR 608.2h). */
function bindSnapshot(
    ctx: SpellContext,
    name: string,
    target: TargetSelection
): void {
    ctx.noteChoice(name, [
        String(ctx.getPower(target)),
        String(ctx.getToughness(target)),
        ctx.getController(target),
    ]);
}

/** Computes how many candidates a `choice` Op actually has, plus the
 *  graveyard allow-list when applicable. The pick count is clamped to this
 *  (CR 608.2b — the chooser cannot be asked for more than exists; "discard
 *  two cards" with one card in hand discards one, CR 701.9b). */
function choiceCandidates(
    ctx: SpellContext,
    op: OpOf<"choice">,
    playerId: string
): { available: number; candidateIds?: string[] } {
    if (op.zone === "battlefield") {
        return {
            available: ctx.getBattlefieldIds(
                playerId,
                toPermanentFilter(op.filter)
            ).length,
        };
    }
    if (op.zone === "hand") {
        return { available: ctx.getHandSize(playerId) };
    }
    if (op.zone === "library") {
        return { available: ctx.getLibraryCards(playerId).length };
    }
    // graveyard — a public zone: eligibility is the snapshot taken when the
    // choice is raised, carried as an explicit allow-list (the submit
    // validator gates graveyard picks on `candidateIds`).
    const ids = ctx.getGraveyardCards(playerId).map((c) => c.id);
    return { available: ids.length, candidateIds: ids };
}

/** One executor per Op, keyed by Op name. Each executor is a thin adapter
 *  from the declarative Op shape onto exactly one SpellContext primitive —
 *  no game logic lives here (ADR 0045 "one execution path"). Kept in exact
 *  1:1 correspondence with `EFFECT_OP_REGISTRY` by a guard test. */
export const OP_EXECUTORS: {
    [K in EffectOp["op"]]: (ctx: SpellContext, op: OpOf<K>) => OpOutcome;
} = {
    // CR 120 — damage to an announced target or to a relative player.
    dealDamage(ctx, op) {
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return; // 0 damage is a no-op
        if ("player" in op.to) {
            const playerId = resolvePlayerRef(ctx, op.to.player);
            if (playerId === undefined) return;
            ctx.dealDamage({ type: "player", id: playerId }, amount);
            return;
        }
        const target = resolveTargetRef(ctx, op.to);
        if (target) ctx.dealDamage(target, amount);
    },
    // CR 121.1 — draw from the top of the library.
    draw(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const count = resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        ctx.drawCards(playerId, count);
    },
    // CR 119.3a — life gain.
    gainLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.gainLife(playerId, amount);
    },
    // CR 119.3b — life loss (not damage).
    loseLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.loseLife(playerId, amount);
    },
    // CR 701.8 — destroy, through the replacement layer (regeneration /
    // indestructible / destroy replacements, ADR 0020).
    destroy(ctx, op) {
        const target = resolveTargetRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, op.bind, target);
        ctx.destroy(target);
    },
    // CR 701.13 — exile to the target's owner's exile zone (CR 406). The
    // snapshot is taken before the move, so "its controller / its power"
    // refs read last-known information (CR 608.2h; Swords to Plowshares).
    exile(ctx, op) {
        const target = resolveTargetRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, op.bind, target);
        ctx.exile(target);
    },
    // CR 608.2 / 101.4 (issue #805) — mid-resolution player choice through
    // the existing Pending Choice pipeline. First execution enqueues the
    // choice and SUSPENDS the script; the resumed execution (after the
    // generic `submitResolutionChoice` commit) reads the picks back — they
    // are stored under this Op's binding name, which IS the picks binding.
    choice(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — chooser gone, skip
        const { available, candidateIds } = choiceCandidates(ctx, op, playerId);
        // CR 608.2b / 701.9b — clamp to what exists; nothing to choose from
        // means no choice at all (and no binding, so consumers skip too).
        const count = Math.min(op.count, available);
        if (count <= 0) return;
        const picks = ctx.requestChoice({
            playerId,
            // The binding name doubles as the choiceId: unique within the
            // script (validator-enforced) and stable across replays, so the
            // stored entry is exactly the picks binding.
            choiceId: op.bind,
            kind: op.kind,
            zone: op.zone,
            filter: toPermanentFilter(op.filter),
            count,
            prompt: op.prompt,
            ...(candidateIds ? { candidateIds } : {}),
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
    },
    // CR 701.9 — discard the cards a `choice` Op picked. Routes through
    // `discardCard` so the Library of Leng replacement and CARD_DISCARDED
    // triggers (Necropotence-style) apply exactly as for imperative cards.
    discard(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const ids = resolvePicks(ctx, op.cards);
        if (!ids) return; // binding never captured — CR 608.2b, skip
        for (const id of ids) ctx.discardCard(playerId, id);
    },
};

/** The implicit binding name every ability-site script gets for free: a
 *  snapshot of the source permanent (ADR 0045, issue #803). Lets an ability
 *  Op read "its power / its toughness / its controller" — e.g. "deals damage
 *  equal to its power" — as `{ ref: "$source.power" }` without an explicit
 *  `bind`. The static validator pre-declares it for ability sites. */
export const SOURCE_BINDING = "$source";

/** Executes a flat Op sequence in order (CR 608.2c), checkpointing the
 *  current Op index in the stack item (issue #805) so a `choice` Op's
 *  suspension resumes at the SAME Op — completed (possibly irreversible) Ops
 *  never re-run (CR 608.3), mirroring the engine's `resolveSteps` protocol.
 *  Ops whose selector or ref cannot be satisfied are skipped individually —
 *  the rest of the script still runs (CR 608.2b, "the spell does as much as
 *  it can").
 *
 *  Same code path for spell and ability sites (ADR 0045 "one execution path").
 *  The only site-dependent seam is the implicit `$source` binding: when the
 *  resolving item's source is a permanent on the battlefield — always true for
 *  activated and triggered abilities (`ctx.sourceInstanceId` is the source
 *  permanent, CR 602.2 / 603.10), never for a spell (its source is the stack
 *  item itself) — its characteristics are snapshotted BEFORE any Op runs so a
 *  `{ ref: "$source.power" }` reads last-known information (CR 608.2h). A spell
 *  simply has no `$source`, and `getOwnerId` returning undefined skips the bind
 *  with no behaviour change. The snapshot is taken only on a FRESH entry
 *  (checkpoint unset): on a resume the persisted snapshot is authoritative —
 *  re-reading the live permanent could observe a post-suspension state, or a
 *  source that has since left the battlefield (CR 603.10 LKI). */
export function runEffectScript(
    ctx: SpellContext,
    effects: readonly EffectOp[]
): void {
    const checkpoint = ctx.getScriptCheckpoint();
    if (
        checkpoint === undefined &&
        ctx.getOwnerId(ctx.sourceInstanceId) !== undefined
    ) {
        bindSnapshot(ctx, SOURCE_BINDING, {
            type: "permanent",
            id: ctx.sourceInstanceId,
        });
    }
    for (let i = checkpoint ?? 0; i < effects.length; i++) {
        // Commit the Op index BEFORE running the Op (mirrors the engine's
        // stepped-resolve protocol): `requestChoice` inside keys its
        // `collectedChoices` entry under this index, and a suspension
        // resumes exactly here.
        ctx.setScriptCheckpoint(i);
        const op = effects[i];
        const outcome = (
            OP_EXECUTORS[op.op] as (c: SpellContext, o: EffectOp) => OpOutcome
        )(ctx, op);
        if (outcome === "suspend") return; // engine sees pendingChoices > 0
    }
    // Completed — clear the checkpoint so the item carries no stale
    // `resolutionStep` into its next zone (the engine clears
    // `collectedChoices` itself when the item leaves the stack).
    ctx.clearScriptCheckpoint();
}

/** Compiles an Effect Script into a plain resolve closure so it flows
 *  through the exact same dispatch seam (`getResolveFn`) as imperative
 *  cards — the engine never grows a second resolution path. */
export function compileEffectScript(
    effects: readonly EffectOp[]
): (ctx: SpellContext) => void {
    return (ctx) => runEffectScript(ctx, effects);
}
