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

import { describe, it, expect } from "vitest";
import { getAllCards } from "@convex/cards";
import type {
    ActivatedAbility,
    CardDefinition,
    EffectCardFilter,
} from "@convex/cards/types";
import type { CardInstance } from "../../types/game";
import { getStackAbilities, buildTriggerStateView } from "../card-utils";

/** The activation-cost shapes with a `getStackAbilities` affordability gate
 *  that a client-side reducer (or the projection) can silently break. Scalar
 *  shapes (`life`) are included because the same "surface vs hide" contract
 *  regresses if the gate itself is ever miswired. */
type Shape = "exileFromGraveyard" | "life" | "removeCounter" | "discardFilter";

/** Finds a REAL catalogue card definition matching an `EffectCardFilter`'s
 *  `type`/`subtype` fields (the two dimensions a `discardFilter` cost is
 *  expected to use — Survival of the Fittest's "a creature card"). The
 *  `discardFilter` hand-card matcher (`handCardMatchesFilter`,
 *  `convex/gre/alternativeCost.ts`) reads a hand card's REGISTRY definition
 *  via `card.card.id`, not synthetic fields on the `CardInstance` fixture
 *  itself (unlike `PermanentFilter` matching) — so building a matching hand
 *  card means finding a real card id whose definition satisfies the filter. */
function findMatchingCardId(filter: EffectCardFilter): string {
    const asArray = <T,>(v: T | T[] | undefined): T[] | undefined =>
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

/** Which affordability shapes an ability declares (only the enumerable ones). */
function shapesOf(a: ActivatedAbility): Shape[] {
    const out: Shape[] = [];
    if (a.cost.exileFromGraveyard) out.push("exileFromGraveyard");
    if (a.cost.life !== undefined) out.push("life");
    if (a.cost.removeCounter) out.push("removeCounter");
    if (a.cost.discardFilter) out.push("discardFilter");
    return out;
}

/** True when the ability's payability rides on a predicate this sweep can't
 *  generically satisfy — reported as a skip rather than a failure. */
function skipReason(a: ActivatedAbility): string | null {
    if (a.canActivate) return "canActivate predicate";
    if (a.getTargetRequirement) return "getTargetRequirement predicate";
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
        if (!a.useStack) continue; // mana abilities aren't macro-offered
        const shapes = shapesOf(a);
        if (shapes.length === 0) continue;
        const reason = skipReason(a);
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
    const view = buildTriggerStateView(
        [
            {
                id: VIEWER,
                life: payerLife,
                hand: [],
                battlefield: [source],
                graveyard: viewerGrave,
            },
            {
                id: OPP,
                life: 20,
                hand: [],
                battlefield: [],
                graveyard: oppGrave,
            },
        ],
        VIEWER
    );
    return { source, view, payerLife, hand };
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
                const { source, view, payerLife, hand } = env(c, false);
                const ids = getStackAbilities(
                    source,
                    undefined,
                    true,
                    view,
                    payerLife,
                    hand
                ).map((x) => x.id);
                expect(ids).toContain(c.ability.id);
            });

            it("is HIDDEN when the cost shape under test is unaffordable", () => {
                const { source, view, payerLife, hand } = env(c, true);
                const ids = getStackAbilities(
                    source,
                    undefined,
                    true,
                    view,
                    payerLife,
                    hand
                ).map((x) => x.id);
                expect(ids).not.toContain(c.ability.id);
            });
        });
    }
});
