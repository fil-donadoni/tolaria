// Deck-relative distance columns of the generated vector (ADR 0186,
// Decisions 3 and 4): how far the position is from what the seat's own cards
// require, and whether what the seat holds can fetch the missing pieces.
//
// A multi-turn intention is carried by the value of the positions on the way
// (Decision 3). "One tutor away from the full set, holding the tutor" is such
// a position, and nothing in the per-card columns sees it: they count what is
// in each zone, never how far the deck is from what its cards ask for. These
// columns are that distance, as unit counts the Weight Fit can price.
//
// WHAT A REQUIREMENT IS. A card in the seat's list (its Deck Knowledge) that
// states a condition on the permanents its controller controls. The condition
// becomes a list of SLOTS — "N cards from this set of the deck's card ids" —
// plus the requirer's own slot (it has to be where it functions). Three shapes
// are read:
//
//   * `manaAmount` — a board-conditional mana ability, which is a closure.
//     It is read as a pure function of a hypothetical battlefield, never as
//     code: the full list is put on the board, then cut down one card at a
//     time while the ability still yields its full `manaProduced`; what is
//     left is one minimal set of pieces, and each piece's slot accepts every
//     card id of the list that can stand in for it. Deck-relative by
//     construction, and kept per (definition, list).
//   * `castCondition` — "cast this spell only if you control N <filter>".
//   * an Effect Script `if` whose predicate compares a `count` of the
//     controller's battlefield with a literal — "if you control three or more
//     artifacts".
//
// Everything else that could hold a requirement is NOT read, and
// `requirementShapes` names it: an alternative cost's or a mode count's
// condition, a count of another zone, and every closure that is a predicate
// (`canActivate`, a trigger's `interveningIf`, a static effect's `condition`,
// `entersTappedUnless`) — a requirement behind an opaque predicate yields no
// column (PRD issue #9771).
//
// HOW FAR. A slot is filled by the cheapest copies still available, each copy
// used once, slots in declaration order. A copy costs the zone moves between
// where it is and where it functions: a permanent piece is 0 on the seat's
// battlefield, 1 in hand, 2 in the library; a spell requirer is 0 in hand and
// 1 in the library. A slot no copy can fill makes the requirement
// unreachable. Where a copy is comes from the list and the PUBLIC zones only
// (`unseenRemainder`): the library is never read, so a full-information state
// and the Brain's projection of it give the same distances.
//
// FETCHING. A search is a `choice { kind: "search-library" }` of the seat's
// own library, on a spell in hand, an ability activated from hand, or an
// ability of a permanent the seat controls. Its finds are the list's card ids
// with a copy left in the library that its filter accepts
// (`definitionMatchesFilter`, the engine's definition-level matcher); a
// ceiling that reads the cost-sacrificed permanent (CR 608.2h) is the largest
// the site's own sacrifice cost can take from the board now. It is
// payable when the seat's untapped mana pays its mana cost now (`canPayCost`,
// the castability gate's own greedy) and a `{T}` it asks for is untapped.
//
// A SEAT WITH NO DECK KNOWLEDGE yields no column: zero, never a guess.

import { tryGetDefinition } from "../../../cards/registry";
import {
    matchesPermanentFilter,
    type PermanentFilter,
} from "../../../cards/filters";
import type {
    ActivatedAbility,
    CardDefinition,
    EffectCardFilter,
    EffectOp,
    EffectPredicate,
    EffectValue,
    ManaCost,
} from "../../../cards/types";
import {
    definitionMatchesFilter,
    sacrificeCandidateReads,
    type SacrificeCandidateRead,
} from "../../alternativeCost";
import { isTapLockedBySummoningSickness, manaValue } from "../../constants";
import { unseenRemainder } from "../../deckKnowledge";
import { isFaceDownExile } from "../../faceDown";
import { canPayCost, type ManaUnits } from "../../manaAvailability";
import type { CardInstanceState, GameState, PlayerState } from "../../state";
import { childOpArrays } from "../effectOpChildren";
import type { NeedMeasure } from "./columns";

/** Where a requirer functions from. */
type Home = "battlefield" | "hand";

/** "`copies` cards whose id is in `accepts`." */
type Slot = {
    /** Distinct card ids, in list order. */
    readonly accepts: readonly string[];
    readonly copies: number;
};

/** One requirement a card of the list states. */
type Requirement = {
    readonly requirerId: string;
    readonly home: Home;
    /** The requirer's own slot first, then the pieces. */
    readonly slots: readonly Slot[];
};

/** A requirement shape, as `requirementShapes` reports it. */
export type RequirementShape =
    | "read.manaAmount"
    | "read.castCondition"
    | "read.scriptCount"
    | "unread.manaAmount"
    | "unread.alternativeCostCondition"
    | "unread.modeCountCondition"
    | "unread.scriptCountOtherZone"
    | "unread.canActivate"
    | "unread.interveningIf"
    | "unread.staticCondition"
    | "unread.entersTappedUnless";

// ---------------------------------------------------------------------------
// Reading a definition's requirements
// ---------------------------------------------------------------------------

type ScriptSite = {
    effects?: readonly EffectOp[];
    aiEffects?: readonly EffectOp[];
    modes?: readonly ScriptSite[];
};

/** A site's scripts: real, else shadow, else each mode's — the same choice
 *  `profile.ts` makes. */
function siteScripts(site: ScriptSite): (readonly EffectOp[])[] {
    if (site.effects && site.effects.length > 0) return [site.effects];
    if (site.aiEffects && site.aiEffects.length > 0) return [site.aiEffects];
    return (site.modes ?? []).flatMap(siteScripts);
}

/** Every Op of `scripts`, at any depth. */
function eachOp(
    scripts: readonly (readonly EffectOp[])[],
    visit: (op: EffectOp) => void
): void {
    for (let s = 0; s < scripts.length; s++) {
        const script = scripts[s];
        for (let i = 0; i < script.length; i++) {
            visit(script[i]);
            eachOp(childOpArrays(script[i]), visit);
        }
    }
}

/** The scripts of `def` with where they function from. */
function scriptHomes(
    def: CardDefinition
): { scripts: (readonly EffectOp[])[]; home: Home }[] {
    const out: { scripts: (readonly EffectOp[])[]; home: Home }[] = [
        { scripts: siteScripts(def), home: "hand" },
    ];
    const activated = def.activatedAbilities ?? [];
    for (let i = 0; i < activated.length; i++) {
        out.push({
            scripts: siteScripts(activated[i]),
            home: activated[i].activateFromHand ? "hand" : "battlefield",
        });
    }
    const triggered = def.triggeredAbilities ?? [];
    for (let i = 0; i < triggered.length; i++) {
        out.push({ scripts: siteScripts(triggered[i]), home: "battlefield" });
    }
    return out;
}

type CountThreshold = {
    readonly zone: string;
    readonly mine: boolean;
    readonly filter?: EffectCardFilter;
    /** How many matching cards make the predicate hold. */
    readonly atLeast: number;
};

function countSpecOf(value: EffectValue): {
    zone: string;
    mine: boolean;
    filter?: EffectCardFilter;
    times: number;
} | null {
    if (typeof value !== "object" || value === null || !("count" in value)) {
        return null;
    }
    const spec = value.count;
    return {
        zone: spec.zone,
        mine:
            spec.controller === "controller" &&
            !spec.acrossAllPlayers &&
            !spec.smallestAcrossPlayers,
        filter: spec.filter,
        times: spec.times ?? 1,
    };
}

/** `count(...) >= N` in any of its spellings, or null. */
function countThreshold(predicate: EffectPredicate): CountThreshold | null {
    if (!("left" in predicate) || !("right" in predicate)) return null;
    const { left, op, right } = predicate;
    let spec = countSpecOf(left);
    let literal = right;
    let cmp = op;
    if (!spec) {
        spec = countSpecOf(right);
        literal = left;
        // `N <= count` is `count >= N`.
        const mirror = { lt: "gt", le: "ge", gt: "lt", ge: "le" } as const;
        cmp = op in mirror ? mirror[op as keyof typeof mirror] : op;
    }
    if (!spec || typeof literal !== "number") return null;
    let needed: number;
    if (cmp === "ge") needed = literal;
    else if (cmp === "gt") needed = literal + 1;
    else return null;
    if (needed <= 0) return null;
    return {
        zone: spec.zone,
        mine: spec.mine,
        filter: spec.filter,
        atLeast: Math.ceil(needed / spec.times),
    };
}

/** The threshold `if` predicates of a definition's scripts. */
function scriptThresholds(
    def: CardDefinition
): { threshold: CountThreshold; home: Home }[] {
    const out: { threshold: CountThreshold; home: Home }[] = [];
    const homes = scriptHomes(def);
    for (let i = 0; i < homes.length; i++) {
        const home = homes[i].home;
        eachOp(homes[i].scripts, (op) => {
            if (op.op !== "if") return;
            const threshold = countThreshold(op.predicate);
            if (threshold) out.push({ threshold, home });
        });
    }
    return out;
}

function manaTotal(cost: ManaCost | null | undefined): number {
    return cost ? manaValue(cost) : 0;
}

/** A card of the list as the battlefield would hold it, untapped and under
 *  `playerId`'s control. */
function boardCard(
    cardId: string,
    def: CardDefinition,
    playerId: string,
    index: number
): CardInstanceState {
    return {
        id: `deck-needs:${index}`,
        card: { id: cardId },
        types: def.types ?? [],
        subtypes: def.subtypes ?? [],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: def.staticAbilities ?? [],
        controllerId: playerId,
        ownerId: playerId,
        zone: "battlefield",
        isTapped: false,
    };
}

/** The pieces a board-conditional mana ability waits for, as slots over the
 *  list. `"none"` when it waits for nothing (its full output with the source
 *  alone); `"unread"` when even the whole list on the battlefield does not
 *  make it yield its full output — it waits for something that is not a
 *  permanent (a linked exiled card, a counter), which this does not read. */
function manaAmountSlots(
    requirerId: string,
    ability: ActivatedAbility,
    list: readonly string[],
    defs: ReadonlyMap<string, CardDefinition>
): Slot[] | "none" | "unread" {
    const amount = ability.manaAmount;
    const full = manaTotal(ability.manaProduced);
    if (!amount || full === 0) return "none";
    const requirer = defs.get(requirerId) as CardDefinition;
    const source = boardCard(requirerId, requirer, "seat", -1);
    const yields = (ids: readonly string[]): boolean => {
        const board = [source];
        for (let i = 0; i < ids.length; i++) {
            board.push(
                boardCard(ids[i], defs.get(ids[i]) as CardDefinition, "seat", i)
            );
        }
        try {
            return manaTotal(amount(source as never, board as never)) >= full;
        } catch {
            return false;
        }
    };
    if (yields([])) return "none";
    // The list minus the requirer's own copy, which is the source.
    const pool = [...list];
    pool.splice(pool.indexOf(requirerId), 1);
    if (!yields(pool)) return "unread";
    // Cut the board down one card at a time while the ability still yields
    // its full output: what is left is minimal.
    let kept = pool;
    for (let i = kept.length - 1; i >= 0; i--) {
        const without = kept.slice(0, i).concat(kept.slice(i + 1));
        if (yields(without)) kept = without;
    }
    // One slot per distinct piece; it accepts every id that can stand in.
    const distinct = [...new Set(list)];
    const slots: Slot[] = [];
    const seen = new Set<string>();
    for (let p = 0; p < kept.length; p++) {
        const piece = kept[p];
        if (seen.has(piece)) continue;
        seen.add(piece);
        const copies = kept.filter((id) => id === piece).length;
        const accepts: string[] = [];
        for (let c = 0; c < distinct.length; c++) {
            const swapped = kept.slice();
            swapped[p] = distinct[c];
            if (yields(swapped)) accepts.push(distinct[c]);
        }
        slots.push({ accepts, copies });
    }
    return slots;
}

/** Whether the card `def` names, as a permanent, matches a count's filter.
 *  `powerAtLeast` is battlefield state the definition-level matcher refuses;
 *  for a card not yet on the battlefield it is read off the printed power. */
function permanentCardMatches(
    def: CardDefinition,
    filter: EffectCardFilter | undefined
): boolean {
    if (!filter) return true;
    const { powerAtLeast, ...rest } = filter;
    if (powerAtLeast !== undefined) {
        if (typeof def.power !== "number" || def.power < powerAtLeast) {
            return false;
        }
    }
    return definitionMatchesFilter(def, rest, "hand");
}

function idsMatching(
    distinct: readonly string[],
    defs: ReadonlyMap<string, CardDefinition>,
    accepts: (def: CardDefinition) => boolean
): string[] {
    const out: string[] = [];
    for (let i = 0; i < distinct.length; i++) {
        if (accepts(defs.get(distinct[i]) as CardDefinition)) {
            out.push(distinct[i]);
        }
    }
    return out;
}

/** Every requirement the cards of `list` state, read once per list. */
function deriveRequirements(list: readonly string[]): Requirement[] {
    const defs = definitionsOf(list);
    const readable = list.filter((id) => defs.has(id));
    const distinct = [...defs.keys()];
    const out: Requirement[] = [];
    const self = (id: string): Slot => ({ accepts: [id], copies: 1 });

    for (let r = 0; r < distinct.length; r++) {
        const requirerId = distinct[r];
        const def = defs.get(requirerId) as CardDefinition;

        const activated = def.activatedAbilities ?? [];
        for (let i = 0; i < activated.length; i++) {
            const slots = manaAmountSlots(
                requirerId,
                activated[i],
                readable,
                defs
            );
            if (typeof slots === "string") continue;
            out.push({
                requirerId,
                home: "battlefield",
                slots: [self(requirerId), ...slots],
            });
        }

        const cast = def.castCondition;
        if (cast?.kind === "control") {
            out.push({
                requirerId,
                home: "hand",
                slots: [
                    self(requirerId),
                    {
                        accepts: idsMatching(distinct, defs, (d) =>
                            matchesPermanentFilter(
                                {
                                    id: d.id,
                                    name: d.name,
                                    types: d.types ?? [],
                                    subtypes: d.subtypes ?? [],
                                    supertypes: d.supertypes ?? [],
                                    staticAbilities: d.staticAbilities ?? [],
                                },
                                cast.filter
                            )
                        ),
                        copies: cast.minCount ?? 1,
                    },
                ],
            });
        }

        const thresholds = scriptThresholds(def);
        for (let i = 0; i < thresholds.length; i++) {
            const { threshold, home } = thresholds[i];
            if (threshold.zone !== "battlefield" || !threshold.mine) continue;
            const filter = threshold.filter;
            // A requirer waiting on the battlefield counts itself when it
            // matches its own filter ("if you control three or more
            // artifacts" on an artifact): one piece fewer to find.
            const selfCounts =
                home === "battlefield" && permanentCardMatches(def, filter);
            const pieces = threshold.atLeast - (selfCounts ? 1 : 0);
            out.push({
                requirerId,
                home,
                slots: [
                    self(requirerId),
                    {
                        accepts: idsMatching(distinct, defs, (d) =>
                            permanentCardMatches(d, filter)
                        ),
                        copies: pieces,
                    },
                ],
            });
        }
    }
    return out;
}

/** The definitions of a list's card ids, in list order; an id the catalogue
 *  does not hold is left out. */
function definitionsOf(list: readonly string[]): Map<string, CardDefinition> {
    const defs = new Map<string, CardDefinition>();
    for (let i = 0; i < list.length; i++) {
        if (defs.has(list[i])) continue;
        const def = tryGetDefinition(list[i]);
        if (def) defs.set(list[i], def);
    }
    return defs;
}

const requirementCache = new WeakMap<readonly string[], Requirement[]>();

function requirementsOf(list: readonly string[]): Requirement[] {
    let requirements = requirementCache.get(list);
    if (!requirements) {
        requirements = deriveRequirements(list);
        requirementCache.set(list, requirements);
    }
    return requirements;
}

/** The requirement shapes `def` carries in the list `list`, read or not —
 *  the census of what this family can and cannot see. A shape is named once
 *  per card. */
export function requirementShapes(
    def: CardDefinition,
    list: readonly string[]
): RequirementShape[] {
    const shapes = new Set<RequirementShape>();
    const defs = definitionsOf(list);
    defs.set(def.id, def);
    const readable = list.filter((id) => defs.has(id));
    if (!readable.includes(def.id)) readable.push(def.id);
    const activated = def.activatedAbilities ?? [];
    for (let i = 0; i < activated.length; i++) {
        const ability = activated[i];
        if (ability.manaAmount) {
            const read = manaAmountSlots(def.id, ability, readable, defs);
            if (read === "unread") shapes.add("unread.manaAmount");
            else if (read !== "none") shapes.add("read.manaAmount");
        }
        if (ability.canActivate) shapes.add("unread.canActivate");
    }
    if (def.castCondition?.kind === "control") {
        shapes.add("read.castCondition");
    }
    const thresholds = scriptThresholds(def);
    for (let i = 0; i < thresholds.length; i++) {
        const threshold = thresholds[i].threshold;
        shapes.add(
            threshold.zone === "battlefield" && threshold.mine
                ? "read.scriptCount"
                : "unread.scriptCountOtherZone"
        );
    }
    if (def.alternativeCosts?.some((alt) => alt.condition !== undefined)) {
        shapes.add("unread.alternativeCostCondition");
    }
    const modeSites = [def, ...(def.activatedAbilities ?? [])];
    if (modeSites.some((site) => site.modeSelection?.when !== undefined)) {
        shapes.add("unread.modeCountCondition");
    }
    if ((def.triggeredAbilities ?? []).some((t) => t.interveningIf)) {
        shapes.add("unread.interveningIf");
    }
    if (
        (def.staticEffects ?? []).some(
            (effect) =>
                typeof (effect as { condition?: unknown }).condition ===
                "function"
        )
    ) {
        shapes.add("unread.staticCondition");
    }
    if (def.entersTappedUnless) shapes.add("unread.entersTappedUnless");
    return [...shapes];
}

// ---------------------------------------------------------------------------
// Reading a position against them
// ---------------------------------------------------------------------------

/** Where the seat's copies of each card id are, read from public zones and
 *  the seat's own hand. */
type Copies = {
    battlefield: Map<string, number>;
    hand: Map<string, number>;
    library: Map<string, number>;
};

function bump(map: Map<string, number>, id: string): void {
    map.set(id, (map.get(id) ?? 0) + 1);
}

function cardIdOf(card: { card: unknown }): string {
    return String((card.card as { id?: string } | undefined)?.id ?? "");
}

function copiesOf(
    state: GameState,
    seat: PlayerState,
    list: readonly string[]
): Copies {
    const copies: Copies = {
        battlefield: new Map(),
        hand: new Map(),
        library: new Map(),
    };
    for (let i = 0; i < seat.battlefield.length; i++) {
        const card = seat.battlefield[i];
        if (!card.faceDown) bump(copies.battlefield, cardIdOf(card));
    }
    for (let i = 0; i < seat.hand.length; i++) {
        bump(copies.hand, cardIdOf(seat.hand[i]));
    }
    // The decklist minus every copy accounted for in a public zone is the
    // hand plus the library; the seat reads its own hand.
    const unseen = new Map<string, number>();
    const remainder = unseenRemainder(state, seat, list, seat.id);
    for (let i = 0; i < remainder.length; i++) bump(unseen, remainder[i]);
    // The seat's own face-down cards are not in its library, though no
    // OBSERVER could subtract them: the seat knows what it put face down.
    const ownFaceDown = new Map<string, number>();
    for (let p = 0; p < state.players.length; p++) {
        const player = state.players[p];
        const zones = [player.battlefield, player.exile];
        for (let z = 0; z < zones.length; z++) {
            const zone = zones[z];
            for (let i = 0; i < zone.length; i++) {
                const c = zone[i];
                if (c.ownerId !== seat.id) continue;
                if (c.faceDown === true || isFaceDownExile(c)) {
                    bump(ownFaceDown, cardIdOf(c));
                }
            }
        }
    }
    unseen.forEach((n, id) => {
        const left =
            n - (copies.hand.get(id) ?? 0) - (ownFaceDown.get(id) ?? 0);
        if (left > 0) copies.library.set(id, left);
    });
    return copies;
}

/** Cost of a copy in `zone` for a slot whose cards function from `home`. */
function stepCost(zone: keyof Copies, home: Home): number | null {
    if (home === "battlefield") {
        return zone === "battlefield" ? 0 : zone === "hand" ? 1 : 2;
    }
    return zone === "hand" ? 0 : zone === "library" ? 1 : null;
}

const ZONES: readonly (keyof Copies)[] = ["battlefield", "hand", "library"];

type Distance = {
    /** Null when some slot cannot be filled. */
    readonly steps: number | null;
    /** The card ids taken from the library, per slot. */
    readonly fromLibrary: readonly ReadonlySet<string>[];
};

function distanceOf(requirement: Requirement, copies: Copies): Distance {
    const used = new Map<string, number>();
    const usedKey = (zone: string, id: string): string => `${zone}\u0000${id}`;
    let steps = 0;
    const fromLibrary: Set<string>[] = [];
    for (let s = 0; s < requirement.slots.length; s++) {
        const slot = requirement.slots[s];
        // The requirer functions from its home; a piece is a permanent.
        const home: Home = s === 0 ? requirement.home : "battlefield";
        const fetched = new Set<string>();
        for (let n = 0; n < slot.copies; n++) {
            let best: { zone: keyof Copies; id: string; cost: number } | null =
                null;
            for (let z = 0; z < ZONES.length; z++) {
                const zone = ZONES[z];
                const cost = stepCost(zone, home);
                if (cost === null || (best && best.cost <= cost)) continue;
                for (let a = 0; a < slot.accepts.length; a++) {
                    const id = slot.accepts[a];
                    const have = copies[zone].get(id) ?? 0;
                    if (have - (used.get(usedKey(zone, id)) ?? 0) > 0) {
                        best = { zone, id, cost };
                        break;
                    }
                }
            }
            if (!best) return { steps: null, fromLibrary };
            const key = usedKey(best.zone, best.id);
            used.set(key, (used.get(key) ?? 0) + 1);
            steps += best.cost;
            if (best.zone === "library") fetched.add(best.id);
        }
        fromLibrary.push(fetched);
    }
    return { steps, fromLibrary };
}

/** One search effect the seat can use. */
type Search = {
    readonly filter: EffectCardFilter;
    readonly payable: boolean;
    /** What the site's "sacrifice a <filter>" cost could take, so a ceiling
     *  reading the sacrificed permanent (CR 608.2h) is bounded by the board. */
    readonly sacrificeCandidates?: readonly SacrificeCandidateRead[];
};

function searchFiltersOf(
    scripts: readonly (readonly EffectOp[])[]
): EffectCardFilter[] {
    const out: EffectCardFilter[] = [];
    eachOp(scripts, (op) => {
        if (
            op.op === "choice" &&
            op.kind === "search-library" &&
            op.player === "controller" &&
            (op.zone === undefined || op.zone === "library")
        ) {
            out.push((op as { filter?: EffectCardFilter }).filter ?? {});
        }
    });
    return out;
}

function searchesOf(
    state: GameState,
    seat: PlayerState,
    now: ManaUnits
): Search[] {
    const out: Search[] = [];
    const life = seat.life;
    const push = (
        scripts: (readonly EffectOp[])[],
        cost: ManaCost | undefined,
        untapped: boolean,
        sacrificeFilter?: PermanentFilter
    ): void => {
        const filters = searchFiltersOf(scripts);
        if (filters.length === 0) return;
        const payable = untapped && canPayCost(now, cost, { life });
        const sacrificeCandidates = sacrificeFilter
            ? sacrificeCandidateReads(state, seat.id, sacrificeFilter)
            : undefined;
        for (let i = 0; i < filters.length; i++) {
            out.push({
                filter: filters[i],
                payable,
                ...(sacrificeCandidates ? { sacrificeCandidates } : {}),
            });
        }
    };
    for (let h = 0; h < seat.hand.length; h++) {
        const def = tryGetDefinition(cardIdOf(seat.hand[h]));
        if (!def) continue;
        if (!def.types.includes("Land")) {
            push(
                siteScripts(def),
                def.manaCost,
                true,
                def.additionalCosts?.sacrificeFilter
            );
        }
        const activated = def.activatedAbilities ?? [];
        for (let i = 0; i < activated.length; i++) {
            const ability = activated[i];
            if (!ability.activateFromHand) continue;
            push(
                siteScripts(ability),
                ability.cost.mana,
                !ability.cost.tap,
                ability.cost.sacrificeFilter
            );
        }
    }
    for (let b = 0; b < seat.battlefield.length; b++) {
        const card = seat.battlefield[b];
        if (card.faceDown) continue;
        const def = tryGetDefinition(cardIdOf(card));
        if (!def) continue;
        const activated = def.activatedAbilities ?? [];
        for (let i = 0; i < activated.length; i++) {
            const ability = activated[i];
            if (ability.activateFromHand) continue;
            // CR 302.6 — a creature's {T} ability can't be activated unless
            // it has been under its controller's control since their most
            // recent turn began; any {T} needs the permanent untapped.
            push(
                siteScripts(ability),
                ability.cost.mana,
                !(
                    ability.cost.tap &&
                    (card.isTapped || isTapLockedBySummoningSickness(card))
                ),
                ability.cost.sacrificeFilter
            );
        }
    }
    return out;
}

function findsOf(search: Search, library: ReadonlyMap<string, number>) {
    const finds: string[] = [];
    library.forEach((_n, id) => {
        const def = tryGetDefinition(id);
        if (
            def &&
            definitionMatchesFilter(
                def,
                search.filter,
                "hand",
                search.sacrificeCandidates
            )
        ) {
            finds.push(id);
        }
    });
    return finds;
}

const FAR = 4;

/**
 * The deck-relative distance measures of `seat`, keyed by `NEED_MEASURES`
 * position. `list` is the seat's own decklist (its Deck Knowledge); with no
 * list there is nothing to read and every measure is zero. `now` is the mana
 * the seat can pay with right now.
 *
 * `distanceMin` is zero in three positions — every requirement met, none
 * reachable, none stated — which `met`, `unreachable` and `requirements`
 * tell apart.
 */
export function deckNeedMeasures(
    state: GameState,
    seat: PlayerState,
    list: readonly string[] | undefined,
    now: ManaUnits
): Map<NeedMeasure, number> {
    const out = new Map<NeedMeasure, number>();
    if (!list || list.length === 0) return out;
    const add = (measure: NeedMeasure, by: number): void => {
        if (by !== 0) out.set(measure, (out.get(measure) ?? 0) + by);
    };

    const copies = copiesOf(state, seat, list);
    const searches = searchesOf(state, seat, now);
    const finds = searches.map((search) => findsOf(search, copies.library));
    const findSets = finds.map((ids) => new Set(ids));
    const searchIds = new Set<string>();
    copies.library.forEach((_n, id) => {
        const def = tryGetDefinition(id);
        if (def && searchesOfDefinition(def)) searchIds.add(id);
    });

    const requirements = requirementsOf(list);
    add("requirements", requirements.length);
    let closest: number | null = null;
    const pieceIds = new Set<string>();
    for (let r = 0; r < requirements.length; r++) {
        const requirement = requirements[r];
        const { steps, fromLibrary } = distanceOf(requirement, copies);
        if (steps === null) {
            add("unreachable", 1);
            continue;
        }
        if (steps === 0) {
            add("met", 1);
            continue;
        }
        closest = closest === null ? steps : Math.min(closest, steps);
        add(
            steps >= FAR ? "distanceFar" : (`distance${steps}` as NeedMeasure),
            1
        );
        // A slot that had to come from the library is a slot a find of the
        // same slot can shorten.
        let fetchable = false;
        let fetchableNow = false;
        for (let s = 0; s < requirement.slots.length; s++) {
            if (fromLibrary[s].size === 0) continue;
            const accepts = requirement.slots[s].accepts;
            for (let a = 0; a < accepts.length; a++) {
                const id = accepts[a];
                if (!copies.library.has(id)) continue;
                pieceIds.add(id);
                for (let k = 0; k < searches.length; k++) {
                    if (!findSets[k].has(id)) continue;
                    fetchable = true;
                    if (searches[k].payable) fetchableNow = true;
                }
            }
        }
        add("fetchable", fetchable ? 1 : 0);
        add("fetchableNow", fetchableNow ? 1 : 0);
    }
    add("distanceMin", closest ?? 0);

    add("searches", searches.length);
    let findsManaValueMax = 0;
    for (let k = 0; k < searches.length; k++) {
        add("searchesPayable", searches[k].payable ? 1 : 0);
        let piece = false;
        let search = false;
        for (let f = 0; f < finds[k].length; f++) {
            const id = finds[k][f];
            if (pieceIds.has(id)) piece = true;
            if (searchIds.has(id)) search = true;
            const def = tryGetDefinition(id);
            if (def) {
                findsManaValueMax = Math.max(
                    findsManaValueMax,
                    manaValue(def.manaCost)
                );
            }
        }
        add("findsPiece", piece ? 1 : 0);
        add("findsSearch", search ? 1 : 0);
    }
    add("findsManaValueMax", findsManaValueMax);
    return out;
}

/** Whether a card carries a search of its controller's library anywhere a
 *  seat could use it. */
function searchesOfDefinition(def: CardDefinition): boolean {
    if (searchFiltersOf(siteScripts(def)).length > 0) return true;
    return (def.activatedAbilities ?? []).some(
        (ability) => searchFiltersOf(siteScripts(ability)).length > 0
    );
}
