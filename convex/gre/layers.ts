// Minimal continuous-effect layer system (CR 611, 613).
// Scope: P/T buffs (layer 7c) only. Computed at read time — never mutate card state.
//
// Static effects are expressed via an `applies` predicate plus a small
// `StaticEffectContext` of pure helpers (getColors, isCreature, hasSubtype).
// Each card declares its own eligibility rule — engine has no enum of
// scopes/filters to maintain.

import { tryGetCardById } from "../cards";
import { getColorsFromCost } from "../cards/colors";
import type {
    CardType,
    Color,
    ManaCost,
    PermanentView,
    StaticEffect,
    StaticEffectContext,
    StaticEffectStateView,
} from "../cards/types";

export type PTBuff = { power: number; toughness: number };

const ZERO: PTBuff = { power: 0, toughness: 0 };

/** Re-exported for engine callers; the canonical definition lives in types.ts
 *  so static-effect predicates can reference it without a cycle. */
export type LayerStateView = StaticEffectStateView;

/** Returns the card definition's static effects, or [] if unknown. */
function getStaticEffects(card: PermanentView): StaticEffect[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    const def = tryGetCardById(cardId);
    if (!def) return [];
    const cardEffects = def.staticEffects ?? [];
    // CR 700.2c — a modal permanent also contributes its chosen mode's static
    // effects (Jihad's per-colour anthem). Mirrors `getEffectiveStaticEffects`
    // in state.ts (kept local to avoid a layers ↔ state import cycle).
    const chosenModeId = (card as { chosenModeId?: string }).chosenModeId;
    if (!chosenModeId || !def.modes) return cardEffects;
    const mode = def.modes.find((m) => m.id === chosenModeId);
    const modeEffects = mode?.staticEffects ?? [];
    if (modeEffects.length === 0) return cardEffects;
    if (cardEffects.length === 0) return modeEffects;
    return [...cardEffects, ...modeEffects];
}

/** Context passed to every static-effect predicate. Pure, state-free. */
export const STATIC_EFFECT_CTX: StaticEffectContext = {
    getColors(card: PermanentView): Color[] {
        // CR 613.1d layer 5: colorOverride replaces all other color derivation
        const override = (card as { colorOverride?: Color[] }).colorOverride;
        if (override) return override;
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ?? (cardId ? tryGetCardById(cardId)?.manaCost : undefined);
        const base = getColorsFromCost(cost);
        const granted = (card as { grantedColors?: { color: string }[] })
            .grantedColors;
        if (!granted?.length) return base;
        const all = new Set(base);
        for (const g of granted) all.add(g.color as Color);
        return [...all];
    },
    isCreature(card: PermanentView): boolean {
        return card.types.includes("Creature");
    },
    hasSubtype(card: PermanentView, subtype: string): boolean {
        return card.subtypes.includes(subtype);
    },
    hasSupertype(card: PermanentView, supertype: string): boolean {
        // CR 205.4 — supertypes live on the (possibly copied / tokenized) card
        // definition, not on the instance's mutable `types`/`subtypes` arrays.
        const embedded = (card.card as { supertypes?: string[] }).supertypes;
        if (embedded) return embedded.includes(supertype);
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetCardById(cardId) : undefined;
        return def?.supertypes?.includes(supertype as never) ?? false;
    },
    getPrintedTypes(card: PermanentView): CardType[] {
        // CR 205.2 — printed type line from the card definition; ignores the
        // live `types` array (which type-add / animate effects mutate).
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetCardById(cardId) : undefined;
        return (def?.types ?? []) as CardType[];
    },
    getName(card: PermanentView): string {
        // CR 201.2 — card name from the (possibly copied / tokenized) card
        // definition. An embedded name on the instance's card reference wins
        // (copy effects), else look the printed name up via the registry.
        const embedded = (card.card as { name?: string }).name;
        if (embedded) return embedded;
        const cardId = (card.card as { id?: string }).id;
        const def = cardId ? tryGetCardById(cardId) : undefined;
        return def?.name ?? "";
    },
    getManaValue(card: PermanentView): number {
        // CR 202.3 — numeric X in the printed cost contributes to mana
        // value (the codebase encodes generic cost as `X: number`); only
        // the string-X placeholder for variable-X cards is treated as 0.
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ?? (cardId ? tryGetCardById(cardId)?.manaCost : undefined);
        if (!cost) return 0;
        let total = 0;
        for (const [k, v] of Object.entries(cost)) {
            // `xFactor` is an X-multiplier, not a mana amount — exclude it.
            if (k === "xFactor") continue;
            if (typeof v === "number") total += v;
        }
        return total;
    },
};

/**
 * Layer 7d static P/T buffs: sum of `pt-buff` static effects applied to
 * `target` by all permanents on the battlefield (CR 613.4d, 611.2). These are
 * +N/+N deltas (Crusade, Bad Moon, Castle) applied on top of the base / CDA /
 * set / counter stack. `pt-cda` is NOT summed here — it is layer 7a, see
 * `getCDAContribution`.
 */
export function getStaticPTBuff(
    state: LayerStateView,
    target: PermanentView
): PTBuff {
    let power = 0;
    let toughness = 0;

    // Fast path: P/T buffs are only meaningful on creatures (CR 208.2).
    if (!STATIC_EFFECT_CTX.isCreature(target)) return ZERO;

    for (const player of state.players) {
        for (const source of player.battlefield) {
            for (const effect of getStaticEffects(source)) {
                if (effect.kind !== "pt-buff") continue;
                if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                    continue;
                }
                // CR 611.2c source-level gate ("as long as ..."): evaluated
                // once per source against the whole board (Jihad). Skips the
                // buff entirely when the condition is currently false.
                if (
                    effect.condition &&
                    !effect.condition(source, state, STATIC_EFFECT_CTX)
                ) {
                    continue;
                }
                power += effect.power;
                toughness += effect.toughness;
            }
        }
    }

    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/**
 * Layer 7a characteristic-defining contribution: sum of `pt-cda` effects
 * (CR 613.4a, 604.3). The result is added on top of the printed base P/T to
 * form the starting value of the pipeline; a layer 7b set (`temporaryPTSet`)
 * may override it. Promoted out of the summed buff bucket so a set can win
 * over it (ADR 0017).
 */
function getCDAContribution(
    state: LayerStateView,
    target: PermanentView
): PTBuff {
    if (!STATIC_EFFECT_CTX.isCreature(target)) return ZERO;
    let power = 0;
    let toughness = 0;
    for (const player of state.players) {
        for (const source of player.battlefield) {
            for (const effect of getStaticEffects(source)) {
                if (effect.kind !== "pt-cda") continue;
                if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                    continue;
                }
                const pt = effect.compute(
                    source,
                    state,
                    STATIC_EFFECT_CTX,
                    target
                );
                power += pt.power;
                toughness += pt.toughness;
            }
        }
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/**
 * Layer 7b set-P/T override (CR 613.4b). Reads the timestamped `temporaryPTSet`
 * entries on the target and returns the latest value per characteristic
 * (CR 613.7 — array order is the timestamp, latest entry wins; consistent with
 * `controlChanges` / text-change stacks). `power`/`toughness` are independently
 * optional: "base power 0" sets power and leaves toughness to the 7a value.
 */
function getSetPT(target: PermanentView): {
    power?: number;
    toughness?: number;
} {
    const sets = target.temporaryPTSet;
    if (!sets?.length) return {};
    let power: number | undefined;
    let toughness: number | undefined;
    for (const entry of sets) {
        if (entry.power !== undefined) power = entry.power;
        if (entry.toughness !== undefined) toughness = entry.toughness;
    }
    return { power, toughness };
}

/** Sum of one-shot temporary P/T modifications stored on `target`
 *  (CR 611.1, 611.2). Independent from static effects: these mods live on
 *  the permanent itself and are purged by phase-boundary cleanup. */
function getTemporaryPTBuff(target: PermanentView): PTBuff {
    const mods = target.temporaryPTMods;
    if (!mods?.length) return ZERO;
    let power = 0;
    let toughness = 0;
    for (const m of mods) {
        power += m.power;
        toughness += m.toughness;
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/** Sum of conditional P/T modifications held "for as long as [the source]
 *  remains tapped" (CR 611.2; ATQ Ashnod's Battle Gear, Tawnos's Weaponry).
 *  Read live: an entry contributes only while its `sourceId` permanent is on
 *  the battlefield AND tapped, so the buff disappears the instant the source
 *  untaps even before the `checkSourceTappedEffects` SBA splices the stale
 *  entry out. Independent from `temporaryPTMods` (phase-boundary one-shots). */
function getSourceTappedPTBuff(
    state: LayerStateView,
    target: PermanentView
): PTBuff {
    const mods = target.sourceTappedPTMods;
    if (!mods?.length) return ZERO;
    let power = 0;
    let toughness = 0;
    for (const m of mods) {
        if (!isSourceTappedLive(state, m.sourceId)) continue;
        power += m.power;
        toughness += m.toughness;
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/** True while `sourceId` is a permanent on some battlefield that is tapped
 *  (CR 611.2 state-tied duration). A source that has left the battlefield
 *  fails (the effect ends with its source). */
export function isSourceTappedLive(
    state: LayerStateView,
    sourceId: string
): boolean {
    for (const player of state.players) {
        const src = player.battlefield.find((c) => c.id === sourceId);
        if (src) return Boolean((src as PermanentView).isTapped);
    }
    return false;
}

/** Per-counter-type contribution to layer 7d (CR 613.4d, 122.1d). Only the
 *  P/T-modifying built-in types are recognized here; other types (corpse,
 *  mire, charge, vitality) are inert to the layer system and are read by
 *  card-specific abilities directly. */
const COUNTER_PT_CONTRIBUTION: Record<string, PTBuff> = {
    "+1/+1": { power: 1, toughness: 1 },
    "-1/-1": { power: -1, toughness: -1 },
    "+1/+0": { power: 1, toughness: 0 },
    "-1/-0": { power: -1, toughness: 0 },
    "+0/+1": { power: 0, toughness: 1 },
    "-0/-1": { power: 0, toughness: -1 },
    // CR 122.1d — Spirit Shackle (LEG) stacks "-0/-2" counters on a tapped
    // creature. Each contributes -2 toughness, 0 power; they ride the same
    // counter→P/T pipeline as the built-in -1/-1 family.
    "-0/-2": { power: 0, toughness: -2 },
    // CR 122.1c — FEM C5 black introduces the ±2 counter family: Armor Thrull's
    // "+1/+2", Soul Exchange's "+2/+2" (on a reanimated Thrull), and Ebon
    // Praetor's "-2/-2" (upkeep) / "+1/+0" (sacrificed-Thrull bonus, already
    // above). Each rides the same counter→P/T pipeline.
    "+1/+2": { power: 1, toughness: 2 },
    "+2/+2": { power: 2, toughness: 2 },
    "-2/-2": { power: -2, toughness: -2 },
};

/** Sum of P/T contributions from counters on `target` (layer 7d). Reads from
 *  `target.counters` and folds in only types with a non-zero P/T effect. */
function getCounterPTBuff(target: PermanentView): PTBuff {
    const counters = target.counters;
    if (!counters) return ZERO;
    let power = 0;
    let toughness = 0;
    for (const [type, count] of Object.entries(counters)) {
        const contribution = COUNTER_PT_CONTRIBUTION[type];
        if (!contribution || count === 0) continue;
        power += contribution.power * count;
        toughness += contribution.toughness * count;
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/**
 * Evaluates the CR 613.4 P/T sublayers in order (ADR 0017), per characteristic:
 *
 *   7a CDA      → starting value = printed base + Σ pt-cda
 *   7b set      → if a `temporaryPTSet` overrides this characteristic, replace
 *   7c counters → += counter contribution
 *   7d modifier → += static pt-buff + temporaryPTMods (pump, anthems)
 *   7e switch   → power/toughness swap — no card in scope; intentionally
 *                 absent (the first switch card lands the 7e body + its test).
 *
 * Computed at read time, never mutating card state — same discipline as the
 * previous flat sum, but ordered so a 7b set wins over the 7a base/CDA and
 * counters/modifiers stack on top of the set value.
 */
function evaluateLayer(
    base: number,
    cda: number,
    set: number | undefined,
    counter: number,
    modifier: number
): number {
    let value = base + cda; // 7a
    if (set !== undefined) value = set; // 7b override
    value += counter; // 7c
    value += modifier; // 7d
    return value; // 7e: no-op (no switch card in scope)
}

function computeEffectivePT(
    state: LayerStateView,
    target: PermanentView,
    opts: { includeTemporary?: boolean } = {}
): PTBuff {
    // When false, the until-boundary (until-end-of-turn / -combat) P/T layers are
    // dropped: the timestamped `temporaryPTSet` (7b) and the one-shot
    // `temporaryPTMods` (7d temp), both purged at the next phase boundary. The
    // persistent layers (CDA, counters, static buffs) are unaffected. Used only
    // by the bot evaluation, so a combat trick's temporary buff is not scored as
    // permanent material (ADR 0020 §2).
    const includeTemporary = opts.includeTemporary ?? true;
    const basePower = target.power ?? 0;
    const baseToughness = target.toughness ?? 0;
    // Fast path: only creatures carry P/T-layer effects (CR 208.2).
    if (!STATIC_EFFECT_CTX.isCreature(target)) {
        return { power: basePower, toughness: baseToughness };
    }
    const cda = getCDAContribution(state, target); // 7a
    const set = includeTemporary ? getSetPT(target) : {}; // 7b (temporary)
    const counter = getCounterPTBuff(target); // 7c
    const buff = getStaticPTBuff(state, target); // 7d static
    const temp = includeTemporary ? getTemporaryPTBuff(target) : ZERO; // 7d temp
    // 7d source-tapped: held while the source stays tapped (Ashnod's Battle
    // Gear, Tawnos's Weaponry). Persistent, not phase-bounded, so it survives
    // `includeTemporary === false` (bot eval scores it as real material).
    const tapped = getSourceTappedPTBuff(state, target); // 7d source-tapped
    return {
        power: evaluateLayer(
            basePower,
            cda.power,
            set.power,
            counter.power,
            buff.power + temp.power + tapped.power
        ),
        toughness: evaluateLayer(
            baseToughness,
            cda.toughness,
            set.toughness,
            counter.toughness,
            buff.toughness + temp.toughness + tapped.toughness
        ),
    };
}

/** Effective power after the CR 613.4 layer pipeline. Not floored (combat
 *  damage floors separately). */
export function getEffectivePower(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target).power;
}

/** Effective toughness after the CR 613.4 layer pipeline. */
export function getEffectiveToughness(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target).toughness;
}

/** Effective power EXCLUDING until-boundary modifications (`temporaryPTSet`,
 *  `temporaryPTMods`). The bot evaluation uses this so a combat trick's
 *  "until end of turn" buff is not counted as permanent material (ADR 0020 §2).
 *  Persistent layers (CDA, counters, static buffs, +1/+1 counters) still count. */
export function getPermanentEffectivePower(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target, { includeTemporary: false }).power;
}

/** Effective toughness EXCLUDING until-boundary modifications — toughness twin
 *  of `getPermanentEffectivePower` (ADR 0020 §2). */
export function getPermanentEffectiveToughness(
    state: LayerStateView,
    target: PermanentView
): number {
    return computeEffectivePT(state, target, { includeTemporary: false })
        .toughness;
}
