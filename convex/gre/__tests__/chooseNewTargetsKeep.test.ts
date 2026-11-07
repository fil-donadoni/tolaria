// CR 115.7d / 707.10c — "you may choose new targets": any number of the targets
// may stay "even if those targets would be illegal", beside changed ones, and a
// spell with several chosen mode instances (ADR 0094, CR 700.2c) is offered new
// targets instance by instance. Driven through the real `resolveTopOfStack`, the
// mutation's own `applyOneTargetSelection` and the legal-action list.
import { describe, expect, it } from "vitest";
import type {
    CardDefinition,
    EffectOp,
    TargetSelection,
} from "../../cards/types";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { applyOneTargetSelection } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getPlayer, requestCopyRetargetOn, resolveTopOfStack } from "../state";
import { keepableTargets } from "../pendingTargetOrigin";
import { legalActions } from "../legalActions";

const BEAR = "test-keep-bear";
const ROCK = "test-keep-rock";
registerTokenDefinition({
    id: BEAR,
    name: "Keep Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});
registerTokenDefinition({
    id: ROCK,
    name: "Keep Rock",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Artifact"],
});

function define(id: string, extra: Partial<CardDefinition>): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 1 },
        types: ["Instant"],
        ...extra,
    });
    return id;
}

const NEW_TARGETS: EffectOp[] = [
    { op: "retarget", target: { target: 0 }, chooseNew: true },
];
const REDIRECT = define("test-keep-redirect", {
    effects: NEW_TARGETS,
    targetRequirement: { type: "spell", count: 1 },
});
const TWO_CREATURES = define("test-keep-two-creatures", {
    effects: [{ op: "draw", count: 1, player: "controller" }],
    targetRequirement: { type: "Creature", count: 2 },
});
const SAME_CONTROLLER = define("test-keep-same-controller", {
    effects: [{ op: "draw", count: 1, player: "controller" }],
    targetRequirement: { type: "Creature", count: 2, sameController: true },
});
const DESTROY_FIRST: EffectOp[] = [{ op: "destroy", target: { target: 0 } }];
const CHARM = define("test-keep-charm", {
    modes: [
        {
            id: "kill",
            label: "Destroy target creature.",
            oracleText: "Destroy target creature.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: DESTROY_FIRST,
        },
        {
            id: "draw",
            label: "Draw a card.",
            oracleText: "Draw a card.",
            effects: [{ op: "draw", count: 1, player: "controller" }],
        },
        {
            id: "smash",
            label: "Destroy target artifact.",
            oracleText: "Destroy target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            effects: DESTROY_FIRST,
        },
        {
            id: "maybe",
            label: "Up to one target creature.",
            oracleText: "Destroy up to one target creature.",
            targetRequirement: { type: "Creature", count: { min: 0, max: 1 } },
            effects: DESTROY_FIRST,
        },
    ],
    modeSelection: { min: 1, max: 3, repeats: true },
});

const perm = (id: string): TargetSelection => ({ type: "permanent", id });
const pick = (id: string) =>
    ({ targetType: "permanent", targetId: id }) as const;

/** p2 owns everything on the board; the id's prefix names the card. */
function board(ids: string[]) {
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: ids.map((id) =>
                    makeInstance(id.startsWith("rock") ? ROCK : BEAR, {
                        id,
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
    });
}

/** `victimCard` aimed at `targets`, with p1's redirect resolved on top of it. */
function redirected(
    state: ReturnType<typeof board>,
    victimCard: string,
    targets: TargetSelection[],
    fields: { chosenModeIds?: string[]; modeTargetCounts?: number[] } = {}
) {
    const victim = pushSpell(state, victimCard, "p2", targets);
    Object.assign(victim, fields);
    pushSpell(state, REDIRECT, "p1", [{ type: "spell", id: victim.id }]);
    resolveTopOfStack(state);
    return victim;
}

describe("an illegal target kept beside a changed one (CR 115.7d)", () => {
    it("an artifact no longer a legal creature target stays, the legal one changes", () => {
        const state = board(["rock1", "bear1", "bear2"]);
        const victim = redirected(state, TWO_CREATURES, [
            perm("rock1"),
            perm("bear1"),
        ]);
        expect(state.pendingTarget?.kind).toBe("retarget");

        applyOneTargetSelection(state, "p1", pick("rock1"));
        applyOneTargetSelection(state, "p1", pick("bear2"));

        expect(state.pendingTarget).toBeUndefined();
        expect(victim.targets).toEqual([perm("rock1"), perm("bear2")]);
    });

    it("a target gone from its zone stays too", () => {
        const state = board(["bear1", "bear2"]);
        const victim = redirected(state, TWO_CREATURES, [
            perm("left-the-battlefield"),
            perm("bear1"),
        ]);

        applyOneTargetSelection(state, "p1", pick("left-the-battlefield"));
        applyOneTargetSelection(state, "p1", pick("bear2"));

        expect(victim.targets).toEqual([
            perm("left-the-battlefield"),
            perm("bear2"),
        ]);
    });

    it("an illegal object that is NOT a current target is still refused", () => {
        const state = board(["rock1", "rock2", "bear1", "bear2"]);
        redirected(state, TWO_CREATURES, [perm("rock1"), perm("bear1")]);
        expect(() =>
            applyOneTargetSelection(state, "p1", pick("rock2"))
        ).toThrow();
    });

    it("a kept target is kept once", () => {
        const state = board(["rock1", "bear1", "bear2"]);
        redirected(state, TWO_CREATURES, [perm("rock1"), perm("bear1")]);
        applyOneTargetSelection(state, "p1", pick("rock1"));
        expect(() =>
            applyOneTargetSelection(state, "p1", pick("rock1"))
        ).toThrow();
    });

    it("a copy's retarget keeps one the same way (CR 707.10c)", () => {
        const state = board(["rock1", "bear1", "bear2"]);
        const copy = pushSpell(state, TWO_CREATURES, "p1", [
            perm("rock1"),
            perm("bear1"),
        ]);
        requestCopyRetargetOn(state, copy);

        applyOneTargetSelection(state, "p1", pick("rock1"));
        applyOneTargetSelection(state, "p1", pick("bear2"));

        expect(copy.targets).toEqual([perm("rock1"), perm("bear2")]);
    });

    it("the legal-action list offers it, and only while it is unpicked", () => {
        const state = board(["rock1", "rock2", "bear1", "bear2"]);
        redirected(state, TWO_CREATURES, [perm("rock1"), perm("bear1")]);
        const offeredIds = () =>
            legalActions(state).flatMap((a) =>
                a.expect === "target" && a.action.kind === "select-target"
                    ? [a.action.target.id]
                    : []
            );
        expect(offeredIds().sort()).toEqual(["bear1", "bear2", "rock1"]);
        applyOneTargetSelection(state, "p1", pick("rock1"));
        expect(offeredIds().sort()).toEqual(["bear1", "bear2"]);
    });

    it("the wire carries what may stay", () => {
        const state = board(["rock1", "bear1", "bear2"]);
        redirected(state, TWO_CREATURES, [perm("rock1"), perm("bear1")]);
        expect(
            projectPublicState(state, 1, "p1").pendingTarget
                ?.keepableTargetGroups
        ).toEqual([[perm("rock1"), perm("bear1")]]);
    });

    describe("new targets must not make an unchanged one illegal", () => {
        function twoControllers() {
            const state = board(["bear1", "bear2"]);
            getPlayer(state, "p1").battlefield.push(
                makeInstance(BEAR, {
                    id: "mine",
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
            return state;
        }

        it("a kept target is refused after a new target that would break it", () => {
            const state = twoControllers();
            redirected(state, SAME_CONTROLLER, [perm("bear1"), perm("bear2")]);
            applyOneTargetSelection(state, "p1", pick("mine"));
            expect(
                keepableTargets(state, state.pendingTarget!).map((t) => t.id)
            ).toEqual([]);
            expect(() =>
                applyOneTargetSelection(state, "p1", pick("bear1"))
            ).toThrow();
        });

        it("a new target is refused after a kept target it would break", () => {
            const state = twoControllers();
            redirected(state, SAME_CONTROLLER, [perm("bear1"), perm("bear2")]);
            applyOneTargetSelection(state, "p1", pick("bear1"));
            expect(() =>
                applyOneTargetSelection(state, "p1", pick("mine"))
            ).toThrow();
        });

        it("targets that all stay owe nothing to each other, whoever controls them now", () => {
            const state = twoControllers();
            const victim = redirected(state, SAME_CONTROLLER, [
                perm("bear1"),
                perm("mine"),
            ]);
            // An alternative exists, or no offer is raised.
            expect(state.pendingTarget).toBeDefined();
            applyOneTargetSelection(state, "p1", pick("bear1"));
            applyOneTargetSelection(state, "p1", pick("mine"));
            expect(victim.targets).toEqual([perm("bear1"), perm("mine")]);
        });
    });
});

describe("several chosen mode instances are offered new targets (ADR 0094, CR 700.2c)", () => {
    it("walks each instance's group, and each instance resolves on its own target", () => {
        const state = board(["bear1", "bear2", "rock1", "rock2"]);
        const victim = redirected(
            state,
            CHARM,
            [perm("bear1"), perm("rock1")],
            { chosenModeIds: ["kill", "smash"], modeTargetCounts: [1, 1] }
        );

        expect(state.pendingTarget?.targetType).toBe("Creature");
        expect(state.pendingTarget?.count).toBe(1);
        expect(state.pendingTarget?.groupModeInstances).toEqual([0, 1]);
        applyOneTargetSelection(state, "p1", pick("bear2"));

        expect(state.pendingTarget?.targetType).toBe("Artifact");
        expect(state.pendingTarget?.count).toBe(1);
        applyOneTargetSelection(state, "p1", pick("rock2"));

        expect(state.pendingTarget).toBeUndefined();
        expect(victim.targets).toEqual([perm("bear2"), perm("rock2")]);
        expect(victim.modeTargetCounts).toEqual([1, 1]);

        resolveTopOfStack(state);
        const left = getPlayer(state, "p2").battlefield.map((c) => c.id);
        expect(left.sort()).toEqual(["bear1", "rock1"]);
    });

    it("a targetless instance keeps its zero span, whichever side of the list it is on", () => {
        const state = board(["bear1", "bear2"]);
        const victim = redirected(state, CHARM, [perm("bear1")], {
            chosenModeIds: ["draw", "kill"],
            modeTargetCounts: [0, 1],
        });
        expect(state.pendingTarget?.targetType).toBe("Creature");
        applyOneTargetSelection(state, "p1", pick("bear2"));

        expect(state.pendingTarget).toBeUndefined();
        expect(victim.targets).toEqual([perm("bear2")]);
        expect(victim.modeTargetCounts).toEqual([0, 1]);
    });

    it("a repeated mode may take the same object twice (CR 700.2d)", () => {
        const state = board(["bear1", "bear2"]);
        const victim = redirected(
            state,
            CHARM,
            [perm("bear1"), perm("bear2")],
            { chosenModeIds: ["kill", "kill"], modeTargetCounts: [1, 1] }
        );
        applyOneTargetSelection(state, "p1", pick("bear2"));
        applyOneTargetSelection(state, "p1", pick("bear2"));
        expect(victim.targets).toEqual([perm("bear2"), perm("bear2")]);
        expect(victim.modeTargetCounts).toEqual([1, 1]);
    });

    it("one instance's illegal target stays while another instance's changes", () => {
        const state = board(["rock1", "rock2", "bear1"]);
        // The artifact is no creature, so the `kill` slot can only keep it.
        const victim = redirected(
            state,
            CHARM,
            [perm("rock1"), perm("rock1")],
            { chosenModeIds: ["kill", "smash"], modeTargetCounts: [1, 1] }
        );
        applyOneTargetSelection(state, "p1", pick("rock1"));
        applyOneTargetSelection(state, "p1", pick("rock2"));
        expect(victim.targets).toEqual([perm("rock1"), perm("rock2")]);
    });

    it("a group stays within its own current targets: another instance's is not keepable", () => {
        const state = board(["rock1", "bear1", "bear2"]);
        const victim = redirected(
            state,
            CHARM,
            [perm("bear1"), perm("bear2")],
            {
                chosenModeIds: ["kill", "smash"],
                modeTargetCounts: [1, 1],
            }
        );
        applyOneTargetSelection(state, "p1", pick("bear1"));
        // `kill` holds bear1, `smash` holds bear2: bear1 is no artifact, and not
        // `smash`'s own to keep.
        expect(() =>
            applyOneTargetSelection(state, "p1", pick("bear1"))
        ).toThrow();
        applyOneTargetSelection(state, "p1", pick("bear2"));
        expect(victim.targets).toEqual([perm("bear1"), perm("bear2")]);
    });

    it("an instance that took no target is skipped, first or last, and keeps its number", () => {
        const first = board(["bear1", "bear2"]);
        const leading = redirected(first, CHARM, [perm("bear1")], {
            chosenModeIds: ["kill", "maybe"],
            modeTargetCounts: [1, 0],
        });
        applyOneTargetSelection(first, "p1", pick("bear2"));
        expect(first.pendingTarget).toBeUndefined();
        expect(leading.targets).toEqual([perm("bear2")]);
        expect(leading.modeTargetCounts).toEqual([1, 0]);

        const last = board(["bear1", "bear2"]);
        const trailing = redirected(last, CHARM, [perm("bear1")], {
            chosenModeIds: ["maybe", "kill"],
            modeTargetCounts: [0, 1],
        });
        expect(last.pendingTarget?.count).toBe(1);
        applyOneTargetSelection(last, "p1", pick("bear2"));
        expect(last.pendingTarget).toBeUndefined();
        expect(trailing.targets).toEqual([perm("bear2")]);
        expect(trailing.modeTargetCounts).toEqual([0, 1]);
    });

    it("no instance with an alternative raises nothing", () => {
        const state = board(["bear1", "rock1"]);
        redirected(state, CHARM, [perm("bear1"), perm("rock1")], {
            chosenModeIds: ["kill", "smash"],
            modeTargetCounts: [1, 1],
        });
        expect(state.pendingTarget).toBeUndefined();
    });
});
