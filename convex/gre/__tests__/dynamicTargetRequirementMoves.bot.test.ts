/**
 * Activated abilities with a DYNAMIC target requirement as Bot moves
 * (issue #7924, CR 602.2b → 601.2c).
 *
 * `ActivatedAbility.getTargetRequirement(source, state)` computes the target
 * requirement from the source permanent: "another target creature" (Giver of
 * Runes, Sorceress Queen, Arwen, Mortal Queen, Formidable Speaker, Manifold
 * Key, Sorin, Lord of Innistrad's −6) or a filter read off the source
 * (Old Man of the Sea's power, Stone Giant's power, Mistfolk's "spell that
 * targets this creature"). The announcement always resolved it; the Bot's
 * enumerator skipped every such ability outright, so none was ever a Bot move.
 *
 * Each fixture names the targets the enumerator must offer and the ones it
 * must not, and every offered move is applied through the REAL search
 * application — offered == accepted. A catalogue sweep keeps the table whole:
 * a new closure-bearing ability without a fixture reds here.
 */

import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { activateAbilityOnState } from "../activation";
import { applyOneTargetSelection } from "../../game";
import { buildStateFromScenario } from "../scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../setup";
import {
    getAllCatalogueCards,
    getCardByName,
    tryGetDefinition,
} from "../../cards";
import type { GameState } from "../state";
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
        createInitialGameState([player("p1"), player("p2")], 0x7924),
        spec
    );
}

/** `me:<name>` / `opp:<name>` for a permanent, `stack:<name>` for a stack
 *  item — the vocabulary the fixtures below name targets in. */
const nameOf = (card: unknown): string =>
    tryGetDefinition((card as { id?: string }).id ?? "")?.name ?? "?";

function targetLabel(state: GameState, id: string): string {
    for (const [i, p] of state.players.entries()) {
        const card = p.battlefield.find((c) => c.id === id);
        if (card) return `${i === 0 ? "me" : "opp"}:${nameOf(card.card)}`;
    }
    const item = state.stack.find((s) => s.id === id);
    if (item) return `stack:${nameOf(item.card)}`;
    return `?:${id}`;
}

function movesFor(state: GameState, abilityId: string): Move[] {
    return enumerateMoves(state, state.players[0].id).filter(
        (m) => m.kind === "activate-ability" && m.abilityId === abilityId
    );
}

function offeredTargets(state: GameState, moves: Move[]): Set<string> {
    const out = new Set<string>();
    for (const m of moves) {
        const targets = (m as { targets?: { id?: string }[] }).targets ?? [];
        for (const t of targets) if (t.id) out.add(targetLabel(state, t.id));
    }
    return out;
}

/** The labels of every permanent and stack object the SERVER accepts as the
 *  ability's first target: announce through `activateAbilityOnState` (which
 *  resolves the dynamic requirement), then pick through
 *  `applyOneTargetSelection` — the mutation's own validation. */
function serverAcceptedTargets(
    state: GameState,
    sourceId: string,
    abilityId: string
): Set<string> {
    const candidates: { type: "permanent" | "spell"; id: string }[] = [
        ...state.players.flatMap((p) =>
            p.battlefield.map((c) => ({ type: "permanent" as const, id: c.id }))
        ),
        ...state.stack.map((s) => ({ type: "spell" as const, id: s.id })),
    ];
    const out = new Set<string>();
    for (const candidate of candidates) {
        const trial = structuredClone(state);
        trial.players[0].manaPool = { C: 5, U: 5 };
        try {
            activateAbilityOnState(trial, {
                playerId: trial.players[0].id,
                cardInstanceId: sourceId,
                abilityId,
            });
            applyOneTargetSelection(trial, trial.players[0].id, {
                targetType: candidate.type,
                targetId: candidate.id,
            });
            out.add(targetLabel(state, candidate.id));
        } catch {
            // Rejected by the server: not a legal target.
        }
    }
    return out;
}

const untapped = { zone: "battlefield" as const, summoningSick: false };

interface Fixture {
    abilityId: string;
    spec: ScenarioSpec;
    /** Every one of these is offered as a target. */
    offers: string[];
    /** None of these is ever offered. */
    never: string[];
}

const FIXTURES: Fixture[] = [
    {
        // "Another target creature YOU CONTROL."
        abilityId: "giver-of-runes-protect",
        spec: {
            cards: [
                { name: "Giver of Runes", owner: "me", ...untapped },
                { name: "Grizzly Bears", owner: "me", ...untapped },
                { name: "Savannah Lions", owner: "opp", ...untapped },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        offers: ["me:Grizzly Bears"],
        never: ["me:Giver of Runes", "opp:Savannah Lions"],
    },
    {
        abilityId: "sorceress-queen-set",
        spec: {
            cards: [
                { name: "Sorceress Queen", owner: "me", ...untapped },
                { name: "Grizzly Bears", owner: "me", ...untapped },
                { name: "Savannah Lions", owner: "opp", ...untapped },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        offers: ["me:Grizzly Bears", "opp:Savannah Lions"],
        never: ["me:Sorceress Queen"],
    },
    {
        abilityId: "arwen-empower",
        spec: {
            cards: [
                {
                    name: "Arwen, Mortal Queen",
                    owner: "me",
                    ...untapped,
                    counters: { indestructible: 1 },
                },
                { name: "Grizzly Bears", owner: "me", ...untapped },
                { name: "Savannah Lions", owner: "opp", ...untapped },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        offers: ["me:Grizzly Bears", "opp:Savannah Lions"],
        never: ["me:Arwen, Mortal Queen"],
    },
    {
        abilityId: "manifold-key-untap",
        spec: {
            cards: [
                { name: "Manifold Key", owner: "me", zone: "battlefield" },
                {
                    name: "Jayemdae Tome",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        offers: ["me:Jayemdae Tome"],
        never: ["me:Manifold Key"],
    },
    {
        abilityId: "formidable-speaker-untap",
        spec: {
            cards: [
                { name: "Formidable Speaker", owner: "me", ...untapped },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    ...untapped,
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        },
        offers: ["me:Grizzly Bears"],
        never: ["me:Formidable Speaker"],
    },
    {
        // "…and/or OTHER planeswalkers" — up to three.
        abilityId: "sorin-lord-of-innistrad-minus6",
        spec: {
            cards: [
                {
                    name: "Sorin, Lord of Innistrad",
                    owner: "me",
                    zone: "battlefield",
                    counters: { loyalty: 6 },
                },
                { name: "Grizzly Bears", owner: "me", ...untapped },
                { name: "Savannah Lions", owner: "opp", ...untapped },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            libraryCount: 20,
        },
        offers: ["me:Grizzly Bears", "opp:Savannah Lions"],
        never: ["me:Sorin, Lord of Innistrad"],
    },
    {
        // Power ≤ Old Man's power (2): a 2-power creature yes, a 3-power no.
        abilityId: "old-man-of-the-sea-steal",
        spec: {
            cards: [
                { name: "Old Man of the Sea", owner: "me", ...untapped },
                { name: "Grizzly Bears", owner: "opp", ...untapped },
                { name: "Hill Giant", owner: "opp", ...untapped },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        offers: ["opp:Grizzly Bears"],
        never: ["opp:Hill Giant"],
    },
    {
        // A creature YOU control with toughness < Stone Giant's power (3):
        // Grizzly Bears (2) yes; Hill Giant (3), Stone Giant itself (4) and
        // the opponent's Bears no.
        abilityId: "stone-giant-fling",
        spec: {
            cards: [
                { name: "Stone Giant", owner: "me", ...untapped },
                { name: "Grizzly Bears", owner: "me", ...untapped },
                { name: "Hill Giant", owner: "me", ...untapped },
                { name: "Grizzly Bears", owner: "opp", ...untapped },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        offers: ["me:Grizzly Bears"],
        never: ["me:Hill Giant", "me:Stone Giant", "opp:Grizzly Bears"],
    },
    {
        // "Counter target spell that targets this creature": the Unsummon
        // aimed at Mistfolk yes, the Lightning Bolt aimed at a player no.
        abilityId: "mistfolk-counter",
        spec: {
            cards: [
                { name: "Mistfolk", owner: "me", ...untapped },
                { name: "Island", owner: "me", zone: "battlefield" },
            ],
            stack: [
                {
                    kind: "spell",
                    name: "Lightning Bolt",
                    controller: "opp",
                    targets: [{ kind: "player", seat: "me" }],
                },
                {
                    kind: "spell",
                    name: "Unsummon",
                    controller: "opp",
                    targets: [
                        { kind: "permanent", name: "Mistfolk", seat: "me" },
                    ],
                },
            ],
            priority: "me",
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        },
        offers: ["stack:Unsummon"],
        never: ["stack:Lightning Bolt"],
    },
];

describe("dynamic target requirements reach the Bot's enumerator (issue #7924, CR 602.2b / 601.2c)", () => {
    it("every shipped ability carrying a `getTargetRequirement` closure has a fixture here", () => {
        const shipped = new Set<string>();
        for (const def of getAllCatalogueCards()) {
            for (const a of def.activatedAbilities ?? []) {
                if (a.getTargetRequirement) shipped.add(a.id);
            }
        }
        // Guard the guard: an empty sweep is vacuously green.
        expect(shipped.size).toBeGreaterThanOrEqual(9);
        const covered = new Set(FIXTURES.map((f) => f.abilityId));
        expect([...shipped].filter((id) => !covered.has(id)).sort()).toEqual(
            []
        );
    });

    for (const fixture of FIXTURES) {
        it(`${fixture.abilityId}: offers exactly the targets the server accepts`, () => {
            const state = build(fixture.spec);
            const moves = movesFor(state, fixture.abilityId);
            expect(moves.length).toBeGreaterThan(0);
            const offered = offeredTargets(state, moves);
            for (const t of fixture.offers) expect(offered).toContain(t);
            for (const t of fixture.never) expect(offered).not.toContain(t);
            // Offered == accepted: the activation path re-resolves the same
            // requirement and validates every pick against it.
            const sourceId = (moves[0] as { cardInstanceId: string })
                .cardInstanceId;
            expect([...offered].sort()).toEqual(
                [
                    ...serverAcceptedTargets(
                        state,
                        sourceId,
                        fixture.abilityId
                    ),
                ].sort()
            );
        });
    }

    it("an ability whose resolved requirement has no legal target is not offered", () => {
        // Stone Giant alone: its only creature is itself (toughness 4 ≥ 3).
        const state = build({
            cards: [{ name: "Stone Giant", owner: "me", ...untapped }],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        });
        expect(movesFor(state, "stone-giant-fling")).toHaveLength(0);
    });
});
