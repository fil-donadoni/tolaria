// NEO — white card behavior tests (ADR 0043 colour split). One describe per
// card with non-trivial behavior; GRE + wire-format coverage per
// `.claude/rules/gre-development.md`.

import { describe, it, expect } from "vitest";
import { lionSash } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { grizzlyBears } from "../../lea";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    } as StackItem);
    resolveTopOfStack(state);
}

// A non-permanent graveyard card (Instant) for the "wasn't a permanent card"
// branch of Lion Sash's first ability.
const cremateLikeInstant: CardInstanceState = {
    id: "test-instant-gy",
    card: { id: "test-lion-sash-instant" },
    types: ["Instant"],
    subtypes: [],
    staticAbilities: [],
    controllerId: "p2",
    ownerId: "p2",
    zone: "graveyard",
    isTapped: false,
};

describe("Lion Sash (CR 702.151 Reconfigure, issue #1311)", () => {
    it("{W}: exiling a permanent card from a graveyard puts a +1/+1 counter on Lion Sash", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dead = makeInstance(grizzlyBears.id, {
            id: "deadBear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-graveyard-hate",
            [{ type: "graveyard-card", id: "deadBear", playerId: "p2" }]
        );
        // Exiled, not left in the graveyard.
        expect(state.players[1].graveyard.map((c) => c.id)).not.toContain(
            "deadBear"
        );
        expect(state.players[1].exile.map((c) => c.id)).toContain("deadBear");
        const found = state.players[0].battlefield.find(
            (c) => c.id === "lion1"
        )!;
        expect(found.counters?.["+1/+1"]).toBe(1);
    });

    it("{W}: exiling a NON-permanent card does not put a counter on Lion Sash", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2", { graveyard: [cremateLikeInstant] }),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-graveyard-hate",
            [
                {
                    type: "graveyard-card",
                    id: "test-instant-gy",
                    playerId: "p2",
                },
            ]
        );
        expect(state.players[1].exile.map((c) => c.id)).toContain(
            "test-instant-gy"
        );
        const found = state.players[0].battlefield.find(
            (c) => c.id === "lion2"
        )!;
        expect(found.counters?.["+1/+1"] ?? 0).toBe(0);
    });

    it("Reconfigure attach: attaches to target creature you control and stops being a creature (CR 702.151a/b)", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-reconfigure-attach",
            [{ type: "permanent", id: "bear3" }]
        );
        const found = state.players[0].battlefield.find(
            (c) => c.id === "lion3"
        )!;
        expect(found.attachedTo).toBe("bear3");
        expect(found.types).not.toContain("Creature");
        expect(found.types).toContain("Artifact");
    });

    it("Reconfigure grants +1/+1 for each +1/+1 counter on Lion Sash to its equipped creature (pt-cda)", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion4",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 2 },
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear4",
            controllerId: "p1",
            ownerId: "p1",
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-reconfigure-attach",
            [{ type: "permanent", id: "bear4" }]
        );
        const hostAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear4"
        )!;
        expect(getEffectivePower(state, hostAfter)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(state, hostAfter)).toBe(4);

        // Wire format — the buff must survive projection (mandatory for
        // staticEffects[]).
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "bear4"
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(4);
        expect(getEffectiveToughness(projected, slimHost)).toBe(4);
    });

    it("Reconfigure unattach: clears attachedTo and restores the Creature type (CR 702.151a/b)", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-reconfigure-attach",
            [{ type: "permanent", id: "bear5" }]
        );
        resolveActivated(
            state,
            state.players[0].battlefield.find((c) => c.id === "lion5")!,
            "lion-sash-reconfigure-unattach"
        );
        const found = state.players[0].battlefield.find(
            (c) => c.id === "lion5"
        )!;
        expect(found.attachedTo).toBeUndefined();
        expect(found.types).toContain("Creature");
        const host = state.players[0].battlefield.find(
            (c) => c.id === "bear5"
        )!;
        expect(getEffectivePower(state, host)).toBe(2); // buff gone
    });

    it("the unattach ability's canActivate gates on currently being attached", () => {
        const abilities = lionSash.activatedAbilities ?? [];
        const ability = abilities.find(
            (a) => a.id === "lion-sash-reconfigure-unattach"
        )!;
        expect(ability.canActivate).toBeDefined();
        expect(
            ability.canActivate!(
                { attachedTo: undefined } as never,
                {} as never
            )
        ).toBe(false);
        expect(
            ability.canActivate!({ attachedTo: "x" } as never, {} as never)
        ).toBe(true);
    });

    it("the attach ability's getTargetRequirement excludes the CURRENT host (CR 702.151a 'another target creature')", () => {
        const abilities = lionSash.activatedAbilities ?? [];
        const ability = abilities.find(
            (a) => a.id === "lion-sash-reconfigure-attach"
        )!;
        expect(ability.getTargetRequirement).toBeDefined();
        const reqUnattached = ability.getTargetRequirement!(
            { attachedTo: undefined } as never,
            {} as never
        );
        expect(reqUnattached.excludeInstanceIds).toEqual([]);
        const reqAttached = ability.getTargetRequirement!(
            { attachedTo: "bearHost" } as never,
            {} as never
        );
        expect(reqAttached.excludeInstanceIds).toEqual(["bearHost"]);
    });

    it("checkAttachmentSBA (CR 704.5n) detaches Lion Sash in place — NOT to the graveyard — when its host stops being a creature", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion6",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear6",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-reconfigure-attach",
            [{ type: "permanent", id: "bear6" }]
        );
        // The host leaves the battlefield — an illegal attachment (CR 704.5n).
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "bear6"
        );
        checkStateBasedActions(state);
        const found = state.players[0].battlefield.find(
            (c) => c.id === "lion6"
        );
        expect(found).toBeDefined(); // still on the battlefield — NOT graveyard
        expect(found!.attachedTo).toBeUndefined();
        expect(found!.types).toContain("Creature"); // type restored on detach
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "lion6"
        );
    });

    it("Lion Sash's attach/type-remove outcome survives projection (wire format)", () => {
        const lion = makeInstance(lionSash.id, {
            id: "lion7",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear7",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "lion-sash-reconfigure-attach",
            [{ type: "permanent", id: "bear7" }]
        );
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion7"
        )!;
        expect(slimLion.attachedTo).toBe("bear7");
        expect(slimLion.types).not.toContain("Creature");
    });
});
