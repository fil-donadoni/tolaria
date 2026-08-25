/**
 * Loyalty abilities as BOT MOVES (issue #2491, CR 606).
 *
 * `enumerateAbilityMoves` used to skip every ability carrying a signed
 * `cost.loyalty` unconditionally — 13 shipped planeswalkers, 37 loyalty
 * abilities, none reachable by the bot, which is why it cast Liliana of the
 * Veil and then passed for the rest of the game. The skip was a deliberate
 * deferral: the rule lived only on the mutation path (`convex/game.ts`) and
 * `convex/gre/**` cannot import that module.
 *
 * These tests run through the REAL enumerator and the REAL search application,
 * never a hand-built call — the enumeration gap itself was untested before
 * (`loyalty.test.ts` exercises the framework directly and never touches
 * `enumerateMoves`), which is how it survived the framework slice.
 */

import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { assertLoyaltyActivationLegal } from "../../game";
import { buildStateFromScenario } from "../scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../setup";
import {
    getCardByName,
    registeredDefinitions,
    tryGetDefinition,
} from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

function player(id: string): PlayerInput {
    const filler = getCardByName("Forest");
    return {
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: `deck-${id}`,
            name: "test",
            format: "freeform",
            cards: Array.from({ length: 60 }, () => ({
                cardId: filler.id,
                cardName: filler.name,
            })),
        },
    };
}

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(
        createInitialGameState([player("p1"), player("p2")], 0x2491),
        spec
    );
}

function find(state: GameState, name: string): CardInstanceState {
    const def = getCardByName(name);
    const card = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => (c.card as { id?: string }).id === def.id);
    if (!card) throw new Error(`${name} not on the battlefield`);
    return card;
}

/** Every shipped planeswalker definition, in a stable order. */
function shippedPlaneswalkers(): CardDefinition[] {
    const out: CardDefinition[] = [];
    for (const def of registeredDefinitions()) {
        if (!def.types.includes("Planeswalker")) continue;
        if (!def.activatedAbilities?.some((a) => a.cost.loyalty !== undefined))
            continue;
        out.push(def);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A board rich enough that the walkers' target requirements have something to
 *  point at: creatures and an artifact on both sides, several lands, a land
 *  card in each graveyard (Wrenn and Six's `+1`), cards in hand. */
function boardWith(walker: string, loyalty?: number): ScenarioSpec {
    return {
        cards: [
            {
                name: walker,
                owner: "me",
                zone: "battlefield",
                ...(loyalty !== undefined ? { counters: { loyalty } } : {}),
            },
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            {
                name: "Savannah Lions",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
            { name: "Jayemdae Tome", owner: "me", zone: "battlefield" },
            { name: "Jayemdae Tome", owner: "opp", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "graveyard" },
            { name: "Forest", owner: "opp", zone: "graveyard" },
            { name: "Grizzly Bears", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "opp", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 5,
        libraryCount: 20,
    };
}

/** The `abilityId`s of every loyalty activation the enumerator offers `me`. */
function loyaltyAbilityIdsOffered(state: GameState): Set<string> {
    const ids = new Set<string>();
    for (const move of enumerateMoves(state, state.players[0].id)) {
        if (move.kind !== "activate-ability") continue;
        const source = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === move.cardInstanceId);
        const def = source
            ? tryGetDefinition((source.card as { id?: string }).id ?? "")
            : undefined;
        const ability = def?.activatedAbilities?.find(
            (a) => a.id === move.abilityId
        );
        if (ability?.cost.loyalty !== undefined) ids.add(move.abilityId);
    }
    return ids;
}

describe("loyalty abilities reach the bot's move enumerator (CR 606.2)", () => {
    it("offers every shipped planeswalker's loyalty abilities — the whole catalogue", () => {
        const walkers = shippedPlaneswalkers();
        // Guard the guard: a sweep over an empty catalogue is vacuously green.
        expect(walkers.length).toBeGreaterThanOrEqual(13);

        const missing: string[] = [];
        let offeredCount = 0;
        let totalCount = 0;
        for (const def of walkers) {
            const loyaltyAbilities = def.activatedAbilities!.filter(
                (a) => a.cost.loyalty !== undefined
            );
            totalCount += loyaltyAbilities.length;
            // Seed enough loyalty that even the ultimate's CR 606.6 floor is
            // satisfied, so this sweep measures the ENUMERATION gate and not
            // the counter budget (which has its own test below).
            const maxSpend = Math.max(
                0,
                ...loyaltyAbilities.map((a) => -(a.cost.loyalty ?? 0))
            );
            const state = build(
                boardWith(def.name, Math.max(def.loyalty ?? 0, maxSpend))
            );
            const offered = loyaltyAbilityIdsOffered(state);
            offeredCount += offered.size;
            for (const ability of loyaltyAbilities) {
                if (!offered.has(ability.id)) {
                    missing.push(`${def.name} :: ${ability.id}`);
                }
            }
        }

        // Sorin, Lord of Innistrad's `-6` carries a DYNAMIC target requirement
        // (`getTargetRequirement`), which `enumerateAbilityMoves` excludes for
        // every ability alike — an orthogonal limitation of the move planner,
        // not a loyalty one, and explicitly out of scope for issue #2491.
        expect(missing).toEqual([
            "Sorin, Lord of Innistrad :: sorin-lord-of-innistrad-minus6",
        ]);
        expect(totalCount).toBe(37);
        expect(offeredCount).toBe(36);
    });

    it("never offers a loyalty move the server's own gate would reject", () => {
        // The single strongest form of the enumerator/mutation agreement: feed
        // every offered move back through `assertLoyaltyActivationLegal`, the
        // throwing wrapper the `activateAbility` mutation calls. A divergence
        // here is what half-applies the bot's activate → selectTarget sequence.
        for (const def of shippedPlaneswalkers()) {
            for (const loyalty of [0, 1, 3, 6, 9]) {
                const state = build(boardWith(def.name, loyalty));
                for (const move of enumerateMoves(state, state.players[0].id)) {
                    if (move.kind !== "activate-ability") continue;
                    const source = state.players
                        .flatMap((p) => p.battlefield)
                        .find((c) => c.id === move.cardInstanceId)!;
                    const sourceDef = tryGetDefinition(
                        (source.card as { id?: string }).id ?? ""
                    );
                    const ability = sourceDef?.activatedAbilities?.find(
                        (a) => a.id === move.abilityId
                    );
                    if (!ability || ability.cost.loyalty === undefined)
                        continue;
                    expect(() =>
                        assertLoyaltyActivationLegal(state, source, ability)
                    ).not.toThrow();
                }
            }
        }
    });
});

describe("the CR 606 restrictions the enumerator now applies", () => {
    const LILIANA = "Liliana of the Veil";

    it("CR 606.6 — a `-N` above current loyalty is not offered, the affordable ones are", () => {
        const state = build(boardWith(LILIANA, 3));
        const offered = loyaltyAbilityIdsOffered(state);
        expect(offered).toContain("liliana-veil-plus1");
        expect(offered).toContain("liliana-veil-minus2");
        // Three counters cannot pay a `-6`.
        expect(offered).not.toContain("liliana-veil-minus6");

        const rich = build(boardWith(LILIANA, 6));
        expect(loyaltyAbilityIdsOffered(rich)).toContain("liliana-veil-minus6");
    });

    it("CR 606.6 — a `-N` landing on exactly 0 IS offered (the CR forbids only going below)", () => {
        const state = build(boardWith(LILIANA, 2));
        expect(loyaltyAbilityIdsOffered(state)).toContain(
            "liliana-veil-minus2"
        );
    });

    it("CR 606.3 — nothing is offered once a loyalty ability of that permanent was used this turn", () => {
        const state = build(boardWith(LILIANA, 6));
        expect(loyaltyAbilityIdsOffered(state).size).toBeGreaterThan(0);
        find(state, LILIANA).loyaltyActivatedThisTurn = true;
        expect(loyaltyAbilityIdsOffered(state).size).toBe(0);
    });

    it("CR 606.3 — nothing is offered outside a main phase", () => {
        const state = build(boardWith(LILIANA, 6));
        state.phase = "DECLARE_ATTACKERS";
        expect(loyaltyAbilityIdsOffered(state).size).toBe(0);
    });

    it("CR 606.3 — nothing is offered with a non-empty stack", () => {
        const state = build({
            ...boardWith(LILIANA, 6),
            cards: [
                ...boardWith(LILIANA, 6).cards,
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
        });
        const bolt = state.players[0].hand.find(
            (c) =>
                (c.card as { id?: string }).id ===
                getCardByName("Lightning Bolt").id
        )!;
        state.stack.push({
            ...bolt,
            castById: state.players[0].id,
            targets: [],
        });
        expect(loyaltyAbilityIdsOffered(state).size).toBe(0);
    });

    it("CR 606.3 — the opponent is never offered the walker's loyalty abilities on the controller's turn", () => {
        const state = build(boardWith(LILIANA, 6));
        const opponentMoves = enumerateMoves(state, state.players[1].id);
        expect(
            opponentMoves.filter((m) => m.kind === "activate-ability")
        ).toEqual([]);
    });
});

describe("the search PAYS the loyalty leg it now enumerates (CR 606.4)", () => {
    const LILIANA = "Liliana of the Veil";

    function firstLoyaltyMove(state: GameState, abilityId: string): Move {
        const move = enumerateMoves(state, state.players[0].id).find(
            (m) => m.kind === "activate-ability" && m.abilityId === abilityId
        );
        if (!move) throw new Error(`no enumerated move for ${abilityId}`);
        return move;
    }

    it("removes the counters and sets the per-permanent lock in the SCORED leaf", () => {
        const state = build(boardWith(LILIANA, 3));
        const before = find(state, LILIANA);
        expect(before.counters?.loyalty).toBe(3);
        expect(before.loyaltyActivatedThisTurn).toBeUndefined();

        applyMoveInSearch(
            state,
            state.players[0].id,
            firstLoyaltyMove(state, "liliana-veil-minus2")
        );

        const after = find(state, LILIANA);
        // CR 606.4 — two counters really left the permanent...
        expect(after.counters?.loyalty).toBe(1);
        // ...and CR 606.3's per-permanent lock is set, exactly as the
        // mutation's commit sites set it.
        expect(after.loyaltyActivatedThisTurn).toBe(true);
        // CR 602.2a — and the ability is on the stack, so the payoff is
        // visible one ply deep (issue #1920).
        expect(state.stack[state.stack.length - 1]?.abilityId).toBe(
            "liliana-veil-minus2"
        );
    });

    it("adds the counters for a `+N`", () => {
        const state = build(boardWith(LILIANA, 3));
        applyMoveInSearch(
            state,
            state.players[0].id,
            firstLoyaltyMove(state, "liliana-veil-plus1")
        );
        expect(find(state, LILIANA).counters?.loyalty).toBe(4);
    });

    it("closes the door on a SECOND activation in the same simulated turn", () => {
        const state = build(boardWith(LILIANA, 9));
        const move = firstLoyaltyMove(state, "liliana-veil-plus1");
        applyMoveInSearch(state, state.players[0].id, move);
        // The search's own re-enumeration from the resulting position must
        // offer nothing further off this walker (CR 606.3). Without the paid
        // lock the tree would ultimate every ply, for free.
        expect(loyaltyAbilityIdsOffered(state).size).toBe(0);
    });
});
