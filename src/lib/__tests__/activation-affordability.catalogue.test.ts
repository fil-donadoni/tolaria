// Catalogue-wide frontend affordability sweep (frontend-wiring regime).
//
// The bug class this guards: a card ability works end-to-end in the GRE, but
// its *frontend affordability hint* is silently broken because a client-side
// view reducer drops a field the hint reads. `getStackAbilities`
// (src/lib/card-utils.ts) decides whether an activated ability is OFFERED in
// the UI; for several activation-cost shapes it reads viewer-visible state
// built by `buildTriggerStateView`, or fields on the projected card instance.
// If the reducer omits a field, the ability is wrongly hidden (Grim
// Lavamancer: `buildTriggerStateView` dropped `graveyard` → the exile cost was
// never affordable → the ability never appeared, despite a legal GRE
// activation).
//
// GRE unit tests, wire-format tests and the DSL smoke sweep NEVER touch this
// path — the ability is legal server-side, so they pass while the UI is dead.
// This sweep is the automated net: for EVERY card in the catalogue whose
// activated ability carries a mechanically-satisfiable affordability cost
// (`exileFromGraveyard`, `life`, `removeCounter`), it asserts the ability is
//   • SURFACED under a fully-satisfying viewer-visible input, AND
//   • HIDDEN when exactly that one cost shape is made unaffordable,
// driving the SURFACE case through the real `buildTriggerStateView` reducer so
// a dropped field fails here. A new card reusing these shapes is picked up
// automatically — zero per-card authoring.
//
// Abilities whose payability depends on an arbitrary `canActivate` /
// `getTargetRequirement` predicate can't be generically satisfied and are
// reported as an explicit SKIP with a reason (collected + printed), never
// silently green. The sweep also fails if it becomes vacuous (no ability
// exercised) so deleting the last such card can't hide a regression.
//
// CR 113.6 (issue #2235) — a GRAVEYARD-source ability (`activateFromGraveyard`,
// Whiteout / Ashen Ghoul) is never offered by `getStackAbilities` at all (that
// gate unconditionally hides it — CR 113.6/602.5b: it functions ONLY from the
// graveyard). Its real affordance is the sibling reducer
// `getGraveyardStackAbilities`, which this sweep dispatches to instead for any
// such ability — same fully-affordable/broken-by-one-shape harness, just
// through the graveyard zone-listing helper.

import { describe, it, expect } from "vitest";
import { getAllCards } from "@convex/cards";
import type {
    ActivatedAbility,
    CardDefinition,
    EffectCardFilter,
} from "@convex/cards/types";
import type { CardInstance } from "../../types/game";
import {
    getStackAbilities,
    getGraveyardStackAbilities,
    getManaCostMenuAbility,
    buildTriggerStateView,
} from "../card-utils";
import {
    matchesPermanentFilter,
    type PermanentFilter,
} from "@convex/cards/filters";
import { getColorsFromCost } from "@convex/cards/colors";

/** The activation-cost shapes with a `getStackAbilities` affordability gate
 *  that a client-side reducer (or the projection) can silently break. Scalar
 *  shapes (`life`) are included because the same "surface vs hide" contract
 *  regresses if the gate itself is ever miswired. */
type Shape =
    | "exileFromGraveyard"
    | "life"
    | "removeCounter"
    | "discardFilter"
    | "loyalty"
    | "tapOtherFilter"
    | "sacrificeFilter";

/** Finds a REAL catalogue card definition matching an `EffectCardFilter`'s
 *  `type`/`subtype` fields (the two dimensions a `discardFilter` cost is
 *  expected to use — Survival of the Fittest's "a creature card"). The
 *  `discardFilter` hand-card matcher (`handCardMatchesFilter`,
 *  `convex/gre/alternativeCost.ts`) reads a hand card's REGISTRY definition
 *  via `card.card.id`, not synthetic fields on the `CardInstance` fixture
 *  itself (unlike `PermanentFilter` matching) — so building a matching hand
 *  card means finding a real card id whose definition satisfies the filter. */
function findMatchingCardId(filter: EffectCardFilter): string {
    const asArray = <T>(v: T | T[] | undefined): T[] | undefined =>
        v === undefined ? undefined : Array.isArray(v) ? v : [v];
    const types = asArray(filter.type);
    const subtypes = asArray(filter.subtype);
    const found = getAllCards().find((d) => {
        if (types !== undefined && !types.some((t) => d.types.includes(t))) {
            return false;
        }
        if (
            subtypes !== undefined &&
            !subtypes.some((s) => (d.subtypes ?? []).includes(s))
        ) {
            return false;
        }
        return true;
    });
    if (!found) {
        throw new Error(
            "No catalogue card matches this discardFilter — the sweep's " +
                "findMatchingCardId helper needs a wider filter dimension."
        );
    }
    return found.id;
}

/** A hand card referencing a REAL registry card id (so `getDefinition` in
 *  `handCardMatchesFilter` resolves real types/subtypes). */
function handCard(id: string, cardId: string): CardInstance {
    return {
        id,
        card: { id: cardId },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "hand",
        isTapped: false,
        types: [],
        subtypes: [],
    };
}

const VIEWER = "p1";
const OPP = "p2";

/** A source permanent that clears every gate NOT under test: untapped, no
 *  summoning sickness, high counters. Counters/life are overridden per case. */
function makeSource(
    def: CardDefinition,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id: "src-1",
        card: { id: def.id },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
        ...overrides,
    };
}

/** A do-nothing permanent that exists purely so a TARGETING ability has a legal
 *  target candidate (CR 602.2b — `getStackAbilities` hides a targeting ability
 *  with none, so without this every such ability would read as "unaffordable"
 *  and the sweep would be measuring the wrong gate). Carries every permanent
 *  card type so it satisfies any `type` / `"any"` requirement; one is placed on
 *  EACH battlefield so `controller: "you" | "opponent" | "any"` all resolve. */
function targetDummy(id: string, ownerId: string): CardInstance {
    return {
        id,
        card: { id: "dummy" },
        controllerId: ownerId,
        ownerId,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature", "Artifact", "Enchantment", "Land", "Planeswalker"],
        subtypes: [],
    };
}

/** A graveyard card carrying the `types` the `cardType` filter may read. */
function gvCard(id: string, ownerId: string): CardInstance {
    return {
        id,
        card: { id: "gv" },
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
        isTapped: false,
        types: ["Creature", "Artifact", "Enchantment"],
        subtypes: [],
    };
}

/** A REAL catalogue creature matching a `tapOtherFilter`'s `PermanentFilter`,
 *  with power >= 1 so it can move a `totalPower` (crew) total. The gate weighs
 *  the view entries `buildTriggerStateView` produces, so the fixture must be a
 *  real card id (the reducer derives colours — and `crewPowerBonus` — from the
 *  definition). Returns null when the catalogue has no such card, which the
 *  sweep reports as a skip rather than a failure. */
function findMatchingPermanentCardId(
    filter: PermanentFilter
): { id: string; power: number } | null {
    // `isToken` is an INSTANCE property (was THIS permanent created via
    // createToken?), never a property of the printed card definition — every
    // catalogue definition, cast normally, is a nontoken permanent. Matching
    // WITH `isToken` folded in would make an `isToken: true` filter
    // unsatisfiable by ANY definition and always report a skip rather than
    // asserting real behavior; match on every OTHER dimension and declare the
    // probe `isToken: false` (the "cast normally" case) explicitly.
    const { isToken: _isToken, ...structuralFilter } = filter;
    void _isToken;
    for (const def of getAllCards()) {
        if (!def.types.includes("Creature")) continue;
        if (def.power === undefined || def.power < 1) continue;
        const view = {
            id: "probe",
            controllerId: VIEWER,
            ownerId: VIEWER,
            types: def.types,
            subtypes: def.subtypes ?? [],
            supertypes: def.supertypes ?? [],
            staticAbilities: def.staticAbilities ?? [],
            power: def.power,
            toughness: def.toughness,
            isTapped: false,
            colors: getColorsFromCost(def.manaCost),
            isToken: false,
        };
        if (
            matchesPermanentFilter(view, structuralFilter, {
                selfControllerId: VIEWER,
            })
        ) {
            return { id: def.id, power: def.power };
        }
    }
    return null;
}

/** A REAL catalogue permanent (any type — unlike `findMatchingPermanentCardId`,
 *  a `sacrificeFilter` cost can name an artifact/enchantment/land, not only a
 *  creature: Priest of Yawgmoth "Sacrifice an artifact", Deadapult "Sacrifice
 *  a Zombie") matching the given `PermanentFilter`. Returns null when the
 *  catalogue has no such card, which the sweep reports as a skip rather than
 *  a failure. */
function findMatchingAnyPermanentCardId(
    filter: PermanentFilter
): string | null {
    // Same `isToken`-is-an-instance-property reasoning as
    // `findMatchingPermanentCardId` above — Caribou Range's "Sacrifice a
    // Caribou TOKEN" (`{ subtypes: "Caribou", isToken: true }`) must find a
    // real Caribou-subtype DEFINITION here (ignoring `isToken`); the fixture
    // builder below (`sacrificeHelpers`) is what actually stamps the
    // resulting instance as a token, matching the card's real cost.
    const { isToken: _isToken, ...structuralFilter } = filter;
    void _isToken;
    for (const def of getAllCards()) {
        const view = {
            id: "probe",
            controllerId: VIEWER,
            ownerId: VIEWER,
            types: def.types,
            subtypes: def.subtypes ?? [],
            supertypes: def.supertypes ?? [],
            staticAbilities: def.staticAbilities ?? [],
            power: def.power,
            toughness: def.toughness,
            isTapped: false,
            colors: getColorsFromCost(def.manaCost),
            isToken: false,
        };
        if (
            matchesPermanentFilter(view, structuralFilter, {
                selfControllerId: VIEWER,
            })
        ) {
            return def.id;
        }
    }
    return null;
}

/** An untapped creature the viewer controls, built from a real card id so the
 *  reducer can derive its colours / crew bonus. */
function crewHelper(
    id: string,
    cardId: string,
    def: CardDefinition
): CardInstance {
    return {
        id,
        card: { id: cardId },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
        staticAbilities: def.staticAbilities ?? [],
        power: def.power,
        toughness: def.toughness,
    };
}

/** A synthetic sacrifice-cost fixture built DIRECTLY from a `sacrificeFilter`'s
 *  own declared dimensions — the fallback for a filter with NO backing
 *  catalogue `CardDefinition` (Caribou Range's "Sacrifice a Caribou TOKEN":
 *  "Caribou" is a TOKEN-ONLY creature type in this catalogue — and in real
 *  Magic — so `getAllCards()` can never find a nontoken card with it).
 *  Bypasses the registry-derived `colors` path `crewHelper` relies on (an
 *  unregistered card id resolves to no definition) by setting
 *  `colorOverride` and every structural field directly off the filter — the
 *  same "synthetic, non-catalogue fixture" shape `targetDummy`/`gvCard`
 *  already use elsewhere in this file. `CardInstance` has no `supertypes`
 *  field (`buildTriggerStateView` only ever derives it via a registry lookup
 *  by real card id, which a synthetic id can't provide) so a
 *  `supertypes`-gated filter can't be satisfied through this path — every
 *  catalogue `sacrificeFilter` that needs a supertype (Sunstone,
 *  Glacial Crevasses) has a real snow-land catalogue match, so it never
 *  reaches this fallback. Only covers types/subtypes/colors/isToken; an
 *  unhandled dimension surfaces as a loud assertion failure rather than
 *  silently passing (verified once by `skipReason` before this fixture is
 *  trusted). */
function syntheticSacrificeFixture(
    id: string,
    filter: PermanentFilter
): CardInstance {
    const asArray = <T>(v: T | T[] | undefined): T[] =>
        v === undefined ? [] : Array.isArray(v) ? v : [v];
    const types = asArray(filter.types);
    return {
        id,
        card: { id: "synthetic-sacrifice-fixture" },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: types.length > 0 ? types : ["Artifact"],
        subtypes: asArray(filter.subtypes),
        staticAbilities: [],
        isToken: filter.isToken ?? false,
        colorOverride: asArray(filter.colors),
    };
}

/** Which affordability shapes an ability declares (only the enumerable ones). */
function shapesOf(a: ActivatedAbility): Shape[] {
    const out: Shape[] = [];
    if (a.cost.exileFromGraveyard) out.push("exileFromGraveyard");
    if (a.cost.life !== undefined) out.push("life");
    if (a.cost.removeCounter) out.push("removeCounter");
    if (a.cost.discardFilter) out.push("discardFilter");
    // CR 602.1 / 118.8 + CR 702.122a (issue #777) — "tap untapped permanents
    // you control" (Hand of Justice's fixed three) and Crew N's total-power
    // shape both have a `getStackAbilities` gate that weighs the viewer's own
    // battlefield through `buildTriggerStateView`.
    if (a.cost.tapOtherFilter) out.push("tapOtherFilter");
    // CR 606 — a loyalty ability (signed `cost.loyalty`) has a frontend
    // affordability hint in `getStackAbilities` (once-per-turn / sorcery-speed /
    // not-below-0), so it joins the sweep (issue #700).
    if (a.cost.loyalty !== undefined) out.push("loyalty");
    // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>" (Deadapult
    // "Sacrifice a Zombie") has a `getStackAbilities` gate weighing the
    // viewer's own battlefield — the "new cost shape pays the entry fee once"
    // this sweep is built around (issue #1951 review).
    if (a.cost.sacrificeFilter) out.push("sacrificeFilter");
    return out;
}

/** True when a `useStack: false` mana ability both reaches the mana-ability
 *  menu surface (`getManaCostMenuAbility`'s own predicate: a mana cost, or no
 *  {T}/sacrifice component to tap through) and declares the one cost shape
 *  that surface gates. A tap/sacrifice mana ability without a mana cost is
 *  reached by a plain left-click `tapUntap` instead and has no menu gate to
 *  sweep. */
function isManaMenuGated(a: ActivatedAbility): boolean {
    if (!a.cost.tapOtherFilter) return false;
    return !!a.cost.mana || (!a.cost.tap && !a.cost.sacrifice);
}

/** True when the ability's payability rides on a predicate this sweep can't
 *  generically satisfy — reported as a skip rather than a failure. */
function skipReason(a: ActivatedAbility, def: CardDefinition): string | null {
    if (a.canActivate) return "canActivate predicate";
    if (
        a.cost.tapOtherFilter &&
        findMatchingPermanentCardId(a.cost.tapOtherFilter.filter) === null
    ) {
        return "no catalogue creature matches the tapOtherFilter";
    }
    if (a.cost.sacrificeFilter) {
        // A real catalogue match is preferred (`findMatchingAnyPermanentCardId`),
        // but its absence is no longer a skip: `syntheticSacrificeFixture`
        // covers a filter with no backing card definition (Caribou Range's
        // TOKEN-ONLY "Caribou" subtype). Verify the synthetic fixture
        // actually satisfies the filter once here — an unhandled filter
        // dimension (something beyond types/subtypes/supertypes/colors/
        // isToken) is the one case still worth a skip rather than a false
        // assertion.
        if (
            findMatchingAnyPermanentCardId(a.cost.sacrificeFilter) === null &&
            !matchesPermanentFilter(
                syntheticSacrificeFixture(
                    "synthetic-probe",
                    a.cost.sacrificeFilter
                ) as unknown as Parameters<typeof matchesPermanentFilter>[0],
                a.cost.sacrificeFilter,
                { selfControllerId: VIEWER }
            )
        ) {
            return "no catalogue permanent (real or synthetic) matches the sacrificeFilter";
        }
        // Self-referential sacrifice (Thopter Foundry's "sacrifice a nontoken
        // artifact" on an artifact source): the ability's OWN source is
        // always on the battlefield in this harness, so a "zero legal
        // candidates" break can't be constructed without removing the
        // ability's own home permanent — skip rather than assert an
        // unreachable HIDDEN case.
        if (
            matchesPermanentFilter(
                {
                    id: "self-probe",
                    controllerId: VIEWER,
                    types: def.types,
                    subtypes: def.subtypes ?? [],
                    supertypes: def.supertypes ?? [],
                    staticAbilities: def.staticAbilities ?? [],
                    power: def.power,
                    toughness: def.toughness,
                    isTapped: false,
                    colors: getColorsFromCost(def.manaCost),
                    // The ability's own SOURCE is a real printed permanent
                    // (cast normally), never a token itself — declaring this
                    // explicitly (rather than leaving it undefined) is what
                    // correctly fails an `isToken: true` sacrificeFilter here
                    // (Caribou Range doesn't sacrifice ITSELF, only the
                    // Caribou tokens it made) instead of masking the check.
                    isToken: false,
                },
                a.cost.sacrificeFilter,
                { selfControllerId: VIEWER }
            )
        ) {
            return "sacrificeFilter self-matches the ability's own source";
        }
    }
    if (a.getTargetRequirement) return "getTargetRequirement predicate";
    // CR 602.2b — the no-legal-target gate needs a candidate on the board. The
    // generic `targetDummy` covers every card TYPE, but not a subtype-narrowed
    // requirement ("target Goblin"), so those are an explicit skip rather than
    // a failure of the affordability gate under test.
    if (a.targetRequirement?.subtypeFilter) {
        return "subtype-narrowed targetRequirement";
    }
    return null;
}

interface Case {
    label: string;
    def: CardDefinition;
    ability: ActivatedAbility;
    shape: Shape;
}

const cases: Case[] = [];
const skips: string[] = [];

for (const def of getAllCards()) {
    for (const a of def.activatedAbilities ?? []) {
        // A `useStack: false` MANA ability is not offered by
        // `getStackAbilities` at all — its menu entry comes from
        // `getManaCostMenuAbility`, which carries exactly ONE affordability
        // gate: `tapOtherFilter` (CR 602.1 / 118.8, issue #2371). Sweeping it
        // for any other shape would assert a gate that surface does not have
        // and cannot have (a mana ability's mana leg is auto-tapped, not
        // hidden). Blanket-skipping every `!useStack` ability — which is what
        // this loop used to do — is why PR #2419 could ship a mana ability
        // whose signature cost had no client picker and no affordability gate
        // with the whole catalogue sweep still green.
        const manaMenuOffered = !a.useStack;
        if (manaMenuOffered && !isManaMenuGated(a)) continue;
        const shapes = manaMenuOffered
            ? shapesOf(a).filter((s) => s === "tapOtherFilter")
            : shapesOf(a);
        if (shapes.length === 0) continue;
        const reason = skipReason(a, def);
        if (reason) {
            skips.push(`${def.name} · ${a.id} — ${reason}`);
            continue;
        }
        for (const shape of shapes) {
            cases.push({
                label: `${def.name} · ${a.id} · ${shape}`,
                def,
                ability: a,
                shape,
            });
        }
    }
}

/** Builds the max-satisfying source + view, then applies the per-shape
 *  `break` mutation to make exactly ONE shape unaffordable. `break: false`
 *  yields the fully-affordable environment. */
function env(c: Case, broken: boolean) {
    const { ability, def, shape } = c;
    let source = makeSource(def);
    // Counters: satisfy every removeCounter gate the ability declares.
    if (ability.cost.removeCounter) {
        const { type, count } = ability.cost.removeCounter;
        const have = broken && shape === "removeCounter" ? count - 1 : count;
        source = makeSource(def, { counters: { [type]: Math.max(0, have) } });
    }
    // Loyalty (CR 606): satisfy the below-0 gate with ample loyalty and keep
    // the source on the controller's own turn (`view.activePlayerId === VIEWER`
    // below); break by setting the per-permanent once-per-turn lock so exactly
    // this shape hides (a uniform break that works for both `+N` and `-N`).
    if (ability.cost.loyalty !== undefined) {
        source = makeSource(def, {
            counters: { loyalty: 20 },
            ...(broken && shape === "loyalty"
                ? { loyaltyActivatedThisTurn: true }
                : {}),
        });
    }
    // Life: the gate is only applied when payerLife is passed.
    let payerLife = 999;
    if (ability.cost.life !== undefined && broken && shape === "life") {
        payerLife = ability.cost.life - 1;
    }
    // Graveyard: satisfy every exileFromGraveyard gate (owner-aware).
    const viewerGrave: CardInstance[] = [];
    const oppGrave: CardInstance[] = [];
    if (ability.cost.exileFromGraveyard) {
        const { count, owner } = ability.cost.exileFromGraveyard;
        const n = broken && shape === "exileFromGraveyard" ? count - 1 : count;
        for (let i = 0; i < n; i++) viewerGrave.push(gvCard(`vg${i}`, VIEWER));
        // A non-"you" cost is also payable from the viewer's own graveyard, so
        // filling the viewer's is sufficient for the surface case; the opponent
        // pile stays empty so the break (viewer < count) genuinely hides it.
        void owner;
        void oppGrave;
    }
    // Hand: satisfy every discardFilter gate (Survival of the Fittest —
    // "Discard a creature card"). `hand` here mirrors `getStackAbilities`'
    // `discardFilterHand` param — never `buildTriggerStateView`'s stripped
    // `{ length }` hand, which the gate deliberately does NOT read (issue
    // #901; a real hand contents field, mirroring the graveyard fix for
    // Grim Lavamancer).
    const hand: CardInstance[] = [];
    if (ability.cost.discardFilter) {
        const { filter, count } = ability.cost.discardFilter;
        const n = broken && shape === "discardFilter" ? count - 1 : count;
        const matchId = findMatchingCardId(filter);
        for (let i = 0; i < n; i++) hand.push(handCard(`hc${i}`, matchId));
    }
    // CR 602.1 / 118.8 + CR 702.122a — untapped matching creatures the viewer
    // controls, enough to cover the cost (`count` picks, or `totalPower` worth
    // of power). The break removes exactly one, dropping the pool below what
    // the cost demands.
    const tapHelpers: CardInstance[] = [];
    if (ability.cost.tapOtherFilter) {
        const spec = ability.cost.tapOtherFilter;
        const match = findMatchingPermanentCardId(spec.filter)!;
        const helperDef = getAllCards().find((d) => d.id === match.id)!;
        const needed =
            spec.totalPower !== undefined
                ? Math.ceil(spec.totalPower / match.power)
                : (spec.count ?? 0);
        const n = broken && shape === "tapOtherFilter" ? needed - 1 : needed;
        for (let i = 0; i < n; i++) {
            tapHelpers.push(crewHelper(`tap${i}`, match.id, helperDef));
        }
    }
    // CR 602.1 / 118.5 — one matching permanent to pay a `sacrificeFilter`
    // cost (Deadapult's "Sacrifice a Zombie"); the break removes it entirely
    // (there is no partial sacrifice — either a legal candidate exists or it
    // doesn't, CR 602.1's "illegal if no matching permanent" is a boolean
    // gate, unlike `tapOtherFilter`'s countable pool).
    const sacrificeHelpers: CardInstance[] = [];
    if (ability.cost.sacrificeFilter) {
        const matchId = findMatchingAnyPermanentCardId(
            ability.cost.sacrificeFilter
        );
        if (!(broken && shape === "sacrificeFilter")) {
            if (matchId) {
                const helperDef = getAllCards().find((d) => d.id === matchId)!;
                sacrificeHelpers.push({
                    ...crewHelper("sac0", matchId, helperDef),
                    // `findMatchingAnyPermanentCardId` matched every OTHER
                    // dimension while ignoring `isToken` (a real card
                    // definition can never itself be a token) — stamp the
                    // FIXTURE's own `isToken` to whatever the cost actually
                    // requires (Caribou Range's "Sacrifice a Caribou TOKEN"
                    // needs `isToken: true` here; the common "Sacrifice a
                    // Zombie"/"an artifact" shape needs `false`, matching a
                    // normally-cast permanent).
                    isToken: ability.cost.sacrificeFilter.isToken ?? false,
                });
            } else {
                // No backing catalogue definition (Caribou Range's
                // TOKEN-ONLY "Caribou" subtype) — the synthetic fallback,
                // verified satisfiable by `skipReason` before this point.
                sacrificeHelpers.push(
                    syntheticSacrificeFixture(
                        "sac0",
                        ability.cost.sacrificeFilter
                    )
                );
            }
        }
    }
    // The viewer's target dummy deliberately carries EVERY permanent type so
    // it satisfies any unrelated targeting requirement — which means it also
    // accidentally satisfies a plain `types`-only `sacrificeFilter`
    // (Priest of Yawgmoth's "Sacrifice an artifact" et al.), masking the
    // "zero legal candidates" break the same way an untapped dummy would
    // mask `tapOtherFilter` above. Every catalogue `sacrificeFilter.types`
    // checked here differs from its OWN ability's `targetRequirement.type`
    // (verified case by case: Sylvan Safekeeper sacrifices a Land but
    // targets a Creature; Shivan Harvest sacrifices a Creature but targets a
    // Land; Skull Catapult / Goblin Bombardment target "any", which the
    // player fallback satisfies without the dummy at all) — so it is safe to
    // drop exactly the sacrificed type(s) from the dummy without breaking
    // its OWN targeting role.
    const dummySacrificeTypes = ability.cost.sacrificeFilter?.types
        ? Array.isArray(ability.cost.sacrificeFilter.types)
            ? ability.cost.sacrificeFilter.types
            : [ability.cost.sacrificeFilter.types]
        : [];
    // CR 113.6 (issue #2235) — a graveyard-source ability's SOURCE sits in the
    // graveyard, never the battlefield (Whiteout, Ashen Ghoul): stamp its zone
    // and place it in `graveyard` rather than `battlefield` below, so the
    // fixture matches what `getGraveyardStackAbilities` actually receives from
    // the real caller (a card drawn from `player.graveyard`).
    if (ability.activateFromGraveyard) {
        source = { ...source, zone: "graveyard" };
    }
    const view = buildTriggerStateView(
        [
            {
                id: VIEWER,
                life: payerLife,
                hand: [],
                battlefield: [
                    ...(ability.activateFromGraveyard ? [] : [source]),
                    // For a tapOtherFilter case the viewer's target dummy is
                    // TAPPED: it is a legal target either way (CR 115.4 — tap
                    // state doesn't gate targeting), but an untapped one would
                    // itself be counted as a payment candidate and mask the
                    // break case.
                    {
                        ...targetDummy("dummy-you", VIEWER),
                        isTapped: ability.cost.tapOtherFilter !== undefined,
                        types: (
                            targetDummy("dummy-you", VIEWER).types ?? []
                        ).filter(
                            (t) => !dummySacrificeTypes.includes(t as never)
                        ),
                    },
                    ...tapHelpers,
                    ...sacrificeHelpers,
                ],
                graveyard: ability.activateFromGraveyard
                    ? [source, ...viewerGrave]
                    : viewerGrave,
            },
            {
                id: OPP,
                life: 20,
                hand: [],
                battlefield: [targetDummy("dummy-opp", OPP)],
                graveyard: oppGrave,
            },
        ],
        VIEWER
    );
    return { source, view, payerLife, hand };
}

/** Dispatches to the affordance a `Case`'s ability actually uses: the
 *  graveyard zone-listing helper (CR 113.6, issue #2235) for
 *  `activateFromGraveyard` abilities — `getStackAbilities` unconditionally
 *  hides those — else the ordinary battlefield helper. */
function surfacedAbilityIds(c: Case, env_: ReturnType<typeof env>): string[] {
    const { source, view, payerLife, hand } = env_;
    // CR 605.1a (issue #2371) — a `useStack: false` mana ability's own menu
    // entry comes from `getManaCostMenuAbility`, never `getStackAbilities`
    // (which hides every non-stack ability before reaching any cost gate).
    if (!c.ability.useStack) {
        const offered = getManaCostMenuAbility(source, view);
        return offered ? [offered.id] : [];
    }
    if (c.ability.activateFromGraveyard) {
        return getGraveyardStackAbilities(source, undefined, view).map(
            (x) => x.id
        );
    }
    return getStackAbilities(
        source,
        undefined,
        true,
        view,
        payerLife,
        hand
    ).map((x) => x.id);
}

describe("frontend affordability wiring — catalogue sweep", () => {
    it("exercises at least one card (guards against a vacuous sweep)", () => {
        if (cases.length === 0) {
            console.warn(
                "No activated ability with an enumerable affordability cost " +
                    "shape found in the catalogue — sweep is vacuous."
            );
        }
        expect(cases.length).toBeGreaterThan(0);
    });

    if (skips.length > 0) {
        it("reports abilities skipped for arbitrary predicates", () => {
            console.warn(
                `Affordability sweep skipped ${skips.length} predicate-gated ` +
                    `ability(ies):\n  ${skips.join("\n  ")}`
            );
            expect(skips.length).toBeGreaterThan(0);
        });
    }

    for (const c of cases) {
        describe(c.label, () => {
            it("is SURFACED when the cost is fully affordable (via buildTriggerStateView)", () => {
                const ids = surfacedAbilityIds(c, env(c, false));
                expect(ids).toContain(c.ability.id);
            });

            it("is HIDDEN when the cost shape under test is unaffordable", () => {
                const ids = surfacedAbilityIds(c, env(c, true));
                expect(ids).not.toContain(c.ability.id);
            });
        });
    }
});
