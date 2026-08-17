// Frontend wiring for the may-pay PERMANENT leg's `action: "return"` shape
// (CR 400.7 / 118.9, ADR 0079, issue #1933).
//
// A cost leg correct in the GRE is routinely dead in the UI: the client never
// sees `GameState`, only the output of the view reducers. So every SURFACE
// assertion here drives the REAL reducer (`projectPublicState`) rather than a
// hand-built choice object — a hand-built view would mask a dropped field,
// which is exactly the bug class this file exists to catch.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    RETURN_A_LAND,
    fireReturnLegEtb,
    returnLegLand,
    returnLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayReturnLegProbe";
import { crosissCatacombs } from "@convex/cards/sets/pls/colorless";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "@convex/gre/state";
import type { PendingChoice } from "~/types/game";
import {
    mayPayCanAfford,
    mayPayCostLabel,
    mayPayPermanentAction,
    mayPayRequiredSacrifices,
    mayPaySacrificeCount,
    mayPaySacrificePickSatisfied,
    mayPaySacrificePower,
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

describe("may-pay return leg — client cost reading (CR 400.7, ADR 0079)", () => {
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

// ---------------------------------------------------------------------------
// Real Lair card, zero legal return candidates (issue #1938 fixup)
//
// The probe fixture's own filter (`{ subtypes: "Forest" }`) never exercises
// `excludeSubtypes`, so it can't catch a client gate that silently ignores
// it. This drives the REAL Planeshift Lair cost
// (`{ types: "Land", excludeSubtypes: "Lair" }`) through the same reducer
// path, on a battlefield where the Lair is the ONLY permanent — its own
// return-leg filter excludes itself, so there is no legal candidate. Server
// proof of the same scenario:
// convex/cards/sets/pls/__tests__/colorless.test.ts ("with no legal non-Lair
// land, the Lair is sacrificed..." — `canPayMayPayCost` is `false`). Before
// the fixup, the client mirror (`matchesPermanentFilter` in card-utils.ts)
// had no `excludeSubtypes` branch, so `mayPaySacrificeCount` counted the Lair
// itself as a legal candidate and `mayPayCanAfford` came back `true` — the
// Pay button enabled with nothing legal to pick, and `submitMayPay` then
// threw "Cannot pay the cost" server-side.
// ---------------------------------------------------------------------------

/** Puts a Lair's self-ETB trigger on the stack with its `triggerSourceId`
 *  set, mirroring `fireReturnLegEtb` above and `fireLairEtb` in
 *  `convex/cards/sets/pls/__tests__/colorless.test.ts` (the server-side proof
 *  for this exact scenario). */
function fireLairEtb(state: GameState, lair: CardInstanceState): void {
    state.stack.push({
        ...lair,
        zone: "stack",
        castById: lair.controllerId,
        triggeredAbilityId: crosissCatacombs.triggeredAbilities![0].id,
        triggerSourceId: lair.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: lair.id,
            controllerId: lair.controllerId,
            types: ["Land"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("may-pay return leg — real Lair card, zero legal candidates (issue #1938 fixup)", () => {
    it("mayPaySacrificeCount / mayPayCanAfford / mayPaySacrificePower agree with the server (0 / false / 0)", () => {
        const lair = makeInstance(crosissCatacombs.id, {
            id: "lair",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair] }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, lair);

        const projected = projectPublicState(state, 1, "p1");
        const choice = projected.pendingChoices![0] as PendingChoice;
        const battlefield = projected.players[0].battlefield;

        const count = mayPaySacrificeCount(choice.cost, battlefield);
        expect(count).toBe(0);
        expect(mayPaySacrificePower(choice.cost, battlefield)).toBe(0);
        expect(mayPayCanAfford(choice.cost, {}, 20, count)).toBe(false);
    });
});
