// Unearth (CR 702.84, issue #8165) through the real activation core: the
// graveyard activation and its timing, haste, the delayed exile at the next end
// step and the exile replacement on every departure path, plus the CR 400.7 /
// 603.7c cases where the object the script bound is no longer the same object.

import { describe, expect, it } from "vitest";
import { preloadDefinitions } from "../../cards";
import { unearthAbility } from "../../cards/abilities/unearth";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { activateAbilityOnState } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";
import { finalizeCleanup, fireDelayedTriggers } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    moveCard,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
} from "../state";

const UNEARTHER_ID = "00000000-0000-4000-8000-000081650001";
const SCRATCH_SPELL_ID = "00000000-0000-4000-8000-000081650002";
const ability = unearthAbility({ B: 1 });

preloadDefinitions([
    {
        id: UNEARTHER_ID,
        name: "Synthetic Unearther",
        rarity: "common",
        manaCost: { generic: 1, B: 1 },
        types: ["Creature"],
        subtypes: ["Zombie"],
        power: 2,
        toughness: 1,
        activatedAbilities: [ability],
    } as CardDefinition,
    {
        id: SCRATCH_SPELL_ID,
        name: "Synthetic Scratch Spell",
        rarity: "common",
        manaCost: {},
        types: ["Instant"],
        effects: [],
    } as CardDefinition,
]);

const CARD = "unearther";

function graveyardScenario(
    overrides: { phase?: GameState["phase"]; black?: number } = {}
): GameState {
    return makeState({
        phase: overrides.phase ?? "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                graveyard: [
                    makeInstance(UNEARTHER_ID, {
                        id: CARD,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    }),
                ],
                manaPool: {
                    W: 0,
                    U: 0,
                    B: overrides.black ?? 1,
                    R: 0,
                    G: 0,
                    C: 0,
                },
            }),
            makePlayer("p2"),
        ],
    });
}

function activate(state: GameState, playerId = "p1"): void {
    activateAbilityOnState(state, {
        playerId,
        cardInstanceId: CARD,
        abilityId: ability.id,
        keepPriority: true,
    });
}

function unearthed(): GameState {
    const state = graveyardScenario();
    activate(state);
    resolveTopOfStack(state);
    return state;
}

/** Puts the card back on the battlefield through the real reanimation funnel,
 *  from inside a resolving spell on top of the stack. */
function returnFrom(state: GameState, zone: "graveyard" | "exile"): void {
    const scratch = pushSpell(state, SCRATCH_SPELL_ID, "p1");
    expect(
        buildSpellContext(state, scratch).returnToBattlefield("p1", CARD, zone)
    ).toBe(true);
    state.stack.pop();
}

const zoneOf = (state: GameState) => {
    const p1 = state.players[0];
    for (const zone of ["battlefield", "graveyard", "exile", "hand"] as const) {
        if (p1[zone].some((c) => c.id === CARD)) return zone;
    }
    if (p1.library.some((c) => c.id === CARD)) return "library";
    return undefined;
};

const permanent = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === CARD);

describe("Unearth — the activation (CR 702.84a)", () => {
    it("stays in the graveyard while the ability is on the stack, then returns", () => {
        const state = graveyardScenario();
        activate(state);
        expect(state.stack).toHaveLength(1);
        expect(state.players[0].manaPool.B).toBe(0);
        expect(zoneOf(state)).toBe("graveyard");
        resolveTopOfStack(state);
        expect(zoneOf(state)).toBe("battlefield");
    });

    it("is illegal outside a sorcery window (CR 307.5)", () => {
        const state = graveyardScenario({ phase: "DECLARE_ATTACKERS" });
        expect(() => activate(state)).toThrow("Activate only as a sorcery");
        expect(state.stack).toHaveLength(0);
    });

    it("is illegal from an opponent's graveyard", () => {
        const state = graveyardScenario();
        state.priorityPlayerId = "p2";
        expect(() => activate(state, "p2")).toThrow("You do not own this card");
    });

    it("is illegal from the battlefield", () => {
        const state = graveyardScenario();
        const [card] = state.players[0].graveyard.splice(0, 1);
        card.zone = "battlefield";
        state.players[0].battlefield.push(card);
        expect(() => activate(state)).toThrow(
            "can't be activated from the battlefield"
        );
    });

    it("does nothing when the card left the graveyard in response (CR 400.7)", () => {
        const state = graveyardScenario();
        activate(state);
        moveCard(state.players[0], CARD, "graveyard", "exile");
        resolveTopOfStack(state);
        expect(zoneOf(state)).toBe("exile");
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("leaves alone a card that reached the battlefield in response: a new object (CR 400.7)", () => {
        const state = graveyardScenario();
        activate(state);
        returnFrom(state, "graveyard");
        resolveTopOfStack(state);
        const perm = permanent(state);
        expect(perm).toBeDefined();
        expect(perm!.staticAbilities ?? []).not.toContain("haste");
        expect(perm!.exileOnLeave).toBeUndefined();
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});

describe("Unearth — haste (CR 702.84a)", () => {
    it("gains haste, visible through the projection to both viewers", () => {
        const state = unearthed();
        for (const viewer of ["p1", "p2"]) {
            const slim = projectPublicState(
                state,
                1,
                viewer
            ).players[0].battlefield.find((c) => c.id === CARD);
            expect(slim?.staticAbilities).toContain("haste");
        }
    });

    it("keeps haste past the end of the turn when the delayed exile never happens", () => {
        const state = unearthed();
        finalizeCleanup(state);
        expect(permanent(state)!.staticAbilities).toContain("haste");
    });
});

describe("Unearth — the delayed exile (CR 603.7)", () => {
    it("exiles it at the beginning of the next end step", () => {
        const state = unearthed();
        expect(state.delayedTriggers).toHaveLength(1);
        fireDelayedTriggers(state, "next-end-step");
        expect(zoneOf(state)).toBe("battlefield");
        resolveTopOfStack(state);
        expect(zoneOf(state)).toBe("exile");
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("survives persistence: the snapshot carries the trigger and the replacement", () => {
        const state = expandState(compactState(unearthed()));
        expect(permanent(state)!.exileOnLeave).toBe(true);
        expect(permanent(state)!.staticAbilities).toContain("haste");
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(zoneOf(state)).toBe("exile");
    });

    it("does not follow a blink: the returned object is new (CR 603.7c / 400.7)", () => {
        const state = unearthed();
        removePermanentTo(state, CARD, "exile");
        returnFrom(state, "exile");
        const back = permanent(state);
        expect(back).toBeDefined();
        expect(back!.staticAbilities ?? []).not.toContain("haste");
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(zoneOf(state)).toBe("battlefield");
    });
});

describe("Unearth — the exile replacement (CR 614.1a)", () => {
    it.each(["graveyard", "hand", "library"] as const)(
        "a departure to the %s lands in exile instead",
        (to) => {
            const state = unearthed();
            expect(removePermanentTo(state, CARD, to)?.zone).toBe("exile");
            expect(zoneOf(state)).toBe("exile");
        }
    );

    it("a sacrifice and a destruction land in exile instead", () => {
        for (const cause of ["sacrifice", "destroy"] as const) {
            const state = unearthed();
            removePermanentTo(state, CARD, "graveyard", cause);
            expect(zoneOf(state)).toBe("exile");
        }
    });

    it("ends with the object: a card returned from exile later leaves normally (CR 400.7)", () => {
        const state = unearthed();
        removePermanentTo(state, CARD, "graveyard");
        expect(zoneOf(state)).toBe("exile");
        returnFrom(state, "exile");
        expect(permanent(state)!.exileOnLeave).toBeUndefined();
        removePermanentTo(state, CARD, "graveyard");
        expect(zoneOf(state)).toBe("graveyard");
    });
});

describe("the exileOnLeave Op (CR 614.1a)", () => {
    const host = (effects: unknown) =>
        ({ id: "op-host", name: "Op Host", effects }) as never;

    it("validates a selector and refuses a missing one", () => {
        expect(
            validateEffectScript(
                host([{ op: "exileOnLeave", target: { target: 0 } }])
            )
        ).toEqual([]);
        expect(
            validateEffectScript(host([{ op: "exileOnLeave" }])).length
        ).toBeGreaterThan(0);
    });
});
