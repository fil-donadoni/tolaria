// Myriad (CR 702.116): the `getDefinition` expansion seam, the trigger scan
// off a real `ATTACKERS_DECLARED` emission, resolution through
// `resolveTopOfStack`, the wire projection, and the compiler's verdict on a
// printed and on a granted myriad.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import type { GameState } from "../../../gre/state";
import { resolveTopOfStack } from "../../../gre/state";
import { validateAbilityEffectScript } from "../../../gre/effects/validate";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { oracleCard } from "../../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../../oracle/compile";
import { getDefinition, preloadDefinitions } from "../..";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../__tests__/setup.helper";
import type { CardDefinition } from "../../types";
import {
    MYRIAD_ORACLE_TEXT,
    MYRIAD_TRIGGER_ID,
    myriadTrigger,
} from "../myriad";

/** Registers a creature so `getDefinition` runs it through the real expansion
 *  chain, the seam a printed card uses. */
function registerCreature(id: string, staticAbilities: string[]): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "common",
            manaCost: { X: 3 },
            types: ["Creature"],
            subtypes: [],
            power: 3,
            toughness: 3,
            staticAbilities,
        } as CardDefinition,
    ]);
    return id;
}

const MYRIAD = registerCreature("synthetic-myriad", ["myriad"]);
const DOUBLE_MYRIAD = registerCreature("synthetic-double-myriad", [
    "myriad",
    "myriad",
]);
const VANILLA = registerCreature("synthetic-myriad-vanilla", []);

function boardWith(attackerCardId: string, bystanderCardId: string): GameState {
    const permanent = (id: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    permanent("atk", attackerCardId),
                    permanent("idle", bystanderCardId),
                ],
            }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function declareAttackers(state: GameState): void {
    const triggers = collectTriggers(state, [
        {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: state.activePlayerId,
            attackerIds: [...state.combat!.attackerIds],
        },
    ]);
    placeTriggersOnStack(state, triggers);
}

describe("Myriad — the attack trigger in a two-player game (CR 702.116a)", () => {
    it("expands the bare string into one attack trigger", () => {
        const triggered = getDefinition(MYRIAD).triggeredAbilities ?? [];
        expect(triggered.map((t) => t.id)).toEqual([MYRIAD_TRIGGER_ID]);
        expect(triggered[0].oracleText).toBe(MYRIAD_ORACLE_TEXT);
    });

    it("passes the catalogue-wide ability script validator", () => {
        expect(
            validateAbilityEffectScript(
                myriadTrigger(),
                "Myriad",
                "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });

    it("goes on the stack when the creature attacks (CR 603.3)", () => {
        const state = boardWith(MYRIAD, VANILLA);
        declareAttackers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(MYRIAD_TRIGGER_ID);
        expect(state.stack[0].controllerId).toBe("p1");
    });

    it("does not trigger when another creature attacks", () => {
        const state = boardWith(VANILLA, MYRIAD);
        declareAttackers(state);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves creating no token: no opponent other than defending player (CR 506.2)", () => {
        const state = boardWith(MYRIAD, VANILLA);
        declareAttackers(state);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "atk",
            "idle",
        ]);
        expect(state.combat!.attackerIds).toEqual(["atk"]);
    });

    it("reaches the client as a stack object", () => {
        const state = boardWith(MYRIAD, VANILLA);
        declareAttackers(state);
        const view = projectPublicState(state, 0, "p2");
        expect(view.stack).toHaveLength(1);
        expect(view.stack[0].triggeredAbilityId).toBe(MYRIAD_TRIGGER_ID);
    });
});

describe("Myriad — multiple instances trigger separately (CR 702.116b)", () => {
    it("two instances put two objects on the stack, each resolving alone", () => {
        const state = boardWith(DOUBLE_MYRIAD, VANILLA);
        declareAttackers(state);
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Myriad — the compiler's verdict (ADR 0105)", () => {
    it("releases a printed myriad, carrying the keyword the seam expands", () => {
        const outcome = compileCard(
            oracleCard({ oracleText: `Haste\n${MYRIAD_ORACLE_TEXT}` })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual(["haste", "myriad"]);
    });

    it("keeps a granted myriad in quarantine: a grant never reaches the expander", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Enchantment",
                manaCost: "{4}{W}{W}",
                power: undefined,
                toughness: undefined,
                oracleText: "Creatures you control have myriad.",
            })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toEqual([
            "ungrantable-keyword",
        ]);
    });
});
