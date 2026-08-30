// Threat-awareness for a defensive keyword grant (issue #2937).
//
// The subject is `ai/defensiveGrants.ts` and its one `evaluate.ts` consumer:
// the correction that takes the flat, threat-blind `KEYWORD_BONUS` credit back
// off a duration-scoped grant in a position where nothing can reach the
// creature — and, just as importantly, leaves it alone everywhere else.
//
// Every position is built through the REAL blade builder and walked forward
// with the engine's own `applyMoveInSearch`, so the grant on the board is the
// one a live activation produces (CR 611.2a), never a hand-written
// `staticAbilities` literal.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { getCardByName } from "../../../cards";
import { seatPlayerId } from "../blade/matcher";
import { applyMoveInSearch, decidingPlayer } from "../../search";
import { enumerateMoves } from "../../moves";
import { evaluateCreature } from "../../evaluate";
import { isQuietFor, temporaryDefensiveKeywords } from "../defensiveGrants";
import type { BladeScenario } from "../blade/types";
import type { CardInstanceState, GameState } from "../../state";

const ELF = "Iron-Shield Elf";
const RAIDERS = "Mons's Goblin Raiders";

/** The board every case shares: the Elf attacking alone, a spare land as the
 *  cheapest possible discard fodder, one 1/1 on the other side so a block
 *  declaration is a real decision. */
function attackScenario(blocked: boolean): BladeScenario {
    return {
        label: `defensive-grant-${blocked ? "blocked" : "unblocked"}`,
        spec: {
            cards: [
                {
                    name: ELF,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Plains", owner: "me", zone: "hand" },
                { name: RAIDERS, owner: "opp", zone: "battlefield" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 3,
            landCount: 3,
            libraryCount: 20,
        },
        setup: [
            { kind: "declare-attackers", cards: [ELF] },
            blocked
                ? {
                      kind: "declare-blockers",
                      blocks: [{ blocker: RAIDERS, attacker: ELF }],
                  }
                : { kind: "declare-blockers" },
        ],
        bot: "me",
        budget: { iterations: 1 },
        seeds: [1],
        tier: "must",
        expect: { forbidden: [{ kind: "pass" }] },
    };
}

/** The Elf, by definition name. Throws rather than guessing: a name-keyed
 *  lookup with a fallback that discards the name is how an assertion goes
 *  vacuous. */
function theElf(state: GameState): CardInstanceState {
    const found = state.players
        .flatMap((p) => p.battlefield)
        .filter(
            (c) => (c.card as { id?: string }).id === getCardByName(ELF).id
        );
    expect(found).toHaveLength(1);
    return found[0];
}

/** Activate the Elf's grant and let it resolve, so the board carries the real
 *  duration-scoped `grantedStaticAbilities` entry. */
function withGrantResolved(state: GameState): GameState {
    const botId = seatPlayerId(state, "me");
    const activation = enumerateMoves(state, botId).find(
        (m) => m.kind === "activate-ability"
    );
    expect(activation, "the Elf's grant must be enumerable here").toBeDefined();
    applyMoveInSearch(state, botId, activation!);
    for (let i = 0; i < 4 && state.stack.length > 0; i++) {
        const owed = decidingPlayer(state);
        if (!owed) break;
        applyMoveInSearch(state, owed, { kind: "pass" });
    }
    expect(theElf(state).staticAbilities).toContain("indestructible");
    return state;
}

describe("indestructible granted in a quiet position (#2937, CR 702.12b)", () => {
    it("is worth nothing to an UNBLOCKED attacker with an empty stack", () => {
        const state = buildBladeState(attackScenario(false));
        const before = evaluateCreature(state, theElf(state));

        withGrantResolved(state);
        const elf = theElf(state);
        expect(isQuietFor(state, elf)).toBe(true);
        expect(temporaryDefensiveKeywords(elf)).toEqual(["indestructible"]);
        // The flat KEYWORD_BONUS occurrence is taken back off, so the granted
        // keyword moves the creature's realized worth not at all.
        expect(evaluateCreature(state, elf)).toBe(before);
    });

    it("keeps its full flat worth once a blocker is assigned to it", () => {
        const state = buildBladeState(attackScenario(true));
        const before = evaluateCreature(state, theElf(state));
        expect(isQuietFor(state, theElf(state))).toBe(false);

        withGrantResolved(state);
        const elf = theElf(state);
        expect(isQuietFor(state, elf)).toBe(false);
        // Untouched by the correction: combat damage is headed at the Elf, so
        // the grant is priced exactly as `main` prices it.
        expect(evaluateCreature(state, elf)).toBeGreaterThan(before);
    });

    it("is not quiet while ANY opposing object sits on the stack", () => {
        // Fail-closed: the object is not read, so a board wipe — which targets
        // nothing and is the archetypal reason to buy indestructible — counts
        // exactly like a spell aimed at the creature.
        const scenario: BladeScenario = {
            label: "defensive-grant-stack",
            spec: {
                cards: [
                    {
                        name: ELF,
                        owner: "opp",
                        zone: "battlefield",
                        summoningSick: false,
                    },
                    { name: "Plains", owner: "opp", zone: "hand" },
                    { name: "Wrath of God", owner: "me", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                landCount: 4,
                libraryCount: 20,
            },
            setup: [{ kind: "cast", card: "Wrath of God", by: "me" }],
            bot: "opp",
            budget: { iterations: 1 },
            seeds: [1],
            tier: "must",
            expect: { forbidden: [{ kind: "pass" }] },
        };
        const state = buildBladeState(scenario);
        expect(state.stack).toHaveLength(1);
        expect(isQuietFor(state, theElf(state))).toBe(false);
    });

    it("claims no grant whose keyword occurrence has been stripped (CR 613.1f)", () => {
        // A layer-6 ability-loss effect takes the `staticAbilities` occurrence
        // away and leaves the grant record standing. Subtracting a bonus
        // `creatureValueRaw` never added would under-value the creature.
        const state = buildBladeState(attackScenario(false));
        withGrantResolved(state);
        const elf = theElf(state);
        const withGrant = evaluateCreature(state, elf);
        elf.staticAbilities = elf.staticAbilities.filter(
            (k) => k !== "indestructible"
        );
        expect(elf.grantedStaticAbilities?.length).toBeGreaterThan(0);
        expect(temporaryDefensiveKeywords(elf)).toEqual([]);
        expect(evaluateCreature(state, elf)).toBe(withGrant);
    });
});
