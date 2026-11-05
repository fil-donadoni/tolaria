// Exalted through a static grant (CR 702.83a): "Whenever a creature you control
// attacks alone, that creature gets +1/+1 until end of turn." CR 702.83b reads
// "attacks alone" as the only creature declared as an attacker. The grant writes the
// keyword on the recipient's instance, which no expander reads, so a `triggered-grant`
// goes beside it. The cards are compiled from their real Oracle lines and the attack
// goes through the real emitter, so the static line and the trigger scan are on the path.
import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { markAttacking } from "../combat";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { emitAttackersDeclaredEvents } from "../phases";
import {
    beginApplyingStaticEffects,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

function register(id: string, card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready") {
        throw new Error(`${card.name}: ${JSON.stringify(outcome)}`);
    }
    registerTokenDefinition({
        ...outcome.definition,
        id,
        rarity: "common",
    } as CardDefinition);
    return id;
}

const ARCHANGEL = register(
    "test-exalted-archangel",
    oracleCard({
        name: "Sublime Archangel",
        manaCost: "{2}{W}{W}",
        typeLine: "Creature — Angel",
        power: "4",
        toughness: "3",
        oracleText:
            "Flying\nExalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\nOther creatures you control have exalted. (If a creature has multiple instances of exalted, each triggers separately.)",
    })
);
const CHOSEN = register(
    "test-exalted-chosen",
    oracleCard({
        name: "First Sliver's Chosen",
        manaCost: "{4}{W}",
        typeLine: "Creature — Sliver",
        power: "3",
        toughness: "3",
        oracleText:
            "Sliver creatures you control have exalted. (Whenever a creature you control attacks alone, it gets +1/+1 until end of turn for each instance of exalted among permanents you control.)",
    })
);
const BEARS = getCardByName("Grizzly Bears").id;

const onBattlefield = (cardId: string, id: string, controllerId = "p1") =>
    makeInstance(cardId, { id, controllerId, ownerId: controllerId });

function board(
    p1Battlefield: CardInstanceState[],
    p2Battlefield: CardInstanceState[] = []
): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "DECLARE_ATTACKERS",
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    for (const permanent of [...p1Battlefield, ...p2Battlefield]) {
        beginApplyingStaticEffects(state, permanent);
    }
    return state;
}

/** Declares `attackers` the way the phase machine does, then emits the CR 508.1m
 *  batch through the real emitter. */
function attack(state: GameState, attackers: CardInstanceState[]) {
    state.combat = {
        attackerIds: attackers.map((c) => c.id),
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    for (const attacker of attackers) markAttacking(state, attacker);
    emitAttackersDeclaredEvents(state);
    // CR 603.3b — several at once wait for their controller to order them.
    resolveTriggerOrder(state);
}

const exaltedOnStack = (state: GameState) =>
    state.stack.filter((s) => s.triggeredAbilityId?.startsWith("exalted"));

const sources = (state: GameState) =>
    exaltedOnStack(state)
        .map((t) => t.triggerSourceId)
        .sort();

function resolveAll(state: GameState) {
    while (state.stack.length > 0) resolveTopOfStack(state);
}

describe("exalted: a static grant (CR 702.83a)", () => {
    it("fires from a creature with no printed exalted, and pumps the lone attacker", () => {
        const bears = onBattlefield(BEARS, "b");
        const state = board([onBattlefield(ARCHANGEL, "a"), bears]);
        expect(bears.staticAbilities).toContain("exalted");
        attack(state, [bears]);
        expect(sources(state)).toEqual(["a", "b"]);
        resolveAll(state);
        expect(getEffectivePower(state, bears)).toBe(4);
        expect(getEffectiveToughness(state, bears)).toBe(4);
    });

    it("pumps the lone attacker when another creature's granted instance fires", () => {
        const a = onBattlefield(ARCHANGEL, "a");
        const bears = onBattlefield(BEARS, "b");
        const state = board([a, bears]);
        attack(state, [a]);
        expect(sources(state)).toEqual(["a", "b"]);
        resolveAll(state);
        expect(getEffectivePower(state, a)).toBe(6);
        expect(getEffectivePower(state, bears)).toBe(2);
    });

    it("two grants of the same card are two instances, one printed trigger each", () => {
        const bears = onBattlefield(BEARS, "b");
        const state = board([
            onBattlefield(ARCHANGEL, "a1"),
            onBattlefield(ARCHANGEL, "a2"),
            bears,
        ]);
        attack(state, [bears]);
        expect(sources(state)).toEqual(["a1", "a1", "a2", "a2", "b", "b"]);
        resolveAll(state);
        expect(getEffectivePower(state, bears)).toBe(8);
    });

    it("the grant reads its filter: a Sliver gets it, a Bear does not, the source does", () => {
        const bears = onBattlefield(BEARS, "b");
        const chosen = onBattlefield(CHOSEN, "c");
        const state = board([chosen, bears]);
        expect(bears.staticAbilities ?? []).not.toContain("exalted");
        expect(chosen.staticAbilities).toContain("exalted");
        attack(state, [bears]);
        expect(sources(state)).toEqual(["c"]);
        resolveAll(state);
        expect(getEffectivePower(state, bears)).toBe(3);
    });

    it("does not reach an opponent's creature", () => {
        const theirs = onBattlefield(BEARS, "t", "p2");
        board([onBattlefield(ARCHANGEL, "a")], [theirs]);
        expect(theirs.staticAbilities ?? []).not.toContain("exalted");
    });
});

describe("exalted: what does not fire it (CR 702.83a, CR 702.83b)", () => {
    it("two attackers are not alone", () => {
        const a = onBattlefield(ARCHANGEL, "a");
        const bears = onBattlefield(BEARS, "b");
        const state = board([a, bears]);
        attack(state, [a, bears]);
        expect(sources(state)).toEqual([]);
    });

    it("an opponent's lone attack fires neither instance", () => {
        const theirs = onBattlefield(BEARS, "t", "p2");
        const state = board(
            [onBattlefield(ARCHANGEL, "a"), onBattlefield(BEARS, "b")],
            [theirs]
        );
        state.activePlayerId = "p2";
        attack(state, [theirs]);
        expect(sources(state)).toEqual([]);
    });

    it("the grant ends with its source (CR 611.3a)", () => {
        const a = onBattlefield(ARCHANGEL, "a");
        const bears = onBattlefield(BEARS, "b");
        const state = board([a, bears]);
        removePermanentTo(state, a.id, "graveyard");
        processPendingActionTriggers(state);
        attack(state, [bears]);
        expect(sources(state)).toEqual([]);
    });

    it("resolves after its granting source has left, the trigger already being on the stack", () => {
        const a = onBattlefield(ARCHANGEL, "a");
        const bears = onBattlefield(BEARS, "b");
        const state = board([a, bears]);
        attack(state, [bears]);
        removePermanentTo(state, a.id, "graveyard");
        processPendingActionTriggers(state);
        resolveAll(state);
        expect(getEffectivePower(state, bears)).toBe(4);
    });
});

describe("exalted: the grant census (CR 702.83a)", () => {
    const compiled = (oracleText: string, typeLine = "Creature — Angel") =>
        compileCard(
            oracleCard({
                name: "Census Probe",
                manaCost: "{1}{W}",
                typeLine,
                power: "1",
                toughness: "1",
                oracleText,
            })
        );

    it("a static grant ships, because it expands to a triggered grant", () => {
        expect(
            compiled("Other creatures you control have exalted.").state
        ).toBe("ready");
    });

    it("a one-shot grant stays quarantined: it has no trigger to give", () => {
        const outcome = compiled(
            "Target creature gains exalted until end of turn.",
            "Instant"
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toContain(
            "ungrantable-keyword"
        );
    });
});

describe("exalted: the wire (CR 702.83a)", () => {
    it("a granted instance and its pump survive the projection", () => {
        const bears = onBattlefield(BEARS, "b");
        const state = board([onBattlefield(ARCHANGEL, "a"), bears]);
        attack(state, [bears]);
        resolveAll(state);
        const wire = projectPublicState(state, 1, "p1");
        const slim = wire.players[0].battlefield.find((c) => c.id === "b")!;
        expect(slim.staticAbilities).toContain("exalted");
        expect(
            (slim as unknown as CardInstanceState).grantedTriggeredAbilities
        ).toHaveLength(1);
        expect(getEffectivePower(wire, slim)).toBe(4);
        expect(getEffectiveToughness(wire, slim)).toBe(4);
    });
});
