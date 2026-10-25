// CR 701.20a / 614.1a — a graveyard-bound redirect whose Oracle text reveals
// the card ("reveal it and shuffle it into its owner's library instead",
// Blightsteel Colossus) raises a public reveal notification from the single
// `graveyardDestinationFor` chokepoint, whatever the origin zone and whether or
// not a stack item is resolving (issue #2557).
import { describe, it, expect, beforeAll } from "vitest";
import type { CardInstanceState } from "../state";
import {
    buildSpellContext,
    discardToGraveyard,
    resolveTopOfStack,
} from "../state";
import { checkZeroToughnessSBA } from "../sba";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    shuffleFromAnywhereId,
    shuffleFromAnywhereOracleText,
    shuffleFromAnywhereReplacement,
} from "../../cards/abilities/shuffleFromAnywhereReplacement";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { saveGameState } from "../../gameStateStore";

const REVEALER_ID = "test-redirect-reveal-creature";
const REVEALER_SPELL_ID = "test-redirect-reveal-sorcery";
const BYSTANDER_SPELL_ID = "test-redirect-reveal-bystander";

function revealing(
    id: string,
    name: string,
    types: CardDefinition["types"]
): CardDefinition {
    return {
        id,
        name,
        rarity: "common",
        types,
        subtypes: [],
        ...(types.includes("Creature") ? { power: 1, toughness: 1 } : {}),
        ...(types.includes("Sorcery")
            ? { targetRequirement: { type: "creature" as const } }
            : {}),
        replacementEffects: [
            shuffleFromAnywhereReplacement({
                id: shuffleFromAnywhereId(name),
                oracleText: shuffleFromAnywhereOracleText(name),
            }),
        ],
    };
}

beforeAll(() => {
    registerTokenDefinition(
        revealing(REVEALER_ID, "Test Reveal Creature", ["Creature"])
    );
    registerTokenDefinition(
        revealing(REVEALER_SPELL_ID, "Test Reveal Sorcery", ["Sorcery"])
    );
    registerTokenDefinition({
        id: BYSTANDER_SPELL_ID,
        name: "Test Bystander Sorcery",
        rarity: "common",
        types: ["Sorcery"],
    });
});

function revealer(
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return {
        id,
        card: { id: REVEALER_ID },
        types: ["Creature"],
        subtypes: [],
        power: 1,
        toughness: 1,
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone,
        isTapped: false,
    };
}

function expectRevealFor(
    state: ReturnType<typeof makeState>,
    instanceId: string,
    cardId = REVEALER_ID
) {
    const entries = (state.pendingReveals ?? []).filter((r) =>
        r.cards.some((c) => c.instanceId === instanceId)
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("reveal");
    expect(entries[0].source).toBe(cardId);
    expect(entries[0].cards).toEqual([{ instanceId, cardId }]);
    expect([...entries[0].audience].sort()).toEqual(["p1", "p2"]);
    return entries[0];
}

describe("revealing graveyard-bound redirect (CR 701.20a, issue #2557)", () => {
    it("mill from the library reveals the card and shuffles it back", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [revealer("r1", "p1", "library")],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, BYSTANDER_SPELL_ID, "p1");
        buildSpellContext(state, item).millCards("p1", 1);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["r1"]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expectRevealFor(state, "r1");
    });

    it("resolution-driven discard from hand reveals", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [revealer("r1", "p1", "hand")] }),
                makePlayer("p2"),
            ],
        });
        expect(
            discardToGraveyard(state, "p1", "r1", {
                kind: "effect",
                controllerId: "p1",
            })
        ).toBe(true);
        expectRevealFor(state, "r1");
    });

    it("non-resolution discard (empty stack) reveals", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [revealer("r1", "p1", "hand")] }),
                makePlayer("p2"),
            ],
        });
        expect(state.stack).toHaveLength(0);
        discardToGraveyard(state, "p1", "r1", {
            kind: "cost",
            controllerId: "p1",
        } as never);
        expectRevealFor(state, "r1");
    });

    it("battlefield death through an SBA sweep (no stack item) reveals", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [revealer("r1", "p1", "battlefield")],
                }),
                makePlayer("p2"),
            ],
        });
        state.players[0].battlefield[0].toughness = 0;
        checkZeroToughnessSBA(state);
        expect(state.stack).toHaveLength(0);
        expectRevealFor(state, "r1");
    });

    it("a fizzled spell leaving the stack reveals", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, REVEALER_SPELL_ID, "p1", [
            { type: "permanent", id: "gone" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(0);
        expectRevealFor(state, item.id, REVEALER_SPELL_ID);
    });

    it("two redirects in one game get distinct notification ids", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        revealer("r1", "p1", "hand"),
                        revealer("r2", "p1", "hand"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        for (const id of ["r1", "r2"]) {
            discardToGraveyard(state, "p1", id, {
                kind: "effect",
                controllerId: "p1",
            });
        }
        const ids = (state.pendingReveals ?? []).map((r) => r.id);
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);
    });

    it("a redirect that does not reveal (exile) enqueues nothing", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.graveyardBoundRedirectThisTurn = [
            { ownerId: "p1", tagCounters: undefined } as never,
        ];
        state.players[0].hand.push({
            ...revealer("b1", "p1", "hand"),
            card: { id: BYSTANDER_SPELL_ID },
        });
        discardToGraveyard(state, "p1", "b1", {
            kind: "effect",
            controllerId: "p1",
        });
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["b1"]);
        expect(state.pendingReveals ?? []).toHaveLength(0);
    });

    it("SURFACE: the opponent's projected view carries the reveal", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [revealer("r1", "p1", "hand")] }),
                makePlayer("p2"),
            ],
        });
        discardToGraveyard(state, "p1", "r1", {
            kind: "effect",
            controllerId: "p1",
        });
        const view = projectPublicState(state, 1, "p2");
        expect(view.pendingReveals).toHaveLength(1);
        expect(view.pendingReveals![0].cards[0].cardId).toBe(REVEALER_ID);
    });

    it("TRAP: a later resolution in the same mutation does not wipe the reveal; the next mutation's does", async () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [revealer("r1", "p1", "library")],
                }),
                makePlayer("p2"),
            ],
        });
        const a = pushSpell(state, BYSTANDER_SPELL_ID, "p1");
        buildSpellContext(state, a).millCards("p1", 1);
        pushSpell(state, BYSTANDER_SPELL_ID, "p1");
        resolveTopOfStack(state); // resolution B, same mutation
        expectRevealFor(state, "r1");

        // Persisting strips the carry flag ...
        const writes: Array<Record<string, unknown>> = [];
        const db = {
            patch: async () => {},
            insert: async (_t: string, doc: Record<string, unknown>) => {
                writes.push(doc);
            },
            get: async () => null,
            query: () => ({
                withIndex: () => ({ first: async () => null }),
            }),
        };
        await saveGameState({ db } as never, "g" as never, 1, state, null);
        expect(state.pendingReveals![0].retained).toBeUndefined();

        // ... so the next mutation's first resolution clears it.
        pushSpell(state, BYSTANDER_SPELL_ID, "p1");
        resolveTopOfStack(state);
        expect(state.pendingReveals ?? []).toHaveLength(0);
    });
});
