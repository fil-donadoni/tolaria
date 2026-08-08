// Per-card behavior tests for blue cards in `convex/cards/sets/arn/blue.ts`
// (ARN, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (effective P/T, damage, zone, combat outcome).

import { describe, it, expect } from "vitest";
import {
    dandan,
    fishliverOil,
    giantTortoise,
    islandFishJasconius,
    moorishCavalry,
    oldManOfTheSea,
    serendibDjinn,
    serendibEfreet,
    unstableMutation,
} from "..";
import { grizzlyBears, island, mountain } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { resolveTopOfStack, type StackItem } from "../../../../gre/state";
import {
    resolveActivated,
    resolveTrigger,
    answerChoice,
    upkeepEvent,
} from "./helpers";

describe("Serendib Efreet (flying + upkeep: 1 damage to you)", () => {
    it("has flying and pings its controller", () => {
        expect(serendibEfreet.staticAbilities).toContain("flying");
        const efreet = makeInstance(serendibEfreet.id, { id: "eff" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [efreet] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            efreet,
            "serendib-efreet-upkeep",
            upkeepEvent("p1")
        );
        expect(state.players[0].life).toBe(19);
    });
});

describe("Serendib Djinn (upkeep: sac a land, Island → 3 damage)", () => {
    it("dealing 3 when the sacrificed land is an Island", () => {
        const djinn = makeInstance(serendibDjinn.id, { id: "djinn" });
        const isl = makeInstance(island.id, { id: "isl" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn, isl] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            djinn,
            "serendib-djinn-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["isl"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "isl")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(17); // 20 - 3 (Island)
    });
    it("no damage when the sacrificed land is not an Island", () => {
        const djinn = makeInstance(serendibDjinn.id, { id: "djinn" });
        const mtn = makeInstance(mountain.id, { id: "mtn" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn, mtn] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            djinn,
            "serendib-djinn-upkeep",
            upkeepEvent("p1")
        );
        answerChoice(state, ["mtn"]);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Dandân (can't attack unless defender has Island; no Islands → sac)", () => {
    it("sacrifices itself when controller has no Islands", () => {
        const dd = makeInstance(dandan.id, { id: "dd" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dd] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, dd, "dandan-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
    it("survives the state-trigger while it controls an Island", () => {
        const dd = makeInstance(dandan.id, { id: "dd" });
        const isl = makeInstance(island.id, { id: "isl" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dd, isl] }),
                makePlayer("p2"),
            ],
        });
        // Intervening-if re-check fizzles the trigger: Dandân stays.
        resolveTrigger(state, dd, "dandan-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dd")
        ).toBeDefined();
    });
});

describe("Island Fish Jasconius (does-not-untap + pay {U}{U}{U} to untap)", () => {
    it("paying {U}{U}{U} on upkeep untaps it", () => {
        const fish = makeInstance(islandFishJasconius.id, {
            id: "fish",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fish] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 };
        resolveTrigger(
            state,
            fish,
            "island-fish-untap-option",
            upkeepEvent("p1")
        );
        answerChoice(state, ["yes"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "fish")!.isTapped
        ).toBe(false);
    });
});

describe("Giant Tortoise (+0/+3 while untapped, CR 613)", () => {
    it("is 1/4 untapped and 1/1 tapped (GRE + wire)", () => {
        const tortoise = makeInstance(giantTortoise.id, { id: "tort" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tortoise] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectiveToughness(state, tortoise)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tort"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);

        tortoise.isTapped = true;
        expect(getEffectiveToughness(state, tortoise)).toBe(1);
    });
});

describe("Unstable Mutation (aura +3/+3 + upkeep -1/-1 counter)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const aura = makeInstance(unstableMutation.id, {
            id: "aura",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, bear, aura };
    }
    it("grants +3/+3 to the host (GRE + wire)", () => {
        const { state, bear } = setup();
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(5);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
    });
    it("puts a -1/-1 counter on the host each upkeep", () => {
        const { state, aura } = setup();
        resolveTrigger(
            state,
            aura,
            "unstable-mutation-decay",
            upkeepEvent("p1")
        );
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.counters?.["-1/-1"]).toBe(1);
        // 2/2 base + 3/3 aura - 1/1 counter = 4/4
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });
});

describe("Old Man of the Sea ({T}: steal a creature with power <= its own while tapped)", () => {
    it("gains control while tapped and reverts when it untaps", () => {
        const old = makeInstance(oldManOfTheSea.id, {
            id: "old",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [old] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Activation taps Old Man (cost {T}); resolveActivated assumes the cost
        // was paid, so tap the source to model the condition.
        old.isTapped = true;
        resolveActivated(state, old, "old-man-of-the-sea-steal", [
            { type: "permanent", id: "bear" },
        ]);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p1");

        // Old Man untaps → "remains tapped" lapses → control reverts.
        state.players[0].battlefield.find((c) => c.id === "old")!.isTapped =
            false;
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");
    });

    it("only creatures with power <= its own are legal targets", () => {
        const old = makeInstance(oldManOfTheSea.id, { id: "old" });
        const small = makeInstance(grizzlyBears.id, { id: "small" }); // 2/2
        const big = makeInstance(moorishCavalry.id, { id: "big" }); // 3/3
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [old, small, big] }),
                makePlayer("p2"),
            ],
        });
        const req = oldManOfTheSea.activatedAbilities![0].getTargetRequirement!(
            { ...old } as never,
            state as never
        );
        const legal = getLegalTargets(
            state,
            req,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("small");
        expect(legal).not.toContain("big");
    });
});

describe("Fishliver Oil (Aura keyword-grant → islandwalk, CR 611 + 702.13i)", () => {
    it("grants islandwalk to the host; the host becomes unblockable only once the defender controls an Island", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, fishliverOil.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain("islandwalk");

        // Defender has no Island — islandwalk grants nothing yet, still blockable.
        const blockerNoIsland = makeInstance(grizzlyBears.id, {
            id: "blk-no-isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        expect(
            validateBlockerEligibility(bearAfter, blockerNoIsland, [
                blockerNoIsland,
            ]).eligible
        ).toBe(true);

        // Defender controls an Island — islandwalk makes the host unblockable
        // (CR 702.13i / 509.1b).
        const isl = makeInstance(island.id, {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blockerWithIsland = makeInstance(grizzlyBears.id, {
            id: "blk-isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        expect(
            validateBlockerEligibility(bearAfter, blockerWithIsland, [
                blockerWithIsland,
                isl,
            ]).eligible
        ).toBe(false);
    });

    it("wire format: the islandwalk grant and its unblockable consequence survive projectPublicState", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, fishliverOil.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const isl = makeInstance(island.id, {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(isl, blocker);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        const slimBlocker = projected.players[1].battlefield.find(
            (c) => c.id === "blk"
        )!;
        const slimIsl = projected.players[1].battlefield.find(
            (c) => c.id === "isl"
        )!;
        expect(slimBear.staticAbilities).toContain("islandwalk");
        expect(
            validateBlockerEligibility(slimBear, slimBlocker, [
                slimBlocker,
                slimIsl,
            ]).eligible
        ).toBe(false);
    });
});
