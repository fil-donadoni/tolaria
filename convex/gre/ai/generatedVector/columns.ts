// The COLUMNS of the generated vector (ADR 0186, Decision 1; issue #10853).
//
// The Evaluation's 36 inputs are hand-written terms. This is the list of a
// second set of inputs that nobody writes: every column is one class of thing
// a card definition or the board already DECLARES, counted per zone and per
// side. The list is derived from the Mechanics Registry, the Effect Script Op
// registry and a handful of closed engine vocabularies, so a new Op or an
// implemented keyword has its columns the moment its registry row exists —
// there is no table here to remember to extend.
//
// THE NAME IS THE IDENTITY. A column is named
//
//     <family>.<item…>.<zone>.<side>
//
// with `.` between segments, and every segment is drawn from a closed
// vocabulary: a family tag, a registry name (an Op's name, a keyword row's
// id), or an engine constant (a zone, a card type, a mana symbol, a step).
// Nothing in a name is free text, which is what lets a test prove that no
// column names a card (ADR 0186, Decision 4).
//
// THE INDEX IS A HANDLE, NOT AN IDENTITY. Columns are laid out as one regular
// grid per family, families in the order of `FAMILY_ORDER`, items in code-unit
// order of their names — a fixed order, the same on every machine. A new Op
// therefore SHIFTS the indexes after it. Anything stored outside a process (a
// fitted weight, a research note) is keyed by the column's NAME; an index is
// only good inside the build it was read from.
//
// THE COUNTS ARE UNIT COUNTS. A column counts occurrences ("one `dealDamage`
// on a spell in my hand"), never a priced quantity. What an occurrence is
// WORTH is the Weight Fit's to say (ADR 0124); how MUCH one deals is a
// quantity this slice does not read yet.

import {
    EFFECT_OP_REGISTRY,
    MECHANICS_REGISTRY,
} from "../../../cards/mechanicsRegistry";
import {
    CARD_TYPES,
    PLAYER_COUNTER_KINDS,
    colors,
    type ActivatedAbility,
} from "../../../cards/types";
import type { Phase } from "../../types";

/** The seat the vector is read for, and everybody else. With more than two
 *  players every other seat adds into `opp`. */
export const SIDES = ["self", "opp"] as const;
export type Side = (typeof SIDES)[number];

/** The zones whose CARDS are read (their Ops, keywords, types, costs). The
 *  library and exile are counted (`cards.*`) but never read: a library's
 *  order is hidden from everyone, and what may be done with an exiled card
 *  is a permission this slice does not read. */
export const READ_ZONES = [
    "hand",
    "battlefield",
    "graveyard",
    "stack",
] as const;
export type ReadZone = (typeof READ_ZONES)[number];

/** Every zone a card can be COUNTED in. */
export const COUNT_ZONES = [
    "hand",
    "library",
    "battlefield",
    "graveyard",
    "exile",
    "stack",
] as const;
export type CountZone = (typeof COUNT_ZONES)[number];

/** Where on a card an Effect Script sits. One `draw` is three different
 *  things: a spell's effect happens once, an activated ability's whenever its
 *  cost is paid, a triggered ability's whenever its event occurs. */
export const CARRIERS = ["spell", "activated", "triggered"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** The symbols a printed mana cost is counted in: the five colours and
 *  colourless, the generic part, and a variable `{X}`. */
export const MANA_SYMBOLS = [...colors, "generic", "X"] as const;

/** The mana census columns: every unit, then the units that can be each
 *  colour (a dual land's unit counts under both). */
export const MANA_UNIT_KINDS = ["total", ...colors] as const;

/** Every leg an activation cost can have, as a value. A
 *  `Record<keyof cost, true>` so `tsc` reds when the cost type gains a leg
 *  with no row here — the column list follows the type, not a hand count. */
const ACTIVATION_COST_LEG_PRESENCE: Record<
    keyof ActivatedAbility["cost"],
    true
> = {
    tap: true,
    mana: true,
    sacrifice: true,
    sacrificeFilter: true,
    sacrificeFilterCount: true,
    returnToHandFilter: true,
    exileFilter: true,
    returnUnblockedAttacker: true,
    tapOtherFilter: true,
    life: true,
    loyalty: true,
    removeCounter: true,
    addCounter: true,
    discardLastDrawn: true,
    discardThis: true,
    cyclingCost: true,
    exileThis: true,
    returnThisToHand: true,
    exertThis: true,
    discardAtRandom: true,
    discardFilter: true,
    exileFromGraveyard: true,
    exileTopOfLibrary: true,
    xFromTargetSpellMv: true,
    manaEqualToEnchantedCreatureCost: true,
    manaEqualToCounterCount: true,
    selfReduction: true,
};

/** The steps and phases of a turn, as a value — total over `Phase` for the
 *  same reason as the cost legs. */
const PHASE_PRESENCE: Record<Phase, true> = {
    MULLIGAN: true,
    UNTAP: true,
    UPKEEP: true,
    DRAW: true,
    PRECOMBAT_MAIN: true,
    BEGINNING_OF_COMBAT: true,
    DECLARE_ATTACKERS: true,
    DECLARE_BLOCKERS: true,
    FIRST_STRIKE_DAMAGE: true,
    COMBAT_DAMAGE: true,
    END_OF_COMBAT: true,
    POSTCOMBAT_MAIN: true,
    END_STEP: true,
    CLEANUP: true,
};

/** Code-unit order: the same on every machine, whatever its locale. */
function sorted(names: Iterable<string>): string[] {
    return [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every Effect Script Op the interpreter runs, by name. Structural
 *  constructs (`if`, `forEach`) are Ops like any other here: how often a
 *  card's text is conditional is itself a class of effect. */
function implementedOpNames(): string[] {
    return sorted(
        EFFECT_OP_REGISTRY.filter((row) => row.status === "implemented").map(
            (row) => row.op
        )
    );
}

/** Every keyword ability the engine enforces, by registry row id. A
 *  `planned` keyword is inert on a card, so it has nothing to count. */
function implementedKeywordIds(): string[] {
    return sorted(
        MECHANICS_REGISTRY.filter(
            (row) =>
                row.kind === "keyword-ability" && row.status === "implemented"
        ).map((row) => row.id)
    );
}

/** One family of columns: a tag and the axes its grid is the product of, the
 *  LAST axis varying fastest. A column's name is the tag and one value per
 *  axis, joined by `.`. */
export type ColumnFamily = {
    readonly tag: string;
    readonly axes: readonly (readonly string[])[];
};

/** The families, by key, in the order their columns are laid out. */
const FAMILY_ORDER = [
    "op",
    "kw",
    "type",
    "costMana",
    "costManaValue",
    "costActivation",
    "manaNow",
    "manaBase",
    "life",
    "counter",
    "cards",
    "hidden",
    "step",
] as const;
export type FamilyKey = (typeof FAMILY_ORDER)[number];

function buildFamilies(): Record<FamilyKey, ColumnFamily> {
    return {
        // An Op a card's script declares: by Op, by where on the card the
        // script sits, by the zone the card is in, by side.
        op: {
            tag: "op",
            axes: [implementedOpNames(), CARRIERS, READ_ZONES, SIDES],
        },
        // A keyword ability a card HAS in that zone, layer 6 applied (a
        // granted keyword counts, a removed one does not).
        kw: { tag: "kw", axes: [implementedKeywordIds(), READ_ZONES, SIDES] },
        // A card type on a card's type line.
        type: { tag: "type", axes: [CARD_TYPES, READ_ZONES, SIDES] },
        // The printed mana cost, symbol by symbol, and as one mana value.
        costMana: { tag: "cost.mana", axes: [MANA_SYMBOLS, READ_ZONES, SIDES] },
        costManaValue: { tag: "cost.manaValue", axes: [READ_ZONES, SIDES] },
        // An activated ability's cost, leg by leg: one count per ability
        // that asks for that leg.
        costActivation: {
            tag: "cost.activation",
            axes: [
                sorted(Object.keys(ACTIVATION_COST_LEG_PRESENCE)),
                READ_ZONES,
                SIDES,
            ],
        },
        // What the seat can pay with right now, and what its mana base is
        // made of, in mana units (the engine's own census).
        manaNow: { tag: "mana.now", axes: [MANA_UNIT_KINDS, SIDES] },
        manaBase: { tag: "mana.base", axes: [MANA_UNIT_KINDS, SIDES] },
        life: { tag: "life", axes: [SIDES] },
        counter: { tag: "counter", axes: [PLAYER_COUNTER_KINDS, SIDES] },
        // How many cards each zone holds — public even where the cards are
        // not: a player may count the cards in another player's hand.
        cards: { tag: "cards", axes: [COUNT_ZONES, SIDES] },
        // How many of a read zone's cards the seat cannot read.
        hidden: { tag: "hidden", axes: [READ_ZONES, SIDES] },
        // The current step, and whose turn it is: exactly one of these is 1.
        step: { tag: "step", axes: [Object.keys(PHASE_PRESENCE), SIDES] },
    };
}

/** Where one family's grid sits in the column list. */
type FamilyLayout = {
    readonly family: ColumnFamily;
    /** Index of the family's first column. */
    readonly base: number;
    /** `strides[k]` columns separate two neighbours along axis `k`. */
    readonly strides: readonly number[];
    readonly size: number;
};

export type ColumnLayout = {
    readonly names: readonly string[];
    readonly indexByName: ReadonlyMap<string, number>;
    readonly families: Readonly<Record<FamilyKey, FamilyLayout>>;
    /** Position of each Op name on the `op` family's first axis. */
    readonly opIndex: ReadonlyMap<string, number>;
    /** Position of each keyword row id on the `kw` family's first axis. */
    readonly keywordIndex: ReadonlyMap<string, number>;
    /** Position of each cost leg on `cost.activation`'s first axis. */
    readonly costLegIndex: ReadonlyMap<string, number>;
};

function positions(axis: readonly string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < axis.length; i++) out.set(axis[i], i);
    return out;
}

function namesOf(family: ColumnFamily, out: string[]): void {
    const walk = (depth: number, prefix: string): void => {
        if (depth === family.axes.length) {
            out.push(prefix);
            return;
        }
        const axis = family.axes[depth];
        for (let i = 0; i < axis.length; i++) {
            walk(depth + 1, `${prefix}.${axis[i]}`);
        }
    };
    walk(0, family.tag);
}

function buildLayout(): ColumnLayout {
    const families = buildFamilies();
    const names: string[] = [];
    const laid = {} as Record<FamilyKey, FamilyLayout>;
    for (let f = 0; f < FAMILY_ORDER.length; f++) {
        const key = FAMILY_ORDER[f];
        const family = families[key];
        const strides: number[] = new Array(family.axes.length);
        let size = 1;
        for (let k = family.axes.length - 1; k >= 0; k--) {
            strides[k] = size;
            size *= family.axes[k].length;
        }
        laid[key] = { family, base: names.length, strides, size };
        namesOf(family, names);
    }
    return {
        names,
        indexByName: positions(names),
        families: laid,
        opIndex: positions(families.op.axes[0]),
        keywordIndex: positions(families.kw.axes[0]),
        costLegIndex: positions(families.costActivation.axes[0]),
    };
}

let cachedLayout: ColumnLayout | undefined;

/** The column layout, built on first ask: the registries are read once. */
export function columnLayout(): ColumnLayout {
    cachedLayout ??= buildLayout();
    return cachedLayout;
}

/** Every column's name, in column order. */
export function generatedColumns(): readonly string[] {
    return columnLayout().names;
}

/** The families and their axes, in column order — what a census or a
 *  report walks instead of parsing names. */
export function generatedColumnFamilies(): readonly ColumnFamily[] {
    const layout = columnLayout();
    return FAMILY_ORDER.map((key) => layout.families[key].family);
}

/** The index of the column named `name` in THIS build, or `undefined`. */
export function generatedColumnIndex(name: string): number | undefined {
    return columnLayout().indexByName.get(name);
}

/** The column of family `key` at the given position on each of its axes. */
export function columnAt(
    layout: ColumnLayout,
    key: FamilyKey,
    ...at: number[]
): number {
    const { base, strides } = layout.families[key];
    let index = base;
    for (let k = 0; k < strides.length; k++) index += at[k] * strides[k];
    return index;
}
