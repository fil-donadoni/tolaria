// Frontend wiring for the may-pay PERMANENT leg's `action: "return"` shape
// (CR 701.24 / 118.9, ADR 0079, issue #1933).
//
// A cost leg correct in the GRE is routinely dead in the UI: the client never
// sees `GameState`, only the output of the view reducers. So every SURFACE
// assertion here drives the REAL reducer (`projectPublicState`) rather than a
// hand-built choice object — a hand-built view would mask a dropped field,
// which is exactly the bug class this file exists to catch.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import {
    RETURN_A_LAND,
    fireReturnLegEtb,
    returnLegLand,
    returnLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayReturnLegProbe";
import type { PendingChoice } from "~/types/game";
import {
    mayPayCanAfford,
    mayPayCostLabel,
    mayPayPermanentAction,
    mayPayRequiredSacrifices,
    mayPaySacrificeCount,
    mayPaySacrificePickSatisfied,
    normalizeMayPayCost,
} from "~/lib/card-utils";
import {
    mayPayPermanentPickHint,
    mayPayPermanentPickVerb,
    pendingChoiceRoutesToBattlefield,
} from "~/lib/pending-choice-labels";

/** A board with the probe plus `extra` lands, fired to the may-pay offer and
 *  projected THROUGH the real wire reducer — the only shape the client ever
 *  actually holds. */
function projectedChoice(extra: string[]): {
    choice: PendingChoice;
    battlefield: ReturnType<
        typeof projectPublicState
    >["players"][number]["battlefield"];
} {
    const probe = returnLegProbeInstance("probe", "p1");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    probe,
                    ...extra.map((id) => returnLegLand(id, "p1")),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    fireReturnLegEtb(state, probe);
    const projected = projectPublicState(state, 1, "p1");
    return {
        choice: projected.pendingChoices![0] as PendingChoice,
        battlefield: projected.players[0].battlefield,
    };
}

describe("may-pay return leg — client cost reading (CR 701.24, ADR 0079)", () => {
    it("normalizes the projected cost onto the shared permanent leg", () => {
        const { choice } = projectedChoice(["l1"]);
        const norm = normalizeMayPayCost(choice.cost!);
        expect(norm.permanent).toEqual({ action: "return", count: 1 });
        expect(mayPayPermanentAction(choice.cost)).toBe("return");
        expect(mayPayRequiredSacrifices(choice.cost)).toBe(1);
    });

    it("labels the Pay button with the return verb, not 'sacrifice'", () => {
        expect(mayPayCostLabel(RETURN_A_LAND)).toBe("return a permanent");
        expect(
            mayPayCostLabel({
                permanent: {
                    action: "return",
                    filter: { subtypes: "Forest" },
                    count: 2,
                },
            })
        ).toBe("return 2");
        // The sibling sacrifice leg is unchanged (no behaviour drift).
        expect(
            mayPayCostLabel({
                permanent: {
                    action: "sacrifice",
                    filter: { subtypes: "Forest" },
                    count: 1,
                },
            })
        ).toBe("sacrifice");
    });

    it("counts candidates and gates affordability off the projected board", () => {
        const { choice, battlefield } = projectedChoice(["l1", "l2"]);
        // l1 + l2 match { subtypes: "Forest" }; the probe itself does not.
        const candidates = mayPaySacrificeCount(choice.cost, battlefield);
        expect(candidates).toBe(2);
        expect(mayPayCanAfford(choice.cost, {}, 20, candidates)).toBe(true);
        expect(mayPayCanAfford(choice.cost, {}, 20, 0)).toBe(false);
    });

    it("requires exactly one pick before Pay enables", () => {
        const { choice, battlefield } = projectedChoice(["l1"]);
        expect(mayPaySacrificePickSatisfied(choice.cost, [], battlefield)).toBe(
            false
        );
        expect(
            mayPaySacrificePickSatisfied(choice.cost, ["l1"], battlefield)
        ).toBe(true);
    });
});

describe("may-pay return leg — prompt wiring (issue #1933)", () => {
    it("routes clicks to the battlefield even with a single legal land", () => {
        // The engine ALWAYS opens the picker for a return leg (ADR 0079), so
        // the client must always route clicks — a `zone`-less choice would
        // leave the player with a Pay button they can never satisfy.
        const { choice } = projectedChoice(["only"]);
        expect(choice.zone).toBe("battlefield");
        expect(pendingChoiceRoutesToBattlefield(choice)).toBe(true);
        expect(choice.candidateIds).toEqual(["only"]);
    });

    it("words the pick hint with the leg's own verb", () => {
        const { choice } = projectedChoice(["l1"]);
        expect(mayPayPermanentPickVerb(choice)).toBe("return");
        expect(mayPayPermanentPickHint(choice, 0, 1)).toBe(
            "0 / 1 selected — click a permanent to return"
        );
    });

    it("still says 'sacrifice' for a sacrifice leg (no wording drift)", () => {
        const { choice } = projectedChoice(["l1"]);
        const sacrificeChoice: PendingChoice = {
            ...choice,
            permanentAction: "sacrifice",
        };
        expect(mayPayPermanentPickVerb(sacrificeChoice)).toBe("sacrifice");
        // And a pre-ADR-0079 choice with no `permanentAction` at all falls back
        // to the sacrifice wording every shipped may-pay had.
        const legacy: PendingChoice = { ...choice };
        delete legacy.permanentAction;
        expect(mayPayPermanentPickVerb(legacy)).toBe("sacrifice");
    });
});
