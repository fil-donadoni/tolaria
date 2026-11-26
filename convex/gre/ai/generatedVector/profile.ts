// What ONE card definition declares, counted once (issue #10853).
//
// A definition does not change between two positions, so what the generated
// vector reads off it — its Ops by carrier, its printed cost, the legs of its
// activation costs — is counted the first time the card is met and kept. The
// generator then only ADDS a card's profile into the columns of the zone and
// side the card is in: one call costs the board's size, never the size of the
// scripts on it.
//
// Kept per definition OBJECT, not per card id: a test that swaps a definition
// in (`withTemporaryDefinition`) gets a profile of what it swapped in.
//
// WHAT A PROFILE READS, AND WHAT IT DOES NOT. A site's script is its real
// `effects[]`, else the `aiEffects` shadow a closure card carries for the Bot
// (PRD issue #1423), else its modes' scripts — the same choice the per-Op
// value model makes. An imperative body with no shadow yields no Op column at
// all (ADR 0186: "a trigger behind an opaque closure yields no column"). Not
// read here: the back face of a double-faced card, a split card's halves, an
// Adventure, and the scripts a token is created with — those belong to other
// objects than the card in the zone.

import type {
    ActivatedAbility,
    CardDefinition,
    EffectOp,
    ManaCost,
} from "../../../cards/types";
import { manaValue } from "../../constants";
import { childOpArrays } from "../effectOpChildren";
import {
    CARRIERS,
    MANA_SYMBOLS,
    columnLayout,
    type Carrier,
    type ColumnLayout,
} from "./columns";

/** Counts keyed by a position on some axis, as `[position, count, …]` — flat,
 *  so adding a profile into a vector allocates nothing. */
export type AxisCounts = readonly number[];

export type DefinitionProfile = {
    /** Keyed by `opPosition * CARRIERS.length + carrierPosition`. */
    readonly ops: AxisCounts;
    /** Keyed by position in `MANA_SYMBOLS`. */
    readonly manaSymbols: AxisCounts;
    readonly manaValue: number;
    /** Keyed by position on the `cost.activation` leg axis. */
    readonly costLegs: AxisCounts;
};

/** A script-bearing site: the card itself (its spell effect), an activated
 *  ability, a triggered ability, or one mode of any of them. */
type ScriptSite = {
    effects?: readonly EffectOp[];
    aiEffects?: readonly EffectOp[];
    modes?: readonly ScriptSite[];
};

function flatten(counts: Map<number, number>): number[] {
    const keys = [...counts.keys()].sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < keys.length; i++) {
        out.push(keys[i], counts.get(keys[i]) as number);
    }
    return out;
}

function bump(counts: Map<number, number>, key: number, by: number): void {
    counts.set(key, (counts.get(key) ?? 0) + by);
}

/** Count every Op of `script`, at any nesting depth, under `carrier`. The
 *  nesting constructs are enumerated by `childOpArrays`, the one authority on
 *  which fields of an Op hold a script. A node naming no registered Op counts
 *  nothing: it has no column, and the census is what reds on that. */
function countScript(
    script: readonly EffectOp[],
    carrier: number,
    layout: ColumnLayout,
    into: Map<number, number>
): void {
    for (let i = 0; i < script.length; i++) {
        const op = script[i];
        const position = layout.opIndex.get(op.op);
        if (position !== undefined) {
            bump(into, position * CARRIERS.length + carrier, 1);
        }
        const children = childOpArrays(op);
        for (let c = 0; c < children.length; c++) {
            countScript(children[c], carrier, layout, into);
        }
    }
}

/** A site's script: real, else shadow, else each mode's. */
function countSite(
    site: ScriptSite,
    carrier: number,
    layout: ColumnLayout,
    into: Map<number, number>
): void {
    if (site.effects && site.effects.length > 0) {
        countScript(site.effects, carrier, layout, into);
        return;
    }
    if (site.aiEffects && site.aiEffects.length > 0) {
        countScript(site.aiEffects, carrier, layout, into);
        return;
    }
    const modes = site.modes ?? [];
    for (let i = 0; i < modes.length; i++) {
        countSite(modes[i], carrier, layout, into);
    }
}

const CARRIER_POSITION: Record<Carrier, number> = {
    spell: CARRIERS.indexOf("spell"),
    activated: CARRIERS.indexOf("activated"),
    triggered: CARRIERS.indexOf("triggered"),
};

/** An activated ability's scripts: the ability's own, and the script a mana
 *  ability runs beside the mana it adds (`manaAbilityEffects`). */
function countActivated(
    ability: ActivatedAbility,
    layout: ColumnLayout,
    into: Map<number, number>
): void {
    countSite(ability, CARRIER_POSITION.activated, layout, into);
    if (ability.manaAbilityEffects) {
        countScript(
            ability.manaAbilityEffects,
            CARRIER_POSITION.activated,
            layout,
            into
        );
    }
}

/** The Ops of ONE ability — what a stack object that is an ability, not a
 *  card, contributes. Kept per carrier: the key is the ability object, and
 *  nothing here assumes an object is only ever asked under one. */
const siteCaches: Record<Carrier, WeakMap<object, AxisCounts>> = {
    spell: new WeakMap(),
    activated: new WeakMap(),
    triggered: new WeakMap(),
};
export function siteOpCounts(
    site: object,
    carrier: "activated" | "triggered"
): AxisCounts {
    const cache = siteCaches[carrier];
    let counts = cache.get(site);
    if (!counts) {
        const into = new Map<number, number>();
        if (carrier === "activated") {
            countActivated(site as ActivatedAbility, columnLayout(), into);
        } else {
            countSite(
                site as ScriptSite,
                CARRIER_POSITION.triggered,
                columnLayout(),
                into
            );
        }
        counts = flatten(into);
        cache.set(site, counts);
    }
    return counts;
}

const SYMBOL_POSITION = new Map<string, number>(
    MANA_SYMBOLS.map((symbol, i) => [symbol, i])
);

/** A printed mana cost, symbol by symbol. A numeric `X` is the cost's generic
 *  part (`ManaCost`'s own encoding); a variable `{X}` counts once per printed
 *  pip (`xFactor`). Hybrid and Phyrexian pips are in the mana value but under
 *  no symbol: which one they are is decided as the cost is paid. */
function countManaSymbols(cost: ManaCost | undefined): number[] {
    if (!cost) return [];
    const into = new Map<number, number>();
    const add = (symbol: string, n: number | undefined): void => {
        if (n) bump(into, SYMBOL_POSITION.get(symbol) as number, n);
    };
    add("W", cost.W);
    add("U", cost.U);
    add("B", cost.B);
    add("R", cost.R);
    add("G", cost.G);
    add("C", cost.C);
    add(
        "generic",
        (typeof cost.X === "number" ? cost.X : 0) + (cost.generic ?? 0)
    );
    if (typeof cost.X === "string") add("X", cost.xFactor ?? 1);
    return flatten(into);
}

/** One count per activated ability asking for each leg. A leg set to `false`
 *  or `0` is not asked for. */
function countCostLegs(
    abilities: readonly ActivatedAbility[],
    layout: ColumnLayout
): number[] {
    const into = new Map<number, number>();
    for (let i = 0; i < abilities.length; i++) {
        const cost = abilities[i].cost as Record<string, unknown>;
        const legs = Object.keys(cost);
        for (let k = 0; k < legs.length; k++) {
            const value = cost[legs[k]];
            if (value === undefined || value === false || value === 0) continue;
            const position = layout.costLegIndex.get(legs[k]);
            if (position !== undefined) bump(into, position, 1);
        }
    }
    return flatten(into);
}

const profileCache = new WeakMap<CardDefinition, DefinitionProfile>();

/** Everything the generated vector reads off `def`. */
export function profileOf(def: CardDefinition): DefinitionProfile {
    let profile = profileCache.get(def);
    if (!profile) {
        const layout = columnLayout();
        const ops = new Map<number, number>();
        countSite(def, CARRIER_POSITION.spell, layout, ops);
        const activated = def.activatedAbilities ?? [];
        for (let i = 0; i < activated.length; i++) {
            countActivated(activated[i], layout, ops);
        }
        const triggered = def.triggeredAbilities ?? [];
        for (let i = 0; i < triggered.length; i++) {
            countSite(triggered[i], CARRIER_POSITION.triggered, layout, ops);
        }
        profile = {
            ops: flatten(ops),
            manaSymbols: countManaSymbols(def.manaCost),
            manaValue: manaValue(def.manaCost),
            costLegs: countCostLegs(activated, layout),
        };
        profileCache.set(def, profile);
    }
    return profile;
}
