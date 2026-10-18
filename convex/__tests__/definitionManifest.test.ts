// The Definition Manifest (issue #5614, PRD #5602): per seat, the Card
// Definitions a Game can need on that seat's client — both maindecks, both
// companions, the seat's OWN sideboard — each keyed by the Set code of the
// client shard that holds it. Built with the Game's state, widened by a debug
// load, read by `gameReads.getDefinitionManifest`.
//
// The flows below drive the REGISTERED handlers (`chooseFirstPlayer`,
// `submitSideboard`, `setReady`, `debugSetupScenario`,
// `debugLoadBladeScenario`, `getDefinitionManifest`) over the shared stub ctx
// (`gameMutationHarness.fixture.ts`) — the repo has no convex-test harness —
// with real catalogue cards, so the print → definition resolution, the
// companion declaration and the Set codes are the engine's own.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { Id } from "../_generated/dataModel";
import { getCardByName } from "../cards";
import { getDefinitionSetCode } from "../cards/catalogue";
import { FACE_DOWN_CARD_ID } from "../cards/registry";
import { twinDefinitionId } from "../cards/twinId";
import { chooseFirstPlayer, debugSetupScenario, setReady } from "../game";
import { submitSideboard } from "../gameTable";
import { getDefinitionManifest, getSeatDeckKnowledge } from "../gameReads";
import { debugLoadBladeScenario } from "../debugBlade";
import { manifestEntries, stateDefinitionIds } from "../definitionManifest";
import type { DefinitionManifestEntry } from "../definitionManifestEntry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "./gameMutationHarness.fixture";

const idOf = (name: string) => getCardByName(name).id;

// Hand-written (the Set module is the shard) …
const MOUNTAIN = idOf("Mountain");
const ISLAND = idOf("Island");
const BOLT = idOf("Lightning Bolt");
const COUNTERSPELL = idOf("Counterspell");
const BEARS = idOf("Grizzly Bears");
const LIONS = idOf("Savannah Lions");
const LUTRI = idOf("Lutri, the Spellchaser");
// … and compiled (the first-printing Set, off the compiled index).
const SIREN = idOf("Siren Lookout");
const SWAB = idOf("Swab Goblin");
const KAVU = idOf("Kavu Glider");
const KNIGHT = idOf("Venerable Knight");

/** Reprints' Print IDs: the deck names these printings, and only their
 *  `cardPrints` rows say which definitions they are — one in a maindeck, one
 *  in a sideboard (resolved by different halves of the build). */
const BOLT_PRINT = "0b0b0b0b-1111-4222-8333-444444444444";
const LIONS_PRINT = "1a1a1a1a-5555-4666-8777-888888888888";

const entry = (cardId: string) => ({ cardId, cardName: cardId });
const many = (cardId: string, n: number) =>
    Array.from({ length: n }, () => entry(cardId));

/** Alice: a singleton spell suite (Lutri's companion condition) and Lutri in
 *  the sideboard, beside Savannah Lions — a card only Alice may know of. */
const ALICE_MAIN = [
    ...many(MOUNTAIN, 4),
    ...many(ISLAND, 2),
    entry(BOLT_PRINT),
    entry(COUNTERSPELL),
    entry(BEARS),
];
const ALICE_SIDE = [entry(LUTRI), entry(LIONS_PRINT)];
/** Bob: compiled cards, and Venerable Knight in a sideboard Alice may not
 *  see. No companion. */
const BOB_MAIN = [...many(MOUNTAIN, 5), entry(SIREN), entry(SWAB), entry(KAVU)];
const BOB_SIDE = [entry(KNIGHT)];

function printRow(_id: string, printId: string, cardId: string, set: string) {
    return {
        _id,
        __table: "cardPrints",
        printId,
        cardId,
        set,
        rarity: "common",
        digital: false,
        promo: false,
        tokenPrints: [],
    };
}

function matchSeat(id: string, name: string) {
    return {
        id,
        name,
        bgColor: "#000000",
        deck: { id: `deck-${id}`, name: "Deck", format: "freeform" },
        score: 0,
        ready: false,
    };
}

/** A Match at its G1 coin toss: `matches` + `matchDecks` + the pregame
 *  `games` row, exactly what `createGame`/`joinGame` (or `createSoloGame`)
 *  leave behind, plus the reprint's `cardPrints` row. */
function pregameSeeds(opts: {
    users: Row[];
    seats: [string, string];
    decks: [{ main: Row[]; side: Row[] }, { main: Row[]; side: Row[] }];
    bestOf: 1 | 3;
    solo?: boolean;
}): Row[] {
    const [a, b] = opts.seats;
    const players = [matchSeat(a, "P1"), matchSeat(b, "P2")];
    return [
        ...opts.users,
        {
            _id: "match-1",
            __table: "matches",
            bestOf: opts.bestOf,
            status: "pregame",
            players,
            currentGameNumber: 1,
            currentGameId: "game-1",
            playDrawChooserId: a,
            ...(opts.solo ? { solo: true } : {}),
            createdAt: 0,
            updatedAt: 0,
        },
        ...opts.seats.map((seat, i) => ({
            _id: `match-deck-${i}`,
            __table: "matchDecks",
            matchId: "match-1",
            playerId: seat,
            maindeck: opts.decks[i]!.main,
            sideboard: opts.decks[i]!.side,
        })),
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
            matchId: "match-1",
            gameNumber: 1,
            status: "pregame",
            players: players.map(({ id, name, bgColor, deck }) => ({
                id,
                name,
                bgColor,
                deck,
            })),
            ...(opts.solo ? { solo: true } : {}),
            createdAt: 0,
            updatedAt: 0,
        },
        printRow("print-bolt", BOLT_PRINT, BOLT, "m10"),
        printRow("print-lions", LIONS_PRINT, LIONS, "10e"),
    ];
}

/** Alice (`u1`) and Bob (`u2`) at a Constructed Bo3's coin toss. */
function constructedMatch(): MutationStub {
    return makeMutationCtx(
        "u1",
        pregameSeeds({
            users: [
                { _id: "u1", __table: "users", nickname: "Alice" },
                { _id: "u2", __table: "users", nickname: "Bob" },
            ],
            seats: ["u1", "u2"],
            decks: [
                { main: ALICE_MAIN, side: ALICE_SIDE },
                { main: BOB_MAIN, side: BOB_SIDE },
            ],
            bestOf: 3,
        })
    );
}

/** An admin's solo Game at its coin toss — the shape the debug loaders act
 *  on (a Blade entry requires a solo Game). */
function soloMatch(): MutationStub {
    return makeMutationCtx(
        "u3",
        pregameSeeds({
            users: [
                {
                    _id: "u3",
                    __table: "users",
                    nickname: "Admin",
                    isAdmin: true,
                },
            ],
            seats: ["u3-p1", "u3-p2"],
            decks: [
                { main: ALICE_MAIN, side: ALICE_SIDE },
                { main: BOB_MAIN, side: BOB_SIDE },
            ],
            bestOf: 1,
            solo: true,
        })
    );
}

async function buildFirstGame(stub: MutationStub, chooser: string) {
    await runMutation(chooseFirstPlayer, stub.asUser(chooser), {
        matchId: "match-1" as Id<"matches">,
        choice: "play",
    });
}

/** `getDefinitionManifest` as `userId` asks for `playerId`'s. */
async function manifest(
    stub: MutationStub,
    userId: string,
    gameId: string,
    playerId: string
) {
    return runMutation<
        { gameId: Id<"games">; playerId: string },
        { playerId: string; entries: DefinitionManifestEntry[] } | null
    >(getDefinitionManifest, stub.asUser(userId), {
        gameId: gameId as Id<"games">,
        playerId,
    });
}

async function manifestIds(
    stub: MutationStub,
    userId: string,
    gameId: string,
    playerId: string
): Promise<string[]> {
    const read = await manifest(stub, userId, gameId, playerId);
    expect(read, `${playerId}'s manifest of ${gameId}`).not.toBeNull();
    return read!.entries.map((e) => e.definitionId).sort();
}

const sorted = (ids: string[]) => [...new Set(ids)].sort();

/** Both maindecks as definitions — Alice's Bolt resolved off its print row —
 *  plus Alice's declared companion: public to both seats. */
const G1_PUBLIC = [
    MOUNTAIN,
    ISLAND,
    BOLT,
    COUNTERSPELL,
    BEARS,
    SIREN,
    SWAB,
    KAVU,
    LUTRI,
];

describe("Definition Manifest — a created Constructed game (issue #5614)", () => {
    it("gives each seat both maindecks, both companions and ITS OWN sideboard, as definition ids", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");

        expect(await manifestIds(stub, "u1", "game-1", "u1")).toEqual(
            sorted([...G1_PUBLIC, LUTRI, LIONS])
        );
        expect(await manifestIds(stub, "u2", "game-1", "u2")).toEqual(
            sorted([...G1_PUBLIC, KNIGHT])
        );
    });

    it("never shows a seat the other's sideboard — not in its own manifest, and not by asking for the other's", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");

        expect(await manifestIds(stub, "u1", "game-1", "u1")).not.toContain(
            KNIGHT
        );
        expect(await manifestIds(stub, "u2", "game-1", "u2")).not.toContain(
            LIONS
        );
        expect(await manifest(stub, "u1", "game-1", "u2")).toBeNull();
        expect(await manifest(stub, "u2", "game-1", "u1")).toBeNull();
    });

    it("resolves a printing to its definition, never listing the Print ID — maindeck and sideboard alike", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");

        const ids = await manifestIds(stub, "u1", "game-1", "u1");
        expect(ids).toEqual(expect.arrayContaining([BOLT, LIONS]));
        expect(ids).not.toContain(BOLT_PRINT);
        expect(ids).not.toContain(LIONS_PRINT);
    });

    it("keys every entry by its definition's Set — the module's for a hand-written card, the first printing's for a compiled one", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");

        const { entries } = (await manifest(stub, "u1", "game-1", "u1"))!;
        for (const e of entries) {
            expect(e.setCode, e.definitionId).not.toBe("");
            expect(e.setCode, e.definitionId).toBe(
                getDefinitionSetCode(e.definitionId)
            );
        }
        const setOf = (id: string) =>
            entries.find((e) => e.definitionId === id)?.setCode;
        expect(setOf(MOUNTAIN)).toBe("lea");
        expect(setOf(LUTRI)).toBe("iko");
        expect(setOf(SIREN)).toBe("xln");
    });

    it("orders entries by shard and id, so the order cannot spell out an opening hand", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");

        const { entries } = (await manifest(stub, "u2", "game-1", "u2"))!;
        const key = (e: DefinitionManifestEntry) =>
            `${e.setCode}\u0000${e.definitionId}`;
        const keys = entries.map(key);
        expect(keys).toEqual([...keys].sort());
    });

    it("has no manifest before the Game's state is built (the coin toss)", async () => {
        const stub = constructedMatch();
        expect(await manifest(stub, "u1", "game-1", "u1")).toBeNull();
    });
});

describe("Definition Manifest — Game 2 of a Bo3 (issue #5614)", () => {
    it("reflects the post-sideboarding maindecks", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");
        // Game 1 is over and undecided: the Match is at the between-Games gate.
        stub.doc("match-1").status = "sideboarding";

        // Alice sideboards Grizzly Bears out and Savannah Lions in.
        await runMutation(submitSideboard, stub.asUser("u1"), {
            matchId: "match-1" as Id<"matches">,
            seatId: "u1",
            maindeck: ALICE_MAIN.map((c) =>
                c.cardId === BEARS ? entry(LIONS_PRINT) : c
            ),
            sideboard: [entry(LUTRI), entry(BEARS)],
        });
        await runMutation(setReady, stub.asUser("u1"), {
            matchId: "match-1" as Id<"matches">,
            seatId: "u1",
        });
        const { gameId } = await runMutation<
            { matchId: Id<"matches">; seatId: string },
            { gameId: string | null }
        >(setReady, stub.asUser("u2"), {
            matchId: "match-1" as Id<"matches">,
            seatId: "u2",
        });
        expect(gameId).not.toBeNull();
        expect(gameId).not.toBe("game-1");

        const bob = await manifestIds(stub, "u2", gameId!, "u2");
        expect(bob).toContain(LIONS);
        expect(bob).not.toContain(BEARS);
        expect(await manifestIds(stub, "u1", gameId!, "u1")).toEqual(
            sorted([
                ...G1_PUBLIC.filter((id) => id !== BEARS),
                LIONS,
                LUTRI,
                BEARS,
            ])
        );
    });
});

describe("Definition Manifest — a debug load widens it (issue #5614)", () => {
    it("debugSetupScenario: a card placed from outside both decks joins every seat's manifest", async () => {
        const stub = soloMatch();
        await buildFirstGame(stub, "u3");
        const SHIVAN = idOf("Shivan Dragon");
        expect(await manifestIds(stub, "u3", "game-1", "u3-p1")).not.toContain(
            SHIVAN
        );

        await runMutation(debugSetupScenario, stub.asUser("u3"), {
            gameId: "game-1" as Id<"games">,
            cards: [{ name: "Shivan Dragon", owner: "opp" }],
        });

        for (const seat of ["u3-p1", "u3-p2"]) {
            const ids = await manifestIds(stub, "u3", "game-1", seat);
            expect(ids, seat).toContain(SHIVAN);
        }
        // Widened, not rebuilt from the position: a sideboard stays.
        expect(await manifestIds(stub, "u3", "game-1", "u3-p1")).toContain(
            LIONS
        );
    });

    it("gives a Game built before manifests existed none — a position alone has no sideboards and would read as complete", async () => {
        const stub = soloMatch();
        await buildFirstGame(stub, "u3");
        // The rows a pre-manifest build never wrote.
        for (const w of stub.writes)
            if (w.table === "gameDefinitionManifests")
                stub.doc(w.id).__table = "dropped";
        expect(await manifest(stub, "u3", "game-1", "u3-p1")).toBeNull();

        await runMutation(debugSetupScenario, stub.asUser("u3"), {
            gameId: "game-1" as Id<"games">,
            cards: [{ name: "Shivan Dragon", owner: "opp" }],
        });

        expect(await manifest(stub, "u3", "game-1", "u3-p1")).toBeNull();
        expect(await manifest(stub, "u3", "game-1", "u3-p2")).toBeNull();
    });

    it("debugLoadBladeScenario: the entry's position joins every seat's manifest", async () => {
        const stub = soloMatch();
        await buildFirstGame(stub, "u3");
        const DREADNOUGHT = idOf("Phyrexian Dreadnought");
        const STIFLE = idOf("Stifle");

        await runMutation(debugLoadBladeScenario, stub.asUser("u3"), {
            gameId: "game-1" as Id<"games">,
            label: "charter: Stifles its own Phyrexian Dreadnought trigger",
        });

        for (const seat of ["u3-p1", "u3-p2"]) {
            const ids = await manifestIds(stub, "u3", "game-1", seat);
            expect(ids, seat).toEqual(expect.arrayContaining([DREADNOUGHT]));
            expect(ids, seat).toEqual(expect.arrayContaining([STIFLE]));
        }
    });
});

/** `getSeatDeckKnowledge` as `userId` asks for `playerId`'s. */
async function deckKnowledge(
    stub: MutationStub,
    userId: string,
    gameId: string,
    playerId: string
) {
    return runMutation<
        { gameId: Id<"games">; playerId: string },
        {
            playerId: string;
            cardIds: string[];
            entries: DefinitionManifestEntry[];
        } | null
    >(getSeatDeckKnowledge, stub.asUser(userId), {
        gameId: gameId as Id<"games">,
        playerId,
    });
}

/** Alice's maindeck as the game build resolves it: her Bolt reprint read off
 *  its `cardPrints` row. */
const ALICE_MAIN_DEFINITIONS = ALICE_MAIN.map((c) =>
    c.cardId === BOLT_PRINT ? BOLT : c.cardId
);

describe("Seat deck knowledge — the Bot's decklists as definition ids (issue #5617)", () => {
    it("gives a seat its own maindeck as definition ids, one per copy in decklist order — a Print-id entry resolved", async () => {
        const stub = soloMatch();
        await buildFirstGame(stub, "u3");

        const read = await deckKnowledge(stub, "u3", "game-1", "u3-p1");
        expect(read?.playerId).toBe("u3-p1");
        expect(read?.cardIds).toEqual(ALICE_MAIN_DEFINITIONS);
        expect(read?.cardIds).not.toContain(BOLT_PRINT);
        expect(
            (await deckKnowledge(stub, "u3", "game-1", "u3-p2"))?.cardIds
        ).toEqual(BOB_MAIN.map((c) => c.cardId));
    });

    it("names the Manifest entries of those definitions only — the worker's Manifest, neither the other maindeck nor a sideboard", async () => {
        const stub = soloMatch();
        await buildFirstGame(stub, "u3");

        const read = await deckKnowledge(stub, "u3", "game-1", "u3-p1");
        expect(read!.entries.map((e) => e.definitionId).sort()).toEqual(
            sorted(ALICE_MAIN_DEFINITIONS)
        );
        for (const e of read!.entries) {
            expect(e.setCode, e.definitionId).toBe(
                getDefinitionSetCode(e.definitionId)
            );
        }
    });

    it("is gated on seat ownership, like the decklist it is", async () => {
        const stub = constructedMatch();
        await buildFirstGame(stub, "u1");

        expect(await deckKnowledge(stub, "u1", "game-1", "u2")).toBeNull();
        expect(
            (await deckKnowledge(stub, "u2", "game-1", "u2"))?.cardIds
        ).toEqual(BOB_MAIN.map((c) => c.cardId));
    });

    it("keeps the deck through a debug widen — a widen changes what a client may need, never what the seat drew from", async () => {
        const stub = soloMatch();
        await buildFirstGame(stub, "u3");

        await runMutation(debugSetupScenario, stub.asUser("u3"), {
            gameId: "game-1" as Id<"games">,
            cards: [{ name: "Shivan Dragon", owner: "opp" }],
        });

        expect(
            (await deckKnowledge(stub, "u3", "game-1", "u3-p1"))?.cardIds
        ).toEqual(ALICE_MAIN_DEFINITIONS);
    });

    it("reads null for a row written before the deck was stored on it, and before the Game is built", async () => {
        const stub = soloMatch();
        expect(await deckKnowledge(stub, "u3", "game-1", "u3-p1")).toBeNull();
        await buildFirstGame(stub, "u3");
        for (const w of stub.writes)
            if (w.table === "gameDefinitionManifests")
                delete (stub.doc(w.id) as { deck?: string[] }).deck;
        expect(await deckKnowledge(stub, "u3", "game-1", "u3-p1")).toBeNull();
    });
});

describe("Definition Manifest — what a state contributes (issue #5614)", () => {
    const BORROWER = idOf("Brazen Borrower");
    /** A card of `p1`'s whose `card.id` is `cardId` — all the walk reads. */
    const presenting = (cardId: string) =>
        makeInstance(MOUNTAIN, { card: { id: cardId } as never });

    it("names a twin's parent, and gives a token or a face-down sentinel no entry", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        presenting(FACE_DOWN_CARD_ID),
                        presenting("token:Soldier|Creature|Soldier||1|1||"),
                    ],
                    hand: [presenting(twinDefinitionId(BORROWER, "adventure"))],
                }),
                makePlayer("p2"),
            ],
        });

        expect(stateDefinitionIds(state, "p1")).toEqual([BORROWER]);
    });

    it("tells a face-down card's identity to its controller only", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(FACE_DOWN_CARD_ID, {
                            controllerId: "p1",
                            ownerId: "p1",
                            faceDown: true,
                            faceDownOf: SIREN,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

        expect(stateDefinitionIds(state, "p1")).toEqual([SIREN]);
        expect(stateDefinitionIds(state, "p2")).toEqual([]);
    });

    it("leaves out an id the Definition Index does not hold — no shard serves it", () => {
        expect(manifestEntries(["not-a-card", MOUNTAIN])).toEqual([
            { definitionId: MOUNTAIN, setCode: "lea" },
        ]);
    });
});

describe("Definition Manifest — every Definition Index entry has a shard key (issue #5614)", () => {
    const REPO_ROOT = path.resolve(__dirname, "../..");
    const readJson = (rel: string) =>
        JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));

    it("resolves a non-empty Set code for every hand-written and every compiled entry", () => {
        const handWritten = (
            readJson("data/catalogue/definition-index.json").entries as [
                string,
            ][]
        ).map(([id]) => id);
        const compiled = readJson("data/catalogue/packed-corpus.json")
            .ids as string[];
        expect(handWritten.length).toBeGreaterThan(0);
        expect(compiled.length).toBeGreaterThan(0);

        const keyless = [...handWritten, ...compiled].filter(
            (id) => getDefinitionSetCode(id) === ""
        );
        expect(keyless).toEqual([]);
    });
});
