// CR 602.1b (issue #3685) — the client affordance for a declarative
// "Activate only if …" restriction (`ActivatedAbility.activationCondition`).
// Threshold ("seven or more cards in your graveyard") is driven through the
// REAL reducers: `buildTriggerStateView` builds the viewer's view (a dropped
// `graveyard` field would close the gate forever) and `getStackAbilities`
// weighs it through the engine's shared `activationPreconditionViolation`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
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
