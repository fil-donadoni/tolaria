import { describe, it, expect } from "vitest";
import {
    advancePhase,
    drainAutoPasses,
    isSorceryTiming,
    applyAllCombatDamage,
} from "../phases";
import type {
    GameState,
    PlayerState,
    CardInstanceState,
    StackItem,
} from "../state";
import type { Phase } from "../types";
import type { CardType } from "../../cards/types";
import { tryGetCardById } from "../../cards";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// SLIM card builder. Honors `overrides.card.id` and an optional inline
// `manaCost` for synthetic fixtures driving color-aware predicates;
// everything else is derived from the matching registry def when present.
function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const cardRef = overrides.card as
        | { id?: string; manaCost?: unknown }
        | undefined;
    const id = cardRef?.id ?? `synth-${crypto.randomUUID()}`;
    const def = tryGetCardById(id);
    const cardField: { id: string; manaCost?: unknown } = { id };
    if (cardRef?.manaCost !== undefined) {
        cardField.manaCost = cardRef.manaCost;
    }
    const rest: Partial<CardInstanceState> = { ...overrides };
    delete rest.card;
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardField,
        types: (overrides.types as CardType[]) ?? def?.types ?? [],
        subtypes: (overrides.subtypes as string[]) ?? def?.subtypes ?? [],
        power: overrides.power ?? def?.power,
        toughness: overrides.toughness ?? def?.toughness,
        staticAbilities:
            (overrides.staticAbilities as string[]) ??
            def?.staticAbilities ??
            [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...rest,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
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
        rngSeed: 0,
        rngCounter: 0,
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
            // Give defender a potential blocker so the phase isn't auto-skipped
            const p1 = state.players.find((p) => p.id === "p1")!;
            const p2 = state.players.find((p) => p.id === "p2")!;
            p1.battlefield.push(
                makeCard({
                    id: "c1",
                    types: ["Creature"],
                    isAttacking: true,
                })
            );
            p2.battlefield.push(
                makeCard({ id: "blocker", types: ["Creature"] })
            );
            advancePhase(state);
            expect(state.phase).toBe("DECLARE_BLOCKERS");
        });

        it("DECLARE_BLOCKERS auto-skips when all attackers are unblockable (landwalk, CR 702.13b)", () => {
            // Active player p1 attacks with a swampwalker; p2 defender
            // controls a Swamp → every attacker is unblockable, phase skips.
            const state = makeGameState({
                phase: "DECLARE_ATTACKERS",
                combat: {
                    attackerIds: ["wraith"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            const p2 = state.players.find((p) => p.id === "p2")!;
            p1.battlefield.push(
                makeCard({
                    id: "wraith",
                    types: ["Creature"],
                    power: 3,
                    toughness: 3,
                    staticAbilities: ["swampwalk"],
                    isAttacking: true,
                })
            );
            p2.battlefield.push(makeCard({ id: "bears", types: ["Creature"] }));
            p2.battlefield.push(
                makeCard({
                    id: "swamp-1",
                    types: ["Land"],
                    subtypes: ["Swamp"],
                })
            );
            const p2LifeBefore = p2.life;
            advancePhase(state);
            // Phase advances past DECLARE_BLOCKERS to combat damage, which
            // auto-applies (wraith unblocked → 3 damage to defender).
            expect(state.phase).not.toBe("DECLARE_BLOCKERS");
            expect(state.combat?.blockersConfirmed).toBe(true);
            expect(p2.life).toBe(p2LifeBefore - 3);
        });

        it("DECLARE_BLOCKERS auto-skips when all attackers fly and defender has no reach (CR 702.9b)", () => {
            const state = makeGameState({
                phase: "DECLARE_ATTACKERS",
                combat: {
                    attackerIds: ["serra"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            const p2 = state.players.find((p) => p.id === "p2")!;
            p1.battlefield.push(
                makeCard({
                    id: "serra",
                    types: ["Creature"],
                    power: 4,
                    toughness: 4,
                    staticAbilities: ["flying"],
                    isAttacking: true,
                })
            );
            p2.battlefield.push(makeCard({ id: "bears", types: ["Creature"] }));
            advancePhase(state);
            expect(state.phase).not.toBe("DECLARE_BLOCKERS");
            expect(state.combat?.blockersConfirmed).toBe(true);
        });

        it("DECLARE_BLOCKERS is NOT auto-skipped if defender has a reach creature vs flying", () => {
            const state = makeGameState({
                phase: "DECLARE_ATTACKERS",
                combat: {
                    attackerIds: ["serra"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            const p2 = state.players.find((p) => p.id === "p2")!;
            p1.battlefield.push(
                makeCard({
                    id: "serra",
                    types: ["Creature"],
                    staticAbilities: ["flying"],
                    isAttacking: true,
                })
            );
            p2.battlefield.push(
                makeCard({
                    id: "spider",
                    types: ["Creature"],
                    staticAbilities: ["reach"],
                })
            );
            advancePhase(state);
            expect(state.phase).toBe("DECLARE_BLOCKERS");
        });

        it("DECLARE_BLOCKERS → POSTCOMBAT_MAIN (no attackers)", () => {
            const state = makeGameState({ phase: "DECLARE_BLOCKERS" });
            advancePhase(state);
            expect(state.phase).toBe("POSTCOMBAT_MAIN");
        });

        it("DECLARE_BLOCKERS → COMBAT_DAMAGE (FIRST_STRIKE_DAMAGE skipped when no first/double strike)", () => {
            const state = makeGameState({
                phase: "DECLARE_BLOCKERS",
                combat: {
                    attackerIds: ["c1"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: true,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            p1.battlefield.push(
                makeCard({
                    id: "c1",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                    isAttacking: true,
                })
            );
            advancePhase(state);
            expect(state.phase).toBe("COMBAT_DAMAGE");
        });

        it("DECLARE_BLOCKERS → FIRST_STRIKE_DAMAGE when an attacker has first strike", () => {
            const state = makeGameState({
                phase: "DECLARE_BLOCKERS",
                combat: {
                    attackerIds: ["archer"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: true,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            p1.battlefield.push(
                makeCard({
                    id: "archer",
                    types: ["Creature"],
                    power: 2,
                    toughness: 1,
                    staticAbilities: ["first strike"],
                    isAttacking: true,
                })
            );
            advancePhase(state);
            expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        });

        it("DECLARE_BLOCKERS → FIRST_STRIKE_DAMAGE when a blocker has first strike", () => {
            const state = makeGameState({
                phase: "DECLARE_BLOCKERS",
                combat: {
                    attackerIds: ["bear"],
                    confirmed: true,
                    blockerAssignments: { wall: "bear" },
                    blockersConfirmed: true,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            const p2 = state.players.find((p) => p.id === "p2")!;
            p1.battlefield.push(
                makeCard({
                    id: "bear",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                    isAttacking: true,
                })
            );
            p2.battlefield.push(
                makeCard({
                    id: "wall",
                    types: ["Creature"],
                    power: 3,
                    toughness: 5,
                    staticAbilities: ["first strike"],
                    controllerId: "p2",
                    ownerId: "p2",
                    isBlocking: true,
                })
            );
            advancePhase(state);
            expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        });

        it("FIRST_STRIKE_DAMAGE applies only first/double strike damage; blocker killed first does not hit back", () => {
            const state = makeGameState({
                phase: "FIRST_STRIKE_DAMAGE",
                combat: {
                    attackerIds: ["archer"],
                    confirmed: true,
                    blockerAssignments: { bear: "archer" },
                    blockersConfirmed: true,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            const p2 = state.players.find((p) => p.id === "p2")!;
            p1.battlefield.push(
                makeCard({
                    id: "archer",
                    types: ["Creature"],
                    power: 2,
                    toughness: 1,
                    staticAbilities: ["first strike"],
                    isAttacking: true,
                })
            );
            p2.battlefield.push(
                makeCard({
                    id: "bear",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                    controllerId: "p2",
                    ownerId: "p2",
                    isBlocking: true,
                })
            );
            // Advance from DECLARE_BLOCKERS into FIRST_STRIKE_DAMAGE entry.
            // Simulate entry directly: performPhaseEntry for FIRST_STRIKE_DAMAGE
            // is invoked by advancePhase when transitioning into it. Here we
            // start in FIRST_STRIKE_DAMAGE so we walk one step back: set to
            // DECLARE_BLOCKERS → advancePhase.
            state.phase = "DECLARE_BLOCKERS";
            advancePhase(state);
            expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
            // Archer dealt 2 to bear (killed). Bear is now in graveyard and
            // cannot deal regular damage back.
            expect(p2.battlefield.find((c) => c.id === "bear")).toBeUndefined();
            expect(p2.graveyard.some((c) => c.id === "bear")).toBe(true);
            // Archer still alive and untouched entering FSD; regular damage
            // step pending.
            const archer = p1.battlefield.find((c) => c.id === "archer")!;
            expect(archer).toBeDefined();
            // Pass priority through FSD → COMBAT_DAMAGE → EOC; archer must
            // survive because bear is dead and does not hit back.
            state.phase = "FIRST_STRIKE_DAMAGE";
            advancePhase(state);
            expect(state.phase).toBe("COMBAT_DAMAGE");
            advancePhase(state);
            expect(state.phase).toBe("END_OF_COMBAT");
            expect(p1.battlefield.find((c) => c.id === "archer")).toBeDefined();
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

        it("resets landsPlayedThisTurn for both players (CR 117.2c / 305.2)", () => {
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
            });
            state.players[0].landsPlayedThisTurn = 1;
            state.players[1].landsPlayedThisTurn = 1;
            advancePhase(state);
            expect(state.players[0].landsPlayedThisTurn).toBe(0);
            expect(state.players[1].landsPlayedThisTurn).toBe(0);
        });

        it("per-player turn counter increments when player becomes active (CR 500.1)", () => {
            // Start: p1 is active and has already taken turn 1.
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
            });
            state.players[0].turnsTaken = 1;
            // End of p1's turn 1 → p2 begins their turn 1.
            advancePhase(state);
            expect(state.activePlayerId).toBe("p2");
            expect(state.players[0].turnsTaken).toBe(1);
            expect(state.players[1].turnsTaken).toBe(1);
            // Fast-forward to END_STEP again to advance to p1's turn 2.
            state.phase = "END_STEP";
            advancePhase(state);
            expect(state.activePlayerId).toBe("p1");
            expect(state.players[0].turnsTaken).toBe(2);
            expect(state.players[1].turnsTaken).toBe(1);
        });

        it("extra turn bumps the recipient's own counter (CR 500.7)", () => {
            // p1 has taken turn 2; an extra turn for p1 is queued.
            const state = makeGameState({
                phase: "END_STEP",
                turn: 3,
                activePlayerId: "p1",
            });
            state.players[0].turnsTaken = 2;
            state.players[1].turnsTaken = 1;
            state.extraTurns = ["p1"];
            advancePhase(state);
            // Same player takes another turn — their counter advances.
            expect(state.activePlayerId).toBe("p1");
            expect(state.players[0].turnsTaken).toBe(3);
            expect(state.players[1].turnsTaken).toBe(1);
            expect(state.extraTurns).toBeUndefined();
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

        it("clears chosenMana (manaChoices bookkeeping) during untap", () => {
            // Birds of Paradise stores its colour choice on the instance so
            // tapUntap can refund it. The untap step must wipe that record.
            const bird = makeCard({
                id: "bird1",
                card: {
                    name: "Birds of Paradise",
                    types: ["Creature"],
                    subtypes: ["Bird"],
                },
                controllerId: "p2",
                isTapped: true,
                chosenMana: { U: 1 },
            });

            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1" }),
                    makePlayer({
                        id: "p2",
                        battlefield: [bird],
                    }),
                ],
            });

            advancePhase(state);

            const p2 = state.players.find((p) => p.id === "p2")!;
            expect(p2.battlefield[0].chosenMana).toBeUndefined();
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
// Mana pool emptying — CR 500.4
// ---------------------------------------------------------------------------

describe("mana pool emptying (CR 500.4)", () => {
    it("empties both players' mana pools on phase change", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer({
                    id: "p1",
                    manaPool: { W: 3, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer({
                    id: "p2",
                    manaPool: { W: 0, U: 0, B: 2, R: 1, G: 0, C: 0 },
                }),
            ],
        });

        advancePhase(state);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p1.manaPool.W).toBe(0);
        expect(p2.manaPool.B).toBe(0);
        expect(p2.manaPool.R).toBe(0);
    });

    it("marks tapped lands as committed on phase change", () => {
        const tappedLand = makeCard({
            id: "tapped",
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
            isTapped: true,
            controllerId: "p1",
        });
        const untappedLand = makeCard({
            id: "untapped",
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
            isTapped: false,
            controllerId: "p1",
        });

        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [tappedLand, untappedLand],
                }),
                makePlayer({ id: "p2" }),
            ],
        });

        advancePhase(state);

        expect(tappedLand.manaCommitted).toBe(true);
        expect(untappedLand.manaCommitted).toBeUndefined();
    });

    it("manaCommitted is cleared at owner's untap step", () => {
        const land = makeCard({
            id: "land",
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
            isTapped: true,
            controllerId: "p1",
        });
        land.manaCommitted = true;

        // p1's turn about to end → p2 becomes active → p1 stays committed
        const state = makeGameState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer({ id: "p1", battlefield: [land] }),
                makePlayer({ id: "p2" }),
            ],
        });

        // END_STEP → CLEANUP → new turn (p2 active) → UNTAP (p2) → UPKEEP
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        // p1's land is still committed (not p1's untap step yet)
        expect(land.manaCommitted).toBe(true);
        expect(land.isTapped).toBe(true);

        // Walk through p2's full turn until p1's untap step
        const maxSteps = 20;
        for (let i = 0; i < maxSteps; i++) {
            advancePhase(state);
            if (state.activePlayerId === "p1" && state.phase === "UPKEEP")
                break;
        }

        // Now it's p1's turn — untap step ran
        expect(state.activePlayerId).toBe("p1");
        expect(land.manaCommitted).toBeUndefined();
        expect(land.isTapped).toBe(false);
    });

    it("empties mana pool on turn change (END_STEP → CLEANUP → UNTAP)", () => {
        const state = makeGameState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            players: [
                makePlayer({
                    id: "p1",
                    manaPool: { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer({
                    id: "p2",
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                }),
            ],
        });

        advancePhase(state);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p1.manaPool.W).toBe(0);
        expect(p2.manaPool.R).toBe(0);
    });

    it("active player's floating mana does not persist to combat", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            players: [
                makePlayer({
                    id: "p1",
                    manaPool: { W: 2, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer({ id: "p2" }),
            ],
        });

        advancePhase(state); // → BEGINNING_OF_COMBAT

        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.manaPool.W).toBe(0);
        expect(p1.manaPool.U).toBe(0);
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
        types: (cardData.types as CardType[]) ?? [],
        subtypes: (cardData.subtypes as string[]) ?? [],
        power: cardData.power as number | undefined,
        toughness: cardData.toughness as number | undefined,
        staticAbilities: (cardData.staticAbilities as string[]) ?? [],
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

    // -----------------------------------------------------------------------
    // singleShotAutoPass — one-shot skip for the caster after a spell hits
    // the stack (CR 117). Default behavior unless player holds Ctrl on cast.
    // -----------------------------------------------------------------------

    it("fires and is cleared when priority lands on the flagged player", () => {
        // p1 just cast Bolt: stack=[Bolt], priority=p2, flag=p1.
        // p2 passes manually → priority=p1 → singleShot fires → passCount=2 →
        // top resolves → priority back to active player (p1), flag cleared.
        const bolt = makeStackItem(
            { name: "Lightning Bolt", types: ["Instant"] },
            "p1"
        );
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 1,
            stack: [bolt],
            singleShotAutoPass: "p1",
        });
        drainAutoPasses(state);
        expect(state.stack).toHaveLength(0);
        expect(state.singleShotAutoPass).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("does not fire when priority is on the other player", () => {
        // p1 cast with default auto-skip (flag=p1) → priority=p2. p2 has
        // priority and is NOT flagged → drain must not fire.
        const bolt = makeStackItem(
            { name: "Lightning Bolt", types: ["Instant"] },
            "p1"
        );
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            passCount: 0,
            stack: [bolt],
            singleShotAutoPass: "p1",
        });
        drainAutoPasses(state);
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.passCount).toBe(0);
        expect(state.singleShotAutoPass).toBe("p1");
        expect(state.stack).toHaveLength(1);
    });

    it("clears on new turn", () => {
        const state = makeGameState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            autoPassPlayers: ["p1", "p2"],
            singleShotAutoPass: "p1",
        });
        drainAutoPasses(state);
        expect(state.turn).toBe(2);
        expect(state.singleShotAutoPass).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// applyAllCombatDamage — trample and blocker ordering
// ---------------------------------------------------------------------------

describe("applyAllCombatDamage", () => {
    /** Helper: create a combat state with attackers and blockers. */
    function makeCombatState(opts: {
        attackers: CardInstanceState[];
        blockers: CardInstanceState[];
        /** blockerId → attackerId */
        blockerAssignments: Record<string, string>;
    }) {
        const p1 = makePlayer({
            id: "p1",
            battlefield: opts.attackers,
        });
        const p2 = makePlayer({
            id: "p2",
            battlefield: opts.blockers,
        });
        return makeGameState({
            activePlayerId: "p1",
            phase: "COMBAT_DAMAGE",
            players: [p1, p2],
            combat: {
                attackerIds: opts.attackers.map((a) => a.id),
                confirmed: true,
                blockerAssignments: opts.blockerAssignments,
                blockersConfirmed: true,
            },
        });
    }

    it("without trample, blocked attacker deals no damage to defender", () => {
        const attacker = makeCard({
            id: "att",
            power: 4,
            toughness: 4,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = makeCard({
            id: "blk",
            power: 2,
            toughness: 2,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [blocker],
            blockerAssignments: { blk: "att" },
        });

        applyAllCombatDamage(state, { att: { blk: 4 } });

        // Defender takes no damage
        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(20);
        // Blocker dies (4 >= 2)
        expect(p2.battlefield).toHaveLength(0);
        expect(p2.graveyard).toHaveLength(1);
        // Attacker takes 2 from blocker, survives (2 < 4)
        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield).toHaveLength(1);
    });

    it("trample with 1 weaker blocker: excess damage to defender", () => {
        const attacker = makeCard({
            id: "att",
            power: 3,
            toughness: 3,
            staticAbilities: ["trample"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = makeCard({
            id: "blk",
            power: 1,
            toughness: 1,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [blocker],
            blockerAssignments: { blk: "att" },
        });

        // Assign 1 to blocker (lethal), 2 to defender (p2)
        applyAllCombatDamage(state, { att: { blk: 1, p2: 2 } });

        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(18); // 20 - 2
        expect(p2.battlefield).toHaveLength(0); // blocker dies
        expect(p2.graveyard).toHaveLength(1);
    });

    it("trample with blocker toughness >= power: 0 to defender", () => {
        const attacker = makeCard({
            id: "att",
            power: 2,
            toughness: 2,
            staticAbilities: ["trample"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = makeCard({
            id: "blk",
            power: 3,
            toughness: 3,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [blocker],
            blockerAssignments: { blk: "att" },
        });

        // All damage to blocker, none to defender
        applyAllCombatDamage(state, { att: { blk: 2 } });

        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(20); // No trample excess
        expect(p2.battlefield).toHaveLength(1); // blocker survives (2 < 3)
        // Attacker dies (3 >= 2)
        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield).toHaveLength(0);
    });

    it("trample unblocked: all damage to defender (same as no trample)", () => {
        const attacker = makeCard({
            id: "att",
            power: 3,
            toughness: 3,
            staticAbilities: ["trample"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [],
            blockerAssignments: {},
        });

        applyAllCombatDamage(state, {});

        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(17); // 20 - 3
    });

    it("trample multi-block: lethal to each blocker, excess to defender", () => {
        const attacker = makeCard({
            id: "att",
            power: 3,
            toughness: 3,
            staticAbilities: ["trample"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker1 = makeCard({
            id: "blk1",
            power: 1,
            toughness: 1,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker2 = makeCard({
            id: "blk2",
            power: 1,
            toughness: 1,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [blocker1, blocker2],
            blockerAssignments: { blk1: "att", blk2: "att" },
        });

        // 1 to blk1 (lethal), 1 to blk2 (lethal), 1 to defender
        applyAllCombatDamage(state, { att: { blk1: 1, blk2: 1, p2: 1 } });

        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(19); // 20 - 1
        expect(p2.battlefield).toHaveLength(0); // both blockers die
        expect(p2.graveyard).toHaveLength(2);
        // Attacker takes 1+1=2, survives (2 < 3)
        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield).toHaveLength(1);
    });

    it("trample multi-block: all damage to blockers, 0 to defender", () => {
        const attacker = makeCard({
            id: "att",
            power: 3,
            toughness: 3,
            staticAbilities: ["trample"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker1 = makeCard({
            id: "blk1",
            power: 1,
            toughness: 2,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker2 = makeCard({
            id: "blk2",
            power: 1,
            toughness: 2,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [blocker1, blocker2],
            blockerAssignments: { blk1: "att", blk2: "att" },
        });

        // 2 to blk1, 1 to blk2 — all damage used on blockers
        applyAllCombatDamage(state, { att: { blk1: 2, blk2: 1 } });

        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(20); // No trample excess
        // blk1 dies (2 >= 2), blk2 survives (1 < 2)
        expect(p2.battlefield).toHaveLength(1);
        expect(p2.graveyard).toHaveLength(1);
    });

    it("blocker damage is dealt correctly regardless of order", () => {
        const attacker = makeCard({
            id: "att",
            power: 5,
            toughness: 5,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker1 = makeCard({
            id: "blk1",
            power: 2,
            toughness: 2,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const blocker2 = makeCard({
            id: "blk2",
            power: 3,
            toughness: 3,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeCombatState({
            attackers: [attacker],
            blockers: [blocker1, blocker2],
            blockerAssignments: { blk1: "att", blk2: "att" },
        });

        // 2 to blk1 (lethal), 3 to blk2 (lethal)
        applyAllCombatDamage(state, { att: { blk1: 2, blk2: 3 } });

        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.life).toBe(20); // No trample, no excess
        expect(p2.battlefield).toHaveLength(0); // both die
        expect(p2.graveyard).toHaveLength(2);
        // Attacker takes 2+3=5, dies (5 >= 5)
        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield).toHaveLength(0);
    });
});
