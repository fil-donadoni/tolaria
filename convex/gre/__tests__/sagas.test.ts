// Sagas — CR 714 framework (ADR 0078, issue #1879).
//
// The 2026 Comprehensive Rules rewrote CR 714. Both the turn-based lore
// counter (714.3c) and the sacrifice SBA (714.4) now apply only to a Saga
// "with one or more chapter abilities", which INVERTS the widely-remembered
// pre-2026 behaviour: a Saga stripped of its abilities is NOT sacrificed. The
// ability-stripped block below pins that in both directions so nobody "fixes"
// it back.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import {
    LORE_COUNTER,
    chapterAbilityId,
    expandChapterAbilities,
} from "../../cards/abilities/sagas";
import {
    advanceSagasAtPrecombatMain,
    effectiveChapterAbilities,
    finalChapter,
    hasChapterAbilityOnStack,
    isSaga,
} from "../sagas";
import { checkSagaSacrificeSBA, checkStateBasedActions } from "../sba";
import { advancePhase } from "../phases";
import { resolveTopOfStack } from "../state";
import { getDefinition } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import type {
    CardDefinition,
    CounterAddedEvent,
    PermanentView,
} from "../../cards/types";
import type { CardInstanceState, GameState, StackItem } from "../state";

const HISTORY_OF_BENALIA = "d134385d-b01c-41c7-bb2d-30722b44dc5a";

/** A synthetic COUNTER_ADDED for the crossing-condition unit tests. */
const loreEvent = (
    instanceId: string,
    total: number,
    added: number,
    counterType = LORE_COUNTER
): CounterAddedEvent => ({
    type: "COUNTER_ADDED",
    instanceId,
    controllerId: "p1",
    counterType,
    added,
    total,
    types: ["Enchantment"],
    subtypes: ["Saga"],
});

const selfView = (id: string): PermanentView =>
    ({
        id,
        controllerId: "p1",
        types: ["Enchantment"],
        subtypes: ["Saga"],
        staticAbilities: [],
    }) as unknown as PermanentView;

/** A two-chapter test Saga whose chapters are declared SEPARATELY, so each is
 *  its own ability — the shape CR 714.2b describes for "I —" / "II —". */
const twoChapterSaga: CardDefinition = {
    id: "test-saga-separate-chapters",
    name: "Test Saga",
    rarity: "rare",
    oracleText: "I — Draw a card.\nII — Draw a card.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Saga"],
    chapterAbilities: [
        { chapters: [1], oracleText: "I — Draw a card.", effects: [] },
        { chapters: [2], oracleText: "II — Draw a card.", effects: [] },
    ],
};

/** Puts a Saga instance on a player's battlefield in a fresh state. */
function sagaOnBattlefield(
    overrides: Partial<CardInstanceState> = {},
    stateOverrides: Partial<GameState> = {}
): { state: GameState; saga: CardInstanceState } {
    const saga = makeInstance(HISTORY_OF_BENALIA, {
        controllerId: "p1",
        ...overrides,
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [saga] }), makePlayer("p2")],
        ...stateOverrides,
    });
    return { state, saga };
}

describe("Saga desugaring (CR 714.2, ADR 0078)", () => {
    it("injects the CR 714.3a entry lore counter", () => {
        const def = getDefinition(HISTORY_OF_BENALIA);
        expect(def.entersWith?.counters).toEqual([
            { type: LORE_COUNTER, count: 1 },
        ]);
    });

    it('renders "I, II" as ONE ability, not two (CR 714.2c)', () => {
        const def = getDefinition(HISTORY_OF_BENALIA);
        const chapters = (def.triggeredAbilities ?? []).filter(
            (a) => a.chapterNumbers
        );
        expect(chapters).toHaveLength(2);
        expect(chapters.map((a) => a.chapterNumbers)).toEqual([[1, 2], [3]]);
        // One Oracle line per ability — never the same line twice.
        const lines = chapters.map((a) => a.oracleText);
        expect(new Set(lines).size).toBe(lines.length);
        expect(lines[0]).toBe(
            "I, II — Create a 2/2 white Knight creature token with vigilance."
        );
    });

    it("is a no-op for a card with no chapterAbilities", () => {
        const plain: CardDefinition = {
            id: "x",
            name: "x",
            rarity: "common",
            manaCost: {},
            types: ["Enchantment"],
        };
        expect(expandChapterAbilities(plain)).toBe(plain);
    });

    it("is idempotent (token copies re-enter the same seam)", () => {
        const once = expandChapterAbilities(twoChapterSaga);
        expect(expandChapterAbilities(once)).toBe(once);
    });
});

describe("chapter condition is a TRIGGER condition (CR 714.2b, ADR 0078 §6)", () => {
    const abilities =
        expandChapterAbilities(twoChapterSaga).triggeredAbilities!;
    const chapterI = abilities.find((a) => a.id === chapterAbilityId([1]))!;
    const chapterII = abilities.find((a) => a.id === chapterAbilityId([2]))!;

    it("fires on the counter that CROSSES N, and only that one", () => {
        const self = selfView("saga-1");
        // 0 → 1: chapter I crosses, chapter II does not.
        expect(chapterI.matches(loreEvent("saga-1", 1, 1), self)).toBe(true);
        expect(chapterII.matches(loreEvent("saga-1", 1, 1), self)).toBe(false);
        // 1 → 2: chapter II crosses, chapter I does NOT re-fire.
        expect(chapterI.matches(loreEvent("saga-1", 2, 1), self)).toBe(false);
        expect(chapterII.matches(loreEvent("saga-1", 2, 1), self)).toBe(true);
    });

    it("fires BOTH chapters when two counters land at once (0 → 2)", () => {
        const self = selfView("saga-1");
        expect(chapterI.matches(loreEvent("saga-1", 2, 2), self)).toBe(true);
        expect(chapterII.matches(loreEvent("saga-1", 2, 2), self)).toBe(true);
    });

    it("neither re-fires on a third counter (2 → 3)", () => {
        const self = selfView("saga-1");
        expect(chapterI.matches(loreEvent("saga-1", 3, 1), self)).toBe(false);
        expect(chapterII.matches(loreEvent("saga-1", 3, 1), self)).toBe(false);
    });

    it("ignores counters of another type and counters on another permanent", () => {
        const self = selfView("saga-1");
        expect(chapterI.matches(loreEvent("saga-1", 1, 1, "+1/+1"), self)).toBe(
            false
        );
        expect(chapterI.matches(loreEvent("other", 1, 1), self)).toBe(false);
    });
});

describe("finalChapter is DERIVED from effective abilities (CR 714.2d)", () => {
    it("takes the max chapter number", () => {
        const { saga } = sagaOnBattlefield();
        expect(isSaga(saga)).toBe(true);
        expect(effectiveChapterAbilities(saga)).toHaveLength(2);
        expect(finalChapter(saga)).toBe(3);
    });

    it("collapses to 0 when the Saga's abilities are suppressed (CR 613.1f)", () => {
        const { saga } = sagaOnBattlefield({
            abilitiesSuppressedBy: [{ sourceId: "humility", seq: 1 }],
        });
        expect(isSaga(saga)).toBe(true); // still a Saga — identity is the SUBTYPE
        expect(effectiveChapterAbilities(saga)).toHaveLength(0);
        expect(finalChapter(saga)).toBe(0);
    });
});

describe("chapter I triggers on entry (ADR 0078 §7 — applyEntersWithCounters emits COUNTER_ADDED)", () => {
    it("puts the chapter I/II trigger on the stack when the Saga resolves", () => {
        const state = makeState();
        pushSpell(state, HISTORY_OF_BENALIA, "p1");
        resolveTopOfStack(state);

        const saga = state.players[0].battlefield.find(
            (c) => c.card.id === HISTORY_OF_BENALIA
        );
        expect(saga).toBeDefined();
        expect(saga!.counters?.[LORE_COUNTER]).toBe(1);

        const trigger = state.stack.find(
            (i) => i.triggeredAbilityId === chapterAbilityId([1, 2])
        );
        expect(trigger).toBeDefined();
        expect(trigger!.triggerSourceId).toBe(saga!.id);
    });

    it("resolving the chapter creates the 2/2 vigilance Knight token", () => {
        const state = makeState();
        pushSpell(state, HISTORY_OF_BENALIA, "p1");
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        const knight = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes.includes("Knight")
        );
        expect(knight).toBeDefined();
        expect(knight!.power).toBe(2);
        expect(knight!.toughness).toBe(2);
        expect(knight!.staticAbilities).toContain("vigilance");
    });
});

describe("turn-based lore counter (CR 714.3c)", () => {
    it("adds one counter to each Saga the ACTIVE player controls", () => {
        const mine = makeInstance(HISTORY_OF_BENALIA, { controllerId: "p1" });
        const theirs = makeInstance(HISTORY_OF_BENALIA, { controllerId: "p2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
            activePlayerId: "p1",
        });

        advanceSagasAtPrecombatMain(state);

        expect(mine.counters?.[LORE_COUNTER]).toBe(1);
        expect(theirs.counters?.[LORE_COUNTER]).toBeUndefined();
    });

    it("runs on the PRECOMBAT main phase only, and puts the chapter trigger on the stack", () => {
        const { state, saga } = sagaOnBattlefield(
            { counters: { [LORE_COUNTER]: 1 } },
            { phase: "DRAW", priorityPlayerId: "p1" }
        );

        advancePhase(state);

        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(saga.counters?.[LORE_COUNTER]).toBe(2);
        expect(
            state.stack.some(
                (i) => i.triggeredAbilityId === chapterAbilityId([1, 2])
            )
        ).toBe(true);
    });

    it("does NOT advance the Saga again on entering POSTCOMBAT_MAIN", () => {
        const { state, saga } = sagaOnBattlefield(
            { counters: { [LORE_COUNTER]: 1 } },
            { phase: "END_OF_COMBAT", priorityPlayerId: "p1" }
        );

        advancePhase(state);

        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(saga.counters?.[LORE_COUNTER]).toBe(1);
        expect(state.stack).toHaveLength(0);
    });
});

describe("sacrifice SBA (CR 714.4)", () => {
    it("sacrifices a Saga at or past its final chapter with an empty stack", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 3 },
        });

        expect(checkSagaSacrificeSBA(state)).toBe(true);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(saga.id);
    });

    it("does NOT sacrifice a Saga below its final chapter", () => {
        const { state } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 2 },
        });
        expect(checkSagaSacrificeSBA(state)).toBe(false);
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("is DEFERRED while a chapter ability of that Saga is on the stack", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 3 },
        });
        state.stack.push({
            ...makeInstance(HISTORY_OF_BENALIA, { controllerId: "p1" }),
            triggerSourceId: saga.id,
            triggeredAbilityId: chapterAbilityId([3]),
        } as StackItem);

        expect(hasChapterAbilityOnStack(state, saga)).toBe(true);
        expect(checkSagaSacrificeSBA(state)).toBe(false);
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("is NOT deferred by a NON-chapter trigger sourced from the same Saga", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 3 },
        });
        // A granted trigger (triggeredGrantTemplates, Backup-style) sourced
        // from the Saga must not buy it another turn.
        state.stack.push({
            ...makeInstance(HISTORY_OF_BENALIA, { controllerId: "p1" }),
            triggerSourceId: saga.id,
            triggeredAbilityId: "granted-not-a-chapter",
        } as StackItem);

        expect(hasChapterAbilityOnStack(state, saga)).toBe(false);
        expect(checkSagaSacrificeSBA(state)).toBe(true);
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("is not deferred by a chapter trigger of a DIFFERENT Saga", () => {
        const other = makeInstance(HISTORY_OF_BENALIA, { controllerId: "p1" });
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 3 },
        });
        state.stack.push({
            ...makeInstance(HISTORY_OF_BENALIA, { controllerId: "p1" }),
            triggerSourceId: other.id,
            triggeredAbilityId: chapterAbilityId([3]),
        } as StackItem);

        expect(hasChapterAbilityOnStack(state, saga)).toBe(false);
        expect(checkSagaSacrificeSBA(state)).toBe(true);
    });

    // ORDERING REGRESSION TEST (ADR 0078 §5). Tolaria runs
    // `resolveTopOfStack` = resolve → processPendingActionTriggers, and every
    // caller sweeps SBAs afterwards, so a chapter that has triggered is always
    // already ON the stack when this SBA reads it. If anyone ever reorders
    // those two, the Saga would be sacrificed before its final chapter
    // resolves and this test fails loudly.
    it("resolves the FINAL chapter BEFORE the sacrifice", () => {
        const { state, saga } = sagaOnBattlefield(
            { counters: { [LORE_COUNTER]: 2 } },
            { phase: "DRAW", priorityPlayerId: "p1" }
        );

        // Precombat main puts the 3rd lore counter on and stacks chapter III.
        advancePhase(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(3);
        expect(
            state.stack.some(
                (i) => i.triggeredAbilityId === chapterAbilityId([3])
            )
        ).toBe(true);

        // The SBA sweep must NOT eat the Saga while its chapter is in flight.
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(saga);

        // Chapter III resolves, THEN the Saga is sacrificed.
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).not.toContain(saga);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(saga.id);
    });

    it("does not fizzle a chapter whose lore counters are removed in response (ADR 0078 §6)", () => {
        const { state, saga } = sagaOnBattlefield(
            { counters: { [LORE_COUNTER]: 0 } },
            { phase: "DRAW", priorityPlayerId: "p1" }
        );

        advancePhase(state);
        expect(
            state.stack.some(
                (i) => i.triggeredAbilityId === chapterAbilityId([1, 2])
            )
        ).toBe(true);

        // Respond by removing every lore counter. The chapter condition was
        // evaluated at TRIGGER time off the event payload; it is never
        // re-checked at resolution, so the chapter still happens.
        saga.counters = { [LORE_COUNTER]: 0 };
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.some(
                (c) => c.isToken && c.subtypes.includes("Knight")
            )
        ).toBe(true);
    });
});

describe("ability-stripped Saga (2026 CR 714.3c / 714.4 gates)", () => {
    // Blood Moon / Humility. Under the PRE-2026 rules this Saga's final
    // chapter collapsed to 0, `lore >= 0` was trivially true, and it was
    // sacrificed on the spot. Under the current rules BOTH gates read "with
    // one or more chapter abilities", so it persists inert. Asserted in both
    // directions on purpose.
    it("gets NO lore counter at precombat main, and is NOT sacrificed", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 2 },
            abilitiesSuppressedBy: [{ sourceId: "humility", seq: 1 }],
        });

        advanceSagasAtPrecombatMain(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(2); // frozen

        expect(checkSagaSacrificeSBA(state)).toBe(false);
        expect(state.players[0].battlefield).toContain(saga);
    });

    it("is not sacrificed even at/past what WOULD be its final chapter", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 5 },
            // PRD #2064 S3 — `abilitiesSuppressedBy` is DERIVED output now;
            // the hold a resolving ability leaves behind lives in
            // `abilityLossHolds`, and the `"indefinite"` sentinel (CR 611.2c)
            // is the one whose source needs no permanent on the board.
            abilityLossHolds: [{ sourceId: "indefinite", seq: 1 }],
        });
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toContain(saga);
        expect(saga.counters?.[LORE_COUNTER]).toBe(5);
    });

    it("resumes advancing once the suppression is lifted", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 2 },
            abilitiesSuppressedBy: [{ sourceId: "humility", seq: 1 }],
        });
        advanceSagasAtPrecombatMain(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(2);

        saga.abilitiesSuppressedBy = undefined;
        advanceSagasAtPrecombatMain(state);
        expect(saga.counters?.[LORE_COUNTER]).toBe(3);
    });
});

describe("wire format — lore counters survive projectPublicState", () => {
    it("keeps the lore count on the projected battlefield card", () => {
        const { state, saga } = sagaOnBattlefield({
            counters: { [LORE_COUNTER]: 2 },
        });

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === saga.id
        );
        expect(slim).toBeDefined();
        expect(slim!.counters?.[LORE_COUNTER]).toBe(2);
        expect(slim!.subtypes).toContain("Saga");
    });
});
