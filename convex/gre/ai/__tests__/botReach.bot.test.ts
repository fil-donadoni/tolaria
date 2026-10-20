// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — core verdict classes and determinism.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition } from "../../../cards/types";
import { applyMoveInSearch, decidingPlayer, policyValue } from "../../search";
import { cloneGameState } from "../../clone";
import { determinize } from "../../determinize";
import { makeRng } from "../../rng";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import {
    BOT_REACH_BUDGET,
    OPPONENT_END_STEP_WINDOW,
    botReachSpec,
    buildBotReachState,
    classifyNoMove,
    playBotReach,
} from "../botReach";
import {
    NO_OP_SORCERY,
    SELF_DRAIN_SORCERY,
    UNTARGETABLE_INSTANT,
    HASTE_CREATURE,
    FLASH_AURA_DOUBLE_STRIKE,
    FLASH_AURA_SHROUD,
    EDICT_INSTANT,
    RAISE_DEAD_CREATURE,
    DRAW_SORCERY,
    SACRIFICE_DRAW_SORCERY,
    MODAL_DRAW_SORCERY,
    OPPONENT_DRAW_SORCERY,
} from "./botReachPlay.fixture";

describe("Bot-play sweep (ADR 0105 § 7.2) — core verdict classes and determinism", () => {
    // The blade determinism contract (same definition + same Bot ⇒ same
    // verdict), pinned ONCE per verdict class here instead of by replaying
    // every fixture twice (issue #6148). `frozen` is search-free, so its
    // classification is replayed on the same position.
    it("determinism — every verdict class replays to the same verdict", () => {
        const twice = (def: CardDefinition) => {
            const first = playBotReach(def);
            expect(playBotReach(def)).toEqual(first);
            return first;
        };
        expect(twice(getCardByName("Grizzly Bears")).outcome).toBe("played");
        expect(twice(NO_OP_SORCERY)).toMatchObject({
            outcome: "ignored",
            cause: "never-chosen",
        });
        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            expect(twice(UNTARGETABLE_INSTANT)).toMatchObject({
                outcome: "ignored",
                cause: "position-unmodelled",
            });
        });
        const bears = getCardByName("Grizzly Bears");
        const castable = buildBotReachState(bears, 0);
        const frozen = () =>
            classifyNoMove(
                castable.state,
                castable.holderId,
                castable.instanceId,
                bears
            );
        expect(frozen()).toEqual({
            outcome: "frozen",
            cause: "no-legal-move",
            form: "Creature",
        });
        expect(frozen()).toEqual(frozen());
    });

    it("played — the Bot casts an affordable creature at both seats", () => {
        expect(playBotReach(getCardByName("Grizzly Bears"))).toEqual({
            outcome: "played",
        });
    });

    it("played — the follow-through answers a targeted spell's inputs", () => {
        expect(playBotReach(getCardByName("Lightning Bolt")).outcome).toBe(
            "played"
        );
    });

    // Issue #4189: the follow-through applied each answer with the greedy 1-ply
    // sandbox, which leaves a `resolution-choice` as a no-op, so the answered
    // choice stayed pending and the sweep read the harness's own stall as a
    // Bot Gap (`no-progress › follow-through`) on 24 cards.
    it("played — an edict's mandatory sacrifice choice is answered and settles", () => {
        withTemporaryDefinition(EDICT_INSTANT, () => {
            expect(playBotReach(EDICT_INSTANT)).toEqual({ outcome: "played" });
        });
    });

    it("played — an enters-trigger 'you may return' settles through its choices", () => {
        withTemporaryDefinition(RAISE_DEAD_CREATURE, () => {
            expect(playBotReach(RAISE_DEAD_CREATURE)).toEqual({
                outcome: "played",
            });
        });
    });

    // Issue #4260: the Bot holds a Flash permanent it could cast at sorcery
    // speed (`hold-trick`, issue #2248) and casts it at instant speed, a window
    // the sweep never posed — 13 Flash Auras read as `never-chosen`. Each of
    // the two grants below is chosen in the opponent's end step and in
    // neither main phase, so the verdict rides on that window alone.
    for (const aura of [FLASH_AURA_DOUBLE_STRIKE, FLASH_AURA_SHROUD]) {
        it(`played — ${aura.name} cast in the opponent's end step`, () => {
            withTemporaryDefinition(aura, () => {
                expect(playBotReach(aura)).toEqual({ outcome: "played" });
            });
        });
    }

    it("the opponent's end-step window: opponent active, holder holds priority", () => {
        withTemporaryDefinition(FLASH_AURA_SHROUD, () => {
            const posed = buildBotReachState(
                FLASH_AURA_SHROUD,
                0,
                OPPONENT_END_STEP_WINDOW
            );
            expect(posed.state.phase).toBe("END_STEP");
            expect(posed.state.activePlayerId).not.toBe(posed.holderId);
            expect(decidingPlayer(posed.state)).toBe(posed.holderId);
        });
        expect(botReachSpec(HASTE_CREATURE).activePlayer).toBe("me");
    });

    it("ignored — a legal, affordable no-op is never chosen, and ships", () => {
        withTemporaryDefinition(NO_OP_SORCERY, () => {
            expect(playBotReach(NO_OP_SORCERY)).toMatchObject({
                outcome: "ignored",
                cause: "never-chosen",
                form: "Sorcery",
            });
        });
    });

    // Issue #4179 — a `never-chosen` refusal carries the decision that refused
    // it, and the two refusal paths read differently. A no-op is dropped by
    // dominance before the search runs (`pruneDominatedNoOps`, issue #1887):
    // the trace says so, and — pruning having left one move — no search.
    it("never-chosen trace — a dominated no-op was pruned before the search", () => {
        withTemporaryDefinition(NO_OP_SORCERY, () => {
            const { trace } = playBotReach(NO_OP_SORCERY);
            expect(trace?.cardMove).toBe("pruned");
        });
    });

    // A card that DOES something (costs its caster life) is weighed by the
    // search and passed over: the trace names the chosen move first, the
    // card's move second, and carries the terms behind both — at the sweep's
    // fixed iteration budget, identical on a replay (`playTwice`).
    it("never-chosen trace — a weighed card: chosen, the card's move, terms", () => {
        withTemporaryDefinition(SELF_DRAIN_SORCERY, () => {
            const verdict = playBotReach(SELF_DRAIN_SORCERY);
            expect(verdict.cause).toBe("never-chosen");
            const { cardMove, search } = verdict.trace!;
            expect(cardMove).toBe("weighed");
            expect(search).toBeDefined();
            expect(search!.iterations).toBeLessThanOrEqual(
                BOT_REACH_BUDGET.iterations
            );
            expect(search!.candidates.map((c) => c.role).slice(0, 2)).toEqual([
                "chosen",
                "card",
            ]);
            const [chosen, card] = search!.candidates;
            expect(card!.label).toContain(SELF_DRAIN_SORCERY.name);
            expect(chosen!.label).not.toContain(SELF_DRAIN_SORCERY.name);
            // The drain shows in the card's own terms: less life for self.
            expect(card!.terms?.life?.[0]).toBeLessThan(
                chosen!.terms!.life![0]
            );
        });
    });

    it("a harness verdict carries no trace", () => {
        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            expect(playBotReach(UNTARGETABLE_INSTANT).trace).toBeUndefined();
        });
    });

    it("a draw spell's holder finds spells on top of the library, and only that holder", () => {
        const topOfLibrary = (def: CardDefinition, seat: 0 | 1): unknown => {
            const { state, holderId } = buildBotReachState(def, seat);
            const holder = state.players.find((p) => p.id === holderId)!;
            return holder.library[0]!.card.id;
        };
        const spell = getCardByName("Serra Angel").id;
        const land = getCardByName("Plains").id;
        for (const seat of [0, 1] as const) {
            withTemporaryDefinition(DRAW_SORCERY, () => {
                expect(topOfLibrary(DRAW_SORCERY, seat)).toBe(spell);
            });
            withTemporaryDefinition(MODAL_DRAW_SORCERY, () => {
                expect(topOfLibrary(MODAL_DRAW_SORCERY, seat)).toBe(spell);
            });
            withTemporaryDefinition(OPPONENT_DRAW_SORCERY, () => {
                expect(topOfLibrary(OPPONENT_DRAW_SORCERY, seat)).toBe(land);
            });
            expect(topOfLibrary(getCardByName("Grizzly Bears"), seat)).toBe(
                land
            );
        }
    });

    // Issue #5029: CR 401.2 — the order of a library is hidden, so the search
    // re-shuffles the holder's own at every iteration and a draw is priced on
    // what the pile HOLDS. Spells on top of twenty basics are 8 cards in 28.
    it("a draw paid for with a creature finds a spell in every library slot", () => {
        const spell = getCardByName("Serra Angel").id;
        const libraries = (def: CardDefinition, seat: 0 | 1) => {
            const { state, holderId } = buildBotReachState(def, seat);
            const spellsOf = (mine: boolean) => {
                const library = state.players.find(
                    (p) => (p.id === holderId) === mine
                )!.library;
                return {
                    cards: library.length,
                    spells: library.filter((c) => c.card.id === spell).length,
                };
            };
            return { holder: spellsOf(true), opponent: spellsOf(false) };
        };
        for (const seat of [0, 1] as const) {
            withTemporaryDefinition(SACRIFICE_DRAW_SORCERY, () => {
                expect(libraries(SACRIFICE_DRAW_SORCERY, seat)).toEqual({
                    holder: { cards: 28, spells: 28 },
                    opponent: { cards: 20, spells: 0 },
                });
            });
            // A draw that costs the card alone keeps the filler pile.
            withTemporaryDefinition(DRAW_SORCERY, () => {
                expect(libraries(DRAW_SORCERY, seat)).toEqual({
                    holder: { cards: 28, spells: 8 },
                    opponent: { cards: 20, spells: 0 },
                });
            });
        }
    });

    // The claim that does not depend on the budget: in the worlds the search
    // deals itself (CR 401.2), giving up the body for the two cards reads as
    // a gain at 1 ply. The pose makes them one world; over the filler pile
    // they differed, and the cast read as a loss in most of them.
    it("a draw paid for with a creature beats pass at 1 ply in the worlds the search samples", () => {
        withTemporaryDefinition(SACRIFICE_DRAW_SORCERY, () => {
            for (const seat of [0, 1] as const) {
                const { state, holderId, instanceId } = buildBotReachState(
                    SACRIFICE_DRAW_SORCERY,
                    seat
                );
                const moves = enumerateMoves(state, holderId);
                const cast = moves.find(
                    (m) =>
                        m.kind === "cast-spell" &&
                        m.cardInstanceId === instanceId
                )!;
                const pass = moves.find((m) => m.kind === "pass")!;
                for (const seed of [1, 2, 3, 4, 5, 6]) {
                    const valueOf = (move: Move): number => {
                        const world = determinize(
                            cloneGameState(state),
                            holderId,
                            makeRng(seed)
                        );
                        applyMoveInSearch(world, holderId, move);
                        return policyValue(
                            world,
                            holderId,
                            move,
                            DEFAULT_EVAL_WEIGHTS,
                            holderId
                        );
                    };
                    expect(
                        valueOf(cast),
                        `seat ${seat} seed ${seed}`
                    ).toBeGreaterThan(valueOf(pass));
                }
            }
        });
    });
});
