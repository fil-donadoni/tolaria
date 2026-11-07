// CR 701.42 / 712.4a / 508.4 / 700.2 / 603.3c (issue #8176) — the Mishra meld
// pair, walked end to end through the real attack-trigger scan, the real
// interpreter and the real projection: Mishra, Claimed by Gix drains, melds with
// an attacking Phyrexian Dragon Engine ("It enters tapped and attacking"), and
// the melded Mishra, Lost to Phyrexia announces three modes as it enters.

import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import { meldResultDefinitionId } from "../../../meld";
import { validateEffectScript } from "../../../../gre/effects/validate";
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

const MISHRA = "a469d7ec-42de-45de-9d8f-469bb979de58"; // Mishra, Claimed by Gix
const ENGINE = "e2b826be-4256-4fd6-ad4d-6c80933ee940"; // Phyrexian Dragon Engine

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
        expect(projected.pendingChoices?.[0]?.count).toBe(3);
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
    function enter(fromGraveyard: boolean, ownerId = "p1"): GameState {
        const engine = makeInstance(ENGINE, {
            id: "engine",
            controllerId: "p1",
            ownerId,
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

    it('"your graveyard": entering from an opponent\'s graveyard does not trigger', () => {
        expect(enter(true, "p2").stack).toHaveLength(0);
    });
});

describe("Mishra, Lost to Phyrexia — mode scripts", () => {
    it("every mode's Effect Script passes validation (the catalogue sweep does not reach a back face)", () => {
        const modes =
            getDefinition(meldResultDefinitionId(MISHRA))!
                .triggeredAbilities![0].modes ?? [];
        expect(modes).toHaveLength(6);
        for (const mode of modes) {
            expect(
                validateEffectScript({
                    id: mode.id,
                    name: mode.id,
                    effects: mode.effects,
                } as never),
                mode.id
            ).toEqual([]);
        }
    });

    it("the opponent mode cannot target its own controller", () => {
        const modes =
            getDefinition(meldResultDefinitionId(MISHRA))!
                .triggeredAbilities![0].modes ?? [];
        expect(modes[0].targetRequirement?.controller).toBe("opponent");
    });
});
