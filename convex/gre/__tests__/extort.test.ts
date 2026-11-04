// Extort (CR 702.101a): "Whenever you cast a spell, you may pay {W/B}. If you do,
// each opponent loses 1 life and you gain life equal to the total life lost this
// way." CR 702.101b: "If a permanent has multiple instances of extort, each
// triggers separately." The cards are compiled from their real Oracle lines and
// the spell goes through the real cast event, so the keyword line, the static
// grant and the trigger scan are all on the path.
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
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import {
    beginApplyingStaticEffects,
    emitSpellCastEvent,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const REMINDER =
    "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)";

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

const SYNDIC = register(
    "test-extort-syndic",
    oracleCard({
        name: "Syndic of Tithes",
        manaCost: "{1}{W}",
        typeLine: "Creature — Human Cleric",
        power: "2",
        toughness: "2",
        oracleText: REMINDER,
    })
);
const PONTIFF = register(
    "test-extort-pontiff",
    oracleCard({
        name: "Pontiff of Blight",
        manaCost: "{4}{B}{B}",
        typeLine: "Creature — Zombie Cleric",
        power: "2",
        toughness: "7",
        oracleText: `${REMINDER}\nOther creatures you control have extort. (If a creature has multiple instances of extort, each triggers separately.)`,
    })
);

const onBattlefield = (cardId: string, id: string, controllerId = "p1") =>
    makeInstance(cardId, { id, controllerId, ownerId: controllerId });

function board(
    p1Battlefield: CardInstanceState[],
    pool: Partial<Record<"W" | "B" | "R", number>> = {}
): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: p1Battlefield,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
            }),
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

const extortOnStack = (state: GameState) =>
    state.stack.filter((s) => s.triggeredAbilityId?.startsWith("extort"));

const sources = (state: GameState) =>
    extortOnStack(state).map((t) => t.triggerSourceId);

const life = (state: GameState) => state.players.map((p) => p.life);

describe("extort: the trigger (CR 702.101a)", () => {
    it("fires when you cast a spell, not when an opponent does", () => {
        const mine = board([onBattlefield(SYNDIC, "s")]);
        cast(mine);
        expect(extortOnStack(mine)).toHaveLength(1);

        const theirs = board([onBattlefield(SYNDIC, "s")]);
        cast(theirs, "p2");
        expect(extortOnStack(theirs)).toHaveLength(0);
    });

    it.each([
        ["white", { W: 1 }],
        ["black", { B: 1 }],
    ])("paying {W/B} with %s drains 1", (_colour, pool) => {
        const state = board([onBattlefield(SYNDIC, "s")], pool);
        cast(state);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(life(state)).toEqual([21, 19]);
        expect(state.players[0].manaPool.W).toBe(0);
        expect(state.players[0].manaPool.B).toBe(0);
    });

    it("declining drains nothing and spends nothing", () => {
        const state = board([onBattlefield(SYNDIC, "s")], { W: 1 });
        cast(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(life(state)).toEqual([20, 20]);
        expect(state.players[0].manaPool.W).toBe(1);
    });

    it("mana of neither colour cannot pay it", () => {
        const state = board([onBattlefield(SYNDIC, "s")], { R: 1 });
        cast(state);
        resolveTopOfStack(state);
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p1", accept: true })
        ).toThrow("Cannot pay the cost");
        expect(life(state)).toEqual([20, 20]);
    });

    it("resolves after its source has left the battlefield", () => {
        const syndic = onBattlefield(SYNDIC, "s");
        const state = board([syndic], { W: 1 });
        cast(state);
        removePermanentTo(state, syndic.id, "graveyard");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(life(state)).toEqual([21, 19]);
    });

    it("gains the life actually lost, so nothing when a replacement consumes it", () => {
        // CR 702.101a "the total life lost this way" + CR 614: a replacement
        // that swallows the loss leaves nothing to gain.
        const noLoss: CardDefinition = {
            id: "test-extort-no-life-loss",
            name: "Life Loss Sink",
            rarity: "common",
            manaCost: { W: 1 },
            types: ["Enchantment"],
            replacementEffects: [
                {
                    id: "swallow",
                    oracleText: "If you would lose life, instead nothing.",
                    eventKind: "lifeloss",
                    appliesTo: (event, self) =>
                        event.kind === "lifeloss" &&
                        event.playerId === self.controllerId,
                    replace: () => ({ kind: "consumed" }),
                },
            ],
        };
        registerTokenDefinition(noLoss);
        const state = board([onBattlefield(SYNDIC, "s")], { W: 1 });
        state.players[1].battlefield.push(
            onBattlefield(noLoss.id, "sink", "p2")
        );
        cast(state);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(life(state)).toEqual([20, 20]);
    });
});

describe("extort: multiple instances (CR 702.101b)", () => {
    it("a static grant fires from a creature with no printed extort", () => {
        const bear = onBattlefield("ce2d603a-3231-4a8c-bf39-1617586ea870", "b");
        const state = board([onBattlefield(PONTIFF, "p"), bear]);
        expect(bear.staticAbilities).toContain("extort");
        cast(state);
        expect(sources(state).sort()).toEqual(["b", "p"]);
    });

    it("a printed and a granted instance each trigger, the grant never reaching its own source", () => {
        const state = board([
            onBattlefield(PONTIFF, "p"),
            onBattlefield(SYNDIC, "s"),
        ]);
        cast(state);
        expect(sources(state).sort()).toEqual(["p", "s", "s"]);
    });

    it("two grants of the same card are two instances", () => {
        const state = board([
            onBattlefield(PONTIFF, "p1-pontiff"),
            onBattlefield(PONTIFF, "p2-pontiff"),
            onBattlefield(SYNDIC, "s"),
        ]);
        cast(state);
        expect(sources(state).filter((id) => id === "s")).toHaveLength(3);
    });

    it("each instance is its own payment, and each pays out", () => {
        const state = board(
            [onBattlefield(PONTIFF, "p"), onBattlefield(SYNDIC, "s")],
            { W: 1, B: 1 }
        );
        cast(state);
        for (let paid = 0; paid < 2; paid++) {
            resolveTopOfStack(state);
            applyMayPaySubmit(state, { playerId: "p1", accept: true });
        }
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(life(state)).toEqual([22, 18]);
    });

    it("the grant ends with its source (CR 611.3a)", () => {
        const pontiff = onBattlefield(PONTIFF, "p");
        const state = board([pontiff, onBattlefield(SYNDIC, "s")]);
        removePermanentTo(state, pontiff.id, "graveyard");
        processPendingActionTriggers(state);
        cast(state);
        expect(sources(state)).toEqual(["s"]);
    });
});

describe("extort: the grant census (CR 702.1)", () => {
    const compiled = (oracleText: string, typeLine = "Creature — Zombie") =>
        compileCard(
            oracleCard({
                name: "Census Probe",
                manaCost: "{1}{B}",
                typeLine,
                power: "1",
                toughness: "1",
                oracleText,
            })
        );

    it("a static grant ships, because it expands to a triggered grant", () => {
        expect(compiled("Other creatures you control have extort.").state).toBe(
            "ready"
        );
    });

    it("a one-shot grant stays quarantined: it has no trigger to give", () => {
        const outcome = compiled(
            "Target creature gains extort until end of turn.",
            "Instant"
        );
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons.map((r) => r.kind)).toContain(
            "ungrantable-keyword"
        );
    });
});

describe("extort: the surfaces", () => {
    it("a granted instance survives the wire projection", () => {
        const state = board([
            onBattlefield(PONTIFF, "p"),
            onBattlefield(SYNDIC, "s"),
        ]);
        const wire = projectPublicState(state, 1, "p1").players[0]
            .battlefield as unknown as CardInstanceState[];
        const syndic = wire.find((c) => c.id === "s")!;
        expect(syndic.staticAbilities).toContain("extort");
        expect(syndic.grantedTriggeredAbilities).toHaveLength(1);
    });

    it("the owed payment crosses the wire as a hybrid pip", () => {
        const state = board([onBattlefield(SYNDIC, "s")], { B: 1 });
        cast(state);
        resolveTopOfStack(state);
        const wire = projectPublicState(state, 1, "p1");
        expect(wire.pendingChoices?.[0]?.cost).toEqual({
            hybrid: [["W", "B"]],
        });
    });

    it("a copy of a spell is not cast, so it does not trigger (CR 702.101a)", () => {
        const state = board([onBattlefield(SYNDIC, "s")]);
        const spell = pushSpell(state, lightningBolt().id, "p1", []);
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            {
                type: "SPELL_COPIED",
                spellInstanceId: spell.id,
                spellCardId: lightningBolt().id,
                copierId: "p1",
                spellTypes: ["Instant"],
                spellSubtypes: [],
                spellColors: ["R"],
            } as never,
        ];
        processPendingActionTriggers(state);
        expect(extortOnStack(state)).toHaveLength(0);
    });
});
