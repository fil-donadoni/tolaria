import { describe, it, expect } from "vitest";
import {
    advancePhase,
    drainAutoPasses,
    isSorceryTiming,
    applyAllCombatDamage,
    effectiveMaxHandSize,
    finalizeCleanupDiscard,
} from "../phases";
import { phaseInUntapCycleBundles, resolveTopOfStack } from "../state";
import { cloakOfConfusion } from "../../cards/sets/ice/black";
import {
    getOpponentId,
    type GameState,
    type PlayerState,
    type CardInstanceState,
    type StackItem,
} from "../state";
import type { Phase } from "../types";
import type { CardType } from "../../cards/types";
import { tryGetDefinition } from "../../cards";
import { recordBlockedAttackers } from "../banding";
import { assertExpectedInput } from "../expectedInput";

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
    const def = tryGetDefinition(id);
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
    describe("mana emptying (CR 500.4 / 106.6)", () => {
        it("empties restricted mana when a step ends", () => {
            const state = makeGameState({ phase: "PRECOMBAT_MAIN" });
            state.players[0].restrictedMana = [
                { color: "G", amount: 3, restriction: "creature-spell" },
            ];
            advancePhase(state);
            expect(state.players[0].restrictedMana).toBeUndefined();
        });
    });

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

        it("DECLARE_BLOCKERS auto-skips when all attackers are unblockable (landwalk, CR 702.14b)", () => {
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

        it("unblockable auto-skip still fires 'attacks and isn't blocked' triggers (CR 509.1h — Cloak of Confusion regression)", () => {
            // p2 (defender) has NO creatures → declare-blockers auto-skips.
            // The Cloak-enchanted attacker's ATTACKER_UNBLOCKED trigger must
            // still reach the stack (a may-choice), not be dropped on the way
            // to combat damage.
            const state = makeGameState({
                phase: "DECLARE_ATTACKERS",
                combat: {
                    attackerIds: ["atk"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
            const p1 = state.players.find((p) => p.id === "p1")!;
            p1.battlefield.push(
                makeCard({
                    id: "atk",
                    types: ["Creature"],
                    power: 2,
                    toughness: 2,
                    isAttacking: true,
                })
            );
            p1.battlefield.push(
                makeCard({
                    id: "cloak",
                    card: { id: cloakOfConfusion.id },
                    types: ["Enchantment"],
                    subtypes: ["Aura"],
                    attachedTo: "atk",
                })
            );
            advancePhase(state);
            // The trigger parks the flow at declare-blockers with a live stack;
            // it must NOT have jumped straight to combat damage.
            expect(state.phase).toBe("DECLARE_BLOCKERS");
            expect(state.stack.length).toBe(1);
            expect(state.priorityPlayerId).toBe("p1");
            // Resolving the trigger opens the "may assign no combat damage"
            // option-pick for the attacking player.
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.kind).toBe("option-pick");
            expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
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
                    blockerAssignments: { wall: ["bear"] },
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
                    blockerAssignments: { bear: ["archer"] },
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

        it("Arboria (CR 508.1c): freezes the outgoing player's qualifying-action flag into lastTurn and resets thisTurn", () => {
            const state = makeGameState({
                phase: "END_STEP",
                activePlayerId: "p1",
            });
            // p1 (active, ending their turn) took a qualifying action.
            state.players[0].qualifyingActionThisTurn = true;
            advancePhase(state);
            // p1's turn ended → flag frozen into lastTurn, thisTurn cleared.
            const p1 = state.players.find((p) => p.id === "p1")!;
            expect(p1.qualifyingActionLastTurn).toBe(true);
            expect(p1.qualifyingActionThisTurn).toBeUndefined();
        });

        it("Arboria (CR 508.1c): an idle turn freezes a falsy lastTurn, forbidding attacks next turn", () => {
            const state = makeGameState({
                phase: "END_STEP",
                activePlayerId: "p1",
            });
            // p1 did nothing this turn (flag never set).
            advancePhase(state);
            const p1 = state.players.find((p) => p.id === "p1")!;
            expect(p1.qualifyingActionLastTurn).toBeFalsy();
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

        it("two accumulated skips (CR 614.10a) skip the next TWO turn occurrences, not one", () => {
            // p2 has two independent skip effects stacked against them
            // (issue #1957 — a boolean could only ever represent ONE pending
            // skip; this proves the count survives a single turn crossing
            // instead of collapsing to zero after the first).
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
            });
            state.players[1].skipNextTurn = 2;

            // Crossing 1: p1's END_STEP → CLEANUP → advanceTurn swaps to p2,
            // sees a pending skip, decrements 2→1 (still pending — CR
            // 614.10a: "one effect will be satisfied ... while the other
            // will remain"), and recurses past p2 back to p1.
            advancePhase(state);
            expect(state.activePlayerId).toBe("p1");
            expect(state.players[1].skipNextTurn).toBe(1);

            // Crossing 2: p1's SECOND END_STEP → CLEANUP → advanceTurn swaps
            // to p2 again, sees the remaining pending skip, decrements 1→0
            // (cleared), and recurses past p2 back to p1 again. p2 never
            // actively took a turn across either crossing.
            state.phase = "END_STEP";
            advancePhase(state);
            expect(state.activePlayerId).toBe("p1");
            expect(state.players[1].skipNextTurn).toBeUndefined();
        });

        it("a queued extra turn that is itself skipped: popped then skipped, next active is the opponent (CR 500.7 / 614.10a)", () => {
            // p1 has an extra turn queued (Time Walk-style) AND a pending
            // skip against them (Time Vault-style) at the same time. The
            // queued extra turn is popped first (CR 500.7) — THEN the skip
            // check fires against the popped player (CR 614.10a): the skip
            // consumes that very extra turn, not some later natural one.
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
            });
            state.extraTurns = ["p1"];
            state.players[0].skipNextTurn = 1;
            advancePhase(state);
            expect(state.activePlayerId).toBe("p2");
            expect(state.extraTurns).toBeUndefined();
            expect(state.players[0].skipNextTurn).toBeUndefined();
            expect(state.players[0].turnsTaken).toBeUndefined();
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

    describe("untap-cycle phasing (CR 702.26c/f)", () => {
        /** A phased-out `untap-cycle` bundle holding a single artifact
         *  controlled by `controllerId`, phased out on `phasedOutTurn`. Mirrors
         *  what `phaseOutPermanent` produces for Vision Charm mode 3. */
        function phasedArtifactBundle(
            controllerId: string,
            phasedOutTurn: number,
            opts: { tapped?: boolean } = {}
        ) {
            const art = makeCard({
                id: "art1",
                card: { name: "Ornithopter", types: ["Artifact"] },
                controllerId,
                ownerId: controllerId,
                isTapped: opts.tapped ?? false,
            });
            return {
                id: "bundle-uc",
                cards: [art],
                returnOn: { kind: "untap-cycle" as const },
                phasedOutTurn,
            };
        }

        it("phases the artifact back in on the controller's NEXT untap step (CR 702.26c)", () => {
            // p2's artifact phased out on turn 1; p2's next untap is turn 2.
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
                phasedOut: [phasedArtifactBundle("p2", 1, { tapped: true })],
            });

            // END_STEP → CLEANUP → turn 2 (p2 active) → UNTAP phases it in.
            advancePhase(state);

            expect(state.activePlayerId).toBe("p2");
            const p2 = state.players.find((p) => p.id === "p2")!;
            const art = p2.battlefield.find((c) => c.id === "art1");
            expect(art).toBeDefined();
            expect(state.phasedOut ?? []).toHaveLength(0);
            // CR 502.1 — phasing precedes the untap, so an artifact that phased
            // out tapped untaps this same untap step.
            expect(art!.isTapped).toBe(false);
        });

        it("does NOT phase in on the untap step of the turn it phased out (CR 702.26f skip-first)", () => {
            // Direct guard check: same turn → not eligible; a later turn → eligible.
            const state = makeGameState({
                turn: 3,
                activePlayerId: "p1",
                players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
                phasedOut: [phasedArtifactBundle("p1", 3)],
            });

            phaseInUntapCycleBundles(state, "p1");
            expect(state.phasedOut).toHaveLength(1); // same turn — still out

            state.turn = 5; // a later untap step of the same controller
            phaseInUntapCycleBundles(state, "p1");
            expect(state.phasedOut ?? []).toHaveLength(0); // now it returns
        });

        it("only phases in bundles controlled by the untapping player (CR 702.26g)", () => {
            // p2's bundle must not return on p1's untap step.
            const state = makeGameState({
                turn: 4,
                activePlayerId: "p1",
                players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
                phasedOut: [phasedArtifactBundle("p2", 1)],
            });

            phaseInUntapCycleBundles(state, "p1");
            expect(state.phasedOut).toHaveLength(1); // p2's bundle untouched

            phaseInUntapCycleBundles(state, "p2");
            expect(state.phasedOut ?? []).toHaveLength(0);
            expect(
                state.players
                    .find((p) => p.id === "p2")!
                    .battlefield.find((c) => c.id === "art1")
            ).toBeDefined();
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

    // CR 514.1 — the active player ends the turn via "Pass Turn" (auto-pass)
    // while holding more than their maximum hand size. The cleanup discard must
    // HALT the auto-pass drain in CLEANUP and hand the active player priority to
    // discard — not fast-forward into the opponent's UNTAP while the discard is
    // still owed (which surfaced as a discard prompt labelled "opponent's untap"
    // instead of "your cleanup").
    it("halts at the CLEANUP discard instead of skipping to the next turn", () => {
        const hand = Array.from({ length: 8 }, () =>
            makeCard({ zone: "hand" })
        );
        const state = makeGameState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            autoPassPlayers: ["p1", "p2"],
            players: [makePlayer({ id: "p1", hand }), makePlayer({ id: "p2" })],
        });
        drainAutoPasses(state);
        // Suspended in CLEANUP on the active player's discard, still their turn.
        expect(state.phase).toBe("CLEANUP");
        expect(state.turn).toBe(1);
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.pendingChoices?.[0]?.kind).toBe("discard-hand");
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

    // Pass Turn during attacker declaration: the active player auto-passes
    // while still owing the declare-attackers turn-based action. drainAutoPasses
    // must auto-confirm the current selection (tap + mark attacking) and then
    // fast-forward past combat — this is what the "Pass Turn" button (Enter)
    // relies on while isSelectingAttackers.
    it("auto-confirms the current attacker selection when the active player auto-passes", () => {
        const state = makeGameState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            autoPassPlayers: ["p1"],
            combat: {
                attackerIds: ["c1"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const p1 = state.players.find((p) => p.id === "p1")!;
        p1.battlefield.push(
            makeCard({ id: "c1", types: ["Creature"], power: 2, toughness: 2 })
        );

        drainAutoPasses(state);

        const c1 = p1.battlefield.find((c) => c.id === "c1")!;
        expect(c1.isAttacking).toBe(true);
        expect(c1.isTapped).toBe(true);
        // Selection committed, so combat is confirmed before fast-forwarding.
        expect(state.combat?.confirmed).toBe(true);
    });

    // Pass Turn must NEVER skip the defending player's block decision (CR 509.1).
    // A standing pass-turn / auto-pass intent that drains through an open
    // DECLARE_BLOCKERS step must HALT and hand the defender a real window —
    // mirroring the `passPriority` guard ("Must declare blockers before
    // passing priority"). It must not auto-confirm an empty block declaration.
    it("halts at DECLARE_BLOCKERS when the defender has a legal block, even while auto-passing", () => {
        const state = makeGameState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            // p1 (the attacker) pressed Pass Turn after declaring attackers.
            autoPassPlayers: ["p1", "p2"],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const p1 = state.players.find((p) => p.id === "p1")!;
        const p2 = state.players.find((p) => p.id === "p2")!;
        p1.battlefield.push(
            makeCard({
                id: "atk",
                types: ["Creature"],
                power: 2,
                toughness: 2,
                isAttacking: true,
            })
        );
        p2.battlefield.push(
            makeCard({ id: "blk", types: ["Creature"], power: 1, toughness: 1 })
        );

        drainAutoPasses(state);

        // Drain stopped at the block step instead of fast-forwarding through it.
        expect(state.phase).toBe("DECLARE_BLOCKERS");
        // Blockers were NOT auto-confirmed — the defender still gets to choose.
        expect(state.combat?.blockersConfirmed).toBe(false);
        // Priority is handed to the defending player for the block decision.
        expect(state.priorityPlayerId).toBe("p2");
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

    // -----------------------------------------------------------------------
    // queuedEndTurn — a "Pass Turn" (Enter) intent registered while the player
    // lacked priority. It is promoted into a rest-of-turn auto-pass the moment
    // priority next lands on the player (issue #157).
    // -----------------------------------------------------------------------

    it("promotes a queued intent to auto-pass when priority lands on the player", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            queuedEndTurn: ["p1"],
        });
        drainAutoPasses(state);
        // p1's queued intent fires: promoted to autoPassPlayers, then auto-passes.
        expect(state.queuedEndTurn).toBeUndefined();
        expect(state.autoPassPlayers).toEqual(["p1"]);
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.passCount).toBe(1);
    });

    it("leaves the intent untouched while priority is on the other player", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            passCount: 0,
            queuedEndTurn: ["p1"],
        });
        drainAutoPasses(state);
        // p2 is neither auto-passing nor queued → drain is a no-op; p1's
        // standing intent persists until priority next reaches p1.
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.passCount).toBe(0);
        expect(state.queuedEndTurn).toEqual(["p1"]);
        expect(state.autoPassPlayers).toBeUndefined();
    });

    it("merges into an existing auto-pass list without duplicating", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            passCount: 1,
            autoPassPlayers: ["p2"],
            queuedEndTurn: ["p2"],
        });
        drainAutoPasses(state);
        // p2 was already auto-passing; the queued entry is consumed (cleared)
        // and does not create a duplicate in autoPassPlayers.
        expect(state.queuedEndTurn).toBeUndefined();
        expect(state.autoPassPlayers).toEqual(["p2"]);
    });
});

// ---------------------------------------------------------------------------
// Pass Turn intent lifecycle (issue #157) — end-to-end across the simulated
// game.ts mutation handlers and the engine drain. These pure mirrors of
// `endTurn` / `passPriority` / `cancelAutoPass` keep the test free of a Convex
// context (same precedent as activation-flow.test.ts).
// ---------------------------------------------------------------------------

// Mirrors the no-priority queue branch + has-priority auto-pass branch of the
// production `endTurn` mutation (convex/game.ts).
function simEndTurn(state: GameState, playerId: string): void {
    if (state.priorityPlayerId !== playerId) {
        const queued = state.queuedEndTurn ?? [];
        if (!queued.includes(playerId)) queued.push(playerId);
        state.queuedEndTurn = queued;
        return;
    }
    const autoPass = state.autoPassPlayers ?? [];
    if (!autoPass.includes(playerId)) autoPass.push(playerId);
    state.autoPassPlayers = autoPass;
    drainAutoPasses(state);
}

// Mirrors the tail of the production `passPriority` mutation.
function simPassPriority(state: GameState, playerId: string): void {
    state.passCount += 1;
    if (state.passCount >= 2 && state.stack.length === 0) {
        advancePhase(state);
    } else if (state.passCount >= 2 && state.stack.length > 0) {
        // (no stack in these scenarios — kept for fidelity)
    } else {
        state.priorityPlayerId = getOpponentId(state, playerId);
    }
    drainAutoPasses(state);
}

// Mirrors the head guards of the production `passPriority` mutation. The
// wrong-player early return MUST run BEFORE `assertExpectedInput`, otherwise
// the gate's "waiting for priority input from another player" throw shadows
// the benign misclick and Convex logs a server error for a harmless Space
// press during the opponent's priority. Returns true if the mutation would
// proceed to mutate state, false if it silently no-ops.
function simPassPriorityHead(state: GameState, playerId: string): boolean {
    if (state.priorityPlayerId !== playerId) return false;
    assertExpectedInput(state, { playerId, expect: "priority" });
    return true;
}

// Mirrors the production `cancelAutoPass` mutation.
function simCancelAutoPass(state: GameState, playerId: string): void {
    const autoPass = state.autoPassPlayers ?? [];
    const queued = state.queuedEndTurn ?? [];
    const wasAuto = autoPass.includes(playerId);
    const wasSingle = state.singleShotAutoPass === playerId;
    const wasQueued = queued.includes(playerId);
    if (!wasAuto && !wasSingle && !wasQueued) return;
    if (wasAuto) {
        const r = autoPass.filter((id) => id !== playerId);
        state.autoPassPlayers = r.length > 0 ? r : undefined;
    }
    if (wasSingle) state.singleShotAutoPass = undefined;
    if (wasQueued) {
        const r = queued.filter((id) => id !== playerId);
        state.queuedEndTurn = r.length > 0 ? r : undefined;
    }
}

describe("Pass Turn intent lifecycle (issue #157)", () => {
    it("queues when pressed without priority, then fires when priority returns", () => {
        // p1 is the active player and holds priority; p2 (no priority) presses
        // Enter to pass the turn.
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
        });

        simEndTurn(state, "p2");
        // Not a no-op: a standing intent is recorded and nothing else moves yet.
        expect(state.queuedEndTurn).toEqual(["p2"]);
        expect(state.autoPassPlayers).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");

        // p1 passes priority → it lands on p2 → the queued intent fires.
        simPassPriority(state, "p1");
        expect(state.queuedEndTurn).toBeUndefined();
        expect(state.autoPassPlayers).toContain("p2");
        // p2 now auto-passes the rest of the turn, so the game has progressed
        // past p1's precombat main.
        expect(state.phase).not.toBe("PRECOMBAT_MAIN");
    });

    it("can be cancelled before it fires", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
        });

        simEndTurn(state, "p2");
        expect(state.queuedEndTurn).toEqual(["p2"]);

        simCancelAutoPass(state, "p2");
        expect(state.queuedEndTurn).toBeUndefined();

        // Priority returning to p2 no longer triggers an auto-pass.
        simPassPriority(state, "p1");
        expect(state.priorityPlayerId).toBe("p2");
        expect(state.autoPassPlayers).toBeUndefined();
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
        /** blockerId → attackerIds */
        blockerAssignments: Record<string, string[]>;
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
            blockerAssignments: { blk: ["att"] },
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
            blockerAssignments: { blk: ["att"] },
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
            blockerAssignments: { blk: ["att"] },
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
            blockerAssignments: { blk1: ["att"], blk2: ["att"] },
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
            blockerAssignments: { blk1: ["att"], blk2: ["att"] },
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
            blockerAssignments: { blk1: ["att"], blk2: ["att"] },
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

// ---------------------------------------------------------------------------
// "Blocked" is combat state, not the live blocker count (issue #172,
// CR 509.1h, 510.1c)
// ---------------------------------------------------------------------------

describe("blocked is combat state, not blocker count (CR 509.1h/510.1c)", () => {
    /** Build a combat-damage state. `blockedAttackerIds` records which
     *  attackers became blocked this combat (normally set at declare-blockers).
     *  Blockers listed in `blockerAssignments` but absent from `blockers` model
     *  a blocker that left combat (e.g. killed) after blocks were locked in. */
    function makeState(opts: {
        attackers: CardInstanceState[];
        blockers: CardInstanceState[];
        blockerAssignments: Record<string, string[]>;
        blockedAttackerIds?: string[];
    }) {
        return makeGameState({
            activePlayerId: "p1",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer({ id: "p1", battlefield: opts.attackers }),
                makePlayer({ id: "p2", battlefield: opts.blockers }),
            ],
            combat: {
                attackerIds: opts.attackers.map((a) => a.id),
                confirmed: true,
                blockerAssignments: opts.blockerAssignments,
                blockedAttackerIds: opts.blockedAttackerIds,
                blockersConfirmed: true,
            },
        });
    }

    const attacker = (
        overrides: Partial<Parameters<typeof makeCard>[0]> = {}
    ) =>
        makeCard({
            id: "att",
            power: 3,
            toughness: 3,
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            ...overrides,
        });

    it("a never-blocked attacker hits the defender", () => {
        const state = makeState({
            attackers: [attacker()],
            blockers: [],
            blockerAssignments: {},
            // not recorded as blocked
        });

        applyAllCombatDamage(state, {});

        expect(state.players.find((p) => p.id === "p2")!.life).toBe(17);
    });

    it("an attacker that became blocked and lost all blockers deals NO damage to the defender (no trample)", () => {
        // Blocker "blk" is gone from the battlefield (killed after blocking),
        // but the attacker is still recorded as blocked.
        const state = makeState({
            attackers: [attacker()],
            blockers: [],
            blockerAssignments: { blk: ["att"] },
            blockedAttackerIds: ["att"],
        });

        applyAllCombatDamage(state, {});

        expect(state.players.find((p) => p.id === "p2")!.life).toBe(20);
    });

    it("same case WITH trample deals full damage to the defender (CR 510.1c)", () => {
        const state = makeState({
            attackers: [attacker({ staticAbilities: ["trample"] })],
            blockers: [],
            blockerAssignments: { blk: ["att"] },
            blockedAttackerIds: ["att"],
        });

        applyAllCombatDamage(state, {});

        // No blocker left to absorb lethal — the full 3 tramples through.
        expect(state.players.find((p) => p.id === "p2")!.life).toBe(17);
    });

    it("a recorded-blocked attacker that still has a live blocker deals to the blocker, not the defender", () => {
        const blocker = makeCard({
            id: "blk",
            power: 1,
            toughness: 3,
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            attackers: [attacker()],
            blockers: [blocker],
            blockerAssignments: { blk: ["att"] },
            blockedAttackerIds: ["att"],
        });

        applyAllCombatDamage(state, { att: { blk: 3 } });

        expect(state.players.find((p) => p.id === "p2")!.life).toBe(20);
        // blocker dies (3 >= 3)
        expect(
            state.players.find((p) => p.id === "p2")!.graveyard
        ).toHaveLength(1);
    });

    it("recordBlockedAttackers records exactly the attackers with a blocker", () => {
        const state = makeState({
            attackers: [attacker({ id: "att" }), attacker({ id: "att2" })],
            blockers: [
                makeCard({
                    id: "blk",
                    power: 1,
                    toughness: 1,
                    staticAbilities: [],
                    controllerId: "p2",
                    ownerId: "p2",
                }),
            ],
            blockerAssignments: { blk: ["att"] },
        });

        recordBlockedAttackers(state);

        // att is blocked; att2 was never blocked.
        expect(state.combat!.blockedAttackerIds).toEqual(["att"]);
    });
});

// ---------------------------------------------------------------------------
// Cleanup discard (CR 514.1)
// ---------------------------------------------------------------------------

describe("cleanup discard (CR 514.1)", () => {
    function handOf(n: number): CardInstanceState[] {
        return Array.from({ length: n }, (_, i) =>
            makeCard({ id: `hand-${i}`, zone: "hand", ownerId: "p1" })
        );
    }

    describe("effectiveMaxHandSize", () => {
        it("defaults to 7 when no override is set (CR 402.2)", () => {
            expect(effectiveMaxHandSize(makePlayer())).toBe(7);
        });

        it("returns Infinity for unlimited (Library of Leng)", () => {
            const p = makePlayer({ maxHandSizeOverride: "unlimited" });
            expect(effectiveMaxHandSize(p)).toBe(Infinity);
        });

        it("returns the numeric override when set", () => {
            const p = makePlayer({ maxHandSizeOverride: 5 });
            expect(effectiveMaxHandSize(p)).toBe(5);
        });
    });

    describe("CLEANUP entry", () => {
        function endStepState(handSize: number): GameState {
            const p1 = makePlayer({ id: "p1", hand: handOf(handSize) });
            return makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [p1, makePlayer({ id: "p2" })],
            });
        }

        it("8 cards in hand → suspends CLEANUP with a discard-hand prompt for 1", () => {
            const state = endStepState(8);
            const traversed = advancePhase(state);

            // The recursion stopped at CLEANUP because of the suspension.
            expect(state.phase).toBe("CLEANUP");
            expect(traversed).toEqual(["CLEANUP"]);
            expect(state.pendingCleanupDiscard).toEqual({ playerId: "p1" });
            expect(state.pendingChoices?.length).toBe(1);
            const choice = state.pendingChoices![0];
            expect(choice.kind).toBe("discard-hand");
            expect(choice.stackItemId).toBe("");
            expect(choice.zone).toBe("hand");
            expect(choice.count).toBe(1);
            expect(choice.playerId).toBe("p1");
            expect(state.priorityPlayerId).toBe("p1");
        });

        it("10 cards in hand → count is 3 (excess)", () => {
            const state = endStepState(10);
            advancePhase(state);
            expect(state.pendingChoices![0].count).toBe(3);
        });

        it("exactly 7 cards → no prompt, advances cleanly to next turn UPKEEP", () => {
            const state = endStepState(7);
            const traversed = advancePhase(state);

            expect(state.pendingCleanupDiscard).toBeUndefined();
            expect(state.pendingChoices).toBeUndefined();
            expect(state.phase).toBe("UPKEEP");
            expect(traversed).toEqual(["CLEANUP", "UNTAP", "UPKEEP"]);
        });

        it("maxHandSizeOverride='unlimited' suppresses the prompt entirely", () => {
            const state = endStepState(12);
            state.players[0].maxHandSizeOverride = "unlimited";
            advancePhase(state);
            expect(state.pendingCleanupDiscard).toBeUndefined();
            expect(state.pendingChoices).toBeUndefined();
            expect(state.phase).toBe("UPKEEP");
        });

        it("numeric maxHandSizeOverride lowers the threshold", () => {
            const state = endStepState(8);
            state.players[0].maxHandSizeOverride = 5;
            advancePhase(state);
            // hand 8, cap 5 → discard 3.
            expect(state.pendingChoices![0].count).toBe(3);
        });

        it("non-active player's oversized hand is ignored (CR 514.1 is AP-only)", () => {
            const state = endStepState(4);
            state.players[1].hand = handOf(20);
            advancePhase(state);
            expect(state.pendingCleanupDiscard).toBeUndefined();
            expect(state.phase).toBe("UPKEEP");
        });
    });

    describe("phase ordering (CR 514.1 before 514.2)", () => {
        it("'until end of turn' grants are still present when the discard prompt is enqueued", () => {
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1", hand: handOf(8) }),
                    makePlayer({ id: "p2" }),
                ],
            });
            // Mirror a Channel-style "until end of turn" grant on p1.
            state.players[0].grantedAbilities = [
                {
                    id: "grant-1",
                    abilityId: "channel-mana",
                    sourceCardId: "channel",
                    duration: { phase: "end-of-turn", playerId: "p1" },
                    grantedAtTurn: 1,
                },
            ];
            advancePhase(state);

            // The grant must survive 514.1; tickAllDurations runs only in 514.2.
            expect(state.players[0].grantedAbilities).toBeDefined();
            expect(state.pendingCleanupDiscard).toEqual({ playerId: "p1" });
        });
    });

    describe("finalizeCleanupDiscard (post-commit resume)", () => {
        it("moves the picks to graveyard, clears the cursor, and lands on next turn UPKEEP", () => {
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1", hand: handOf(9) }),
                    makePlayer({ id: "p2" }),
                ],
            });
            advancePhase(state);
            expect(state.pendingChoices![0].count).toBe(2);

            const toDiscard = [
                state.players[0].hand[0].id,
                state.players[0].hand[1].id,
            ];
            finalizeCleanupDiscard(state, toDiscard);

            expect(state.pendingCleanupDiscard).toBeUndefined();
            expect(state.pendingChoices).toBeUndefined();
            expect(state.players[0].hand.length).toBe(7);
            expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual(
                toDiscard.sort()
            );
            // Cleanup completed → advanced into next turn's UPKEEP.
            expect(state.phase).toBe("UPKEEP");
            expect(state.activePlayerId).toBe("p2");
            expect(state.turn).toBe(2);
        });

        it("CR 514.2 actions run after the discard (damage marks wiped)", () => {
            const damagedCreature = makeCard({
                id: "wounded",
                zone: "battlefield",
                ownerId: "p1",
                controllerId: "p1",
                types: ["Creature"],
                power: 2,
                toughness: 3,
                damageMarked: 1,
            });
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({
                        id: "p1",
                        hand: handOf(8),
                        battlefield: [damagedCreature],
                    }),
                    makePlayer({ id: "p2" }),
                ],
            });
            advancePhase(state);
            // 514.1 runs first — damage must still be on the creature here.
            expect(state.players[0].battlefield[0].damageMarked).toBe(1);

            finalizeCleanupDiscard(state, [state.players[0].hand[0].id]);

            // 514.2 ran after the discard committed.
            expect(
                state.players[0].battlefield[0].damageMarked
            ).toBeUndefined();
        });

        // ADR 0026 (revised) — the CR 514.1 cleanup discard does NOT clear a
        // non-owner knower's knowledge of the REMAINING hand. Knowledge is
        // per-instance and the discarded cards go to the public graveyard, so
        // every card left in hand stays identifiable to the prior knower (p2).
        // Only a genuine uncertainty event (shuffle) revokes hand knowledge.
        it("keeps non-owner knownTo over the remaining hand after a cleanup discard (ADR 0026 revised)", () => {
            const hand = handOf(9);
            // p2 legitimately learned p1's hand (e.g. via Glasses of Urza).
            for (const c of hand) c.knownTo = ["p2"];
            const discardedIds = [hand[0].id, hand[1].id];
            const state = makeGameState({
                phase: "END_STEP",
                turn: 1,
                activePlayerId: "p1",
                players: [
                    makePlayer({ id: "p1", hand }),
                    makePlayer({ id: "p2" }),
                ],
            });
            advancePhase(state);
            // Discard down to 7 — p1 chooses two cards.
            finalizeCleanupDiscard(state, discardedIds);

            // Every card still in p1's hand remains known to p2 — the discard of
            // two other cards introduced no uncertainty about the rest.
            expect(state.players[0].hand.length).toBe(7);
            for (const c of state.players[0].hand) {
                expect(c.knownTo).toEqual(["p2"]);
            }
            // Sanity: the two discarded instances actually left the hand.
            for (const id of discardedIds) {
                expect(state.players[0].hand.some((c) => c.id === id)).toBe(
                    false
                );
            }
        });
    });
});

describe("passPriority wrong-player guard (ADR 0047)", () => {
    it("silently no-ops a pass while the opponent holds priority — no throw", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
        });

        // p2 mashes Space while p1 holds priority. The head guard returns
        // before reaching assertExpectedInput, so no "waiting for priority
        // input from another player" error is thrown.
        let proceeds = true;
        expect(() => {
            proceeds = simPassPriorityHead(state, "p2");
        }).not.toThrow();
        expect(proceeds).toBe(false);
    });

    it("proceeds through the gate when the passing player holds priority", () => {
        const state = makeGameState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
        });

        expect(simPassPriorityHead(state, "p1")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Cleanup-step delayed triggers (CR 514.3 / 514.3a / 603.7)
// ---------------------------------------------------------------------------
//
// CR 514.3: "Normally, no player receives priority during the cleanup step, so
// no spells can be cast and no abilities can be activated. However, this rule
// is subject to the following exception:"
//
// CR 514.3a: "At this point, the game checks to see if any state-based actions
// would be performed and/or any triggered abilities are waiting to be put onto
// the stack (including those that trigger 'at the beginning of the next cleanup
// step'). If so, those state-based actions are performed, then those triggered
// abilities are put on the stack, then the active player gets priority. Players
// may cast spells and activate abilities. Once the stack is empty and all
// players pass in succession, another cleanup step begins."

describe("cleanup-step delayed triggers (CR 514.3a / 603.7)", () => {
    function cleanupHand(n: number): CardInstanceState[] {
        return Array.from({ length: n }, (_, i) =>
            makeCard({ id: `cl-hand-${i}`, zone: "hand", ownerId: "p1" })
        );
    }

    function endStepState(handSize = 0): GameState {
        return makeGameState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer({ id: "p1", hand: cleanupHand(handSize) }),
                makePlayer({ id: "p2" }),
            ],
        });
    }

    /** A `next-cleanup-step` delayed trigger with an inline body (ADR 0048)
     *  whose only effect is observable in one field. */
    function scheduleCleanupTrigger(state: GameState, id: string): void {
        state.delayedTriggers = [
            ...(state.delayedTriggers ?? []),
            {
                id,
                sourceCardId: cloakOfConfusion.id,
                triggerId: "$inline-effects",
                controller: "p1",
                timing: "next-cleanup-step",
                payload: {},
                effects: [{ op: "gainLife", player: "controller", amount: 1 }],
                oracleText:
                    "At the beginning of the next cleanup step, you gain 1 life.",
            },
        ];
    }

    it("fires at CLEANUP, stacks the ability and hands the active player priority", () => {
        const state = endStepState();
        scheduleCleanupTrigger(state, "dt-cleanup-1");

        const traversed = advancePhase(state);

        // CR 514.3a — the trigger is on the stack and the active player has
        // priority. The step must NOT have been recursed past: `advancePhase`
        // treats CLEANUP as an auto-phase, and without the cleanup-window guard
        // the turn would have rolled over and discarded this window silently.
        expect(traversed).toEqual(["CLEANUP"]);
        expect(state.phase).toBe("CLEANUP");
        expect(state.turn).toBe(1);
        expect(state.activePlayerId).toBe("p1");
        expect(state.stack.length).toBe(1);
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.passCount).toBe(0);
        expect(state.pendingExtraCleanupStep).toBe(true);
        // CR 603.7b — a single-shot delayed trigger is dequeued by firing.
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("leaves cleanup priority-less and single when nothing triggers (CR 514.3)", () => {
        const state = endStepState();

        const traversed = advancePhase(state);

        expect(traversed).toEqual(["CLEANUP", "UNTAP", "UPKEEP"]);
        expect(state.phase).toBe("UPKEEP");
        expect(state.turn).toBe(2);
        expect(state.stack.length).toBe(0);
        expect(state.pendingExtraCleanupStep).toBeUndefined();
    });

    it("begins another cleanup step once the stack empties and all players pass", () => {
        const state = endStepState();
        state.players[0].battlefield = [
            makeCard({
                id: "bear",
                types: ["Creature"],
                power: 2,
                toughness: 2,
            }),
        ];
        scheduleCleanupTrigger(state, "dt-cleanup-1");
        advancePhase(state);

        // Resolve the cleanup trigger through the real stack machinery.
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
        expect(state.stack.length).toBe(0);
        // Something damaged the bear during the 514.3a priority window. The
        // ADDITIONAL cleanup step must wipe it (CR 514.2 runs again) — proof
        // that a real second step ran rather than a jump to the next turn.
        state.players[0].battlefield[0].damageMarked = 1;

        // Both players pass with an empty stack → `passPriority`'s advance.
        const traversed = advancePhase(state);

        expect(traversed[0]).toBe("CLEANUP");
        expect(state.players[0].battlefield[0].damageMarked).toBeUndefined();
        // Nothing new triggered in the additional step, so it stays
        // priority-less and the turn ends — the loop terminates.
        expect(traversed).toEqual(["CLEANUP", "UNTAP", "UPKEEP"]);
        expect(state.phase).toBe("UPKEEP");
        expect(state.turn).toBe(2);
        expect(state.pendingExtraCleanupStep).toBeUndefined();
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("re-runs the CR 514.1 hand-size discard in the additional cleanup step", () => {
        const state = endStepState();
        scheduleCleanupTrigger(state, "dt-cleanup-1");
        advancePhase(state);
        resolveTopOfStack(state);

        // The active player drew into an oversized hand during the 514.3a
        // window; the additional cleanup step re-runs 514.1 on it.
        state.players[0].hand = cleanupHand(10);

        const traversed = advancePhase(state);

        expect(traversed).toEqual(["CLEANUP"]);
        expect(state.phase).toBe("CLEANUP");
        expect(state.turn).toBe(1);
        expect(state.pendingCleanupDiscard).toEqual({ playerId: "p1" });
        expect(state.pendingChoices?.length).toBe(1);
        expect(state.pendingChoices![0].kind).toBe("discard-hand");
        expect(state.pendingChoices![0].count).toBe(3);
    });

    it("does not re-fire the dequeued instance, so the repeat terminates", () => {
        const state = endStepState();
        scheduleCleanupTrigger(state, "dt-cleanup-1");
        advancePhase(state);
        resolveTopOfStack(state);

        advancePhase(state);

        // One firing only: life went 20 → 21, not 22.
        expect(state.players[0].life).toBe(21);
        expect(state.stack.length).toBe(0);
        expect(state.phase).toBe("UPKEEP");
        expect(state.turn).toBe(2);
    });

    it("survives the CR 514.2 watch purge that expires the this-turn watches", () => {
        const state = endStepState();
        state.delayedTriggers = [
            {
                id: "dt-leave-1",
                sourceCardId: cloakOfConfusion.id,
                triggerId: "$inline-effects",
                controller: "p1",
                timing: "leaves-battlefield",
                payload: {},
                watchInstanceId: "gone",
                effects: [{ op: "gainLife", player: "controller", amount: 5 }],
                oracleText:
                    "When that creature leaves the battlefield this turn, you gain 5 life.",
            },
        ];
        scheduleCleanupTrigger(state, "dt-cleanup-1");

        advancePhase(state);

        // The this-turn leave-watch expired unfired in `finalizeCleanup`; the
        // step-boundary cleanup timing fired instead of being swept with it.
        expect(state.stack.length).toBe(1);
        expect(state.phase).toBe("CLEANUP");
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("composes with the CR 514.1 discard suspend/resume path", () => {
        const state = endStepState(8);
        scheduleCleanupTrigger(state, "dt-cleanup-1");

        advancePhase(state);

        // 514.1 comes first: the step suspends on the discard prompt and the
        // cleanup trigger has NOT fired yet.
        expect(state.phase).toBe("CLEANUP");
        expect(state.pendingChoices?.length).toBe(1);
        expect(state.stack.length).toBe(0);
        expect(state.delayedTriggers?.length).toBe(1);

        finalizeCleanupDiscard(state, [state.players[0].hand[0].id]);

        // Resumed out of the commit handler: 514.2 then the 514.3a check.
        expect(state.players[0].hand.length).toBe(7);
        expect(state.phase).toBe("CLEANUP");
        expect(state.turn).toBe(1);
        expect(state.stack.length).toBe(1);
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.pendingExtraCleanupStep).toBe(true);
        expect(state.delayedTriggers).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // `finalizeCleanup` idempotency across the additional cleanup step.
    //
    // CR 514.3a's "another cleanup step begins" makes `finalizeCleanup` run
    // more than once per turn. Every CR 514.2 turn-based action genuinely
    // re-runs (removing damage that is already gone is a no-op); the engine
    // bookkeeping keyed to the TURN must not. Both cases below assert the
    // once-per-turn half through the real `advancePhase` machinery.
    // -----------------------------------------------------------------------

    it("keeps attackedDuringLastTurn across the additional cleanup step (CR 514.2)", () => {
        const state = endStepState();
        state.players[0].battlefield = [
            makeCard({
                id: "turtle",
                types: ["Creature"],
                power: 1,
                toughness: 3,
                hasAttackedThisTurn: true,
            }),
        ];
        scheduleCleanupTrigger(state, "dt-cleanup-1");

        advancePhase(state);

        // First cleanup step: the history rolled forward and the this-turn
        // flag was cleared (CR 508.1 / 514.2).
        const turtle = state.players[0].battlefield[0];
        expect(turtle.hasAttackedThisTurn).toBeUndefined();
        expect(turtle.attackedDuringLastTurn).toBe(true);

        resolveTopOfStack(state);
        advancePhase(state);

        // The additional cleanup step ran and the turn then ended. The
        // roll-forward reads a flag the FIRST pass already cleared, so a
        // second unguarded pass would blank the history for every creature
        // the active player controls — silently letting Giant Turtle (LEG)
        // attack on consecutive turns and Halls of Mist (ICE) stop forbidding.
        expect(state.turn).toBe(2);
        expect(state.players[0].battlefield[0].attackedDuringLastTurn).toBe(
            true
        );
    });

    it("ticks a skip-bearing duration once per TURN, not once per cleanup step (CR 514.2)", () => {
        const state = endStepState();
        // "until end of your next turn" (`DurationSpec`, cards/types.ts): the
        // first end-of-turn boundary is SKIPPED, the second expires the grant.
        state.players[0].grantedAbilities = [
            {
                id: "grant-1",
                sourceCardId: cloakOfConfusion.id,
                abilityId: "cloak-of-confusion-a1",
                duration: { phase: "end-of-turn", skip: 1 },
                grantedAtTurn: 1,
            },
        ];
        scheduleCleanupTrigger(state, "dt-cleanup-1");

        advancePhase(state);

        // One tick consumed by this turn's cleanup: still armed, `skip` gone.
        expect(state.players[0].grantedAbilities?.[0].duration).toEqual({
            phase: "end-of-turn",
        });

        resolveTopOfStack(state);
        advancePhase(state);

        expect(state.turn).toBe(2);
        // The additional cleanup step must NOT consume the second tick — that
        // would expire an "until end of your next turn" grant a full turn
        // early. `tickDuration` decrements a counter, so it is once-per-turn
        // bookkeeping, not a repeatable CR 514.2 turn-based action.
        expect(state.players[0].grantedAbilities?.[0].duration).toEqual({
            phase: "end-of-turn",
        });
    });

    it("still re-runs the repeatable CR 514.2 turn-based actions in the additional step", () => {
        const state = endStepState();
        state.players[0].battlefield = [
            makeCard({
                id: "bear",
                types: ["Creature"],
                power: 2,
                toughness: 2,
                hasAttackedThisTurn: true,
            }),
        ];
        scheduleCleanupTrigger(state, "dt-cleanup-1");
        advancePhase(state);
        resolveTopOfStack(state);

        // Damage marked during the 514.3a priority window, a fresh "this turn"
        // combat flag, and a turn-scoped lock re-armed in that window: the
        // additional step's CR 514.2 pass owes all three a wipe. Gating the
        // once-per-turn bookkeeping must not turn the whole function — or the
        // whole `tickAllDurations` call — into a one-shot.
        state.players[0].battlefield[0].damageMarked = 1;
        state.players[0].battlefield[0].cantBlockThisTurn = true;
        // CR 601.3a — cleared ONLY at the CLEANUP boundary (`tickAllDurations`
        // gates it on `view.phase === "CLEANUP"`), so unlike the flags cleared
        // on every tick this one genuinely leaks into the next turn if the
        // additional cleanup step skips the call.
        state.cannotCastSpellsThisTurn = [{ playerId: "p2" }];

        advancePhase(state);

        expect(state.players[0].battlefield[0].damageMarked).toBeUndefined();
        expect(
            state.players[0].battlefield[0].cantBlockThisTurn
        ).toBeUndefined();
        expect(state.cannotCastSpellsThisTurn).toBeUndefined();
    });
});
