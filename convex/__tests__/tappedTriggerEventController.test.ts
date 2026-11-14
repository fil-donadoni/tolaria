// `$event.controllerId` on a PERMANENT_TAPPED trigger (ADR 0049): an Effect
// Script names "that land's controller" / "its controller" by reading the
// tapped permanent's controller off the firing event. Every case puts the
// trigger source under ONE player and the tapped permanent under the OTHER, so
// a script that fell back to the source's controller (`"controller"`) — or a
// ref that resolved to nothing — fails visibly.
//
// Both resolution paths are walked through the real engine entry points:
//   * the stack path (Psychic Venom): the trigger goes on the stack and
//     resolves through `resolveTopOfStack`;
//   * the CR 605.4a immediate path (Wild Growth, Fertile Ground): the
//     triggered mana ability resolves inside the payment tap
//     (`tapSourceIntoPayment`), and the extra mana pays for the spell being
//     cast.

import { describe, it, expect } from "vitest";
import { tapSourceIntoPayment, tryAutoCommitPendingCast } from "../game";
import { projectPublicState } from "../gameProjections";
import {
    emitPermanentTapped,
    normalizeManaCost,
    processPendingActionTriggers,
    resolveTopOfStack,
    type PendingCast,
} from "../gre/state";
import {
    forest,
    grizzlyBears,
    psychicVenom,
    wildGrowth,
} from "../cards/sets/lea/index.cards";
import { fertileGround } from "../cards/sets/usg/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../cards/__tests__/setup.helper";

/** An Aura controlled by p1, attached to a Forest p2 controls. */
function auraOnOpponentsForest(auraDefinitionId: string) {
    const host = makeInstance(forest().id, {
        id: "host-forest",
        controllerId: "p2",
        ownerId: "p2",
    });
    const aura = makeInstance(auraDefinitionId, {
        id: "aura",
        controllerId: "p1",
        ownerId: "p1",
        attachedTo: "host-forest",
    });
    const bears = makeInstance(grizzlyBears().id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
    // p2 is the active player with priority in their main phase, so the
    // creature spell they cast off the tapped land is legal (CR 302.1).
    const state = makeState({
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", { battlefield: [aura] }),
            makePlayer("p2", { battlefield: [host], hand: [bears] }),
        ],
    });
    return { state, p1: state.players[0], p2: state.players[1], host };
}

describe("PERMANENT_TAPPED $event.controllerId — the stack path (CR 603.2, CR 303.4b)", () => {
    it("Psychic Venom deals its damage to the enchanted land's controller, not the Aura's", () => {
        const { state, p1, p2, host } = auraOnOpponentsForest(
            psychicVenom().id
        );
        host.isTapped = true;
        emitPermanentTapped(state, host, false);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);

        resolveTopOfStack(state);

        expect(p2.life).toBe(18);
        expect(p1.life).toBe(20);
    });
});

describe("PERMANENT_TAPPED $event.controllerId — the triggered mana ability path (CR 605.1b, CR 605.4a)", () => {
    it("Wild Growth's {G} goes to the tapped land's controller and pays the spell that tapped it", () => {
        const { state, p1, p2, host } = auraOnOpponentsForest(wildGrowth().id);
        const pendingCast: PendingCast = {
            playerId: "p2",
            cardInstanceId: "bears",
            manaCost: normalizeManaCost(grizzlyBears().manaCost ?? {}),
            tappedLandIds: [],
        };
        state.pendingCast = pendingCast;

        tapSourceIntoPayment(
            state,
            p2,
            host,
            undefined,
            pendingCast.tappedLandIds
        );

        // CR 605.4a — resolved immediately, never on the stack: the land's {G}
        // plus Wild Growth's {G}, both in p2's pool.
        expect(state.stack).toHaveLength(0);
        expect(p2.manaPool.G).toBe(2);
        expect(p1.manaPool.G ?? 0).toBe(0);
        // Wire format: the pool the client renders carries the bonus.
        expect(projectPublicState(state, 1, "p2").players[1].manaPool.G).toBe(
            2
        );

        // The one tapped Forest pays the whole {1}{G}.
        expect(tryAutoCommitPendingCast(state, "p2")).not.toBeNull();
        expect(state.pendingCast).toBeUndefined();
    });

    it("Fertile Ground's colour pick is the tapped land's controller's, and so is the mana", () => {
        const { state, p1, p2, host } = auraOnOpponentsForest(
            fertileGround().id
        );
        host.isTapped = true;
        emitPermanentTapped(state, host, true, { G: 1 });
        processPendingActionTriggers(state);

        // CR 605.4a — the choice is made as the mana ability resolves.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        submitChoice(state, ["U"]);

        expect(p2.manaPool.U).toBe(1);
        expect(p1.manaPool.U ?? 0).toBe(0);
    });
});
