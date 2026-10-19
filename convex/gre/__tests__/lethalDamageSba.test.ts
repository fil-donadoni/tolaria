import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { checkStateBasedActions } from "../sba";
import { drainAutoPasses } from "../phases";
import { scorchingLava } from "../../cards/sets/inv/red.cards";
import { incinerate } from "../../cards/sets/ice/red.cards";
import { giantGrowth, grizzlyBears } from "../../cards/sets/lea/green.cards";
import { hillGiant, lightningBolt } from "../../cards/sets/lea/red.cards";

/**
 * CR 704.3 / 704.5g (issue #5784) — a resolving spell only MARKS lethal damage;
 * the creature is destroyed by the state-based action check that follows the
 * resolution, so a rider later in the same Effect Script ("can't be
 * regenerated", "if it would die this turn, exile it instead") already applies
 * to that death. Each case resolves through `resolveTopOfStack` and then runs
 * the SBA check the engine performs before priority.
 */

function boardWith(
    cardId: string,
    overrides: Parameters<typeof makeInstance>[1] = {}
): GameState {
    const victim = makeInstance(cardId, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
        ...overrides,
    });
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", { battlefield: [victim] }),
        ],
    });
}

function zoneOf(state: GameState, id: string): string | undefined {
    const p2 = state.players[1];
    if (p2.battlefield.some((c) => c.id === id)) return "battlefield";
    if (p2.graveyard.some((c) => c.id === id)) return "graveyard";
    if (p2.exile.some((c) => c.id === id)) return "exile";
    return undefined;
}

function castAtVictim(state: GameState, cardId: string, kicked = false) {
    const item = pushSpell(state, cardId, "p1", [
        { type: "permanent", id: "victim" },
    ]);
    if (kicked) item.kickerPayments = { kicker: 1 };
    resolveTopOfStack(state);
}

describe("lethal spell damage dies at the SBA check, after the whole script (CR 704.3 / 704.5g)", () => {
    it("kicked Scorching Lava on a 2/2 — exiled, the graveyard stays empty (CR 614.1a)", () => {
        const state = boardWith(grizzlyBears().id);
        castAtVictim(state, scorchingLava().id, true);
        // Mid-resolution nothing has died yet: the damage is only marked.
        expect(zoneOf(state, "victim")).toBe("battlefield");
        checkStateBasedActions(state);
        expect(zoneOf(state, "victim")).toBe("exile");
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("kicked Scorching Lava on a shielded 2/2 — exiled, the Regenerate shield is not applied (CR 701.19c)", () => {
        const state = boardWith(grizzlyBears().id, { regenerationShields: 1 });
        castAtVictim(state, scorchingLava().id, true);
        checkStateBasedActions(state);
        expect(zoneOf(state, "victim")).toBe("exile");
    });

    it("unkicked Scorching Lava on a 2/2 — graveyard, as usual", () => {
        const state = boardWith(grizzlyBears().id);
        castAtVictim(state, scorchingLava().id, false);
        checkStateBasedActions(state);
        expect(zoneOf(state, "victim")).toBe("graveyard");
    });

    it("Incinerate on a shielded 3-toughness creature — graveyard, not regenerated (CR 701.19c)", () => {
        const state = boardWith(hillGiant().id, { regenerationShields: 1 });
        castAtVictim(state, incinerate().id);
        checkStateBasedActions(state);
        expect(zoneOf(state, "victim")).toBe("graveyard");
    });

    it("an auto-passed run of resolutions checks SBAs between them — the Bolted 2/2 is gone before Giant Growth resolves (CR 704.3, 608.2b)", () => {
        const state = boardWith(grizzlyBears().id);
        // Bottom: Giant Growth on the Bears; top: Lightning Bolt on the Bears.
        pushSpell(state, giantGrowth().id, "p2", [
            { type: "permanent", id: "victim" },
        ]);
        pushSpell(state, lightningBolt().id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        state.autoPassPlayers = ["p1", "p2"];
        drainAutoPasses(state);
        // Without the check between the two resolutions Giant Growth would
        // resolve onto a 2/2 with 3 damage marked and leave a surviving 5/5.
        expect(zoneOf(state, "victim")).toBe("graveyard");
    });
});
