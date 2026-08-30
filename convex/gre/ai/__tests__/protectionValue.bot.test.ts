// Threat-aware valuation of a DEFENSIVE keyword grant (issues #2937 / #2938).
//
// The subject is `ai/protectionValue.ts` plus the two `evaluate.ts` consumers
// it feeds: the correction that takes the flat, threat-blind `KEYWORD_BONUS`
// credit back off a duration-scoped grant, and the `protection` term that
// re-supplies it scaled by how live the threat actually is.
//
// Every position is built through the REAL blade builder and walked forward
// with the engine's own `applyMoveInSearch`, so the grant on the board is the
// one a live activation produces (CR 611.2a), never a hand-written
// `staticAbilities` literal.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { seatPlayerId } from "../blade/matcher";
import { applyMoveInSearch, decidingPlayer } from "../../search";
import { enumerateMoves } from "../../moves";
import { evaluateBreakdown, evaluateCreature } from "../../evaluate";
import { liveThreatSeverity } from "../protectionValue";
import type { BladeScenario } from "../blade/types";
import type { CardInstanceState, GameState } from "../../state";

const ELF = "Iron-Shield Elf";
const RAIDERS = "Mons's Goblin Raiders";

/** The board both halves of the pair share: the Elf attacking alone, a spare
 *  land as the cheapest possible discard fodder, one 1/1 on the other side so
 *  a block declaration is a real decision. */
function attackScenario(blocked: boolean): BladeScenario {
    return {
        label: `protection-value-${blocked ? "blocked" : "unblocked"}`,
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

function findByDefinitionName(
    state: GameState,
    name: string
): CardInstanceState {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.card && (card.card as { name?: string }).name === name) {
                return card;
            }
        }
    }
    // The scenario builder keeps the full definition on the instance, but a
    // projected board would not — fall back to the one creature the attacker
    // controls, which every position here has exactly one of.
    const attacker = state.players.find((p) => p.id === state.activePlayerId);
    const only = attacker?.battlefield.filter((c) => c.power !== undefined);
    if (only?.length === 1) return only[0];
    throw new Error(`no unique permanent for "${name}"`);
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
    // Both seats pass; the ability resolves through the real stack (CR 608).
    for (let i = 0; i < 4 && state.stack.length > 0; i++) {
        const owed = decidingPlayer(state);
        if (!owed) break;
        applyMoveInSearch(state, owed, { kind: "pass" });
    }
    return state;
}

describe("defensive keyword grants are valued against the live threat (#2937/#2938)", () => {
    it("credits nothing for a grant with no threat on the board (CR 702.12b)", () => {
        const state = buildBladeState(attackScenario(false));
        const botId = seatPlayerId(state, "me");
        const before = evaluateCreature(
            state,
            findByDefinitionName(state, ELF)
        );

        withGrantResolved(state);
        const elf = findByDefinitionName(state, ELF);
        expect(elf.staticAbilities).toContain("indestructible");

        // The flat KEYWORD_BONUS occurrence is taken back off, so the granted
        // keyword moves the creature's realized worth not at all…
        expect(evaluateCreature(state, elf)).toBe(before);
        // …and with nothing aimed at it and no damage inbound, the term that
        // would pay for the grant is silent.
        expect(liveThreatSeverity(state, elf, ["damage"])).toBe(0);
        expect(evaluateBreakdown(state, botId).self.protection).toBe(0);
    });

    it("credits the grant against a lethal block already declared (CR 510.1c)", () => {
        const state = buildBladeState(attackScenario(true));
        const botId = seatPlayerId(state, "me");
        const elfBefore = findByDefinitionName(state, ELF);
        expect(liveThreatSeverity(state, elfBefore, ["damage"])).toBe(1);
        // The threat is DAMAGE-shaped: nothing targets the Elf, so a
        // targeting-only keyword (shroud, hexproof) would answer none of it.
        expect(liveThreatSeverity(state, elfBefore, ["targeted"])).toBe(0);

        withGrantResolved(state);
        const elf = findByDefinitionName(state, ELF);
        expect(elf.staticAbilities).toContain("indestructible");
        expect(evaluateBreakdown(state, botId).self.protection).toBeGreaterThan(
            0
        );
    });

    it("credits a SHROUD grant against a removal spell already on the stack (CR 702.18a)", () => {
        // The other half of the family (issue #2938): the keyword answers
        // TARGETING, and the threat it answers is an opposing spell already
        // aimed at the creature.
        const scenario: BladeScenario = {
            label: "protection-value-shroud",
            spec: {
                cards: [
                    {
                        name: "Sylvan Safekeeper",
                        owner: "opp",
                        zone: "battlefield",
                    },
                    {
                        name: "Grizzly Bears",
                        owner: "opp",
                        zone: "battlefield",
                    },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                landCount: 3,
                libraryCount: 20,
            },
            setup: [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "me",
                    target: "Grizzly Bears",
                },
            ],
            bot: "opp",
            budget: { iterations: 1 },
            seeds: [1],
            tier: "must",
            expect: { forbidden: [{ kind: "pass" }] },
        };
        const state = buildBladeState(scenario);
        const botId = seatPlayerId(state, "opp");
        const bearsId = state.stack[0].targets![0].id;
        const bears = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === bearsId);
        expect(bears).toBeDefined();
        // Nothing is protecting it yet, so the term is silent even though the
        // threat is live — the credit is for the GRANT, not for the danger.
        expect(evaluateBreakdown(state, botId).self.protection).toBe(0);
        expect(liveThreatSeverity(state, bears!, ["targeted"])).toBe(1);

        const activation = enumerateMoves(state, botId).find(
            (m) =>
                m.kind === "activate-ability" &&
                m.targets.some((t) => t.id === bearsId)
        );
        expect(activation).toBeDefined();
        applyMoveInSearch(state, botId, activation!);
        for (let i = 0; i < 2 && state.stack.length > 1; i++) {
            const owed = decidingPlayer(state);
            if (!owed) break;
            applyMoveInSearch(state, owed, { kind: "pass" });
        }
        const protectedBears = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === bearsId);
        expect(protectedBears?.staticAbilities).toContain("shroud");
        expect(evaluateBreakdown(state, botId).self.protection).toBeGreaterThan(
            0
        );
    });

    it("sees no damage threat once the damage step has passed", () => {
        // The phase guard: `state.combat` survives the damage steps, so a
        // window later than DECLARE_BLOCKERS must not keep reporting damage
        // that has already been dealt.
        const state = buildBladeState(attackScenario(true));
        const elf = findByDefinitionName(state, ELF);
        const moved: GameState = { ...state, phase: "POSTCOMBAT_MAIN" };
        expect(liveThreatSeverity(moved, elf, ["damage"])).toBe(0);
    });
});
