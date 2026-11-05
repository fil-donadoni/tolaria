// A static grant of prowess. CR 702.108a: "Whenever you cast a noncreature
// spell, this creature gets +1/+1 until end of turn." CR 702.108b: "If a creature
// has multiple instances of prowess, each triggers separately." The cards are
// compiled from their real Oracle lines and the spell goes through the real cast
// event, so the static grant, the trigger scan and the pump are all on the path.
import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import { darkRitual } from "../../cards/sets/lea/black.cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import {
    beginApplyingStaticEffects,
    emitSpellCastEvent,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";

const REMINDER =
    "Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)";
const GRANT =
    "Other creatures you control have prowess. (If a creature has multiple instances of prowess, each triggers separately.)";
const BRIA_ORACLE = `${REMINDER}\n${GRANT}\nWhenever you cast a noncreature spell, target creature you control can't be blocked this turn.`;

const bria = (oracleText: string) =>
    oracleCard({
        name: "Bria, Riptide Rogue",
        manaCost: "{2}{U}{R}",
        typeLine: "Legendary Creature — Otter Rogue",
        power: "3",
        toughness: "3",
        oracleText,
    });

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

// Bria's own third line asks for a target, and two of her are a CR 704.5j choice,
// neither of which is under test: the lord is her two prowess lines on a
// nonlegendary body, read by the compiler all the same.
const LORD = register(
    "test-prowess-lord",
    oracleCard({
        name: "Riptide Lord",
        manaCost: "{2}{U}{R}",
        typeLine: "Creature — Otter Rogue",
        power: "3",
        toughness: "3",
        oracleText: `${REMINDER}\n${GRANT}`,
    })
);
const SWIFTSPEAR = register(
    "test-prowess-printed",
    oracleCard({
        name: "Monastery Swiftspear",
        manaCost: "{R}",
        typeLine: "Creature — Human Monk",
        power: "1",
        toughness: "2",
        oracleText: REMINDER,
    })
);
const BEAR = register(
    "test-prowess-vanilla",
    oracleCard({
        name: "Vanilla Bear",
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        power: "2",
        toughness: "2",
        oracleText: "",
    })
);
const GIANT_SPELL = register(
    "test-prowess-creature-spell",
    oracleCard({
        name: "Vanilla Giant",
        manaCost: "{4}{R}",
        typeLine: "Creature — Giant",
        power: "5",
        toughness: "5",
        oracleText: "",
    })
);

const onBattlefield = (cardId: string, id: string, controllerId = "p1") =>
    makeInstance(cardId, { id, controllerId, ownerId: controllerId });

function board(p1Battlefield: CardInstanceState[]): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2"),
        ],
    });
    for (const permanent of p1Battlefield) {
        beginApplyingStaticEffects(state, permanent);
    }
    return state;
}

function cast(state: GameState, casterId = "p1", spellId = darkRitual().id) {
    emitSpellCastEvent(state, pushSpell(state, spellId, casterId));
    processPendingActionTriggers(state);
    // CR 603.3b — several at once wait for their controller to order them.
    resolveTriggerOrder(state);
}

const sources = (state: GameState) =>
    state.stack
        .filter((s) => s.triggeredAbilityId?.startsWith("prowess"))
        .map((t) => t.triggerSourceId)
        .sort();

function resolveProwess(state: GameState) {
    const owed = sources(state).length;
    for (let i = 0; i < owed; i++) resolveTopOfStack(state);
    expect(sources(state)).toEqual([]);
}

describe("prowess: a static grant (CR 702.108a)", () => {
    it("fires from a creature with no printed prowess, and pumps that creature", () => {
        const bear = onBattlefield(BEAR, "b");
        const lord = onBattlefield(LORD, "l");
        const state = board([lord, bear]);
        expect(bear.staticAbilities).toContain("prowess");
        cast(state);
        expect(sources(state)).toEqual(["b", "l"]);
        resolveProwess(state);
        expect(getEffectivePower(state, bear)).toBe(3);
        expect(getEffectiveToughness(state, bear)).toBe(3);
        expect(getEffectivePower(state, lord)).toBe(4);
    });

    it("a creature spell does not trigger it", () => {
        const state = board([
            onBattlefield(LORD, "l"),
            onBattlefield(BEAR, "b"),
        ]);
        cast(state, "p1", GIANT_SPELL);
        expect(sources(state)).toEqual([]);
    });

    it("an opponent's spell does not trigger it", () => {
        const state = board([
            onBattlefield(LORD, "l"),
            onBattlefield(BEAR, "b"),
        ]);
        cast(state, "p2");
        expect(sources(state)).toEqual([]);
    });

    it("the grant ends with its source (CR 611.3a)", () => {
        const lord = onBattlefield(LORD, "l");
        const state = board([lord, onBattlefield(BEAR, "b")]);
        removePermanentTo(state, lord.id, "graveyard");
        processPendingActionTriggers(state);
        cast(state);
        expect(sources(state)).toEqual([]);
    });

    it("a trigger already on the stack resolves after the grant has ended", () => {
        const bear = onBattlefield(BEAR, "b");
        const lord = onBattlefield(LORD, "l");
        const state = board([lord, bear]);
        cast(state);
        removePermanentTo(state, lord.id, "graveyard");
        processPendingActionTriggers(state);
        resolveProwess(state);
        expect(getEffectivePower(state, bear)).toBe(3);
    });
});

describe("prowess: multiple instances (CR 702.108b)", () => {
    it("a printed and a granted instance each trigger, each pumping", () => {
        const swiftspear = onBattlefield(SWIFTSPEAR, "s");
        const state = board([onBattlefield(LORD, "l"), swiftspear]);
        cast(state);
        expect(sources(state)).toEqual(["l", "s", "s"]);
        resolveProwess(state);
        expect(getEffectivePower(state, swiftspear)).toBe(3);
        expect(getEffectiveToughness(state, swiftspear)).toBe(4);
    });

    it("two grants of the same card are two instances", () => {
        const bear = onBattlefield(BEAR, "b");
        const state = board([
            onBattlefield(LORD, "l1"),
            onBattlefield(LORD, "l2"),
            bear,
        ]);
        cast(state);
        expect(sources(state).filter((id) => id === "b")).toHaveLength(2);
        resolveProwess(state);
        expect(getEffectivePower(state, bear)).toBe(4);
    });
});

describe("prowess: the grant census (CR 702.108a)", () => {
    it("Bria, Riptide Rogue's real Oracle text ships", () => {
        expect(compileCard(bria(BRIA_ORACLE)).state).toBe("ready");
    });

    it("a one-shot grant stays quarantined: it has no trigger to give", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Census Probe",
                manaCost: "{U}",
                typeLine: "Instant",
                oracleText: "Target creature gains prowess until end of turn.",
            })
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toContain(
            "ungrantable-keyword"
        );
    });

    it("a sibling keyword with no grant twin stays quarantined", () => {
        const outcome = compileCard(
            bria("Other creatures you control have battle cry.")
        );
        expect(outcome.state).toBe("quarantine");
    });
});

describe("prowess: the surfaces", () => {
    it("a granted instance and its pump survive the wire projection", () => {
        const state = board([
            onBattlefield(LORD, "l"),
            onBattlefield(BEAR, "b"),
        ]);
        const before = projectPublicState(state, 1, "p1").players[0]
            .battlefield as unknown as CardInstanceState[];
        const bear = before.find((c) => c.id === "b")!;
        expect(bear.staticAbilities).toContain("prowess");
        expect(bear.grantedTriggeredAbilities).toHaveLength(1);

        cast(state);
        resolveProwess(state);
        const wire = projectPublicState(state, 1, "p1");
        const pumped = (
            wire.players[0].battlefield as unknown as CardInstanceState[]
        ).find((c) => c.id === "b")!;
        expect(getEffectivePower(wire as unknown as GameState, pumped)).toBe(3);
    });
});
