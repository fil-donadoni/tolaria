// CR 602.1 / 118 (issue #2155) — the ISMCTS search leaf must PAY an activated
// ability's non-mana costs.
//
// There are two move-application sandboxes: `applyMoveForSearch`
// (`applyMove.ts`, the greedy 1-ply selector) and `applyMoveInSearch`
// (`search.ts`, every ISMCTS rollout and probe — the path that actually picks
// the move). The second used to apply the tap plan only, so `cost.sacrifice`,
// `cost.sacrificeFilter`, `cost.tapOtherFilter`, `cost.discardFilter` and
// `cost.exileFromGraveyard` were FREE inside the tree that chooses.
//
// Combined with the payoff gap (issue #1920 — the ability never reaches the
// stack, so no depth of search sees what it DOES), a cost-free activation
// scores exactly equal to `pass` and wins on rollout noise. Two field repros:
// #2422 (Sylvan Safekeeper sacrificing lands on turn 3 with nothing on the
// stack) and #2415 (Iron-Shield Elf discarding its controller's hand away at
// DECLARE_ATTACKERS).
//
// The fix is one shared helper — `applyActivationCostsForSearch`
// (`applyMove.ts`) — called by BOTH sandboxes, resolving the payment through
// the same `activationCostPicks.ts` / `paymentPicks.ts` plan the live bot and
// `executor.ts` use. These tests pin (a) that each cost leg is actually paid
// in the ISMCTS leaf, (b) that the two sandboxes pay the SAME cards, and
// (c) that the two field repros now score strictly below `pass`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    applyActivationCostsForSearch,
    applyMoveForSearch,
} from "../applyMove";
import { applyMoveInSearch, searchWithTrace } from "../search";
import { enumerateMoves, type Move } from "../moves";
import { evaluate } from "../evaluate";
import { cloneGameState } from "../clone";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const BOT = "p2";
const OPP = "p1";

const SAFEKEEPER = getCardByName("Sylvan Safekeeper").id;
const IRON_SHIELD_ELF = getCardByName("Iron-Shield Elf").id;
const EARTHCRAFT = getCardByName("Earthcraft").id;
const NIGHT_SOIL = getCardByName("Night Soil").id;
const LLANOWAR_VANGUARD = getCardByName("Llanowar Vanguard").id;
const FOREST = getCardByName("Forest").id;
const SWAMP = getCardByName("Swamp").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id;

function bf(cardId: string, id: string, owner = BOT, extra = {}) {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
        ...extra,
    });
}

function inZone(
    cardId: string,
    id: string,
    zone: "hand" | "graveyard",
    owner = BOT
) {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

function activationOf(state: GameState, cardInstanceId: string) {
    return enumerateMoves(state, BOT).find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.cardInstanceId === cardInstanceId
    );
}

function botOf(state: GameState) {
    return state.players.find((p) => p.id === BOT)!;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Each deferred cost leg is actually paid in the ISMCTS leaf, and the two
//    sandboxes pay the SAME cards (agreement by construction).
// ───────────────────────────────────────────────────────────────────────────

describe("applyMoveInSearch pays activation costs (issue #2155)", () => {
    it("cost.sacrificeFilter — the land leaves the battlefield (CR 701.16)", () => {
        const safekeeper = bf(SAFEKEEPER, "keeper");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [
                        safekeeper,
                        bf(FOREST, "forest1"),
                        bf(FOREST, "forest2"),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });
        const move = activationOf(state, safekeeper.id);
        expect(move).toBeDefined();

        // The ISMCTS leaf — applied in place.
        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        const treeBot = botOf(tree);
        expect(
            treeBot.battlefield.filter((c) => c.types.includes("Land"))
        ).toHaveLength(1);
        expect(treeBot.graveyard).toHaveLength(1);

        // The greedy sandbox — same move, same victim.
        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(botOf(greedy).graveyard.map((c) => c.id)).toEqual(
            treeBot.graveyard.map((c) => c.id)
        );
    });

    it("cost.discardFilter — the card leaves hand (CR 118.3)", () => {
        const elf = bf(IRON_SHIELD_ELF, "elf");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [elf],
                    hand: [
                        inZone(LIGHTNING_BOLT, "bolt1", "hand"),
                        inZone(GRIZZLY_BEARS, "bears1", "hand"),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });
        const move = activationOf(state, elf.id);
        expect(move).toBeDefined();

        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        const treeBot = botOf(tree);
        expect(treeBot.hand).toHaveLength(1);
        expect(treeBot.graveyard).toHaveLength(1);

        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(botOf(greedy).graveyard.map((c) => c.id)).toEqual(
            treeBot.graveyard.map((c) => c.id)
        );
    });

    it("cost.tapOtherFilter — the crewing/tapped body is tapped (CR 118.8)", () => {
        const earthcraft = bf(EARTHCRAFT, "earthcraft");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [
                        earthcraft,
                        bf(GRIZZLY_BEARS, "bears1"),
                        bf(FOREST, "forest1", BOT, { isTapped: true }),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });
        const move = activationOf(state, earthcraft.id);
        expect(move).toBeDefined();

        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        expect(
            botOf(tree).battlefield.find((c) => c.id === "bears1")!.isTapped
        ).toBe(true);

        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(
            botOf(greedy).battlefield.find((c) => c.id === "bears1")!.isTapped
        ).toBe(true);
    });

    // CR 602.1 — the `{T}` leg is CONDITIONAL on the cost actually carrying a
    // tap symbol. The ISMCTS leaf used to tap an activation's source
    // unconditionally, which silently taxed every ability WITHOUT `{T}` — both
    // field repros (Sylvan Safekeeper, Iron-Shield Elf) and Earthcraft — inside
    // the very tree that picks the move: the phantom tap made the sacrifice
    // look worse than it is in some windows and masked the real tie in others
    // (see the DECLARE_ATTACKERS note in the #2422 repro below). Both
    // directions are pinned, so restoring the unconditional tap goes red.
    it("cost without {T} — the source is NOT tapped (CR 602.1)", () => {
        const safekeeper = bf(SAFEKEEPER, "keeper");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [
                        safekeeper,
                        bf(FOREST, "forest1"),
                        bf(FOREST, "forest2"),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });
        const move = activationOf(state, safekeeper.id);
        expect(move).toBeDefined();

        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        expect(
            botOf(tree).battlefield.find((c) => c.id === "keeper")!.isTapped
        ).toBeFalsy();

        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(
            botOf(greedy).battlefield.find((c) => c.id === "keeper")!.isTapped
        ).toBeFalsy();
    });

    it("cost.tap — the source IS tapped (CR 602.1)", () => {
        const vanguard = bf(LLANOWAR_VANGUARD, "vanguard");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, { battlefield: [vanguard] }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });
        const move = activationOf(state, vanguard.id);
        expect(move).toBeDefined();

        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        expect(
            botOf(tree).battlefield.find((c) => c.id === "vanguard")!.isTapped
        ).toBe(true);

        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(
            botOf(greedy).battlefield.find((c) => c.id === "vanguard")!.isTapped
        ).toBe(true);
    });

    // CR 113.3c — the PAYER is the ACTIVATING player, never the source's
    // controller. An `activatableByAnyPlayer` ability is enumerated off the
    // OPPONENT's battlefield (`moves.ts`) with `costPicks` built from the
    // activator's own resources, so deriving the payer from the permanent
    // discards/sacrifices/taps the wrong player's cards. No shipped card
    // combines "any player may activate" with a deferred cost leg today, so the
    // contract is pinned on the shared helper directly — it is the seam both
    // sandboxes now go through.
    it("pays from the ACTIVATING player, not the source's controller (CR 113.3c)", () => {
        const elf = bf(IRON_SHIELD_ELF, "elf", OPP);
        const state = makeState({
            players: [
                makePlayer(OPP, { battlefield: [elf] }),
                makePlayer(BOT, {
                    hand: [inZone(LIGHTNING_BOLT, "bolt1", "hand")],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        applyActivationCostsForSearch(state, BOT, {
            kind: "activate-ability",
            cardInstanceId: "elf",
            abilityId: "iron-shield-elf-discard",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
            costPicks: { discardIds: ["bolt1"] },
        });

        expect(botOf(state).hand).toHaveLength(0);
        expect(botOf(state).graveyard.map((c) => c.id)).toEqual(["bolt1"]);
        expect(state.players.find((p) => p.id === OPP)!.graveyard).toHaveLength(
            0
        );
    });

    it("cost.exileFromGraveyard — the graveyard cards leave for exile (CR 118.5)", () => {
        const nightSoil = bf(NIGHT_SOIL, "nightsoil");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [nightSoil, bf(FOREST, "forest1")],
                    graveyard: [
                        inZone(GRIZZLY_BEARS, "gy1", "graveyard"),
                        inZone(GRIZZLY_BEARS, "gy2", "graveyard"),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });
        const move = activationOf(state, nightSoil.id);
        expect(move).toBeDefined();

        const tree = cloneGameState(state);
        applyMoveInSearch(tree, BOT, move!);
        const treeBot = botOf(tree);
        expect(treeBot.graveyard).toHaveLength(0);
        expect(treeBot.exile.map((c) => c.id).sort()).toEqual(["gy1", "gy2"]);

        const greedy = applyMoveForSearch(state, BOT, move!);
        expect(
            botOf(greedy)
                .exile.map((c) => c.id)
                .sort()
        ).toEqual(["gy1", "gy2"]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The deterministic single scenario the DoD asks for: the SAME activation
//    is now scored below the cost-free version of itself.
//
//    For both repro abilities the "cost-free version" is exactly the root
//    position: neither has a mana leg or a `{T}` cost, so the pre-fix leaf
//    (tap plan only, `applyTapPlan` over an empty plan) left the state
//    byte-identical to the root. Comparing the paid leaf against the root is
//    therefore literally "with the cost" vs "with the cost free", with no
//    hand-rolled counterfactual engine.
// ───────────────────────────────────────────────────────────────────────────

describe("a paid activation evaluates below its cost-free self (issue #2155)", () => {
    it("Sylvan Safekeeper: sacrificing a land costs evaluation points", () => {
        const safekeeper = bf(SAFEKEEPER, "keeper");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [
                        safekeeper,
                        bf(FOREST, "forest1"),
                        bf(FOREST, "forest2"),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "BEGINNING_OF_COMBAT",
        });
        // The cost-free leaf is the root itself (empty tap plan, no {T}).
        const costFree = evaluate(state, BOT);

        const move = activationOf(state, safekeeper.id)!;
        const paidState = cloneGameState(state);
        applyMoveInSearch(paidState, BOT, move);
        expect(evaluate(paidState, BOT)).toBeLessThan(costFree);
    });

    it("Iron-Shield Elf: discarding a card costs evaluation points", () => {
        const elf = bf(IRON_SHIELD_ELF, "elf");
        const state = makeState({
            players: [
                makePlayer(OPP),
                makePlayer(BOT, {
                    battlefield: [elf],
                    hand: [
                        inZone(LIGHTNING_BOLT, "bolt1", "hand"),
                        inZone(GRIZZLY_BEARS, "bears1", "hand"),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "DECLARE_ATTACKERS",
        });
        const costFree = evaluate(state, BOT);

        const move = activationOf(state, elf.id)!;
        const paidState = cloneGameState(state);
        applyMoveInSearch(paidState, BOT, move);
        expect(evaluate(paidState, BOT)).toBeLessThan(costFree);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Root-move regressions for the two field repros. The assertion is the one
//    the triage comment demands: the activation's mean reward must be
//    STRICTLY below `pass`'s, not merely "not chosen at this seed".
// ───────────────────────────────────────────────────────────────────────────

/** Mean rewards the real ISMCTS root assigned to the activation of
 *  `cardInstanceId` and to `pass`, from one deterministic search. */
function rootRewards(state: GameState, cardInstanceId: string, seed: number) {
    const { trace } = searchWithTrace(state, BOT, { iterations: 200 }, seed);
    expect(trace).not.toBeNull();
    const activation = trace!.candidates.find(
        (c) =>
            c.move.kind === "activate-ability" &&
            c.move.cardInstanceId === cardInstanceId
    );
    const pass = trace!.candidates.find((c) => c.move.kind === "pass");
    expect(activation, "the activation must be a root candidate").toBeDefined();
    expect(pass, "pass must be a root candidate").toBeDefined();
    return {
        activation: activation!.meanReward,
        pass: pass!.meanReward,
        chosen: trace!.chosen,
    };
}

/** Seeds chosen against the PRE-FIX baseline, where the ISMCTS leaf applied
 *  the tap plan only: at every one of these the activation tied or beat
 *  `pass`, and the bot actually chose it. A seed at which the old code
 *  already declined would make the assertion vacuous. */
const SEEDS = [0xb1ade, 1, 2, 3, 4, 42];

describe("field repro #2422 — Sylvan Safekeeper does not eat its own lands", () => {
    /** Turn 3, BEGINNING_OF_COMBAT, nothing on the stack and nothing
     *  threatening the Safekeeper: shroud protects against a threat that does
     *  not exist, and the land is a real, permanent loss. */
    function position(): GameState {
        return makeState({
            players: [
                makePlayer(OPP, {
                    battlefield: [
                        bf(SWAMP, "oppSwamp1", OPP),
                        bf(SWAMP, "oppSwamp2", OPP),
                    ],
                }),
                makePlayer(BOT, {
                    battlefield: [
                        bf(SAFEKEEPER, "keeper"),
                        bf(FOREST, "forest1"),
                        bf(FOREST, "forest2"),
                        bf(FOREST, "forest3"),
                    ],
                }),
            ],
            turn: 3,
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            // The field report was `BEGINNING_OF_COMBAT`; the assertion is
            // pinned one step later, in the declare-attackers window, because
            // that is where the pre-fix leaf genuinely PREFERRED the
            // sacrifice. Earlier in combat the old code's OTHER inaccuracy —
            // it tapped an activation's source unconditionally, whether or
            // not the cost had `{T}` — accidentally penalised the Safekeeper
            // and masked the tie. Same defect, same class, discriminating
            // window.
            phase: "DECLARE_ATTACKERS",
        });
    }

    it.each(SEEDS)(
        "scores the sacrifice strictly below pass (seed %i)",
        (seed) => {
            const { activation, pass, chosen } = rootRewards(
                position(),
                "keeper",
                seed
            );
            expect(activation).toBeLessThan(pass);
            expect(chosen).not.toContain("Sylvan Safekeeper");
        }
    );

    // Issue #1920 re-check. The repro above is pinned at DECLARE_ATTACKERS;
    // this is the SAME position in the bot's own PRECOMBAT_MAIN, added because
    // the payoff half of #1920 could plausibly reopen the shipped bug from the
    // other side: the shroud grant is now visible material where it used to be
    // invisible, so "sacrifice a land for nothing" acquired a payoff term it
    // did not have when #2155 landed. It must still lose to `pass`.
    it.each(SEEDS)(
        "still scores below pass in the bot's own sorcery window (seed %i)",
        (seed) => {
            const { activation, pass, chosen } = rootRewards(
                { ...position(), phase: "PRECOMBAT_MAIN" },
                "keeper",
                seed
            );
            expect(activation).toBeLessThan(pass);
            expect(chosen).not.toContain("Sylvan Safekeeper");
        }
    );
});

describe("field repro #2415 — Iron-Shield Elf does not empty its own hand", () => {
    /** Turn 16, DECLARE_ATTACKERS, no damage or removal in flight: the
     *  indestructible grant answers nothing, and the discarded card is gone. */
    function position(): GameState {
        return makeState({
            players: [
                makePlayer(OPP, {
                    battlefield: [
                        bf(SWAMP, "oppSwamp1", OPP),
                        bf(SWAMP, "oppSwamp2", OPP),
                    ],
                }),
                makePlayer(BOT, {
                    battlefield: [
                        bf(IRON_SHIELD_ELF, "elf"),
                        bf(SWAMP, "swamp1"),
                        bf(SWAMP, "swamp2"),
                    ],
                    hand: [
                        inZone(GRIZZLY_BEARS, "bears1", "hand"),
                        inZone(GRIZZLY_BEARS, "bears2", "hand"),
                    ],
                }),
            ],
            turn: 16,
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "DECLARE_ATTACKERS",
        });
    }

    it.each(SEEDS)(
        "scores the discard strictly below pass (seed %i)",
        (seed) => {
            const { activation, pass, chosen } = rootRewards(
                position(),
                "elf",
                seed
            );
            expect(activation).toBeLessThan(pass);
            expect(chosen).not.toContain("Iron-Shield Elf");
        }
    );

    // Issue #1920 re-check, same reasoning as the Safekeeper sibling above and
    // a sharper case: the Elf's indestructible grant is a KEYWORD, which
    // `evaluateCreature` reads off `staticAbilities` and prices as material —
    // unlike an until-end-of-turn P/T pump, which is invisible to it by
    // construction. So of the two field repros this is the one whose payoff the
    // 1-ply leaf now scores most generously (measured: +22 over `pass` at the
    // policy level in this window), and the root must still decline it.
    it.each(SEEDS)(
        "still scores below pass in the bot's own sorcery window (seed %i)",
        (seed) => {
            const { activation, pass, chosen } = rootRewards(
                { ...position(), phase: "PRECOMBAT_MAIN" },
                "elf",
                seed
            );
            expect(activation).toBeLessThan(pass);
            expect(chosen).not.toContain("Iron-Shield Elf");
        }
    );
});
