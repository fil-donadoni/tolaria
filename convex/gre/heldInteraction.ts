// Interaction-aware combat prediction (ADR 0021, issue #229).
//
// The crude combat predictor (`dangerClock.ts`) reads creatures at their CURRENT
// effective P/T, so it is blind to interaction a player still HOLDS in hand: a
// combat trick (pump) or instant-speed removal. That blindness produces two
// misplays the bot search inherits:
//
//   * Attacker side — a held-back pump is invisible, so a bait attacker
//     (a 2/2 swinging into a 3/3 with Giant Growth in hand) is pre-judged dead
//     and the "wait, then pump" ambush never out-scores dumping the trick.
//   * Defender side — multi-block evaluation assumes the attacker has no tricks,
//     so committing several blockers to kill one attacker is scored as a clean
//     win even when a held pump (attacker survives, blockers die) or held
//     removal (one blocker killed, attacker connects) flips the exchange.
//
// Card effects are opaque imperative `resolve()` bodies, so this module reads
// OPT-IN structured `aiCombatHint`s declared on the `CardDefinition` (see
// `convex/cards/types.ts`). It models only interaction the player can actually
// cast THIS combat: an instant-timing card (CR 702.8 flash or an Instant) whose
// cost the player's open, untapped sources can actually pay — COLOUR INCLUDED
// since issue #3531, through the one shared reader (`canPayCost`,
// `manaAvailability.ts`) the `evaluate` flexibility term and the castability
// gates ask. This module used to carry its OWN copy of the colour-blind
// `availableManaFor` proxy, so it predicted a Giant Growth off three Islands.
//
// PURE and prediction-only: nothing here changes how a spell actually resolves.

import type { CardInstanceState, GameState, PlayerState } from "./state";
import { hasInstantSpeed, isCreature, isLand } from "./constants";
import { canPayCost, type ManaUnits } from "./manaAvailability";
import { censusOf, type ManaCensusMemo } from "./manaCensusMemo";
import {
    getInstanceManaCost,
    getInstanceAiCombatHint,
    tryGetDefinition,
} from "../cards/index";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import type { ActivatedAbility, EffectOp, ManaCost } from "../cards/types";

/** A pump the held interaction can apply to a single creature this combat. */
export type HeldPump = { power: number; toughness: number };

/** The combat-relevant interaction a player can cast THIS combat, aggregated
 *  across their castable held instants. `pump` is the single LARGEST castable
 *  pump (a player casts the biggest trick they can on the one creature that
 *  matters); `removal` is true if any castable held instant is instant-speed
 *  creature removal. Both fields are absent / false when nothing castable
 *  carries the relevant hint. */
export type HeldInteraction = {
    pump?: HeldPump;
    removal: boolean;
};

/** Whether `player` holds at least one castable instant carrying an
 *  `aiCombatHint` — the castability gate (instant timing + affordable mana
 *  value) the issue calls out, reused as the entry point for "is held
 *  interaction relevant at all". Pure. */
export function hasCastableInstantHint(
    state: GameState | undefined,
    player: PlayerState,
    memo?: ManaCensusMemo
): boolean {
    const units = censusOf(state, player, memo).now;
    return player.hand.some((card) => {
        if (!hasInstantSpeed(card)) return false;
        if (!getInstanceAiCombatHint(card)) return false;
        return canPayCost(units, getInstanceManaCost(card), {
            life: player.life,
        });
    });
}

/** The combat interaction `player` can cast THIS combat, aggregated from their
 *  CASTABLE held instants (instant timing + affordable mana value), reading the
 *  opt-in `aiCombatHint`s. Affordability is greedy per-card against the same
 *  available-mana count (it does NOT subtract spent mana across multiple
 *  tricks — a coarse over-estimate matching the rest of the crude predictor;
 *  the typical case is one trick). Returns the largest castable pump and whether
 *  any castable held instant is removal. */
export function castableHeldInteraction(
    state: GameState | undefined,
    player: PlayerState,
    memo?: ManaCensusMemo
): HeldInteraction {
    const units: ManaUnits = censusOf(state, player, memo).now;
    const result: HeldInteraction = { removal: false };
    for (const card of player.hand) {
        if (!hasInstantSpeed(card)) continue;
        const hint = getInstanceAiCombatHint(card);
        if (!hint) continue;
        // Affordability gate — colour included (issue #3531).
        if (
            !canPayCost(units, getInstanceManaCost(card), { life: player.life })
        )
            continue;
        if (hint.removal) result.removal = true;
        if (hint.pump) {
            const size = hint.pump.power + hint.pump.toughness;
            const bestSize = result.pump
                ? result.pump.power + result.pump.toughness
                : -1;
            if (size > bestSize) result.pump = { ...hint.pump };
        }
    }
    return result;
}

/** The held interaction the player with id `playerId` can bring to the combat
 *  currently in `state`, or no interaction when the player is absent. Thin
 *  state-keyed wrapper over `castableHeldInteraction`. */
export function heldInteractionFor(
    state: GameState,
    playerId: string
): HeldInteraction {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { removal: false };
    return castableHeldInteraction(state, player);
}

// --- Mana-sink pumps on the board (issue #6909) --------------------------------
//
// The held-interaction reader above covers what a player can CAST from hand.
// A board carries its own combat interaction: an activated ability on a
// permanent the player controls that pumps a creature or grants it evasion for
// a mana cost — firebreathing ({R}: +1/+0), an Aura's "{G}: enchanted creature
// gains trample", a Leech's "{B}: +1/+1". Unlike a held instant it is PUBLIC
// information, repeatable as long as the mana lasts, and no determinization
// hides it. The crackback estimate (`dangerClock.ts`) reads these so an
// opposing board is sized at what its mana buys, not its printed power.

/** One mana-sink combat pump an activated ability offers: the `power` /
 *  `toughness` one activation adds until end of turn, whether it grants
 *  trample, the creature it applies to (`hostId` — the source itself or the
 *  Aura's / Equipment's host; absent for a targeted pump the controller aims
 *  at any creature), and how often it can be paid (`oncePerTurn`). */
export type ActivatedPump = {
    hostId?: string;
    power: number;
    toughness: number;
    trample: boolean;
    cost: ManaCost;
    /** Payable once per combat: the ability says so (`oncePerTurn`), or its
     *  cost taps the source (`{T}` — the permanent untaps once a turn). */
    singleUse: boolean;
};

/** A cost the crude mana budget can account for: fixed pips only. A hybrid,
 *  Phyrexian or variable-X cost is left unmodelled (the ability is skipped),
 *  the under-approximating direction. */
function isFixedPipCost(cost: ManaCost): boolean {
    return (
        typeof cost.X !== "string" &&
        !cost.hybrid?.length &&
        !cost.hybridGeneric?.length &&
        !cost.phyrexian
    );
}

/** Whether `cost` is mana alone, or mana plus a `{T}` leg (`tapLeg`): a
 *  creature's own pump is paid with mana and nothing else, and a `{T}` leg is
 *  admitted only on a non-creature source (an Aura or an artifact that
 *  taps), since a tapped creature cannot be declared as an attacker (CR
 *  508.1a). Any other leg (sacrifice, life, counters, discard…) is a
 *  one-shot the crude budget does not model: `null`. */
function manaOnlyCost(
    cost: ActivatedAbility["cost"]
): { mana: ManaCost; tapLeg: boolean } | null {
    if (!cost.mana || !isFixedPipCost(cost.mana)) return null;
    for (const key of Object.keys(cost) as (keyof typeof cost)[]) {
        if (key === "mana" || key === "tap") continue;
        if (cost[key] === undefined || cost[key] === false) continue;
        return null;
    }
    return { mana: cost.mana, tapLeg: cost.tap === true };
}

/** Whether `cost` demands at least one pip (coloured, colourless or generic). */
function hasAnyPip(cost: ManaCost): boolean {
    return Object.values(cost).some((v) => typeof v === "number" && v > 0);
}

/** The creature a `$source` pump lands on: the source itself when it is a
 *  creature, else the creature it is attached to (an Aura's host — Keldon
 *  Mantle reads `getAttachedTo`). `null` when neither. */
function sourceHostId(source: CardInstanceState): string | null {
    if (isCreature(source)) return source.id;
    return source.attachedTo ?? null;
}

/** The instance-independent half of an ability's pump reading: what one
 *  activation adds, whether it aims at `$source` or at an announced target,
 *  and its cost. `null` when the ability is not a mana-sink pump. The script
 *  walked is the real `effects` or, for a closure ability, its `aiEffects`
 *  shadow (the value model's seam); top-level Ops only. */
type PumpTemplate = {
    power: number;
    toughness: number;
    trample: boolean;
    targeted: boolean;
    cost: ManaCost;
    tapLeg: boolean;
    oncePerTurn: boolean;
};

/** Memoised per ability object (a definition's abilities are stable, a
 *  granted one is minted once per grant), so a leaf evaluation pays the
 *  script walk once per ability for the life of the process. */
const PUMP_TEMPLATES = new WeakMap<ActivatedAbility, PumpTemplate | null>();

function pumpTemplate(ability: ActivatedAbility): PumpTemplate | null {
    const cached = PUMP_TEMPLATES.get(ability);
    if (cached !== undefined) return cached;
    const template = readPumpTemplate(ability);
    PUMP_TEMPLATES.set(ability, template);
    return template;
}

function readPumpTemplate(ability: ActivatedAbility): PumpTemplate | null {
    const cost = manaOnlyCost(ability.cost);
    if (!cost) return null;
    // A pump that costs no mana at all would be bought without limit by a
    // mana budget (nothing is spent) — left unmodelled, the under-approximating
    // direction, rather than looped on.
    if (!hasAnyPip(cost.mana)) return null;
    if (ability.modes || ability.canActivate || ability.activationCondition)
        return null;
    const script: EffectOp[] | undefined = ability.effects ?? ability.aiEffects;
    if (!script) return null;
    let power = 0;
    let toughness = 0;
    let trample = false;
    let onSource = false;
    let targeted = false;
    for (const op of script) {
        if (op.op !== "pump" && op.op !== "grantAbility") continue;
        if (op.op === "grantAbility" && op.ability !== "trample") continue;
        if (
            op.op === "pump" &&
            (typeof op.power !== "number" || typeof op.toughness !== "number")
        )
            continue;
        const target = op.target;
        if ("ref" in target && target.ref === "$source") onSource = true;
        else if ("target" in target && ability.targetRequirement)
            targeted = true;
        else continue;
        if (op.op === "pump") {
            power += op.power as number;
            toughness += op.toughness as number;
        } else trample = true;
    }
    if (power <= 0 && !trample) return null;
    if (!onSource && !targeted) return null;
    return {
        power: Math.max(0, power),
        toughness,
        trample,
        targeted,
        cost: cost.mana,
        tapLeg: cost.tapLeg,
        oncePerTurn: ability.oncePerTurn === true,
    };
}

/** Whether a definition's PRINTED abilities hold any pump at all — the
 *  per-permanent gate that keeps the leaf walk cheap: a land, a vanilla
 *  creature or a removal-only permanent is one map read here, never an
 *  ability walk. Granted abilities are read off the instance regardless. */
const DEFINITION_MAY_PUMP = new Map<string, boolean>();

function definitionMayPump(definitionId: string): boolean {
    const cached = DEFINITION_MAY_PUMP.get(definitionId);
    if (cached !== undefined) return cached;
    const may = (tryGetDefinition(definitionId)?.activatedAbilities ?? []).some(
        (ability) => pumpTemplate(ability) !== null
    );
    DEFINITION_MAY_PUMP.set(definitionId, may);
    return may;
}

/** Read one activated ability on `source` as a mana-sink pump, or `null`
 *  when it is not one: the template resolved against the instance (its
 *  host, and whether a `{T}` leg is admissible on it). */
function readActivatedPump(
    ability: ActivatedAbility,
    source: CardInstanceState
): ActivatedPump | null {
    const template = pumpTemplate(ability);
    if (!template) return null;
    if (template.tapLeg && isCreature(source)) return null;
    let hostId: string | undefined;
    if (!template.targeted) {
        const host = sourceHostId(source);
        if (!host) return null;
        hostId = host;
    }
    return {
        hostId,
        power: template.power,
        toughness: template.toughness,
        trample: template.trample,
        cost: template.cost,
        singleUse: template.oncePerTurn || template.tapLeg,
    };
}

/** The mana-sink combat pumps `player`'s board offers — every activated
 *  ability on a permanent they control that pumps a creature or grants it
 *  trample for mana alone, payable at least once from the mana BASE their
 *  permanents make (`censusOf(...).base`: the lands untap on their turn, so
 *  what is tapped now is no limit on the next combat). Pure. */
export function activatedCombatPumps(
    state: GameState,
    player: PlayerState,
    memo?: ManaCensusMemo
): ActivatedPump[] {
    const out: ActivatedPump[] = [];
    let base: ManaUnits | undefined;
    for (const perm of player.battlefield) {
        // A land's abilities are its mana (a pumping land is not modelled —
        // the under-approximating direction); any other permanent is read
        // only when its printing holds a pump or it was granted an ability.
        if (isLand(perm)) continue;
        const definitionId = (perm.card as { id?: string }).id;
        if (
            !(definitionId && definitionMayPump(definitionId)) &&
            !perm.grantedActivatedAbilities?.length
        )
            continue;
        for (const { ability } of getEffectiveActivatedAbilities(perm)) {
            const pump = readActivatedPump(ability, perm);
            if (!pump) continue;
            base ??= censusOf(state, player, memo).base;
            if (!canPayCost(base, pump.cost, { life: player.life })) continue;
            out.push(pump);
        }
    }
    return out;
}
