// Per-Op value model — the OP_VALUERS dispatch table (PRD #1423 "DSL semantic
// layer", issue #1426). Mirrors the interpreter's `OP_EXECUTORS`: one entry per
// Op, keyed by Op name. Where an executor APPLIES an Op to game state, a valuer
// VALUES it — projecting it onto the fixed feature basis (`featureBasis.ts`) as
// a Forge-scale `{ points, tags }`. A script's value is the walker's sum over
// its Ops (`valueEffectScript`).
//
// Issue #1426 shipped the CHARTER Ops (the highest-frequency / most
// eval-relevant verbs, PRD #1423). Issue #1430 backfilled every remaining
// `status:"implemented"` Op at the time, emptying the coverage guard's
// allowlist; `castDuringResolution` (#1477) and `createTokenCopy` (#1459)
// shipped afterward straight onto the allowlist instead of earning a valuer —
// issue #1515 backfills those two and re-empties it. The guard
// (`convex/cards/__tests__/opValuerCoverage.bot.test.ts`) fails CI on any
// implemented Op that is neither valued nor a walker-handled structural
// construct.
//
// Issue #1521 corrected three semantic bugs found by review: `dealDamage`
// assumed damage aimed at a player is NEVER self-directed (false — recoil/
// symmetric riders exist), `divideIntoPiles` averaged the two piles instead
// of taking the adversarial chooser's worst-case split, and `sacrifice`
// treated every single-target form as the caster's own cost even when the
// target is an arbitrary announced permanent (potentially the opponent's).
//
// Point magnitudes are on `evaluate.ts`'s Forge scale (a 2/2 vanilla ≈ 170, one
// life ≈ 8, one untapped mana ≈ 12). They are hand-tuned for ORDERING (a burn/
// removal spell must out-score a do-nothing spell of equal mana value) — the
// PRD tunes them further against the blade suite in a later slice.

import type {
    EffectOp,
    EffectMoveZone,
    EffectPlayerRef,
    EffectRef,
    EffectCaptureSource,
    PlayerCounterKind,
} from "../../cards/types";
import { creatureValueRaw } from "../creatureBody";
import type { Feature, OpValue, ValueTag } from "./featureBasis";
import { ZERO_OP_VALUE } from "./featureBasis";
import type { GroundingContext } from "./grounding";
import { contextFreeGrounding } from "./grounding";

type OpOf<K extends EffectOp["op"]> = Extract<EffectOp, { op: K }>;

// --- Forge-scale point weights (hand-tuned for ordering) -------------------
const DAMAGE_PER_POINT = 22; // burn is removal + reach — worth a touch above life
const LIFE_PER_POINT = 8; // matches evaluate.ts W_LIFE
const CARD_VALUE = 45; // one drawn card (between a land and a spell)
const DESTROY_VALUE = 160; // destroy a representative permanent (≈ a 2/2 body)
const EXILE_VALUE = 175; // exile — no regen / graveyard recursion, worth a hair more
const COUNTER_VALUE = 130; // counter a representative spell/threat
const REANIMATE_VALUE = 140; // graveyard → battlefield a representative creature
const HAND_RETURN_VALUE = 55; // bounce (tempo removal) / regrowth (card advantage)
// Issue #1964 — the EXACT mirror of `HAND_RETURN_VALUE`, the same convention
// `SKIP_DRAW_STEP_SELF_VALUE`/`_DISRUPTION_VALUE` already use for one clause
// read from two directions: a `moveZone → hand` naming the ability's own
// BATTLEFIELD source is the identical primitive as a bounce/regrowth, but
// losing YOUR OWN board presence (and needing to recast) is a cost, not a
// gain. Reused, not invented — see `isSourceBattlefieldRefSelector` below for
// the narrow shape this fires on (never an announced target, never a
// graveyard-zoned ability's self-regrowth).
const HAND_RETURN_SELF_COST = -HAND_RETURN_VALUE;
const TUCK_VALUE = 45; // to library / exile / graveyard from graveyard
const PUMP_PER_STAT = 9; // per +1 power or +1 toughness
const TOKEN_DISCOUNT = 0.85; // a token still has to survive — latent discount
const NONCREATURE_TOKEN_VALUE = 40; // a Clue/Treasure/Food-style utility token
const SAC_FORCED_VALUE = 120; // an edict (opponent sacrifices) — discounted removal
const SAC_SELF_COST = -40; // sacrificing your OWN permanent (a cost)

// --- Backfill-Op point weights (issue #1430) --------------------------------
const RAMP_PER_MANA = 12; // one produced mana ≈ evaluate.ts's untapped-mana weight
const ENERGY_PER_POINT = 6; // an energy counter — a smaller, synergy-gated resource
const EXPERIENCE_PER_POINT = 14; // CR 122.1 — an experience counter: energy-like, but
// PERMANENT (no rule removes it, and it survives its source dying — CR 122.2 is
// object-scoped) and COMPOUNDING (each one makes every later trigger bigger),
// so it prices above a one-shot energy counter and near a life point's weight.
const POISON_PER_COUNTER = 16; // CR 122.1f — ten poison counters LOSE the game, so one
// counter is a tenth of a kill: priced at 2x a life point (LIFE_PER_POINT),
// the same "life total is 20, poison is 10" ratio, no engine card exposes it
// yet (the `addPlayerCounter` Op admits it; infect damage has its own path).
const ATTACH_VALUE = 15; // reconfigure/equip-style self-attach — a small pump bump
const MONARCH_VALUE = 70; // CR 720 — a recurring end-step draw, contested
const DISCARD_VALUE = 40; // a single discarded card — a hair under a drawn card
const WHOLE_HAND_DISCARD_VALUE = 110; // representative whole-hand discard (~3 cards)
const CARD_SELECTION_VALUE = 30; // lookDistribute/digMatchingToHand — an impulse-drawn card
const SCRY_PER_CARD_VALUE = 10; // one card of scry-style selection
const MILL_PER_CARD_VALUE = 6; // one milled card — a small library-resource shift
const GRANT_ABILITY_VALUE = 40; // a temporary keyword grant (evasion/utility)
const GRANT_CAST_VALUE = 20; // permission to cast an already-known exile/graveyard card
const GRANT_GRAVEYARD_PLAY_VALUE = 80; // broad graveyard-replay permission (board-scaling)
const GAIN_CONTROL_VALUE = 150; // steal — denial + a body, a hair under reanimate
const PREVENT_DAMAGE_FLAT_VALUE = 70; // Fog-style / two-way shield, no scalar amount
const REGENERATE_VALUE = 60; // a one-shot destroy-proof shield
const RESTRICT_CASTING_VALUE = 20; // a turn-scoped "can't cast" denial
const RESTRICT_ACTIVATION_VALUE = 15; // a turn-scoped "can't activate" denial
const GRANT_CAST_TIMING_VALUE = 8; // a "cast as though flash" self-grant (tempo)
const GRANT_SPELL_MANA_SUBSTITUTION_VALUE = 8; // one spell's colours fixed
const RESTRICT_COMBAT_VALUE = 45; // a targeted "can't attack/block" soft removal
const SET_BASE_PT_VALUE = 45; // a base-P/T set (CR 613.4b) — mostly a shrink/neutralize
const LOSE_ALL_ABILITIES_VALUE = 60; // an ability strip (CR 613.1f) — a neutralize that also takes evasion/engines, so above a bare P/T set
const PUT_BACK_PER_CARD = 5; // Brainstorm-style card-selection upside, per card
const SHUFFLE_SELF_VALUE = 10; // dodges the graveyard — small recursion-adjacent upside
const EXILE_SELF_VALUE = -5; // opposite of shuffleSelfIntoLibrary — forfeits graveyard recursion (Regrowth-style) on the resolving card itself, a small downside
const TAP_UNTAP_VALUE = 20; // Icy Manipulator-style tempo swing
const SKIP_UNTAP_VALUE = 18; // a one-shot "doesn't untap" lock — a delayed tap
const TRANSFORM_VALUE = 30; // a self-directed flip, assumed net-beneficial
// CR 712 / 400.7 (issue #2380) — an exile-and-return-transformed flip is a
// strictly bigger deal than the in-place one: the ORI template's back faces are
// planeswalkers, so the controller trades a small creature for a loyalty engine.
// Priced above TRANSFORM_VALUE but well below EMBLEM_VALUE — the upgrade is
// real, but it is also a CR 400.7 zone change that sheds counters and
// attachments, so it is not unambiguously free.
const EXILE_RETURN_TRANSFORMED_VALUE = 45;
const ANIMATE_DISCOUNT = 0.7; // an animated permanent isn't a "real" creature card
const EMBLEM_VALUE = 150; // a durable, uncounterable ultimate-style effect
const EXTRA_TURN_VALUE = 300; // CR 500.7 — an entire additional turn
// CR 500.8 — an additional COMBAT phase, not an additional turn. Pinned to the
// combat share of `EXTRA_TURN_VALUE`'s own published decomposition ("draw (150)
// + untap/main tempo (50) + combat (150)", `search.ts`), so the two prices stay
// consistent by construction instead of by coincidence.
const EXTRA_COMBAT_VALUE = 150;
const SKIP_TURN_VALUE = 300; // CR 614.10 — forfeiting an entire turn, the mirror of EXTRA_TURN_VALUE
const WIN_GAME_VALUE = 100000; // CR 104.2a — an alternate win condition
const ISLAND_SANCTUARY_PROTECTION_VALUE = 20; // player-wide "can't be attacked except by flying/islandwalk" — ground-only, tempered protection
const PROTECTION_FROM_EVERYTHING_VALUE = 45; // player-wide untargetable + ALL damage prevented for a full turn cycle — strictly stronger than Island Sanctuary (no evasion carve-out, covers burn and abilities too)
const RANGED_TOPDECK_PER_CARD = 3; // Sylvan Library-style selection upside per pool card, smaller than putBack since it's an optional life-gated pick, not a free reorder
const SKIP_DRAW_STEP_SELF_VALUE = -40; // CR 504.1/500.8 — forfeiting your OWN draw step is a real cost, a hair under -CARD_VALUE (the shipped card, Elfhame Sanctuary, pairs it with a land-to-hand upside elsewhere in the script)
const SKIP_DRAW_STEP_DISRUPTION_VALUE = 40; // the mirror case — denying ANOTHER player's draw step is turn-based card denial, worth the same one card, signed positive

// --- Backfill-Op point weights (issue #1515) --------------------------------
// castDuringResolution (CR 608.2f) and createTokenCopy (CR 707.2 + CR 111.1)
// were the LAST two `OP_VALUER_BACKFILL` rows (issue #1430's charter backfill
// deferred them for spell-level/runtime lookahead the flat model doesn't have)
// — valued here the same way every other lookahead-shaped Op already is: a
// representative flat magnitude, always `board-scaling` since the realized
// worth (which spell gets cast; the copied body's stats) is unknown until
// resolution.
const CAST_DURING_RESOLUTION_FREE_VALUE = 55; // a free mini-cast (Cascade-style) — a hair above a drawn card (CARD_VALUE), since no mana is spent
const CAST_DURING_RESOLUTION_PAID_VALUE = 20; // a pay-the-cost mini-cast — matches GRANT_CAST_VALUE's "permission to cast" scale, since the mana cost offsets most of the card's own worth
const COPY_TOKEN_REPRESENTATIVE_STAT = 2; // unknown copied body's P/T — same representative magnitude `grounding.ts`'s CF_ASSUMED_REF uses for a bound ref

/** A valuer: projects one Op onto the feature basis under a grounding mode. */
type Valuer<K extends EffectOp["op"]> = (
    op: OpOf<K>,
    ctx: GroundingContext
) => OpValue;

/** Attach `board-scaling` when a resolved amount grows with hidden/board state
 *  (so the caller knows the scalar is a floor). */
function tagScaling(scaling: boolean, ...tags: ValueTag[]): ValueTag[] {
    return scaling ? [...tags, "board-scaling"] : tags;
}

/** `{ target }` announced slot → the Op should carry a `targeted` prior
 *  (a `{ ref }` / `{ player }` selector does not). */
function isAnnouncedTarget(sel: object): boolean {
    return "target" in sel;
}

/** issue #1964 — true for a BARE ref selector (`{ ref: string }`) that
 *  resolves, via `ctx.isSourceBattlefieldRef` (extended per-call by
 *  `withCapturedSourceAliases` below), to the ability's own BATTLEFIELD
 *  source. Deliberately narrower than "not an announced target": an
 *  announced `{ target: n }` slot (`isAnnouncedTarget`) lacks a `ref` key and
 *  is excluded structurally, as are the positional-graveyard
 *  (`EffectZonePositionSelector`) and exiled-with-source selector shapes
 *  (neither carries `ref` either) — a `forEach`-bound `$each` or a
 *  `choice`-bound picks ref also fails `isSourceBattlefieldRef` (they name
 *  something OTHER than the resolving source). */
function isSourceBattlefieldRefSelector(
    sel: object,
    ctx: GroundingContext
): boolean {
    return "ref" in sel && ctx.isSourceBattlefieldRef(sel as EffectRef);
}

/** issue #1964 — extends `ctx.isSourceBattlefieldRef` so bound names a
 *  `delayedTrigger`/`reflexiveTrigger`'s own `capture` map aliases FROM an
 *  already-recognized battlefield-source ref also test true in the nested
 *  body. Dash's delayed return captures `$self: { ref: "$source" }`
 *  (`convex/cards/abilities/dash.ts`) and its nested body only ever names
 *  `{ ref: "$self" }` — a valuer that recognizes only the literal string
 *  `"$source"` never fires for that shape, which is exactly why the bug
 *  survived: the recursion (`delayedTrigger`'s own valuer, below) walks the
 *  nested script under the SAME ctx unless a caller augments it here.
 *  Pure passthrough (returns `ctx` itself) when no capture source aliases the
 *  battlefield source — an announced `{ target: n }` capture, a list-select,
 *  or a literal string all keep the outer ctx's answer unchanged. */
function withCapturedSourceAliases(
    ctx: GroundingContext,
    capture: Record<string, EffectCaptureSource> | undefined
): GroundingContext {
    if (!capture) return ctx;
    const aliasNames = new Set<string>();
    for (const [name, source] of Object.entries(capture)) {
        if (
            typeof source === "object" &&
            source !== null &&
            "ref" in source &&
            ctx.isSourceBattlefieldRef(source)
        ) {
            aliasNames.add(name);
        }
    }
    if (aliasNames.size === 0) return ctx;
    return {
        ...ctx,
        isSourceBattlefieldRef: (ref) =>
            aliasNames.has(ref.ref) || ctx.isSourceBattlefieldRef(ref),
    };
}

/** True for the `{ ref: "$each" }` forEach iteration variable used as a
 *  PLAYER ref (issue #1521). Every catalogue card naming a player this way
 *  does so inside a `forEach { set: "players" }` — an Earthquake / Flame
 *  Rift / Fissure-style "deals N damage to each player" (CR 120.3), which
 *  hits the caster too. The walker only evaluates a context-free `forEach`
 *  body ONCE (a representative member, not once per real player), so a
 *  valuer that saw this ref and guessed "self" (the generic `isSelf`
 *  heuristic for an opaque ref) would score the whole symmetric effect as a
 *  pure self-cost — wrong in the other direction from the bug this guards
 *  against. Treated as its own case so the caller can score it neutral. */
function isEachPlayerRef(ref: EffectPlayerRef): boolean {
    return typeof ref === "object" && "ref" in ref && ref.ref === "$each";
}

// -------------------------------------------------------------------------
// Charter-Op valuers (issue #1426). Each is small and reads ONLY the Op shape
// through the grounding context — never live state directly, so the same
// function serves both grounding modes.
// -------------------------------------------------------------------------

const dealDamage: Valuer<"dealDamage"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.amount);
    // A card's own damage to an OBJECT (creature/planeswalker/battle) is,
    // from its caster's POV, always aimed at a threat — an object can't be
    // "the caster" the way a player ref can.
    const toPlayer = "player" in op.to;
    const tags: ValueTag[] = tagScaling(scaling, "damage");
    if (!toPlayer && isAnnouncedTarget(op.to)) tags.push("targeted");
    if (!toPlayer) {
        return { points: amount * DAMAGE_PER_POINT, tags };
    }
    const playerRef = (op.to as { player: EffectPlayerRef }).player;
    // Issue #1521 — a player-directed damage Op is NOT always aimed at the
    // opponent: recoil/symmetric riders (Fire and Brimstone's "4 damage to
    // you", Brothers of Fire's activated ability) name `"controller"` as a
    // genuine self-cost, and an Earthquake/Flame Rift-style effect names the
    // `$each` forEach-over-players iteration variable, which hits everyone
    // (net neutral — see `isEachPlayerRef`).
    if (isEachPlayerRef(playerRef)) {
        return { points: 0, tags };
    }
    // Issue #1548 — `ctx.isSelf` can't disambiguate an opaque/BOUND player
    // ref (`{ ref: "$slain.controller" }`, Agonizing Demise / Collapsing
    // Borders / Ankh of Mishra's upkeep trigger). Grounding's CONTEXT-FREE
    // `isSelf` (grounding.ts) treats every `{ ref }` object as self — the
    // "$source etc." branch, built for OBJECT refs (dealDamage's own `to`
    // target uses `$each`/target snapshots that way), not a bound PLAYER
    // selector — and would flip every one of these opponent-directed/
    // symmetric burns to a scored self-cost. Only the LITERAL `"controller"`
    // string is a genuine self-cost (the caster IS the resolving spell's
    // controller, CR 109.5); a bound ref names an ARBITRARY player determined
    // at resolution, so it gets the same harmful-by-default assumption
    // `loseLife`/`discard`/`mill` use for their own ambiguous player refs
    // (opponent-directed unless the ref literally names the caster).
    const self =
        typeof playerRef === "object" && "ref" in playerRef
            ? false
            : ctx.isSelf(playerRef, "opponent");
    if (self) tags.push("self-cost");
    return { points: amount * DAMAGE_PER_POINT * (self ? -1 : 1), tags };
};

const dealDamageDividedAsChosen: Valuer<"dealDamageDividedAsChosen"> = (
    op,
    ctx
) => {
    // `total` mirrors `divideAsChosen.total` (number | "X" | "X+1"). Reuse the
    // dealDamage valuer's X estimate by mapping the string forms onto the
    // `{ X: true }` EffectValue; X+1 adds one point on top.
    const { amount, scaling } =
        typeof op.total === "number"
            ? ctx.value(op.total)
            : ctx.value({ X: true });
    const total = op.total === "X+1" ? amount + 1 : amount;
    // Divided burn among announced targets — removal + reach, always targeted.
    return {
        points: total * DAMAGE_PER_POINT,
        tags: [...tagScaling(scaling, "damage"), "targeted"],
    };
};

const draw: Valuer<"draw"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.count);
    // "you draw" (self) is card advantage; "target player draws" as a downside
    // (opponent) is negative.
    const self = ctx.isSelf(op.player, "self");
    const points = amount * CARD_VALUE * (self ? 1 : -1);
    return { points, tags: tagScaling(scaling, "cardAdvantage") };
};

const gainLife: Valuer<"gainLife"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.amount);
    const self = ctx.isSelf(op.player, "self");
    return {
        points: amount * LIFE_PER_POINT * (self ? 1 : -1),
        tags: tagScaling(scaling, "lifeSwing"),
    };
};

const loseLife: Valuer<"loseLife"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.amount);
    // Life loss is aimed at the opponent by default (a drain); the caster
    // paying life themselves is a cost.
    const self = ctx.isSelf(op.player, "opponent");
    const tags = tagScaling(scaling, "lifeSwing");
    if (self) tags.push("self-cost");
    return { points: amount * LIFE_PER_POINT * (self ? -1 : 1), tags };
};

const destroy: Valuer<"destroy"> = (op) => ({
    points: DESTROY_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval", "board-scaling"],
});

const exile: Valuer<"exile"> = (op) => ({
    points: EXILE_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval", "board-scaling"],
});

// CR 608.2 (issue #1097) — the resolving spell redirects itself from the
// graveyard to exile (Restock, Recall). Opposite sign from
// `shuffleSelfIntoLibrary`: it forfeits future graveyard recursion on THIS
// card rather than gaining any, a small downside rather than an upside.
const exileSelf: Valuer<"exileSelf"> = () => ({
    points: EXILE_SELF_VALUE,
    tags: [],
});

// CR 603.7a / 701.13 / ADR 0028 — the exile half of the O-Ring / Banishing
// Light family removes an opponent's permanent from the board (until this
// source leaves), so for search purposes it values like `exile` removal: a
// targeted board answer. The conditional return (when the source dies) is a
// downside the AI doesn't model here — a first-order removal valuation is the
// right approximation, matching how `gainControl` values as removal despite
// its own conditional-revert caveat.
const exileWithAttachments: Valuer<"exileWithAttachments"> = (op) => ({
    points: EXILE_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval", "board-scaling"],
});

// The RETURN half fires on the source's own leave/untap trigger — the AI never
// proactively chooses it, and returning the exiled (opponent's) permanent is a
// wash it doesn't control. Neutral, like `armGraveyardRedirect`.
const returnExiledForSource: Valuer<"returnExiledForSource"> = () =>
    ZERO_OP_VALUE;

// CR 608.2h / 400.7 (issue #2384) — the cross-ability binding memory. Both
// halves are pure BOOKKEEPING: `captureBinding` writes a last-known-information
// row onto the source and `recallCapturedBinding` reads it back, neither moving
// a card, a life total, or a permanent. The material consequence belongs
// entirely to the Ops that read the recalled binding (Skyclave Apparition's
// `createToken`, valued by `createToken` itself), so pricing either half again
// here would double-count it.
const captureBinding: Valuer<"captureBinding"> = () => ZERO_OP_VALUE;
const recallCapturedBinding: Valuer<"recallCapturedBinding"> = () =>
    ZERO_OP_VALUE;

const counter: Valuer<"counter"> = () => ({
    points: COUNTER_VALUE,
    tags: ["disruption", "targeted"],
});

// CR 400.7 (issue #2605) — a non-counter stack departure. Same disruption
// FAMILY as `counter`, priced by what the victim keeps, which is the only axis
// the destination changes:
//   - `library-bottom` — the spell is un-cast and the card is buried a whole
//     library away, which in practice reads as "answered" for the rest of the
//     game, so it prices AT `counter`. (Strictly it is LESS gone than a
//     graveyard — it is still drawable, and a graveyard is recursion territory
//     in either direction — but neither difference is one this valuer can see
//     from the Op alone.)
//   - `library-top` — the card survives but eats the owner's next draw, a
//     tempo-plus-card-selection tax that lands just under a clean answer;
//   - `hand` — pure TEMPO: the spell is un-cast, the mana is wasted, and the
//     card comes straight back (Reprieve). Materially it is half an answer,
//     and pricing it AT `counter` would have the bot trade a real counterspell
//     for a bounce it should keep in reserve.
const SPELL_TO_LIBRARY_TOP_VALUE = 110;
const SPELL_TO_HAND_VALUE = 65;
const moveSpellFromStack: Valuer<"moveSpellFromStack"> = (op) => ({
    points:
        op.destination === "library-bottom"
            ? COUNTER_VALUE
            : op.destination === "library-top"
              ? SPELL_TO_LIBRARY_TOP_VALUE
              : SPELL_TO_HAND_VALUE,
    tags: ["disruption", "targeted"],
});

const mayPay: Valuer<"mayPay"> = () => {
    // A "you may pay …" / "unless its controller pays …" decision carries no
    // intrinsic material of its own — its consequence is the `if` branch that
    // reads the `$paid` binding, valued by that branch's own Ops (context-free
    // takes the effect-happens branch). The decision node itself is neutral.
    return ZERO_OP_VALUE;
};

const sacrifice: Valuer<"sacrifice"> = (op) => {
    if (op.permanents) {
        // A forced sacrifice over a picks set — an edict (opponent sacrifices).
        // Discounted vs. targeted removal: the chooser keeps their best, and a
        // symmetric "each player sacrifices" also hits the caster.
        return { points: SAC_FORCED_VALUE, tags: ["boardRemoval"] };
    }
    // Issue #1521 — a single-permanent sacrifice signs by WHOSE permanent it
    // is, not a blanket self-cost. `target` covers two distinct shapes
    // (CR 701.21):
    //   - an ANNOUNCED target slot (`{ target: N }`) — a legal target chosen
    //     at cast/activation time, which the target requirement may allow to
    //     be an opponent's permanent (a targeted removal effect, like
    //     `destroy`/`exile`) — value it as removal, not a cost.
    //   - a `$source`/other snapshot-bound ref (Kjeldoran Elite Guard's
    //     literal self-sac, Phantasmal Mount, a `choice`-selected own
    //     permanent) — the CASTER's own permanent, a genuine cost.
    if (op.target && isAnnouncedTarget(op.target)) {
        return {
            points: SAC_FORCED_VALUE,
            tags: ["boardRemoval", "targeted"],
        };
    }
    return { points: SAC_SELF_COST, tags: ["boardRemoval", "self-cost"] };
};

/** Value contribution of a `moveZone` by its destination zone. */
function moveZonePoints(to: EffectMoveZone): { points: number; tag: Feature } {
    switch (to) {
        case "battlefield":
            // Reanimation (graveyard → battlefield) — a body AND card advantage.
            return { points: REANIMATE_VALUE, tag: "recursion" };
        case "hand":
            // Bounce (battlefield → hand, tempo removal) OR regrowth (graveyard
            // → hand, card advantage) — both a gain for the caster.
            return { points: HAND_RETURN_VALUE, tag: "tempo" };
        case "library":
        case "exile":
        case "graveyard":
            return { points: TUCK_VALUE, tag: "tempo" };
    }
}

const moveZone: Valuer<"moveZone"> = (op, ctx) => {
    // The player/from/to shape (a self-directed library/hand shuffle-in, e.g.
    // "put your hand on the bottom of your library") carries no `to` zone worth
    // scoring as removal/advantage — treat as neutral library manipulation.
    if (!("to" in op) || !("target" in op)) {
        return { points: 0, tags: ["tempo"] };
    }
    // Issue #1964 — returning the ability's own BATTLEFIELD source to hand is
    // a COST (a self-bounce: board presence lost, the permanent must be
    // recast from scratch, losing summoning sickness' clock too), not the
    // generic bounce/regrowth benefit `moveZonePoints` prices for every other
    // `to: "hand"` shape. Dash (CR 702.109a) is the card that surfaced it:
    // `delayedTrigger{ capture: { $self: {ref:"$source"} }, effects: [
    // moveZone $self -> hand] }` used to score as a flat +55 "generic bounce"
    // — wrong-signed for the caster's OWN creature, and worth +95 combined
    // with the haste grant, an active incentive to dash a creature that
    // should stay on the battlefield. `isSourceBattlefieldRefSelector` is the
    // narrow discriminator: it does NOT fire for an announced `{ target: n }`
    // slot (stays priced as removal/tempo even when the chooser happens to
    // name their own permanent, mirroring `sacrifice`'s own `target` branch),
    // nor for a graveyard-zoned ability's `$source` (Master of Death, CR
    // 603.6e `zone: "graveyard"` — `withGraveyardSource` in
    // `cardScriptValue.ts` forces `isSourceBattlefieldRef` false there, so
    // "return it to your hand" keeps scoring as the card advantage it is).
    if (op.to === "hand" && isSourceBattlefieldRefSelector(op.target, ctx)) {
        return {
            points: HAND_RETURN_SELF_COST,
            tags: ["tempo", "self-cost"],
        };
    }
    // CR 404.3 (issue #1967) — the positional graveyard shape ("the top
    // creature card of your graveyard" — Shallow Grave, Corpse Dance) needs
    // NO special case here, and the absence is deliberate rather than an
    // omission: it carries a `target`, so it passes the guard above and its
    // `to: "battlefield"` scores as REANIMATE_VALUE like any other
    // reanimation, and `isAnnouncedTarget` already answers false for it (the
    // engine picks the card deterministically — nothing is announced, CR
    // 115), so it correctly misses the `targeted` tag. Both facts are pinned
    // by a test in `__tests__/opValuers.bot.test.ts`; the guard above must
    // stay keyed on the PRESENCE of `target`, not on it being announced, or
    // both shipped cards silently valuate at 0 and the bot never casts them.
    const { points, tag } = moveZonePoints(op.to);
    const tags: ValueTag[] = [tag];
    if (isAnnouncedTarget(op.target)) tags.push("targeted");
    return { points, tags };
};

const createToken: Valuer<"createToken"> = (op, ctx) => {
    const { amount: count, scaling } = op.count
        ? ctx.value(op.count)
        : { amount: 1, scaling: false };
    const spec = op.token;
    const isCreatureToken = spec.types.includes("Creature");
    // CR 208.2 (issue #2384) — the token's P/T may be a full `EffectValue` (an
    // X/X sized off a ref at resolution, Skyclave Apparition's Illusion), so it
    // goes through the SAME `ctx.value` grounding `count` already uses rather
    // than being read as a bare number. A dynamic size also makes the whole
    // creation scaling: the bot must see "bigger when X is bigger", exactly as
    // it does for a scaling count.
    const p = spec.power === undefined ? undefined : ctx.value(spec.power);
    const t =
        spec.toughness === undefined ? undefined : ctx.value(spec.toughness);
    const ptScaling = (p?.scaling ?? false) || (t?.scaling ?? false);
    const per = isCreatureToken
        ? TOKEN_DISCOUNT *
          creatureValueRaw(
              Math.max(0, p?.amount ?? 0),
              Math.max(0, t?.amount ?? 0),
              0, // a token has no mana value (CR 111.4 — no mana cost)
              spec.staticAbilities ?? []
          )
        : NONCREATURE_TOKEN_VALUE; // a utility token (Clue, Treasure) — flat presence
    return {
        points: per * count,
        tags: tagScaling(scaling || ptScaling, "tokens"),
    };
};

// Backfilled Op (issue #1515) — the copy sibling of `createToken` above.
// Unlike `createToken`'s JSON-pure spec, `source` is a RUNTIME permanent (an
// announced target or an earlier `ref`), so the copied body's P/T/abilities
// are unknowable to this flat static model — a representative 2/2 discounted
// like a token, ALWAYS `board-scaling` regardless of `count` (the body, not
// just the count, is a floor here).
const createTokenCopy: Valuer<"createTokenCopy"> = (op, ctx) => {
    const grounded = op.count ? ctx.value(op.count) : { amount: 1 };
    const count = grounded.amount;
    // CR 707.2's "except its base power and toughness are N/N" (Eternalize,
    // issue #2339) is a STATIC, known-at-authoring-time body — score it exactly
    // rather than through the representative stat, which is only a stand-in for
    // the runtime source's unknown P/T (Dance of Many).
    const power = op.except?.basePower ?? COPY_TOKEN_REPRESENTATIVE_STAT;
    const toughness =
        op.except?.baseToughness ?? COPY_TOKEN_REPRESENTATIVE_STAT;
    const per =
        TOKEN_DISCOUNT *
        creatureValueRaw(
            power,
            toughness,
            0, // a token copy has no mana value (CR 111.4 — no mana cost)
            []
        );
    const tags = tagScaling(true, "tokens");
    if (isAnnouncedTarget(op.source)) tags.push("targeted");
    return { points: per * count, tags };
};

const pump: Valuer<"pump"> = (op, ctx) => {
    const p = ctx.signedValue(op.power);
    const t = ctx.signedValue(op.toughness);
    const net = p.amount + t.amount;
    const scaling = p.scaling || t.scaling;
    // A positive pump buffs a creature (pump); a negative one shrinks it
    // (Weakness, Toxic Deluge — board removal). Either way the caster benefits,
    // so the magnitude is scored positive; the sign only picks the feature.
    const feature: Feature = net >= 0 ? "pump" : "boardRemoval";
    return {
        points: Math.abs(net) * PUMP_PER_STAT,
        tags: tagScaling(scaling, feature),
    };
};

/** Parse a P/T counter type (e.g. "+1/+1", "-1/-1", "+2/+0") into signed stat
 *  deltas; returns null for a non-P/T counter (charge, loyalty, …). */
function parsePtCounter(
    counter: string
): { power: number; toughness: number } | null {
    const m = /^([+-]\d+)\/([+-]\d+)$/.exec(counter);
    if (!m) return null;
    return { power: Number(m[1]), toughness: Number(m[2]) };
}

const counters: Valuer<"counters"> = (op, ctx) => {
    const { amount: count, scaling } = ctx.value(op.count);
    const pt = parsePtCounter(op.counter);
    const sign = op.action === "add" ? 1 : -1;
    if (pt) {
        const net = (pt.power + pt.toughness) * sign;
        const feature: Feature = net >= 0 ? "pump" : "boardRemoval";
        return {
            points: Math.abs(net) * count * PUMP_PER_STAT,
            tags: tagScaling(scaling, feature),
        };
    }
    // A non-P/T counter (charge, fade, …) — a small, resource-ish contribution.
    return {
        points: count * PUMP_PER_STAT * sign,
        tags: tagScaling(scaling, "pump"),
    };
};

// -------------------------------------------------------------------------
// Backfill-Op valuers (issue #1430). Each maps its Op onto the SAME fixed
// feature basis the charter Ops use — no per-card shapes, no new dimensions.
// Where an Op's worth is genuinely context-only or negligible (a pure enabler
// like `setColor`/`nameCard`), the valuer returns `ZERO_OP_VALUE` rather than
// inventing a magnitude.
// -------------------------------------------------------------------------

const addMana: Valuer<"addMana"> = (op) => {
    const total = Object.values(op.mana).reduce(
        (sum: number, n) => sum + (n ?? 0),
        0
    );
    return { points: total * RAMP_PER_MANA, tags: ["ramp"] };
};

const addSubtype: Valuer<"addSubtype"> = () => ZERO_OP_VALUE;

const animate: Valuer<"animate"> = (op) => {
    const points =
        ANIMATE_DISCOUNT *
        creatureValueRaw(
            Math.max(0, op.power),
            Math.max(0, op.toughness),
            0,
            op.grantedAbilities ?? []
        );
    const tags: ValueTag[] = op.duration ? ["pump", "tempo"] : ["pump"];
    return { points, tags };
};

// A base-P/T set (CR 613.4b layer 7b). The in-scope callers overwhelmingly
// SHRINK an opponent's creature (Sorceress Queen 0/2, Island of Wak-Wak /
// Singing Tree power 0) — a targeted soft-removal / neutralize, valued like a
// combat restriction. (A rare buff-direction set, the 5/5, is the exception the
// flat heuristic tolerates.)
const setBasePT: Valuer<"setBasePT"> = (op) => ({
    points: SET_BASE_PT_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval"],
});

const armGraveyardRedirect: Valuer<"armGraveyardRedirect"> = () =>
    ZERO_OP_VALUE;

const attach: Valuer<"attach"> = (op) => ({
    points: ATTACH_VALUE,
    tags: isAnnouncedTarget(op.target) ? ["pump", "targeted"] : ["pump"],
});

const becomeMonarch: Valuer<"becomeMonarch"> = () => ({
    points: MONARCH_VALUE,
    tags: ["cardAdvantage"],
});

const choiceOp: Valuer<"choice"> = () => {
    // A mid-resolution pick carries no intrinsic material of its own — its
    // consequence is read back by a LATER Op (`sacrifice`, `discard`,
    // `moveZone`) through the picks binding, valued by that Op instead.
    return ZERO_OP_VALUE;
};

// `delayedTrigger`/`divideIntoPiles` recurse into a nested Effect Script, so
// their valuers are declared where `valueEffectScript` is hoisted (function
// declarations hoist module-wide, so the forward reference below is safe).
//
// Issue #1964 — `withCapturedSourceAliases` extends `ctx` with any `capture`
// binding that aliases the ability's own battlefield source BEFORE recursing,
// so a nested self-bounce (Dash's `moveZone { ref: "$self" } -> hand`, where
// `$self` was captured as `{ ref: "$source" }`) is priced as the self-cost it
// is rather than the generic bounce benefit — the recursion is exactly where
// that context has to survive or the fix reaches nothing inside the body.
const delayedTrigger: Valuer<"delayedTrigger"> = (op, ctx) =>
    valueEffectScript(op.effects, withCapturedSourceAliases(ctx, op.capture));

// CR 603.12 — a reflexive trigger's whole value IS its body: the Op itself
// only queues a stack object. Same recursion as `delayedTrigger`, and — unlike
// it — with no discount for the wait, since a reflexive ability resolves in
// the same priority round rather than at a future phase boundary. Same
// `capture`-alias threading as `delayedTrigger` (issue #1964) — a reflexive
// self-bounce would hit the identical mis-scoring otherwise.
const reflexiveTrigger: Valuer<"reflexiveTrigger"> = (op, ctx) =>
    valueEffectScript(op.effects, withCapturedSourceAliases(ctx, op.capture));

const digMatchingToHand: Valuer<"digMatchingToHand"> = () => ({
    points: CARD_SELECTION_VALUE,
    tags: ["cardAdvantage", "board-scaling"],
});

// CR 701.20a / 401.4 (issue #1364, Atraxa) — a categorized reveal-and-keep.
// Its ceiling is one card per category, but the REAL yield is capped by how
// many distinct categories the revealed window happens to represent, which is
// unknowable at scoring time (the library is hidden). Value it at the number
// of categories, damped: a nine-category Atraxa reliably nets ~3-4 cards off a
// ten-card window, not nine. Never scaling — `look`/`categories` are literals.
const CATEGORIZED_KEEP_YIELD = 0.4; // categories → expected cards actually kept
const revealAndCategorize: Valuer<"revealAndCategorize"> = (op) => ({
    points: Math.round(
        op.categories.length * CATEGORIZED_KEEP_YIELD * CARD_SELECTION_VALUE
    ),
    tags: ["cardAdvantage"],
});

// CR 601.2b / 701.9 (issue #1945) — per-category choice from a set, applied
// once per player via `forEach { set: "players" }` (Noxious Vapors / Planar
// Overlay both read "each player…"). Whichever player `op.player` resolves to
// acts on THEIR OWN hand/battlefield, so the sign mirrors `discard`'s
// harmful-by-default convention: negative when `op.player` is LITERALLY the
// caster (a genuine self-cost — the caster's own hand gets thinned, or their
// own land gets bounced), positive otherwise.
//
// The two player-ref traps `dealDamage` already guards against apply here
// verbatim, and both shipped cards walk straight into them:
//   - `{ ref: "$each" }` (issue #1521) — the `forEach { set: "players" }`
//     iteration variable. The walker evaluates a context-free `forEach` body
//     ONCE, so there is no second, opposite-signed iteration to cancel it: a
//     self-negative reading is simply a self-negative score, and the bot would
//     never cast its own symmetric sweeper. Scored NEUTRAL, like every other
//     symmetric each-player effect.
//   - a BOUND `{ ref }` (issue #1548) — context-free `isSelf` maps every
//     `{ ref }` object to self, so a bound player ref must be treated as NOT
//     self and take the harmful-by-default (opponent-directed) sign.
const CATEGORIZED_SWEEP_VALUE = 15; // Noxious Vapors — hand thinned to ≤1-per-colour, own worse cards lost
const CATEGORIZED_BOUNCE_VALUE = 10; // Planar Overlay — a land returns to hand, a turn of tempo
const chooseCategorized: Valuer<"chooseCategorized"> = (op, ctx) => {
    const bounce = op.onPicked === "returnToHand";
    const tags: ValueTag[] = bounce ? ["tempo"] : ["cardAdvantage"];
    // Symmetric each-player sweep — hits the caster too, net neutral.
    if (isEachPlayerRef(op.player)) return { points: 0, tags };
    const self =
        typeof op.player === "object" && "ref" in op.player
            ? false
            : ctx.isSelf(op.player, "opponent");
    if (self) tags.push("self-cost");
    const magnitude = bounce
        ? CATEGORIZED_BOUNCE_VALUE
        : CATEGORIZED_SWEEP_VALUE;
    return { points: magnitude * (self ? -1 : 1), tags };
};

// CR 702.75a (issue #783) — HIDEAWAY: one card of the looked-at window is set
// aside face down for a LATER conditional free play. Worth less than an
// impulse-drawn card in hand (the payoff is gated on a condition that may never
// be met and the card is unusable until then) but strictly more than nothing:
// half a card's selection value, never scaling (`look` is the keyword's literal
// N and does not change how many cards are exiled — always exactly one).
const HIDEAWAY_YIELD = 0.5;
const hideaway: Valuer<"hideaway"> = () => ({
    points: Math.round(HIDEAWAY_YIELD * CARD_SELECTION_VALUE),
    tags: ["cardAdvantage"],
});

// `keepTo` (issue #2070) is not read here — the heuristic values "cards
// selected out of a look window" the same whether they land in hand or on
// top of the library (both beat a random topdeck); a card-shaped refinement
// (e.g. weighing library-top lower once a second `keepTo` consumer exists)
// is a future bot-slice concern, not this issue's scope.
const lookDistribute: Valuer<"lookDistribute"> = (op, ctx) => {
    const { amount, scaling } = op.take
        ? ctx.value(op.take)
        : { amount: 1, scaling: false };
    return {
        points: amount * CARD_SELECTION_VALUE,
        tags: tagScaling(scaling, "cardAdvantage"),
    };
};

const discard: Valuer<"discard"> = (op, ctx) => {
    // Harmful-by-default assumption (mirrors `loseLife`): a discard targets
    // the OPPONENT unless the player ref clearly resolves to the caster.
    const self = ctx.isSelf(op.player, "opponent");
    const sign = self ? -1 : 1;
    if (op.cards) {
        const tags: ValueTag[] = ["cardAdvantage"];
        if (self) tags.push("self-cost");
        return { points: DISCARD_VALUE * sign, tags };
    }
    // Whole-hand discard — no live hand-size reader on `GroundingContext`, so
    // a representative multi-card magnitude stands in for both modes.
    const tags = tagScaling(true, "cardAdvantage");
    if (self) tags.push("self-cost");
    return { points: WHOLE_HAND_DISCARD_VALUE * sign, tags };
};

const discardAtRandom: Valuer<"discardAtRandom"> = (op, ctx) => {
    // Harmful-by-default (mirrors `discard`/`loseLife`): a random discard is
    // aimed at the OPPONENT unless the player ref resolves to the caster. The
    // `count` scales the magnitude (Mind Twist's {X}); one discarded card is
    // worth DISCARD_VALUE, the same disruption weight as a `discard` picks-op.
    const { amount, scaling } = ctx.value(op.count);
    const self = ctx.isSelf(op.player, "opponent");
    const sign = self ? -1 : 1;
    const tags = tagScaling(scaling, "cardAdvantage");
    if (self) tags.push("self-cost");
    return { points: amount * DISCARD_VALUE * sign, tags };
};

// CR 400.7 (issue #1947) — a random pick from a source-linked exile pile,
// returned to its OWNER's hand (Skyship Weatherlight). Modeled as a flat
// regrowth-style card-advantage gain (`HAND_RETURN_VALUE`'s "bounce (tempo
// removal) / regrowth (card advantage)" framing) — the static model cannot
// know which card the seeded RNG will pick, so it values the ACT of
// retrieval rather than any specific card, the same flat-constant treatment
// `grantCastFromExile` uses for an equally unknowable card-specific outcome.
const randomExileToHand: Valuer<"randomExileToHand"> = () => ({
    points: HAND_RETURN_VALUE,
    tags: ["cardAdvantage"],
});

const divideIntoPiles: Valuer<"divideIntoPiles"> = (op, ctx) => {
    // Issue #1521 — NOT a coin flip: the `chooser` (not the `divider`) picks
    // which pile runs `chosenEffect` vs. `otherEffect` (ADR 0053), so this is
    // a MINIMAX pick, not an even-odds draw. When the CASTER is the chooser
    // (Fact or Fiction: divider="opponent", chooser="controller") they pick
    // whichever pile serves them best — the BEST case (max). When the
    // OPPONENT is the chooser (Death or Glory / Stand or Fall / Bend or
    // Break's forced half: divider="controller", chooser="opponent" — the
    // adversarial case this issue targets), they hand the caster the split
    // that serves the caster least — the WORST case (min), always ≤ the
    // naive average the old code used.
    const chosen = valueEffectScript(op.chosenEffect, ctx);
    const other = valueEffectScript(op.otherEffect, ctx);
    const tags = new Set<ValueTag>([
        ...chosen.tags,
        ...other.tags,
        "disruption",
    ]);
    const chooserIsSelf = ctx.isSelf(op.chooser, "opponent");
    const points = chooserIsSelf
        ? Math.max(chosen.points, other.points)
        : Math.min(chosen.points, other.points);
    return { points, tags: [...tags] };
};

const emblem: Valuer<"emblem"> = () => ({
    points: EMBLEM_VALUE,
    tags: ["pump"],
});

const extraTurn: Valuer<"extraTurn"> = () => ({
    points: EXTRA_TURN_VALUE,
    tags: ["tempo"],
});

// CR 500.8 (issue #2886) — an additional combat phase: another attack step with
// the same board, so tempo, priced at the combat share of an extra turn.
//
// NOT the extra-turn STRUCTURAL CREDIT, and must never become it (ADR 0111
// decision 6). That credit lives in `selectRootMove` (`search.ts`) and exists
// only because an extra TURN falls OUTSIDE the rollout horizon — ADR 0015 ends
// each rollout at the start of the bot's next turn, so the granted turn is
// never played out and its value would otherwise be invisible. An extra COMBAT
// is INSIDE the horizon (`playoutRollout` breaks only on
// `turnChanged && activePlayerId === botId`), so it is simulated and its value
// reaches the edge's mean reward by ordinary measurement; adding a reward
// credit for it would double-count. This table is the orthogonal thing: a
// caster-relative PRIOR over candidate cards/choices (`candidateValue.ts`,
// `choicePriors.ts`), never a term added to a rollout's reward.
const extraCombat: Valuer<"extraCombat"> = () => ({
    points: EXTRA_COMBAT_VALUE,
    tags: ["tempo"],
});

// CR 614.10 (issue #1957) — the mirror of `extraTurn`: forfeiting a whole
// turn is worth -SKIP_TURN_VALUE to whoever skips it, +SKIP_TURN_VALUE to the
// CASTER when it is the opponent who skips. Harmful-by-default (mirrors
// `loseLife`): an ambiguous player ref (an announced target slot) is assumed
// to name the OPPONENT unless it resolves to the caster — `ctx.isSelf(op.player,
// "opponent")`, not `"self"` (the latter is the BENEFICIAL-op assumption and
// would price a future "target player skips their next turn" card as though
// the bot always inflicted the skip on itself). The shipped card (Waterspout
// Elemental) passes the literal `"controller"`, which `isSelf` resolves to
// `true` regardless of the assumption, so its valuation is unchanged by this.
const skipNextTurn: Valuer<"skipNextTurn"> = (op, ctx) => {
    const self = ctx.isSelf(op.player, "opponent");
    const tags: ValueTag[] = ["tempo"];
    if (self) tags.push("self-cost");
    return { points: (self ? -1 : 1) * SKIP_TURN_VALUE, tags };
};

const gainControl: Valuer<"gainControl"> = (op) => ({
    points: GAIN_CONTROL_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval"],
});

// CR 122.1 — counters put on a PLAYER. The sign depends on the KIND, not just
// on who receives them (issue #1969): energy and experience are resources the
// recipient wants, poison is an attack on them (CR 122.1f — ten loses the
// game). Written as an exhaustive `Record` over `PlayerCounterKind` so a new
// kind is a type error here rather than a silently-neutral valuation.
const PLAYER_COUNTER_WEIGHT: Readonly<
    Record<PlayerCounterKind, { points: number; gift: boolean; tag: ValueTag }>
> = {
    energy: { points: ENERGY_PER_POINT, gift: true, tag: "ramp" },
    experience: { points: EXPERIENCE_PER_POINT, gift: true, tag: "ramp" },
    poison: { points: POISON_PER_COUNTER, gift: false, tag: "lifeSwing" },
};

const addPlayerCounter: Valuer<"addPlayerCounter"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.amount);
    const weight = PLAYER_COUNTER_WEIGHT[op.counter];
    // A gift defaults to the caster ("you get {E}"); an attack defaults to the
    // opponent ("target player gets a poison counter"), mirroring
    // `gainLife`/`loseLife`.
    const self = ctx.isSelf(op.player, weight.gift ? "self" : "opponent");
    const good = weight.gift ? self : !self;
    const tags = tagScaling(scaling, weight.tag);
    if (weight.gift && !self) tags.push("self-cost");
    return {
        points: amount * weight.points * (good ? 1 : -1),
        tags,
    };
};

const grantAbility: Valuer<"grantAbility"> = (op) => ({
    points: GRANT_ABILITY_VALUE,
    tags: isAnnouncedTarget(op.target) ? ["evasion", "targeted"] : ["evasion"],
});

// Backfilled Op (issue #1515). Unlike `grantCastFromExile`/
// `grantCastFromGraveyard` (which only grant a LATER impulse window), this Op
// resolves the mini-cast NOW — the realized value is the recursive value of
// whatever gets cast, unknowable to the flat static model, so it always
// carries `board-scaling`. `free` (Cascade-style, no mana spent) is valued
// above a plain drawn card; a paid mini-cast nets far less since the mana
// cost offsets most of the cast card's own worth.
const castDuringResolution: Valuer<"castDuringResolution"> = (op) => ({
    points: op.free
        ? CAST_DURING_RESOLUTION_FREE_VALUE
        : CAST_DURING_RESOLUTION_PAID_VALUE,
    tags: tagScaling(true, "cardAdvantage"),
});

const grantCastFromExile: Valuer<"grantCastFromExile"> = () => ({
    points: GRANT_CAST_VALUE,
    tags: ["cardAdvantage"],
});

const grantCastFromGraveyard: Valuer<"grantCastFromGraveyard"> = () => ({
    points: GRANT_CAST_VALUE,
    tags: ["cardAdvantage"],
});

const grantGraveyardPlay: Valuer<"grantGraveyardPlay"> = () => ({
    points: GRANT_GRAVEYARD_PLAY_VALUE,
    tags: tagScaling(true, "cardAdvantage"),
});

const libraryLook: Valuer<"libraryLook"> = () => ZERO_OP_VALUE;

const mill: Valuer<"mill"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.count);
    // Harmful-by-default assumption: milling targets the OPPONENT (a
    // library-resource denial) unless the ref clearly resolves to the caster.
    const self = ctx.isSelf(op.player, "opponent");
    return {
        points: amount * MILL_PER_CARD_VALUE * (self ? -1 : 1),
        tags: tagScaling(scaling, "cardAdvantage"),
    };
};

// Reveal the top N and route each by what it is (Nadu, Winged Wisdom). Every
// destination in `RevealRouteDestination` still gets the card OUT of the
// library, so the yield is one card of advantage per revealed card regardless
// of which route fires — a land hitting the battlefield and a spell hitting
// the hand are both worth roughly a drawn card here. Routes sending cards to
// the graveyard/exile are self-mill and worth strictly less, so the per-card
// value is damped off `CARD_VALUE` rather than taken at face value.
const REVEAL_ROUTE_PER_CARD = 35;
const revealTopAndRoute: Valuer<"revealTopAndRoute"> = (op, ctx) => {
    const { amount, scaling } = op.count
        ? ctx.value(op.count)
        : { amount: 1, scaling: false };
    return {
        points: amount * REVEAL_ROUTE_PER_CARD,
        tags: tagScaling(scaling, "cardAdvantage"),
    };
};

const nameCard: Valuer<"nameCard"> = () => ZERO_OP_VALUE;

const preventDamage: Valuer<"preventDamage"> = (op, ctx) => {
    if (op.mode === "next-n") {
        const { amount, scaling } = ctx.value(op.amount);
        return {
            points: amount * LIFE_PER_POINT,
            tags: tagScaling(scaling, "protection"),
        };
    }
    // "next-n-divided" (Pollen Remedy, issue #1955) — the same absorbed-damage
    // scalar as "next-n", just spread over several targets. `total` mirrors
    // `divideAsChosen.total` (number | "X" | "X+1"), the exact vocabulary
    // `dealDamageDividedAsChosen`'s valuer already resolves, so reuse it.
    if (op.mode === "next-n-divided") {
        const { amount, scaling } =
            typeof op.total === "number"
                ? ctx.value(op.total)
                : ctx.value({ X: true });
        const total = op.total === "X+1" ? amount + 1 : amount;
        return {
            points: total * LIFE_PER_POINT,
            tags: [...tagScaling(scaling, "protection"), "targeted"],
        };
    }
    // "all-combat" (Fog) / "combat-to-and-by" (Maze of Ith) /
    // "all-from-source" (Falling Timber, Rith's Charm) / "all-from-matching"
    // (Radiant Kavu) — no scalar amount, a flat defensive shield.
    return { points: PREVENT_DAMAGE_FLAT_VALUE, tags: ["protection"] };
};

const putBack: Valuer<"putBack"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.count);
    return {
        points: amount * PUT_BACK_PER_CARD,
        tags: tagScaling(scaling, "cardAdvantage"),
    };
};

// Sylvan Library's ranged 0..N "drawn this turn" topdeck-or-pay pick — a
// card-SELECTION upside over the `max` pool (smaller per-card than `putBack`
// since it's gated behind an optional per-card life cost, not a free
// reorder). The life the player MIGHT pay is not netted out (an approximate,
// context-free heuristic like every other valuer here).
const rangedTopdeck: Valuer<"rangedTopdeck"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.max);
    return {
        points: amount * RANGED_TOPDECK_PER_CARD,
        tags: tagScaling(scaling, "cardAdvantage"),
    };
};

const regenerate: Valuer<"regenerate"> = (op) => ({
    points: REGENERATE_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["protection", "targeted"]
        : ["protection"],
});

// The inverse of `regenerate`: strip a creature's regeneration for the turn —
// an offensive removal-enabler (it lets a companion destroy/damage stick), so
// it is worth a fraction of a full removal, not the defensive REGENERATE_VALUE.
const PREVENT_REGEN_VALUE = 25;

const preventRegeneration: Valuer<"preventRegeneration"> = (op) => ({
    points: PREVENT_REGEN_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval"],
});

// CR 614.1a — "if it would die this turn, exile it instead" (issue #1095).
// A graveyard-denial rider, not removal in itself: it only pays off when the
// creature actually dies this turn, and what it buys is the recursion the
// opponent would otherwise get. Valued alongside `preventRegeneration` — the
// other half of the same "make this removal stick" sentence — rather than as
// a removal spell in its own right.
const EXILE_ON_DEATH_VALUE = 25;

const exileOnDeath: Valuer<"exileOnDeath"> = (op) => ({
    points: EXILE_ON_DEATH_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval"],
});

// CR 615.12 / 614.9 (issue #2231) — "damage dealt to that creature this turn
// can't be prevented or dealt instead to another permanent or player". Like
// `exileOnDeath`, a rider that makes removal STICK rather than removal in its
// own right: it only pays off if damage is actually aimed at the creature this
// turn, and what it buys is the Fog / Circle of Protection / Jade Monolith the
// defender would otherwise spend. Valued a shade under `exileOnDeath` because
// the graveyard denial that Op buys is unconditional once the creature dies,
// whereas this one is dead weight in a turn with no damage in it.
const DAMAGE_LOCK_VALUE = 20;

const lockDamage: Valuer<"lockDamage"> = (op) => ({
    points: DAMAGE_LOCK_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval"],
});

// Source-side combat-damage neutralization (Warning / Restrain): the marked
// creature deals 0 combat damage this turn — a single-creature defensive shield
// worth a fraction of a full Fog (which stops the whole combat).
const MARK_ASSIGNS_NO_COMBAT_DAMAGE_VALUE = 40;
const markAssignsNoCombatDamage: Valuer<"markAssignsNoCombatDamage"> = (
    op
) => ({
    points: MARK_ASSIGNS_NO_COMBAT_DAMAGE_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["protection", "targeted"]
        : ["protection"],
});

const restrictActivation: Valuer<"restrictActivation"> = () => ({
    points: RESTRICT_ACTIVATION_VALUE,
    tags: ["disruption"],
});

const restrictCasting: Valuer<"restrictCasting"> = () => ({
    points: RESTRICT_CASTING_VALUE,
    tags: ["disruption"],
});

const grantCastTiming: Valuer<"grantCastTiming"> = () => ({
    // A "cast sorcery spells as though they had flash" self-grant (Teferi +1) —
    // a modest tempo/flexibility gain, not board impact. Valued low.
    points: GRANT_CAST_TIMING_VALUE,
    tags: ["tempo"],
});

const grantSpellManaSubstitution: Valuer<
    "grantSpellManaSubstitution"
> = () => ({
    // CR 609.4b — "for one spell this turn you may spend mana as though it were
    // mana of any type" (North Star). Buys COLOUR FLEXIBILITY for one cast, not
    // extra mana and not board impact: per CR 609.4b the cost is unchanged, so
    // the gain is exactly the off-colour spell it unlocks. Valued alongside the
    // other one-shot casting permissions rather than as ramp.
    points: GRANT_SPELL_MANA_SUBSTITUTION_VALUE,
    tags: ["tempo"],
});

const restrictCombat: Valuer<"restrictCombat"> = (op) => {
    // "cant-be-blocked" (CR 509.1b) is the evasion side — an offensive buff to
    // YOUR creature (it connects), not disruption of an opponent's board. Value
    // and tag it like a keyword-evasion grant, not soft removal.
    if (op.restriction === "cant-be-blocked") {
        return {
            points: GRANT_ABILITY_VALUE,
            tags: isAnnouncedTarget(op.target)
                ? ["evasion", "targeted"]
                : ["evasion"],
        };
    }
    return {
        points: RESTRICT_COMBAT_VALUE,
        tags: isAnnouncedTarget(op.target)
            ? ["boardRemoval", "targeted"]
            : ["boardRemoval"],
    };
};

// Island Sanctuary's player-scoped "can't be attacked except by flying/
// islandwalk" protection — a broad defensive effect, but tempered vs.
// `restrictCombat`'s per-creature `cant-attack` (RESTRICT_COMBAT_VALUE)
// because it only stops GROUND attackers, not evasive ones.
const setIslandSanctuaryProtection: Valuer<
    "setIslandSanctuaryProtection"
> = () => ({
    points: ISLAND_SANCTUARY_PROTECTION_VALUE,
    tags: ["protection"],
});

// "You gain protection from everything until your next turn" (The One Ring,
// CR 702.16b/e/i) — the strongest defensive Op in the vocabulary: it blanks
// EVERY damage source and every targeted removal/burn aimed at the player for
// a full turn cycle, with no evasion carve-out to play around (contrast
// `setIslandSanctuaryProtection`, which only stops ground attackers).
const setProtectionFromEverything: Valuer<
    "setProtectionFromEverything"
> = () => ({
    points: PROTECTION_FROM_EVERYTHING_VALUE,
    tags: ["protection"],
});

// Tamiyo, Seasoned Scholar's +2 ("Until your next turn, whenever a creature
// attacks you or a planeswalker you control, it gets -1/-0 until end of
// turn", CR 606 / 603.7a, issue #2385) is now a real `delayedTrigger` +
// `pump` composition (no dedicated Op) — its value is the generic
// `delayedTrigger` valuer's recursion into the nested Effect Script below
// (`valueEffectScript`), which prices the inline `pump -1/-0` the same as
// any other `pump` Op. No per-card valuer needed.

const reveal: Valuer<"reveal"> = () => ZERO_OP_VALUE;

// A private look at a random hand card grants information, no board material.
const lookRandomHand: Valuer<"lookRandomHand"> = () => ZERO_OP_VALUE;

// A private look at a whole hand grants information, no board material —
// identical valuation to its one-random-card sibling above. (The Bot does not
// yet model hidden-information advantage; when it does, both look Ops and the
// public `reveal` above become one family, which is why all three sit on the
// same ZERO_OP_VALUE rather than each guessing a number.)
const lookHand: Valuer<"lookHand"> = () => ZERO_OP_VALUE;

const scryReorder: Valuer<"scryReorder"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.count);
    return {
        points: amount * SCRY_PER_CARD_VALUE,
        tags: tagScaling(scaling, "cardAdvantage"),
    };
};

const setColor: Valuer<"setColor"> = () => ZERO_OP_VALUE;

const setSubtype: Valuer<"setSubtype"> = () => ZERO_OP_VALUE;

// A card-type SET (CR 205.1a layer 4) carries no material worth on its own —
// it changes WHAT the permanent is, not how much board it represents. Like
// `setColor` / `addSubtype` / `setSubtype` above it is a pure enabler, and the
// composed effect's worth is carried by the Ops it is paired with (Oko's
// `loseAllAbilities` + `setBasePT`). ZERO rather than an invented magnitude.
const setCardTypes: Valuer<"setCardTypes"> = () => ZERO_OP_VALUE;

// Stripping every ability (CR 613.1f layer 6) is a NEUTRALIZE: the permanent
// stays on the battlefield but stops doing anything it was printed to do —
// the same shape the `setBasePT` shrink is valued as (a targeted soft removal
// that leaves a body behind), not a hard `destroy`. Worth a little MORE than a
// P/T set, because it also takes away evasion, protection, activated engines
// and triggers rather than only combat stats.
const loseAllAbilities: Valuer<"loseAllAbilities"> = (op) => ({
    points: LOSE_ALL_ABILITIES_VALUE,
    tags: isAnnouncedTarget(op.target)
        ? ["boardRemoval", "targeted"]
        : ["boardRemoval"],
});

// Same neutralize shape as `loseAllAbilities` above, but SOURCE-KEYED
// (Tishana's Tidebinder, issue #1562: "for as long as this creature remains
// on the battlefield") rather than indefinite. `target` is always an
// ANNOUNCED slot here (`EffectTargetRef` — the counter-then-rider template
// never uses a `$ref`/`$source`/forEach form), so the `targeted` tag is
// unconditional, unlike `loseAllAbilities`'s `isAnnouncedTarget` branch.
// Valued identically to the indefinite form: the bot has no cheap way to
// weigh "reverts when the source dies" against "never reverts", and a slight
// over-valuation of a temporary strip is far safer than the alternative
// failure mode — undervaluing it and handing the opponent's removal target
// away for free.
const loseAllAbilitiesWhileSourceRemains: Valuer<
    "loseAllAbilitiesWhileSourceRemains"
> = () => ({
    points: LOSE_ALL_ABILITIES_VALUE,
    tags: ["boardRemoval", "targeted"],
});

const shuffleSelfIntoLibrary: Valuer<"shuffleSelfIntoLibrary"> = () => ({
    points: SHUFFLE_SELF_VALUE,
    tags: ["recursion"],
});

const tapUntap: Valuer<"tapUntap"> = (op) => ({
    points: TAP_UNTAP_VALUE,
    tags: isAnnouncedTarget(op.target) ? ["tempo", "targeted"] : ["tempo"],
});

const skipNextUntap: Valuer<"skipNextUntap"> = (op) => ({
    points: SKIP_UNTAP_VALUE,
    tags: isAnnouncedTarget(op.target) ? ["tempo", "targeted"] : ["tempo"],
});

// CR 504.1 / 500.8 (issue #1097 — Elfhame Sanctuary's "you skip your draw
// step this turn"). Signs by direction, same discipline as `sacrifice`
// (issue #1521): the one shipped card self-targets via the plain
// `"controller"` literal, and there the skip is the DOWNSIDE half of a
// value exchange (a land fetched into hand, paid for by forfeiting this
// turn's draw) — a real cost, valued negatively with a `self-cost` tag. Any
// OTHER player selector (`"opponent"`, an announced target slot, a
// `controllerOf` ref) denies someone else's draw instead — turn-based card
// denial, valued like the `disruption`-tagged Ops (`restrictActivation`/
// `restrictCasting`) just above.
const skipDrawStepThisTurn: Valuer<"skipDrawStepThisTurn"> = (op) => {
    if (op.player === "controller") {
        return {
            points: SKIP_DRAW_STEP_SELF_VALUE,
            tags: ["cardAdvantage", "self-cost"],
        };
    }
    return {
        points: SKIP_DRAW_STEP_DISRUPTION_VALUE,
        tags: ["disruption"],
    };
};

const transform: Valuer<"transform"> = (op) => ({
    points: TRANSFORM_VALUE,
    tags: isAnnouncedTarget(op.target) ? ["pump", "targeted"] : ["pump"],
});

const exileAndReturnTransformed: Valuer<"exileAndReturnTransformed"> = (
    op
) => ({
    points: EXILE_RETURN_TRANSFORMED_VALUE,
    tags: isAnnouncedTarget(op.target) ? ["pump", "targeted"] : ["pump"],
});

const unattach: Valuer<"unattach"> = () => ZERO_OP_VALUE;

const winGame: Valuer<"winGame"> = () => ({
    points: WIN_GAME_VALUE,
    tags: [],
});

/** The full Op dispatch table — one valuer per non-structural implemented Op
 *  (charter Ops from issue #1426, backfilled Ops from issues #1430 and
 *  #1515). Keyed by Op name exactly like `OP_EXECUTORS`. Kept a `Partial`
 *  over the Op union: the coverage guard proves every OTHER implemented Op is
 *  a structural construct — the backfill allowlist is empty (issue #1515). */
export const OP_VALUERS: {
    [K in EffectOp["op"]]?: Valuer<K>;
} = {
    // Charter Ops (issue #1426).
    dealDamage,
    dealDamageDividedAsChosen,
    draw,
    gainLife,
    loseLife,
    destroy,
    exile,
    exileSelf,
    exileWithAttachments,
    returnExiledForSource,
    captureBinding,
    recallCapturedBinding,
    counter,
    moveSpellFromStack,
    mayPay,
    sacrifice,
    moveZone,
    createToken,
    pump,
    counters,
    // Backfilled Ops (issue #1430).
    addMana,
    addSubtype,
    animate,
    setBasePT,
    armGraveyardRedirect,
    attach,
    becomeMonarch,
    castDuringResolution,
    choice: choiceOp,
    createTokenCopy,
    delayedTrigger,
    reflexiveTrigger,
    digMatchingToHand,
    lookDistribute,
    hideaway,
    revealAndCategorize,
    chooseCategorized,
    discard,
    discardAtRandom,
    randomExileToHand,
    divideIntoPiles,
    emblem,
    extraTurn,
    extraCombat,
    skipNextTurn,
    gainControl,
    addPlayerCounter,
    grantAbility,
    grantCastFromExile,
    grantCastFromGraveyard,
    grantGraveyardPlay,
    libraryLook,
    mill,
    revealTopAndRoute,
    nameCard,
    preventDamage,
    markAssignsNoCombatDamage,
    putBack,
    rangedTopdeck,
    regenerate,
    preventRegeneration,
    exileOnDeath,
    lockDamage,
    restrictActivation,
    restrictCasting,
    grantCastTiming,
    grantSpellManaSubstitution,
    restrictCombat,
    setIslandSanctuaryProtection,
    setProtectionFromEverything,
    reveal,
    lookRandomHand,
    lookHand,
    scryReorder,
    setColor,
    setSubtype,
    setCardTypes,
    loseAllAbilities,
    loseAllAbilitiesWhileSourceRemains,
    shuffleSelfIntoLibrary,
    tapUntap,
    skipNextUntap,
    skipDrawStepThisTurn,
    transform,
    exileAndReturnTransformed,
    unattach,
    winGame,
};

/** The structural constructs the WALKER handles by recursion — never a leaf
 *  valuer. They branch/iterate over nested Op lists (`if`.then/else,
 *  `forEach`.effects, `optionChoice`.modes,
 *  `coinFlip`/`coinFlipSync`.win/loss) rather than contributing intrinsic
 *  material. The coverage guard treats these as covered (they are
 *  exhaustively handled in `valueOp` below) — they belong on neither
 *  `OP_VALUERS` nor the backfill allowlist. */
export const STRUCTURAL_CONSTRUCTS = new Set<EffectOp["op"]>([
    "if",
    "forEach",
    "optionChoice",
    "coinFlip",
    "coinFlipSync",
]);

function addValues(a: OpValue, b: OpValue): OpValue {
    const tags = new Set<ValueTag>([...a.tags, ...b.tags]);
    return { points: a.points + b.points, tags: [...tags] };
}

/** Value one Op under a grounding mode — dispatches structural constructs to
 *  recursive walks and leaf Ops to `OP_VALUERS`. An Op with no valuer
 *  (defensive default — every implemented Op has one since issue #1430
 *  emptied the backfill allowlist) contributes nothing. */
export function valueOp(op: EffectOp, ctx: GroundingContext): OpValue {
    switch (op.op) {
        case "if": {
            // Context-free assumes the effect happens — take the `then` branch;
            // the `else` (usually the "cost paid, nothing else" arm) is the
            // approximated path. Context-aware could evaluate the predicate; for
            // now both modes take `then` (the material-bearing branch).
            return valueEffectScript(op.then, ctx);
        }
        case "forEach": {
            const { amount, scaling } = ctx.forEachCount(op.select);
            const per = valueEffectScript(op.effects, ctx);
            const tags = scaling
                ? [...new Set<ValueTag>([...per.tags, "board-scaling"])]
                : per.tags;
            return { points: per.points * amount, tags };
        }
        case "optionChoice": {
            // A modal spell is worth its BEST mode (the chooser picks it).
            let best = ZERO_OP_VALUE;
            for (const mode of op.modes) {
                const v = valueEffectScript(mode.effects, ctx);
                if (v.points > best.points) best = v;
            }
            return best;
        }
        case "coinFlip":
        case "coinFlipSync": {
            // Even odds — the expected value of the two branches. Same walk
            // for both Ops: `coinFlipSync` (issue #1281) only skips the
            // reveal-ack suspension, the win/loss branch shape and the
            // even-odds valuation are identical.
            const win = valueEffectScript(op.win.effects, ctx);
            const loss = valueEffectScript(op.loss.effects, ctx);
            return {
                points: (win.points + loss.points) / 2,
                tags: [...new Set<ValueTag>([...win.tags, ...loss.tags])],
            };
        }
        default: {
            const valuer = OP_VALUERS[op.op] as
                | ((op: EffectOp, ctx: GroundingContext) => OpValue)
                | undefined;
            return valuer ? valuer(op, ctx) : ZERO_OP_VALUE;
        }
    }
}

/** All Op names the walker handles WITHOUT a backfill entry — a leaf valuer or
 *  a structural construct. The coverage guard reads this to prove every
 *  implemented Op is either here or explicitly backfilled. */
export const VALUED_OR_STRUCTURAL: ReadonlySet<string> = new Set<string>([
    ...Object.keys(OP_VALUERS),
    ...STRUCTURAL_CONSTRUCTS,
]);

// ---------------------------------------------------------------------------
// Beneficence: the SIGN of an Op, for its RECIPIENT (issue #1888)
// ---------------------------------------------------------------------------
//
// `OP_VALUERS` answers "how much material is this Op worth to the CASTER". That
// is a magnitude and it is deliberately caster-relative: `destroy` is worth
// `DESTROY_VALUE` whoever the victim is. The bug class in issue #1888 needs the
// orthogonal axis — for the player on the RECEIVING end of this Op, is it a
// gift or an attack? Without it a beneficial aura's two candidate hosts (own
// land vs opponent's land) are indistinguishable and the pick is rollout noise
// (Wild Growth handed to the opponent).
//
// Zero per-card knowledge, by construction: the sign is a property of the Op
// name (plus, for the three parametrized Ops, the Op's own numeric/mode field),
// never of the card that uses it.
//
// `neutral` is the SAFE default and the deliberate answer for every Op whose
// sign genuinely depends on context (`moveZone` — bounce is harmful to a
// permanent's controller but a graveyard-to-hand move is a gift; `sacrifice` —
// the recipient chooses and it is routinely a cost the controller WANTS to
// pay). A `Partial` map with a neutral fallback fails OPEN into "no opinion",
// which costs a missed redirect, never a wrong one.

/** The sign of an Op's effect on the player it names / the controller of the
 *  object it names. Orthogonal to `OpValue.points` (a caster-relative
 *  magnitude). */
export type Beneficence = "beneficial" | "harmful" | "neutral";

/** Static sign per Op name. Ops whose sign depends on a parameter
 *  (`pump`, `counters`, `tapUntap`) are resolved by {@link opBeneficence} and
 *  deliberately absent here. */
const OP_BENEFICENCE: { [K in EffectOp["op"]]?: Beneficence } = {
    // ── Gifts to the recipient ────────────────────────────────────────────
    draw: "beneficial",
    gainLife: "beneficial",
    addMana: "beneficial",
    createToken: "beneficial",
    createTokenCopy: "beneficial",
    extraTurn: "beneficial",
    // CR 500.8 — names no recipient at all (an extra PHASE belongs to the turn,
    // so the beneficiary is always its active player, i.e. the resolving side).
    // Listed rather than left to the `?? "neutral"` fallback so the sign is a
    // recorded decision: there is no slot for a redirect reader to bite on, and
    // a silent absence would read as "sign genuinely context-dependent".
    extraCombat: "beneficial",
    regenerate: "beneficial",
    preventDamage: "beneficial",
    grantAbility: "beneficial",
    becomeMonarch: "beneficial",
    grantCastFromExile: "beneficial",
    grantCastFromGraveyard: "beneficial",
    randomExileToHand: "beneficial",
    grantGraveyardPlay: "beneficial",
    grantCastTiming: "beneficial",
    grantSpellManaSubstitution: "beneficial",
    castDuringResolution: "beneficial",
    returnExiledForSource: "beneficial",
    setProtectionFromEverything: "beneficial",
    setIslandSanctuaryProtection: "beneficial",
    emblem: "beneficial",
    // CR 712 / 400.7 (issue #2380) — the ORI flip-walker template: the
    // permanent's OWNER gets it back, upgraded to its planeswalker face. Always
    // a gift to the recipient, even though the intervening exile is a real zone
    // change (the in-place `transform` Op stays unlisted/neutral — its sign is
    // genuinely ambiguous, since a werewolf can be flipped either way).
    exileAndReturnTransformed: "beneficial",
    lookDistribute: "beneficial",
    hideaway: "beneficial",
    digMatchingToHand: "beneficial",
    winGame: "beneficial",
    // ── Attacks on the recipient ──────────────────────────────────────────
    dealDamage: "harmful",
    dealDamageDividedAsChosen: "harmful",
    loseLife: "harmful",
    destroy: "harmful",
    exile: "harmful",
    exileWithAttachments: "harmful",
    counter: "harmful",
    // CR 400.7 (issue #2605) — un-casting someone's spell is an attack on them
    // whatever zone it lands in, exactly like `counter`. Listed explicitly
    // rather than left to the `?? "neutral"` fallback: "return target spell to
    // its owner's HAND" reads superficially like a gift, and a neutral sign is
    // how the bot ends up handing an effect to the opponent.
    moveSpellFromStack: "harmful",
    discard: "harmful",
    discardAtRandom: "harmful",
    mill: "harmful",
    // CR 613.1b layer 2 — a control change strips the permanent from the
    // player who currently controls it.
    gainControl: "harmful",
    preventRegeneration: "harmful",
    exileOnDeath: "harmful",
    // CR 615.12 / 614.9 — the lock is armed on a creature the caster intends to
    // KILL through a shield/redirect the defender would otherwise get to use
    // (Whippoorwill). Harmful to the permanent it names, exactly like its
    // `preventRegeneration` / `exileOnDeath` sentence-mates.
    lockDamage: "harmful",
    restrictActivation: "harmful",
    restrictCasting: "harmful",
    restrictCombat: "harmful",
    markAssignsNoCombatDamage: "harmful",
    skipNextUntap: "harmful",
    skipNextTurn: "harmful",
    skipDrawStepThisTurn: "harmful",
    unattach: "harmful",
    armGraveyardRedirect: "harmful",
    shuffleSelfIntoLibrary: "harmful",
    // CR 613.1f layer 6 — stripping every ability takes the permanent's whole
    // printed function away from whoever controls it. Always an attack, never
    // a gift: unlike a P/T set (which can go either way) there is no "loses
    // all abilities" that helps its recipient.
    loseAllAbilities: "harmful",
    // CR 613.1f layer 6, SOURCE-KEYED sibling of `loseAllAbilities` above
    // (issue #1562) — same "always an attack" reasoning: a temporary ability
    // strip still takes the permanent's whole printed function away from
    // whoever controls it for as long as it lasts.
    loseAllAbilitiesWhileSourceRemains: "harmful",
    // ── Explicitly signless ──────────────────────────────────────────────
    // CR 608.2h / 400.7 (issue #2384) — the cross-ability binding memory names
    // no recipient at all: it writes and reads a last-known-information row on
    // the source itself, helping and hurting nobody. Listed rather than left to
    // the `?? "neutral"` fallback so the sign is a RECORDED decision — a silent
    // absence would read as "sign genuinely context-dependent", which these are
    // not. Whatever material follows belongs to the Ops that read the recalled
    // binding.
    captureBinding: "neutral",
    recallCapturedBinding: "neutral",
    // CR 400.2 (issue #2383) — a private look moves no material and names no
    // beneficiary: the LOOKER gains information, while the Op's recipient (the
    // hand's owner) is neither helped nor hurt. Listed rather than left to the
    // `?? "neutral"` fallback so the sign is a RECORDED decision, matching the
    // pair above; the public `reveal` and `lookRandomHand` predate this
    // convention and stay unlisted at the same effective sign.
    lookHand: "neutral",
    // CR 205.1a layer 4 (`setCardTypes`) is deliberately UNLISTED, i.e.
    // "neutral": replacing a permanent's card types is genuinely ambiguous in
    // sign on its own (it can strip Artifact off an opponent's Equipment or
    // turn your own land into a creature). The composed effect's sign comes
    // from the Ops it is paired with — same treatment as `transform` above.
};

/** Sign of one Op for its recipient (issue #1888). Reads the Op's own shape for
 *  the three Ops whose sign is a PARAMETER, not a name: a `pump` / `counters`
 *  can be a buff or a shrink, and `tapUntap` is a Twiddle in either direction.
 *  `neutral` for anything unlisted — the fail-open default (see the block
 *  comment above). */
export function opBeneficence(
    op: EffectOp,
    ctx: GroundingContext = contextFreeGrounding()
): Beneficence {
    switch (op.op) {
        case "pump": {
            // A +N/+N is a buff, a −N/−N is a shrink (Weakness). Read through
            // the SAME `signedValue` the `pump` valuer uses so a computed
            // amount resolves identically in both readers.
            const net =
                ctx.signedValue(op.power).amount +
                ctx.signedValue(op.toughness).amount;
            return net > 0 ? "beneficial" : net < 0 ? "harmful" : "neutral";
        }
        case "counters": {
            // CR 122 — a +1/+1 counter is a gift, a −1/−1 counter is not.
            // `remove` inverts whichever it is.
            const pt = parsePtCounter(op.counter);
            if (!pt) return "neutral";
            const sign = pt.power + pt.toughness;
            if (sign === 0) return "neutral";
            const net = op.action === "add" ? sign : -sign;
            return net > 0 ? "beneficial" : "harmful";
        }
        case "addPlayerCounter":
            // CR 122.1 — the SIGN is the counter KIND's, not the table's:
            // energy/experience are resources the recipient wants, poison is
            // an attack on them (CR 122.1f — ten loses the game). This case is
            // why `addPlayerCounter` has no `OP_BENEFICENCE` row: that table is
            // a flat Op→sign map and would have to pick one sign for both.
            return PLAYER_COUNTER_WEIGHT[op.counter].gift
                ? "beneficial"
                : "harmful";
        case "tapUntap":
            return op.action === "untap" ? "beneficial" : "harmful";
        default:
            return OP_BENEFICENCE[op.op] ?? "neutral";
    }
}

/** Walk an Effect Script, summing each Op's value (PRD #1423). The scalar sum
 *  feeds `cardValue`; the merged tag set feeds the context target-priors. */
export function valueEffectScript(
    effects: readonly EffectOp[],
    ctx: GroundingContext = contextFreeGrounding()
): OpValue {
    let acc = ZERO_OP_VALUE;
    for (const op of effects) acc = addValues(acc, valueOp(op, ctx));
    return acc;
}
