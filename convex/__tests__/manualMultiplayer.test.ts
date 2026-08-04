// Multiplayer Tabletop (manual mode, ADR 0080 S12 / PRD #2023).
//
// Manual mode shipped SOLO-only: `createManualSoloGame` was the single entry
// point and `createGame` / `joinGame` reject a manual-format deck fail-closed,
// so two humans could never share a Tabletop at all. `createManualGame` +
// `joinManualGame` are the manual-side mirror of that waiting-room pair.
//
// The project has no convex-test harness (see `limitedPlayPhaseGate.test.ts`),
// so this drives the REGISTERED mutations' own `_handler` — the function Convex
// actually deploys — against a stub `MutationCtx`, the same idiom that file
// uses.
import { describe, it, expect } from "vitest";
import type { MutationCtx } from "../_generated/server";
import {
    createManualGame,
    joinManualGame,
    createGame,
    joinGame,
} from "../game";
import type { ManualGameState } from "../manual";

type Doc = Record<string, unknown>;

/** A stub `MutationCtx` for `who` over a SHARED doc store — the two players
 *  hit the same database, only the identity differs. */
function ctxOver(who: string, docs: Map<string, Doc>): MutationCtx {
    let nextId = 1;
    return {
        auth: {
            getUserIdentity: async () => ({ subject: `${who}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            patch: async (id: string, patch: Doc) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            insert: async (table: string, doc: Doc): Promise<string> => {
                const _id = `${table}-${who}-${nextId++}`;
                docs.set(_id, { ...doc, _id, __table: table });
                return _id;
            },
            query: (table: string) => ({
                withIndex: (
                    _name: string,
                    build?: (q: {
                        eq: (field: string, value: unknown) => unknown;
                    }) => unknown
                ) => {
                    const constraints: Array<[string, unknown]> = [];
                    build?.({
                        eq: (field, value) => {
                            constraints.push([field, value]);
                            return { eq: () => ({}) };
                        },
                    });
                    const rows = [...docs.values()].filter(
                        (d) =>
                            d.__table === table &&
                            constraints.every(([f, v]) => d[f] === v)
                    );
                    return {
                        collect: async () => rows,
                        first: async () => rows[0] ?? null,
                        unique: async () => rows[0] ?? null,
                        order: () => ({
                            collect: async () => rows,
                            first: async () => rows[0] ?? null,
                        }),
                    };
                },
            }),
        },
    } as unknown as MutationCtx;
}

/** Fresh store with Alice + Bob registered. */
function freshDocs(): Map<string, Doc> {
    const docs = new Map<string, Doc>();
    for (const u of [user("alice", "Alice"), user("bob", "Bob")])
        docs.set(u._id as string, u);
    return docs;
}

function user(id: string, nickname: string): Doc {
    return { _id: id, __table: "users", nickname };
}

function tabletopDeck(id: string, name: string) {
    return {
        id,
        name,
        format: "manual",
        cards: [
            { cardId: "print-1", cardName: "Sliver Queen" },
            { cardId: "print-2", cardName: "Crystalline Sliver" },
        ],
    };
}

function realDeck() {
    return {
        id: "real",
        name: "Real Deck",
        format: "freeform",
        cards: [{ cardId: "print-9", cardName: "Lightning Bolt" }],
    };
}

function runHandler<TArgs>(
    fn: unknown,
    ctx: MutationCtx,
    args: TArgs
): Promise<unknown> {
    return (
        fn as unknown as {
            _handler: (ctx: MutationCtx, args: TArgs) => Promise<unknown>;
        }
    )._handler(ctx, args);
}

const rowsOf = (docs: Map<string, Doc>, table: string) =>
    [...docs.values()].filter((d) => d.__table === table);

describe("createManualGame — opening a multiplayer Tabletop (ADR 0080 S12)", () => {
    it("opens a waiting, manual-mode Match with one seat", async () => {
        const docs = freshDocs();
        const gameId = (await runHandler(
            createManualGame,
            ctxOver("alice", docs),
            {
                name: "Alice's Tabletop",
                deck: tabletopDeck("d1", "Slivers"),
                bestOf: 1 as const,
            }
        )) as string;

        const game = docs.get(gameId)!;
        expect(game.status).toBe("waiting");
        expect(game.mode).toBe("manual");
        expect(game.solo).toBeUndefined();
        expect((game.players as unknown[]).length).toBe(1);

        const matches = rowsOf(docs, "matches");
        expect(matches).toHaveLength(1);
        expect(matches[0].status).toBe("waiting");
        // No state row yet: the table is not live until someone sits down.
        expect(rowsOf(docs, "manualStates")).toHaveLength(0);
    });

    it("rejects a real deck", async () => {
        await expect(
            runHandler(createManualGame, ctxOver("alice", freshDocs()), {
                name: "nope",
                deck: realDeck(),
                bestOf: 1 as const,
            })
        ).rejects.toThrow(/Tabletop-format/);
    });

    it("rejects an empty Tabletop deck", async () => {
        // The manual Format validates nothing by design (ADR 0080), so this
        // gate cannot come from `validateDeck`.
        await expect(
            runHandler(createManualGame, ctxOver("alice", freshDocs()), {
                name: "nope",
                deck: { ...tabletopDeck("d1", "Empty"), cards: [] },
                bestOf: 1 as const,
            })
        ).rejects.toThrow(/at least one card/);
    });
});

describe("joinManualGame — sitting down at an open Tabletop", () => {
    async function openTable() {
        const docs = freshDocs();
        const gameId = (await runHandler(
            createManualGame,
            ctxOver("alice", docs),
            {
                name: "Alice's Tabletop",
                deck: tabletopDeck("d1", "Slivers"),
                bestOf: 1 as const,
            }
        )) as string;
        return { gameId, docs };
    }

    it("flips the table to playing and builds both seats' initial state", async () => {
        const { gameId, docs } = await openTable();

        await runHandler(joinManualGame, ctxOver("bob", docs), {
            gameId,
            deck: tabletopDeck("d2", "Bob's Slivers"),
        });

        const game = docs.get(gameId)!;
        expect(game.status).toBe("playing");
        expect((game.players as unknown[]).length).toBe(2);
        expect(rowsOf(docs, "matches")[0].status).toBe("playing");

        // No coin toss / pregame gate: a Tabletop has no automated turn
        // structure to hand to a first player (ADR 0080).
        expect(game.status).not.toBe("pregame");

        const states = rowsOf(docs, "manualStates");
        expect(states).toHaveLength(1);
        const state = states[0].state as ManualGameState;
        expect(state.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
        // Both libraries were seeded from their own deck snapshot (2 cards
        // each, all drawn into the opening hand since a 2-card deck is under
        // the 7-card draw).
        for (const p of state.players) {
            expect(p.library.length + p.hand.length).toBe(2);
            expect(p.life).toBe(20);
        }
        expect(rowsOf(docs, "manualLog")).toHaveLength(1);
    });

    it("rejects a real deck at a Tabletop", async () => {
        const { gameId, docs } = await openTable();
        await expect(
            runHandler(joinManualGame, ctxOver("bob", docs), {
                gameId,
                deck: realDeck(),
            })
        ).rejects.toThrow(/Tabletop-format/);
    });

    it("rejects joining a REAL table with joinManualGame", async () => {
        const docs = freshDocs();
        const gameId = (await runHandler(createGame, ctxOver("alice", docs), {
            name: "Alice's game",
            deck: realDeck(),
            bestOf: 1 as const,
        })) as string;

        await expect(
            runHandler(joinManualGame, ctxOver("bob", docs), {
                gameId,
                deck: tabletopDeck("d2", "Slivers"),
            })
        ).rejects.toThrow(/real game/);
    });

    it("rejects joining a TABLETOP table with joinGame (the engine's seam holds)", async () => {
        const { gameId, docs } = await openTable();
        await expect(
            runHandler(joinGame, ctxOver("bob", docs), {
                gameId,
                deck: tabletopDeck("d2", "Slivers"),
            })
        ).rejects.toThrow(/cannot start a real game/);
    });

    it("rejects a second joiner once the table is full", async () => {
        const { gameId, docs } = await openTable();
        docs.set("carol", user("carol", "Carol"));
        await runHandler(joinManualGame, ctxOver("bob", docs), {
            gameId,
            deck: tabletopDeck("d2", "Bob's Slivers"),
        });
        await expect(
            runHandler(joinManualGame, ctxOver("carol", docs), {
                gameId,
                deck: tabletopDeck("d3", "Carol's Slivers"),
            })
        ).rejects.toThrow(/not open|full/);
    });
});
