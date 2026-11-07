// CR 701.42 / 712.4a / 508.4 / 700.2 / 603.3c (issue #8176) — the Mishra meld
// pair, walked end to end through the real attack-trigger scan, the real
// interpreter and the real projection: Mishra, Claimed by Gix drains, melds with
// an attacking Phyrexian Dragon Engine ("It enters tapped and attacking"), and
// the melded Mishra, Lost to Phyrexia announces three modes as it enters.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../../index";
import { meldResultDefinitionId } from "../../../meld";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { projectPublicState } from "../../../../gameProjections";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";

const MISHRA = getCardByName("Mishra, Claimed by Gix").id;
const ENGINE = getCardByName("Phyrexian Dragon Engine").id;

function attacker(defId: string, id: string): CardInstanceState {
    const card = makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
    });
    card.isAttacking = true;
    return card;
}

/** p1 attacks with `attackers`; Mishra's "whenever you attack" is on the stack. */
function attackWith(attackers: CardInstanceState[]): GameState {
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: attackers, life: 20 }),
            makePlayer("p2", { life: 20 }),
        ],
        combat: {
            attackerIds: attackers.map((c) => c.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    state.pendingEvents = [
        {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: attackers.map((c) => c.id),
        } as never,
    ];
    processPendingActionTriggers(state);
    return state;
}

describe("Mishra, Claimed by Gix — attack drain and meld (CR 701.42, 508.4)", () => {
    it("both attacking: drains X = attackers, melds into Mishra, Lost to Phyrexia tapped and attacking", () => {
        const state = attackWith([
            attacker(MISHRA, "mishra"),
            attacker(ENGINE, "engine"),
        ]);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(22);
        const bf = state.players[0].battlefield;
        expect(bf).toHaveLength(1);
        expect(bf[0].meldedFrom).toHaveLength(2);
        expect(bf[0].isTapped).toBe(true);
        expect(bf[0].isAttacking).toBe(true);

        const slim = projectPublicState(state, 1, "p2").players[0]
            .battlefield[0];
        expect(slim.card).toEqual({ id: meldResultDefinitionId(MISHRA) });
        expect(getDefinition(meldResultDefinitionId(MISHRA))?.name).toBe(
            "Mishra, Lost to Phyrexia"
        );
    });

    it("the melded Mishra announces three modes as it enters (CR 700.2, 603.3c)", () => {
        const state = attackWith([
            attacker(MISHRA, "mishra"),
            attacker(ENGINE, "engine"),
        ]);
        resolveTopOfStack(state);
        processPendingActionTriggers(state);

        const choice = state.pendingChoices?.[0];
        expect(choice).toBeDefined();
        expect(choice!.kind).toBe("trigger-mode");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingChoices?.[0]?.options).toHaveLength(6);
    });

    it("the Engine is not attacking: drains, but nothing melds", () => {
        const engine = attacker(ENGINE, "engine");
        engine.isAttacking = false;
        const state = attackWith([attacker(MISHRA, "mishra"), engine]);
        resolveTopOfStack(state);

        expect(state.players[1].life).toBe(19);
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "engine",
            "mishra",
        ]);
    });

    it("Mishra is not attacking: no meld", () => {
        const mishra = attacker(MISHRA, "mishra");
        mishra.isAttacking = false;
        const state = attackWith([mishra, attacker(ENGINE, "engine")]);
        resolveTopOfStack(state);

        expect(state.players[0].battlefield).toHaveLength(2);
    });
});

describe("Phyrexian Dragon Engine — enters from your graveyard (CR 603.2)", () => {
    function enter(fromGraveyard: boolean): GameState {
        const engine = makeInstance(ENGINE, {
            id: "engine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [engine],
                    hand: [makeInstance(MISHRA, { id: "h1" })],
                }),
                makePlayer("p2"),
            ],
        });
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "engine",
                controllerId: "p1",
                types: ["Artifact", "Creature"],
                enteredFromGraveyard: fromGraveyard,
            } as never,
        ];
        processPendingActionTriggers(state);
        return state;
    }

    it("entering from the graveyard triggers; entering from anywhere else does not", () => {
        expect(enter(true).stack).toHaveLength(1);
        expect(enter(false).stack).toHaveLength(0);
    });
});
