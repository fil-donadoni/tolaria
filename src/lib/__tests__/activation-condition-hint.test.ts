// CR 602.1b (issue #3685) — the client affordance for a declarative
// "Activate only if …" restriction (`ActivatedAbility.activationCondition`).
// Threshold ("seven or more cards in your graveyard") is driven through the
// REAL reducers: `buildTriggerStateView` builds the viewer's view (a dropped
// `graveyard` field would close the gate forever) and `getStackAbilities`
// weighs it through the engine's shared `activationPreconditionViolation`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition, EffectPredicate } from "@convex/cards/types";
import type { CardInstance } from "../../types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

const VIEWER = "p1";
const OPP = "p2";
const RING = getCardByName("Barbarian Ring");
const RING_SAC = "barbarian-ring-sac";

const BEARS = getCardByName("Grizzly Bears");

function instance(
    id: string,
    def: CardDefinition,
    owner: string,
    zone: CardInstance["zone"]
): CardInstance {
    return {
        id,
        card: { id: def.id },
        controllerId: owner,
        ownerId: owner,
        zone,
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
    };
}

function offered(mine: number, theirs: number): string[] {
    const ring = instance("ring", RING, VIEWER, "battlefield");
    const pile = (owner: string, n: number) =>
        Array.from({ length: n }, (_, i) =>
            instance(`${owner}-gy-${i}`, BEARS, owner, "graveyard")
        );
    const view = buildTriggerStateView(
        [
            {
                id: VIEWER,
                life: 20,
                hand: [],
                battlefield: [ring],
                graveyard: pile(VIEWER, mine),
            },
            {
                id: OPP,
                life: 20,
                hand: [],
                battlefield: [instance("bear", BEARS, OPP, "battlefield")],
                graveyard: pile(OPP, theirs),
            },
        ],
        VIEWER
    );
    return getStackAbilities(ring, "PRECOMBAT_MAIN", true, view).map(
        (a) => a.id
    );
}

describe("threshold activationCondition — client hint (CR 602.1b)", () => {
    it("hides the ability with six cards in the viewer's graveyard", () => {
        expect(offered(6, 0)).not.toContain(RING_SAC);
    });

    it("offers it with seven", () => {
        expect(offered(7, 0)).toContain(RING_SAC);
    });

    it("an opponent's seven does not open YOUR threshold (CR 109.5)", () => {
        expect(offered(0, 7)).not.toContain(RING_SAC);
    });
});

// CR 602.5 + CR 109.5 (issue #5258) — a BATTLEFIELD count ("Activate only if
// an opponent controls more lands than you", "… two or more green
// permanents"), through the same reducers: a battlefield row that dropped
// `types` or `colors` would close the gate forever.
const FOREST = getCardByName("Forest");

const OPPONENT_MORE_LANDS: EffectPredicate = {
    left: {
        count: {
            zone: "battlefield",
            controller: "opponent",
            filter: { type: ["Land"] },
        },
    },
    op: "gt",
    right: {
        count: {
            zone: "battlefield",
            controller: "controller",
            filter: { type: ["Land"] },
        },
    },
};

const OPPONENT_TWO_GREEN: EffectPredicate = {
    left: {
        count: {
            zone: "battlefield",
            controller: "opponent",
            filter: { color: ["G"] },
        },
    },
    op: "ge",
    right: 2,
};

function ringWith(activationCondition: EffectPredicate): CardDefinition {
    return {
        ...RING,
        activatedAbilities: RING.activatedAbilities!.map((a) =>
            a.id === RING_SAC ? { ...a, activationCondition } : a
        ),
    };
}

/** The viewer holds the Ring; the opponent holds `forests` Forests and
 *  `bears` Grizzly Bears. */
function offeredOnBoard(
    condition: EffectPredicate,
    forests: number,
    bears: number
): string[] {
    return withTemporaryDefinition(ringWith(condition), () => {
        const ring = instance("ring", RING, VIEWER, "battlefield");
        const many = (def: CardDefinition, n: number) =>
            Array.from({ length: n }, (_, i) =>
                instance(`${def.id}-${i}`, def, OPP, "battlefield")
            );
        const view = buildTriggerStateView(
            [
                {
                    id: VIEWER,
                    life: 20,
                    hand: [],
                    battlefield: [ring],
                    graveyard: [],
                },
                {
                    id: OPP,
                    life: 20,
                    hand: [],
                    battlefield: [
                        ...many(FOREST, forests),
                        ...many(BEARS, bears),
                    ],
                    graveyard: [],
                },
            ],
            VIEWER
        );
        return getStackAbilities(ring, "PRECOMBAT_MAIN", true, view).map(
            (a) => a.id
        );
    });
}

describe("battlefield activationCondition — client hint (CR 602.5)", () => {
    it("an opponent with as many lands as the viewer hides the ability; one more offers it", () => {
        // The viewer's Ring is its one land; the Bear is the "any target" the
        // affordance needs to see, and is no land.
        expect(offeredOnBoard(OPPONENT_MORE_LANDS, 1, 1)).not.toContain(
            RING_SAC
        );
        expect(offeredOnBoard(OPPONENT_MORE_LANDS, 2, 1)).toContain(RING_SAC);
    });

    it("a colour count reads the projected live colours (CR 105.2)", () => {
        expect(offeredOnBoard(OPPONENT_TWO_GREEN, 3, 1)).not.toContain(
            RING_SAC
        );
        expect(offeredOnBoard(OPPONENT_TWO_GREEN, 0, 2)).toContain(RING_SAC);
    });
});
