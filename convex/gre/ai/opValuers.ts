// Per-Op value model — the OP_VALUERS dispatch table (PRD #1423 "DSL semantic
// layer", issue #1426). Mirrors the interpreter's `OP_EXECUTORS`: one entry per
// Op, keyed by Op name. Where an executor APPLIES an Op to game state, a valuer
// VALUES it — projecting it onto the fixed feature basis (`featureBasis.ts`) as
// a Forge-scale `{ points, tags }`. A script's value is the walker's sum over
// its Ops (`valueEffectScript`).
//
// This ticket ships the CHARTER Ops only (the highest-frequency / most
// eval-relevant verbs, PRD #1423). Every other `status:"implemented"` Op sits
// on the backfill allowlist (`OP_VALUER_BACKFILL`, emptied by the follow-up
// issue #1430) — the coverage guard
// (`convex/cards/__tests__/opValuerCoverage.test.ts`) fails CI on any
// implemented Op that is neither valued, a walker-handled structural construct,
// nor on the allowlist.
//
// Point magnitudes are on `evaluate.ts`'s Forge scale (a 2/2 vanilla ≈ 170, one
// life ≈ 8, one untapped mana ≈ 12). They are hand-tuned for ORDERING (a burn/
// removal spell must out-score a do-nothing spell of equal mana value) — the
// PRD tunes them further against the blade suite in a later slice.

import type { EffectOp, EffectMoveZone } from "../../cards/types";
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
const TUCK_VALUE = 45; // to library / exile / graveyard from graveyard
const PUMP_PER_STAT = 9; // per +1 power or +1 toughness
const TOKEN_DISCOUNT = 0.85; // a token still has to survive — latent discount
const NONCREATURE_TOKEN_VALUE = 40; // a Clue/Treasure/Food-style utility token
const SAC_FORCED_VALUE = 120; // an edict (opponent sacrifices) — discounted removal
const SAC_SELF_COST = -40; // sacrificing your OWN permanent (a cost)

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

// -------------------------------------------------------------------------
// Charter-Op valuers (issue #1426). Each is small and reads ONLY the Op shape
// through the grounding context — never live state directly, so the same
// function serves both grounding modes.
// -------------------------------------------------------------------------

const dealDamage: Valuer<"dealDamage"> = (op, ctx) => {
    const { amount, scaling } = ctx.value(op.amount);
    // A card's own damage is, from its caster's POV, aimed at the opponent /
    // an opposing creature (CF assumption); an object target is a threat.
    const toPlayer = "player" in op.to;
    const tags: ValueTag[] = tagScaling(scaling, "damage");
    if (!toPlayer && isAnnouncedTarget(op.to)) tags.push("targeted");
    // loseLife-to-self is impossible here (damage to own face is never a
    // card's intent) — always a gain for the caster.
    return { points: amount * DAMAGE_PER_POINT, tags };
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

const counter: Valuer<"counter"> = () => ({
    points: COUNTER_VALUE,
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
    // A single announced/`$source` sacrifice is almost always the CASTER's own
    // permanent paid as a cost (Kjeldoran Elite Guard, a self-sac ability).
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

const moveZone: Valuer<"moveZone"> = (op) => {
    // The player/from/to shape (a self-directed library/hand shuffle-in, e.g.
    // "put your hand on the bottom of your library") carries no `to` zone worth
    // scoring as removal/advantage — treat as neutral library manipulation.
    if (!("to" in op) || !("target" in op)) {
        return { points: 0, tags: ["tempo"] };
    }
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
    const per = isCreatureToken
        ? TOKEN_DISCOUNT *
          creatureValueRaw(
              Math.max(0, spec.power ?? 0),
              Math.max(0, spec.toughness ?? 0),
              0, // a token has no mana value (CR 111.4 — no mana cost)
              spec.staticAbilities ?? []
          )
        : NONCREATURE_TOKEN_VALUE; // a utility token (Clue, Treasure) — flat presence
    return {
        points: per * count,
        tags: tagScaling(scaling, "tokens"),
    };
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

/** The charter-Op dispatch table — one valuer per charter Op (issue #1426).
 *  Keyed by Op name exactly like `OP_EXECUTORS`. Kept a `Partial` over the Op
 *  union: the coverage guard proves every OTHER implemented Op is either a
 *  structural construct or on the backfill allowlist. */
export const OP_VALUERS: {
    [K in EffectOp["op"]]?: Valuer<K>;
} = {
    dealDamage,
    draw,
    gainLife,
    loseLife,
    destroy,
    exile,
    counter,
    mayPay,
    sacrifice,
    moveZone,
    createToken,
    pump,
    counters,
};

/** The structural constructs the WALKER handles by recursion — never a leaf
 *  valuer. They branch/iterate over nested Op lists (`if`.then/else,
 *  `forEach`.effects, `optionChoice`.modes, `coinFlip`.win/loss) rather than
 *  contributing intrinsic material. The coverage guard treats these as covered
 *  (they are exhaustively handled in `valueOp` below) — they belong on neither
 *  `OP_VALUERS` nor the backfill allowlist. */
export const STRUCTURAL_CONSTRUCTS = new Set<EffectOp["op"]>([
    "if",
    "forEach",
    "optionChoice",
    "coinFlip",
]);

function addValues(a: OpValue, b: OpValue): OpValue {
    const tags = new Set<ValueTag>([...a.tags, ...b.tags]);
    return { points: a.points + b.points, tags: [...tags] };
}

/** Value one Op under a grounding mode — dispatches structural constructs to
 *  recursive walks and leaf Ops to `OP_VALUERS`. An Op with no valuer (a
 *  backfilled Op, #1430) contributes nothing. */
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
        case "coinFlip": {
            // Even odds — the expected value of the two branches.
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
