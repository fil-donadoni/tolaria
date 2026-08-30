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
    Color,
    ControlChangeCondition,
    DynamicMayPayManaCost,
    DynamicMayPayEnergyCost,
    EffectCaptureSource,
    EffectCardFilter,
    EffectComparisonOp,
    EffectMode,
    EffectCountSpec,
    EffectDifferenceOperand,
    EffectExiledWithSourceSelector,
    EffectForEachSelector,
    EffectListSelector,
    EffectObjectSelector,
    EffectOp,
    EffectPileObjectSelector,
    EffectPlayerRef,
    EffectPredicate,
    EffectScaledOperand,
    EffectSignedValue,
    EffectTargetRef,
    EffectValue,
    EffectZonePositionSelector,
    GainControlDuration,
    ManaCost,
    MayPayCost,
    PermanentFilter,
    SpellContext,
    TargetSelection,
    TokenSpec,
} from "../../cards/types";
import type { LookDistributeDestination } from "../types";
import { getEventFieldRow } from "../../cards/mechanicsRegistry";
import { resolveTokenTriggeredAbilities } from "../../cards/tokenTriggeredAbilities";
import { parseProtectionFromColor } from "../protection";
import { parseTargetNameRef } from "./targetRef";
import {
    categorizedEligibleIds,
    maxCategorizedPicks,
    minCategorizedCover,
    forcedCategorizedCover,
} from "../categorizedPick";
import { manaCostsEqual } from "../constants";

type OpOf<K extends EffectOp["op"]> = Extract<EffectOp, { op: K }>;

/** An executor's outcome: `undefined` = the Op ran (or was skipped per
 *  CR 608.2b) and the script continues; `"suspend"` = the Op enqueued a
 *  Pending Choice and the script must stop HERE — the engine leaves the item
 *  on the stack and the checkpointed Op re-runs on resume. An Op that parked a
 *  permanent on an as-enters choice (ADR 0100 D5) suspends too, but reports
 *  nothing: `runOpList` detects that one from the parked count. */
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
/** CR 205 / 110.1 (issue #1311) — "1" if the snapshotted object was a
 *  permanent card (its types included at least one permanent type) at bind
 *  time, else "0". Read via `.isPermanentCard` in a numeric ref (Lion Sash:
 *  "Exile target card from a graveyard. If it was a permanent card, put a
 *  +1/+1 counter on this permanent" — the "was" is exactly this last-known-
 *  info snapshot, mirroring SNAP_MANA_VALUE's own pre-move capture). A
 *  pre-#1311 snapshot has no slot here; the array read then yields
 *  `undefined`, `Number(undefined)` is `NaN`, and a `eq 1` comparison is
 *  false — treated as "not a permanent card", same fail-closed default every
 *  other missing-slot read uses. */
const SNAP_IS_PERMANENT_CARD = 6;
/** CR 608.2h (Minsc & Boo) — the snapshotted object's card TYPES, SUBTYPES and
 *  NAME at bind time, so a later Op can ask what the object WAS after it has
 *  left the battlefield. The graveyard is not a substitute: a sacrificed TOKEN
 *  ceases to exist as a state-based action (CR 704.5d) before a reflexive
 *  trigger ever resolves, so "if the sacrificed creature was a Hamster" MUST
 *  read last-known information — reading the graveyard silently fails for
 *  exactly the tokens these cards are built around (Boo). Stored
 *  `|`-joined (the store is `string[]`; `|` cannot appear in a type/subtype).
 *  A pre-existing snapshot has no slot here — readers see `undefined` and
 *  treat it as "no types / no subtypes / no name", the same fail-closed
 *  default every other missing-slot read uses. */
const SNAP_TYPES = 7;
const SNAP_SUBTYPES = 8;
const SNAP_NAME = 9;

/** Separator for the `|`-joined snapshot list slots. */
const SNAP_LIST_SEP = "|";

/** Reads a `|`-joined snapshot list slot back as an array (empty for a slot
 *  that predates the field, CR 608.2b fail-closed). */
function snapList(snap: string[] | undefined, slot: number): string[] {
    const raw = snap?.[slot];
    return raw ? raw.split(SNAP_LIST_SEP) : [];
}

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

/** Resolves an `EffectCardFilter.name` bare ref (issue #1085 / #1104) to a
 *  string. The referenced binding's first stored value is EITHER a `nameCard`
 *  Op's chosen NAME (issue #1085, a picks-family binding that stores the name
 *  string directly) OR a `choice` Op's chosen INSTANCE ID (issue #1104,
 *  Lobotomy's "the chosen card") — the two share the identical single-element
 *  `string[]` binding shape, distinguished only by what the earlier Op wrote.
 *  `ctx.getCardName` resolves an id to its live name by scanning every zone;
 *  a stored value that ISN'T a live instance id (the `nameCard` case — a
 *  plain name string never collides with a real id) simply misses that
 *  lookup and falls through unresolved, so the raw string is used as-is. One
 *  runtime path serves both binding shapes with no static discriminant. */
function resolveNameRef(ctx: SpellContext, ref: string): string | undefined {
    // CR 201.2 (issue #2065) — the reserved `$target<N>.name` ref: the LIVE
    // name of an announced target slot, readable with NO preceding bind
    // (Winnow's "another permanent with the same name"). `getCardName` reads
    // the instance's CURRENT definition id, which a copy effect overwrites
    // (`applyCopy`, gre/copy.ts) — so a Clone that has become a Grizzly Bears
    // is named Grizzly Bears here, exactly as it is on the other side of the
    // comparison (`getBattlefieldIds` resolves a `PermanentFilter.name`
    // through the same current-definition read). Fail-closed at every step:
    // a missing slot (the spell was cast with fewer targets), a PLAYER target
    // (CR 201.2 names objects, not players) and an unresolvable instance all
    // yield undefined, which the calling filter treats as "matches nothing"
    // (CR 608.2b) rather than "no name constraint".
    const slot = parseTargetNameRef(ref);
    if (slot !== null) {
        const target = ctx.targets[slot];
        if (!target || target.type === "player") return undefined;
        return ctx.getCardName(target.id);
    }
    // Any OTHER property-path ref is not a name source. The static validator
    // rejects one before it can ship; this is its runtime twin, fail-closed so
    // a dotted ref can never fall through to `readBinding` (which would miss
    // and return undefined anyway, but by accident rather than by rule).
    if (ref.includes(".")) return undefined;
    const picked = readBinding(ctx, ref)?.[0];
    if (picked === undefined) return undefined;
    return ctx.getCardName(picked) ?? picked;
}

/** The fixed `choiceId` an `optionChoice` Op (issue #849) hands to
 *  `requestOptionChoice`. It need not be author-supplied nor unique across Ops:
 *  `requestOptionChoice` folds the Op's checkpointed pre-order position
 *  (`resolutionStep`) into the stored key, so two `optionChoice` Ops in one
 *  script key their picks distinctly. Not a `$`-binding (the mode index is
 *  consumed inline, never read by a later `ref`), so it never collides with an
 *  author binding name. */
const OPTION_CHOICE_ID = "optionChoiceMode";

/** Set ONLY when `mode` is a genuine "protection from the colour of your
 *  choice" pick (CR 702.16a) — issue #2306 review finding 1. `EffectMode.color`
 *  is a UI RENDERING tag (`cards/types.ts`'s own doc: "so the frontend renders
 *  a ManaSymbol icon") set by BOTH `protectionColorModes` (protection —
 *  DODGE the opponent's colours) and `colorChoiceModes`/`COLOR_OPTIONS`
 *  ("becomes the colour of your choice" — a different, sometimes opposite,
 *  intent; out of scope per the issue). A bot heuristic keyed on the bare
 *  `color` tag steers BOTH families identically, which is backwards for the
 *  latter (measured: it picks the opponent's best-shown colour for a
 *  dodge-a-colour effect). So this derives INTENT structurally instead of
 *  trusting a flag a card author could mis-set: true only when the mode's own
 *  effects grant an ability that `parseProtectionFromColor` (`gre/protection.ts`
 *  — the issue's own named single authority for this parse) resolves back to
 *  this SAME colour. `colorChoiceModes` bodies are `setColor` Ops, never
 *  `grantAbility`, so they always return `undefined` here. */
function modeProtectionColor(mode: EffectMode): Color | undefined {
    if (!mode.color) return undefined;
    for (const effect of mode.effects) {
        if (
            effect.op === "grantAbility" &&
            effect.ability !== undefined &&
            parseProtectionFromColor(effect.ability) === mode.color
        ) {
            return mode.color;
        }
    }
    return undefined;
}

/** The fixed `choiceId` a `coinFlip` Op (issue #851) hands to
 *  `requestCoinFlip`. Like `OPTION_CHOICE_ID` it need not be unique across Ops:
 *  `requestCoinFlip` folds the Op's checkpointed pre-order position
 *  (`resolutionStep`) into the stored key (`${step}:${choiceId}`), so two
 *  coinFlip Ops in one script persist their drawn bits distinctly and each
 *  re-reads its own on a re-walk (no re-roll, CR 608.3 / ADR 0023). */
const COIN_FLIP_ID = "coinFlipOutcome";

/** CR 608.2g (issue #1477) — the Cast / Decline options offered by the
 *  cast-during-resolution Op's "you may cast" prompt (an `option-pick`). */
const CAST_DECLINE_OPTIONS: { id: string; label: string }[] = [
    { id: "cast", label: "Cast" },
    { id: "decline", label: "Decline" },
];

/** CR 116.1 / 116.2a / 608.2g (issue #1961) — the offer used by EVERY branch of
 *  a play-during-resolution Op that can reach a land (`includesLand`): a land is
 *  PLAYED, never cast (CR 116.2a), and "play" also covers casting a spell
 *  (CR 116.1), so this one wording is accurate whichever branch is taken. That
 *  is the point: it must be IDENTICAL on both, see `OFFER_PROMPT` below. The
 *  option ID stays `"cast"` deliberately — it is the accept token the shared
 *  answer plumbing (`submitResolutionChoice`, the bot's `optionPickCandidates`)
 *  already understands, and inventing a second accept id would fork that
 *  plumbing for a label. */
const PLAY_DECLINE_OPTIONS: { id: string; label: string }[] = [
    { id: "cast", label: "Play" },
    { id: "decline", label: "Decline" },
];

/** CR 406.3 — the prompt text of the play-during-resolution offer, keyed by
 *  whether the grant can reach a land. `pendingChoices` crosses the wire
 *  UNREDACTED to both viewers and the non-chooser's client renders `prompt`
 *  verbatim ("Waiting for P1 — …"), so a land-flavoured prompt on the land
 *  branch and a cast-flavoured one on the spell branch would tell the opponent
 *  which branch was taken — i.e. whether the FACE-DOWN hideaway card is a land.
 *  A grant that can reach a land therefore uses ONE prompt and ONE option list
 *  for BOTH branches, so the branch actually taken is indistinguishable to any
 *  observer (the same reason the prompt names no card and pins no
 *  `subjectCardId`). */
const OFFER_PROMPT = {
    play: "You may play the card. Play it or decline.",
    cast: "You may cast the card. Cast it or decline.",
} as const;

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
    // picksNonEmpty (issue #1287) — true iff the named `choice` Op's picks
    // binding was captured AND is nonempty. Reuses `resolvePicks` (the same
    // reader `discard`/`sacrifice`'s bare picks refs use): `undefined` for an
    // uncaptured binding (the choice skipped — zero candidates, CR 608.2b)
    // and a zero-length array for a captured-but-declined "you may" choice
    // both read as false — nothing was picked either way.
    if ("picksNonEmpty" in pred) {
        const picks = resolvePicks(ctx, pred.picksNonEmpty);
        return picks !== undefined && picks.length > 0;
    }
    // targetIsAnother (issue #1315, CR 702.165a) — object-identity comparison:
    // true iff the named target slot resolves to a PERMANENT whose instance id
    // differs from the resolving ability's source. A missing slot, a
    // non-permanent target (shouldn't occur for a creature-typed
    // targetRequirement, but CR 608.2b covers it defensively), or the target
    // BEING the source all read false — Backup's grant half only fires on a
    // genuinely different creature.
    if ("targetIsAnother" in pred) {
        const target = resolveTargetRef(ctx, pred.targetIsAnother);
        if (!target || target.type !== "permanent") return false;
        return target.id !== ctx.sourceInstanceId;
    }
    // picksMatchFilter (issue #1343) — true iff at least one picked card,
    // resolved via `player`'s graveyard (CR 701.9 — every discard lands
    // there), matches `filter`. Connive's "if you discarded a nonland card"
    // gate (CR 701.50, Ledger Shredder). Reuses the SAME `matchesCardFilter`
    // reader `choice`/`count` already share — no new filter grammar.
    // boundMatchesFilter (Minsc & Boo) — CR 608.2h: match the SNAPSHOT's
    // last-known characteristics, with no zone lookup at all. The zone-free
    // form is mandatory for a sacrificed token, which ceases to exist
    // (CR 704.5d) and is therefore never findable in a graveyard.
    if ("boundMatchesFilter" in pred) {
        const snap = resolvePicks(ctx, pred.boundMatchesFilter);
        if (!snap) return false;
        return matchesCardFilter(
            ctx,
            {
                name: snap[SNAP_NAME],
                types: snapList(snap, SNAP_TYPES),
                subtypes: snapList(snap, SNAP_SUBTYPES),
                manaValue: Number(snap[SNAP_MANA_VALUE] ?? "0") || 0,
            },
            pred.filter
        );
    }
    if ("picksMatchFilter" in pred) {
        const picks = resolvePicks(ctx, pred.picksMatchFilter);
        if (!picks || picks.length === 0) return false;
        const playerId = resolvePlayerRef(ctx, pred.player);
        if (!playerId) return false;
        const graveyardCards = ctx.getGraveyardCards(playerId);
        return picks.some((id) => {
            const card = graveyardCards.find((c) => c.id === id);
            return (
                card !== undefined && matchesCardFilter(ctx, card, pred.filter)
            );
        });
    }
    // targetMatchesGraveyardFilter (issue #2385) — the ANNOUNCED-TARGET
    // sibling of `picksMatchFilter`: true iff the resolved object selector
    // names a card currently in `player`'s graveyard AND that card matches
    // `filter`. Reuses the SAME `getGraveyardCards` + `matchesCardFilter`
    // reader `picksMatchFilter` uses, just keyed by a target/object selector
    // (`targetRequirement: { zone: "graveyard" }`) instead of a `choice` Op's
    // picks binding.
    if ("targetMatchesGraveyardFilter" in pred) {
        const target = resolveObjectRef(ctx, pred.targetMatchesGraveyardFilter);
        if (!target) return false;
        const playerId = resolvePlayerRef(ctx, pred.player);
        if (!playerId) return false;
        const graveyardCards = ctx.getGraveyardCards(playerId);
        const card = graveyardCards.find((c) => c.id === target.id);
        return card !== undefined && matchesCardFilter(ctx, card, pred.filter);
    }
    // objectMatchesFilter (issue #1747) — the LIVE-object counterpart of
    // `boundMatchesFilter` (a CR 608.2h snapshot) and `picksMatchFilter` (a
    // graveyard lookup): true iff the referenced permanent is on the
    // battlefield RIGHT NOW and matches `filter`. Figure of Destiny's "If this
    // creature is a Spirit, it becomes …" needs exactly this — the subtype it
    // tests was granted by an EARLIER resolution, so neither a snapshot nor a
    // printed-definition read can see it. Evaluated by asking the live,
    // layer-materialised battlefield matcher (`getBattlefieldIds`, the same
    // reader every battlefield `choice`/`count`/`forEach` uses) whether the
    // instance is in the matching set, so a subtype/type/colour set by a
    // resolving effect counts exactly as a printed one does. Reads FALSE for a
    // gone or non-permanent object (CR 608.2b — the effect does as much as it
    // can).
    if ("objectMatchesFilter" in pred) {
        const target = resolveObjectRef(ctx, pred.objectMatchesFilter);
        if (!target || target.type !== "permanent") return false;
        const base = toPermanentFilter(ctx, pred.filter);
        // CR 608.2b — an unresolvable dynamic constraint matches nothing, so
        // the predicate reads false (never "no constraint", which would make
        // the gate trivially true).
        if (base === UNMATCHABLE_FILTER) return false;
        const filter = {
            ...(base ?? {}),
            instanceIds: [target.id],
        };
        // CR 109.5 (issue #2388) — an optional CONTROLLER scope: "attached to
        // a creature you control". Narrows the scan to the one player instead
        // of every battlefield; an unresolvable player ref reads `false`
        // (CR 608.2b), the same fail-closed rule the unmatchable-filter guard
        // above applies, never "scan everyone".
        const scoped = pred.controlledBy;
        if (scoped !== undefined) {
            const pid = resolvePlayerRef(ctx, scoped);
            if (!pid) return false;
            return ctx.getBattlefieldIds(pid, filter).length > 0;
        }
        return ctx.allPlayerIds.some(
            (pid) => ctx.getBattlefieldIds(pid, filter).length > 0
        );
    }
    // sharesColor (issue #1955, CR 105.2 / 202.2) — true iff the two
    // referenced objects have at least one colour in common. Both sides read
    // through `ctx.getColors`, the layer-5 materialised colour (CR 613) — so
    // a permanent painted blue by Painter's Servant shares blue exactly as a
    // printed blue one does. A missing / gone / non-permanent side reads false
    // (CR 608.2b), and so does a colourless side: colourless is the ABSENCE of
    // colour, so it shares nothing, not even with another colourless object.
    if ("sharesColor" in pred) {
        const a = resolveObjectRef(ctx, pred.sharesColor);
        const b = resolveObjectRef(ctx, pred.with);
        if (!a || !b) return false;
        const colorsA = ctx.getColors(a);
        if (colorsA.length === 0) return false;
        const colorsB = ctx.getColors(b);
        return colorsA.some((c) => colorsB.includes(c));
    }
    // hasCityBlessing (Ascend, CR 702.131b — issue #1460) — true iff the
    // resolved player holds the city's blessing designation. A pure
    // player-state read via the `hasCityBlessing` primitive (the monotonic
    // `GameState.cityBlessingIds` set); `false` for an unresolvable player ref.
    if ("hasCityBlessing" in pred) {
        const playerId = resolvePlayerRef(ctx, pred.hasCityBlessing);
        if (!playerId) return false;
        return ctx.hasCityBlessing(playerId);
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
 *  — a thin skin over `ctx.getCounterCount`, CR 122.6), a `difference` of two
 *  terminals (issue #2006), a terminal `scaled` by a fixed multiplier (issue
 *  #2366), a terminal `divide`d by a fixed divisor with explicit rounding
 *  (issue #2385), or — at a SIGNED value site (`EffectSignedValue`, today only
 *  `pump`'s power/toughness) — a `negate`-wrapped value (issue #926, one
 *  unary sign flip, no other arithmetic). Returns `undefined` when a ref
 *  names a binding that was never captured, a selected object has left play
 *  (CR 608.2b), or the negated inner value is itself unresolvable — so the
 *  caller skips too. */
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
        // isPermanentCard (issue #1311) — CR 205/110.1, "1"/"0" captured at
        // bind time (SNAP_IS_PERMANENT_CARD). A comparison predicate reads it
        // as `{ left: { ref: "$name.isPermanentCard" }, op: "eq", right: 1 }`
        // ("if it was a permanent card…", Lion Sash).
        if (parsed.property === "isPermanentCard") {
            return Number(snap[SNAP_IS_PERMANENT_CARD]);
        }
        return undefined;
    }
    // escaped (CR 702.138b, issue #695) — 1 if the referenced permanent escaped
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
    // kickerPaid — how many times the NAMED Kicker was paid (CR 702.33 /
    // 702.33e), a thin skin over ctx.getKickerPaidCount. The PER-KICKER sibling
    // of `kickerCount`: a card with two independently payable Kickers ("Kicker
    // {A} and/or {B}", the Planeshift Battlemage cycle) has one intervening-if
    // per Kicker, and a total cannot say WHICH was paid (ADR 0079). `>= 1` in a
    // comparison predicate is "this Kicker was paid". One execution path, no
    // arithmetic.
    if ("kickerPaid" in value) {
        return ctx.getKickerPaidCount(value.kickerPaid);
    }
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
    // devotion (CR 700.5, issue #2070) — a thin skin over ctx.getDevotion.
    // `of` is a PLAYER selector like domain's, resolved through the SAME
    // resolvePlayerRef path. `color` is a plain literal, no ref grammar of
    // its own. Undefined when the player cannot be resolved (CR 608.2b).
    if ("devotion" in value) {
        const playerId = resolvePlayerRef(ctx, value.devotion.of);
        if (playerId === undefined) return undefined;
        return ctx.getDevotion(playerId, value.devotion.color);
    }
    // abilityResolutionCount (CR 122 / 603.3, issue #1189) — how many times
    // the CURRENTLY RESOLVING triggered ability has resolved this turn,
    // counting this resolution, a thin skin over
    // ctx.getAbilityResolutionCount(). No `of` selector — it always reads
    // the resolving stack item's own tally (Omnath, Locus of Creation;
    // Scythecat Cub's escalating branches).
    if ("abilityResolutionCount" in value) {
        return ctx.getAbilityResolutionCount();
    }
    // lifeGainedThisTurn (CR 119.3, issue #1457) — total life a PLAYER has
    // gained so far this turn, a thin skin over ctx.getLifeGainedThisTurn.
    // `of` is a PLAYER selector (like domain's, unlike counters'/manaValue's
    // object `of`), resolved through the SAME resolvePlayerRef path. Undefined
    // when the player cannot be resolved (CR 608.2b). Powers the "if you
    // gained life this turn" retrospective predicate (Crested Sunmare).
    if ("lifeGainedThisTurn" in value) {
        const playerId = resolvePlayerRef(ctx, value.lifeGainedThisTurn.of);
        if (playerId === undefined) return undefined;
        return ctx.getLifeGainedThisTurn(playerId);
    }
    // playerCounters (CR 122.1, issue #1969) — how many counters of one kind a
    // PLAYER has, a thin skin over ctx.getPlayerCounters. The PLAYER-scoped
    // sibling of `counters` above: `of` is a PLAYER selector resolved through
    // the SAME resolvePlayerRef path (like domain's / lifeGainedThisTurn's,
    // unlike counters'/manaValue's object `of`). Undefined when the player
    // cannot be resolved (CR 608.2b). No CR 608.2g last-known-information
    // fallback is needed or possible — a player never leaves a zone, so unlike
    // the object-scoped read this can never miss a sacrificed source.
    if ("playerCounters" in value) {
        const playerId = resolvePlayerRef(ctx, value.playerCounters.of);
        if (playerId === undefined) return undefined;
        return ctx.getPlayerCounters(playerId, value.playerCounters.type);
    }
    // difference (issue #2006) — `from` MINUS `minus`, the single arithmetic
    // member of the value grammar. Both operands are TERMINALS (a literal or a
    // `count`), so this cannot recurse into an expression tree; see
    // `EffectDifferenceValue` in `cards/types.ts` for what is deliberately not
    // generalized here.
    //
    // CR 107.1b — the result is SIGNED and may legitimately be negative ("a
    // game value can be less than zero"); the clamp belongs at the consuming
    // Op, every one of which already returns on `amount <= 0`. That is exactly
    // Dark Suspicions' Oracle ruling: a negative X loses no life and never
    // becomes a life gain.
    if ("difference" in value) {
        const from = resolveDifferenceOperand(ctx, value.difference.from);
        const minus = resolveDifferenceOperand(ctx, value.difference.minus);
        return from - minus;
    }
    // scaled (issue #2366) — a fixed positive-integer multiplier times a
    // terminal value, the value grammar's multiplication counterpart to
    // `difference`'s subtraction. Unblocks Pest Infestation's "twice X". Both
    // the operand and the product are non-negative by construction (CR
    // 107.1b — see `EffectScaledValue`'s doc comment), so unlike `difference`
    // there is no sign concern here.
    if ("scaled" in value) {
        return (
            resolveScaledOperand(ctx, value.scaled.value) * value.scaled.times
        );
    }
    // divide (issue #2385) — a terminal divided by a fixed positive-integer
    // divisor, rounded per the mandatory `rounding` field (CR 107.1a). The
    // operand is `EffectDifferenceOperand` — the SAME non-X terminal set
    // `difference` uses — so it reads through the identical
    // `resolveDifferenceOperand` helper; no separate resolver needed.
    if ("divide" in value) {
        const dividend = resolveDifferenceOperand(ctx, value.divide.value);
        const quotient = dividend / value.divide.by;
        return value.divide.rounding === "up"
            ? Math.ceil(quotient)
            : Math.floor(quotient);
    }
    return countSet(ctx, value.count);
}

/** One operand of a `difference` value (issue #2006): a literal integer or a
 *  single `count`. A count that cannot resolve its player is already 0 in
 *  `countSet` (CR 608.2b), so an operand never makes the whole difference
 *  unresolvable — unlike a `ref`, which is not a legal operand here. */
function resolveDifferenceOperand(
    ctx: SpellContext,
    operand: EffectDifferenceOperand
): number {
    return typeof operand === "number" ? operand : countSet(ctx, operand.count);
}

/** One operand of a `scaled` value (issue #2366): a literal integer, a single
 *  `count`, or the chosen-cost `X` — `EffectDifferenceOperand` plus `X`, kept
 *  as a sibling type rather than a widening of it (see `EffectScaledOperand`'s
 *  doc comment in `cards/types.ts` for why `difference` stays X-free). `X` is
 *  read the same one way every other X site reads it (`ctx.getX()`); a count
 *  that cannot resolve its player is already 0 in `countSet` (CR 608.2b). */
function resolveScaledOperand(
    ctx: SpellContext,
    operand: EffectScaledOperand
): number {
    if (typeof operand === "number") return operand;
    if ("X" in operand) return ctx.getX();
    return countSet(ctx, operand.count);
}

/** The explicit third outcome of mapping an `EffectCardFilter` onto a
 *  `PermanentFilter` (issue #2065): the filter carries a DYNAMIC constraint
 *  that resolved to nothing, so it matches NO permanent — as distinct from
 *  `undefined`, which means "no constraint, every permanent matches".
 *
 *  It exists because those two outcomes are otherwise indistinguishable in
 *  the `PermanentFilter` shape, and collapsing them is fail-OPEN: an
 *  unresolved name ref would widen "permanents named X" to "all permanents",
 *  the exact bug class the `any` mapping note below records. A sentinel in
 *  the return type makes every caller handle it or fail to compile. */
const UNMATCHABLE_FILTER = "unmatchable-filter" as const;

/** Maps the JSON-pure `EffectCardFilter` onto the engine's `PermanentFilter`
 *  shape (shared by the `count` construct and the `choice` Op's battlefield
 *  candidates), resolving any dynamic (`{ ref }`) field against `ctx`.
 *  Returns UNMATCHABLE_FILTER when a dynamic field cannot resolve — see that
 *  constant. */
function toPermanentFilter(
    ctx: SpellContext,
    filter: EffectCardFilter | undefined
): PermanentFilter | undefined | typeof UNMATCHABLE_FILTER {
    if (!filter) return undefined;
    // CR 201.2 (issue #1085 / #2065) — a `name` that is a `{ ref }` is
    // resolved HERE, at the battlefield boundary, through the same
    // `resolveNameRef` the hidden-zone matcher uses. It used to be dropped
    // (`typeof filter.name === "string" ? … : undefined`), which is
    // fail-OPEN: a `PermanentFilter` with no `name` imposes no name
    // constraint, so "permanents named X" silently became "ALL permanents" at
    // every battlefield `count` / `choice` / `forEach` site. An unresolvable
    // ref (the naming Op was skipped, the target slot is gone — CR 608.2b)
    // now yields the explicit UNMATCHABLE_FILTER sentinel instead, which
    // every caller must handle as "nothing matches".
    let name: string | undefined;
    if (filter.name !== undefined) {
        name =
            typeof filter.name === "string"
                ? filter.name
                : resolveNameRef(ctx, filter.name.ref);
        if (name === undefined) return UNMATCHABLE_FILTER;
    }
    // issue #897 — the OR-across-fields clause list. A clause whose own name
    // ref is unresolvable matches nothing, so it drops OUT of the OR; an OR
    // left with no clauses matches nothing at all, i.e. the whole filter is
    // unmatchable.
    let any: PermanentFilter[] | undefined;
    if (filter.any !== undefined) {
        const clauses = filter.any
            .map((clause) => toPermanentFilter(ctx, clause))
            .filter(
                (clause): clause is PermanentFilter =>
                    clause !== UNMATCHABLE_FILTER && clause !== undefined
            );
        if (clauses.length === 0) return UNMATCHABLE_FILTER;
        any = clauses;
    }
    return {
        types: filter.type,
        excludeTypes: filter.excludeType,
        subtypes: filter.subtype,
        supertypes: filter.supertype,
        excludeSupertypes: filter.excludeSupertype,
        colors: filter.color,
        isToken: filter.isToken,
        // CR 702 (issue #1097) — "with <keyword>" (Canopy Surge's "each
        // creature with flying"), propagated 1:1 onto
        // `PermanentFilter.requireAbility` (`convex/cards/filters.ts`), which
        // already reads the LIVE/materialized `staticAbilities` array — no
        // separate effective-abilities helper needed (see `EffectCardFilter.
        // hasAbility`'s own doc comment).
        requireAbility: filter.hasAbility,
        // CR 400.7 (issue #1458) — "entered the battlefield this turn",
        // propagated 1:1 onto `PermanentFilter.enteredThisTurn`, mirroring
        // `isToken`'s own mapping exactly (battlefield-only, no hidden-zone
        // counterpart in `matchesCardFilter`).
        enteredThisTurn: filter.enteredThisTurn,
        // "…that they controlled since the beginning of the turn" (Keldon
        // Twilight) — propagated 1:1 onto
        // `PermanentFilter.controlledSinceTurnStart`, which reads the
        // `MatchablePermanent` flag every battlefield call site derives from
        // `hasControlledSinceTurnStart` (`gre/controlContinuity.ts`).
        // Battlefield-only, exactly like `enteredThisTurn` above; the Effect
        // Script validator only admits it at battlefield-guaranteed sites.
        controlledSinceTurnStart: filter.controlledSinceTurnStart,
        // CR 508.1 (issue #1097 — Tangle's "each attacking creature"),
        // propagated 1:1 onto `PermanentFilter.isAttacking`
        // (`convex/cards/filters.ts`), already read by combat-scoped choice
        // pickers — `CardInstanceState.isAttacking` is spread verbatim into
        // every `getBattlefieldIds` candidate, so no new engine read, only
        // this DSL filter surface.
        isAttacking: filter.isAttacking,
        // CR 201.2 — a FIXED literal name, or the resolved value of a dynamic
        // `{ ref }` name (see the resolution block at the top of this
        // function; an unresolvable one never reaches here).
        name,
        // issue #897 — propagate the OR-across-fields clause list onto
        // `PermanentFilter.any` (`convex/cards/filters.ts`), recursing through
        // this same mapping for each clause. Without this, a filter carrying
        // ONLY `any` (no other field set) mapped to an all-undefined
        // `PermanentFilter` that `matchesPermanentFilter` treats as "no
        // constraint" — matching EVERY permanent (fail OPEN) at every
        // battlefield `choice`/`count`/`forEach` site.
        any,
        // issue #2373 — "another creature or an artifact" (Gut, True Soul
        // Zealot). Propagates onto `PermanentFilter.excludeInstanceIds`
        // (`convex/cards/filters.ts`), the SAME field `TargetRequirement.
        // excludeSource`/the `forEach` selector's own flag ultimately resolve
        // onto — this is the `choice` Op's route there, since a `choice`'s
        // `PermanentFilter` is checked at BOTH candidate-scan time
        // (`choiceCandidates` above) and submit-time legality, unlike
        // `forEach`'s post-hoc member-set drop.
        excludeInstanceIds: filter.excludeSource
            ? [ctx.sourceInstanceId]
            : undefined,
    };
}

/** Scans one player's battlefield through an `EffectCardFilter`, resolving its
 *  dynamic fields first. The shared shape for every call site that only needs
 *  the matching ids and treats an unmatchable filter as an empty set
 *  (CR 608.2b) — the fail-closed default, spelled once. */
function battlefieldIdsFor(
    ctx: SpellContext,
    playerId: string,
    filter: EffectCardFilter | undefined
): string[] {
    const resolved = toPermanentFilter(ctx, filter);
    if (resolved === UNMATCHABLE_FILTER) return [];
    return ctx.getBattlefieldIds(playerId, resolved);
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
        counters?: Readonly<Record<string, number>>;
        // issue #1881 — full printed cost, for `manaCostEquals`'s exact
        // structural match. `undefined` for a card shape with no cost slot
        // (the CR 608.2h `boundMatchesFilter` snapshot) — fails CLOSED
        // below, never open.
        cost?: ManaCost;
    },
    filter: EffectCardFilter
): boolean {
    // CR 122.6 (issue #1156) — "with a <type> counter on it" (Dauthi
    // Voidwalker's void counter). Fail-closed for a card shape that carries
    // no `counters` map (hand/library/graveyard snapshots) — 0 of any type.
    if (filter.hasCounter !== undefined) {
        const have = card.counters?.[filter.hasCounter.type] ?? 0;
        if (have < (filter.hasCounter.min ?? 1)) return false;
    }
    // CR 201.2 — exact printed-name match ("each other card named Accumulated
    // Knowledge", issue #985): a FIXED literal, or a bare `{ ref: "$binding" }`
    // naming EITHER (issue #1085) a `nameCard` Op's chosen-name binding
    // (Desperate Research's "put all of them with THAT name into your
    // hand") OR (issue #1104) a `choice` Op's picks binding — "all cards with
    // the same name as the CHOSEN CARD" (Lobotomy), where the earlier Op
    // bound the card itself, not just its name. `resolveNameRef` unifies both:
    // it treats the binding's first stored string as an instance id first
    // (`ctx.getCardName`), falling back to the raw string as a literal name
    // when that lookup misses — which is exactly what a `nameCard` binding's
    // stored NAME does (it's never a live instance id). Fail-closed when the
    // card shape carries no name, OR when the ref names an uncaptured binding
    // (the naming/choice Op was skipped, CR 608.2b).
    if (filter.name !== undefined) {
        const wanted =
            typeof filter.name === "string"
                ? filter.name
                : resolveNameRef(ctx, filter.name.ref);
        if (wanted === undefined || card.name !== wanted) return false;
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
    // issue #1287 — the negative of `color` (Krovikan Sorcerer's "a NONBLACK
    // card"): fails if the card has ANY listed color. An uncolored card
    // (empty `colors`) always passes — nothing to exclude (CR 105.2a).
    const excludeColors = asFilterArray(filter.excludeColor);
    if (
        excludeColors !== undefined &&
        excludeColors.some((c) => (card.colors ?? []).includes(c))
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
    // issue #1083 — exact mana-value match (Metathran Aerostat's "a creature
    // card with mana value X"), the sibling of `manaValueAtMost` above. Same
    // fail-closed convention for an unresolvable dynamic value.
    if (filter.manaValueEquals !== undefined) {
        const exact = resolveValue(ctx, filter.manaValueEquals);
        if (exact === undefined || card.manaValue !== exact) return false;
    }
    // issue #1881 (ADR 0078 decision 8) — exact structural MANA-COST match
    // (CR 202), distinct from `manaValueEquals` right above. A card shape
    // with no `cost` slot (the CR 608.2h snapshot) fails CLOSED — never
    // matches — the same convention `manaValueAtMost`/`manaValueEquals` use
    // for an unresolvable dynamic value. A single `ManaCost` clause or an OR
    // across a non-empty array of them (mirrors `type`/`subtype`/`color`'s
    // own OR-within-a-field array semantics, issue #677).
    if (filter.manaCostEquals !== undefined) {
        if (card.cost === undefined) return false;
        const clauses = Array.isArray(filter.manaCostEquals)
            ? filter.manaCostEquals
            : [filter.manaCostEquals];
        if (!clauses.some((clause) => manaCostsEqual(card.cost!, clause))) {
            return false;
        }
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
 *  REVEALS the peeked cards (CR 701.20, Fact or Fiction) — a public reveal,
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
        const filter = toPermanentFilter(ctx, select.filter);
        // CR 608.2b — nothing can match, so the selector selects nothing.
        if (filter === UNMATCHABLE_FILTER) return undefined;
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
    // CR 122 — the SMALLEST per-player count (issue #783, Shelldock Isle's "if
    // a library has twenty or fewer cards in it"): `min(sizes) <= N` is exactly
    // "SOME player's zone has N or fewer cards", which is what the Oracle's
    // indefinite article ("a library") means. `controller` is ignored in this
    // mode, like the sum branch above.
    if (spec.smallestAcrossPlayers) {
        const sizes = ctx.allPlayerIds.map((pid) =>
            countZoneForPlayer(ctx, pid, spec)
        );
        // No players at all cannot happen in a live game; 0 keeps the read total.
        return times * (sizes.length > 0 ? Math.min(...sizes) : 0);
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
        const filter = toPermanentFilter(ctx, spec.filter);
        // CR 608.2b / CR 122 — a filter that can match nothing counts 0. This
        // is the load-bearing branch for Winnow (issue #2065): an unresolvable
        // `$target0.name` must count ZERO permanents, not every permanent.
        if (filter === UNMATCHABLE_FILTER) return 0;
        return ctx.getBattlefieldIds(playerId, filter).length;
    }
    // library (CR 401, issue #783) — a pure CARDINALITY read. The library is a
    // hidden zone (CR 401.2) but its SIZE is public information every player may
    // count, so there is nothing to filter (the validator rejects a `filter`
    // here) and no knowledge is granted by asking.
    if (spec.zone === "library") {
        return ctx.getLibraryCards(playerId).length;
    }
    // hand (CR 402, issue #2006) — the library branch's twin, and for the same
    // reason: the hand is hidden (CR 402.2) but its SIZE is public information
    // (CR 402.2 — "the number of cards in each player's hand" is known to all),
    // so this is a pure CARDINALITY read with nothing to filter (the validator
    // rejects a `filter`/`countTypes` here exactly as it does for `library`).
    if (spec.zone === "hand") {
        return ctx.getHandSize(playerId);
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
    if (ref === "opponent") return resolveOpponentOf(ctx, "controller");
    // `{ opponentOf: EffectPlayerRef }` (issue #1568) — the controller-
    // relative complement generalized to an ARBITRARY resolved player ref,
    // not just the resolving controller (plain `"opponent"` above is now
    // sugar for `{ opponentOf: "controller" }`, routed through the SAME
    // helper). Skipped (undefined) when the inner ref can't be resolved
    // (CR 608.2b) — e.g. `{ controllerOf: { target: n } }` with a missing
    // target slot.
    if ("opponentOf" in ref) return resolveOpponentOf(ctx, ref.opponentOf);
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

/** The controller-relative complement of an ARBITRARY resolved player ref
 *  (issue #1568) — resolves `ref`, then returns "the other" player. CR 102.2
 *  — two-player games: TWO-PLAYER SCOPE ONLY (CLAUDE.md § Out of Scope, no
 *  3+ player multiplayer). Solo games model two seats, so this holds there
 *  too. Undefined when `ref` itself can't be resolved (CR 608.2b) — no base
 *  player means no complement either. */
function resolveOpponentOf(
    ctx: SpellContext,
    ref: EffectPlayerRef
): string | undefined {
    const base = resolvePlayerRef(ctx, ref);
    if (base === undefined) return undefined;
    return ctx.allPlayerIds.find((id) => id !== base);
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
    if (ctx.getOwnerId(id) !== undefined) {
        return { type: "permanent", id };
    }
    // CR 608.2h (issue #1101) — a `lookDistribute` `bind` snapshots the KEPT card
    // right after it moves library → hand: it never becomes a permanent, so
    // the battlefield check above always misses for it. Fall back to a
    // hand-card lookup in the snapshot's OWNER slot before giving up —
    // Reviving Vapors' `manaValue: { of: { ref: "$name" } }` resolves
    // through here.
    const ownerId = snap[SNAP_OWNER];
    if (ownerId && ctx.getHandCards(ownerId).some((c) => c.id === id)) {
        return { type: "hand-card", id, playerId: ownerId };
    }
    // CR 608.2h (issue #1401) — the "blink" shape: an `exile` Op's own `bind`
    // snapshots the card BEFORE it moves (see `exile` below), so the ref
    // still names it after it lands in exile. Neither battlefield presence
    // nor the hand fallback above find it there, so check exile last before
    // giving up. Returned as the generic "card sitting in a non-battlefield
    // zone" carrier (`graveyard-card` — see `moveZone`'s target-shape
    // comment); `moveZone`'s `to: "battlefield"` branch re-derives the
    // ACTUAL zone (exile vs. graveyard) at the point it calls
    // `returnToBattlefield`, so this carrier choice is not mis-zoned.
    const exileOwnerId = ctx.getExileCardOwner(id);
    if (exileOwnerId) {
        return { type: "graveyard-card", id, playerId: exileOwnerId };
    }
    return undefined;
}

/** CR 404.3 (issue #1967) — resolves a DETERMINISTIC positional graveyard
 *  selector ("the top creature card of your graveyard" — Shallow Grave,
 *  Corpse Dance) to the graveyard-card carrier `moveZone`'s executor acts on.
 *
 *  ORDER (the load-bearing part). The graveyard is an ordered zone (CR 404.3)
 *  and this engine keeps `player.graveyard` in INSERTION order — every site
 *  that puts a card there APPENDS (`moveCard` / `removePermanentTo` in
 *  `gre/state.ts` both `push`; see the CR 404.3 notes at those two funnels).
 *  So index 0 is the OLDEST card (the BOTTOM of the pile) and the LAST index
 *  is the most recently added one — the TOP. `getGraveyardCards` maps over
 *  that array without reordering, so a `position: "top"` scan walks it
 *  BACKWARDS.
 *
 *  FILTERED SCAN, not a top-card type check: "the top **creature** card"
 *  means the topmost card MATCHING the filter, so a non-creature sitting
 *  above a creature is skipped over rather than making the effect fizzle.
 *  Matched through the same `matchesCardFilter` every other hidden-zone
 *  filter site uses; an omitted filter takes the outright top/bottom card.
 *
 *  Returns undefined — a clean CR 608.2b no-op — for an unresolvable player,
 *  an empty graveyard, or a filter nothing matches. */
function resolveGraveyardPosition(
    ctx: SpellContext,
    sel: EffectZonePositionSelector
): TargetSelection | undefined {
    const playerId = resolvePlayerRef(ctx, sel.player ?? "controller");
    if (playerId === undefined) return undefined;
    const cards = ctx.getGraveyardCards(playerId);
    const step = sel.position === "top" ? -1 : 1;
    const start = sel.position === "top" ? cards.length - 1 : 0;
    for (let i = start; i >= 0 && i < cards.length; i += step) {
        const card = cards[i];
        if (sel.filter && !matchesCardFilter(ctx, card, sel.filter)) continue;
        return { type: "graveyard-card", id: card.id, playerId };
    }
    return undefined;
}

/** CR 607 (issue #1319 foundation, generalized #1323) — the `moveZone` SIXTH
 *  shape's resolver: the first card, among every card CURRENTLY exiled and
 *  linked to the resolving ability's OWN source (`getCardsExiledWith`,
 *  `SpellContext`, mirrors `getCardsExiledWith`'s own player-then-array
 *  stable order), that matches an optional `filter`. Deliberately not a
 *  player choice on 2+ matches — see the `EffectExiledWithSourceSelector`
 *  moveZone-shape doc comment (`cards/types.ts`) for the "mirrors the
 *  positional-selector precedent" rationale. Returns undefined — a clean
 *  CR 608.2b no-op — when the linked pile is empty or nothing matches
 *  `filter`. `ownerId` (not `ctx.controller`) is the pile the card is
 *  spliced out of (CR 400.7 — the card sits in ITS OWN owner's exile,
 *  which may differ from the resolving ability's controller); a `controller`
 *  field on the Op itself is what redirects the reanimated permanent under
 *  the ability's controller ("under YOUR control"). */
function resolveExiledWithSource(
    ctx: SpellContext,
    filter: EffectCardFilter | undefined
): TargetSelection | undefined {
    const cards = ctx.getCardsExiledWith(ctx.sourceInstanceId);
    for (const card of cards) {
        if (filter && !matchesCardFilter(ctx, card, filter)) continue;
        return { type: "graveyard-card", id: card.id, playerId: card.ownerId };
    }
    return undefined;
}

/** Reduces the GENERIC portion of a printed `ManaCost` by `amount`, floored at
 *  {0} (CR 118.9 — a cost cannot be reduced below {0}); colored pips pass
 *  through untouched — a generic reduction never removes a colored pip (CR
 *  601.2f). Mirrors the existing `applyCostModifiers` clamp
 *  (`Math.max(0, generic - reduction)`, `convex/gre/state.ts`). A variable
 *  `{X}` marker contributes 0 to the generic total, matching `getManaValue`'s
 *  own X-counts-as-0 convention for a permanent target (CR 202.3 — the chosen
 *  X isn't preserved on the resulting permanent). Used by a `mayPay` Op's
 *  dynamically-derived cost leg (issue #1150, Flash — "pay its mana cost
 *  reduced by {2}"). */
function reduceGenericMana(cost: ManaCost, amount: number): ManaCost {
    const result: ManaCost = {};
    for (const color of ["W", "U", "B", "R", "G", "C"] as const) {
        const v = cost[color];
        if (v) result[color] = v;
    }
    const generic =
        (typeof cost.X === "number" ? cost.X : 0) + (cost.generic ?? 0);
    const reduced = Math.max(0, generic - amount);
    if (reduced > 0) result.generic = reduced;
    return result;
}

/** Sentinel returned by `resolveMayPayCost` when a dynamically-derived cost's
 *  referenced object can't be resolved (CR 608.2b — it left the battlefield
 *  before this Op ran). Distinct from a resolved `cost: undefined` (the
 *  bare cost-free "you may" shape, issue #680) — the caller SKIPS the whole
 *  `mayPay` Op on this sentinel rather than risk an unpayable/wrong-priced
 *  mana leg, exactly like a missing player ref. */
const MAY_PAY_COST_UNRESOLVABLE = Symbol("mayPay-cost-unresolvable");

/** Resolves a `mayPay` Op's `cost` field to the concrete `MayPayCost`
 *  `SpellContext.requestMayPay` consumes (issue #1150 / #1195). A static
 *  cost (the historical `MayPayCost` union) passes through unchanged.
 *
 *  A `DynamicMayPayManaCost` (`{ manaCostOf, reducedBy }`) is resolved HERE,
 *  at Op execution time: `manaCostOf` is a bare PICKS ref (an earlier
 *  `choice` Op's selected instance id — Flash's "the creature just put onto
 *  the battlefield"), looked up via `resolvePicks`; its printed mana cost is
 *  read via `ctx.getManaCost` (CR 608.2b — must still be on the battlefield,
 *  checked through `ctx.getOwnerId`), and the generic portion reduced by
 *  `reducedBy` (`reduceGenericMana`) — the resulting concrete `ManaCost`
 *  becomes the `mana` leg of a `MayPayCost`.
 *
 *  A `DynamicMayPayEnergyCost` (`{ energyEqualTo }`, issue #1195 — Satya,
 *  Aetherflux Genius's "pay {E} equal to its mana value") is likewise
 *  resolved HERE: `energyEqualTo` is a full `EffectValue`, resolved through
 *  the SAME `resolveValue` every other numeric Op parameter uses (in
 *  practice `{ manaValue: { of: { ref: "$token" } } }` — the captured token's
 *  live mana value) — no bespoke reader, unlike the mana leg's dedicated
 *  `manaCostOf` shape. An unresolvable value (the referenced object left the
 *  battlefield, CR 608.2b) skips the whole Op exactly like a gone
 *  `manaCostOf` target. */
function resolveMayPayCost(
    ctx: SpellContext,
    cost:
        | MayPayCost
        | DynamicMayPayManaCost
        | DynamicMayPayEnergyCost
        | undefined
): MayPayCost | undefined | typeof MAY_PAY_COST_UNRESOLVABLE {
    if (!cost) return cost;
    if ("reducedBy" in cost) {
        // CR 118.9 / 601.2f — "pay <base> reduced by <amount>". `reducedBy` is
        // a full `EffectValue` (issue #1958): a plain number is Flash's fixed
        // {2}, a `{ domain: … }` value is Draco's "{2} for each basic land
        // type among lands you control", resolved through the SAME
        // `resolveValue` every other numeric Op parameter uses.
        const amount = resolveValue(ctx, cost.reducedBy);
        if (amount === undefined) return MAY_PAY_COST_UNRESOLVABLE;
        // LITERAL base (Draco's {10}) — nothing to look up.
        if (cost.mana) return { mana: reduceGenericMana(cost.mana, amount) };
        const ids = resolvePicks(ctx, cost.manaCostOf);
        const id = ids?.[0];
        if (!id || ctx.getOwnerId(id) === undefined) {
            return MAY_PAY_COST_UNRESOLVABLE; // CR 608.2b — gone, skip
        }
        const printed = ctx.getManaCost({ type: "permanent", id });
        if (!printed) return MAY_PAY_COST_UNRESOLVABLE;
        return { mana: reduceGenericMana(printed, amount) };
    }
    if ("energyEqualTo" in cost) {
        const amount = resolveValue(ctx, cost.energyEqualTo);
        if (amount === undefined) return MAY_PAY_COST_UNRESOLVABLE;
        return { energy: amount };
    }
    return cost;
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
    const chars = ctx.getCharacteristics(target);
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
        // SNAP_IS_PERMANENT_CARD (issue #1311) — CR 205/110.1, read BEFORE
        // the object moves (mirrors SNAP_MANA_VALUE's own pre-move capture;
        // `isPermanentCard`'s graveyard-card/hand-card branches require the
        // card still be findable in its owner's zone array).
        ctx.isPermanentCard(target) ? "1" : "0",
        // SNAP_TYPES / SNAP_SUBTYPES / SNAP_NAME (Minsc & Boo) — CR 205 /
        // 201.2, read BEFORE the object moves so "if the sacrificed creature
        // WAS a Hamster" survives the object ceasing to exist (CR 704.5d — a
        // sacrificed token is never in a graveyard to look up).
        (chars?.types ?? []).join(SNAP_LIST_SEP),
        (chars?.subtypes ?? []).join(SNAP_LIST_SEP),
        chars?.name ?? "",
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
        // CR 601.2c / 608.2 — `candidates` narrows the pick to specific
        // ALREADY-KNOWN objects (the announced targets) instead of the whole
        // battlefield, so "choose one of THEM" is a click on a card. Each
        // selector is re-resolved now: one that no longer names a battlefield
        // permanent has left in response and simply drops out (CR 608.2b), and
        // the count clamps to what remains, exactly as a zone-wide choice
        // clamps to availability. A `filter` still narrows the resolved set.
        if (op.candidates) {
            const ids: string[] = [];
            for (const selector of op.candidates) {
                const resolved = resolveObjectRef(ctx, selector);
                if (!resolved || resolved.type !== "permanent") continue;
                if (ids.includes(resolved.id)) continue;
                ids.push(resolved.id);
            }
            const narrowed = toPermanentFilter(ctx, op.filter);
            // CR 608.2b — an unresolvable dynamic filter narrows the
            // candidate set to nothing (never to "unfiltered").
            if (narrowed === UNMATCHABLE_FILTER) {
                return { available: 0, candidateIds: [] };
            }
            const filtered = op.filter
                ? ids.filter((id) =>
                      ctx.getBattlefieldIds(zoneOwnerId, narrowed).includes(id)
                  )
                : ids;
            return { available: filtered.length, candidateIds: filtered };
        }
        const filter = toPermanentFilter(ctx, op.filter);
        if (filter === UNMATCHABLE_FILTER) {
            return { available: 0, candidateIds: [] };
        }
        return {
            available: ctx.getBattlefieldIds(zoneOwnerId, filter).length,
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
    if (op.zone === "exile") {
        // Exile — a public zone (CR 400.2), same shape as graveyard: an
        // explicit `candidateIds` allow-list, precomputed via the shared
        // matcher (issue #1156 — Dauthi Voidwalker's `hasCounter` filter,
        // "an exiled card ... with a void counter on it"). No filter — every
        // card in the exile is eligible.
        const exileCards = ctx.getExileCards(zoneOwnerId);
        const ids = op.filter
            ? exileCards
                  .filter((c) => matchesCardFilter(ctx, c, op.filter!))
                  .map((c) => c.id)
            : exileCards.map((c) => c.id);
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

/** Shared tail of `lookDistribute` (issue #984, extended #1266 / #1101): send the
 *  un-kept looked-at cards to `destination`. `pickSet` is the ids that went to
 *  hand; the un-kept set is every looked-at id not in it (incl. filter-
 *  ineligible cards). `chosenBottom`, when non-empty, is the player's ordering
 *  from the unified picker (the ADR 0026 known path); otherwise the cards fall
 *  in look order. `randomBottom` (Narset's "random order") suppresses the
 *  `markKnown` for a `library-bottom` destination — CR 401.4's random order is
 *  unobservable for face-down library cards, so no knowledge is granted;
 *  meaningless for `destination: "graveyard"`/`"exile"` (a public zone,
 *  ADR 0026). `counters` (issue #1570, Karn's silver counter) is stamped on
 *  each un-kept card when `destination` is `"exile"`. */
function bottomLookedAtCards(
    ctx: SpellContext,
    playerId: string,
    topIds: string[],
    pickSet: Set<string>,
    randomBottom: boolean,
    chosenBottom: string[] = [],
    destination: LookDistributeDestination = "library-bottom",
    counters?: Record<string, number>
): void {
    const restTop =
        chosenBottom.length > 0
            ? chosenBottom
            : topIds.filter((id) => !pickSet.has(id));
    if (restTop.length === 0) return;
    if (destination === "graveyard") {
        // CR 401.4 look + CR 614 (issue #1101, Reviving Vapors) — the un-kept
        // looked-at cards go to the graveyard instead of the library bottom,
        // one `moveCardById` per card. `moveCardById` already runs every move
        // through the graveyard-bound-redirect replacement (Yawgmoth's Will /
        // Dauthi Voidwalker) — the exact same primitive `scryReorder`'s
        // Surveil leg uses inline for its own `destination: "graveyard"`. The
        // graveyard is a public zone, so no `markKnown` call (unlike the
        // library-bottom branch below).
        for (const id of restTop) {
            ctx.moveCardById(playerId, id, "library", "graveyard");
        }
        return;
    }
    if (destination === "exile") {
        // CR 400.7 (issue #1570, Karn's +1) — the un-kept looked-at card(s) go
        // to their owner's exile, one `moveCardById` per card, each stamped
        // with `counters` (the silver counter) so a later "a card with a silver
        // counter on it" retrieval finds it. Exile is a public zone like the
        // graveyard leg above: no `markKnown`, no bottom-order pick.
        for (const id of restTop) {
            ctx.moveCardById(playerId, id, "library", "exile");
            if (counters) ctx.stampCardCounters(id, counters);
        }
        return;
    }
    // Everything currently in the library minus the un-kept looked-at cards,
    // then the un-kept cards appended — a full reorder that lands the rest on
    // the true bottom (CR 401.4).
    const all = ctx.peekLibraryTop(playerId, Number.MAX_SAFE_INTEGER);
    const restSet = new Set(restTop);
    const below = all.filter((id) => !restSet.has(id));
    ctx.reorderLibraryTop(playerId, [...below, ...restTop]);
    if (!randomBottom) {
        // ADR 0026 — the bottomed cards were looked at and placed by the
        // controller, so they stay known until a shuffle. A random bottom
        // (Narset) grants no such knowledge.
        ctx.markKnown(playerId, restTop, playerId);
    }
}

/** Default prompt for a `lookDistribute` choice (issue #2070) — varies on
 *  BOTH independent axes (`keepTo` for the kept pile, `destination` for the
 *  un-kept pile) so the wording never claims a card goes to hand when it's
 *  headed to the library top, or vice-versa for the rest. */
function keepPromptFor(
    keepTo: "hand" | "library-top",
    destination: LookDistributeDestination
): string {
    const keepPhrase =
        keepTo === "hand" ? "into your hand" : "on top of your library";
    const restPhrase =
        destination === "graveyard"
            ? "put the rest into your graveyard"
            : destination === "exile"
              ? "put the rest into exile"
              : "order the rest on the bottom of your library";
    return `Choose which card(s) to put ${keepPhrase}, then ${restPhrase}.`;
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
            // CR 120.1 (issue #1416) — when `source` names a bound permanent,
            // THAT permanent is the damage source, not the resolving stack
            // item. Backlash: the tapped creature (`$c`) deals its power to its
            // controller — so infect/lifelink/source-colour prevention and
            // "a source deals damage" triggers key off the creature, not the
            // B/R spell. Routed through the permanent-source pipeline.
            if (op.source) {
                const src = resolveObjectRef(ctx, op.source);
                // CR 608.2b — a source that has left the battlefield deals no
                // damage (the permanent-source primitive is player-only).
                if (src && src.type === "permanent") {
                    // CR 615.12 / 614.9 (issue #2231) — both locks ride the
                    // permanent-source branch too. It used to drop them
                    // silently, so a `source`-bearing Op carrying either flag
                    // was quietly preventable AND redirectable.
                    ctx.dealDamageFromPermanent(
                        src.id,
                        playerId,
                        amount,
                        op.unpreventable,
                        op.unredirectable
                    );
                }
                return;
            }
            ctx.dealDamage(
                { type: "player", id: playerId },
                amount,
                op.unpreventable,
                op.unredirectable
            );
            return;
        }
        const target = resolveObjectRef(ctx, op.to);
        if (target)
            ctx.dealDamage(target, amount, op.unpreventable, op.unredirectable);
    },
    // CR 601.2d / 120.4 — deal `total` damage divided as chosen among the
    // announced target group (`ctx.targets`). The per-target split was chosen at
    // announcement and snapshotted onto the stack item's `targetAmounts`, which
    // the primitive reads; `total` (mirroring `divideAsChosen.total`) is the
    // fallback cap. `"X"` / `"X+1"` resolve against the announced {X} (getX()).
    dealDamageDividedAsChosen(ctx, op) {
        const total =
            op.total === "X"
                ? ctx.getX()
                : op.total === "X+1"
                  ? ctx.getX() + 1
                  : op.total;
        ctx.dealDamageDividedAsChosen(ctx.targets, total);
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
    // CR 119.3 — life gain.
    gainLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.gainLife(playerId, amount);
    },
    // CR 122.1 — "A counter is a marker placed on an object or player": add
    // counters of one kind to the player. One executor for every player-counter
    // kind (poison / energy / experience), the WRITE half of the pair whose
    // READ half is the `playerCounters` value member (issue #1969).
    addPlayerCounter(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.addPlayerCounters(playerId, op.counter, amount);
    },
    // CR 119.3 — life loss (not damage).
    loseLife(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const amount = resolveValue(ctx, op.amount);
        if (amount === undefined || amount <= 0) return;
        ctx.loseLife(playerId, amount);
    },
    // CR 701.9a — random discard: `count` cards chosen AT RANDOM from
    // `player`'s hand (Hymn to Tourach, Mind Twist, Gwendlyn Di Corci). The
    // primitive owns the seeded-PRNG selection (deterministic replays); the
    // `discard` Op discards a player-CHOSEN or whole-hand set instead. Skipped
    // when the player is gone (CR 608.2b); an empty hand is a no-op.
    //
    // Optional `bind` (issue #1123, Aether Rift) snapshots the FIRST
    // discarded card as a `"graveyard-card"` object right after the discard —
    // the card is already sitting in the (public) graveyard by construction,
    // so this is a live read, not last-known information (mirrors `lookDistribute`'s
    // post-move `"hand-card"` bind, not `destroy`/`exile`'s pre-move one). A
    // later `if` (`boundMatchesFilter`) can test what was discarded, and a
    // later `moveZone { target: { ref }, to: "battlefield" }` reanimates it
    // straight off the binding via that Op's existing graveyard-source
    // recovery path (issue #1469 — it re-derives the id from ANY snapshot,
    // not just destroy/exile's). Uncaptured when nothing was discarded (an
    // empty hand, CR 608.2b).
    discardAtRandom(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        const count = resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        const discardedIds = ctx.discardAtRandom(playerId, count);
        if (op.bind && discardedIds.length > 0) {
            bindSnapshot(ctx, op.bind, {
                type: "graveyard-card",
                id: discardedIds[0],
                playerId,
            });
        }
    },
    // CR 400.7 / 607 (issue #1947) — choose a card AT RANDOM from the exile
    // pile linked to $source, and put it into its OWNER's hand (Skyship
    // Weatherlight). A thin declarative skin over `pickRandomCardExiledWith`
    // + `moveCardById`, one execution path (ADR 0045). Skipped (CR 608.2b
    // no-op) when the pile is empty — the official ruling that the ability
    // is still activatable with nothing exiled; it simply does nothing.
    randomExileToHand(ctx) {
        const picked = ctx.pickRandomCardExiledWith(ctx.sourceInstanceId);
        if (!picked) return;
        ctx.moveCardById(picked.ownerId, picked.id, "exile", "hand");
    },
    // CR 500.7 (issue #686) — schedule an extra turn for `player` (Time
    // Warp). Skipped when the player cannot be resolved (CR 608.2b).
    extraTurn(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.takeExtraTurn(playerId);
    },
    // CR 500.8 (issue #2886) — add one additional combat phase to the turn in
    // progress (Fear of Missing Out: "After this phase, there is an additional
    // combat phase"). No fields and nothing to skip on: an extra phase belongs
    // to the TURN, so there is no player ref that could fail to resolve.
    extraCombat(ctx) {
        ctx.grantExtraCombat();
    },
    // CR 614.10 / 614.10a (issue #1957) — `player` skips their next turn
    // (Waterspout Elemental). Skipped when the player cannot be resolved
    // (CR 608.2b). `ctx.setSkipNextTurn` INCREMENTS the pending count, so two
    // resolutions against the same player accumulate to "skip the next two"
    // rather than collapsing to one (CR 614.10a).
    skipNextTurn(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.setSkipNextTurn(playerId);
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
    // CR 504.1 (issue #1097 — Elfhame Sanctuary) — arm a one-shot "skip your
    // draw step this turn" flag on `player`, consumed the next time
    // `drawStep` (`gre/phases.ts`) reaches them. Skipped when the player is
    // gone (CR 608.2b).
    skipDrawStepThisTurn(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.skipDrawStepThisTurn(playerId);
    },
    // CR 601.3e (Teferi, Time Raveler +1) — grant a per-player casting-timing
    // permission: `player` may cast spells whose printed types intersect
    // `cardTypes` (omitted = every spell) as though they had flash, until their
    // next turn. Skipped when the player is gone (CR 608.2b).
    grantCastTiming(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.grantCastTiming(playerId, op.cardTypes);
    },
    // CR 609.4b / 118.14 (issue #2890, North Star) — grant `player` a one-shot
    // "for one spell this turn, you may spend mana as though it were mana of
    // any type/color to pay that spell's mana cost" permission. Skipped when
    // the player is gone (CR 608.2b).
    grantSpellManaSubstitution(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.grantSpellManaSubstitution(playerId, op.breadth);
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
    // CR 601.3e / 117.6 (issue #1156) — grant cast/play permission (optionally
    // a mana-cost waiver) for the exile card a preceding `choice(zone:
    // "exile")` Op picked. The picked card's CURRENT exile owner (looked up
    // live via `getExileCardOwner`, since it may be an OPPONENT's exile —
    // Dauthi Voidwalker) becomes the primitive's `zoneOwnerId`, so this Op
    // supports a cross-player grant with no extra parameters. Skipped when
    // the player can't be resolved, the picks binding was never captured, or
    // the picked card is no longer in any exile (CR 608.2b).
    grantCastFromExile(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        // CR 607 linked abilities (issue #783) — `{ exiledWithSource: true }`
        // names the card(s) THIS ability's own source permanent exiled and
        // stamped via `linkExileToSource` (Hideaway's "you may play the exiled
        // card", CR 702.75). No player choice and no binding: a `bind` cannot
        // span the two separate resolutions of a linked pair of abilities, and
        // the link is the CR's own answer to "which exiled card". Hideaway links
        // exactly one card, but a source that linked several grants all of them
        // — the link IS the identity, so there is nothing to disambiguate.
        let ids: string[] | undefined;
        if ("exiledWithSource" in op.card) {
            ids = ctx.getCardsExiledWith(ctx.sourceInstanceId).map((c) => c.id);
        } else {
            // Historical picks shape: the FIRST pick only (Dauthi Voidwalker
            // picks exactly one card; no shipped card grants over a multi-pick).
            const picks = resolvePicks(ctx, op.card);
            ids = picks && picks.length > 0 ? [picks[0]] : undefined;
        }
        if (!ids || ids.length === 0) return;
        for (const cardInstanceId of ids) {
            const zoneOwnerId = ctx.getExileCardOwner(cardInstanceId);
            if (zoneOwnerId === undefined) continue;
            ctx.grantCastFromExile(
                cardInstanceId,
                playerId,
                zoneOwnerId,
                op.window,
                op.withoutPayingManaCost || op.includesLand
                    ? {
                          withoutPayingManaCost: !!op.withoutPayingManaCost,
                          includesLand: !!op.includesLand,
                      }
                    : undefined
            );
        }
    },
    // CR 601.3e / 117.6-analog (issue #1344) — grant cast permission
    // (optionally a mana-cost waiver) for a graveyard card. Two selector
    // shapes (issue #1650), both `EffectObjectSelector` members:
    //   - a bare PICKS ref — the card a preceding Op bound (typically the
    //     just-discarded card from a `choice(kind: "choose-hand-card")` +
    //     `discard` pair, Malcolm);
    //   - an announced TARGET slot (`{ target: n }`, CR 601.2c) — Emry,
    //     Lurker of the Loch's "{T}: Choose target artifact card in your
    //     graveyard." The slot is read through `resolveTargetRef` and must
    //     still hold a `graveyard-card` selection (CR 608.2b — a target that
    //     left the graveyard between announcement and resolution skips the
    //     Op; the primitive itself re-checks graveyard membership too).
    // Always the grantee's OWN graveyard — no cross-player shape (the
    // graveyard-sourced twin of `grantCastFromExile` above,
    // `SpellContext.grantCastFromGraveyard`'s doc). Skipped when the player
    // can't be resolved, the picks binding was never captured, or the named
    // card is no longer in that player's graveyard (CR 608.2b).
    grantCastFromGraveyard(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        let cardInstanceId: string;
        if ("target" in op.card) {
            const selection = resolveTargetRef(ctx, op.card);
            if (selection?.type !== "graveyard-card") return;
            cardInstanceId = selection.id;
        } else {
            const ids = resolvePicks(ctx, op.card);
            if (!ids || ids.length === 0) return;
            cardInstanceId = ids[0];
        }
        ctx.grantCastFromGraveyard(cardInstanceId, playerId, op.window, {
            ...(op.withoutPayingManaCost
                ? { withoutPayingManaCost: true }
                : {}),
            // issue #2380 — "If that spell would be put into your graveyard,
            // exile it instead" (Jace, Telepath Unbound's −3).
            ...(op.exilesOnResolve ? { exilesOnResolve: true } : {}),
        });
    },
    // CR 608.2g (issue #1477) — play a card as PART OF this resolution: a "you
    // may cast/play <card>" with no stated duration, which exists ONLY during
    // the resolution of the ability that grants it. Reuses the resolve-time
    // mini-cast (`SpellContext.castChosenSpell`, ADR 0037) and the
    // interpreter's own suspend/resume seam. SELF-cast: actingPlayer ==
    // controller == `player`. NO priority passes to the opponent between the
    // offer and the inline cast — the Cast/Decline prompt and the cast card's
    // own target/mode/X picks are resolve-time choices, not priority; normal
    // priority resumes only once the parent ability finishes with the new
    // spell on the stack (CR 608.2g). Timing / card-type restrictions are
    // ignored: CR 117.1a / 302.1 / 307.1 grant their permissions to "a player
    // WHO HAS PRIORITY", and this happens outside priority, so the effect
    // itself is the permission — a creature or sorcery is effectively castable
    // at instant speed, on either player's turn. Distinct from
    // `grantCastFrom*` (which stamp a later-in-turn impulse window) — nothing
    // is saved for later (Malcolm's Oracle ruling; Hideaway's too, #1961).
    //
    // The LAND branch (`includesLand`, issue #1961) is genuinely NARROWER, not
    // instant-speed: playing a land is a SPECIAL ACTION (CR 116.2a) that
    // consumes the drop even mid-resolution (CR 305.2a), can't happen on the
    // opponent's turn (CR 305.3) and can't happen with the drop spent
    // (CR 305.2b). See `getChosenLandPlayable`.
    castDuringResolution(ctx, op) {
        // Idempotent across a re-walk (CR 608.3 — a completed step never
        // re-runs): once the mini-cast has committed (or the Op has terminally
        // passed/declined), a LATER Op suspending would re-walk this Op; a
        // done-marker keyed under this Op's checkpoint short-circuits it so the
        // spell is never cast twice. Keyed on the pre-order checkpoint set by
        // `runOpList` right before dispatch (stable across replays).
        const pos = ctx.getScriptCheckpoint() ?? 0;
        const doneKey = `#castDuringResolution:${pos}`;
        if (ctx.recallChoice(doneKey) !== undefined) return;

        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — caster gone, skip

        // Records the terminal outcome exactly once: the internal done-marker
        // (short-circuits a re-walk, CR 608.3) AND — when the author asked for
        // one — the boolean OUTCOME binding a downstream `if` reads (issue
        // #1478, Chandra's "If you don't [cast it], …"). `cast` is true only
        // when a spell actually reached the stack; a decline, a silent pass, an
        // unmeetable cost, or an unpayable mana cost all read `false` (mirrors
        // `mayPay`'s `["yes"]`/`["no"]` boolean payload).
        const finish = (cast: boolean, marker: string) => {
            ctx.noteChoice(doneKey, [marker]);
            if (op.resultBind !== undefined) {
                ctx.noteChoice(op.resultBind, [cast ? MAYPAY_YES : "no"]);
            }
        };

        // Resolve the card to offer and its effective SOURCE zone. Three shapes:
        //  - `fromTopOfLibrary` (issue #1478, Chandra +1) — exile the top card
        //    of the caster's library UNCONDITIONALLY as the first thing the Op
        //    does (CR 608.2g), then offer that exiled card; a decline / can't-
        //    pay leaves it in exile. The exiled id is persisted under the Op's
        //    checkpoint so a suspend/resume re-walk reuses it rather than
        //    exiling a second card (CR 608.3).
        //  - `card` as a bare picks ref + `source` (issue #1477, Malcolm) — a
        //    card an earlier Op in the SAME script bound, played from its
        //    graveyard/exile source.
        //  - `card` as `{ exiledWithSource: true }` (issue #1961, CR 607 LINKED
        //    abilities — Hideaway's "you may play the exiled card"): the card
        //    THIS ability's own source permanent exiled and stamped via
        //    `linkExileToSource`, read back through `getCardsExiledWith`. No
        //    binding can name it, because the exiling ability and the play
        //    ability are two SEPARATE abilities resolving at different times and
        //    a `bind` cannot span two resolutions — the CR 607 link IS the
        //    identity. Always from exile. Hideaway links exactly one card; a
        //    source that linked several offers the first (the Oracle text says
        //    "THE exiled card", singular).
        let cardInstanceId: string | undefined;
        let sourceZone: "graveyard" | "exile";
        if (op.fromTopOfLibrary) {
            sourceZone = "exile";
            const exiledKey = `#cdrExiled:${pos}`;
            const recalled = ctx.recallChoice(exiledKey);
            if (recalled !== undefined) {
                cardInstanceId = recalled[0];
            } else {
                const topId = ctx.peekLibraryTop(playerId, 1)[0];
                if (topId === undefined) {
                    finish(false, "pass"); // empty library — nothing to exile
                    return;
                }
                ctx.moveCardById(playerId, topId, "library", "exile");
                ctx.noteChoice(exiledKey, [topId]);
                cardInstanceId = topId;
            }
        } else if (op.card !== undefined && "exiledWithSource" in op.card) {
            sourceZone = "exile";
            cardInstanceId = ctx.getCardsExiledWith(ctx.sourceInstanceId)[0]
                ?.id;
        } else if (op.card !== undefined) {
            sourceZone = op.source ?? "exile";
            const ids = resolvePicks(ctx, op.card);
            cardInstanceId = ids && ids.length > 0 ? ids[0] : undefined;
        } else {
            sourceZone = op.source ?? "exile";
            cardInstanceId = undefined;
        }

        // Silent pass (CR 608.2b): the selector resolved to nothing — the
        // binding was never captured, or the CR 607 source linked nothing.
        if (cardInstanceId === undefined) {
            finish(false, "pass");
            return;
        }

        // CR 406.3 — ONE offer shape for the whole Op when it can reach a land:
        // the prompt and the option labels must not differ between the land
        // branch and the cast branch, or the mere wording discloses the hidden
        // card's type to the opponent (`pendingChoices` is projected unredacted
        // and the non-chooser's client renders `prompt` verbatim).
        const offerOptions = op.includesLand
            ? PLAY_DECLINE_OPTIONS
            : CAST_DECLINE_OPTIONS;
        const offerPrompt = op.includesLand
            ? OFFER_PROMPT.play
            : OFFER_PROMPT.cast;

        // CR 116.2a / 305.9 — a LAND is PLAYED, never cast. `includesLand` is
        // set only by a grant whose Oracle text says "play" (Hideaway); without
        // it a land silently passes, which is the official Malcolm land ruling
        // and stays the default for every "cast" grant. A land+other-type card
        // can only be played as a land (CR 305.9), so this branch wins first.
        if (
            op.includesLand &&
            ctx.getChosenLandPlayable(playerId, cardInstanceId, sourceZone)
        ) {
            // "you may PLAY the exiled card" — the same resolve-time
            // `option-pick` as the cast branch, byte-identical in prompt and
            // options (see `OFFER_PROMPT`). The text deliberately does NOT name
            // the card either: a hideaway card is FACE DOWN (CR 406.3, visible
            // only to its controller) and `pendingChoices` crosses the wire
            // unredacted to BOTH viewers, so naming it in the prompt — or
            // pinning it via `subjectCardId` — would leak the hidden identity.
            const landDecision = ctx.requestOptionChoice({
                playerId,
                choiceId: "cdr:decide",
                options: offerOptions,
                prompt: offerPrompt,
            });
            if (landDecision === undefined) return "suspend"; // enqueued — wait
            if (landDecision !== "cast") {
                // Declined — the land stays in its source zone (still face down
                // if it was), nothing enters, and no later-in-turn window is
                // stamped: the CR 608.2g permission dies with this resolution.
                finish(false, "decline");
                return;
            }
            // CR 305.2a — the land enters through the canonical play-land
            // transition and CONSUMES the player's land drop.
            const played = ctx.playLandForPlayer(playerId, cardInstanceId, {
                sourceZone,
            });
            finish(played, played ? "cast" : "pass");
            return;
        }

        // Silent pass (CR 608.2b / the Malcolm land ruling): the card is no
        // longer in the source zone (empty source), or it is a land the grant
        // can't reach — either a "cast"-only grant (no `includesLand`) or a
        // "play" grant whose CR 305 legality failed (opponent's turn per CR
        // 305.3, land drop already spent per CR 305.2b, a CR 614 land-play
        // lock). No prompt is offered at all — the ability finishes silently
        // and the resolution completes cleanly.
        if (!ctx.getChosenCardCastable(playerId, cardInstanceId, sourceZone)) {
            finish(false, "pass");
            return;
        }

        // "you may cast" — a Cast / Decline `option-pick` (Play / Decline for a
        // grant that can also reach a land, identical to the land branch above
        // so the branch taken stays hidden — CR 406.3), a resolve-time choice
        // routed to the caster (CR 608.2g: NOT priority, the opponent cannot act
        // here). Reuses the existing suspend/resume seam.
        const decision = ctx.requestOptionChoice({
            playerId,
            choiceId: "cdr:decide",
            options: offerOptions,
            prompt: offerPrompt,
        });
        if (decision === undefined) return "suspend"; // enqueued — wait
        if (decision !== "cast") {
            // Declined — the card stays in its source zone, nothing is cast,
            // and (unlike `grantCastFrom*`) no later-in-turn window is stamped.
            finish(false, "decline");
            return;
        }

        // MODE (CR 700.2c) — a modal card's chosen mode drives its targeting
        // (CR 700.2d). Non-modal cards skip this.
        const modes = ctx.getCardModes(playerId, cardInstanceId);
        let chosenModeId: string | undefined;
        if (modes.length > 0) {
            const pickedMode = ctx.requestOptionChoice({
                playerId,
                choiceId: "cdr:mode",
                options: modes,
                prompt: "Choose a mode for the card you are casting.",
            });
            if (pickedMode === undefined) return "suspend";
            chosenModeId = pickedMode;
        }

        // X (CR 107.3) — only for a PAID cast. A free cast waives the mana
        // cost, so X in that waived cost is 0 (CR 107.3b) — no prompt.
        let chosenX: number | undefined;
        if (!op.free && ctx.cardHasXCost(playerId, cardInstanceId)) {
            const maxX = ctx.getMaxAffordableX(
                playerId,
                cardInstanceId,
                chosenModeId
            );
            const xOptions = Array.from({ length: maxX + 1 }, (_, n) => ({
                id: String(n),
                label: `X = ${n}`,
            }));
            const pickedX = ctx.requestOptionChoice({
                playerId,
                choiceId: "cdr:x",
                options: xOptions,
                prompt: "Choose the value of X.",
            });
            if (pickedX === undefined) return "suspend";
            chosenX = Number(pickedX);
        }

        // ADDITIONAL COST — sacrifice (CR 118.8). Applies even to a free cast
        // (only the mana cost is waived). No matching permanent => the cost is
        // unmeetable, the card is NOT cast ("if able").
        const sacrificeFilter = ctx.getCardSacrificeFilter(
            playerId,
            cardInstanceId
        );
        let additionalSacrificeId: string | undefined;
        if (sacrificeFilter) {
            const candidateIds = ctx.getBattlefieldIds(
                playerId,
                sacrificeFilter
            );
            if (candidateIds.length === 0) {
                finish(false, "pass"); // unmeetable — not cast
                return;
            }
            const pickedSac = ctx.requestChoice({
                playerId,
                choiceId: "cdr:sacrifice",
                kind: "choose-permanents",
                zone: "battlefield",
                zoneOwnerId: playerId,
                filter: sacrificeFilter,
                candidateIds,
                count: 1,
                prompt: "Choose a permanent to sacrifice.",
            });
            if (pickedSac === undefined) return "suspend";
            additionalSacrificeId = pickedSac[0];
            if (!additionalSacrificeId) return;
        }

        // TARGETS (CR 601.2c) — the caster chooses targets for the cast card
        // (the chosen mode's requirement for a modal card, CR 700.2d). Reuses
        // `getLegalTargetsForCard` exactly as a normal cast does. No legal
        // target => the card is NOT cast ("if able").
        const targetReq = chosenModeId
            ? ctx.getCardModeTargetRequirement(
                  playerId,
                  cardInstanceId,
                  chosenModeId
              )
            : ctx.getCardTargetRequirement(playerId, cardInstanceId);
        let chosenTargets: TargetSelection[] | undefined;
        if (targetReq) {
            const legal = ctx.getLegalTargetsForCard(
                playerId,
                cardInstanceId,
                targetReq
            );
            if (legal.length === 0) {
                finish(false, "pass"); // no legal target — not cast
                return;
            }
            const candidatePlayerIds = legal
                .filter((t) => t.type === "player")
                .map((t) => t.id);
            const candidateIds = legal
                .filter((t) => t.type !== "player")
                .map((t) => t.id);
            const pickedTarget = ctx.requestChoice({
                playerId,
                choiceId: "cdr:target",
                kind: "choose-damage-target",
                zone: "battlefield",
                count: 1,
                candidateIds,
                candidatePlayerIds,
                prompt: "Choose a target for the card you are casting.",
            });
            if (pickedTarget === undefined) return "suspend";
            const pickedId = pickedTarget[0];
            if (!pickedId) return;
            const selected = legal.find((t) => t.id === pickedId);
            if (!selected) return; // pick no longer legal (CR 608.2b)
            chosenTargets = [selected];
        }

        // Commit the mini-cast. Self-cast: actingPlayerId == playerId. The
        // spell is spliced onto the stack just BELOW the resolving ability
        // (`castChosenSpell`) so it becomes the new top and resolves next —
        // with NO priority in between (CR 608.2f). `free` waives the mana cost
        // (Malcolm), `sourceZone` is the zone it is cast from. The boolean
        // return (issue #1478) is `false` when the normal mana cost is
        // unpayable (CR 117.3 / 601.2g) — the card stays in its source zone and
        // the outcome binding reads "not cast" so a downstream `if not $cast`
        // fires (Chandra's 2 damage to each opponent).
        const cast = ctx.castChosenSpell(playerId, cardInstanceId, playerId, {
            targets: chosenTargets,
            chosenX,
            chosenModeId,
            additionalSacrificeId,
            sourceZone,
            free: op.free,
        });
        finish(cast, cast ? "cast" : "pass");
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
    // CR 608.2 (issue #1097) — the resolving spell exiles ITSELF instead of
    // going to the graveyard ("Exile ~", Recall / Restock). A thin
    // declarative skin over the single SpellContext primitive `exileSelf`,
    // ONE execution path (ADR 0045). No parameters to resolve — the
    // primitive flags the CURRENTLY-RESOLVING stack item, mirroring
    // `shuffleSelfIntoLibrary`'s design (issue #898) exactly, so
    // `finalizeSpellResolution` reads the flag once resolution completes.
    exileSelf(ctx) {
        ctx.exileSelf();
    },
    // CR 603.7a / 701.13 / ADR 0028 — exile the announced target keyed to
    // `$source`, arming the exile-and-return bundle (O-Ring / Banishing Light /
    // Tawnos's Coffin). The `sourceId` is ALWAYS the resolving source
    // (`ctx.sourceInstanceId`), so the later `returnExiledForSource` on the
    // source's leaves/untaps trigger restores exactly this bundle. Skipped when
    // the target has left the battlefield (CR 608.2b — `resolveObjectRef`
    // returns undefined). `includeAttachments` defaults FALSE (host-only,
    // the O-Ring default) — the primitive's own default is `true`, so this Op
    // passes an EXPLICIT value rather than relying on the primitive default.
    exileWithAttachments(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.exileWithAttachments(target.id, {
            sourceId: ctx.sourceInstanceId,
            returnTapped: op.returnTapped ?? false,
            includeAttachments: op.includeAttachments ?? false,
            // CR 610.3b — this Op IS the "until THIS leaves the battlefield"
            // family, so the source's departure is the specified event. If it
            // already happened (the O-Ring was destroyed in response to its own
            // ETB trigger), the object doesn't move at all — exiling it here
            // would strand it, since the return trigger has already come and
            // gone with nothing held.
            requireSourceOnBattlefield: true,
        });
    },
    // CR 603.7a / ADR 0028 — return every exile-and-return bundle held by
    // `$source` (the resolving ability's source). No target, no parameters:
    // the source is always `ctx.sourceInstanceId`. A no-op when nothing is
    // held (the primitive early-returns), so a stale fire is harmless.
    returnExiledForSource(ctx) {
        ctx.returnExiledForSource(ctx.sourceInstanceId);
    },
    // CR 608.2h / 400.7 (issue #2384) — persist an in-script snapshot binding
    // onto the resolving SOURCE permanent, so a LATER, SEPARATE ability of the
    // same source can recall it. Reads the row through `ctx.recallChoice`
    // directly rather than `readBinding`, so only a binding THIS resolution
    // actually captured is persisted (re-persisting an already-recalled row
    // would be a no-op, but the narrower read keeps the write half honest).
    // No-op when the binding was never captured — CR 608.2b, the later
    // recall then finds nothing and its readers skip in turn.
    captureBinding(ctx, op) {
        const row = ctx.recallChoice(op.ref);
        if (!row) return;
        ctx.captureBinding(op.ref, row);
    },
    // CR 608.2h (issue #2384) — the READ half: restore the row captured on this
    // source into the CURRENT resolution under `bind`, after which every
    // downstream ref (`{ ref: "$x.manaValue" }`, `{ ref: "$x.owner" }`, …)
    // resolves through the ordinary binding path. Nothing captured → nothing
    // bound, and every reader of that binding skips (CR 608.2b) — which is
    // exactly "the ETB found no legal target, so the leave-trigger makes no
    // token".
    recallCapturedBinding(ctx, op) {
        const row = ctx.recallCapturedBinding(op.bind);
        if (!row) return;
        ctx.noteChoice(op.bind, row);
    },
    // CR 701.3a/701.3c (ADR 0065, issue #1311) — attach $source to the
    // announced target permanent. Only a "permanent" TargetSelection is a
    // legal attach host (the ability's targetRequirement already restricts
    // to "Creature"); any other resolved kind is a no-op.
    attach(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target || target.type !== "permanent") return;
        ctx.attachTo(ctx.sourceInstanceId, target.id);
    },
    // CR 701.3d (ADR 0065, issue #1311) — unattach $source from whatever
    // it's currently attached to. No-op if it isn't attached.
    unattach(ctx) {
        ctx.detachFrom(ctx.sourceInstanceId);
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
    //    interaction (none of the cube cards using it need one); `bind`
    //    (issue #1151, closing #1120 gap 3, `to: "battlefield"` only)
    //    snapshots the entered permanent so a follow-up Op can act on it — a
    //    haste grant + `delayedTrigger` capture for the SPECIFIC creature
    //    (Sneak Attack's "You may put a creature card from your hand onto the
    //    battlefield. That creature gains haste. Sacrifice it at the
    //    beginning of the next end step."); every other destination routes
    //    through `moveCardById(player, id, from, to)` (a tutor). Skipped when
    //    the binding was never captured (no candidates, CR 608.2b) or the
    //    player cannot be resolved.
    //  - `target` (issue #839) — the current zone is inferred from the
    //    object's kind (a permanent is on the battlefield; a graveyard-card is
    //    in the graveyard), so the Op normally carries no `from`. The ONE
    //    exception (issue #1469) is a snapshot `ref` naming an object that has
    //    already LEFT the battlefield ("return each card put into a graveyard
    //    this way" — Sorin, Lord of Innistrad's −6): there is no kind to infer
    //    from, so an explicit `from: "graveyard" | "exile"` re-derives the id
    //    in that zone at execution time, and `tapped` may make the returned
    //    permanent enter tapped (CR 110.5a). Skipped when the
    //    referenced object is gone (CR 608.2b — the spell does as much as it
    //    can), or for a zone pair with no plain-move primitive (a battlefield
    //    permanent to any zone but the hand needs LTB semantics — that is
    //    `destroy`/`exile`, not `moveZone`).
    moveZone(ctx, op) {
        // CR 400.7 (issue #1104) — the FOURTH shape: a filter-driven bulk
        // sweep across one or more zones, no player choice. Checked before
        // the `cards`/whole-zone/target discriminators below (this shape
        // carries neither `cards` nor `target`, but IS distinguished from the
        // whole-zone shape by its `fromZones` array + required `filter`).
        if ("fromZones" in op) {
            const playerId = resolvePlayerRef(ctx, op.player);
            if (playerId === undefined) return;
            for (const zone of op.fromZones) {
                const cards =
                    zone === "hand"
                        ? ctx.getHandCards(playerId)
                        : zone === "library"
                          ? ctx.getLibraryCards(playerId)
                          : zone === "graveyard"
                            ? ctx.getGraveyardCards(playerId)
                            : ctx.getExileCards(playerId);
                for (const card of cards) {
                    if (matchesCardFilter(ctx, card, op.filter)) {
                        ctx.moveCardById(playerId, card.id, zone, op.to);
                    }
                }
            }
            return;
        }
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
                    // `from: "exile"` (issue #1570) is the same reanimation,
                    // sourced from an exile zone instead — the same primitive
                    // the `target`-shape's departed-object return already uses.
                    const entered =
                        op.from === "hand"
                            ? ctx.putFromHandOntoBattlefield(playerId, id)
                            : op.from === "graveyard"
                              ? ctx.returnToBattlefield(
                                    playerId,
                                    id,
                                    "graveyard"
                                )
                              : op.from === "exile"
                                ? ctx.returnToBattlefield(playerId, id, "exile")
                                : ctx.putFromLibraryOntoBattlefield(
                                      playerId,
                                      id
                                  );
                    if (entered && op.tapped) {
                        ctx.tap({ type: "permanent", id });
                    }
                    // issue #1151 (closing #1120 gap 3) — snapshot the
                    // permanent that just entered so a follow-up Op (a haste
                    // grant, a `delayedTrigger` capture) can act on it. The
                    // picked-card idiom this shape serves is always a
                    // `count: { min: 0, max: 1 }` choice (validator note
                    // above), so `ids` holds at most one entry in practice;
                    // a hypothetical multi-pick script would simply have this
                    // binding overwritten to the LAST entered permanent.
                    if (entered && op.bind) {
                        bindSnapshot(ctx, op.bind, {
                            type: "permanent",
                            id,
                        });
                    }
                } else {
                    ctx.moveCardById(playerId, id, op.from, op.to);
                    // CR 400.7 / 607 (issue #1947) — link each just-exiled
                    // card back to this ability's OWN source so a later
                    // "choose a card exiled with ~" ability can name exactly
                    // this pile (`getCardsExiledWith` /
                    // `pickRandomCardExiledWith`) — the same link `hideaway`
                    // stamps for its single exiled card, generalized here to
                    // an arbitrary-count tutor sweep (Skyship Weatherlight).
                    if (op.to === "exile" && op.linkToSource) {
                        ctx.linkExileToSource(id, ctx.sourceInstanceId);
                    }
                }
            }
            return;
        }
        // CR 400.7 (issue #1279) — the THIRD shape: a bulk whole-zone move.
        // Discriminated from the `target`-shape below by the absence of
        // `target` (this shape carries `player`/`from` instead). A thin
        // declarative skin over `ctx.moveZone`, which already moves the
        // ENTIRE zone with no card selector.
        if (!("target" in op)) {
            const playerId = resolvePlayerRef(ctx, op.player);
            if (playerId === undefined) return;
            ctx.moveZone(playerId, op.from, op.to);
            return;
        }
        // issue #1469 — the RETURN-A-DEPARTED-OBJECT shape. An explicit `from`
        // says the ref names an object that has ALREADY left the battlefield
        // ("return each card put into a graveyard THIS WAY" — Sorin, Lord of
        // Innistrad's −6), so its zone can NOT be inferred from the snapshot's
        // kind. Skip the battlefield-scoped resolution entirely and re-derive
        // the id in `from` at execution time: a target that survived the
        // preceding `destroy` (indestructible / regenerated) is still ON the
        // battlefield and must NOT be "returned" (it never left, CR 608.2b) —
        // resolving it as a permanent first would be exactly that mistake.
        //
        // CR 404.3 (issue #1967) — the FIFTH shape: a DETERMINISTIC positional
        // pick out of the ordered graveyard ("the top creature card of your
        // graveyard" — Shallow Grave, Corpse Dance). It rides the `target`
        // field like the announced-slot shape, but its value is an
        // `EffectZonePositionSelector` (`{ zone, position, filter?, player? }`)
        // rather than a slot/ref, so the battlefield-scoped `resolveObjectRef`
        // path below never applies to it — resolve it here and let the shared
        // graveyard-card executor do the actual move.
        const positional =
            "zone" in op.target
                ? (op.target as EffectZonePositionSelector)
                : undefined;
        // CR 607 (issue #1319 foundation, generalized #1323) — the SIXTH
        // shape: `target` is the linked-exile selector rather than a
        // slot/ref/positional pick. Like the positional shape, resolve it
        // here and let the shared graveyard-card executor below do the
        // actual move — `resolveExiledWithSource` already returns the
        // shared `"graveyard-card"` carrier, and its owner is re-derived as
        // "exile" by that executor's own existing fallback (the card is
        // never actually found in any graveyard).
        const exiledWithSource =
            !positional && "exiledWithSource" in op.target
                ? (op.target as EffectExiledWithSourceSelector)
                : undefined;
        const explicitFrom =
            !positional && !exiledWithSource && "from" in op
                ? op.from
                : undefined;
        let target = positional
            ? resolveGraveyardPosition(ctx, positional)
            : exiledWithSource
              ? resolveExiledWithSource(
                    ctx,
                    "filter" in op ? op.filter : undefined
                )
              : explicitFrom
                ? undefined
                : resolveObjectRef(ctx, op.target as EffectObjectSelector);
        // The zone the recovered card was actually found in — always the
        // graveyard on the historical inferred path, `op.from` on the #1469
        // explicit path.
        let recoveredZone: "graveyard" | "exile" = "graveyard";
        // Graveyard-source recovery (CR 400.7): `resolveObjectRef` is
        // battlefield-scoped, so a ref to a card sitting in a graveyard resolves
        // to undefined. `moveZone` is the only Op whose graveyard → battlefield
        // branch can act on it, so recover the graveyard-card selection here from
        // the ref's id — the source reanimating itself (Ashen Ghoul's `$source`,
        // issue #737) or a `forEach { set: "graveyard" }` member reanimating
        // (`$each`, issue #1056 — Replenish, Living Death).
        if (!positional && !exiledWithSource && !target && "ref" in op.target) {
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
                    // issue #1469 — `from: "exile"` re-derives the departed
                    // object in an EXILE zone instead (an `exile` Op's own
                    // bind, or a `graveyardDestinationFor` replacement that
                    // redirected the dying permanent to exile — in which case
                    // a `from: "graveyard"` return correctly finds nothing).
                    const zone = explicitFrom ?? "graveyard";
                    const owner =
                        zone === "exile"
                            ? ctx.getExileCardOwner(gid)
                            : ctx.getGraveyardCardOwner(gid);
                    if (owner !== undefined) {
                        recoveredZone = zone;
                        // The `graveyard-card` carrier is the generic
                        // "card sitting in a non-battlefield zone" selection
                        // shape; `recoveredZone` is what the move below acts
                        // on, so an exile-sourced return is not mis-zoned.
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
            // Battlefield source (CR 110). The bounce-to-hand pair (CR 400.7)
            // and the positional library insert (issue #1726) both route
            // through LTB-aware primitives; other destinations from the
            // battlefield are skipped (destroy/exile are their own Ops).
            if (op.to === "hand") {
                if (op.bind) bindSnapshot(ctx, op.bind, target);
                ctx.returnToHand(target);
            } else if (op.to === "library") {
                // issue #1726 — "put target … into its owner's library third
                // from the top" (Teferi, Hero of Dominaria's −3). An omitted
                // `position` puts the permanent on TOP (the "put on top of
                // its owner's library" default).
                if (op.bind) bindSnapshot(ctx, op.bind, target);
                ctx.putIntoLibraryFromBattlefield(
                    target,
                    ("position" in op ? op.position : undefined) ?? 1
                );
            }
            return;
        }
        if (target.type === "graveyard-card") {
            const owner = target.playerId;
            if (owner === undefined) return; // CR 608.2b — zone owner unknown
            // issue #1401 — the "blink" shape: `resolveObjectRef`'s own
            // exile-zone fallback (above) resolves an `exile` Op's bind
            // directly, with no explicit `from`, so `recoveredZone` is still
            // sitting at its "graveyard" default. Re-derive it from where the
            // card is ACTUALLY sitting so `returnToBattlefield`/`moveCardById`
            // below target the right pile — a real graveyard-card target
            // (the historical inferred/#1469-explicit paths) leaves this a
            // no-op since it's already found there.
            if (
                recoveredZone === "graveyard" &&
                ctx.getGraveyardCardOwner(target.id) === undefined &&
                ctx.getExileCardOwner(target.id) !== undefined
            ) {
                recoveredZone = "exile";
            }
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
                const entered = ctx.returnToBattlefield(
                    owner,
                    target.id,
                    recoveredZone,
                    controllerId
                );
                // CR 110.5a (issue #1469) — enter tapped. Mirrors the
                // `cards`-shape's own `tapped` handling: a direct `tap`
                // immediately after entry, a simplification that skips any
                // "as this enters tapped" replacement interaction.
                if (entered && op.tapped) {
                    ctx.tap({ type: "permanent", id: target.id });
                }
                return;
            }
            // A plain graveyard/exile → hand/library/exile/graveyard move by
            // id (Raise Dead, Grave Robbers). `battlefield` was handled
            // above, so the destination here is a MovableZone; `recoveredZone`
            // (re-derived above) is the source, not a hardcoded "graveyard".
            ctx.moveCardById(owner, target.id, recoveredZone, op.to);
            // CR 400.7 / 607 (issue #1947, generalized #1323) — link the
            // just-exiled card back to this ability's OWN source so a LATER
            // "put a card exiled with ~ onto the battlefield" ability can
            // name exactly this card (`getCardsExiledWith` / this Op's own
            // `exiledWithSource` target shape above) — the single-target
            // twin of the `cards`-shape's own `linkToSource` (Emperor of
            // Bones: "exile up to one target card from a graveyard", later
            // "a creature card exiled with this creature").
            if (op.to === "exile" && "linkToSource" in op && op.linkToSource) {
                ctx.linkExileToSource(target.id, ctx.sourceInstanceId);
            }
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
    // CR 611.2a / 613.1f (issue #843) — grant a keyword static ability to a
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
            // CR 611.2b (issue #1746) — an omitted `duration` is an INDEFINITE
            // grant ("… and has flying and first strike", Figure of Destiny):
            // route to the permanent-grant primitive, which records the grant
            // with no duration so the phase-boundary purge never ticks it out.
            if (op.duration === undefined) {
                ctx.grantStaticAbilityPermanent(target, op.ability);
            } else {
                ctx.grantStaticAbility(target, op.ability, op.duration);
            }
        }
        if (op.grantedActivatedId) {
            // CR 611.2c (issue #1880) — an omitted `duration` is an INDEFINITE
            // activated-ability grant (Urza's Saga chapters I / II): the effect
            // is generated by a resolving ability, so it does not depend on its
            // source remaining on the battlefield and never expires on its own.
            // Mirrors the keyword and triggered legs' duration split; both
            // primitives exist.
            if (op.duration === undefined) {
                ctx.grantActivatedAbilityPermanent(
                    target,
                    ctx.sourceCardId,
                    op.grantedActivatedId
                );
            } else {
                ctx.grantActivatedAbility(
                    target,
                    ctx.sourceCardId,
                    op.grantedActivatedId,
                    op.duration
                );
            }
        }
        if (op.grantedTriggeredId) {
            // CR 113.1 / 611.2a (issue #1665) — a TRIGGERED-ability grant whose
            // template lives on the resolving source's
            // `triggeredGrantTemplates[]` (Guardian Scalelord's Backup 1
            // handing the target creature the attack trigger printed below the
            // Backup line, CR 702.165c). Mirrors the keyword leg's
            // duration/indefinite split (CR 611.2b): both primitives exist.
            if (op.duration === undefined) {
                ctx.grantTriggeredAbilityPermanent(
                    target,
                    ctx.sourceCardId,
                    op.grantedTriggeredId
                );
            } else {
                ctx.grantTriggeredAbility(
                    target,
                    ctx.sourceCardId,
                    op.grantedTriggeredId,
                    op.duration
                );
            }
        }
    },
    // CR 613.1d layer 4 (issue #1194) — add a subtype to a permanent
    // INDEFINITELY, in addition to its other types. A thin declarative skin
    // over `addSubtype`, ONE execution path (ADR 0045). Skipped when the
    // target is gone (CR 608.2b — `resolveObjectRef` returns undefined). No
    // duration — the resolving-ability effect doesn't depend on its source
    // staying in play (CR 611.2c), unlike the aura-style `subtype-add`
    // continuous static effect.
    addSubtype(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        // CR 303.4 — "it becomes an Aura with enchant creature": the enchant
        // clause is granted together with the subtype. `host` is resolved to a
        // concrete instance id HERE, at grant time, so what gets stored on the
        // instance is plain JSON (the CR 303.4 "specific object" form names an
        // object, and that object is whatever the ref pointed at now). A
        // `host` ref that resolves to nothing (the named permanent already
        // left, CR 608.2b) yields no `hostId` clause rather than a restriction
        // nothing can satisfy.
        const spec = op.enchantRestriction;
        if (!spec) {
            ctx.addSubtype(target, op.subtype);
            return;
        }
        const host = spec.host ? resolveObjectRef(ctx, spec.host) : undefined;
        ctx.addSubtype(target, op.subtype, {
            ...(spec.types ? { types: spec.types } : {}),
            ...(spec.players ? { players: true } : {}),
            ...(host && host.type === "permanent" ? { hostId: host.id } : {}),
        });
    },
    // CR 613.1e layer 5 (issue #1083) — set a target's color(s), replacing all
    // other derivation. A thin declarative skin over `setColorOverride`, ONE
    // execution path (ADR 0045). Skipped when the referenced object is gone
    // (CR 608.2b — `resolveObjectRef` returns undefined); the primitive itself
    // ignores `duration` for a non-permanent (spell) target.
    setColor(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.setColorOverride(target, op.colors, op.duration);
    },
    // CR 305.7 layer 4 (issue #1083) — replace a target land's subtypes for a
    // limited duration. A thin declarative skin over `setSubtypesUntil`, ONE
    // execution path (ADR 0045). Skipped when the referenced permanent is
    // gone (CR 608.2b — `resolveObjectRef` returns undefined); the primitive
    // itself no-ops for a non-permanent target.
    setSubtype(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        // CR 611.2b (issue #1746) — an omitted `duration` REPLACES the subtypes
        // INDEFINITELY ("this creature becomes a Kithkin Spirit", Figure of
        // Destiny): the pre-existing `setSubtypes` primitive (Living Lands'
        // resolve() closures) is exactly that effect, so no new primitive.
        if (op.duration === undefined) {
            ctx.setSubtypes(target, op.subtypes);
        } else {
            ctx.setSubtypesUntil(target, op.subtypes, op.duration);
        }
    },
    // CR 208.2 / 611.1 (issue #1317) — turn a permanent into a creature with
    // the given base P/T, optional subtype/additionalTypes/grantedAbilities,
    // for `duration` or INDEFINITELY when `duration` is omitted (CR 611.2b —
    // Earthbend N). A thin declarative skin over `animateAsCreature`, ONE
    // execution path (ADR 0045). Skipped when the target is gone (CR 608.2b).
    animate(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.animateAsCreature(target, {
            power: op.power,
            toughness: op.toughness,
            subtype: op.subtype,
            additionalTypes: op.additionalTypes,
            grantedAbilities: op.grantedAbilities,
            // Layer 5 (CR 613.1e / 105.3) — "becomes a 3/2 blue and black
            // Elemental creature". Handed to the primitive, which routes it
            // through the SAME `setColorOverride` machinery the `setColor` Op
            // skins so the colour reverts with the animation.
            colors: op.colors,
            duration: op.duration,
        });
    },
    // CR 613.4b layer 7b (issue #1318) — SET a permanent's base power and/or
    // toughness to a fixed value for `duration`. A thin declarative skin over
    // `SpellContext.setBasePT`, one execution path (ADR 0045). An omitted
    // `power`/`toughness` passes `undefined` straight through — the primitive
    // leaves that stat untouched (Island of Wak-Wak's power-only set). Skipped
    // when the referenced permanent is gone (CR 608.2b).
    setBasePT(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        // CR 611.2b (issue #1746) — an omitted `duration` is the primitive's
        // pre-existing `"indefinite"` sentinel (Wall of Tombstones), now
        // reachable from the DSL.
        ctx.setBasePT(
            target,
            op.power,
            op.toughness,
            op.duration ?? "indefinite"
        );
    },
    // CR 205.1a layer 4 (issue #2361) — SET a permanent's card types,
    // REPLACING every type it currently has, indefinitely (CR 611.2c). A thin
    // declarative skin over `setCardTypes`, ONE execution path (ADR 0045).
    // Skipped when the referenced permanent is gone (CR 608.2b —
    // `resolveObjectRef` returns undefined); the primitive itself no-ops for a
    // non-permanent target.
    setCardTypes(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.setCardTypes(target, op.types);
    },
    // CR 613.1f layer 6 (issue #2361) — the target permanent LOSES ALL
    // ABILITIES indefinitely (CR 611.2c — Oko, Thief of Crowns' `+1`). A thin
    // declarative skin over `loseAllAbilities`, ONE execution path (ADR 0045):
    // the same applier the continuous `ability-loss` static effect (Titania's
    // Song) writes through, so keyword, activated, triggered and intrinsic
    // mana abilities all stop functioning by one mechanism. Skipped when the
    // referenced permanent is gone (CR 608.2b).
    loseAllAbilities(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.loseAllAbilities(target);
    },
    // CR 613.1f layer 6 / CR 611.2b (issue #1562) — the target permanent
    // LOSES ALL ABILITIES for as long as the CURRENTLY-RESOLVING permanent
    // remains on the battlefield (Tishana's Tidebinder's counter-then-rider).
    // `target` is an ANNOUNCED SLOT read via `resolveTargetRef` — NOT
    // `resolveObjectRef` — because the counter+rider template targets an
    // activated/triggered ABILITY on the stack, not a permanent directly, a
    // shape `resolveObjectRef`'s battlefield-only check would reject
    // outright. The permanent's real battlefield id is `target.stackSourceId`
    // (`TargetSelection.stackSourceId`, issue #1562 fixup) — captured at
    // target-selection time as `triggerSourceId ?? id`, NOT `target.id`
    // itself: CR 113.7a's countered-ability stack item borrows its SOURCE
    // PERMANENT's own battlefield id ONLY for an ACTIVATED ability
    // (`buildActivatedAbilityStackItem` clones the source); a TRIGGERED
    // ability's stack item carries a FRESH id with the real permanent in
    // `triggerSourceId` (`gre/triggers.ts` `buildTriggerItem`), and by the
    // time this Op runs the preceding `counter` Op has already spliced the
    // item off `state.stack` — nothing later could recover `triggerSourceId`
    // from the stack itself. Reading `target.id` here silently no-ops for
    // EVERY countered triggered ability. Optional `filter` gates the strip on
    // the target's LIVE battlefield characteristics, read through the SAME
    // battlefield-guaranteed matcher `objectMatchesFilter` uses. Skipped when
    // the slot is missing (CR 608.2b) or `filter` doesn't match.
    loseAllAbilitiesWhileSourceRemains(ctx, op) {
        const target = resolveTargetRef(ctx, op.target);
        if (!target) return;
        const sourceId = target.stackSourceId ?? target.id;
        if (op.filter) {
            const base = toPermanentFilter(ctx, op.filter);
            if (base === UNMATCHABLE_FILTER) return;
            const filter = { ...(base ?? {}), instanceIds: [sourceId] };
            const onBattlefield = ctx.allPlayerIds.some(
                (pid) => ctx.getBattlefieldIds(pid, filter).length > 0
            );
            if (!onBattlefield) return;
        }
        ctx.loseAllAbilitiesWhileSourceRemains(sourceId);
    },
    // CR 701.24 (issue #844) — shuffle a player's library. A thin declarative
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
    // CR 401.4 look / CR 701.22 Scry / 701.25 Surveil / order-only (issue
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
        // Fateseal (issue #1532) — when `chooser` names a player other than the
        // library owner, the CONTROLLER decides top/bottom while looking at the
        // TARGET player's library (Jace, the Mind Sculptor +2). Skip the whole
        // effect if the chooser is gone (CR 608.2b). Undefined = owner chooses.
        const chooserId =
            op.chooser === undefined
                ? undefined
                : resolvePlayerRef(ctx, op.chooser);
        if (op.chooser !== undefined && chooserId === undefined) return;
        const applied = ctx.orderTop(playerId, count, {
            destination: op.destination,
            prompt: op.prompt,
            chooserId,
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
        const milledIds = ctx.millCards(playerId, count);
        // issue #1095 — snapshot the FIRST genuinely-milled card (CR 608.2h)
        // so "if a land card was milled this way" (Loafing Giant) can read its
        // last-known types off the binding. Mirrors `discardAtRandom`'s bind
        // exactly, down to the graveyard-card snapshot kind. Uncaptured when
        // nothing landed in a graveyard — an empty library, or every card
        // redirected to exile by a CR 614 replacement (that card was exiled,
        // not milled, so it must NOT satisfy the gate). CR 608.2b.
        if (op.bind && milledIds.length > 0) {
            bindSnapshot(ctx, op.bind, {
                type: "graveyard-card",
                id: milledIds[0],
                playerId,
            });
        }
    },
    // CR 701.20a + CR 400.7 — reveal the top `count` card(s) of a library and
    // route each one by WHAT IT IS: "Reveal the top card of your library. If
    // it's a land card, put it onto the battlefield. Otherwise, put it into
    // your hand." (Nadu, Winged Wisdom). A thin declarative skin over existing
    // primitives, ONE execution path (ADR 0045): `peekLibraryTop` names the
    // window, `markKnownToAll` + `notifyReveal` make it public (the same pair
    // `lookDistribute`'s reveal leg fires), and each card leaves the library through
    // `putFromLibraryOntoBattlefield` or `moveCardById` — the exact two
    // primitives `moveZone`'s `cards` shape already dispatches between.
    //
    // DETERMINISTIC — the destination is dictated by the revealed card's own
    // characteristics, so unlike `lookDistribute` / `scryReorder` /
    // `revealAndCategorize` there is nothing to pick and this Op never
    // suspends. Skipped when the player is gone, `count` ≤ 0, or the library
    // is empty (CR 608.2b — an empty library reveals nothing, and fires no
    // reveal dialog).
    revealTopAndRoute(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const count = op.count === undefined ? 1 : resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        const topIds = ctx.peekLibraryTop(playerId, count);
        if (topIds.length === 0) return; // CR 608.2b — empty library
        // Snapshot the revealed cards' characteristics BEFORE any of them move:
        // routing card 1 onto the battlefield mutates the library, and a later
        // card's filter must still be read against what was revealed.
        const revealed = new Map(
            ctx
                .getLibraryCards(playerId)
                .filter((c) => topIds.includes(c.id))
                .map((c) => [c.id, c])
        );
        // CR 701.20a — the reveal is public and happens BEFORE the cards are
        // routed: `markKnownToAll` is the persistent grant (a card revealed on
        // its way to hand stays visible to the opponent), `notifyReveal` is the
        // transient dialog. Fired exactly once — this Op never suspends, so
        // there is no resumed pass that could double-pop it.
        ctx.markKnownToAll(playerId, topIds);
        ctx.notifyReveal(
            [...ctx.allPlayerIds],
            topIds,
            ctx.sourceCardId,
            "reveal"
        );
        for (const id of topIds) {
            const card = revealed.get(id);
            if (card === undefined) continue; // CR 608.2b — no longer there
            // FIRST MATCH WINS across the ordered `routes`; no match falls
            // through to `fallback` (the Oracle text's "Otherwise, …").
            const route = op.routes.find((r) =>
                matchesCardFilter(ctx, card, r.filter)
            );
            const destination = route?.to ?? op.fallback;
            if (destination === "battlefield") {
                ctx.putFromLibraryOntoBattlefield(playerId, id);
            } else {
                ctx.moveCardById(playerId, id, "library", destination);
            }
        }
    },
    // CR 401.4 (issue #984, extended #1101, renamed + `keepTo` #2070) — look
    // at the top `look` cards, put `take` (default 1) to `keepTo` (HAND or
    // the LIBRARY TOP — Thassa's Oracle), the rest to `destination` (the
    // library BOTTOM by default, or the GRAVEYARD — Reviving Vapors). A thin
    // declarative skin composed of existing primitives (the Stock Up
    // composition generalized), ONE execution path (ADR 0045). SUSPENDS like
    // `choice` / `scryReorder`: a single `look-distribute` `requestChoice`
    // over exactly the looked-at ids (candidateIds — projected face-up as
    // `libraryPeek`, never the whole hidden library) drives the unified
    // KEEP/second pick; the first execution enqueues it and reports
    // "suspend", the resumed execution reads the two ordered lists back and
    // finishes the moves. The kept cards move to `keepTo`
    // (`moveCardById`→hand, or `putLibraryCardsOnTop`→library top); the
    // un-kept looked-at cards go to `destination` via `bottomLookedAtCards`
    // (bottomed + marked known, ADR 0026, for the library-bottom default;
    // moved straight to the graveyard, no `markKnown`, for the graveyard leg
    // — issue #1101). The count is EXACTLY `keep` ({min,max}=keep unless
    // `optional`), so the two lists always partition the looked-at set.
    // Skipped when the player is gone, `look` ≤ 0, or the library is empty
    // (CR 608.2b — never suspends then). `op.reveal` (CR 701.20a) turns the
    // private look into a PUBLIC reveal — see the two guarded sites below
    // ("window" vs "kept").
    lookDistribute(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        // Chooser≠zone-owner seam (issue #1570, Karn's +1 "an opponent chooses
        // one of them") — the CHOOSER picks from `playerId`'s library, mirroring
        // `scryReorder`'s `chooser` (issue #1532). Default = the library owner
        // (every card shipped before #1570). Unresolvable chooser skips (CR 608.2b).
        const chooserId =
            op.chooser === undefined
                ? playerId
                : resolvePlayerRef(ctx, op.chooser);
        if (chooserId === undefined) return;
        const look = resolveValue(ctx, op.look);
        if (look === undefined || look <= 0) return;
        const topIds = ctx.peekLibraryTop(playerId, look);
        if (topIds.length === 0) return; // empty library — no look, no suspend
        const take = op.take === undefined ? 1 : resolveValue(ctx, op.take);
        if (take === undefined || take <= 0) return;
        const optional = op.optional === true;
        const randomBottom = op.randomBottom === true;
        const destination = op.destination ?? "library-bottom";
        // Keep-eligible subset: with a `filter` (Narset's "noncreature, nonland
        // card") only the looked-at cards matching it may be kept; the rest
        // (incl. filtered-out cards) always go to `destination` (issue #1266).
        // The whole looked-at window is still SHOWN face-up ("look at the top
        // four") — only the KEEP pile is gated, via the `eligibleIds`
        // allow-list, so `candidateIds` stays the full window and the peek
        // reveals all of it.
        let eligible: string[] | undefined;
        if (op.filter) {
            const filter = op.filter;
            const byId = new Map(
                ctx.getLibraryCards(playerId).map((c) => [c.id, c])
            );
            eligible = topIds.filter((id) => {
                const c = byId.get(id);
                return c !== undefined && matchesCardFilter(ctx, c, filter);
            });
        }
        const keep = Math.min(take, (eligible ?? topIds).length);
        // Nothing takeable (filter matched nothing, or take clamped to 0): no
        // real choice — skip straight to sending the looked-at cards to
        // `destination`. Auto-resolve over a zero-branch pick rather than
        // prompt an empty picker (the Arena UX default for choice-less
        // resolutions). No `bind` either — nothing was kept (CR 608.2b).
        if (keep === 0) {
            // "Reveal the top N" (op.reveal === "window", CR 701.20a) still
            // reveals the whole window to every player even when nothing is
            // kept (bng-style "you may put a land ... — none found"): the
            // transient reveal dialog fires here, on this single-execution
            // no-suspend path, so it never double-pops. Nothing is kept, so
            // no persistent known-to-all grant is needed (the rest head to a
            // public graveyard or a hidden random bottom, handled below).
            if (op.reveal === "window") {
                ctx.notifyReveal(
                    [...ctx.allPlayerIds],
                    topIds,
                    ctx.sourceCardId,
                    "reveal"
                );
            }
            bottomLookedAtCards(
                ctx,
                playerId,
                topIds,
                new Set(),
                randomBottom,
                [],
                destination,
                op.counters
            );
            return;
        }
        const picks = ctx.requestChoice({
            playerId: chooserId,
            // A fixed choiceId is unique per Op position: the pipeline keys on
            // `step:choiceId` and `step` IS this Op's checkpointed position, so
            // two lookDistribute Ops at different positions never collide.
            choiceId: "dig-to-hand",
            kind: "look-distribute",
            zone: "library",
            // The chooser picks from `playerId`'s library (Karn's "an opponent
            // chooses one of them") — `zoneOwnerId` names the library owner when
            // it differs from the chooser, the same seam `scryReorder`'s
            // fateseal uses. The peek is exposed to the chooser; the kept/un-kept
            // moves still run against `playerId`'s library.
            ...(chooserId !== playerId ? { zoneOwnerId: playerId } : {}),
            // The FULL looked-at window is shown (candidateIds); `eligibleIds`
            // (when a filter is present) restricts which of those may be
            // kept — the filtered-out cards can only go to `destination`.
            candidateIds: topIds,
            eligibleIds: eligible,
            // `optional` ("you may") allows keeping 0; otherwise EXACTLY `keep`.
            // The picker partitions the rest to the second zone (submit
            // validates the partition) unless `randomBottom` discards the order.
            count: { min: optional ? 0 : keep, max: keep },
            destination,
            // `keepTo` (issue #2070) — where the keep-pile itself lands;
            // carried on the PendingChoice so the frontend picker labels the
            // pile correctly ("Hand" vs "Top of library") without guessing
            // from `destination` (the UN-kept cards' target, orthogonal).
            keepTo: op.keepTo,
            // Narset's random bottom: nothing for the picker to order — the
            // client mounts the simple grid pick instead of the drag picker.
            randomizeRest: randomBottom ? true : undefined,
            prompt: op.prompt ?? keepPromptFor(op.keepTo, destination),
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        // Public reveal (CR 701.20a), fired ONCE here on the resumed pass (the
        // pre-`requestChoice` code re-runs on resume, so anything above would
        // double-pop the dialog). Two scopes:
        //   - "window" ("Reveal the top N ..."): the whole looked-at window is
        //     shown in the reveal dialog — the opponent sees every revealed
        //     card (Reviving Vapors, Torsten).
        //   - "kept" ("Look at the top N ... you may reveal a card you keep"):
        //     only the cards actually taken are shown (War-blue / Narset).
        // Either way only the KEPT cards get the PERSISTENT known-to-all grant
        // (they ride into hand and must stay visible — the "eye" + opponent
        // view); the un-kept cards keep their destination's own visibility
        // (public graveyard, or hidden random bottom), so a revealed card put
        // back on a random bottom is NOT leaked by a stale knownTo stamp.
        if (op.reveal !== undefined && picks.length > 0) {
            ctx.markKnownToAll(playerId, picks);
        }
        if (op.reveal !== undefined) {
            ctx.notifyReveal(
                [...ctx.allPlayerIds],
                op.reveal === "window" ? topIds : picks,
                ctx.sourceCardId,
                "reveal"
            );
        }
        // Resume — the kept cards go to `keepTo` (issue #2070). A picked id
        // that has since left the library is a no-op in `moveCardById` /
        // `putLibraryCardsOnTop` alike (CR 608.2b).
        if (op.keepTo === "hand") {
            for (const id of picks)
                ctx.moveCardById(playerId, id, "library", "hand");
        } else {
            // "library-top" (Thassa's Oracle) — `picks[0]` (the first kept
            // id) ends up the very top when more than one is kept, mirroring
            // `putLibraryCardsOnTop`'s own ordering contract.
            ctx.putLibraryCardsOnTop(playerId, picks);
        }
        // `bind` (issue #1101) — snapshot the FIRST kept card so a later Op
        // (e.g. `gainLife`'s `manaValue: { of: { ref: op.bind } }`, Reviving
        // Vapors) can read it back through the ordinary object-ref path.
        // SCOPE (issue #2070): only exercised with `keepTo: "hand"` today —
        // the card is ALREADY in hand at this point, and `bindSnapshot`'s
        // non-permanent branch reads `target.playerId` for controller/owner
        // and `ctx.getManaValue` for the mana-value slot, both of which work
        // for a `"hand-card"` target (unlike destroy/exile's PRE-move
        // snapshot, there's no last-known-info need here: the object still
        // physically sits in the hand array `resolveObjectRef`'s fallback
        // re-reads). No shipped `keepTo: "library-top"` card binds yet.
        if (op.bind && op.keepTo === "hand" && picks.length > 0) {
            bindSnapshot(ctx, op.bind, {
                type: "hand-card",
                id: picks[0],
                playerId,
            });
        }
        const pickSet = new Set(picks);
        // The un-kept looked-at cards (every looked-at id not taken, incl. the
        // filtered-out ones) go to `destination`.
        const chosenBottom = randomBottom
            ? []
            : ctx.readOrderedSecond("dig-to-hand");
        bottomLookedAtCards(
            ctx,
            playerId,
            topIds,
            pickSet,
            randomBottom,
            chosenBottom,
            destination,
            op.counters
        );
    },
    // CR 702.75a (issue #783) — HIDEAWAY: look at the top `look` cards, exile
    // ONE face down (visible to its controller alone, CR 406.3), and bottom the
    // rest in a random order (CR 401.4). Structurally `lookDistribute` with the kept
    // card routed to face-down, source-LINKED exile instead of to hand, and it
    // reuses lookDistribute's whole tail verbatim: the same `look-distribute`
    // `requestChoice` and the same `bottomLookedAtCards` split. The link
    // (`linkExileToSource`, CR 607) is what a LATER "you may play the exiled
    // card" ability on the same permanent reads back — `grantCastFromExile`'s
    // `{ exiledWithSource: true }` selector. Skipped (never suspends) when the
    // player is gone, `look` <= 0, or the library is empty (CR 608.2b).
    hideaway(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const look = resolveValue(ctx, op.look);
        if (look === undefined || look <= 0) return;
        const topIds = ctx.peekLibraryTop(playerId, look);
        if (topIds.length === 0) return; // empty library — no look, no suspend
        const picks = ctx.requestChoice({
            playerId,
            // A fixed choiceId is unique per Op position: the pipeline keys on
            // `step:choiceId` and `step` IS this Op's checkpointed position.
            choiceId: "hideaway",
            kind: "look-distribute",
            zone: "library",
            candidateIds: topIds,
            // CR 702.75a exiles EXACTLY one of the looked-at cards — not a
            // "may", and never more than one.
            count: { min: 1, max: 1 },
            destination: "library-bottom",
            // "put the rest on the bottom ... in a RANDOM order" — no ordering
            // pick for the client to mount, and no knowledge granted below.
            randomizeRest: true,
            prompt:
                op.prompt ??
                "Choose a card to exile face down; the rest go on the bottom of your library in a random order.",
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        const chosen = picks[0];
        if (chosen !== undefined) {
            // CR 702.75a / 406.3 — exiled FACE DOWN, and the permanent's
            // controller (and only they) may look at it for as long as it stays
            // in exile. `exileFaceDown` grants `knownTo: [controller]`, which is
            // exactly the per-viewer gate `projectExileCard` re-derives on the
            // wire: the controller's projection carries the real identity, every
            // other viewer's carries the face-down sentinel.
            // CR 702.75a hideaway exiles the card FACE DOWN outright, so it
            // is face down to its controller too — they may LOOK (issue #2904).
            ctx.exileFaceDown(
                playerId,
                chosen,
                "library",
                playerId,
                "face-down-exile"
            );
            // CR 607 / 702.75a — link the exiled card to THIS permanent so the
            // later "play the exiled card" ability can only ever reach the card
            // this ability exiled.
            ctx.linkExileToSource(chosen, ctx.sourceInstanceId);
        }
        // The un-exiled looked-at cards go to the true bottom, unordered and
        // unknown (`randomBottom` = true). The exiled card is already out of the
        // library, so it can never be re-bottomed here.
        bottomLookedAtCards(
            ctx,
            playerId,
            topIds,
            new Set(picks),
            true,
            [],
            "library-bottom"
        );
    },
    // CR 701.20a + CR 401.4 (issue #1364) — reveal a fixed top-N window ONCE,
    // keep AT MOST ONE card per category out of that single shared window, and
    // send everything unkept to `destination`. Atraxa, Grand Unifier.
    //
    // Structurally `lookDistribute` with a categorized keep instead of a single
    // filter+take, and it reuses lookDistribute's whole tail verbatim (the same
    // `look-distribute` choice, the same `bottomLookedAtCards` split, the same
    // reveal/markKnownToAll protocol) — only the ELIGIBILITY and the COUNT
    // CEILING differ. The categories are resolved against the revealed window
    // here (each `EffectCardFilter` → the matching revealed ids) and carried on
    // the choice, so the client renders them and gates clicks through the same
    // `categorizedPick` matching the submit path validates with. `count.max` is
    // the maximum matching, NOT the category count: with ten revealed lands and
    // eight categories only ONE card can be kept, and offering eight would be a
    // pick that cannot be made (CR 608.2b).
    revealAndCategorize(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const look = resolveValue(ctx, op.look);
        if (look === undefined || look <= 0) return;
        const topIds = ctx.peekLibraryTop(playerId, look);
        if (topIds.length === 0) return; // empty library — no look, no suspend
        const randomBottom = op.randomBottom === true;
        const destination = op.destination ?? "library-bottom";
        // Resolve each category against the revealed window. A revealed card
        // matching no category is never hand-eligible — it can only be sent to
        // `destination` (the same role `lookDistribute`'s filtered-out cards play).
        const byId = new Map(
            ctx.getLibraryCards(playerId).map((c) => [c.id, c])
        );
        const categories = op.categories.map((category) => ({
            label: category.label,
            cardIds: topIds.filter((id) => {
                const card = byId.get(id);
                return (
                    card !== undefined &&
                    matchesCardFilter(ctx, card, category.filter)
                );
            }),
        }));
        const eligible = categorizedEligibleIds(categories);
        const keep = maxCategorizedPicks(categories);
        // Nothing keepable (no revealed card matched any category): no real
        // choice — skip straight to the bottom/graveyard split rather than
        // prompting an empty picker (the Arena auto-resolve default). The
        // public reveal still fires, on this single-execution no-suspend path,
        // so it never double-pops.
        if (keep === 0) {
            if (op.reveal === "window") {
                ctx.notifyReveal(
                    [...ctx.allPlayerIds],
                    topIds,
                    ctx.sourceCardId,
                    "reveal"
                );
            }
            bottomLookedAtCards(
                ctx,
                playerId,
                topIds,
                new Set(),
                randomBottom,
                [],
                destination
            );
            return;
        }
        const picks = ctx.requestChoice({
            playerId,
            // Fixed choiceId, unique per Op position (the pipeline keys on
            // `step:choiceId` and `step` IS this Op's checkpointed position).
            choiceId: "reveal-categorize",
            kind: "look-distribute",
            zone: "library",
            candidateIds: topIds,
            eligibleIds: eligible,
            categories,
            // "You MAY put a card of that type" (Atraxa) — min 0. A mandatory
            // categorize keeps as many as the matching allows.
            count: { min: op.optional === true ? 0 : keep, max: keep },
            destination,
            randomizeRest: randomBottom ? true : undefined,
            prompt:
                op.prompt ??
                "Put up to one card of each category into your hand.",
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        // CR 701.20a, fired ONCE here on the resumed pass (everything above
        // re-runs on resume, so a reveal placed there would double-pop). Only
        // the KEPT cards get the persistent known-to-all grant — an unkept card
        // heading to a random bottom must not stay leaked by a stale stamp.
        if (op.reveal !== undefined && picks.length > 0) {
            ctx.markKnownToAll(playerId, picks);
        }
        if (op.reveal !== undefined) {
            ctx.notifyReveal(
                [...ctx.allPlayerIds],
                op.reveal === "window" ? topIds : picks,
                ctx.sourceCardId,
                "reveal"
            );
        }
        for (const id of picks)
            ctx.moveCardById(playerId, id, "library", "hand");
        const chosenBottom = randomBottom
            ? []
            : ctx.readOrderedSecond("reveal-categorize");
        bottomLookedAtCards(
            ctx,
            playerId,
            topIds,
            new Set(picks),
            randomBottom,
            chosenBottom,
            destination
        );
    },
    // CR 601.2b / 701.9 (issue #1945) — per-category choice from an
    // ALREADY-VISIBLE set (the chooser's own hand or battlefield), reusing
    // `revealAndCategorize`'s bipartite-matching core but decoupled from its
    // library-look framing: no reveal/peek here, and the picked/unpicked
    // halves get OPPOSITE actions per card (`onPicked`/`sweep`) rather than
    // the fixed kept→hand/rest→bottom polarity. See the Op's own doc comment
    // (`cards/types.ts`) and the mechanicsRegistry note for the full design.
    //
    // It also runs the OTHER of `categorizedPick.ts`'s two legality rules —
    // the COVER rule, not `revealAndCategorize`'s injective one. Each
    // category NOMINATES a member and one member may answer several
    // categories at once (Gatherer, Planar Overlay: "a dual land could be
    // chosen as two of your land types"; a WU gold card may be the card
    // chosen for both white and blue). So `count.min` is the size of the
    // SMALLEST covering set, never the maximum matching — pinning it to the
    // matching would force a Plains+Tundra player to return TWO lands where
    // the rules let them nominate the Tundra twice and return one.
    chooseCategorized(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — chooser gone, skip
        const categories = op.categories.map((category) => ({
            label: category.label,
            cardIds:
                op.zone === "hand"
                    ? ctx
                          .getHandCards(playerId)
                          .filter((c) =>
                              matchesCardFilter(ctx, c, category.filter)
                          )
                          .map((c) => c.id)
                    : battlefieldIdsFor(ctx, playerId, category.filter),
        }));
        const eligible = categorizedEligibleIds(categories);
        const keep = maxCategorizedPicks(categories);
        const applyOnPicked = (picks: readonly string[]) => {
            if (op.onPicked !== "returnToHand") return; // "keep" — no move
            for (const id of picks) {
                ctx.returnToHand({ type: "permanent", id });
            }
        };
        const applySweep = (picked: ReadonlySet<string>) => {
            if (!op.sweep) return;
            const sweepFilter = op.sweep.filter;
            const rest = ctx
                .getHandCards(playerId)
                .filter((c) => !picked.has(c.id))
                .filter(
                    (c) =>
                        sweepFilter === undefined ||
                        matchesCardFilter(ctx, c, sweepFilter)
                );
            for (const c of rest) ctx.discardCard(playerId, c.id);
        };
        // CR 608.2b — nothing is legally pickable in ANY category (no card of
        // that colour, no land of that basic type at all): a mandatory choice
        // with zero real options auto-resolves straight to the sweep instead
        // of prompting a picker with nothing clickable (the Arena zero-branch
        // default, mirroring `revealAndCategorize`'s own `keep === 0` skip).
        if (keep === 0) {
            applySweep(new Set());
            return;
        }
        // issue #1945 — a FORCED-but-nonzero answer: every category names at
        // most one candidate, so each non-empty category's nomination is
        // already determined (a lone dual land answers both its types) and
        // there is nothing for the player to decide. Auto-apply it rather
        // than raising a picker whose only possible answer is already known
        // (project convention: never prompt for a non-decision) — a genuine
        // ADDITION over `revealAndCategorize`, which has no such case.
        if (op.optional !== true) {
            const forced = forcedCategorizedCover(categories);
            if (forced !== undefined) {
                applyOnPicked(forced);
                applySweep(new Set(forced));
                return;
            }
        }
        const picks = ctx.requestChoice({
            playerId,
            // Fixed choiceId, unique per Op position (the pipeline keys on
            // `step:choiceId` and `step` IS this Op's checkpointed position —
            // a `forEach { set: "players" }` wrapper gives each iteration its
            // own position, so the SAME literal id never collides across
            // players, mirroring `revealAndCategorize`'s own fixed id).
            choiceId: "choose-categorized",
            kind: "choose-categorized",
            zone: op.zone,
            candidateIds: eligible,
            categories,
            // Mandatory by default ("chooses", not "may choose"). The FLOOR
            // is the smallest covering set, not the maximum matching: a
            // member answering several categories at once (a dual land, a
            // gold card) legitimately shrinks the answer, and demanding the
            // matching would force a larger pick than the rules allow (CR
            // 608.2b). The CEILING stays the maximum matching — the largest
            // answer in which every nominated member earns a category of its
            // own. `optional: true` keeps the injective per-category "may"
            // (min 0, any saturated subset) — see `categoryRule` below.
            count: {
                min: op.optional === true ? 0 : minCategorizedCover(categories),
                max: keep,
            },
            // Which of `categorizedPick.ts`'s two legality rules validates
            // the submission. Only the MANDATORY offer is a cover ("chooses
            // one card of each colour" — every category must be answered);
            // an `optional: true` offer is a per-category "you may", which is
            // exactly `revealAndCategorize`'s injective rule and stays on the
            // shared default.
            categoryRule: op.optional === true ? undefined : "cover",
            // Policy hint for the bot only (the server ignores it): whether
            // being picked is the good half or the bad half for the chooser.
            pickPolarity:
                op.onPicked === "returnToHand"
                    ? "picked-removed"
                    : "picked-kept",
            prompt: op.prompt ?? "Choose one card of each category.",
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        applyOnPicked(picks);
        applySweep(new Set(picks));
    },
    // CR 401.4 (issue #1046) — put N hand cards on top of the library, in the
    // player's chosen order. A thin declarative skin over the single
    // SpellContext primitive `moveHandCardToLibraryTop`, ONE execution path
    // (ADR 0045). SUSPENDS like `choice` / `scryReorder` / `lookDistribute`: the
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
            // position, mirroring `scryReorder`'s "order-top" / `lookDistribute`'s
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
        if (op.mode === "all-from-source") {
            // CR 615 (issue #1955) — SOURCE-scoped, recipient-agnostic: all
            // damage (or all combat damage) the named source would deal this
            // turn is prevented, to anyone. Falling Timber / Guard Dogs
            // (`combatOnly: true`), Rith's Charm's third mode (all damage).
            // The shield is keyed on the source's INSTANCE id, which both a
            // battlefield permanent and a stack spell have (a spell is a legal
            // damage source — CR 609.7 — and `dealDamage` already uses the
            // stack item's own id as `sourceInstanceId`). Skipped when the
            // source is gone (CR 608.2b) or resolves to a PLAYER, whose id
            // would key a shield that never matches any damage source.
            const source = resolveObjectRef(ctx, op.source);
            if (!source || source.type === "player") return;
            ctx.preventAllDamageFromSources({
                sourceIds: [source.id],
                ...(op.combatOnly ? { combatOnly: true } : {}),
            });
            return;
        }
        if (op.mode === "all-from-matching") {
            // CR 615 / 615.6 (issue #1955) — FILTER-scoped: no target is
            // named, and the match is re-read at the moment damage would be
            // dealt, so a creature that becomes blue after this resolves is
            // covered too (Radiant Kavu).
            ctx.preventAllDamageFromSources({
                match: op.match,
                ...(op.combatOnly ? { combatOnly: true } : {}),
            });
            return;
        }
        if (op.mode === "next-n-divided") {
            // CR 615.1 / 601.2d / 120.4 (issue #1955) — the DIVIDED sibling of
            // "next-n": one prevent-the-next-N shield per announced target,
            // sized by the split the caster assigned at ANNOUNCEMENT. The
            // split is read back through the same `resolveChosenDivision`
            // path `dealDamageDividedAsChosen` uses (stack item
            // `targetAmounts`, with the deterministic ≥1-each fallback when
            // no explicit split was recorded — which is what the bot's
            // amount-free `selectTargets` produces). Pollen Remedy.
            const total =
                op.total === "X"
                    ? ctx.getX()
                    : op.total === "X+1"
                      ? ctx.getX() + 1
                      : op.total;
            ctx.preventNextNDamageDividedAsChosen(
                ctx.targets,
                total,
                op.duration
            );
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
    // CR 701.19 (issue #846) — stack a regeneration shield on a permanent. A
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
    // CR 701.19c (issue #1283) — the inverse of `regenerate`: flag the creature
    // so it can't be regenerated for the rest of the turn. `$source` resolves
    // to the source's own selection, so the single setTarget primitive covers
    // the self-lock (Clergy) too. No-op off the battlefield / on a non-creature
    // (CR 608.2b — the primitive checks both).
    preventRegeneration(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.setTargetCantBeRegeneratedThisTurn(target);
    },
    // CR 614.1a (issue #1095) — arm the one-shot "if it would die this turn,
    // exile it instead" replacement. Thin skin over the single primitive
    // `setExileOnDeath`, one execution path (ADR 0045). No-op when the target
    // is gone or is not a permanent (CR 608.2b — an "any target" spell aimed
    // at a player has no creature for "that creature" to name).
    exileOnDeath(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target || target.type !== "permanent") return;
        ctx.setExileOnDeath(target);
    },
    // CR 615.12 / 614.9 (issue #2231) — arm the turn-scoped "damage dealt to
    // that creature can't be prevented or dealt instead to another permanent or
    // player" lock. Thin skin over the single primitive
    // `setDamageLockThisTurn`, one execution path (ADR 0045). No-op when the
    // target is gone or is not a permanent (CR 608.2b).
    lockDamage(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target || target.type !== "permanent") return;
        ctx.setDamageLockThisTurn(target);
    },
    // CR 510.1c (issue #1283) — mark a permanent so it assigns no combat damage
    // this turn (source-side prevention). Thin skin over the single primitive
    // `markAssignsNoCombatDamage`, one execution path (ADR 0045). No-op when the
    // target is gone (CR 608.2b — `resolveObjectRef` returns undefined).
    markAssignsNoCombatDamage(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.markAssignsNoCombatDamage(target);
    },
    // CR 701.27 / 712 (issue #1210, ADR 0067) — transform a permanent. A thin
    // declarative skin over the single SpellContext primitive `transform`,
    // ONE execution path (ADR 0045). CR 712.8a — the SAME toggle flips
    // either direction (front → back / back → front), so a card never needs
    // two Ops. Skipped when the target is gone (CR 608.2b —
    // `resolveObjectRef` returns undefined); the primitive itself also
    // no-ops when the permanent's current face declares no `backFace`.
    transform(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.transform(target);
    },
    // CR 712 / 400.7 / 306.5b (issue #2380) — exile a permanent and return it
    // to the battlefield transformed, under its OWNER's control (the ORI
    // flip-walker template). A thin declarative skin over the single
    // SpellContext primitive `exileAndReturnTransformed`, ONE execution path
    // (ADR 0045). The SIBLING of `transform` above — that one flips a
    // permanent in place (same object, CR 712.8a), this one makes a NEW object
    // via two real zone changes (CR 400.7). Skipped when the target is gone
    // (CR 608.2b — `resolveObjectRef` returns undefined).
    exileAndReturnTransformed(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        // `controller` omitted (every caller before issue #2399) keeps the
        // primitive's OWNER default — the ORI flip-walker wording. An
        // unresolvable ref falls back to that same default rather than
        // skipping the flip: the exile leg of the Oracle clause is
        // unconditional (CR 608.2b applies to the missing TARGET, not to a
        // missing controller).
        const controllerId =
            op.controller === undefined
                ? undefined
                : resolvePlayerRef(ctx, op.controller);
        ctx.exileAndReturnTransformed(target, controllerId);
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
        // CR 614.12a / ADR 0100 D5 — REPLAY SAFETY. A token whose entry parks on
        // an as-enters choice suspends the resolution; resume is a RE-ENTRY, not
        // a continuation, and `runOpList` re-executes the Op at exactly the
        // resume position. Without a done-marker this Op would create a SECOND
        // batch of tokens. The marker is written for the WHOLE batch right after
        // `ctx.createToken` returns — `createTokenPermanents` resolves `count`
        // once and creates every token of the batch in that one call, parking
        // whichever of them owe choices — so a marker written here can never
        // under-deliver part of a `count: N` batch, which is the mirror bug of
        // the duplicate (a marker written at the Op's checkpoint BEFORE the call
        // would short-circuit the whole Op on re-entry and create nothing).
        // Same idempotent-commit idiom `castDuringResolution` / `coinFlipSync`
        // use, keyed on this Op's own checkpointed position.
        const doneKey = `#createToken:${ctx.getScriptCheckpoint() ?? 0}`;
        const alreadyCreated = ctx.recallChoice(doneKey);
        if (alreadyCreated !== undefined) {
            if (op.bind && alreadyCreated.length > 0) {
                bindSnapshot(ctx, op.bind, {
                    type: "permanent",
                    id: alreadyCreated[alreadyCreated.length - 1],
                });
            }
            return;
        }
        const count = op.count === undefined ? 1 : resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        // CR 111.9 / 122.1 (issue #1210) — resolve any dynamic
        // `entersWith.counters` amount (an `EffectValue` — a literal, a bound
        // ref, a `count` construct, …) into a plain number before handing the
        // spec to `ctx.createToken` (`TokenSpec.entersWith.counters[].count`
        // is already-resolved, matching every other Op's "resolve values
        // through the interpreter, hand primitives plain data" convention).
        // Destructured OUT of the spread (not overwritten in place) so the
        // resulting object's `entersWith` field carries the resolved
        // (number-typed) shape, not the source `EffectValue`-typed one. A
        // counter that doesn't resolve (uncaptured binding) or resolves to
        // ≤0 is dropped — CR 122's "put N counters" with N ≤ 0 is a no-op,
        // mirroring the `counters` Op itself.
        // CR 707.2 (issue #2364) — `EffectTokenSpec.triggeredAbilities` is a
        // RESTRICTED, JSON-pure descriptor array (`TokenTriggeredAbility[]`),
        // NOT `TriggeredAbility[]` itself (`matches` is a required closure no
        // JSON-pure literal can supply) — so unlike `activatedAbilities`
        // (structurally compatible, spread through as-is), this field needs
        // an EXPLICIT conversion step before it can satisfy `TokenSpec`.
        // Destructured OUT of the spread for the same reason `entersWith` is:
        // the resolved (real-`TriggeredAbility`) shape must replace the
        // source descriptor shape, not sit alongside it.
        // CR 208.2 (issue #2384) — `power` / `toughness` are `EffectValue`s,
        // resolved here into plain numbers for the same reason `entersWith`
        // is destructured out below: `TokenSpec` takes already-resolved data.
        // An X/X token whose X does not resolve (a ref naming a binding this
        // resolution never captured — Skyclave Apparition's leave-trigger when
        // its ETB exiled nothing) creates NO token at all (CR 608.2b), rather
        // than a 0/0 that the lethal-damage SBA would wipe a moment later.
        const {
            entersWith: rawEntersWith,
            triggeredAbilities: rawTriggeredAbilities,
            power: rawPower,
            toughness: rawToughness,
            ...restToken
        } = op.token;
        const power =
            rawPower === undefined ? undefined : resolveValue(ctx, rawPower);
        const toughness =
            rawToughness === undefined
                ? undefined
                : resolveValue(ctx, rawToughness);
        if (
            (rawPower !== undefined && power === undefined) ||
            (rawToughness !== undefined && toughness === undefined)
        ) {
            return;
        }
        const resolvedCounters = rawEntersWith?.counters
            ?.map((c) => {
                const n = resolveValue(ctx, c.count);
                return n !== undefined && n > 0
                    ? { type: c.type, count: n }
                    : undefined;
            })
            .filter(
                (c): c is { type: string; count: number } => c !== undefined
            );
        const token: TokenSpec = {
            ...restToken,
            ...(power === undefined ? {} : { power }),
            ...(toughness === undefined ? {} : { toughness }),
            ...(resolvedCounters?.length || rawEntersWith?.asEnters?.length
                ? {
                      entersWith: {
                          ...(resolvedCounters && resolvedCounters.length > 0
                              ? { counters: resolvedCounters }
                              : {}),
                          // CR 614.1c (ADR 0100 D3) — pure data, forwarded
                          // verbatim; nothing to resolve.
                          ...(rawEntersWith?.asEnters
                              ? { asEnters: rawEntersWith.asEnters }
                              : {}),
                      },
                  }
                : {}),
            ...(rawTriggeredAbilities && rawTriggeredAbilities.length > 0
                ? {
                      triggeredAbilities: resolveTokenTriggeredAbilities(
                          rawTriggeredAbilities
                      ),
                  }
                : {}),
        };
        const ids = ctx.createToken(token, controllerId, count);
        // ADR 0100 D5 — commit the whole batch exactly once (see `doneKey`
        // above). Recorded even when `ids` is empty so a zero-token call is not
        // re-run either.
        ctx.noteChoice(doneKey, ids);
        // issue #1202 — snapshot the LAST created token so a follow-up Op
        // (Cori-Steel Cutter's optional `attach`) can act on the specific
        // just-created permanent. Mirrors `destroy`/`exile`/`moveZone`'s own
        // `bind` (same snapshot-family binding, `bindSnapshot`).
        if (op.bind && ids.length > 0) {
            bindSnapshot(ctx, op.bind, {
                type: "permanent",
                id: ids[ids.length - 1],
            });
        }
    },
    // CR 707.2 + CR 111.1 (issue #1459) — create token COPIES of a runtime
    // source permanent. The copy sibling of `createToken` (ADR 0045): the
    // source is read live and the same copy machinery Clone uses
    // (`SpellContext.createTokenCopyOf` → `applyCopy`) stamps its copiable
    // characteristics onto a fresh token — a runtime object read no JSON-pure
    // token spec can express, which is why it is its own Op. `source` resolves
    // through `resolveObjectRef` (an announced target slot OR a `ref` to a
    // permanent bound earlier in the same script — the createToken→copy bind
    // chain). The resolving source's instance id is passed as `createdBy` so
    // the token carries provenance (Dance of Many's leave-linkage). Skipped
    // when the controller can't be resolved, the count is non-positive /
    // unresolved (CR 707.1 — creates nothing), or the source has left the
    // battlefield (CR 608.2b — the copy fizzles).
    createTokenCopy(ctx, op) {
        const controllerId = resolvePlayerRef(ctx, op.controller);
        if (controllerId === undefined) return;
        // CR 614.12a / 707.6 / ADR 0100 D5 — REPLAY SAFETY, the same marker
        // `createToken` above carries and for the same reason (issue #2558): a
        // token copy whose entry parks on the COPIED card's "as it enters"
        // choices suspends the resolution, and resume re-executes this Op at
        // exactly the resume position. Without a done-marker every re-entry
        // would create another `count` copies — and because the whole
        // `count` loop below runs to completion before `runOpList` notices the
        // rise in the parked count, "creating more than one token copy owes
        // each token its own choices exactly once" needs the marker written
        // AFTER the loop, for the whole batch, never per iteration (a marker
        // written at the Op's checkpoint before the loop is the mirror bug: it
        // would short-circuit the whole Op on re-entry and create nothing).
        const doneKey = `#createTokenCopy:${ctx.getScriptCheckpoint() ?? 0}`;
        const alreadyCreated = ctx.recallChoice(doneKey);
        if (alreadyCreated !== undefined) {
            if (op.bind && alreadyCreated.length > 0) {
                bindSnapshot(ctx, op.bind, {
                    type: "permanent",
                    id: alreadyCreated[alreadyCreated.length - 1],
                });
            }
            return;
        }
        const count = op.count === undefined ? 1 : resolveValue(ctx, op.count);
        if (count === undefined || count <= 0) return;
        let source = resolveObjectRef(ctx, op.source);
        // CR 608.2b / 702.129a (issue #2339) — `$source` recovery for an
        // ability whose source is NOT on the battlefield. The implicit
        // `$source` snapshot is only seeded for a battlefield source
        // (`runEffectScript`), and Eternalize's own COST exiles the card from
        // the graveyard before the ability resolves — so the generic ref
        // resolves to nothing and the copy would silently fizzle. Mirrors the
        // recovery `moveZone` already does for Ashen Ghoul: fall back to the
        // ability's own instance id and locate the card in exile (the
        // Eternalize shape) or the graveyard.
        //
        // The recovery is the ONLY path that may read a non-battlefield
        // source, so it is flagged here and passed as an explicit per-call opt
        // below — every other caller keeps `createTokenCopyOf`'s documented
        // CR 608.2b fizzle when its source has left the battlefield.
        let recoveredLastKnown = false;
        if (!source && "ref" in op.source && op.source.ref === "$source") {
            const gid = ctx.sourceInstanceId;
            const owner =
                ctx.getExileCardOwner(gid) ?? ctx.getGraveyardCardOwner(gid);
            if (owner !== undefined) {
                source = { type: "graveyard-card", id: gid, playerId: owner };
                recoveredLastKnown = true;
            }
        }
        // The `graveyard-card` carrier is the generic "card sitting in a
        // non-battlefield zone" selection shape (see `moveZone`); either
        // carrier names an instance id `createTokenCopyOf` can locate.
        if (
            !source ||
            (source.type !== "permanent" && source.type !== "graveyard-card")
        ) {
            return;
        }
        // CR 508.4 (issue #1195) — "create a TAPPED and ATTACKING token
        // that's a copy of…" (Satya, Aetherflux Genius). Passed straight
        // through to `createTokenCopyOf`'s own entry-state opts; omitted
        // entirely (undefined) when neither flag is set, matching every
        // caller before this issue (Dance of Many).
        //
        // CR 707.2's "except" clause (issue #2339) maps 1:1 onto the SAME
        // `CopyEffectOptions` `applyCopy` already interprets — Eternalize's
        // "except it's a 4/4 black Zombie … with no mana cost" needs no new
        // execution path, and Embalm (CR 702.128a) is the same call with a
        // different `except`.
        const except = op.except;
        const opts =
            op.entersTapped ||
            op.entersAttacking ||
            except ||
            recoveredLastKnown
                ? {
                      entersTapped: op.entersTapped,
                      entersAttacking: op.entersAttacking,
                      ...(recoveredLastKnown
                          ? { lastKnownFromGraveyardOrExile: true }
                          : {}),
                      ...(except?.basePower !== undefined
                          ? { basePower: except.basePower }
                          : {}),
                      ...(except?.baseToughness !== undefined
                          ? { baseToughness: except.baseToughness }
                          : {}),
                      ...(except?.colors
                          ? { colorOverride: [...except.colors] }
                          : {}),
                      ...(except?.additionalSubtypes
                          ? {
                                additionalSubtypes: [
                                    ...except.additionalSubtypes,
                                ],
                            }
                          : {}),
                      ...(except?.additionalStaticAbilities
                          ? {
                                additionalStaticAbilities: [
                                    ...except.additionalStaticAbilities,
                                ],
                            }
                          : {}),
                      ...(except?.noManaCost ? { noManaCost: true } : {}),
                      ...(except?.imagePrintId
                          ? { imagePrintId: except.imagePrintId }
                          : {}),
                  }
                : undefined;
        const createdIds: string[] = [];
        for (let i = 0; i < count; i++) {
            const id = ctx.createTokenCopyOf(
                source.id,
                controllerId,
                ctx.sourceInstanceId,
                opts
            );
            if (id !== undefined) createdIds.push(id);
        }
        // ADR 0100 D5 — commit the whole batch exactly once (see `doneKey`
        // above). Recorded even when nothing was created (a source that left
        // the battlefield, CR 608.2b) so a zero-copy call is not re-run either.
        ctx.noteChoice(doneKey, createdIds);
        // issue #1202 — snapshot the LAST created copy so a follow-up Op can act
        // on the specific just-created permanent (mirrors `createToken`'s bind).
        const lastId = createdIds[createdIds.length - 1];
        if (op.bind && lastId !== undefined) {
            bindSnapshot(ctx, op.bind, { type: "permanent", id: lastId });
        }
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
    // CR 720.2 (issue #1199) — crown a player the monarch. A thin declarative
    // skin over the single SpellContext primitive `becomeMonarch`, ONE
    // execution path (ADR 0045). Skipped when the player ref cannot be
    // resolved (CR 608.2b).
    becomeMonarch(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.controller ?? "controller");
        if (playerId === undefined) return;
        ctx.becomeMonarch(playerId);
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
        // issue #1416 — capture the tapped/untapped permanent's
        // power/toughness/controller as last-known information (CR 608.2h)
        // WITHOUT a zone change, via the same snapshot path destroy/exile use.
        // Backlash: taps a creature, then deals `$bound.power` damage to its
        // `$bound.controller`. Read here while the permanent is still on the
        // battlefield (tap/untap never moves it).
        if (op.bind) bindSnapshot(ctx, op.bind, target);
    },
    // CR 302.6 / 502.1 (PRD #795) — arm a one-shot "doesn't untap during its
    // controller's next untap step" flag on a permanent. A thin adapter over
    // `SpellContext.skipNextUntap`: stamps the instance flag consumed by (and
    // cleared after) exactly one untap step. Skipped when the referenced
    // permanent has left the battlefield (CR 608.2b).
    skipNextUntap(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        ctx.skipNextUntap(target);
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
    // CR 400.2 look (Urza's Bauble) — "Look at a card at random in
    // `player`'s hand": a PRIVATE look. A thin adapter over the two
    // SpellContext primitives `lookRandomHandCard` (seeded-PRNG pick + private
    // `markKnown` to the looker) and `notifyReveal` (the transient look dialog,
    // audience = the looker ALONE). `looker` defaults to the resolving
    // controller (CR 113.7). No-op on an empty hand (the primitive returns
    // undefined, CR 608.2b) or an unresolvable player ref. Distinct from the
    // public `reveal` Op above (CR 701.20, `markKnownToAll`).
    lookRandomHand(ctx, op) {
        const ownerId = resolvePlayerRef(ctx, op.player);
        if (ownerId === undefined) return;
        const lookerId = resolvePlayerRef(ctx, op.looker ?? "controller");
        if (lookerId === undefined) return;
        const picked = ctx.lookRandomHandCard(ownerId, lookerId);
        if (picked === undefined) return; // empty hand — CR 608.2b
        ctx.notifyReveal([lookerId], [picked], ctx.sourceCardId, "look");
    },
    // CR 201.3 / 202.3 (issue #1085) — "chooses a card name" as part of
    // resolution. A thin adapter over `SpellContext.requestNameCard`, one
    // execution path (ADR 0045): SUSPENDS like `choice`/`mayPay` — the
    // binding name doubles as the choiceId (unique within the script,
    // validator-enforced), so the stored chosen name IS the NAME-family
    // binding a later `EffectCardFilter.name` bare ref reads back.
    nameCard(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — chooser gone, skip
        const named = ctx.requestNameCard({
            playerId,
            choiceId: op.bind,
            prompt: op.prompt,
            excludeBasicLand: op.excludeBasicLand,
        });
        if (named === undefined) return "suspend"; // enqueued — wait
    },
    // CR 701.20a reveal / CR 401.4 look (issue #1085) — deterministic
    // sibling of `lookDistribute`: reveal the top `look` cards to EVERY player,
    // put every matching card into hand with NO player choice (the filter
    // alone decides), and send the rest to `destination`. One execution
    // path, no suspension (the choice-driven half of this shape is
    // `lookDistribute`'s job).
    digMatchingToHand(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const look = resolveValue(ctx, op.look);
        if (look === undefined || look <= 0) return;
        const topIds = ctx.peekLibraryTop(playerId, look);
        if (topIds.length === 0) return; // empty library — no-op (CR 608.2b)
        // CR 701.20a — reveal the WHOLE looked-at window to every player
        // BEFORE splitting it (distinct from lookDistribute's private look: there
        // is no chooser-only Pending Choice here to gate visibility on). Two
        // halves of one reveal (ADR 0026): `markKnownToAll` is the PERSISTENT
        // grant — the card keeps a face-up "eye" for its controller and stays
        // visible in an opponent's view even after it rides into hand (the
        // knowledge survives the zone move); `notifyReveal` (kind "reveal",
        // audience = every player) pops the TRANSIENT reveal dialog on both
        // clients, the public sibling of Urza's Bauble's private "look" popup.
        // Both are needed for a true reveal (Desperate Research; Dark
        // Confidant's look:1 match-all reveal-and-keep).
        ctx.markKnownToAll(playerId, topIds);
        ctx.notifyReveal(
            [...ctx.allPlayerIds],
            topIds,
            ctx.sourceCardId,
            "reveal"
        );
        const byId = new Map(
            ctx.getLibraryCards(playerId).map((c) => [c.id, c])
        );
        const matches: string[] = [];
        const rest: string[] = [];
        for (const id of topIds) {
            const c = byId.get(id);
            if (c !== undefined && matchesCardFilter(ctx, c, op.filter)) {
                matches.push(id);
            } else {
                rest.push(id);
            }
        }
        for (const id of matches)
            ctx.moveCardById(playerId, id, "library", "hand");
        for (const id of rest)
            ctx.moveCardById(playerId, id, "library", op.destination);
        // `bind` (optional) — snapshot the FIRST card put into hand, mirrors
        // `lookDistribute`'s own bind (the card already sits in hand at this
        // point — no last-known-info need, `resolveObjectRef`'s hand-lookup
        // fallback re-reads it live).
        if (op.bind && matches.length > 0) {
            bindSnapshot(ctx, op.bind, {
                type: "hand-card",
                id: matches[0],
                playerId,
            });
        }
    },
    // CR 608.2 / 101.4 (issue #805) — mid-resolution player choice through
    // the existing Pending Choice pipeline. First execution enqueues the
    // choice and SUSPENDS the script; the resumed execution (after the
    // generic `submitResolutionChoice` commit) reads the picks back — they
    // are stored under this Op's binding name, which IS the picks binding.
    // `id` (issue #1282) — an optional author-supplied stable choiceId,
    // overriding `bind` for the WIRE-VISIBLE `PendingChoice.choiceId` (a
    // migrated card reproducing its `resolve()`-era literal id, e.g.
    // Bazaar of Baghdad's "bazaar-discard"). `bind` still names the picks
    // binding every later `{ ref: "$name" }` reads, so once `id` resolves the
    // picks they're mirrored into the `bind`-keyed binding too — see below.
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
        // CR 608.2b (issue #2065) — a dynamic filter field (a `{ ref }` name)
        // that resolved to nothing can match no card, so there is nothing to
        // choose from and the Op is skipped. Resolved BEFORE the candidate
        // scan so the sentinel never reaches `requestChoice`, whose
        // `filter` is also the SERVER-side check on the submitted pick:
        // handing it an undefined filter there would fail open (any pick
        // accepted), which is precisely what the sentinel exists to prevent.
        const pickFilter = toPermanentFilter(ctx, op.filter);
        if (pickFilter === UNMATCHABLE_FILTER) return;
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
        //
        // CR 401.4 / 701.19a — the LIBRARY is the exception: searching it is
        // itself an action with an outcome the player is entitled to (they get
        // to LOOK at the whole library, and it then gets shuffled). Skipping
        // the choice because the filter matched nothing silently denied the
        // look — a fetchland with no basic left never showed the library at
        // all. So a library search with zero eligible cards still raises the
        // choice, as a 0-pick one: the client renders the full library with
        // every card inert and a Done that only shuffles.
        const searchWithNoHit = op.zone === "library" && available === 0;
        let count: number | { min: number; max: number };
        if (searchWithNoHit) {
            count = { min: 0, max: 0 };
        } else if (typeof op.count === "number") {
            count = Math.min(op.count, available);
            if (count <= 0) return;
        } else {
            const max = Math.min(op.count.max, available);
            if (max <= 0) return;
            count = { min: Math.min(op.count.min, max), max };
        }
        // The binding name doubles as the choiceId by default: unique within
        // the script (validator-enforced) and stable across replays, so the
        // stored entry is exactly the picks binding. `op.id` (issue #1282)
        // overrides it — an author-supplied stable id for migration
        // equivalence — in which case the picks are mirrored below.
        const choiceId = op.id ?? op.bind;
        const picks = ctx.requestChoice({
            playerId,
            choiceId,
            kind: op.kind,
            zone: op.zone,
            filter: pickFilter,
            count,
            prompt: op.prompt,
            // A no-hit library search carries an EMPTY allow-list, so the
            // client dims every card rather than making them all pickable
            // (an absent `candidateIds` means "unfiltered, all eligible").
            ...(searchWithNoHit
                ? { candidateIds: [] }
                : candidateIds
                  ? { candidateIds }
                  : {}),
            ...(op.zoneOwnerId !== undefined ? { zoneOwnerId } : {}),
            // CR 701.19a (issue #788 re-review finding 1) — this `choice` Op
            // handler's library branch (`choiceCandidates` above) always scans
            // the WHOLE zone via `matchesCardFilter`, never a peeked top-N
            // window, so every DSL `kind: "search-library"` choice raised here
            // is a genuine search. `emitLibrarySearchedEvent` gates on this
            // flag, not on `kind` alone — see `PendingChoice.isSearch`.
            ...(op.kind === "search-library" ? { isSearch: true } : {}),
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        // issue #1282 — when `id` diverges from `bind`, `requestChoice`
        // stored/recalled the answer under `id`, but every later `{ ref:
        // "$name" }` recalls under `bind` (`resolvePicks` → `recallChoice`).
        // Mirror the resolved picks into the `bind`-keyed binding so those
        // reads keep working transparently — a no-op when `id` is omitted or
        // equals `bind`.
        if (choiceId !== op.bind) {
            ctx.noteChoice(op.bind, picks);
        }
        // "The other" (Barrin's Spite) — snapshot the single candidate the
        // chooser did NOT pick, so the follow-up clause can act on it. Which
        // announced slot that is depends on the choice, so no `{ target: n }`
        // can name it; a snapshot can, and every object-acting Op already
        // reads one. Left UNCAPTURED unless exactly one candidate remains, so
        // any other arrangement (nothing left, or several) simply skips
        // downstream (CR 608.2b) instead of silently picking one.
        if (op.bindOther) {
            const rest = (candidateIds ?? []).filter(
                (id) => !picks.includes(id)
            );
            if (rest.length === 1) {
                bindSnapshot(ctx, op.bindOther, {
                    type: "permanent",
                    id: rest[0],
                });
            }
        }
    },
    // CR 701.9 — discard cards. Routes through `discardCard` so the Library
    // of Leng replacement and CARD_DISCARDED triggers (Necropotence-style,
    // madness eligibility CR 702.35c) apply exactly as for imperative cards.
    // Without `cards` (issue #1279) — the bulk whole-hand shape: every card
    // currently in hand, iterated over a snapshot of ids so discarding
    // doesn't perturb the hand array mid-loop.
    discard(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        if (op.cards === undefined) {
            for (const id of ctx.getHandIds(playerId)) {
                ctx.discardCard(playerId, id);
            }
            return;
        }
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
    // `op.cost` may be the static `MayPayCost` union OR a dynamically-derived
    // mana cost (issue #1150 — `DynamicMayPayManaCost`, Flash's "pay its mana
    // cost reduced by {2}"); `resolveMayPayCost` resolves either shape into
    // the concrete `MayPayCost` `requestMayPay` consumes, skipping the whole
    // Op (CR 608.2b) when a dynamic cost's referenced object can't be found.
    mayPay(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — payer gone, skip
        const resolvedCost = resolveMayPayCost(ctx, op.cost);
        if (resolvedCost === MAY_PAY_COST_UNRESOLVABLE) return;
        const paid = ctx.requestMayPay({
            playerId,
            // The binding name doubles as the choiceId (unique within the
            // script, validator-enforced), so the stored ["yes"|"no"] answer
            // IS the boolean binding read by `readBoolBinding`.
            choiceId: op.bind,
            cost: resolvedCost,
            prompt: op.prompt,
        });
        if (paid === undefined) return "suspend"; // enqueued — wait
    },
    // CR 701.6a — counter the announced target spell. A silent no-op when the
    // target already left the stack (CR 608.2b — the spell does as much as it
    // can). The consequence half of the counter/punisher pattern. `destination`
    // (issue #683) redirects a COUNTERED SPELL to exile/library-top/hand
    // instead of the CR 701.6a graveyard default (No More Lies, Memory Lapse,
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
                          color: mode.color,
                          protectionColor: modeProtectionColor(mode),
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
    // coinFlipSync — the synchronous sibling of `coinFlip` (CR 705, issue
    // #1281): flip a coin INLINE, with NO reveal-ack suspension. Same
    // branching shape (`win`/`loss`, each a nested Op list run through the
    // SAME `runOpList` path), and the bit comes from the SAME
    // `SpellContext.flipCoin` seeded-PRNG draw `requestCoinFlip` makes
    // internally — only the reveal-overlay Pending Choice is skipped, so a
    // card migrating between the two Ops sees identical seeded outcomes.
    // `flipCoin` itself has no persistence — unlike `requestCoinFlip`, it does
    // NOT dedupe a re-drawn bit across a re-walk. So this Op reuses the two
    // GENERIC replay-safe memoization primitives every suspend-capable Op
    // already shares (`recallChoice`/`noteChoice` — the same idiom `draw`'s
    // `#draw:<pos>:<i>` progress marker uses, ADR 0061) rather than adding a
    // new SpellContext primitive: keyed under this Op's own checkpointed
    // pre-order position (`ctx.getScriptCheckpoint()`, set by `runOpList`
    // right before dispatch), so it is unique per coinFlipSync Op and stable
    // across a re-walk. First pass: no entry yet → draw via `flipCoin()` and
    // persist the realized bit. A later pass reaching this checkpoint again
    // (a suspending Op INSIDE the taken branch, e.g. a nested `choice`,
    // resuming) reads the persisted bit back instead of re-flipping (CR
    // 608.3 — no re-roll) and re-descends into the SAME branch, exactly like
    // `coinFlip`'s own resume. Like `coinFlip` it is a structural construct
    // that always re-descends on a re-walk (the runOpList skip-exception).
    // Skipped when the flipper is gone (CR 608.2b).
    coinFlipSync(ctx, op, cursor) {
        const playerId = resolvePlayerRef(ctx, op.player ?? "controller");
        if (playerId === undefined) return; // CR 608.2b — flipper gone, skip
        const pos = ctx.getScriptCheckpoint() ?? 0;
        const doneKey = `#coinFlipSync:${pos}`;
        const stored = ctx.recallChoice(doneKey);
        const won =
            stored !== undefined ? stored[0] === "heads" : ctx.flipCoin();
        if (stored === undefined) {
            ctx.noteChoice(doneKey, [won ? "heads" : "tails"]);
        }
        const branch = won ? op.win.effects : op.loss.effects;
        return runOpList(ctx, branch, cursor);
    },
    // CR 701.21 (issue #807) — sacrifice the permanents a `choice` Op picked.
    // Routes through `SpellContext.sacrifice`: the controller puts each pick
    // into its owner's graveyard; indestructible does not prevent sacrifice
    // (CR 701.21a) and dies-triggers fire as for imperative cards. A pick
    // already gone from the battlefield is a no-op inside the primitive.
    sacrifice(ctx, op) {
        // Single-object form (CR 701.21 — "sacrifice that/this creature",
        // Kjeldoran Elite Guard, Phantasmal Mount): resolve one announced
        // target / snapshot-bound permanent through the object-ref path, which
        // re-checks battlefield presence (CR 608.2b — a permanent already gone
        // is skipped here, before the primitive).
        if (op.target !== undefined) {
            const target = resolveObjectRef(ctx, op.target);
            if (!target) return;
            // CR 608.2h — snapshot BEFORE the zone change, so "that creature's
            // power" survives the move to the graveyard (issue: Minsc & Boo).
            if (op.bind) bindSnapshot(ctx, op.bind, target);
            ctx.sacrifice(target.id);
            return;
        }
        // Picks form (CR 701.21 — the "each player sacrifices …" forEach
        // pattern): sacrifice every permanent a `choice` Op picked.
        if (op.permanents === undefined) return;
        const ids = resolvePicks(ctx, op.permanents);
        if (!ids) return; // binding never captured — CR 608.2b, skip
        // CR 608.2h — snapshot the FIRST pick before any of them leaves the
        // battlefield ("sacrifice A creature. … that creature's power").
        if (op.bind && ids.length > 0) {
            bindSnapshot(ctx, op.bind, { type: "permanent", id: ids[0] });
        }
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
        // Set when a SCALAR capture (ref/target, never a literal string or a
        // list `select`) fails to resolve — see the guard below the loop.
        let unresolvedScalarCapture = false;
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
            // NOT treated as "unresolved" below: the selector (e.g.
            // `combatPartners`) ran against LIVE state and legitimately
            // computed zero members (Venomous Breath vs. an unblocked
            // target) — a real trigger whose body correctly does nothing,
            // not a trigger whose referent was never created.
            if (typeof source === "object" && "select" in source) {
                const list = resolveCaptureListSource(ctx, source.select);
                if (list.length > 0) payload[key] = list;
                continue;
            }
            const value = resolveCaptureSource(ctx, source);
            // An unresolvable capture (target slot gone, binding never made)
            // stays OUT of the payload: the body binding is uncaptured and
            // Ops reading it skip at fire time (CR 608.2b).
            if (value !== undefined) {
                payload[key] = value;
            } else {
                // `resolveCaptureSource` only returns undefined for a
                // ref/target source — a literal string always resolves, so
                // reaching here means this was a bare `$x` (or `.controller`)
                // binding that an EARLIER Op in this same script was
                // supposed to `bind`, and didn't (Shallow Grave: `moveZone`
                // found no creature in the graveyard, so `$revived` was
                // never bound; issue #2490). Flag it — see the guard below.
                unresolvedScalarCapture = true;
            }
        }
        // CR 603.7a / 608.2b — a delayed triggered ability whose only reason
        // to exist is to act on an object THIS SAME SCRIPT was supposed to
        // establish (via an earlier `bind`) must not be scheduled if that
        // object was never established: every body Op reading the failed
        // capture will find it uncaptured and skip, so the "trigger" would
        // fire and do nothing, forever (issue #2490 — Shallow Grave cast
        // into a creature-less graveyard still scheduled "exile it", which
        // then always exiled nothing). This is the missing third member of
        // the family below it (unresolved `targetPlayer`, unresolved
        // `watch`): a capture is required context exactly like those two,
        // and CR 603.7a's own example ("the creature in question leaves the
        // battlefield before the spell... resolves. In this case, the
        // delayed ability never triggers") is this same shape — the
        // referent was never there for the ability to act on. Does NOT fire
        // on a legitimately-empty LIST capture (handled above, before this
        // point is reached) — that selector resolved fine, it just found
        // nothing live, which is a meaningful outcome the scheduled body is
        // correct to encode (Venomous Breath with an unblocked target).
        if (unresolvedScalarCapture) return;
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
        // Instance-scoped watch (CR 603.7a / 603.10 / 509.1h, issues #731 /
        // #1470): resolve the watched permanent to an id NOW (scheduling time
        // — it is still on the battlefield). A watch that cannot be resolved
        // (the object already left) would never fire — skip scheduling
        // entirely (CR 608.2b). Every instance-scoped timing resolves the
        // watch identically; they diverge only in the firing event
        // (PERMANENT_LEFT vs ATTACKER_UNBLOCKED, triggers.ts) and the CLEANUP
        // purge (phases.ts).
        let watchInstanceId: string | undefined;
        if (
            op.timing === "leaves-battlefield" ||
            op.timing === "leaves-battlefield-indefinite" ||
            op.timing === "attacks-unblocked"
        ) {
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
    // CR 603.12 — create a REFLEXIVE triggered ability from inside this
    // resolving effect ("Sacrifice a creature. When you do, …"). Nothing is
    // scheduled: the ability is queued now and the next trigger drain puts it
    // on the stack above this object (CR 603.3b APNAP with the other triggers
    // that became waiting during this same resolution), announcing its own
    // targets there (CR 603.3d). A thin skin over the single
    // `SpellContext.pushReflexiveTrigger` primitive (one execution path,
    // ADR 0045).
    reflexiveTrigger(ctx, op) {
        const payload: Record<string, string | string[]> = {};
        for (const [name, source] of Object.entries(op.capture ?? {})) {
            // Same '$'-stripping contract as `delayedTrigger` (Convex rejects
            // a field name starting with '$'); `runDelayedTriggerBody` re-adds
            // the sigil when it re-binds the payload.
            const key = name.slice(1);
            const value = resolveReflexiveCaptureSource(ctx, source);
            // An unresolvable capture stays OUT of the payload: the body
            // binding is uncaptured and Ops reading it skip (CR 608.2b).
            if (value !== undefined) payload[key] = value;
        }
        ctx.pushReflexiveTrigger(
            ctx.sourceCardId,
            op.oracleText,
            op.effects,
            payload,
            op.targetRequirement
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
    // CR 508.1a / 509.1a / 509.1b — grant a turn-scoped combat restriction. A
    // thin declarative skin over `SpellContext.setCantAttackThisTurn` /
    // `setCantBlockThisTurn` / `setCantBeBlockedThisTurn`, one execution path
    // (ADR 0045). Skipped when the referenced permanent is gone (CR 608.2b —
    // the effect does as much as it can).
    restrictCombat(ctx, op) {
        const target = resolveObjectRef(ctx, op.target);
        if (!target) return;
        if (op.restriction === "cant-attack") {
            ctx.setCantAttackThisTurn(target);
        } else if (op.restriction === "cant-block") {
            ctx.setCantBlockThisTurn(target);
        } else {
            ctx.setCantBeBlockedThisTurn(target);
        }
    },
    // CR 508.1c (issue #1283) — Island Sanctuary's player-scoped "can't be
    // attacked except by flying/islandwalk creatures" protection. A thin
    // declarative skin over the single SpellContext primitive
    // `setIslandSanctuaryProtection`, one execution path (ADR 0045). Skipped
    // when the player cannot be resolved (CR 608.2b).
    setIslandSanctuaryProtection(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.setIslandSanctuaryProtection(playerId);
    },
    // CR 702.16b/e/i (issue #674) — "you gain protection from everything until
    // your next turn" (The One Ring). A thin declarative skin over the single
    // SpellContext primitive `setPlayerProtectionFromEverything`, one
    // execution path (ADR 0045). Skipped when the player cannot be resolved
    // (CR 608.2b).
    setProtectionFromEverything(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return;
        ctx.setPlayerProtectionFromEverything(playerId);
    },
    // CR 119.4 / 121.1 (issue #1283) — a single ranged 0..N pick over the
    // resolved player's "drawn this turn" hand cards: each NOT selected costs
    // `costPerKept` life (CR 119.4 floor clamp), each selected goes to the
    // library top via the SAME "hand → library-top" primitive `putBack` uses.
    // Sylvan Library's own "choose two ... pay 4 life or put on top" is
    // collapsed into ONE ranged pick per its own card comment (reachable
    // outcomes are identical). A thin declarative composition over EXISTING
    // SpellContext primitives — no new primitive (ADR 0045 "generalize, don't
    // add"): getDrawnThisTurnIds / getHandIds / getLife / requestChoice /
    // moveHandCardToLibraryTop / loseLife. SUSPENDS like `choice` / `putBack`
    // (a fixed choiceId, unique per Op position — mirrors `putBack`'s
    // "put-back").
    rangedTopdeck(ctx, op) {
        const playerId = resolvePlayerRef(ctx, op.player);
        if (playerId === undefined) return; // CR 608.2b — player gone, skip
        const max = resolveValue(ctx, op.max);
        if (max === undefined || max <= 0) return;
        const costPerKept = resolveValue(ctx, op.costPerKept) ?? 0;
        const hand = new Set(ctx.getHandIds(playerId));
        const pool = ctx
            .getDrawnThisTurnIds(playerId)
            .filter((id) => hand.has(id));
        const n = Math.min(max, pool.length);
        if (n === 0) return; // nothing eligible — CR 608.2b
        // CR 119.4 — a player can't pay life they don't have, so at least
        // n - floor(life / costPerKept) of the pool must be topdecked.
        const keepCap =
            costPerKept > 0
                ? Math.floor(ctx.getLife(playerId) / costPerKept)
                : n;
        const minTopdeck = Math.max(0, n - keepCap);
        const picks = ctx.requestChoice({
            playerId,
            choiceId: "ranged-topdeck",
            kind: "choose-hand-card",
            zone: "hand",
            candidateIds: pool,
            count: { min: minTopdeck, max: n },
            putOnTop: true,
            prompt:
                op.prompt ??
                `Choose up to ${n} card(s) drawn this turn to put on top of your library; pay ${costPerKept} life for each you keep.`,
        });
        if (picks === undefined) return "suspend"; // enqueued — wait
        const topdeck = picks.filter((id) => hand.has(id));
        for (const id of topdeck) ctx.moveHandCardToLibraryTop(playerId, id);
        const kept = n - topdeck.length;
        if (kept > 0 && costPerKept > 0) {
            ctx.loseLife(playerId, costPerKept * kept);
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
        // `coinFlip` / `coinFlipSync` (issue #851 / #1281) are the exceptions:
        // they must still run so they re-descend / re-iterate / re-branch into
        // the same nested Ops, keeping the pre-order positions aligned across
        // the re-walk (their own leaf Ops are then skipped individually by this
        // same position check) — a suspending Op inside a branch resumes
        // through them. `coinFlipSync`'s own re-dispatch never re-flips: its
        // executor guards the draw itself with the generic
        // `recallChoice`/`noteChoice` memoization (keyed on its checkpointed
        // position), the same idempotent-commit idiom `draw` uses — so a
        // re-entry here reads the persisted bit back and re-descends into the
        // SAME branch instead of drawing a new one.
        if (
            myPos < cursor.resume &&
            op.op !== "if" &&
            op.op !== "forEach" &&
            op.op !== "optionChoice" &&
            op.op !== "coinFlip" &&
            op.op !== "coinFlipSync" &&
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
        // CR 614.12a / ADR 0100 D5 — an Op that puts a permanent onto the
        // battlefield may PARK it on an "as it enters" choice. The park happens
        // several frames below the executor (inside `createTokenPermanents` /
        // `stageReanimatedOnBattlefield`) and no primitive return value reports
        // it, so it is observed from the outside as a rise in the parked count.
        // It is a suspension in every sense the interpreter cares about — the
        // permanent has NOT entered yet, so no later Op may run (CR 614.12a
        // "that choice is made before the permanent enters"), and the
        // checkpoint must survive so the resumed resolution re-enters at THIS
        // Op instead of replaying the script from position 0 (CR 608.3).
        const parkedBefore = ctx.stagedAsEntersCount();
        const outcome = (
            OP_EXECUTORS[op.op] as (
                c: SpellContext,
                o: EffectOp,
                cur: Cursor
            ) => OpOutcome
        )(ctx, op, cursor);
        if (outcome === "suspend") return "suspend";
        if (ctx.stagedAsEntersCount() > parkedBefore) return "suspend";
    }
}

/** The implicit binding name every ability-site script gets for free: a
 *  snapshot of the source permanent (ADR 0045, issue #803). Lets an ability
 *  Op read "its power / its toughness / its controller" — e.g. "deals damage
 *  equal to its power" — as `{ ref: "$source.power" }` without an explicit
 *  `bind`. The static validator pre-declares it for ability sites. */
export const SOURCE_BINDING = "$source";

/** The implicit binding name an ability-site script gets for the source's
 *  ATTACHMENT HOST (CR 701.3, issue #1341): the permanent `$source` is
 *  currently attached to — the equipped creature of an Equipment, the
 *  enchanted permanent of an Aura. Seeded alongside `$source` whenever the
 *  source has a live `attachedTo`, so an equip/aura ability can act on its
 *  host declaratively ("Equipped creature gets +2/+2", "Regenerate enchanted
 *  creature") instead of reaching for `ctx.getAttachedToId()` in a closure.
 *
 *  It is NOT a target (CR 115.10 — the host is named by the ability's own
 *  text, never chosen), so it needs no `targetRequirement` and is immune to
 *  shroud/protection. An UNATTACHED source simply seeds no binding: every ref
 *  to it then resolves to undefined and the reading Op skips (CR 608.2b —
 *  the ability does as much as it can). */
export const HOST_BINDING = "$host";

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
    // `targets` (issue #1083) — iterate the currently-resolving spell/
    // ability's WHOLE announced target set (Distorting Wake's "X target
    // nonland permanents", Sway of Illusion's "any number of target
    // creatures"), instead of one fixed `{ target: N }` slot. Only permanent
    // entries are iterable (CR 608.2b — a non-permanent entry is unreachable
    // for the shipped target types this selector pairs with, skipped rather
    // than erroring); each member is snapshotted as a permanent by the
    // generic (non-"players"/"graveyard") branch of `execForEach`'s per-member
    // loop below, exactly like the `permanents` set.
    if (select.set === "targets") {
        return ctx.targets
            .filter((t) => t.type === "permanent")
            .map((t) => t.id);
    }
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
    const ids = owners.flatMap((pid) =>
        battlefieldIdsFor(ctx, pid, select.filter)
    );
    // Reflexive self-exclude (issue #1957, Waterspout Elemental — "return all
    // OTHER creatures"): drop the resolving ability/spell's own source from
    // the frozen member set. Mirrors `TargetRequirement.excludeSource`'s
    // resolution (`raiseTriggerTargetSelection`, gre/rules.ts), just applied
    // to a non-targeted mass-sweep selector instead of an announced target.
    return select.excludeSource
        ? ids.filter((id) => id !== ctx.sourceInstanceId)
        : ids;
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

    // Choices first, actions together (CR 101.4, issue #1872). The rule's own
    // example is Innocent Blood's line: "First, the active player chooses a
    // creature they control. Then each of the nonactive players, in turn
    // order, chooses a creature they control. Then all creatures chosen this
    // way are sacrificed simultaneously." The default per-member walk applies
    // each member's action the moment its own choice resolves, so a later
    // chooser decides against a board an earlier member's action already
    // changed — and CR 101.4b says a player knows the previous players'
    // CHOICES, not the results of acting on them.
    //
    // Unlike the graveyard batch above this does NOT bypass `runOpList`: it
    // walks the SAME body Ops in the same deterministic pre-order, just
    // re-sequenced into two passes — every choice for every member, then every
    // action for every member. That keeps the whole suspend/resume machinery
    // intact (positions stay monotonic and stable across a re-walk, so a
    // suspension in pass 1 resumes at exactly its own member's choice, and
    // every already-completed Op is skipped by the same `cursor.resume` rule).
    // The validator constrains the body to `[choice, sacrifice|discard]`, so
    // pass 2 holds no suspending Op and cannot interleave a prompt back into
    // the applied half.
    if (op.select.set === "players" && op.simultaneous) {
        const choiceOps = op.effects.slice(0, 1);
        const applyOps = op.effects.slice(1);
        // Pass 1 — every player's decision, APNAP order (CR 101.4), nothing
        // applied yet.
        for (let k = 0; k < members.length; k++) {
            const eachId = scopeBindingName(EACH_BINDING, pos, k);
            if (ctx.recallChoice(eachId) === undefined) {
                ctx.noteChoice(eachId, [members[k]]);
            }
            const outcome = runOpList(
                scopedContext(ctx, pos, k),
                choiceOps,
                cursor
            );
            if (outcome === "suspend") return "suspend";
        }
        // Pass 2 — "Then the actions happen simultaneously." Each member acts
        // on the pick frozen in pass 1; no trigger resolves in between (the
        // engine's trigger scan runs after the whole resolution), so the
        // deaths / discards are one observable batch.
        for (let k = 0; k < members.length; k++) {
            const outcome = runOpList(
                scopedContext(ctx, pos, k),
                applyOps,
                cursor
            );
            if (outcome === "suspend") return "suspend";
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
        // `$host` (issue #1341) — the source's attachment host, seeded on the
        // same FRESH entry as `$source` and under the same CR 603.10 / 608.2h
        // last-known-information rule: an Equipment that is unattached (or
        // whose host has left) seeds nothing, and every ref to it skips its Op
        // (CR 608.2b). Read from the live link at resolution start, which is
        // the moment CR 608.2 fixes the ability's subject.
        const hostId = ctx.getAttachedToId();
        if (hostId !== undefined && ctx.getOwnerId(hostId) !== undefined) {
            bindSnapshot(ctx, HOST_BINDING, {
                type: "permanent",
                id: hostId,
            });
        }
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

/** Resolves ONE `reflexiveTrigger` capture (CR 603.12). Differs from
 *  `resolveCaptureSource` in exactly one, deliberate way: a BARE binding ref
 *  (`{ ref: "$sac" }`) carries the WHOLE recorded binding across verbatim
 *  instead of flattening it to an instance id.
 *
 *  That is what makes CR 608.2h last-known information survive. A delayed
 *  trigger fires much later, so re-reading a captured id fresh at fire time is
 *  right (the object may have changed). A reflexive trigger's whole reason to
 *  exist is to act on what the resolving effect JUST did — typically to an
 *  object that is no longer on the battlefield ("sacrifice a creature … where
 *  X is THAT creature's power"). Re-binding by id would find nothing;
 *  re-noting the snapshot verbatim keeps power/toughness/controller/owner
 *  readable. `runDelayedTriggerBody`'s array branch already re-notes a
 *  `string[]` payload value unchanged, so every binding family — object
 *  snapshot, `choice` picks, player — round-trips through the same path with
 *  no new plumbing. */
function resolveReflexiveCaptureSource(
    ctx: SpellContext,
    source: EffectCaptureSource
): string | string[] | undefined {
    if (typeof source === "string") return source;
    if ("target" in source) return ctx.targets[source.target]?.id;
    // A `{ select }` LIST source is a delayedTrigger-only shape (the
    // validator rejects it here); narrow it out.
    if ("select" in source) return undefined;
    // `$event.<field>` — a reflexive trigger has no firing event of its own
    // (it triggers off the resolving effect's action, CR 603.12), so the
    // validator rejects an event ref here; narrow it out defensively.
    if (isEventRef(source.ref)) return undefined;
    const parsed = parseRef(source.ref);
    if (parsed) {
        // Property refs: only `.controller` (a player binding at the far end),
        // matching the delayed-trigger capture vocabulary.
        if (parsed.property !== "controller") return undefined;
        return readBinding(ctx, parsed.binding)?.[SNAP_CONTROLLER];
    }
    if (!source.ref.startsWith("$")) return undefined;
    // Bare binding ref — carry the recorded binding VERBATIM (see above).
    return readBinding(ctx, source.ref);
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
            } else {
                // issue #1470 — the DEPARTED-OBJECT case. An instance
                // leave-watch body (`leaves-battlefield[-indefinite]`) fires
                // precisely BECAUSE the captured object left the battlefield,
                // so the battlefield lookup above always misses for it and the
                // binding would be dropped — leaving earthbend's "return it to
                // the battlefield tapped" with nothing to return. Fall back to
                // the graveyard, then exile (a `graveyardDestinationFor`
                // redirect), and bind a non-permanent snapshot carrying the id.
                // This does NOT resurrect any pre-existing CR 608.2b skip:
                // `resolveObjectRef` is battlefield(+hand)-scoped, so every Op
                // that acts on a live permanent still finds nothing; only
                // `moveZone`'s explicit `from:` return path (issue #1469) reads
                // the id back out of this binding.
                const owner =
                    ctx.getGraveyardCardOwner(value) ??
                    ctx.getExileCardOwner(value);
                if (owner !== undefined) {
                    bindSnapshot(ctx, name, {
                        type: "graveyard-card",
                        id: value,
                        playerId: owner,
                    });
                }
            }
        }
    }
    runEffectScript(ctx, effects);
}
