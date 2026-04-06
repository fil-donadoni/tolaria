import { describe, it, expect } from "vitest";
import { advancePhase, drainAutoPasses, isSorceryTiming } from "../phases";
import type {
    GameState,
    PlayerState,
    CardInstanceState,
    StackItem,
} from "../state";
import type { Phase } from "../types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: overrides.card ?? { name: "Test Card", types: ["Creature"] },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
        deck: {},
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// advancePhase — phase transitions
// ---------------------------------------------------------------------------

describe("advancePhase", () => {
    describe("linear phase progression", () => {
        it("UPKEEP → DRAW", () => {
            const state = makeGameState({ phase: "UPKEEP" });
            const traversed = advancePhase(state);
            expect(state.phase).toBe("DRAW");
            expect(traversed).toEqual(["DRAW"]);
        });

        it("DRAW → PRECOMBAT_MAIN", () => {
            const state = makeGameState({ phase: "DRAW" });
            const traversed = advancePhase(state);
            expect(state.phase).toBe("PRECOMBAT_MAIN");
            expect(traversed).toEqual(["PRECOMBAT_MAIN"]);
        });

        it("PRECOMBAT_MAIN → BEGINNING_OF_COMBAT", () => {
            const state = makeGameState({ phase: "PRECOMBAT_MAIN" });
            advancePhase(state);
            expect(state.phase).toBe("BEGINNING_OF_COMBAT");
        });

        it("BEGINNING_OF_COMBAT → DECLARE_ATTACKERS", () => {
            const state = makeGameState({ phase: "BEGINNING_OF_COMBAT" });
            advancePhase(state);
            expect(state.phase).toBe("DECLARE_ATTACKERS");
        });

        it("DECLARE_ATTACKERS → POSTCOMBAT_MAIN (no attackers: skips BLOCKERS, DAMAGE, END)", () => {
            const state = makeGameState({ phase: "DECLARE_ATTACKERS" });
            advancePhase(state);
            expect(state.phase).toBe("POSTCOMBAT_MAIN");
        });

        it("DECLARE_ATTACKERS → DECLARE_BLOCKERS (with attackers)", () => {
            const state = makeGameState({
                phase: "DECLARE_ATTACKERS",
                combat: {
                    attackerIds: ["c1"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            advancePhase(state);
            expect(state.phase).toBe("DECLARE_BLOCKERS");
        });

        it("DECLARE_BLOCKERS → POSTCOMBAT_MAIN (no attackers)", () => {
            const state = makeGameState({ phase: "DECLARE_BLOCKERS" });
            advancePhase(state);
            expect(state.phase).toBe("POSTCOMBAT_MAIN");
        });

        it("COMBAT_DAMAGE → END_OF_COMBAT (with attackers)", () => {
            const state = makeGameState({
                phase: "COMBAT_DAMAGE",
                combat: {
                    attackerIds: ["c1"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: true,
                },
            });
            // Need attacker on battlefield for damage calc
            const p1 = state.players.find((p) => p.id === "p1")!;
            p1.battlefield.push(
                makeCard({
                    id: "c1",
                    card: {
                        name: "Bear",
                        types: ["Creature"],
                        power: 2,
                        toughness: 2,
                    },
                    isAttacking: true,
                })
            );
            advancePhase(state);
            expect(state.phase).toBe("END_OF_COMBAT");
        });

        it("COMBAT_DAMAGE → POSTCOMBAT_MAIN (no attackers)", () => {
            const state = makeGameState({ phase: "COMBAT_DAMAGE" });
            advancePhase(state);
            expect(state.phase).toBe("POSTCOMBAT_MAIN");
        });

        it("END_OF_COMBAT → POSTCOMBAT_MAIN", () => {
            const state = makeGameState({ phase: "END_OF_COMBAT" });
            advancePhase(state);
            expect(state.phase).toBe("POSTCOMBAT_MAIN");
        });

        it("POSTCOMBAT_MAIN → END_STEP", () => {
            const state = makeGameState({ phase: "POSTCOMBAT_MAIN" });
            advancePhase(state);
            expect(state.phase).toBe("END_STEP");
        });
    });

    describe("auto-phase skipping", () => {
        it("END_STEP → CLEANUP (auto) → UNTAP (auto, next turn) → UPKEEP", () => {
            const state = makeGameState({ phase: "END_STEP", turn: 1 });
            const traversed = advancePhase(state);

            expect(state.phase).toBe("UPKEEP");
            expect(traversed).toEqual(["CLEANUP", "UNTAP", "UPKEEP"]);
        });

        it("skipping auto-phases does not give priority until UPKEEP", () => {
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
            });
            advancePhase(state);

            // After turn change, p2 is active and has priority at UPKEEP
            expect(state.activePlayerId).toBe("p2");
            expect(state.priorityPlayerId).toBe("p2");
            expect(state.passCount).toBe(0);
        });
    });

    describe("turn advancement", () => {
        it("increments turn counter when advancing past CLEANUP", () => {
            const state = makeGameState({ phase: "END_STEP", turn: 1 });
            advancePhase(state);
            expect(state.turn).toBe(2);
        });

        it("swaps active player on new turn", () => {
            const state = makeGameState({
                phase: "END_STEP",
                activePlayerId: "p1",
            });
            advancePhase(state);
            expect(state.activePlayerId).toBe("p2");
        });

        it("swaps back on the turn after", () => {
            const state = makeGameState({
                phase: "END_STEP",
                activePlayerId: "p2",
            });
            advancePhase(state);
            expect(state.activePlayerId).toBe("p1");
        });

        it("turn counter increments correctly across multiple turns", () => {
            const state = makeGameState({
                phase: "END_STEP",
                turn: 5,
                activePlayerId: "p1",
            });
            advancePhase(state);
            expect(state.turn).toBe(6);
            expect(state.activePlayerId).toBe("p2");
        });
    });

    describe("priority assignment", () => {
        it("active player gets priority at start of each priority phase", () => {
            const state = makeGameState({
                phase: "UPKEEP",
                activePlayerId: "p1",
                priorityPlayerId: "p2", // opponent had it
            });
            advancePhase(state);

            expect(state.phase).toBe("DRAW");
            expect(state.priorityPlayerId).toBe("p1");
        });

        it("passCount resets to 0 at each new phase", () => {
            const state = makeGameState({
                phase: "UPKEEP",
                passCount: 2,
            });
            advancePhase(state);
            expect(state.passCount).toBe(0);
        });
    });

    describe("untap step entry action (CR 502.4)", () => {
        it("untaps all permanents of the active player", () => {
            const tappedLand = makeCard({
                id: "land1",
                card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
                controllerId: "p2",
                isTapped: true,
            });
            const tappedCreature = makeCard({
                id: "creature1",
                card: { name: "Bear", types: ["Creature"] },
                controllerId: "p2",
                isTapped: true,
            });

            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1" }),
                    makePlayer({
                        id: "p2",
                        battlefield: [tappedLand, tappedCreature],
                    }),
                ],
            });

            // Advance past END_STEP → CLEANUP → new turn (p2 active) → UNTAP → UPKEEP
            advancePhase(state);

            expect(state.activePlayerId).toBe("p2");
            const p2 = state.players.find((p) => p.id === "p2")!;
            expect(p2.battlefield[0].isTapped).toBe(false);
            expect(p2.battlefield[1].isTapped).toBe(false);
        });

        it("clears manaCommitted flags during untap", () => {
            const committedLand = makeCard({
                id: "land1",
                card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
                controllerId: "p2",
                isTapped: true,
                manaCommitted: true,
            });

            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1" }),
                    makePlayer({
                        id: "p2",
                        battlefield: [committedLand],
                    }),
                ],
            });

            advancePhase(state);

            const p2 = state.players.find((p) => p.id === "p2")!;
            expect(p2.battlefield[0].manaCommitted).toBeUndefined();
        });

        it("clears mana pool during untap", () => {
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1" }),
                    makePlayer({
                        id: "p2",
                        manaPool: { W: 3, U: 1, B: 0, R: 0, G: 0, C: 0 },
                    }),
                ],
            });

            advancePhase(state);

            const p2 = state.players.find((p) => p.id === "p2")!;
            expect(p2.manaPool).toEqual({
                W: 0,
                U: 0,
                B: 0,
                R: 0,
                G: 0,
                C: 0,
            });
        });

        it("does NOT untap the non-active player's permanents", () => {
            const opponentLand = makeCard({
                id: "land1",
                card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
                controllerId: "p1",
                isTapped: true,
            });

            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({
                        id: "p1",
                        battlefield: [opponentLand],
                    }),
                    makePlayer({ id: "p2" }),
                ],
            });

            // p2 becomes active → only p2's stuff untaps
            advancePhase(state);

            const p1 = state.players.find((p) => p.id === "p1")!;
            expect(p1.battlefield[0].isTapped).toBe(true);
        });
    });

    describe("draw step entry action (CR 504.1)", () => {
        it("active player draws a card on draw step", () => {
            const libraryCard = makeCard({
                id: "topCard",
                card: {
                    name: "Mountain",
                    types: ["Land"],
                    subtypes: ["Mountain"],
                },
                zone: "library",
                controllerId: "p1",
            });

            const state = makeGameState({
                phase: "UPKEEP",
                turn: 2, // not turn 1, so draw happens
                activePlayerId: "p1",
                players: [
                    makePlayer({
                        id: "p1",
                        library: [libraryCard],
                        hand: [],
                    }),
                    makePlayer({ id: "p2" }),
                ],
            });

            advancePhase(state);

            expect(state.phase).toBe("DRAW");
            const p1 = state.players.find((p) => p.id === "p1")!;
            expect(p1.hand).toHaveLength(1);
            expect(p1.hand[0].id).toBe("topCard");
            expect(p1.library).toHaveLength(0);
        });

        it("skips draw on turn 1 (CR 103.8)", () => {
            const libraryCard = makeCard({
                id: "topCard",
                card: {
                    name: "Mountain",
                    types: ["Land"],
                    subtypes: ["Mountain"],
                },
                zone: "library",
                controllerId: "p1",
            });

            const state = makeGameState({
                phase: "UPKEEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({
                        id: "p1",
                        library: [libraryCard],
                        hand: [],
                    }),
                    makePlayer({ id: "p2" }),
                ],
            });

            advancePhase(state);

            expect(state.phase).toBe("DRAW");
            const p1 = state.players.find((p) => p.id === "p1")!;
            expect(p1.hand).toHaveLength(0);
            expect(p1.library).toHaveLength(1);
        });

        it("does not throw when library is empty (draw step)", () => {
            const state = makeGameState({
                phase: "UPKEEP",
                turn: 2,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1", library: [], hand: [] }),
                    makePlayer({ id: "p2" }),
                ],
            });

            expect(() => advancePhase(state)).not.toThrow();
            const p1 = state.players.find((p) => p.id === "p1")!;
            expect(p1.hand).toHaveLength(0);
        });
    });

    describe("full turn cycle", () => {
        it("walks through all phases of a complete turn", () => {
            const phases: Phase[] = [];
            const state = makeGameState({
                phase: "UPKEEP",
                turn: 2,
                activePlayerId: "p1",
                players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            });

            // Walk through every phase until we're back at UPKEEP of next turn
            const maxSteps = 20;
            for (let i = 0; i < maxSteps; i++) {
                phases.push(state.phase);
                advancePhase(state);
                // Stop once we hit UPKEEP of a new turn
                if (state.phase === "UPKEEP" && state.turn === 3) break;
            }

            // No attackers → DECLARE_BLOCKERS/COMBAT_DAMAGE/END_OF_COMBAT are skipped
            expect(phases).toEqual([
                "UPKEEP",
                "DRAW",
                "PRECOMBAT_MAIN",
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "POSTCOMBAT_MAIN",
                "END_STEP",
            ]);
            expect(state.phase).toBe("UPKEEP");
            expect(state.turn).toBe(3);
            expect(state.activePlayerId).toBe("p2");
        });
    });
});

// ---------------------------------------------------------------------------
// isSorceryTiming — CR 307.1, CR 305.2
// ---------------------------------------------------------------------------

describe("isSorceryTiming", () => {
    it("true during PRECOMBAT_MAIN with empty stack and active player priority", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            stack: [],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(isSorceryTiming(state)).toBe(true);
    });

    it("true during POSTCOMBAT_MAIN with empty stack and active player priority", () => {
        const state = makeGameState({
            phase: "POSTCOMBAT_MAIN",
            stack: [],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(isSorceryTiming(state)).toBe(true);
    });

    it("false during non-main phase (UPKEEP)", () => {
        const state = makeGameState({
            phase: "UPKEEP",
            stack: [],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(isSorceryTiming(state)).toBe(false);
    });

    it("false during combat phase", () => {
        const state = makeGameState({
            phase: "DECLARE_ATTACKERS",
            stack: [],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(isSorceryTiming(state)).toBe(false);
    });

    it("false when stack is non-empty", () => {
        const boltOnStack: CardInstanceState = makeCard({
            card: { name: "Lightning Bolt", types: ["Instant"] },
            zone: "stack",
        });
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            stack: [{ ...boltOnStack, castById: "p2" }],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(isSorceryTiming(state)).toBe(false);
    });

    it("false when non-active player has priority", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            stack: [],
            activePlayerId: "p1",
            priorityPlayerId: "p2",
        });
        expect(isSorceryTiming(state)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// drainAutoPasses — auto-pass priority for the rest of the turn
// ---------------------------------------------------------------------------

function makeStackItem(
    cardData: Record<string, unknown>,
    castById: string,
    overrides: Partial<StackItem> = {}
): StackItem {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardData,
        controllerId: castById,
        ownerId: castById,
        zone: "stack",
        isTapped: false,
        castById,
        ...overrides,
    };
}

describe("drainAutoPasses", () => {
    it("does nothing when no autoPassPlayers are set", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            priorityPlayerId: "p1",
            passCount: 0,
        });
        drainAutoPasses(state);
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.passCount).toBe(0);
    });

    it("passes priority when current priority holder is auto-passing", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            autoPassPlayers: ["p1"],
        });
        drainAutoPasses(state);
        // p1 auto-passes, priority goes to p2 (who is not auto-passing)
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.passCount).toBe(1);
    });

    it("advances phase when both players are auto-passing with empty stack", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            autoPassPlayers: ["p1", "p2"],
        });
        drainAutoPasses(state);
        // Both auto-pass → phase advances repeatedly until new turn clears autoPass
        expect(state.autoPassPlayers).toBeUndefined();
        expect(state.turn).toBe(2);
    });

    it("resolves stack when both players are auto-passing", () => {
        const bolt = makeStackItem(
            { name: "Lightning Bolt", types: ["Instant"] },
            "p1"
        );
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            stack: [bolt],
            autoPassPlayers: ["p1", "p2"],
        });
        drainAutoPasses(state);
        // Stack resolved, then phases advance until new turn
        expect(state.stack).toHaveLength(0);
        expect(state.autoPassPlayers).toBeUndefined();
    });

    it("stops when priority lands on non-auto-pass player", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            passCount: 1, // p1 already passed
            autoPassPlayers: ["p2"],
        });
        drainAutoPasses(state);
        // p2 auto-passes (passCount becomes 2), phase advances,
        // priority goes to p1 at BEGINNING_OF_COMBAT, p1 is not auto-passing → stop
        expect(state.phase).toBe("BEGINNING_OF_COMBAT");
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("clears autoPassPlayers when a new turn begins", () => {
        const state = makeGameState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            autoPassPlayers: ["p1", "p2"],
        });
        drainAutoPasses(state);
        expect(state.turn).toBe(2);
        expect(state.autoPassPlayers).toBeUndefined();
        // New turn: priority at UPKEEP, no more auto-passing
        expect(state.phase).toBe("UPKEEP");
    });

    it("only one player auto-passing: advances when both pass meet", () => {
        // p1 has priority, p2 is auto-passing. p1 calls passPriority manually,
        // then drain should auto-pass for p2 → both passed → advance phase
        const state = makeGameState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p2", // p1 just manually passed
            passCount: 1,
            autoPassPlayers: ["p2"],
        });
        drainAutoPasses(state);
        // p2 auto-passes (passCount = 2, stack empty) → advance to DRAW
        // At DRAW, p1 gets priority, not auto-passing → stop
        expect(state.phase).toBe("DRAW");
        expect(state.priorityPlayerId).toBe("p1");
    });
});
