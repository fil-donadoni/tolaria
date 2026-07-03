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
// grammar). The `if` structural construct (issue #806) is a registered Op
// (`{ op: "if", predicate, then, else? }`) whose executor runs the matching
// branch through `runOpList`. Because a branch may itself contain a
// suspending Op AFTER a side-effecting one, the checkpoint is a PRE-ORDER
// LINEAR POSITION over the whole nested Op tree (a shared cursor threaded
// through `runOpList`), NOT the top-level index: the position of the Op that
// suspended is stored, and on resume the tree is re-walked with every Op whose
// position is BEFORE the checkpoint skipped (its side effect already ran, CR
// 608.3), so only the suspending Op — and the Ops after it — execute. An `if`
// on the skip side still re-evaluates its predicate (a stored, deterministic
// binding) and descends the same branch, keeping positions aligned; a
// completed Op nested inside that branch is skipped by the same position rule.
// `forEach` (issue #807, the fourth and final construct — the grammar is now
// closed) reuses the SAME cursor: each iteration re-walks the body through
// `runOpList`, so body Ops get fresh positions per iteration and a body
// `choice` Op resumes at its exact (iteration, Op). forEach adds two things the
// cursor does not give for free — a FROZEN member set (CR 608.2i, persisted so
// a resume re-iterates the identical set) and PER-ITERATION binding scoping (so
// the same `choice` re-prompts each iteration); see the forEach machinery
// below. The Op vocabulary is governed by `EFFECT_OP_REGISTRY` in
// `convex/cards/mechanicsRegistry.ts`; the interpreter-coverage guard test
// keeps `OP_EXECUTORS` and that census in exact 1:1 correspondence.

import type {
    EffectCardFilter,
    EffectComparisonOp,
    EffectCountSpec,
    EffectForEachSelector,
    EffectObjectSelector,
    EffectOp,
    EffectPlayerRef,
    EffectPredicate,
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

/** The resume cursor threaded through `runOpList` (issue #806). `pos` is a
 *  monotonic pre-order counter assigned to every Op in the whole nested tree;
 *  `resume` is the checkpointed position of the Op that suspended (or -1 on a
 *  fresh run). An Op whose position is `< resume` already completed on an
 *  earlier run and is SKIPPED (CR 608.3 — its side effect never replays);
 *  structural Ops (`if`) still descend so positions stay aligned across the
 *  re-walk. The suspending Op sits at exactly `resume`, so it re-runs and reads
 *  its stored answer back. */
type Cursor = { pos: number; readonly resume: number };

/** Snapshot layout inside `collectedChoices` (see module doc):
 *  [0] power, [1] toughness, [2] controller, [3] instance id — all strings
 *  (the store is the same `string[]` shape every collected answer uses).
 *  The id slot (issue #807) lets a `forEach` body act ON the snapshotted
 *  object (`{ ref: "$each" }` in an object position); snapshots written
 *  before #807 lack it, and readers treat a missing id as "no object". */
const SNAP_POWER = 0;
const SNAP_TOUGHNESS = 1;
const SNAP_CONTROLLER = 2;
const SNAP_ID = 3;

/** A players-set `$each` binding (issue #807) is stored as the single-element
 *  `[playerId]` — distinguishable from a 4-slot object snapshot by the
 *  validator's family typing, never by sniffing the array. */
const PLAYER_BINDING_ID = 0;

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

/** Boolean payload stored by a `mayPay` Op (issue #806): the single-element
 *  `["yes"]` / `["no"]` array `requestMayPay` persists (mirroring the may-pay
 *  Pending Choice answer). Read by an `if` binding predicate. */
const MAYPAY_YES = "yes";

/** Reads a BOOLEAN binding (a `mayPay` outcome). Returns `undefined` when the
 *  binding was never captured (its Op was skipped — CR 608.2b), which the `if`
 *  predicate treats as "not true" (an unpaid may-pay). */
function readBoolBinding(ctx: SpellContext, name: string): boolean | undefined {
    const stored = readBinding(ctx, name);
    if (stored === undefined) return undefined;
    return stored[0] === MAYPAY_YES;
}

/** Applies a relational operator (CR 107 — number comparison). */
function compareNumbers(
    left: number,
    op: EffectComparisonOp,
    right: number
): boolean {
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

/** Evaluates a PREDEFINED `if` predicate (ADR 0045, issue #806) — never an
 *  arbitrary expression. A binding predicate reads a boolean binding (a
 *  `mayPay` outcome), optionally negated; a comparison predicate resolves each
 *  numeric side (literal / ref / count) and applies the operator. An
 *  uncaptured boolean binding (its Op was skipped — CR 608.2b) reads as
 *  `false`; an unresolvable numeric operand (a ref whose binding was skipped)
 *  makes the comparison `false` — the branch is not taken, the script does as
 *  much as it can. */
function evalPredicate(ctx: SpellContext, pred: EffectPredicate): boolean {
    if ("binding" in pred) {
        return readBoolBinding(ctx, pred.binding) === true;
    }
    if ("not" in pred) {
        // `not` over a boolean binding: an uncaptured (undefined) binding is
        // "not true" → the negation is TRUE (the may-pay went unpaid, so the
        // "unless pays" consequence fires — CR 117.3a).
        return readBoolBinding(ctx, pred.not.binding) !== true;
    }
    const left = resolveValue(ctx, pred.left);
    const right = resolveValue(ctx, pred.right);
    if (left === undefined || right === undefined) return false;
    return compareNumbers(left, pred.op, right);
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
        if (!parsed) {
            // Bare `{ ref: "$each" }` in a player position (issue #807): the
            // current member of a players-set forEach, stored as the
            // single-element [playerId]. The static validator guarantees a
            // bare player ref names a player-family binding; an unscoped /
            // uncaptured lookup skips the Op (CR 608.2b).
            if (!ref.ref.startsWith("$") || ref.ref.includes(".")) {
                return undefined;
            }
            const bound = readBinding(ctx, ref.ref);
            return bound && bound.length === 1
                ? bound[PLAYER_BINDING_ID]
                : undefined;
        }
        const snap = readBinding(ctx, parsed.binding);
        if (!snap) return undefined;
        return parsed.property === "controller"
            ? snap[SNAP_CONTROLLER]
            : undefined;
    }
    // `{ controllerOf: { target: n } }` (issue #806) — the controller of the
    // object in slot n (a spell's caster or a permanent's controller, CR
    // 109.5). Skipped when the slot is missing (CR 608.2b).
    if ("controllerOf" in ref) {
        const target = ctx.targets[ref.controllerOf.target];
        return target ? ctx.getController(target) : undefined;
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

/** Resolves an object selector to a TargetSelection: the announced target
 *  slot, or — inside a `forEach` over permanents (issue #807) — the bare
 *  `{ ref: "$each" }` naming the current member. Returns undefined when the
 *  slot is missing (illegal / removed at resolution), the binding was never
 *  captured, or the referenced permanent has since LEFT the battlefield —
 *  in every case the Op is skipped (CR 608.2b, the spell does as much as it
 *  can; a frozen-set member that left mid-iteration is not acted on). */
function resolveObjectRef(
    ctx: SpellContext,
    ref: EffectObjectSelector
): TargetSelection | undefined {
    if ("target" in ref) return ctx.targets[ref.target];
    if (!ref.ref.startsWith("$") || ref.ref.includes(".")) return undefined;
    const snap = readBinding(ctx, ref.ref);
    const id = snap?.[SNAP_ID];
    if (!id) return undefined;
    // CR 608.2b — the snapshotted object must still be on the battlefield;
    // `getOwnerId` is battlefield-scoped, so undefined means it left.
    if (ctx.getOwnerId(id) === undefined) return undefined;
    return { type: "permanent", id };
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
        // SNAP_ID (issue #807) — lets a forEach body act on the snapshotted
        // member via `{ ref: "$each" }`; readers re-check battlefield
        // presence before acting (CR 608.2b).
        target.id,
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
    [K in EffectOp["op"]]: (
        ctx: SpellContext,
        op: OpOf<K>,
        cursor: Cursor
    ) => OpOutcome;
} = {
    // CR 120 — damage to an announced target, the current forEach member, or
    // a relative player.
    dealDamage(ctx, op) {
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return; // 0 damage is a no-op
        if ("player" in op.to) {
            const playerId = resolvePlayerRef(ctx, op.to.player);
            if (playerId === undefined) return;
            ctx.dealDamage({ type: "player", id: playerId }, amount);
            return;
        }
        const target = resolveObjectRef(ctx, op.to);
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
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, op.bind, target);
        ctx.destroy(target);
    },
    // CR 701.13 — exile to the target's owner's exile zone (CR 406). The
    // snapshot is taken before the move, so "its controller / its power"
    // refs read last-known information (CR 608.2h; Swords to Plowshares).
    exile(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, op.bind, target);
        ctx.exile(target);
    },
    // CR 400.7 (issue #839) — a plain zone change. A thin declarative skin
    // over the SpellContext zone-movement primitives, ONE execution path
    // (ADR 0045): the current zone is inferred from the object's kind (a
    // permanent is on the battlefield; a graveyard-card is in the graveyard),
    // so the Op carries no `from`. Skipped when the referenced object is gone
    // (CR 608.2b — the spell does as much as it can), or for a zone pair with
    // no plain-move primitive (a battlefield permanent to any zone but the
    // hand needs LTB semantics — that is `destroy`/`exile`, not `moveZone`).
    moveZone(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (target.type === "permanent") {
            // Battlefield source (CR 110). Only the bounce-to-hand pair has a
            // plain-move primitive (CR 701.10); other destinations from the
            // battlefield need leaves-the-battlefield handling and are skipped.
            if (op.to === "hand") ctx.returnToHand(target);
            return;
        }
        if (target.type === "graveyard-card") {
            const owner = target.playerId;
            if (owner === undefined) return; // CR 608.2b — zone owner unknown
            if (op.to === "battlefield") {
                // Reanimation (CR 400.7 — graveyard → battlefield under the
                // owner's control; Resurrection, Hell's Caretaker).
                ctx.returnToBattlefield(owner, target.id, "graveyard");
                return;
            }
            // A plain graveyard → hand/library/exile/graveyard move by id
            // (Raise Dead, Grave Robbers). `battlefield` was handled above, so
            // the destination here is a MovableZone.
            ctx.moveCardById(owner, target.id, "graveyard", op.to);
        }
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
    // CR 117.3a / 118.4 (issue #806) — an optional "you may pay {cost}"
    // decision through the existing `may-pay` Pending Choice pipeline. First
    // execution enqueues the Pay/Skip choice and SUSPENDS; the resumed
    // execution (after the generic `submitMayPay` commit) reads the boolean
    // outcome back — `requestMayPay` stores it under this Op's binding name, so
    // the binding IS the may-pay answer. A later `if` predicate reads it.
    mayPay(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — payer gone, skip
        const paid = ctx.requestMayPay({
            playerId,
            // The binding name doubles as the choiceId (unique within the
            // script, validator-enforced), so the stored ["yes"|"no"] answer
            // IS the boolean binding read by `readBoolBinding`.
            choiceId: op.bind,
            cost: op.cost,
            prompt: op.prompt,
        });
        if (paid === undefined) return "suspend"; // enqueued — wait
    },
    // CR 701.5a — counter the announced target spell. A silent no-op when the
    // target already left the stack (CR 608.2b — the spell does as much as it
    // can). The consequence half of the counter/punisher pattern.
    counter(ctx, op) {
        const target = resolveTargetRef(ctx, op.target);
        if (target && target.type === "spell") ctx.counter(target);
    },
    // if — the `if` structural construct (ADR 0045, issue #806). Evaluates a
    // predefined predicate and runs the matching branch through `runOpList`,
    // passing the SHARED cursor so each branch Op gets its own pre-order
    // position and per-Op checkpoint. A suspending Op inside the branch
    // propagates "suspend" up; on resume the whole tree is re-walked, the
    // predicate re-evaluates identically (its binding is a stored answer), the
    // same branch is descended, and every Op BEFORE the suspending one is
    // skipped by its position — so a side-effecting Op that precedes the
    // suspending Op fires EXACTLY ONCE (CR 608.3 — completed steps never
    // replay). The `if` Op itself holds no position: it is a pure structural
    // dispatch, so it always re-evaluates on a re-walk.
    if(ctx, op, cursor) {
        const branch = evalPredicate(ctx, op.predicate) ? op.then : op.else;
        if (!branch) return; // predicate false, no else — nothing to do
        return runOpList(ctx, branch, cursor);
    },
    // CR 701.16 (issue #807) — sacrifice the permanents a `choice` Op picked.
    // Routes through `SpellContext.sacrifice`: the controller puts each pick
    // into its owner's graveyard; indestructible does not prevent sacrifice
    // (CR 701.16a) and dies-triggers fire as for imperative cards. A pick
    // already gone from the battlefield is a no-op inside the primitive.
    sacrifice(ctx, op) {
        const ids = resolvePicks(ctx, op.permanents);
        if (!ids) return; // binding never captured — CR 608.2b, skip
        for (const id of ids) ctx.sacrifice(id);
    },
    // forEach — the fourth structural construct (ADR 0045, issue #807).
    // Iterates the body over a frozen, declaratively-selected set through
    // `execForEach`, threading the SHARED cursor so each body Op — in each
    // iteration — gets its own pre-order position and per-Op checkpoint. A
    // suspending Op inside a body iteration propagates "suspend" up; on resume
    // the whole tree is re-walked, forEach re-selects nothing (the set is
    // persisted), re-iterates, and every Op before the checkpointed position
    // is skipped — so a side-effecting body Op fires EXACTLY ONCE per
    // iteration (CR 608.3). Like `if`, forEach holds no position of its own:
    // it always re-descends on a re-walk.
    forEach(ctx, op, cursor) {
        return execForEach(ctx, op, cursor);
    },
};

/** Runs an Op list top to bottom (CR 608.2c) against a shared pre-order
 *  `cursor`, stopping at the first Op that suspends (propagating "suspend" so
 *  the caller — a branch's `if`, or the top-level `runEffectScript` — halts
 *  too). Used for BOTH the top-level sequence and each `if` branch, so nesting
 *  is uniform and the checkpoint composes across it (issue #806).
 *
 *  Each Op is assigned its own pre-order position `myPos` (`cursor.pos++`).
 *  When `myPos < cursor.resume` the Op already completed on an earlier run and
 *  is SKIPPED (CR 608.3 — its possibly-irreversible side effect never replays);
 *  the ONE exception is a structural `if`, which must still run so its
 *  predicate re-evaluates and the same branch is descended, keeping the nested
 *  positions aligned (its own leaf Ops are then skipped individually by the
 *  same rule). Before executing an eligible Op the current position is
 *  checkpointed, so a suspension resumes at exactly this Op and its
 *  `requestChoice` / `noteChoice` entries key their `collectedChoices` under
 *  it. Ops whose selector / ref cannot be satisfied are skipped individually
 *  (CR 608.2b). */
function runOpList(
    ctx: SpellContext,
    ops: readonly EffectOp[],
    cursor: Cursor
): OpOutcome {
    for (const op of ops) {
        const myPos = cursor.pos++;
        // Already-completed leaf Ops never re-run. The structural constructs
        // `if` and `forEach` (issue #807) are the exceptions: they must still
        // run so they re-descend / re-iterate the same nested Ops, keeping the
        // pre-order positions aligned across the re-walk (their own leaf Ops
        // are then skipped individually by this same position check).
        if (myPos < cursor.resume && op.op !== "if" && op.op !== "forEach") {
            continue;
        }
        // Checkpoint BEFORE executing (mirrors the engine's stepped-resolve
        // protocol): a suspension inside the Op resumes at THIS position.
        ctx.setScriptCheckpoint(myPos);
        const outcome = (
            OP_EXECUTORS[op.op] as (
                c: SpellContext,
                o: EffectOp,
                cur: Cursor
            ) => OpOutcome
        )(ctx, op, cursor);
        if (outcome === "suspend") return "suspend";
    }
}

/** The implicit binding name every ability-site script gets for free: a
 *  snapshot of the source permanent (ADR 0045, issue #803). Lets an ability
 *  Op read "its power / its toughness / its controller" — e.g. "deals damage
 *  equal to its power" — as `{ ref: "$source.power" }` without an explicit
 *  `bind`. The static validator pre-declares it for ability sites. */
export const SOURCE_BINDING = "$source";

/** The per-iteration binding name a `forEach` body gets for free (ADR 0045,
 *  issue #807): the current member of the iterated set. */
export const EACH_BINDING = "$each";

// --- forEach construct machinery (ADR 0045, issue #807) ----------------------
//
// forEach composes onto main's pre-order cursor (issue #806) rather than
// introducing a parallel checkpoint: each iteration re-walks the body through
// `runOpList` with the SHARED cursor, so body Ops get fresh positions per
// iteration and a `choice` Op suspension resumes at the exact (iteration, Op)
// via the same position rule. Two things the cursor does NOT give for free,
// handled here:
//   - the FROZEN member set (CR 608.2i): selected once and persisted in
//     `collectedChoices` under a reserved `#forEach:<pos>:` key, so a resume
//     re-iterates the identical set (positions stay aligned) and members
//     leaving mid-iteration are skipped (CR 608.2b), not re-selected out;
//   - PER-ITERATION binding names: every `$`-binding written or read by a body
//     Op is transparently scoped to `@<pos>:<iteration>` via a wrapped
//     SpellContext, so the same `choice` Op prompts fresh each iteration and a
//     picks binding read back inside the iteration is unambiguous, while
//     bindings made BEFORE the construct (an outer `bind`, `$source`) stay
//     readable through a fallback to the unscoped name.

/** Scopes a `$`-binding name to one forEach iteration. `pos` (the construct's
 *  own pre-order position) disambiguates two forEach constructs in the same
 *  script; `iteration` disambiguates iterations, so the SAME `choice` Op's
 *  binding does not collide across iterations. `@` and `:` are illegal in
 *  author binding names (validator-enforced `$[A-Za-z][A-Za-z0-9]*`), so
 *  scoped names can never collide with authored ones. */
function scopeBindingName(
    name: string,
    pos: number,
    iteration: number
): string {
    return `${name}@${pos}:${iteration}`;
}

/** Wraps a SpellContext so every `$`-binding written or read by a forEach
 *  BODY Op is transparently iteration-scoped: `noteChoice` / `requestChoice`
 *  write under the scoped name, and `recallChoice` reads the scoped name
 *  first, falling back to the unscoped one — that fallback keeps bindings made
 *  BEFORE the construct (an outer `bind`, the implicit `$source`) readable
 *  across every iteration and across suspensions ("bind across iterations",
 *  issue #807). Non-`$` choice ids pass through unscoped. Every other
 *  primitive is the real one — the wrapper is pure name translation, no game
 *  logic (ADR 0045 "one execution path"). */
function scopedContext(
    ctx: SpellContext,
    pos: number,
    iteration: number
): SpellContext {
    const scope = (name: string): string =>
        name.startsWith("$") ? scopeBindingName(name, pos, iteration) : name;
    return {
        ...ctx,
        noteChoice: (choiceId, values) =>
            ctx.noteChoice(scope(choiceId), values),
        recallChoice: (choiceId) =>
            ctx.recallChoice(scope(choiceId)) ?? ctx.recallChoice(choiceId),
        requestChoice: (req) =>
            ctx.requestChoice({ ...req, choiceId: scope(req.choiceId) }),
    };
}

/** Selects the members of a forEach set (issue #807), ONCE, at construct entry
 *  (CR 608.2i — information from the game is determined only once, as the
 *  effect is applied). Players iterate in APNAP order (CR 101.4: active player
 *  first, then each other player in turn order) — this is what makes choice
 *  Ops inside a players-set body APNAP-ordered decisions. Permanents are
 *  gathered per player in the same APNAP order, optionally scoped to one
 *  controller and filtered (CR 205). */
function selectForEachMembers(
    ctx: SpellContext,
    select: EffectForEachSelector
): string[] {
    if (select.set === "players") return [...ctx.apNapOrder()];
    let owners: string[];
    if (select.controller !== undefined) {
        const pid = resolvePlayerRef(ctx, select.controller);
        owners = pid === undefined ? [] : [pid];
    } else {
        owners = [...ctx.apNapOrder()];
    }
    return owners.flatMap((pid) =>
        ctx.getBattlefieldIds(pid, toPermanentFilter(select.filter))
    );
}

/** Executes one `forEach` construct (ADR 0045, issue #807) against the shared
 *  pre-order cursor. The construct's own position (checkpointed by `runOpList`
 *  just before dispatch) keys the frozen member set; each iteration binds
 *  `$each`, then re-walks the body through `runOpList` so a body `choice` Op's
 *  suspension resumes at its exact (iteration, Op) position (CR 608.3). */
function execForEach(
    ctx: SpellContext,
    op: OpOf<"forEach">,
    cursor: Cursor
): OpOutcome {
    // The construct's own pre-order position — committed by `runOpList` right
    // before dispatch, and stable across suspensions (the deterministic walk
    // reaches this forEach at the same position every time). Captured ONCE
    // here because the body's `runOpList` overwrites the checkpoint per Op.
    const pos = ctx.getScriptCheckpoint() ?? 0;
    const setKey = `#forEach:${pos}:set`;

    let members = ctx.recallChoice(setKey);
    if (members === undefined) {
        // Construct entry: determine the set ONCE and freeze it (CR 608.2i).
        members = selectForEachMembers(ctx, op.select);
        ctx.noteChoice(setKey, members);
    }

    for (let k = 0; k < members.length; k++) {
        const inner = scopedContext(ctx, pos, k);
        // Bind `$each` once per iteration (a resume mid-iteration keeps the
        // persisted binding authoritative — the member may have changed or
        // left since, CR 603.10 LKI). The suffix-scanning recall makes the
        // guard prefix-agnostic.
        const eachId = scopeBindingName(EACH_BINDING, pos, k);
        if (ctx.recallChoice(eachId) === undefined) {
            if (op.select.set === "players") {
                ctx.noteChoice(eachId, [members[k]]);
            } else if (ctx.getOwnerId(members[k]) !== undefined) {
                // Snapshot BEFORE the body acts on the member (CR 608.2h).
                bindSnapshot(ctx, eachId, {
                    type: "permanent",
                    id: members[k],
                });
            }
            // else: the frozen-set member already left the battlefield —
            // leave `$each` uncaptured; body Ops reading it skip (CR 608.2b).
        }
        const outcome = runOpList(inner, op.effects, cursor);
        if (outcome === "suspend") return "suspend";
    }
    return undefined;
}

/** Executes an Op sequence (CR 608.2c) through `runOpList`, checkpointing a
 *  PRE-ORDER position in the stack item (issue #805 / #806) so a suspending Op
 *  — anywhere in the nested tree, including AFTER a side-effecting Op inside an
 *  `if` branch — resumes at the SAME Op. Completed (possibly irreversible) Ops
 *  never re-run (CR 608.3): on resume the tree is re-walked and every Op before
 *  the checkpointed position is skipped, so a pre-op inside a branch fires
 *  exactly once. Ops whose selector or ref cannot be satisfied are skipped
 *  individually — the rest of the script still runs (CR 608.2b, "the spell does
 *  as much as it can").
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
    // A fresh run resumes from position 0 (nothing skipped); a resume skips
    // every Op before the checkpointed position across the whole nested tree.
    const cursor: Cursor = { pos: 0, resume: checkpoint ?? 0 };
    const outcome = runOpList(ctx, effects, cursor);
    if (outcome === "suspend") return; // engine sees pendingChoices > 0
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
