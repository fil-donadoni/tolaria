// Board-aware latent pricing for a card in hand (issue #3398, PRD #3397).
//
// THE BUG THIS EXISTS FOR. Until this module, a removal spell's latent worth
// in hand was a CONSTANT — `DESTROY_VALUE = 160` in `opValuers.ts`, a 2/2's
// worth, whatever the board actually held. So Stone Rain priced the same
// against an empty battlefield and against a Shivan Dragon, while the land it
// would destroy is worth 17 on the board: announcing it cost 205 margin points
// (the spell's latent 160 leaves the hand, 17 comes back in) and greedy and a
// 400-iteration search both passed, every seed (issue #3322, reproduced in
// `docs/research/greedy-vs-search.md`).
//
// THE MODEL. A targeted, board-affecting Op is worth the fitted
// `EvalWeights.latent` weight for its dimension TIMES the realised board loss
// of its BEST LEGAL TARGET on the current board, expressed in units of a
// REPRESENTATIVE victim (a vanilla 2/2 for two — the body the old constant was
// hand-tuned against, so one unit reproduces today's number exactly). The
// victim's realised loss is read from the SAME per-permanent math `evaluate`
// already runs (`permanentRealisedValue`, `evaluate.ts`), passed in as a
// callback: one pass over the opponent's permanents, no probe, no second
// valuation authority.
//
// LEGALITY IS NOT RE-DERIVED HERE. Which permanents a card could actually hit
// comes from `getLegalTargets` (`gre/rules.ts`), the single target-filter
// authority (ADR 0068) — the same function `selectTarget` agrees with. A lens
// that re-implemented "target land" would drift from the engine the first time
// a filter grew a clause, and would price a spell by victims it cannot legally
// take.
//
// CARD-AGNOSTIC (ADR 0102): nothing here reads a card name. It reads target
// requirements, board contents and the fitted weights.
import type {
    CardDefinition,
    EffectCardFilter,
    EffectForEachSelector,
    TargetRequirement,
} from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import {
    matchesPermanentFilter,
    type PermanentFilter,
} from "../../cards/filters";
import { creatureValueRaw } from "../creatureBody";
import { currentLoyalty } from "../loyalty";
import { effectivePermanentView } from "../permanentView";
import { liveSupertypesOf } from "../snow";
import { getLegalTargets, pendingTargetingSource } from "../rules";
import type { EvalWeights } from "./evalWeights";
import type { LatentLens, SweepOutcome } from "./grounding";

/** The REPRESENTATIVE victim's body: a vanilla 2/2 for two. Not a new tuning
 *  constant — it is the body `DESTROY_VALUE = 160` was hand-tuned against
 *  ("destroy a representative permanent (≈ a 2/2 body)"), priced by the same
 *  `creatureValueRaw` primitive every real creature goes through, so the unit
 *  and the board it is measured against can never drift apart. */
const REPRESENTATIVE_VICTIM_POWER = 2;
const REPRESENTATIVE_VICTIM_TOUGHNESS = 2;
const REPRESENTATIVE_VICTIM_MANA_VALUE = 2;

/** Realised board loss of ONE representative victim — its body plus the flat
 *  board-presence weight every permanent carries, i.e. exactly what
 *  `permanentRealisedValue` would return for it. The DENOMINATOR that turns a
 *  real victim's realised loss into `boardRemoval` units. */
export function representativeVictimLoss(weights: EvalWeights): number {
    return (
        creatureValueRaw(
            REPRESENTATIVE_VICTIM_POWER,
            REPRESENTATIVE_VICTIM_TOUGHNESS,
            REPRESENTATIVE_VICTIM_MANA_VALUE,
            []
        ) + weights.permanentWeight
    );
}

/** Realised board loss of one permanent, as `evaluate` scores it. Supplied by
 *  the caller (`evaluate.ts`) rather than computed here, so there is exactly
 *  one per-permanent valuation in the engine and this module needs no import
 *  back into `evaluate.ts` (which imports this one). */
export type RealisedLoss = (perm: CardInstanceState) => number;

/** How many flat slots a requirement group fills, when the DEFINITION states
 *  a ceiling. A fixed `count: N` fills N; the object form's numeric `max` is
 *  an authored ceiling too (Force of Vigor's `{ min: 0, max: 2 }`), and every
 *  one of those slots belongs to THIS requirement. `undefined` for a genuinely
 *  open-ended count — `"X"` in either position, or a `{ min }` with no `max`
 *  — which is resolved against `chosenX` at announcement (CR 601.2c,
 *  `resolveTargetRequirementCount`) and has no ceiling a pre-announcement
 *  valuation can read.
 *
 *  Emitting ONE slot for a bounded range was the phantom-victim bug the
 *  issue-#3398 review caught: Force of Vigor's script names `{ target: 0 }`
 *  AND `{ target: 1 }`, slot 1 fell off the end of the list, and the lens
 *  answered "unknown" — which the valuer reads as one full representative
 *  victim. The card then priced at 160 in hand against a board holding
 *  nothing it could legally destroy, with the `base + MV` floor lifted
 *  underneath it because slot 0 HAD answered. */
function authoredSlotCount(req: TargetRequirement): number | undefined {
    if (typeof req.count === "number") return Math.max(1, req.count);
    if (req.count === "X") return undefined;
    const max = req.count.max;
    return typeof max === "number" ? Math.max(1, max) : undefined;
}

/** The FLAT target-slot list an Effect Script's `{ target: n }` indexes into:
 *  `targetRequirement` first (repeated for each slot its count authorises),
 *  then each `additionalTargetRequirements` group in array order — the same
 *  order `announceCast` concatenates the picks in (CR 601.2c), and the same
 *  order `moves.ts`' `groupsFor` enumerates them. An open-ended group
 *  contributes ONE slot here and absorbs every higher index through
 *  {@link openEndedSlotRequirement}. A card with no requirement yields an
 *  empty list. */
export function targetSlotRequirements(
    def: Pick<
        CardDefinition,
        "targetRequirement" | "additionalTargetRequirements"
    >
): TargetRequirement[] {
    const slots: TargetRequirement[] = [];
    for (const req of targetRequirementGroups(def)) {
        for (let i = 0; i < (authoredSlotCount(req) ?? 1); i++) slots.push(req);
    }
    return slots;
}

/** The requirement a slot index PAST {@link targetSlotRequirements}' list
 *  belongs to: the last OPEN-ENDED group, since only such a group can produce
 *  more slots than the definition authorises. `undefined` when every group is
 *  bounded — a script naming a slot beyond that list names a requirement the
 *  card does not declare, and the lens must answer "unknown" (keep the
 *  representative victim) rather than invent one. */
export function openEndedSlotRequirement(
    def: Pick<
        CardDefinition,
        "targetRequirement" | "additionalTargetRequirements"
    >
): TargetRequirement | undefined {
    let openEnded: TargetRequirement | undefined;
    for (const req of targetRequirementGroups(def)) {
        if (authoredSlotCount(req) === undefined) openEnded = req;
    }
    return openEnded;
}

/** The card's target-requirement GROUPS in flat-slot order (CR 601.2c). */
function targetRequirementGroups(
    def: Pick<
        CardDefinition,
        "targetRequirement" | "additionalTargetRequirements"
    >
): TargetRequirement[] {
    const groups: TargetRequirement[] = [];
    if (def.targetRequirement) groups.push(def.targetRequirement);
    for (const extra of def.additionalTargetRequirements ?? []) {
        groups.push(extra);
    }
    return groups;
}

/** What a lens needs to answer "what is the best legal victim worth HERE". */
export interface LatentBoardInputs {
    state: GameState;
    /** The player whose hand holds the card — the would-be caster, and the
     *  player whose OWN permanents are never counted as victims. */
    casterId: string;
    /** The hand card being valued; its instance id locates the targeting
     *  source (`pendingTargetingSource`, `kind: "cast"` reads the hand). */
    card: CardInstanceState;
    /** Its registry definition — where the target requirements live. */
    def: CardDefinition;
    weights: EvalWeights;
    realisedLoss: RealisedLoss;
    /** Issue #4781 — the worth `evaluate`'s hand term gives the permanent's
     *  card back in its owner's hand: what a bounce hands back. */
    returnedWorth: RealisedLoss;
}

/** A lens that prices a card in hand against THIS board (issue #3398).
 *
 *  `victimUnits(slot)` answers, for announced target slot `slot`:
 *   - `undefined` — the slot has no readable requirement (a modal card whose
 *     targets belong to a mode, an ability-site target, a card whose script
 *     names a slot the definition does not declare). The valuer then falls
 *     back to exactly ONE representative victim, i.e. the pre-#3398 constant:
 *     the unknown case must never invent a zero.
 *   - `0` — the requirement is readable and NO opponent permanent on this
 *     board satisfies it. A removal spell facing an empty board is worth
 *     nothing, which is the case the fixed constant got most wrong.
 *   - otherwise the best legal victim's realised loss over the representative
 *     victim's.
 *
 *  Memoised per slot: the same slot is read once per Op that names it, and
 *  `getLegalTargets` walks both battlefields. */
export function makeLatentBoardLens(
    inputs: LatentBoardInputs,
    base: LatentLens
): LatentLens {
    const { state, casterId, card, def, weights, realisedLoss, returnedWorth } =
        inputs;
    // A cast-time modal card declares its targets PER MODE (CR 700.2d), and
    // which mode will be chosen is not a fact this valuation has. Fall back
    // to the representative victim for every slot rather than pricing the
    // spell by a requirement it may never use.
    const slots = def.modes?.length ? [] : targetSlotRequirements(def);
    // A slot index past the authored list belongs to the trailing open-ended
    // group when there is one; otherwise it is genuinely unknown.
    const openEnded = openEndedSlotRequirement(def);

    const denominator = representativeVictimLoss(weights);
    const memo = new Map<number, number | undefined>();
    let measured = false;

    const compute = (slot: number): number | undefined => {
        const requirement = slots[slot] ?? openEnded;
        if (!requirement) return undefined;
        const source = pendingTargetingSource(state, card.id, "cast");
        const legal = getLegalTargets(state, requirement, source, casterId);
        // Only a BATTLEFIELD victim is a board loss. A player / spell /
        // graveyard-card target is a different dimension entirely (damage to
        // the face, a counterspell, regrowth) and its Op does not read this
        // lens — so a requirement that admits no permanent at all is "not a
        // board question", not "worth zero".
        const permanentSlots = legal.filter((t) => t.type === "permanent");
        if (permanentSlots.length === 0 && !admitsPermanents(requirement)) {
            return undefined;
        }
        let best = 0;
        for (const target of permanentSlots) {
            for (const player of state.players) {
                // The caster's OWN board is not a victim: destroying it is a
                // cost the search will find on its own, never latent worth
                // held in hand.
                if (player.id === casterId) continue;
                const perm = player.battlefield.find((p) => p.id === target.id);
                if (!perm) continue;
                best = Math.max(best, realisedLoss(perm));
            }
        }
        return best / denominator;
    };

    return {
        weights: base.weights,
        victimUnits(slot) {
            if (slots.length === 0) return base.victimUnits(slot);
            if (!memo.has(slot)) memo.set(slot, compute(slot));
            const units = memo.get(slot);
            if (units !== undefined) measured = true;
            return units;
        },
        sweepUnits(select, outcome = LEAVES) {
            const lossOf = memberLoss(outcome, realisedLoss, returnedWorth);
            const net = sweptNetLoss(state, casterId, select, lossOf);
            if (net === undefined) return undefined;
            measured = true;
            return net / denominator;
        },
        measured: () => measured,
    };
}

/** Issue #4773 — the realised loss a `forEach` over the battlefield takes
 *  from the caster's opponents MINUS what it takes from the caster, or
 *  `undefined` when the selector is not one this lens can read.
 *
 *  Until this read, a sweep's `$each` was no announced slot, so it priced at
 *  ONE representative victim whatever the board held: Armageddon sat in hand
 *  at a 2/2's worth while the lands it would take were worth far less, and
 *  casting it with the opponent a land ahead read as a loss at 1 ply. The
 *  members are the ones the resolution would take, the caster's own included
 *  (CR 701.8a destroy, CR 701.13a exile), priced by the same
 *  `realisedLoss` the targeted slots read.
 *
 *  Readable means: every player's battlefield or a fixed side of it
 *  (`controller` / `opponent`), and a filter this lens can match EXACTLY
 *  (`sweepPermanentFilter`). Any other filter field (a subtype chosen
 *  mid-resolution, a mana-value bound) answers `undefined` rather than
 *  guess: a matcher that skipped the field would count members the
 *  resolution spares, and one that refused them would price a real sweep at
 *  nothing.
 *
 *  Issue #4781 — each member's loss is `lossOf` it, per the sweep's
 *  `SweepOutcome` (`memberLoss`). */
function sweptNetLoss(
    state: GameState,
    casterId: string,
    select: EffectForEachSelector,
    lossOf: MemberLoss
): number | undefined {
    if (select.set !== "permanents") return undefined;
    const filter = sweepPermanentFilter(select.filter);
    if (filter === UNREADABLE_SWEEP_FILTER) return undefined;
    const controller = select.controller;
    if (
        controller !== undefined &&
        controller !== "controller" &&
        controller !== "opponent"
    ) {
        return undefined;
    }
    let net = 0;
    for (const player of state.players) {
        const own = player.id === casterId;
        if (controller === "controller" && !own) continue;
        if (controller === "opponent" && own) continue;
        for (const perm of player.battlefield) {
            // The same live view the resolution's `getBattlefieldIds` matches
            // against (layer-5 colours, layer-7 toughness, live supertypes).
            const view = effectivePermanentView(state, perm);
            if (
                filter !== undefined &&
                !matchesPermanentFilter(view, filter, {
                    supertypesOf: liveSupertypesOf,
                })
            ) {
                continue;
            }
            const loss = lossOf(perm, view);
            net += own ? -loss : loss;
        }
    }
    return net;
}

const LEAVES: SweepOutcome = { kind: "leaves" };

/** One member's loss to its controller, given the raw permanent and its
 *  `effectivePermanentView`. */
type MemberLoss = (perm: CardInstanceState, view: CardInstanceState) => number;

/** Issue #4781 — the per-member loss each `SweepOutcome` inflicts:
 *   - `leaves`: the whole realised loss (CR 701.8a / 701.13a);
 *   - `lethalDamage`: the realised loss of a member the damage kills
 *     (`diesTo`), nothing for a survivor;
 *   - `returnsToHand`: the realised loss minus the card's worth back in its
 *     owner's hand — the part of the permanent a bounce actually takes. A
 *     token hands nothing back (CR 111.8: it ceases to exist off the
 *     battlefield). Pricing a bounce at the whole realised loss would read
 *     every returned body as destroyed, while `evaluate` counts it again in
 *     the owner's hand: the cast would realise a fraction of what holding the
 *     card was worth. */
function memberLoss(
    outcome: SweepOutcome,
    realisedLoss: RealisedLoss,
    returnedWorth: RealisedLoss
): MemberLoss {
    switch (outcome.kind) {
        case "leaves":
            return (perm) => realisedLoss(perm);
        case "lethalDamage":
            return (perm, view) =>
                diesTo(view, outcome.amount) ? realisedLoss(perm) : 0;
        case "returnsToHand":
            return (perm) =>
                realisedLoss(perm) - (perm.isToken ? 0 : returnedWorth(perm));
    }
}

/** True when `damage` dealt to `view` (an `effectivePermanentView`) takes it
 *  off the battlefield by state-based action: CR 704.5g for a creature (the
 *  damage already marked counts, CR 120.3e), CR 704.5i for a planeswalker
 *  (CR 120.3c). Any other permanent is not removed by damage. */
function diesTo(view: CardInstanceState, damage: number): boolean {
    if (damage <= 0) return false;
    if (view.types.includes("Creature")) {
        const toughness = view.toughness ?? 0;
        return toughness - (view.damageMarked ?? 0) <= damage;
    }
    if (view.types.includes("Planeswalker")) {
        return currentLoyalty(view) <= damage;
    }
    return false;
}

/** The answer `sweepPermanentFilter` gives for a filter it cannot match
 *  exactly — distinct from `undefined`, which is "no filter, every
 *  permanent". */
export const UNREADABLE_SWEEP_FILTER = "unreadable-sweep-filter" as const;

/** The `EffectCardFilter` fields `sweepPermanentFilter` maps onto
 *  `PermanentFilter` 1:1, each a LITERAL the resolution's
 *  `toPermanentFilter` (`effects/interpreter.ts`) propagates unchanged and
 *  `effectivePermanentView` supplies every input of. A field outside this
 *  set — a dynamic `{ ref }`, a mana-value bound, a name read off the
 *  registry, `any`, `excludeSource` — makes the whole filter unreadable. */
const READABLE_SWEEP_FILTER_KEYS: ReadonlySet<string> = new Set([
    "type",
    "excludeType",
    "subtype",
    "supertype",
    "excludeSupertype",
    "color",
    "colorCountAtLeast",
    "isToken",
    "hasAbility",
    "excludeAbility",
    "tapped",
    "isAttacking",
    "enteredThisTurn",
    "controlledSinceTurnStart",
]);

/** Issue #4781 — the `PermanentFilter` a sweep's `EffectCardFilter` resolves
 *  to before a single resolution-time choice is made, or
 *  `UNREADABLE_SWEEP_FILTER` when it names anything that is not a literal
 *  this lens can match exactly: subtypes (CR 205.3), colours (CR 105.2) and
 *  supertypes (CR 205.4a) alongside the card types (CR 205.2a) the #4773 read
 *  began with. A subtype or colour given as a `{ ref }` / sacrificed-colours
 *  read is chosen at resolution and stays unreadable. */
export function sweepPermanentFilter(
    filter: EffectCardFilter | undefined
): PermanentFilter | undefined | typeof UNREADABLE_SWEEP_FILTER {
    if (filter === undefined) return undefined;
    if (!Object.keys(filter).every((k) => READABLE_SWEEP_FILTER_KEYS.has(k))) {
        return UNREADABLE_SWEEP_FILTER;
    }
    const { subtype, color } = filter;
    if (subtype !== undefined && !isLiteralList(subtype)) {
        return UNREADABLE_SWEEP_FILTER;
    }
    if (color !== undefined && !isLiteralList(color)) {
        return UNREADABLE_SWEEP_FILTER;
    }
    return {
        types: filter.type,
        excludeTypes: filter.excludeType,
        subtypes: subtype,
        supertypes: filter.supertype,
        excludeSupertypes: filter.excludeSupertype,
        colors: color,
        colorCountAtLeast: filter.colorCountAtLeast,
        isToken: filter.isToken,
        requireAbility: filter.hasAbility,
        excludeAbility: filter.excludeAbility,
        tapped: filter.tapped,
        isAttacking: filter.isAttacking,
        enteredThisTurn: filter.enteredThisTurn,
        controlledSinceTurnStart: filter.controlledSinceTurnStart,
    };
}

/** A string literal or a list of them — never a dynamic object read. */
function isLiteralList<T extends string>(
    value: T | readonly T[] | object
): value is T | T[] {
    return (
        typeof value === "string" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))
    );
}

/** True when `requirement` could ever name a battlefield permanent — a
 *  structural read of its declared `type`, never of the board. Distinguishes
 *  "this spell removes permanents and the board is empty" (0 units) from
 *  "this spell was never about permanents" (unknown, keep the representative
 *  fallback). */
function admitsPermanents(requirement: TargetRequirement): boolean {
    if (requirement.zone && requirement.zone !== "battlefield") return false;
    const types = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
    return types.some((t) => t !== "player" && t !== "spell" && t !== "card");
}
