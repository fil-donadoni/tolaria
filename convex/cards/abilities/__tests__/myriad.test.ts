// Myriad (CR 702.116): the trigger off the live keyword multiset, printed or
// granted, scanned from a real `ATTACKERS_DECLARED` emission, resolution through
// `resolveTopOfStack`, the wire projection, and the compiler's verdict on a
// printed and on a granted myriad.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../../gameProjections";
import { expandState, compactState } from "../../../gre/serialize";
import type { CardInstanceState, GameState } from "../../../gre/state";
import {
    beginApplyingStaticEffects,
    buildSpellContext,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../gre/state";
import { validateAbilityEffectScript } from "../../../gre/effects/validate";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { oracleCard } from "../../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../../oracle/compile";
import { getDefinition, preloadDefinitions } from "../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup.helper";
import type { CardDefinition, PermanentView } from "../../types";
import {
    MYRIAD_KEYWORD,
    MYRIAD_ORACLE_TEXT,
    MYRIAD_TRIGGER,
    MYRIAD_TRIGGER_ID,
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

const MYRIAD_ANTHEM = "synthetic-myriad-anthem";
preloadDefinitions([
    {
        id: MYRIAD_ANTHEM,
        name: "Synthetic Myriad Anthem",
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Artifact"],
        staticEffects: [
            {
                kind: "keyword-grant",
                applies: (target: PermanentView) =>
                    target.types.includes("Creature"),
                keyword: MYRIAD_KEYWORD,
            },
        ],
    } as CardDefinition,
]);

function permanent(id: string, cardId: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
}

function boardWith(
    attackerCardId: string,
    bystanderCardId: string,
    extra: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    permanent("atk", attackerCardId),
                    permanent("idle", bystanderCardId),
                    ...extra,
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

function attacker(state: GameState): CardInstanceState {
    return state.players[0].battlefield.find((c) => c.id === "atk")!;
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

/** Static grants from `count` anthems, each applied through the real seam. */
function boardWithAnthems(count: number): GameState {
    const anthems = Array.from({ length: count }, (_, i) =>
        permanent(`anthem-${i}`, MYRIAD_ANTHEM)
    );
    const state = boardWith(VANILLA, VANILLA, anthems);
    for (const anthem of anthems) beginApplyingStaticEffects(state, anthem);
    return state;
}

describe("Myriad — the attack trigger in a two-player game (CR 702.116a)", () => {
    it("is no definition's ability: the trigger reads the live multiset", () => {
        const def = getDefinition(MYRIAD);
        expect(def.staticAbilities).toEqual(["myriad"]);
        expect(def.triggeredAbilities ?? []).toEqual([]);
    });

    it("passes the catalogue-wide ability script validator", () => {
        expect(
            validateAbilityEffectScript(
                MYRIAD_TRIGGER,
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

    it("two static grants are two instances", () => {
        const state = boardWithAnthems(2);
        declareAttackers(state);
        expect(state.stack).toHaveLength(2);
    });

    it("a grant on a printed myriad is a second instance", () => {
        const anthem = permanent("anthem-0", MYRIAD_ANTHEM);
        const state = boardWith(MYRIAD, VANILLA, [anthem]);
        beginApplyingStaticEffects(state, anthem);
        declareAttackers(state);
        expect(state.stack).toHaveLength(2);
    });
});

describe("Myriad — a granted instance (CR 702.116a)", () => {
    it("a static grant puts the trigger on the stack, and it resolves doing nothing", () => {
        const state = boardWithAnthems(1);
        expect(attacker(state).staticAbilities).toContain("myriad");
        declareAttackers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(MYRIAD_TRIGGER_ID);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].battlefield).toHaveLength(3);
    });

    it("a one-shot grant makes the creature trigger when it attacks", () => {
        const state = boardWith(VANILLA, VANILLA);
        const ctx = buildSpellContext(state, pushSpell(state, VANILLA, "p1"));
        ctx.grantStaticAbilityPermanent(
            { type: "permanent", id: "atk" },
            "myriad"
        );
        state.stack.length = 0;
        declareAttackers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(MYRIAD_TRIGGER_ID);
    });

    it("a creature that lost all its abilities does not trigger (CR 613.1f)", () => {
        const state = boardWith(MYRIAD, VANILLA);
        const ctx = buildSpellContext(state, pushSpell(state, VANILLA, "p1"));
        ctx.loseAllAbilities({ type: "permanent", id: "atk" });
        state.stack.length = 0;
        declareAttackers(state);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves independently of its source once on the stack (CR 113.7a)", () => {
        const state = boardWithAnthems(1);
        declareAttackers(state);
        removePermanentTo(state, "atk", "graveyard");
        expect(state.stack).toHaveLength(1);
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(0);
    });

    it("survives the save between going on the stack and resolving", () => {
        const state = boardWithAnthems(1);
        declareAttackers(state);
        const restored = expandState(compactState(state));
        expect(restored.stack[0].triggeredAbilityId).toBe(MYRIAD_TRIGGER_ID);
        expect(resolveTopOfStack(restored)).not.toBeNull();
        expect(restored.stack).toHaveLength(0);
    });

    it("the granted keyword and its trigger reach the client", () => {
        const state = boardWithAnthems(1);
        declareAttackers(state);
        const view = projectPublicState(state, 0, "p2");
        expect(view.stack[0].triggeredAbilityId).toBe(MYRIAD_TRIGGER_ID);
        expect(
            view.players[0].battlefield.find((c) => c.id === "atk")
                ?.staticAbilities
        ).toContain("myriad");
    });
});

describe("Myriad — the compiler's verdict (ADR 0105)", () => {
    it("releases a printed myriad, carrying the keyword the multiset reads", () => {
        const outcome = compileCard(
            oracleCard({ oracleText: `Haste\n${MYRIAD_ORACLE_TEXT}` })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual(["haste", "myriad"]);
    });

    it("releases a static grant of myriad", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Enchantment",
                manaCost: "{4}{W}{W}",
                power: undefined,
                toughness: undefined,
                oracleText: "Creatures you control have myriad.",
            })
        );
        expect(outcome.state).toBe("ready");
    });

    it("releases a one-shot grant of myriad", () => {
        const outcome = compileCard(
            oracleCard({
                typeLine: "Sorcery",
                manaCost: "{U}{R}",
                power: undefined,
                toughness: undefined,
                oracleText:
                    "Target creature you control gains myriad until end of turn.",
            })
        );
        expect(outcome.state).toBe("ready");
    });
});
