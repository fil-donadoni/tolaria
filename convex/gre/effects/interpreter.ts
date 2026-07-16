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
// The value grammar is exactly literal | ref | count | X | counters (ADR 0045
// frozen grammar — X issue #852, counters issue #1015; both thin skins over an
// existing SpellContext primitive, neither a new structural construct). The
// `if` structural construct (issue #806) is a registered Op
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
    ControlChangeCondition,
    EffectCaptureSource,
    EffectCardFilter,
    EffectComparisonOp,
    EffectMode,
    EffectCountSpec,
    EffectForEachSelector,
    EffectListSelector,
    EffectObjectSelector,
    EffectOp,
    EffectPileObjectSelector,
    EffectPlayerRef,
    EffectPredicate,
    EffectSignedValue,
    EffectTargetRef,
    EffectValue,
    GainControlDuration,
    PermanentFilter,
    SpellContext,
    TargetSelection,
} from "../../cards/types";
import { getEventFieldRow } from "../../cards/mechanicsRegistry";

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
 *  [0] power, [1] toughness, [2] controller, [3] instance id, [4] mana value,
 *  [5] owner — all strings (the store is the same `string[]` shape every
 *  collected answer uses). The id slot (issue #807) lets a `forEach` body act
 *  ON the snapshotted object (`{ ref: "$each" }` in an object position);
 *  snapshots written before #807 lack it, and readers treat a missing id as
 *  "no object". The mana-value slot (issue #680) is 0 for pre-existing
 *  snapshots (`Number("")` reads back as `NaN`, but no card predates
 *  `ref.manaValue` support so nothing reads a missing slot). The owner slot
 *  (issue #1106) is DISTINCT from controller (CR 108.3 — ownership never
 *  changes, control can) — "return X to its OWNER's hand, that player
 *  discards" (Recoil) must read owner, not whoever currently controls a
 *  stolen permanent (Spinal Embrace). A snapshot written before #1106 lacks
 *  this slot; `snap[SNAP_OWNER]` then reads `undefined` and `resolvePlayerRef`
 *  skips the dependent Op (CR 608.2b) exactly like a missing id — no shipped
 *  card round-trips a pre-#1106 snapshot across this deploy, so no migration
 *  is needed. */
const SNAP_POWER = 0;
const SNAP_TOUGHNESS = 1;
const SNAP_CONTROLLER = 2;
const SNAP_ID = 3;
const SNAP_MANA_VALUE = 4;
const SNAP_OWNER = 5;

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

/** True for a reserved `$event.<field>` ref string (ADR 0049, issue #865) —
 *  read at a trigger site, resolved live from the firing event rather than a
 *  stored binding. */
function isEventRef(ref: string): boolean {
    return ref.startsWith("$event.");
}

/** Resolves a `$event.<field>` ref (ADR 0049, issue #865) at a trigger site
 *  through the EVENT_FIELD_REGISTRY: looks the friendly field up for the FIRING
 *  event's type, flattens it to a single id via the row's `resolve`, and
 *  returns the id with its declared family. Returns undefined when there is no
 *  firing event (a spell / activated site — the validator already rejects this
 *  statically), the field is uncensused, or the event carries no such id
 *  (CR 608.2b — the reading Op then skips). */
function resolveEventRef(
    ctx: SpellContext,
    ref: string
): { family: "object" | "player"; id: string } | undefined {
    const dot = ref.indexOf(".");
    if (dot < 0) return undefined;
    const field = ref.slice(dot + 1);
    const event = ctx.triggerEvent;
    if (!event) return undefined;
    const row = getEventFieldRow(event.type, field);
    if (!row) return undefined;
    const id = row.resolve(event);
    if (id === undefined) return undefined;
    return { family: row.family, id };
}

/** Reads a binding's stored value array from the stack item's persisted
 *  answer store, or undefined when the binding was never captured (its Op was
 *  skipped or its choice found no candidates — CR 608.2b, the reader skips
 *  too). Snapshot bindings were written by `bindSnapshot`; picks bindings are
 *  the `requestChoice` entry keyed by the binding name. */
function readBinding(ctx: SpellContext, name: string): string[] | undefined {
    return ctx.recallChoice(name);
}

/** The fixed `choiceId` an `optionChoice` Op (issue #849) hands to
 *  `requestOptionChoice`. It need not be author-supplied nor unique across Ops:
 *  `requestOptionChoice` folds the Op's checkpointed pre-order position
 *  (`resolutionStep`) into the stored key, so two `optionChoice` Ops in one
 *  script key their picks distinctly. Not a `$`-binding (the mode index is
 *  consumed inline, never read by a later `ref`), so it never collides with an
 *  author binding name. */
const OPTION_CHOICE_ID = "optionChoiceMode";

/** The fixed `choiceId` a `coinFlip` Op (issue #851) hands to
 *  `requestCoinFlip`. Like `OPTION_CHOICE_ID` it need not be unique across Ops:
 *  `requestCoinFlip` folds the Op's checkpointed pre-order position
 *  (`resolutionStep`) into the stored key (`${step}:${choiceId}`), so two
 *  coinFlip Ops in one script persist their drawn bits distinctly and each
 *  re-reads its own on a re-walk (no re-roll, CR 608.3 / ADR 0023). */
const COIN_FLIP_ID = "coinFlipOutcome";

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
 *  `ref` reading a bound snapshot's power/toughness, a `count` of a selected
 *  set, the chosen-cost `X` (issue #852 — a thin skin over `ctx.getX()`,
 *  CR 107.3 / 601.2b), a `counters` count on a selected object (issue #1015
 *  — a thin skin over `ctx.getCounterCount`, CR 122.6), or — at a SIGNED value
 *  site (`EffectSignedValue`, today only `pump`'s power/toughness) — a
 *  `negate`-wrapped value (issue #926, one unary sign flip, no other
 *  arithmetic). Returns `undefined` when a ref names a binding that was never
 *  captured, a selected object has left play (CR 608.2b), or the negated
 *  inner value is itself unresolvable — so the caller skips too. */
function resolveValue(
    ctx: SpellContext,
    value: EffectValue | EffectSignedValue
): number | undefined {
    if (typeof value === "number") return value;
    // negate (issue #926) — flips the sign of the wrapped value at read time.
    // Scoped to the SIGNED value grammar; `EffectValue` proper never carries
    // this key (the static validator, `isEffectValue`, rejects it), so this
    // branch only ever fires for a pump power/toughness site.
    if ("negate" in value) {
        const inner = resolveValue(ctx, value.negate);
        return inner === undefined ? undefined : -inner;
    }
    if ("ref" in value) {
        const parsed = parseRef(value.ref);
        if (!parsed) return undefined;
        const snap = readBinding(ctx, parsed.binding);
        if (!snap) return undefined;
        if (parsed.property === "power") return Number(snap[SNAP_POWER]);
        if (parsed.property === "toughness") {
            return Number(snap[SNAP_TOUGHNESS]);
        }
        // manaValue (issue #680) — CR 202.3, e.g. Reanimate's "lose life
        // equal to that card's mana value".
        if (parsed.property === "manaValue") {
            return Number(snap[SNAP_MANA_VALUE]);
        }
        return undefined;
    }
    // escaped (CR 702.138e, issue #695) — 1 if the referenced permanent escaped
    // (was cast from a graveyard via Escape), else 0. Powers "sacrifice it
    // unless it escaped" as a numeric comparison. `of` resolves through the same
    // resolveObjectRef path every object-acting Op uses; an unresolvable object
    // yields 0 (CR 608.2b — treated as not-escaped).
    if ("escaped" in value) {
        const target = resolveObjectRef(ctx, value.escaped.of);
        return target && ctx.isEscaped(target) ? 1 : 0;
    }
    // Chosen-cost X (CR 107.3, 601.2b) — the value announced for {X} at cast
    // time, read back off the stack item via getX(). One execution path, no
    // duplicated logic (ADR 0045, issue #852).
    if ("X" in value) return ctx.getX();
    // counters — the number of counters of a given type on a selected object
    // (CR 122.6, issue #1015), a thin skin over ctx.getCounterCount. `of`
    // resolves through the SAME resolveObjectRef path every object-acting Op
    // uses (announced slot / $source / $each); an undefined resolution (the
    // object left play — CR 608.2b) makes the value unresolvable, so the caller
    // skips exactly as it does for any other missing ref.
    if ("counters" in value) {
        const target = resolveObjectRef(ctx, value.counters.of);
        if (target) return ctx.getCounterCount(target, value.counters.type);
        // CR 608.2g LAST-KNOWN INFORMATION — a `$source` sacrificed as an
        // activation COST (Powder Keg #997, Icatian Moneychanger) has left the
        // battlefield by the time the ability resolves, so the battlefield-
        // scoped `resolveObjectRef` returns undefined. The resolving stack item
        // still snapshots the source's counters, so re-read the count through
        // `ctx.sourceInstanceId`: getCounterCount returns the pre-sacrifice
        // count ("Destroy each … with mana value equal to the number of fuse
        // counters on it" reads that count as last-known info).
        //
        // CAVEAT — this LKI re-read is faithful only for ACTIVATED / native
        // stack items, where the resolving item id EQUALS `ctx.sourceInstanceId`
        // (getCounterCount's LKI branch keys off the resolving item id). For a
        // TRIGGERED ability `ctx.sourceInstanceId` is the `triggerSourceId`, NOT
        // the resolving item id, so if the trigger's source has ALSO left play
        // the LKI re-read misses and returns 0 rather than a true last-known
        // count. No shipping card hits that path today — Powder Keg's activated
        // sweep is the only counter-after-leave reader, and its fuse trigger
        // keeps the source alive. Generalise the LKI read (thread the resolving
        // item id, not just `sourceInstanceId`) when a triggered counter-reader
        // whose source leaves first ever ships.
        //
        // Scoped to `$source` only — an announced target or a `$each` member
        // that left play stays unresolvable (the Op is skipped, CR 608.2b).
        if ("ref" in value.counters.of && value.counters.of.ref === "$source") {
            return ctx.getCounterCount(
                { type: "permanent", id: ctx.sourceInstanceId },
                value.counters.type
            );
        }
        return undefined;
    }
    // kickerCount — how many times the resolving spell was kicked (CR 702.33 /
    // 702.33e), a thin skin over ctx.getKickerCount. Reads back off the stack
    // item; `> 0` in a comparison predicate is the "if this spell was kicked"
    // gate (Overload, Burst Lightning, Bloodchief's Thirst, Tear Asunder,
    // Consult the Star Charts). One execution path, no arithmetic.
    if ("kickerCount" in value) return ctx.getKickerCount();
    // manaValue — the mana value of a selected object (CR 202.3), a thin skin
    // over ctx.getManaValue. `of` resolves through the SAME resolveObjectRef
    // path every object-acting Op uses; an undefined resolution (the object
    // left play, CR 608.2b) makes the value unresolvable so the caller skips
    // (Overload's "destroy target artifact if its mana value is N or less").
    if ("manaValue" in value) {
        const target = resolveObjectRef(ctx, value.manaValue.of);
        return target ? ctx.getManaValue(target) : undefined;
    }
    // domain — the Domain ability word (CR 702 preamble, issue #1066), a thin
    // skin over ctx.getDomain. `of` is a PLAYER selector (unlike counters'/
    // manaValue's object `of`) — resolved through the SAME resolvePlayerRef
    // path every player-scoped Op uses, so an announced-slot / `$each` /
    // relative player all work identically. Undefined when the player cannot
    // be resolved (CR 608.2b — Collapsing Borders' per-player upkeep trigger
    // reads the FIRING upkeep's player, not necessarily the controller).
    if ("domain" in value) {
        const playerId = resolvePlayerRef(ctx, value.domain.of);
        if (playerId === undefined) return undefined;
        return ctx.getDomain(playerId) * (value.domain.times ?? 1);
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
    return {
        types: filter.type,
        excludeTypes: filter.excludeType,
        subtypes: filter.subtype,
        supertypes: filter.supertype,
        excludeSupertypes: filter.excludeSupertype,
        colors: filter.color,
        isToken: filter.isToken,
        name: filter.name,
        // issue #897 — propagate the OR-across-fields clause list onto
        // `PermanentFilter.any` (`convex/cards/filters.ts`), recursing through
        // this same mapping for each clause. Without this, a filter carrying
        // ONLY `any` (no other field set) mapped to an all-undefined
        // `PermanentFilter` that `matchesPermanentFilter` treats as "no
        // constraint" — matching EVERY permanent (fail OPEN) at every
        // battlefield `choice`/`count`/`forEach` site. Each clause is always a
        // full `EffectCardFilter`, so the recursive call is never undefined.
        any: filter.any?.map((clause) => toPermanentFilter(clause)!),
    };
}

/** Normalizes a possibly-array filter field to an array (an absent field
 *  stays absent — the caller treats that as "no constraint"). Mirrors
 *  `PermanentFilter`'s own `asArray` helper (issue #677 — OR-within-a-field
 *  semantics, e.g. a fetchland's "a Forest or Island card"). */
function asFilterArray<T>(value: T | T[] | undefined): T[] | undefined {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
}

/** Matches a hidden-zone card's registry-read characteristics (library /
 *  graveyard, via `getLibraryCards` / `getGraveyardCards`) against an
 *  `EffectCardFilter` (issue #677). Every present field is ANDed; an
 *  array-valued `type`/`subtype`/`color` matches on ANY member (OR within
 *  that field). `supertypes` / `colors` are optional on the card shape since
 *  `getGraveyardCards` doesn't carry supertypes — a filter naming a field the
 *  card shape lacks simply never matches (fail-closed, mirrors
 *  `FilterMatchContext.supertypesOf`'s fail-closed default). `ctx` (issue
 *  #898) resolves a DYNAMIC `manaValueAtMost` (`{ X: true }`, Green Sun's
 *  Zenith's "mana value X or less") via the same `resolveValue` every other
 *  `EffectValue` site uses — an unresolvable dynamic value fails the filter
 *  closed (nothing matches, CR 608.2b, rather than admitting every card). */
function matchesCardFilter(
    ctx: SpellContext,
    card: {
        name?: string;
        types: readonly string[];
        subtypes: readonly string[];
        supertypes?: readonly string[];
        colors?: readonly string[];
        manaValue: number;
    },
    filter: EffectCardFilter
): boolean {
    // CR 201.2 — exact printed-name match ("each other card named Accumulated
    // Knowledge", issue #985). Fail-closed when the card shape carries no name.
    if (filter.name !== undefined && card.name !== filter.name) {
        return false;
    }
    const types = asFilterArray(filter.type);
    const excludeTypes = asFilterArray(filter.excludeType);
    const subtypes = asFilterArray(filter.subtype);
    const colors = asFilterArray(filter.color);
    if (types !== undefined && !types.some((t) => card.types.includes(t))) {
        return false;
    }
    // issue #682 — the negative of `type` (Thoughtseize's "nonland card",
    // Duress's "noncreature, nonland card"). Mirrors `PermanentFilter`'s own
    // `excludeTypes` semantics: fails if the card has ANY listed type.
    if (
        excludeTypes !== undefined &&
        excludeTypes.some((t) => card.types.includes(t))
    ) {
        return false;
    }
    if (
        subtypes !== undefined &&
        !subtypes.some((s) => card.subtypes.includes(s))
    ) {
        return false;
    }
    if (
        filter.supertype !== undefined &&
        !(card.supertypes ?? []).includes(filter.supertype)
    ) {
        return false;
    }
    // issue #999 — the negative of `supertype` ("nonbasic land"): fails if the
    // card has ANY listed supertype. A hidden-zone card shape may carry no
    // supertypes (fail-open here — nothing to exclude), mirroring the
    // fail-closed `supertype` positive above.
    const excludeSupertypes = asFilterArray(filter.excludeSupertype);
    if (
        excludeSupertypes !== undefined &&
        excludeSupertypes.some((s) => (card.supertypes ?? []).includes(s))
    ) {
        return false;
    }
    if (
        colors !== undefined &&
        !colors.some((c) => (card.colors ?? []).includes(c))
    ) {
        return false;
    }
    if (filter.manaValueAtMost !== undefined) {
        const ceiling = resolveValue(ctx, filter.manaValueAtMost);
        // An unresolvable dynamic ceiling (issue #898) fails closed — no
        // candidates, mirroring every other unresolvable-EffectValue skip
        // (CR 608.2b), rather than silently admitting every card.
        if (ceiling === undefined || card.manaValue > ceiling) return false;
    }
    // issue #897 — OR ACROSS filter dimensions. Every other field above is
    // ANDed; `any` is the one disjunctive clause list this filter supports:
    // the card must match AT LEAST ONE of the clauses (Magda, Brazen
    // Outlaw's "an artifact or Dragon card" — `type: "Artifact"` OR
    // `subtype: "Dragon"`, two different fields, not the OR-WITHIN-a-field
    // arrays `type`/`subtype`/`color` already support). ANDed with every
    // other top-level field present alongside `any` (recursion through this
    // same function — each clause is itself a full AND-of-fields filter).
    if (
        filter.any !== undefined &&
        !filter.any.some((clause) => matchesCardFilter(ctx, card, clause))
    ) {
        return false;
    }
    return true;
}

/** Resolves a `divideIntoPiles` Op's `objects` selector (ADR 0053, pile
 *  division) to the concrete object-set ids plus the zone-pick shape
 *  `requestChoice`'s "divide-piles" kind needs to validate the divider's
 *  partition — mirrors `choiceCandidates`'s library/graveyard branches
 *  (issue #677/#680) and `selectForEachMembers`'s permanents branch (issue
 *  #807), but ALWAYS single-owner (every one of the six INV pile cards'
 *  object sets belongs to exactly one player). `library-top` additionally
 *  REVEALS the peeked cards (CR 701.16, Fact or Fiction) — a public reveal,
 *  not a private look, so it marks them known to ALL players rather than
 *  routing through the `libraryPeek` chooser-only exposure. Returns
 *  `undefined` when the owning player cannot be resolved (CR 608.2b). */
function resolvePileObjectSet(
    ctx: SpellContext,
    select: EffectPileObjectSelector
):
    | {
          ids: string[];
          zone: "battlefield" | "library" | "graveyard";
          zoneOwnerId: string;
          filter?: PermanentFilter;
      }
    | undefined {
    if (select.set === "permanents") {
        const zoneOwnerId = resolvePlayerRef(ctx, select.controller);
        if (zoneOwnerId === undefined) return undefined;
        const filter = toPermanentFilter(select.filter);
        return {
            ids: ctx.getBattlefieldIds(zoneOwnerId, filter),
            zone: "battlefield",
            zoneOwnerId,
            filter,
        };
    }
    if (select.set === "library-top") {
        const zoneOwnerId = resolvePlayerRef(ctx, select.player);
        if (zoneOwnerId === undefined) return undefined;
        const n = resolveValue(ctx, select.count);
        const count = n === undefined || n < 0 ? 0 : n;
        const ids = count === 0 ? [] : ctx.peekLibraryTop(zoneOwnerId, count);
        if (ids.length > 0) ctx.markKnownToAll(zoneOwnerId, ids);
        return { ids, zone: "library", zoneOwnerId };
    }
    // graveyard
    const zoneOwnerId = resolvePlayerRef(ctx, select.controller);
    if (zoneOwnerId === undefined) return undefined;
    const cards = ctx.getGraveyardCards(zoneOwnerId);
    const filter = select.filter;
    const ids = (
        filter ? cards.filter((c) => matchesCardFilter(ctx, c, filter)) : cards
    ).map((c) => c.id);
    return { ids, zone: "graveyard", zoneOwnerId };
}

/** Counts a declaratively-selected set of cards (ADR 0045 `count` construct,
 *  CR 122 counting). Returns 0 when the controlling player cannot be resolved. */
function countSet(ctx: SpellContext, spec: EffectCountSpec): number {
    // CR 122 — a fixed literal multiplier scales the counted cardinality
    // ("TWICE the number of nonbasic lands", Price of Progress, issue #999).
    // Not arithmetic composition (ADR 0045 frozen grammar): a constant baked
    // into the count, defaulting to 1. Applied AFTER the count so a 0 count
    // stays 0 (times * 0 = 0, still a no-op amount).
    const times = spec.times ?? 1;
    // CR 122 — "in all graveyards" (Accumulated Knowledge, issue #985): sum
    // each player's matching cards. `controller` is ignored in this mode.
    if (spec.acrossAllPlayers) {
        return (
            times *
            ctx.allPlayerIds.reduce(
                (sum, pid) => sum + countZoneForPlayer(ctx, pid, spec),
                0
            )
        );
    }
    const playerId = resolvePlayerRef(ctx, spec.controller!);
    if (playerId === undefined) return 0;
    return times * countZoneForPlayer(ctx, playerId, spec);
}

/** Counts one player's matching cards in the spec's zone (CR 122). Shared by
 *  the single-player and `acrossAllPlayers` branches of `countSet`. */
function countZoneForPlayer(
    ctx: SpellContext,
    playerId: string,
    spec: EffectCountSpec
): number {
    if (spec.zone === "battlefield") {
        return ctx.getBattlefieldIds(playerId, toPermanentFilter(spec.filter))
            .length;
    }
    // graveyard (CR 404) — filter by the shared card-filter matcher, mirroring
    // the battlefield branch. An absent filter imposes no constraint.
    // Subtype-scoped graveyard counts are legitimate ("for each Zombie in your
    // graveyard").
    const cards = ctx.getGraveyardCards(playerId);
    const filtered = spec.filter
        ? cards.filter((c) => matchesCardFilter(ctx, c, spec.filter!))
        : cards;
    // Delirium (CR 702.D): count distinct card types instead of total cards
    // ("there are four or more card types among cards in your graveyard").
    if (spec.countTypes) {
        const typeSet = new Set<string>();
        for (const c of filtered) {
            for (const t of c.types) typeSet.add(t);
        }
        return typeSet.size;
    }
    return filtered.length;
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
        // `$event.<field>` player ref (ADR 0049, issue #865) — the firing
        // event's player id, flattened through the registry. Legal only at a
        // trigger site (validator-enforced); a wrong family here is a skip.
        if (isEventRef(ref.ref)) {
            const ev = resolveEventRef(ctx, ref.ref);
            return ev && ev.family === "player" ? ev.id : undefined;
        }
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
        // `.owner` (issue #1106) reads the immutable CR 108.3 owner captured
        // at bind time — DISTINCT from `.controller`, which tracks whoever
        // currently controls the object (a control-magic effect can diverge
        // the two; Recoil's "that player discards" means the owner, CR
        // 400.7). A pre-#1106 snapshot has no SNAP_OWNER slot; the array read
        // then yields `undefined` and the Op skips (CR 608.2b), same as any
        // other uncaptured binding.
        if (parsed.property === "owner") return snap[SNAP_OWNER];
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
    // `$event.<field>` object ref (ADR 0049, issue #865) — the firing event's
    // permanent id, re-checked for battlefield presence (CR 608.2b) exactly
    // like a snapshot. Legal only at a trigger site (validator-enforced).
    if (isEventRef(ref.ref)) {
        const ev = resolveEventRef(ctx, ref.ref);
        if (!ev || ev.family !== "object") return undefined;
        if (ctx.getOwnerId(ev.id) === undefined) return undefined;
        return { type: "permanent", id: ev.id };
    }
    if (!ref.ref.startsWith("$") || ref.ref.includes(".")) return undefined;
    const snap = readBinding(ctx, ref.ref);
    const id = snap?.[SNAP_ID];
    if (!id) return undefined;
    // CR 608.2b — the snapshotted object must still be on the battlefield;
    // `getOwnerId` is battlefield-scoped, so undefined means it left.
    if (ctx.getOwnerId(id) === undefined) return undefined;
    return { type: "permanent", id };
}

/** Maps a `gainControl` Op's JSON-pure `duration` discriminator onto the
 *  runtime `ControlChangeCondition` the conditional-control SBA re-evaluates
 *  (CR 611.2b, issue #848). An omitted duration is the INDEFINITE reassignment
 *  (no condition — control never reverts on its own, the Ghazbán Ogre shape).
 *  The `controller-controls-source` kind carries the new controller's id (it
 *  holds "for as long as YOU control the source", where YOU is who just gained
 *  control). */
function gainControlCondition(
    duration: GainControlDuration | undefined,
    newControllerId: string
): ControlChangeCondition | undefined {
    switch (duration) {
        case undefined:
            return undefined;
        case "while-you-control-source":
            return {
                kind: "controller-controls-source",
                controllerId: newControllerId,
            };
        case "while-source-tapped":
            return { kind: "source-tapped" };
        case "while-source-tapped-and-power-ge":
            return { kind: "source-tapped-and-power-ge" };
    }
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
 *  (CR 608.2h). `target` is normally a battlefield permanent (destroy/exile,
 *  a bounce); a `moveZone` graveyard-card reanimation (issue #680) can also
 *  bind — `getPower`/`getToughness`/`getController`/`getOwnerId` are
 *  battlefield-scoped and meaningless for a card that never was on the
 *  battlefield (CR 208.2), so those slots fall back to 0/0/owner/owner for a
 *  non-permanent target (a graveyard card's "controller" and "owner" are the
 *  same player, CR 108.3/110.2 — nobody else can control a card that isn't a
 *  permanent); `getManaValue` (SNAP_MANA_VALUE) already dispatches on
 *  `target.type`. */
function bindSnapshot(
    ctx: SpellContext,
    name: string,
    target: TargetSelection
): void {
    const isPermanent = target.type === "permanent";
    ctx.noteChoice(name, [
        String(isPermanent ? ctx.getPower(target) : 0),
        String(isPermanent ? ctx.getToughness(target) : 0),
        isPermanent ? ctx.getController(target) : (target.playerId ?? ""),
        // SNAP_ID (issue #807) — lets a forEach body act on the snapshotted
        // member via `{ ref: "$each" }`; readers re-check battlefield
        // presence before acting (CR 608.2b).
        target.id,
        // SNAP_MANA_VALUE (issue #680) — CR 202.3, read before the object
        // moves so a graveyard-card reanimation's mana value survives the
        // zone change (Reanimate).
        String(ctx.getManaValue(target)),
        // SNAP_OWNER (issue #1106) — CR 108.3, immutable and DISTINCT from
        // controller (Recoil: "return target permanent to its OWNER's hand.
        // Then that player discards" — the owner, not a Spinal Embrace thief
        // who currently controls it). `getOwnerId` is battlefield-scoped like
        // `getController`, so it's read here, BEFORE the zone change, and
        // falls back to "" only defensively (the target is still on the
        // battlefield at bind time by construction).
        (isPermanent
            ? ctx.getOwnerId(target.id)
            : (target.playerId ?? undefined)) ?? "",
    ]);
}

/** Computes how many candidates a `choice` Op actually has, plus the
 *  graveyard allow-list when applicable. The pick count is clamped to this
 *  (CR 608.2b — the chooser cannot be asked for more than exists; "discard
 *  two cards" with one card in hand discards one, CR 701.9b). `zoneOwnerId`
 *  is the owner of the zone being read — the chooser by default, but a
 *  different player when the Op's `zoneOwnerId` field is set (issue #920 —
 *  "target player reveals their hand, YOU choose a card from it"). */
function choiceCandidates(
    ctx: SpellContext,
    op: OpOf<"choice">,
    zoneOwnerId: string
): { available: number; candidateIds?: string[] } {
    if (op.zone === "battlefield") {
        return {
            available: ctx.getBattlefieldIds(
                zoneOwnerId,
                toPermanentFilter(op.filter)
            ).length,
        };
    }
    if (op.zone === "hand") {
        // A hand is hidden to the opponent but known to its owner — same
        // reasoning as the library branch below (issue #677): a type/
        // subtype/supertype/color/mana-value restriction (Stoneforge Mystic's
        // "an Equipment card from your hand") is precomputed as an explicit
        // `candidateIds` allow-list via the shared matcher. No filter — every
        // card in hand is eligible.
        if (!op.filter) {
            return { available: ctx.getHandSize(zoneOwnerId) };
        }
        const filter = op.filter;
        const ids = ctx
            .getHandCards(zoneOwnerId)
            .filter((c) => matchesCardFilter(ctx, c, filter))
            .map((c) => c.id);
        return { available: ids.length, candidateIds: ids };
    }
    if (op.zone === "library") {
        // A library is hidden — the submit validator has no card
        // characteristics to check a raw pick against, so a type/subtype/
        // supertype/color/mana-value restriction (issue #677 — "search … for
        // a [type] card" / "… a BASIC land card" / "… a green creature card",
        // the tutor/fetchland pattern) must be precomputed here as an
        // explicit `candidateIds` allow-list via the shared `matchesCardFilter`
        // matcher (mirrors `countSet`'s graveyard branch). No filter — every
        // card in the library is eligible (Vampiric Tutor, Entomb).
        if (!op.filter) {
            return { available: ctx.getLibraryCards(zoneOwnerId).length };
        }
        const filter = op.filter;
        const ids = ctx
            .getLibraryCards(zoneOwnerId)
            .filter((c) => matchesCardFilter(ctx, c, filter))
            .map((c) => c.id);
        return { available: ids.length, candidateIds: ids };
    }
    // graveyard — a public zone: eligibility is the snapshot taken when the
    // choice is raised, carried as an explicit allow-list (the submit
    // validator gates graveyard picks on `candidateIds`). A type/subtype/
    // mana-value restriction (issue #680 — Titania's "a LAND card", Exhume's
    // "a CREATURE card") is precomputed the same way as the hand/library
    // branches above (mirrors `countSet`'s graveyard branch too). No filter —
    // every card in the graveyard is eligible (Eternal Witness).
    const graveyardCards = ctx.getGraveyardCards(zoneOwnerId);
    const ids = op.filter
        ? graveyardCards
              .filter((c) => matchesCardFilter(ctx, c, op.filter!))
              .map((c) => c.id)
        : graveyardCards.map((c) => c.id);
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
            ctx.dealDamage(
                { type: "player", id: playerId },
                amount,
                op.unpreventable
            );
            return;
        }
        const target = resolveObjectRef(ctx, op.to);
        if (target) ctx.dealDamage(target, amount, op.unpreventable);
    },
    // CR 121.1 — draw from the top of the library, one card at a time, through
    // the unified suspend-capable draw seam (ADR 0061). A DETERMINISTIC draw
    // replacement (Enduring Renewal) commits inline; an INTERACTIVE one (Zur's
    // Weirding "any other player may pay 2 life") suspends on a `may-pay`
    // PendingChoice and resumes at the EXACT card. Replay-safe: each iteration's
    // commit is guarded by a per-Op-position, per-index `#draw` progress marker
    // (mirroring `forEach`'s `#forEach:<pos>:` result guard) so a re-walk after
    // a later card's suspend never re-commits an earlier card.
    draw(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const count = resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        const pos = ctx.getScriptCheckpoint() ?? 0;
        for (let i = 0; i < count; i++) {
            const doneKey = `#draw:${pos}:${i}`;
            // Already committed on an earlier run (a later card suspended, and
            // the tree is being re-walked) — CR 608.3, never replay a step.
            if (ctx.recallChoice(doneKey) !== undefined) continue;
            const plan = ctx.planDraw(playerId, count);
            if (plan.kind === "may-pay-bin") {
                const paid = ctx.requestMayPay({
                    playerId: plan.chooserId,
                    choiceId: `#draw-pay:${pos}:${i}`,
                    cost: { life: plan.life },
                    prompt: `You may pay ${plan.life} life to put the revealed card into its owner's graveyard. Otherwise they draw it.`,
                });
                if (paid === undefined) return "suspend"; // enqueued — wait
                ctx.commitDraw(playerId, plan, paid);
            } else {
                ctx.commitDraw(playerId, plan);
            }
            ctx.noteChoice(doneKey, ["done"]);
        }
    },
    // CR 119.3a — life gain.
    gainLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.gainLife(playerId, amount);
    },
    // CR 122.1 — "you get {E}": add energy counters to the player.
    getEnergy(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.addEnergy(playerId, amount);
    },
    // CR 119.3b — life loss (not damage).
    loseLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.loseLife(playerId, amount);
    },
    // CR 500.7 (issue #686) — schedule an extra turn for `player` (Time
    // Warp). Skipped when the player cannot be resolved (CR 608.2b).
    extraTurn(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.takeExtraTurn(playerId);
    },
    // CR 601.3a (issue #1057) — impose a turn-scoped per-player "can't cast
    // spells this turn" restriction (Xantid Swarm locks the defending player via
    // `player: "opponent"`; Abeyance, issue #1124, narrows it via `cardTypes`).
    // Skipped when the player is gone (CR 608.2b).
    restrictCasting(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.restrictSpellCasting(playerId, op.cardTypes);
    },
    // CR 602.1 / 605.1a (issue #1124) — impose a turn-scoped per-player "can't
    // activate abilities that aren't mana abilities" restriction (Abeyance).
    // Skipped when the player is gone (CR 608.2b).
    restrictActivation(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.restrictAbilityActivation(playerId);
    },
    // CR 305.1-analog / 601 (issue #1149) — grant a turn-scoped, player-wide
    // permission to play lands and/or cast spells from OWN graveyard
    // (Yawgmoth's Will). `zones` defaults to BOTH lands and spells when
    // omitted. Skipped when the player is gone (CR 608.2b).
    grantGraveyardPlay(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.grantGraveyardPlay(
            playerId,
            op.zones ?? ["land", "spell"],
            op.maxManaValue
        );
    },
    // CR 614 (issue #1145 / #1149) — arm a turn-scoped "if a card would be put
    // into the player's graveyard from anywhere this turn, exile it instead"
    // redirect (Yawgmoth's Will's second clause). Skipped when the player is
    // gone (CR 608.2b).
    armGraveyardRedirect(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.armGraveyardRedirectThisTurn(playerId);
    },
    // CR 106.1 (issue #850) — add mana to a player's mana pool. A thin
    // declarative skin over the SpellContext primitive `addManaTo`, ONE
    // execution path (ADR 0045): the JSON-pure `mana` map is passed straight
    // through as a CardManaCost (the primitive ignores non-positive amounts and
    // the X/generic slots, CR 106.1). `player` defaults to the resolving
    // controller — a ritual adds to its caster's pool (CR 106.4); an
    // announced-slot or relative player otherwise. Skipped when the player
    // cannot be resolved (CR 608.2b).
    addMana(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player ?? "controller");
        if (playerId === undefined) return;
        ctx.addManaTo(playerId, op.mana);
    },
    // CR 701.8 — destroy, through the replacement layer (regeneration /
    // indestructible / destroy replacements, ADR 0020).
    destroy(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (op.bind) bindSnapshot(ctx, op.bind, target);
        ctx.destroy(target, { cantBeRegenerated: op.cantBeRegenerated });
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
    // CR 400.7 (issue #839 / #677) — a plain zone change. A thin declarative
    // skin over the SpellContext zone-movement primitives, ONE execution path
    // per shape (ADR 0045). Two shapes share the "moveZone" Op name:
    //  - `cards` (issue #677) — the SEARCH half of a tutor/fetch effect: the
    //    ids a `choice(zone: "library" | "hand")` Op picked. A hidden-zone card
    //    has no announced-target form (CR 601.2b), so this shape consumes the
    //    picks binding directly instead of `resolveObjectRef`. `to:
    //    "battlefield"` routes through `putFromLibraryOntoBattlefield` /
    //    `putFromHandOntoBattlefield` (a fetchland / Stoneforge Mystic's
    //    second ability) — `tapped` forces the entering permanent tapped
    //    (Fabled Passage) via a direct `ctx.tap` immediately after entry, a
    //    simplification that skips any "as this enters tapped" replacement
    //    interaction (none of the cube cards using it need one); every other
    //    destination routes through `moveCardById(player, id, from, to)` (a
    //    tutor). Skipped when the binding was never captured (no candidates,
    //    CR 608.2b) or the player cannot be resolved.
    //  - `target` (issue #839) — the current zone is inferred from the
    //    object's kind (a permanent is on the battlefield; a graveyard-card is
    //    in the graveyard), so the Op carries no `from`. Skipped when the
    //    referenced object is gone (CR 608.2b — the spell does as much as it
    //    can), or for a zone pair with no plain-move primitive (a battlefield
    //    permanent to any zone but the hand needs LTB semantics — that is
    //    `destroy`/`exile`, not `moveZone`).
    moveZone(ctx, op) {
        if ("cards" in op) {
            const playerId = resolvePlayerRef(ctx, op.player);
            if (playerId === undefined) return;
            const ids = resolvePicks(ctx, op.cards);
            if (!ids) return; // binding never captured — CR 608.2b, skip
            // issue #1125 — the tutor-to-top template. `from: "library"` is
            // validator-enforced for this destination: the picked card never
            // left the library (a search only chooses, it doesn't move), so
            // there is nothing to relocate INTO the library first — just
            // reposition it to the front, preserving `ids`' pick order.
            if (op.to === "library-top") {
                ctx.putLibraryCardsOnTop(playerId, ids);
                return;
            }
            for (const id of ids) {
                if (op.to === "battlefield") {
                    // `from: "graveyard"` (issue #680) reanimates each picked
                    // card under ITS OWN owner's control (`playerId` — the
                    // `choice` Op's chooser, which for a "puts a card from
                    // THEIR graveyard" pick is always that same owner: Exhume,
                    // Titania), mirroring the `target`-shape's reanimation.
                    const entered =
                        op.from === "hand"
                            ? ctx.putFromHandOntoBattlefield(playerId, id)
                            : op.from === "graveyard"
                              ? ctx.returnToBattlefield(
                                    playerId,
                                    id,
                                    "graveyard"
                                )
                              : ctx.putFromLibraryOntoBattlefield(playerId, id);
                    if (entered && op.tapped) {
                        ctx.tap({ type: "permanent", id });
                    }
                } else {
                    ctx.moveCardById(playerId, id, op.from, op.to);
                }
            }
            return;
        }
        let target = resolveObjectRef(ctx, op.target);
        // Graveyard-source recovery (CR 400.7): `resolveObjectRef` is
        // battlefield-scoped, so a ref to a card sitting in a graveyard resolves
        // to undefined. `moveZone` is the only Op whose graveyard → battlefield
        // branch can act on it, so recover the graveyard-card selection here from
        // the ref's id — the source reanimating itself (Ashen Ghoul's `$source`,
        // issue #737) or a `forEach { set: "graveyard" }` member reanimating
        // (`$each`, issue #1056 — Replenish, Living Death).
        if (!target && "ref" in op.target) {
            // `$source` recovery is unconditional (Ashen Ghoul, issue #737): its
            // source genuinely sits in a graveyard. A GENERAL ref (a forEach
            // graveyard member's `$each`, issue #1056) is recovered ONLY for a
            // reanimation (`to: "battlefield"`) — the sole destination a bulk
            // graveyard sweep uses. This matters because instance ids are
            // PRESERVED when a permanent dies to the graveyard: without the
            // `to === "battlefield"` guard, a `moveZone { ref, to: "hand" }`
            // over a permanents-set whose member died mid-resolution would
            // wrongly follow that (now distinct, CR 400.7) object into the
            // graveyard and bounce it. The guard keeps that path a CR 608.2b skip.
            const isSource = op.target.ref === "$source";
            if (isSource || op.to === "battlefield") {
                const gid = isSource
                    ? ctx.sourceInstanceId
                    : readBinding(ctx, op.target.ref)?.[SNAP_ID];
                if (gid !== undefined) {
                    const owner = ctx.getGraveyardCardOwner(gid);
                    if (owner !== undefined) {
                        target = {
                            type: "graveyard-card",
                            id: gid,
                            playerId: owner,
                        };
                    }
                }
            }
        }
        if (!target) return;
        if (target.type === "permanent") {
            // Battlefield source (CR 110). Only the bounce-to-hand pair has a
            // plain-move primitive (CR 701.10); other destinations from the
            // battlefield need leaves-the-battlefield handling and are skipped.
            if (op.to === "hand") {
                if (op.bind) bindSnapshot(ctx, op.bind, target);
                ctx.returnToHand(target);
            }
            return;
        }
        if (target.type === "graveyard-card") {
            const owner = target.playerId;
            if (owner === undefined) return; // CR 608.2b — zone owner unknown
            // Snapshot BEFORE the move (issue #680) — a later `ref` reads the
            // reanimated card's mana value even after it changes zone/id
            // context (Reanimate: "lose life equal to that card's mana
            // value", CR 608.2h last-known information).
            if (op.bind) bindSnapshot(ctx, op.bind, target);
            if (op.to === "battlefield") {
                // Reanimation (CR 400.7 — graveyard → battlefield). `owner`
                // stays the source pile's owner (CR 800.4a); the new
                // controller defaults to that owner (Resurrection, Hell's
                // Caretaker) but an explicit `op.controller` (issue #680)
                // redirects it — Reanimate / Hymn of Rebirth's "under your
                // control".
                const controllerId = op.controller
                    ? resolvePlayerRef(ctx, op.controller)
                    : undefined;
                if (op.controller && controllerId === undefined) return;
                ctx.returnToBattlefield(
                    owner,
                    target.id,
                    "graveyard",
                    controllerId
                );
                return;
            }
            // A plain graveyard → hand/library/exile/graveyard move by id
            // (Raise Dead, Grave Robbers). `battlefield` was handled above, so
            // the destination here is a MovableZone.
            ctx.moveCardById(owner, target.id, "graveyard", op.to);
        }
    },
    // CR 613.4c (issue #840) — a temporary P/T modification expiring at a phase
    // boundary (layer 7c). A thin declarative skin over `addTemporaryPTBuff`,
    // ONE execution path (ADR 0045). `power`/`toughness` are SIGNED (a negative
    // is a shrink — Weakness; a zero is a one-sided pump — +1/+0), so unlike
    // the damage/draw amounts this executor does NOT skip on a non-positive
    // value. Skipped only when the target is gone (CR 608.2b — the target left
    // the battlefield; `resolveObjectRef` returns undefined) or a `ref`/`count`
    // value cannot be resolved (its binding was never captured).
    pump(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        const power = resolveValue(ctx, op.power);
        const toughness = resolveValue(ctx, op.toughness);
        if (power === undefined || toughness === undefined) return;
        ctx.addTemporaryPTBuff(target, power, toughness, op.duration);
    },
    // CR 122 (issue #841) — put or remove counters on a permanent. A thin
    // declarative skin over `addCounter` / `removeCounter`, ONE execution path
    // (ADR 0045). Skipped when the target is gone (CR 608.2b — the permanent
    // left the battlefield; `resolveObjectRef` returns undefined) or a
    // `ref`/`count` value cannot be resolved (its binding was never captured).
    // The primitives themselves no-op a non-positive count and clamp a remove
    // to the counters present (CR 122.6).
    counters(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        const count = resolveValue(ctx, op.count);
        if (count === undefined) return;
        if (op.action === "add") {
            ctx.addCounter(target, op.counter, count);
        } else {
            ctx.removeCounter(target, op.counter, count);
        }
    },
    // CR 701.26 (issue #842) — tap or untap a permanent. A thin declarative
    // skin over `tap` / `untap`, ONE execution path (ADR 0045). Skipped when
    // the target is gone (CR 608.2b — the permanent left the battlefield;
    // `resolveObjectRef` returns undefined). The primitives themselves no-op
    // when the permanent is already in the requested state (CR 701.26a/b).
    // CR 611.1b / 613.1f (issue #843) — grant a keyword static ability to a
    // permanent for a limited duration (layer 6). A thin declarative skin over
    // `grantStaticAbility`, ONE execution path (ADR 0045). Skipped when the
    // target is gone (CR 608.2b — the permanent left the battlefield;
    // `resolveObjectRef` returns undefined). The primitive appends the keyword
    // to the target's `staticAbilities` so combat / rules checks see it at read
    // time; the phase-boundary purge splices it back out on expiry.
    grantAbility(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        // Keyword static grant (Berserk's trample) OR a duration-scoped
        // activated-ability grant whose template lives on the resolving
        // source's `grantTemplates[]` (issue #738, Touch of Vitae). One field
        // is set per Op (enforced by `validate`); a card may emit both as two
        // separate `grantAbility` Ops (Touch of Vitae grants haste + the {0}
        // untap ability).
        if (op.ability) {
            ctx.grantStaticAbility(target, op.ability, op.duration);
        }
        if (op.grantedActivatedId) {
            ctx.grantActivatedAbility(
                target,
                ctx.sourceCardId,
                op.grantedActivatedId,
                op.duration
            );
        }
    },
    // CR 701.20 (issue #844) — shuffle a player's library. A thin declarative
    // skin over `shuffleLibrary`, ONE execution path (ADR 0045): the seeded
    // PRNG reorder that also clears persistent knowledge (ADR 0026). Skipped
    // when the referenced player is gone (CR 608.2b — `resolvePlayerRef`
    // returns undefined).
    libraryLook(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        // `action` is "shuffle" — the only folded library primitive (issue
        // #844; peek/reorder are the `scryReorder` Op below, issue #885).
        ctx.shuffleLibrary(playerId);
    },
    // CR 608.2 / 701.24 (issue #898) — the resolving spell shuffles ITSELF
    // into its owner's library instead of the graveyard ("Shuffle ~ into its
    // owner's library", Green Sun's Zenith). A thin declarative skin over the
    // single SpellContext primitive `shuffleSelfIntoLibrary`, ONE execution
    // path (ADR 0045). No parameters to resolve — the primitive flags the
    // CURRENTLY-RESOLVING stack item (mirrors `exileSelf`'s design), so
    // `finalizeSpellResolution` reads the flag once resolution completes.
    shuffleSelfIntoLibrary(ctx) {
        ctx.shuffleSelfIntoLibrary();
    },
    // CR 401.4 look / CR 701.22 Scry / 701.44 Surveil / order-only (issue
    // #885) — look at / reorder the top of a library. A thin declarative skin
    // over the single SpellContext primitive `orderTop`, ONE execution path
    // (ADR 0045). SUSPENDS like `choice`/`mayPay`: `orderTop` returns `false`
    // while the `order-top` PendingChoice is pending (the Op then reports
    // "suspend" so the engine leaves the item on the stack, checkpointed at
    // this Op's position), and `true` once the chooser's ordering has been
    // applied (the un-kept cards to `destination`, the kept cards back on top).
    // Skipped when the player is gone or `count` ≤ 0 (CR 608.2b); `orderTop`
    // itself no-ops on an empty library.
    scryReorder(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const count = resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        const applied = ctx.orderTop(playerId, count, {
            destination: op.destination,
            prompt: op.prompt,
        });
        if (!applied) return "suspend"; // enqueued the order-top choice — wait
    },
    // CR 701.17 (issue #885) — mill: move the top `count` cards of a player's
    // library into their graveyard. A thin declarative skin over the single
    // `millCards` SpellContext primitive (issue #1055), ONE execution path
    // (ADR 0045): `millCards` re-reads the LIVE top id each pass so successive
    // mills chase the receding library top, stops early once it empties (CR
    // 701.17a), AND emits a CARD_MILLED event per card so "when this card is put
    // into your graveyard from your library" self-triggers fire (Gaea's
    // Blessing) — the mill analogue of `drawCards`. Deterministic — no choice,
    // no suspension. Skipped when the player is gone or `count` ≤ 0 (CR 608.2b).
    mill(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const count = resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        ctx.millCards(playerId, count);
    },
    // CR 401.4 (issue #984) — dig to hand: look at the top `look` cards, put
    // `take` (default 1) into hand, the rest on the BOTTOM. A thin declarative
    // skin composed of existing primitives (the Stock Up composition
    // generalized), ONE execution path (ADR 0045). SUSPENDS like `choice` /
    // `scryReorder`: a single `look-distribute` `requestChoice` over exactly the
    // looked-at ids (candidateIds — projected face-up as `libraryPeek`, never
    // the whole hidden library) drives the unified HAND/BOTTOM pick; the first
    // execution enqueues it and reports "suspend", the resumed execution reads
    // the two ordered lists back and finishes the moves. The kept cards move
    // library→hand (`moveCardById`); the un-kept looked-at cards are bottomed
    // (`reorderLibraryTop`) in the player's CHOSEN order (CR 401.4 "in any
    // order") and marked known to the controller (ADR 0026 — you looked at and
    // PLACED them, so their bottom position is certain until a shuffle; the
    // projection exposes them as the contiguous known run from the bottom). The
    // count is EXACTLY `keep` to hand ({min,max}=keep), so the two lists always
    // partition the looked-at set. Skipped when the player is gone, `look` ≤ 0,
    // or the library is empty (CR 608.2b — never suspends then).
    digToHand(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const look = resolveValue(ctx, op.look);
        if (look === undefined || look <= 0) return;
        const topIds = ctx.peekLibraryTop(playerId, look);
        if (topIds.length === 0) return; // empty library — no look, no suspend
        const take = op.take === undefined ? 1 : resolveValue(ctx, op.take);
        if (take === undefined || take <= 0) return;
        const keep = Math.min(take, topIds.length);
        const picks = ctx.requestChoice({
            playerId,
            // A fixed choiceId is unique per Op position: the pipeline keys on
            // `step:choiceId` and `step` IS this Op's checkpointed position, so
            // two digToHand Ops at different positions never collide.
            choiceId: "dig-to-hand",
            kind: "look-distribute",
            zone: "library",
            candidateIds: topIds,
            // Exactly `keep` cards go to hand; the picker partitions the rest to
            // the ordered bottom (submit validates the partition).
            count: { min: keep, max: keep },
            destination: "library-bottom",
            prompt:
                op.prompt ??
                "Choose which card(s) to put into your hand, then order the rest on the bottom of your library.",
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        // Resume — the kept cards go to hand; the remaining looked-at cards are
        // bottomed in the player's chosen order. A picked id that has since left
        // the library is a no-op in `moveCardById` (CR 608.2b).
        for (const id of picks)
            ctx.moveCardById(playerId, id, "library", "hand");
        const pickSet = new Set(picks);
        // The player's chosen bottom order (from the unified picker). Falls back
        // to look order for an auto/bot path that submitted only the hand picks.
        const chosenBottom = ctx.readOrderedSecond("dig-to-hand");
        const restTop =
            chosenBottom.length > 0
                ? chosenBottom
                : topIds.filter((id) => !pickSet.has(id));
        if (restTop.length === 0) return;
        // Everything currently in the library minus the un-kept looked-at cards,
        // then the un-kept cards appended in the chosen order — a full reorder
        // that lands the rest on the true bottom (CR 401.4).
        const all = ctx.peekLibraryTop(playerId, Number.MAX_SAFE_INTEGER);
        const restSet = new Set(restTop);
        const below = all.filter((id) => !restSet.has(id));
        ctx.reorderLibraryTop(playerId, [...below, ...restTop]);
        // ADR 0026 — the bottomed cards were looked at and placed by the
        // controller, so they stay known (face-up in the bottom-of-library
        // view) until a shuffle clears the certainty.
        ctx.markKnown(playerId, restTop, playerId);
    },
    // CR 401.4 (issue #1046) — put N hand cards on top of the library, in the
    // player's chosen order. A thin declarative skin over the single
    // SpellContext primitive `moveHandCardToLibraryTop`, ONE execution path
    // (ADR 0045). SUSPENDS like `choice` / `scryReorder` / `digToHand`: the
    // first execution raises a `choose-hand-card` PendingChoice over the
    // resolved player's whole hand and reports "suspend" — `runOpList`
    // checkpoints THIS Op's own pre-order position BEFORE calling it, so an
    // earlier Op in the same script (e.g. `draw`) is skipped on resume (CR
    // 608.3, the bug the old Brainstorm `resolveSteps` split fixed by hand).
    // The resumed execution reads the ordered picks back and moves each to
    // the top via `moveHandCardToLibraryTop`, which unshifts — so the LAST
    // picked card ends up literally on top, meaning the player's pick order
    // IS the resulting top-of-library order (CR 401 "in any order"). Skipped
    // when the player is gone, `count` ≤ 0, or the hand is empty (CR
    // 608.2b — never suspends then); `count` clamps to hand size.
    putBack(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const count = resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        const handSize = ctx.getHandIds(playerId).length;
        const clamped = Math.min(count, handSize);
        if (clamped <= 0) return; // empty hand — nothing to put back
        const picks = ctx.requestChoice({
            playerId,
            // A fixed choiceId is unique per Op position: the pipeline keys
            // on `step:choiceId` and `step` IS this Op's checkpointed
            // position, mirroring `scryReorder`'s "order-top" / `digToHand`'s
            // "dig-to-hand" fixed ids.
            choiceId: "put-back",
            kind: "choose-hand-card",
            zone: "hand",
            count: clamped,
            // Client-routing hint (UI only): mount the ordered HAND→TOP drag
            // picker. The ordered picks ARE the resulting top order (last =
            // topmost), applied below via `moveHandCardToLibraryTop`.
            putOnTop: true,
            prompt:
                op.prompt ??
                `Choose ${clamped} card(s) to put on top of your library (last picked ends up on top).`,
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        // Resume — move each pick to the top; the LAST pick lands on top
        // last (unshift), so the player's chosen order IS the resulting
        // top-of-library order.
        // ADR 0026 — the owner keeps knowing each put-back card on top
        // (private — no reveal clause here); knowledge is granted inside the
        // primitive itself so every hand→library-top site shares it.
        for (const id of picks) ctx.moveHandCardToLibraryTop(playerId, id);
    },
    // CR 615 (issue #845) — establish a damage-prevention shield. A thin
    // declarative skin over three SpellContext prevention primitives, ONE
    // execution path per mode (ADR 0045). Each mode is skipped when its
    // referenced permanent / player is gone (CR 608.2b — the resolver returns
    // undefined); the `next-n` primitive additionally no-ops on amount ≤ 0.
    preventDamage(ctx, op) {
        if (op.mode === "all-combat") {
            // CR 615, Fog — prevent all combat damage for the rest of the turn
            // (global, cleared at CLEANUP; no target, no duration).
            ctx.preventAllCombatDamage();
            return;
        }
        if (op.mode === "combat-to-and-by") {
            // CR 615, Maze of Ith / Ebony Horse — per-instance two-way combat
            // prevention shield.
            const target = resolveObjectRef(ctx, op.target);
            if (!target) return;
            ctx.preventAllCombatDamageToAndBy(target, op.duration);
            return;
        }
        // "next-n" (CR 615.1) — a prevent-the-next-N shield on a permanent or a
        // relative player. `to` mirrors dealDamage's recipient union.
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined) return;
        if ("player" in op.to) {
            const playerId = resolvePlayerRef(ctx, op.to.player);
            if (playerId === undefined) return;
            ctx.preventNextNDamageToTarget(
                { type: "player", id: playerId },
                amount,
                op.duration
            );
            return;
        }
        const target = resolveObjectRef(ctx, op.to);
        if (!target) return;
        ctx.preventNextNDamageToTarget(target, amount, op.duration);
    },
    // CR 701.15 (issue #846) — stack a regeneration shield on a permanent. A
    // thin declarative skin over the single SpellContext primitive
    // `applyRegenerationShield`, ONE execution path (ADR 0045). Skipped when the
    // referenced permanent is gone (CR 608.2b — `resolveObjectRef` returns
    // undefined); the primitive itself also no-ops on a non-permanent selection
    // and off the battlefield.
    regenerate(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.applyRegenerationShield(target);
    },
    // CR 111 / 701.7 (issue #847) — create token permanents. A thin declarative
    // skin over the single SpellContext primitive `createToken`, ONE execution
    // path (ADR 0045): the JSON-pure `token` spec is passed verbatim, the tokens
    // enter under the resolved `controller`. Skipped when the controller cannot
    // be resolved (CR 608.2b — `resolvePlayerRef` returns undefined) or the
    // count is a `ref`/`count` whose binding was never captured; a non-positive
    // count creates nothing (CR 707.1 — "create N tokens" with N ≤ 0 is a
    // no-op). No `createdBy` provenance is stamped — provenance links
    // (Tetravus / Tawnos's Wand) are multi-Op choice-scoped cards that stay
    // resolve() this wave.
    createToken(ctx, op) {
        const controllerId = resolvePlayerRef(ctx, op.controller);
        if (controllerId === undefined) return;
        const count = op.count === undefined ? 1 : resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        ctx.createToken(op.token, controllerId, count);
    },
    // CR 114 (issue #1221) — create a command-zone emblem owned by the resolved
    // controller (default the ability's controller). The granted abilities live
    // in the emblem registry, keyed by `op.emblem`; `SpellContext.createEmblem`
    // appends the pure-data instance to `GameState.emblems`.
    emblem(ctx, op) {
        const ownerId = resolvePlayerRef(ctx, op.controller ?? "controller");
        if (ownerId === undefined) return;
        ctx.createEmblem(op.emblem, ownerId);
    },
    // CR 613.1b (issue #848) — change control of a permanent (layer 2). A thin
    // declarative skin over the single SpellContext primitive `gainControl`,
    // ONE execution path (ADR 0045): the resolved `target` permanent moves to
    // the resolved new `controller`; `duration` maps to the `ControlChangeCondition`
    // the conditional-control SBA reverts (omitted = an indefinite reassignment).
    // Skipped when the target is gone / not a permanent (CR 608.2b —
    // `resolveObjectRef` returns undefined) or the controller cannot be resolved
    // (`resolvePlayerRef` returns undefined); the primitive itself also no-ops
    // when the target left the battlefield or is already under that controller.
    gainControl(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        const controllerId = resolvePlayerRef(ctx, op.controller);
        if (controllerId === undefined) return;
        ctx.gainControl(
            target,
            controllerId,
            gainControlCondition(op.duration, controllerId)
        );
    },
    tapUntap(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (op.action === "tap") {
            ctx.tap(target);
        } else {
            ctx.untap(target);
        }
    },
    // CR 701.20a (issue #920, #682) — reveal `player`'s hand to every player.
    // A thin adapter over `SpellContext.markKnownToAll` (ADR 0026): stamps
    // every current hand card with every player in `knownTo` so the wire
    // projection shows the real cards instead of nulling the slot. No target
    // resolution beyond `player`; not a choice, no binding.
    reveal(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        // issue #945 — the tutor "search …, reveal it, put it into your hand"
        // clause (CR 701.20): reveal the SPECIFIC card(s) a preceding
        // search-library `choice` bound, not the whole hand. `markKnownToAll`
        // takes arbitrary instance ids and scans library+hand, so stamping the
        // picked card while it is still in the library (before the moveZone)
        // makes it known to everyone; the knowledge rides the move into hand
        // and survives the trailing shuffle (which only clears knowledge of
        // cards still in the library). Nothing found ⇒ binding never captured
        // ⇒ no-op (CR 608.2b).
        if ("cards" in op) {
            const ids = resolvePicks(ctx, op.cards);
            if (!ids || ids.length === 0) return;
            ctx.markKnownToAll(playerId, ids);
            return;
        }
        const ids = ctx.getHandIds(playerId);
        if (ids.length === 0) return; // CR 608.2b — nothing to reveal
        ctx.markKnownToAll(playerId, ids);
    },
    // CR 608.2 / 101.4 (issue #805) — mid-resolution player choice through
    // the existing Pending Choice pipeline. First execution enqueues the
    // choice and SUSPENDS the script; the resumed execution (after the
    // generic `submitResolutionChoice` commit) reads the picks back — they
    // are stored under this Op's binding name, which IS the picks binding.
    choice(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — chooser gone, skip
        // issue #920 — the zone owner defaults to the chooser (every
        // pre-existing `choice` Op card), but a Thoughtseize/Duress-class
        // script names a DIFFERENT owner ("target player reveals their hand,
        // you choose a card from it"). Unresolvable owner skips like any
        // other missing player-ref target (CR 608.2b).
        const zoneOwnerId =
            op.zoneOwnerId === undefined
                ? playerId
                : resolvePlayerRef(ctx, op.zoneOwnerId);
        if (zoneOwnerId === undefined) return;
        const { available, candidateIds } = choiceCandidates(
            ctx,
            op,
            zoneOwnerId
        );
        // CR 608.2b / 701.9b — clamp to what exists; nothing to choose from
        // means no choice at all (and no binding, so consumers skip too).
        // A plain number is an EXACT count; a `{ min, max }` range (issue
        // #677 — "you may…", "up to N…") clamps its max down to what's
        // available and floors its min at that same clamped max (so a
        // 0-available "you may" never asks for more than exists).
        let count: number | { min: number; max: number };
        if (typeof op.count === "number") {
            count = Math.min(op.count, available);
            if (count <= 0) return;
        } else {
            const max = Math.min(op.count.max, available);
            if (max <= 0) return;
            count = { min: Math.min(op.count.min, max), max };
        }
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
            ...(op.zoneOwnerId !== undefined ? { zoneOwnerId } : {}),
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
    // can). The consequence half of the counter/punisher pattern. `destination`
    // (issue #683) redirects a COUNTERED SPELL to exile/library-top/hand
    // instead of the CR 701.5a graveyard default (No More Lies, Memory Lapse,
    // Remand).
    counter(ctx, op) {
        const target = resolveTargetRef(ctx, op.target);
        if (target && target.type === "spell")
            ctx.counter(target, op.destination);
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
    // optionChoice — the modal "choose one" Op (CR 700.2 / 601.2b, issue #849).
    // A thin declarative skin over the single SpellContext primitive
    // `requestOptionChoice`, ONE execution path (ADR 0045). Like `if`/`forEach`
    // it is a structural construct that always re-descends on a re-walk (it is
    // in the `runOpList` skip-exception), because a suspending Op INSIDE the
    // chosen mode must resume through it. Two phases:
    //   1. no mode recorded yet → enqueue the `option-pick` Pending Choice and
    //      SUSPEND (the chooser picks a mode index);
    //   2. mode recorded → read the picked index back and run that mode's body
    //      through the SAME `runOpList` path an `if` branch uses (with the shared
    //      cursor, so a nested `choice`/`mayPay` suspension resumes at its exact
    //      position — CR 608.3).
    // The choice is keyed under this Op's pre-order position (the checkpoint set
    // by `runOpList` right before dispatch IS `resolutionStep`, which
    // `requestOptionChoice` folds into its key), so a constant `choiceId` is
    // unique per Op and stable across replays. A SINGLE-mode Op auto-resolves —
    // it runs the one mode with no prompt (no real choice, Arena-style; CR
    // 700.2 requires at least one mode). Skipped when the chooser is gone (CR
    // 608.2b — `resolvePlayerRef` returns undefined).
    optionChoice(ctx, op, cursor) {
        const playerId = resolvePlayerRef(ctx, op.player ?? "controller");
        if (playerId === undefined) return; // CR 608.2b — chooser gone, skip
        // Each mode's option id is its explicit `id` (a semantic id like "tap")
        // or, when omitted, its position as a string. The chosen id is matched
        // back to the mode by the SAME rule, so a migrated card can preserve
        // the exact option ids its (untouched) per-card test submits.
        const optionId = (mode: EffectMode, i: number): string =>
            mode.id ?? String(i);
        // Auto-resolve the degenerate one-mode case (CR 700.2): a "choose one"
        // with a single option is no decision at all — run it directly.
        const chosen =
            op.modes.length <= 1
                ? optionId(op.modes[0], 0)
                : ctx.requestOptionChoice({
                      playerId,
                      // Fixed choiceId — `requestOptionChoice` folds this Op's
                      // checkpointed position (resolutionStep) into the stored
                      // key, so it is unique per optionChoice Op.
                      choiceId: OPTION_CHOICE_ID,
                      options: op.modes.map((mode, i) => ({
                          id: optionId(mode, i),
                          label: mode.label,
                      })),
                      prompt: op.prompt,
                  });
        if (chosen === undefined) return "suspend"; // enqueued — wait
        const mode = op.modes.find((m, i) => optionId(m, i) === chosen);
        if (!mode) return; // defensive — a stored id matching no mode
        return runOpList(ctx, mode.effects, cursor);
    },
    // coinFlip — flip a coin, then run the win / loss branch (CR 705, issue
    // #851). A thin declarative skin over the single SpellContext primitive
    // `requestCoinFlip` (the suspending reveal flip, ADR 0023), ONE execution
    // path (ADR 0045). Like `optionChoice` it is a structural construct that
    // always re-descends on a re-walk (it is in the `runOpList` skip-exception),
    // because a suspending Op INSIDE the taken branch must resume through it.
    // Two phases:
    //   1. no bit drawn yet → `requestCoinFlip` draws it ONCE from the seeded
    //      PRNG, enqueues the `random-reveal` Pending Choice and SUSPENDS (the
    //      caller returns undefined);
    //   2. bit persisted → the same call reads it back (no re-roll, CR 608.3)
    //      and returns the boolean; the interpreter runs the matching branch's
    //      `effects` through the SAME `runOpList` path an `if` branch uses (with
    //      the shared cursor, so a nested `choice` / `mayPay` suspension resumes
    //      at its exact position).
    // The flip is keyed under this Op's pre-order position (the checkpoint set by
    // `runOpList` right before dispatch IS `resolutionStep`, which
    // `requestCoinFlip` folds into its `${step}:${choiceId}` key), so a constant
    // `choiceId` is unique per coinFlip Op and stable across replays. `player`
    // defaults to the resolving controller (CR 705.1). Skipped when the flipper
    // is gone (CR 608.2b — `resolvePlayerRef` returns undefined).
    coinFlip(ctx, op, cursor) {
        const playerId = resolvePlayerRef(ctx, op.player ?? "controller");
        if (playerId === undefined) return; // CR 608.2b — flipper gone, skip
        const won = ctx.requestCoinFlip({
            playerId,
            choiceId: COIN_FLIP_ID,
            heads: { consequence: op.win.consequence },
            tails: { consequence: op.loss.consequence },
        });
        if (won === undefined) return "suspend"; // enqueued reveal — wait
        const branch = won ? op.win.effects : op.loss.effects;
        return runOpList(ctx, branch, cursor);
    },
    // CR 701.16 (issue #807) — sacrifice the permanents a `choice` Op picked.
    // Routes through `SpellContext.sacrifice`: the controller puts each pick
    // into its owner's graveyard; indestructible does not prevent sacrifice
    // (CR 701.16a) and dies-triggers fire as for imperative cards. A pick
    // already gone from the battlefield is a no-op inside the primitive.
    sacrifice(ctx, op) {
        // Single-object form (CR 701.16 — "sacrifice that/this creature",
        // Kjeldoran Elite Guard, Phantasmal Mount): resolve one announced
        // target / snapshot-bound permanent through the object-ref path, which
        // re-checks battlefield presence (CR 608.2b — a permanent already gone
        // is skipped here, before the primitive).
        if (op.target !== undefined) {
            const target = resolveObjectRef(ctx, op.target);
            if (!target) return;
            ctx.sacrifice(target.id);
            return;
        }
        // Picks form (CR 701.16 — the "each player sacrifices …" forEach
        // pattern): sacrifice every permanent a `choice` Op picked.
        if (op.permanents === undefined) return;
        const ids = resolvePicks(ctx, op.permanents);
        if (!ids) return; // binding never captured — CR 608.2b, skip
        for (const id of ids) ctx.sacrifice(id);
    },
    // CR 603.7 (ADR 0048) — grant a delayed triggered ability. Resolve each
    // `capture` value to ONE serializable string NOW (scheduling time),
    // persist it with the inline body on the DelayedTriggerInstance, and let
    // `runDelayedTriggerBody` re-bind the payload as the body's initial
    // binding environment when the trigger fires. A thin skin over
    // `SpellContext.scheduleDelayedTrigger` (one execution path, ADR 0045).
    delayedTrigger(ctx, op) {
        const payload: Record<string, string | string[]> = {};
        for (const [name, source] of Object.entries(op.capture ?? {})) {
            // Persisted payload keys must NOT start with '$': Convex reserves
            // that sigil for object field names and rejects the whole DB write
            // ("Field name $guard starts with a '$', which is reserved"). A
            // binding name is validated `$`-prefixed (isBindingName), so strip
            // the sigil on store; `runDelayedTriggerBody` re-adds it when it
            // re-binds the payload at fire time.
            const key = name.slice(1);
            // LIST-valued capture (ADR 0049, issue #866): resolve N ids at
            // scheduling (cast) time and freeze them into the payload as a
            // `string[]` list binding. An empty list stays OUT of the payload
            // (like an unresolvable scalar) — the body's forEach then iterates
            // nothing (CR 608.2b), same as a captured-but-since-emptied list.
            if (typeof source === "object" && "select" in source) {
                const list = resolveCaptureListSource(ctx, source.select);
                if (list.length > 0) payload[key] = list;
                continue;
            }
            const value = resolveCaptureSource(ctx, source);
            // An unresolvable capture (target slot gone, binding never made)
            // stays OUT of the payload: the body binding is uncaptured and
            // Ops reading it skip at fire time (CR 608.2b).
            if (value !== undefined) payload[key] = value;
        }
        const targetPlayerId =
            op.targetPlayer !== undefined
                ? resolvePlayerRef(ctx, op.targetPlayer)
                : undefined;
        // A player-scoped timing (next-draw-step / next-main-phase, CR
        // 504/505) whose player cannot be resolved would never fire correctly
        // scoped — skip scheduling entirely (CR 608.2b).
        if (op.targetPlayer !== undefined && targetPlayerId === undefined) {
            return;
        }
        // Instance leave-watch (CR 603.7a / 603.10, issue #731): resolve the
        // watched permanent to an id NOW (scheduling time — it is still on the
        // battlefield). A watch that cannot be resolved (the object already
        // left) would never fire — skip scheduling entirely (CR 608.2b).
        let watchInstanceId: string | undefined;
        if (op.timing === "leaves-battlefield") {
            const watched =
                op.watch !== undefined
                    ? resolveObjectRef(ctx, op.watch)
                    : undefined;
            if (!watched) return;
            watchInstanceId = watched.id;
        }
        ctx.scheduleDelayedTrigger(
            ctx.sourceCardId,
            INLINE_DELAYED_TRIGGER_ID,
            op.timing,
            payload,
            targetPlayerId,
            { oracleText: op.oracleText, effects: op.effects },
            watchInstanceId
        );
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
    // CR 104.2a — an alternate win condition set by a resolving spell/ability
    // (issue #1066, Coalition Victory). A thin declarative skin over
    // `SpellContext.winGame`, ONE execution path (ADR 0045): sets
    // `state.gameOver` through the SAME seam State-Based Actions use, so a
    // later SBA sweep sees the game already decided and short-circuits.
    // Skipped when the player cannot be resolved (CR 608.2b); `winGame`'s own
    // guard is a no-op if the game already ended.
    winGame(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.winGame(playerId);
    },
    // CR-generic "separate into two piles, another player chooses one" cycle
    // (ADR 0053, pile division, issue #1067). Two sequential suspend points
    // within ONE Op execution — mirrors the multi-`requestChoice`-in-a-loop
    // pattern `resolve()` cards already use (Camouflage's per-pile picks) but
    // as a reusable declarative Op: step 1 (`divide-piles`) reuses the
    // existing zone-pick `requestChoice` shape for the divider's partition
    // (the submission is pile A; the object-set remainder is pile B); step 2
    // (`pick-pile`) is `requestPickPile` for the chooser over the completed
    // piles. Once both resolve, `chosenBind`/`otherBind` are bound to the two
    // pile id lists (a LIST binding, ADR 0049's family) and `chosenEffect` /
    // `otherEffect` run in sequence through the SAME shared cursor, so a
    // (currently unused) suspending Op inside either would resume correctly.
    divideIntoPiles(ctx, op, cursor) {
        const dividerId = resolvePlayerRef(ctx, op.divider);
        if (dividerId === undefined) return;
        const chooserId = resolvePlayerRef(ctx, op.chooser);
        if (chooserId === undefined) return;
        const resolved = resolvePileObjectSet(ctx, op.objects);
        if (!resolved) return;
        const { ids, zone, zoneOwnerId, filter } = resolved;
        if (ids.length === 0) return; // CR 608.2b — nothing to divide.

        const pileA = ctx.requestChoice({
            playerId: dividerId,
            choiceId: `${op.chosenBind}:divide`,
            kind: "divide-piles",
            zone,
            zoneOwnerId,
            ...(filter ? { filter } : {}),
            candidateIds: ids,
            count: { min: 0, max: ids.length },
            prompt: op.dividePrompt,
        });
        if (pileA === undefined) return "suspend"; // enqueued — wait

        const pileASet = new Set(pileA);
        const pileB = ids.filter((id) => !pileASet.has(id));

        const picked = ctx.requestPickPile({
            playerId: chooserId,
            choiceId: `${op.chosenBind}:pick`,
            pileA,
            pileB,
            prompt: op.pickPrompt,
        });
        if (picked === undefined) return "suspend"; // enqueued — wait

        const chosenIds = picked === "A" ? pileA : pileB;
        const otherIds = picked === "A" ? pileB : pileA;
        ctx.noteChoice(op.chosenBind, chosenIds);
        ctx.noteChoice(op.otherBind, otherIds);

        const chosenOutcome = runOpList(ctx, op.chosenEffect, cursor);
        if (chosenOutcome === "suspend") return "suspend";
        return runOpList(ctx, op.otherEffect, cursor);
    },
    // CR 508.1a / 509.1b (ADR 0053, pile division) — grant a turn-scoped
    // "can't attack" / "can't block" restriction. A thin declarative skin
    // over `SpellContext.setCantAttackThisTurn` / `setCantBlockThisTurn`, one
    // execution path (ADR 0045). Skipped when the referenced permanent is
    // gone (CR 608.2b — the effect does as much as it can).
    restrictCombat(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (op.restriction === "cant-attack") {
            ctx.setCantAttackThisTurn(target);
        } else {
            ctx.setCantBlockThisTurn(target);
        }
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
        // `if` / `forEach` (issue #807), `optionChoice` (issue #849) and
        // `coinFlip` (issue #851) are the exceptions: they must still run so
        // they re-descend / re-iterate / re-branch into the same nested Ops,
        // keeping the pre-order positions aligned across the re-walk (their own
        // leaf Ops are then skipped individually by this same position check) —
        // a suspending Op inside a branch resumes through them.
        if (
            myPos < cursor.resume &&
            op.op !== "if" &&
            op.op !== "forEach" &&
            op.op !== "optionChoice" &&
            op.op !== "coinFlip" &&
            // ADR 0053 (pile division) — `divideIntoPiles` runs a NESTED Op
            // list (`chosenEffect`/`otherEffect`) through this same shared
            // cursor after its own two-step choice resolves; if a body Op
            // inside either list ever suspends, the resume position lands
            // INSIDE that nested body (greater than this Op's own position),
            // so `divideIntoPiles` itself must still re-run to re-descend —
            // exactly like `forEach` re-iterating its body on resume.
            op.op !== "divideIntoPiles"
        ) {
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
    // `bound` (ADR 0049, issue #866): iterate a frozen `string[]` LIST binding
    // (a delayedTrigger list-valued capture, e.g. `$partners`) in stored order.
    // The member ids are read straight off the binding; each is snapshotted at
    // iteration entry by `execForEach`, so a member that has left is skipped
    // there (CR 608.2b). Absent binding (empty capture) → iterate nothing.
    if (select.set === "bound") return readBinding(ctx, select.ref) ?? [];
    let owners: string[];
    if (select.controller !== undefined) {
        const pid = resolvePlayerRef(ctx, select.controller);
        owners = pid === undefined ? [] : [pid];
    } else {
        owners = [...ctx.apNapOrder()];
    }
    // A bulk graveyard-set sweep (issue #1056, CR 404): gather every matching
    // card in the selected graveyard(s), owners in APNAP order. Filtered by the
    // shared card-filter matcher (mirrors `countSet`'s graveyard branch); an
    // absent filter imposes no constraint. Each id binds as a graveyard-card
    // `$each` in `execForEach` (Replenish's "return all enchantment cards";
    // Living Death iterates every player's graveyard).
    if (select.set === "graveyard") {
        return owners.flatMap((pid) => {
            const cards = ctx.getGraveyardCards(pid);
            const filtered = select.filter
                ? cards.filter((c) => matchesCardFilter(ctx, c, select.filter!))
                : cards;
            return filtered.map((c) => c.id);
        });
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

    // Simultaneous batch reanimation (CR 400.7 / 614-batch, issue #1094):
    // bypass the per-member `runOpList` walk entirely. The validator
    // guarantees `select.set === "graveyard"` and a single reanimating
    // `moveZone` body when `simultaneous` is set, so the WHOLE frozen member
    // set moves through `returnGraveyardSetToBattlefield` in one call — every
    // reanimated permanent stages onto the battlefield before ANY of them
    // runs its grant/ETB pass (no partial-sibling visibility). Never
    // suspends, but is NOT naturally idempotent (unlike the per-member path,
    // whose individual body Ops are each checkpoint-gated by `runOpList`), so
    // the result is persisted under its own key — `forEach` is a "structural
    // construct" that always re-descends on a re-walk (a LATER Op suspending
    // elsewhere in the script), and without this guard a resume would
    // re-run the batch move a second time.
    if (op.select.set === "graveyard" && op.simultaneous) {
        const resultKey = `#forEach:${pos}:simultaneousResult`;
        if (ctx.recallChoice(resultKey) === undefined) {
            const body = op.effects[0] as { controller?: EffectPlayerRef };
            // Mirrors the per-member `moveZone` path: an explicit `controller`
            // override that fails to resolve skips the WHOLE batch (CR
            // 608.2b), rather than silently falling back to owner control.
            let controllerId: string | undefined;
            let controllerUnresolvable = false;
            if (body.controller) {
                controllerId = resolvePlayerRef(ctx, body.controller);
                controllerUnresolvable = controllerId === undefined;
            }
            const entries: { playerId: string; cardInstanceId: string }[] = [];
            if (!controllerUnresolvable) {
                for (const id of members) {
                    const owner = ctx.getGraveyardCardOwner(id);
                    // A member that already left the graveyard mid-resolution
                    // is skipped (CR 608.2b) — never reaches the primitive.
                    if (owner !== undefined) {
                        entries.push({ playerId: owner, cardInstanceId: id });
                    }
                }
            }
            const entered = controllerUnresolvable
                ? []
                : ctx.returnGraveyardSetToBattlefield(entries, controllerId);
            ctx.noteChoice(resultKey, entered);
        }
        return undefined;
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
            } else if (op.select.set === "graveyard") {
                // Graveyard-set member (issue #1056): bind `$each` as a
                // graveyard-card snapshot BEFORE the body acts on it (CR 608.2h
                // — so a later ref reads last-known information across the zone
                // change). A member that already left the graveyard resolves to
                // no owner → leave `$each` uncaptured (CR 608.2b, the body skips).
                const owner = ctx.getGraveyardCardOwner(members[k]);
                if (owner !== undefined) {
                    bindSnapshot(ctx, eachId, {
                        type: "graveyard-card",
                        id: members[k],
                        playerId: owner,
                    });
                }
            } else if (ctx.getOwnerId(members[k]) !== undefined) {
                // Snapshot BEFORE the body acts on the member (CR 608.2h).
                bindSnapshot(ctx, eachId, {
                    type: "permanent",
                    id: members[k],
                });
            }
            // else: the frozen-set member already left its zone — leave `$each`
            // uncaptured; body Ops reading it skip (CR 608.2b).
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

// --- delayedTrigger Op machinery (CR 603.7, ADR 0048) ------------------------

/** The `triggerId` every inline-body DelayedTriggerInstance carries (ADR
 *  0048). Inline instances never look a template up by id — the body rides on
 *  the instance — but `triggerId` is required (and marks the fired stack item
 *  as a delayed ability everywhere `delayedTriggerId` is checked), so a
 *  reserved sentinel fills it. `$` is illegal in card-def template ids by
 *  convention, so the sentinel can never collide with a real template. */
export const INLINE_DELAYED_TRIGGER_ID = "$inline-effects";

/** Resolves one `capture` value of a `delayedTrigger` Op (ADR 0048) to the
 *  single serializable string persisted in the instance payload:
 *  - a literal string is stored as-is;
 *  - `{ target: n }` — the announced slot's object/player id;
 *  - `{ ref: "$x" }` (bare) — the bound snapshot's instance id, or a player
 *    binding's player id (the stored arrays are 4-slot snapshots vs
 *    single-element player bindings — validator-typed families);
 *  - `{ ref: "$x.controller" }` — the bound snapshot's controller.
 *  Returns undefined when the slot/binding cannot be resolved — the capture
 *  is then omitted and body Ops reading it skip at fire time (CR 608.2b). */
function resolveCaptureSource(
    ctx: SpellContext,
    source: EffectCaptureSource
): string | undefined {
    if (typeof source === "string") return source;
    if ("target" in source) return ctx.targets[source.target]?.id;
    // A `{ select }` LIST source (ADR 0049, issue #866) never reaches here — the
    // `delayedTrigger` executor routes it to `resolveCaptureListSource` — but
    // narrow it out so the remaining single-value ref shapes type-check.
    if ("select" in source) return undefined;
    // `$event.<field>` capture (ADR 0049, issue #865) — flatten the firing
    // event to its id at scheduling time; the body re-binds it fresh at fire
    // time (object → snapshot, player → player binding, per ADR 0048).
    if (isEventRef(source.ref)) return resolveEventRef(ctx, source.ref)?.id;
    const parsed = parseRef(source.ref);
    if (parsed) {
        // Property refs: only `.controller` is capturable (validator-enforced
        // — power/toughness captures have no fire-time re-binding semantics).
        if (parsed.property !== "controller") return undefined;
        return readBinding(ctx, parsed.binding)?.[SNAP_CONTROLLER];
    }
    if (!source.ref.startsWith("$")) return undefined;
    const stored = readBinding(ctx, source.ref);
    if (!stored) return undefined;
    return stored.length === 1 ? stored[PLAYER_BINDING_ID] : stored[SNAP_ID];
}

/** Resolves a `delayedTrigger` LIST-valued capture (ADR 0049, issue #866) to
 *  the frozen `string[]` of instance ids persisted in the payload, at
 *  SCHEDULING (cast) time — freeze-at-cast, not fire-time (combat state is
 *  live-only, so a fire-time scan returns empty once the target itself died).
 *
 *  v1's only set is `combatPartners of { target: n }` — the creatures that
 *  BLOCKED OR WERE BLOCKED BY the announced target this turn (CR 509.1h,
 *  bidirectional): the target's blockers (attacker → blockers direction) plus
 *  the attackers the target blocked (the inverse scan). Returns [] when the
 *  target slot is gone or the pairing is empty (the body's forEach iterates
 *  nothing, CR 608.2b). Order is deterministic (block-graph insertion order),
 *  deduped by a Set. */
function resolveCaptureListSource(
    ctx: SpellContext,
    select: EffectListSelector
): string[] {
    const targetId = ctx.targets[select.of.target]?.id;
    if (targetId === undefined) return [];
    // `combatPartners` is the only member (validator-enforced); the arm is
    // explicit so a future set joins without changing the fallback.
    if (select.set !== "combatPartners") return [];
    const blockGraph = ctx.getBlockersByAttacker();
    const partners = new Set<string>();
    // "were blocked by it": the target attacked — its blockers are partners.
    for (const id of blockGraph[targetId] ?? []) partners.add(id);
    // "blocked it": the target blocked — the attackers whose blocker list
    // contains the target are partners (CR 509.1h inverse direction).
    for (const [attackerId, blockerIds] of Object.entries(blockGraph)) {
        if (blockerIds.includes(targetId)) partners.add(attackerId);
    }
    return [...partners];
}

/** Runs a fired INLINE delayed-trigger body (CR 603.7a, ADR 0048). On a FRESH
 *  entry (no checkpoint) the persisted payload becomes the body's initial
 *  binding environment: a captured id that names a player becomes a player
 *  binding; a live battlefield permanent becomes a FRESH snapshot — the body
 *  acts on the object's CURRENT state, and destroy/exile-style Ops re-check
 *  battlefield presence through the snapshot id exactly as `$each` does;
 *  anything else stays uncaptured, so body Ops reading it skip (CR 608.2b —
 *  the object left before the trigger fired). On a RESUME (a body choice /
 *  mayPay suspended) the persisted bindings are authoritative — seeding is
 *  skipped so last-known information is not re-read (CR 603.10). */
export function runDelayedTriggerBody(
    ctx: SpellContext,
    effects: readonly EffectOp[],
    payload: Record<string, string | string[]>
): void {
    if (ctx.getScriptCheckpoint() === undefined) {
        for (const [key, value] of Object.entries(payload)) {
            // Payload keys are stored with the `$` binding sigil stripped
            // (Convex reserves a leading `$` on field names); re-add it to
            // recover the binding name. A legacy already-`$`-prefixed key is
            // tolerated so an in-flight payload keeps binding correctly.
            const name = key.startsWith("$") ? key : "$" + key;
            // LIST capture (ADR 0049, issue #866): the frozen `string[]` of ids
            // becomes a list binding a `forEach { set: "bound", ref }` iterates.
            // Stored raw (member ids only) — the forEach snapshots each member
            // afresh at iteration entry, so a member that has since left the
            // battlefield is skipped there (CR 608.2b), not here.
            if (Array.isArray(value)) {
                ctx.noteChoice(name, value);
                continue;
            }
            if (ctx.allPlayerIds.includes(value)) {
                ctx.noteChoice(name, [value]);
            } else if (ctx.getOwnerId(value) !== undefined) {
                bindSnapshot(ctx, name, { type: "permanent", id: value });
            }
        }
    }
    runEffectScript(ctx, effects);
}
