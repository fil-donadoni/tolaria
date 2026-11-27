// The feature generator (ADR 0186, Decision 1; issue #10853): a position and
// a seat in, a sparse vector of unit counts out.
//
// Pure: it reads `state`, writes nothing and holds nothing between two calls
// but what it learned about card DEFINITIONS (`profile.ts`), which no position
// can change. The same position and seat give the same vector, in the fixed
// column order of `columns.ts`.
//
// WHAT THE SEAT MAY READ. The vector is the seat's own view of the game, so it
// reads a card's identity only where the wire projection the Brain plays from
// would show it (`projectPublicState` → `projectedToGameState`):
//
//   * the seat's own hand, every battlefield, graveyard and the stack — read;
//   * another player's hand — read only for a card that seat has been SHOWN
//     (`knownTo`, which the state adapter stamps on every opponent hand card
//     whose identity crossed the wire); the rest are counted as `hidden.hand`;
//   * a face-down permanent or spell — counted as hidden, for its controller
//     too: what it is worth face down is a quantity nobody has written;
//   * a library, and exile — counted, never read.
//
// So fed a full-information state — a rebuilt Verdict position, a
// determinized world of the search — the generator still reads no more of the
// opponent's hand than the projection of that state would hand the Brain. The
// cards the search SAMPLES into that hand are not the opponent's cards.
//
// THE SEAT'S OWN LIST is read by the `need` family (`deckNeeds.ts`), handed in
// as Deck Knowledge: what its cards require and how far the position is from
// it, never what order the library is in.
//
// TWO PLAYERS is what the Bot plays; with more, every seat that is not
// `seatId` adds into `opp`.

import { tryGetDefinition } from "../../../cards/registry";
import { MECHANICS_REGISTRY } from "../../../cards/mechanicsRegistry";
import {
    CARD_TYPES,
    PLAYER_COUNTER_KINDS,
    type CardDefinition,
    type PlayerCounterKind,
} from "../../../cards/types";
import { knowledgeFor, type DeckKnowledgeBySeat } from "../../deckKnowledge";
import type { ManaUnits } from "../../manaAvailability";
import { censusOf, type ManaCensusMemo } from "../../manaCensusMemo";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "../../state";
import {
    COUNT_ZONES,
    MANA_UNIT_KINDS,
    NEED_MEASURES,
    READ_ZONES,
    columnAt,
    columnLayout,
    type ColumnLayout,
    type CountZone,
    type ReadZone,
} from "./columns";
import { deckNeedMeasures } from "./deckNeeds";
import { profileOf, siteOpCounts, type AxisCounts } from "./profile";
import { vectorOf, type GeneratedVector } from "./vector";

const SELF = 0;
const OPP = 1;

const READ_ZONE_POSITION: Record<ReadZone, number> = {
    hand: READ_ZONES.indexOf("hand"),
    battlefield: READ_ZONES.indexOf("battlefield"),
    graveyard: READ_ZONES.indexOf("graveyard"),
    stack: READ_ZONES.indexOf("stack"),
};

const COUNT_ZONE_POSITION: Record<CountZone, number> = {
    hand: COUNT_ZONES.indexOf("hand"),
    library: COUNT_ZONES.indexOf("library"),
    battlefield: COUNT_ZONES.indexOf("battlefield"),
    graveyard: COUNT_ZONES.indexOf("graveyard"),
    exile: COUNT_ZONES.indexOf("exile"),
    stack: COUNT_ZONES.indexOf("stack"),
};

const CARD_TYPE_POSITION = new Map<string, number>(
    CARD_TYPES.map((type, i) => [type, i])
);

/** Where each player counter is kept on a player — total over the counter
 *  kinds, so a new kind has to say where it lives. */
const PLAYER_COUNTER_READ: Record<
    PlayerCounterKind,
    (player: PlayerState) => number
> = {
    poison: (player) => player.poisonCounters ?? 0,
    energy: (player) => player.energyCounters ?? 0,
    experience: (player) => player.experienceCounters ?? 0,
};

/** The registry rows a declared keyword string can resolve to, in registry
 *  order — the rows of `kind: "keyword-ability"` the engine enforces. */
type KeywordMatcher = {
    readonly id: string;
    readonly name: string;
    readonly binding?: string;
    readonly bindingPattern?: RegExp;
};
let keywordMatchers: KeywordMatcher[] | undefined;
const keywordPositionCache = new Map<string, number>();

/** The `kw` axis position of a keyword string as an instance carries it
 *  (`"flying"`, `"protection from red"`), or −1. The match is the registry's
 *  own (`isNamedMechanic`): the row's name, its literal binding, or its
 *  pattern for a parametrized keyword — so every protection reads as
 *  protection, whatever it is from. */
function keywordPosition(declared: string, layout: ColumnLayout): number {
    const cached = keywordPositionCache.get(declared);
    if (cached !== undefined) return cached;
    keywordMatchers ??= MECHANICS_REGISTRY.filter(
        (row) => row.kind === "keyword-ability" && row.status === "implemented"
    ).map((row) => ({
        id: row.id,
        name: row.name.toLowerCase(),
        binding: row.binding,
        bindingPattern: row.bindingPattern,
    }));
    const lower = declared.toLowerCase();
    let position = -1;
    for (let i = 0; i < keywordMatchers.length; i++) {
        const row = keywordMatchers[i];
        if (
            lower === row.name ||
            row.binding === declared ||
            row.bindingPattern?.test(declared)
        ) {
            position = layout.keywordIndex.get(row.id) ?? -1;
            break;
        }
    }
    keywordPositionCache.set(declared, position);
    return position;
}

/** A weight table laid out over this build's columns, and the two sums a
 *  pricing walk adds into (`pricedGeneratedVector`). */
export type ColumnPricing = {
    /** Weight of each column, by column index. */
    readonly weights: Float64Array;
    /** 0 where the column counts for `self`, 1 for `opp`, by column index. */
    readonly side: Uint8Array;
};

/** One generation's working state. A walk either COLLECTS the counts (the
 *  vector) or PRICES them as it meets them (`pricing` set): the same walk,
 *  the same counts, with no vector built in between. */
type Run = {
    readonly layout: ColumnLayout;
    readonly counts: Map<number, number>;
    readonly memo: ManaCensusMemo | undefined;
    readonly pricing: ColumnPricing | undefined;
    self: number;
    opp: number;
};

function add(run: Run, column: number, by: number): void {
    if (by === 0) return;
    const pricing = run.pricing;
    if (pricing) {
        const worth = pricing.weights[column] * by;
        if (pricing.side[column] === 0) run.self += worth;
        else run.opp += worth;
        return;
    }
    run.counts.set(column, (run.counts.get(column) ?? 0) + by);
}

function addOps(run: Run, ops: AxisCounts, zone: number, side: number): void {
    const { base, strides } = run.layout.families.op;
    // `ops` is keyed by `op * CARRIERS.length + carrier`, and the family's
    // grid is laid out [op, carrier, zone, side]: that key times the
    // carrier axis's stride is the column of the pair at (hand, self).
    const carrierStride = strides[1];
    for (let i = 0; i < ops.length; i += 2) {
        add(
            run,
            base + ops[i] * carrierStride + zone * strides[2] + side,
            ops[i + 1]
        );
    }
}

/** A card the seat cannot read: one count, and nothing of what it is. */
function addHidden(run: Run, zone: number, side: number): void {
    add(run, columnAt(run.layout, "hidden", zone, side), 1);
}

/** What a card's INSTANCE shows: its type line and the keywords it has now.
 *  Both are the engine's derived values — type-changing effects applied
 *  (layer 4), abilities added and removed (layer 6) — so an animated land
 *  is a creature here and a creature that lost flying has none. */
function addCharacteristics(
    run: Run,
    card: CardInstanceState,
    zone: number,
    side: number
): void {
    const types = card.types ?? [];
    for (let i = 0; i < types.length; i++) {
        const position = CARD_TYPE_POSITION.get(types[i]);
        if (position !== undefined) {
            add(run, columnAt(run.layout, "type", position, zone, side), 1);
        }
    }
    const keywords = card.staticAbilities ?? [];
    for (let i = 0; i < keywords.length; i++) {
        const position = keywordPosition(keywords[i], run.layout);
        if (position >= 0) {
            add(run, columnAt(run.layout, "kw", position, zone, side), 1);
        }
    }
}

function definitionOf(card: { card: unknown }): CardDefinition | null {
    const id = (card.card as { id?: string } | undefined)?.id;
    return id ? tryGetDefinition(id) : null;
}

/** A readable card in a zone: its characteristics, and everything its
 *  definition declares. A card whose definition does not resolve — the
 *  opaque placeholder a hidden slot is rebuilt as — is a hidden card. */
function addCard(
    run: Run,
    card: CardInstanceState,
    zone: number,
    side: number
): void {
    const def = card.faceDown ? null : definitionOf(card);
    if (!def) {
        addHidden(run, zone, side);
        return;
    }
    addCharacteristics(run, card, zone, side);
    const profile = profileOf(def);
    addOps(run, profile.ops, zone, side);
    for (let i = 0; i < profile.manaSymbols.length; i += 2) {
        add(
            run,
            columnAt(
                run.layout,
                "costMana",
                profile.manaSymbols[i],
                zone,
                side
            ),
            profile.manaSymbols[i + 1]
        );
    }
    add(
        run,
        columnAt(run.layout, "costManaValue", zone, side),
        profile.manaValue
    );
    for (let i = 0; i < profile.costLegs.length; i += 2) {
        add(
            run,
            columnAt(
                run.layout,
                "costActivation",
                profile.costLegs[i],
                zone,
                side
            ),
            profile.costLegs[i + 1]
        );
    }
}

/** An object on the stack. A spell is a card in the stack zone and reads as
 *  one. An ABILITY on the stack is not a card: it contributes the Ops of that
 *  one ability and nothing of the permanent it came from, which is still
 *  where it was. An ability whose script lives elsewhere (a delayed trigger's
 *  body, a granted ability's template) is counted as a stack object only. */
function addStackItem(run: Run, item: StackItem, side: number): void {
    const zone = READ_ZONE_POSITION.stack;
    if (item.triggeredAbilityId !== undefined || item.abilityId !== undefined) {
        if (item.faceDown || item.grantedSourceCardId !== undefined) return;
        const def = definitionOf(item);
        const ability =
            item.triggeredAbilityId !== undefined
                ? def?.triggeredAbilities?.find(
                      (t) => t.id === item.triggeredAbilityId
                  )
                : def?.activatedAbilities?.find((a) => a.id === item.abilityId);
        if (!ability) return;
        addOps(
            run,
            siteOpCounts(
                ability,
                item.triggeredAbilityId !== undefined
                    ? "triggered"
                    : "activated"
            ),
            zone,
            side
        );
        return;
    }
    if (item.delayedTriggerId !== undefined) return;
    addCard(run, item as unknown as CardInstanceState, zone, side);
}

function addManaUnits(
    run: Run,
    family: "manaNow" | "manaBase",
    units: ManaUnits,
    side: number
): void {
    add(run, columnAt(run.layout, family, 0, side), units.length);
    for (let k = 1; k < MANA_UNIT_KINDS.length; k++) {
        const color = MANA_UNIT_KINDS[k];
        let n = 0;
        for (let i = 0; i < units.length; i++) {
            if (units[i].has(color as never)) n++;
        }
        add(run, columnAt(run.layout, family, k, side), n);
    }
}

/** Adds `player`'s columns; returns the mana it can pay with right now. */
function addPlayer(
    run: Run,
    state: GameState,
    player: PlayerState,
    seatId: string
): ManaUnits {
    const side = player.id === seatId ? SELF : OPP;
    const { layout } = run;

    add(run, columnAt(layout, "life", side), player.life);
    for (let k = 0; k < PLAYER_COUNTER_KINDS.length; k++) {
        add(
            run,
            columnAt(layout, "counter", k, side),
            PLAYER_COUNTER_READ[PLAYER_COUNTER_KINDS[k]](player)
        );
    }

    const zoneSize = (zone: CountZone, n: number): void =>
        add(run, columnAt(layout, "cards", COUNT_ZONE_POSITION[zone], side), n);
    zoneSize("hand", player.hand.length);
    zoneSize("library", player.library.length);
    zoneSize("battlefield", player.battlefield.length);
    zoneSize("graveyard", player.graveyard.length);
    zoneSize("exile", player.exile.length);

    for (let i = 0; i < player.hand.length; i++) {
        const card = player.hand[i];
        // The seat reads its own hand; of another's, only what it was shown.
        if (side === SELF || card.knownTo?.includes(seatId) === true) {
            addCard(run, card, READ_ZONE_POSITION.hand, side);
        } else {
            addHidden(run, READ_ZONE_POSITION.hand, side);
        }
    }
    for (let i = 0; i < player.battlefield.length; i++) {
        addCard(
            run,
            player.battlefield[i],
            READ_ZONE_POSITION.battlefield,
            side
        );
    }
    for (let i = 0; i < player.graveyard.length; i++) {
        addCard(run, player.graveyard[i], READ_ZONE_POSITION.graveyard, side);
    }

    // What a mana source yields is a QUANTITY, and stays the engine's code
    // (ADR 0186, Decision 1): the census the castability gate itself reads.
    const census = censusOf(state, player, run.memo);
    addManaUnits(run, "manaNow", census.now, side);
    addManaUnits(run, "manaBase", census.base, side);
    return census.now;
}

/** The `need` family: the seat's own list read against the position. */
function addNeeds(
    run: Run,
    state: GameState,
    seat: PlayerState,
    list: readonly string[] | undefined,
    now: ManaUnits
): void {
    const measures = deckNeedMeasures(state, seat, list, now);
    for (let k = 0; k < NEED_MEASURES.length; k++) {
        add(
            run,
            columnAt(run.layout, "need", k, 0),
            measures.get(NEED_MEASURES[k]) ?? 0
        );
    }
}

/**
 * The generated vector of `state`, read for the seat `seatId`.
 *
 * Pure and deterministic. `state` may be the Brain's own (the wire projection
 * through the state adapter) or a full-information one; on either the seat
 * reads only what the projection would show it — see the header.
 *
 * `memo` is the mana census memo of whoever owns the position (an evaluation,
 * a probe): the census is most of what a call costs, and a reader that
 * already took it for this position hands it over instead of paying twice.
 * Same contract as everywhere else — valid only while `state` is not mutated.
 *
 * `deckKnowledge` is what the search knows of each seat's list; the `need`
 * family reads the entry of `seatId` and is zero without one.
 */
export function generatedVector(
    state: GameState,
    seatId: string,
    memo?: ManaCensusMemo,
    deckKnowledge?: DeckKnowledgeBySeat
): GeneratedVector {
    const run: Run = {
        layout: columnLayout(),
        counts: new Map(),
        memo,
        pricing: undefined,
        self: 0,
        opp: 0,
    };
    walk(run, state, seatId, deckKnowledge);
    return vectorOf(run.counts);
}

/** No pricing walk collects a count. */
const NO_COUNTS: Map<number, number> = new Map();

/**
 * The generated vector of `state` for `seatId`, PRICED: the sum of
 * weight × count over the columns counted for `self`, and over those counted
 * for `opp` — `generatedVector` and a dot product, without the vector.
 *
 * It is what an evaluation calls at every leaf, so it allocates nothing per
 * column: each count is multiplied and added as the walk meets it. The sums
 * therefore run in the walk's order, not in column order; the walk is a pure
 * function of the position, so the result is too. Arguments as
 * `generatedVector`'s.
 */
export function pricedGeneratedVector(
    state: GameState,
    seatId: string,
    pricing: ColumnPricing,
    memo?: ManaCensusMemo,
    deckKnowledge?: DeckKnowledgeBySeat
): { self: number; opp: number } {
    const run: Run = {
        layout: columnLayout(),
        counts: NO_COUNTS,
        memo,
        pricing,
        self: 0,
        opp: 0,
    };
    walk(run, state, seatId, deckKnowledge);
    return { self: run.self, opp: run.opp };
}

/** Every count of `state` read for `seatId`, handed to `add`. */
function walk(
    run: Run,
    state: GameState,
    seatId: string,
    deckKnowledge: DeckKnowledgeBySeat | undefined
): void {
    const { layout } = run;

    for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i];
        const now = addPlayer(run, state, player, seatId);
        if (player.id === seatId) {
            addNeeds(
                run,
                state,
                player,
                knowledgeFor(deckKnowledge, seatId),
                now
            );
        }
    }

    for (let i = 0; i < state.stack.length; i++) {
        const item = state.stack[i];
        const side = item.controllerId === seatId ? SELF : OPP;
        add(run, columnAt(layout, "cards", COUNT_ZONE_POSITION.stack, side), 1);
        addStackItem(run, item, side);
    }

    const steps = layout.families.step.family.axes[0];
    const step = steps.indexOf(state.phase);
    if (step >= 0) {
        add(
            run,
            columnAt(
                layout,
                "step",
                step,
                state.activePlayerId === seatId ? SELF : OPP
            ),
            1
        );
    }
}
