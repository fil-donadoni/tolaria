// Integration: the vs-AI Bot rehydrates its viewpoint Projection into a search
// world whose OWN library carries REAL card identities, wired from the bot's
// decklist (issue #1509). Drives the real GRE → projectPublicState →
// projectedToGameState(ownDeck) path, then a simulated Demonic Tutor resolution,
// so a fetch/tutor lookahead searches the actual fetchable cards instead of the
// worthless placeholders the pre-#1509 adapter produced. See
// `../state-adapter.ts` and `convex/gre/ai/choiceCandidates.ts` (#1429).
//
// Own-deck CONTENT is public knowledge to its owner; only the ORDER is hidden
// (CR 401.1 / the determinize module's information-set discipline). The
// opponent's library stays hidden (placeholders) per the same rules.
import { afterAll, describe, expect, it } from "vitest";
import { getCardByName, tryGetDefinition } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { resolveTopOfStack } from "@convex/gre/state";
import { PLACEHOLDER_CARD_ID } from "@convex/gre";
import { choiceCandidates } from "@convex/gre/ai/choiceCandidates";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { demonicTutor } from "@convex/cards/sets/lea/black";
import type { CardInstanceState, GameState, PendingChoice } from "@convex/gre";
import { projectedToGameState } from "../state-adapter";
import { consultBrain, disposeBrain } from "../brain-client";

/** The card DEFINITION id of a rehydrated instance (the loose `card` type widens
 *  `id` to `unknown`; the adapter always writes a concrete string). */
function defIdOf(c: CardInstanceState): string {
    return c.card.id as string;
}

const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BOLT = getCardByName("Lightning Bolt").id;

/** N library instances of `defId` for the FAT state (identity is hidden by the
 *  projection — only the count survives, so the concrete card here is
 *  immaterial; the adapter rebuilds real identities from the decklist). */
function dummyLibrary(playerId: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(FOREST, {
            id: `${playerId}-fat-${i}`,
            controllerId: playerId,
            ownerId: playerId,
            zone: "library",
        })
    );
}

/** Multiset (defId → count) of a rehydrated library's real cards. */
function idCounts(library: CardInstanceState[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const c of library) {
        const id = defIdOf(c);
        m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
}

describe("AI own-library rehydration from decklist (issue #1509)", () => {
    it("criterion 1: a projected state + decklist yields own-library instances with REAL card ids", () => {
        // Deck: 4 Forest, 3 Bolt, 3 Mountain. One Bolt is already in hand, so
        // the library holds the remaining 9 cards.
        const deckCardIds = [
            FOREST,
            FOREST,
            FOREST,
            FOREST,
            BOLT,
            BOLT,
            BOLT,
            MOUNTAIN,
            MOUNTAIN,
            MOUNTAIN,
        ];
        const handBolt = makeInstance(BOLT, {
            id: "bot-hand-bolt",
            controllerId: "bot",
            ownerId: "bot",
            zone: "hand",
        });
        const state = makeState({
            turn: 3,
            players: [
                makePlayer("bot", {
                    hand: [handBolt],
                    library: dummyLibrary("bot", 9),
                }),
                makePlayer("human", { library: dummyLibrary("human", 12) }),
            ],
        });

        const projected = projectPublicState(state, 1, "bot");
        const world = projectedToGameState(projected, {
            playerId: "bot",
            cardIds: deckCardIds,
        });

        const botLib = world.players.find((p) => p.id === "bot")!.library;
        // Count preserved (deck-out SBA stays exact).
        expect(botLib).toHaveLength(9);
        // Every own-library instance carries a REAL id — no placeholders.
        expect(
            botLib.every(
                (c) =>
                    defIdOf(c) !== PLACEHOLDER_CARD_ID &&
                    tryGetDefinition(defIdOf(c)) !== undefined
            )
        ).toBe(true);
        // Content = deck minus the card already in hand (one Bolt removed).
        const counts = idCounts(botLib);
        expect(counts.get(FOREST)).toBe(4);
        expect(counts.get(BOLT)).toBe(2);
        expect(counts.get(MOUNTAIN)).toBe(3);

        // The OPPONENT's library stays hidden — opaque placeholders.
        const humanLib = world.players.find((p) => p.id === "human")!.library;
        expect(humanLib).toHaveLength(12);
        expect(humanLib.every((c) => c.card.id === PLACEHOLDER_CARD_ID)).toBe(
            true
        );
    });

    it("criterion 1 (regression): with NO decklist, the own library stays opaque placeholders", () => {
        const state = makeState({
            players: [
                makePlayer("bot", { library: dummyLibrary("bot", 8) }),
                makePlayer("human", { library: dummyLibrary("human", 8) }),
            ],
        });
        const world = projectedToGameState(projectPublicState(state, 1, "bot"));
        const botLib = world.players.find((p) => p.id === "bot")!.library;
        expect(botLib).toHaveLength(8);
        expect(botLib.every((c) => c.card.id === PLACEHOLDER_CARD_ID)).toBe(
            true
        );
    });

    it("criterion 2: a simulated Tutor resolution reaches a search-library choice whose candidates are the REAL fetchable cards", () => {
        // Deck: 4 Forest, 3 Bolt, 3 Mountain, plus the Demonic Tutor that is on
        // the stack (subtracted from the library by the adapter). Library = 10.
        const deckCardIds = [
            FOREST,
            FOREST,
            FOREST,
            FOREST,
            BOLT,
            BOLT,
            BOLT,
            MOUNTAIN,
            MOUNTAIN,
            MOUNTAIN,
            demonicTutor.id,
        ];
        const state = makeState({
            activePlayerId: "bot",
            priorityPlayerId: "bot",
            players: [
                makePlayer("bot", { library: dummyLibrary("bot", 10) }),
                makePlayer("human", { library: dummyLibrary("human", 10) }),
            ],
        });
        // The bot has cast Demonic Tutor — it sits on the stack, owned by the bot.
        pushSpell(state, demonicTutor.id, "bot");

        // Rehydrate through the real adapter path WITH the decklist.
        const projected = projectPublicState(state, 1, "bot");
        const world = projectedToGameState(projected, {
            playerId: "bot",
            cardIds: deckCardIds,
        });
        // Library = deck (11) minus the Tutor on the stack = 10 real cards.
        const botLib = world.players.find((p) => p.id === "bot")!.library;
        expect(botLib).toHaveLength(10);
        expect(
            botLib.every((c) => tryGetDefinition(defIdOf(c)) !== undefined)
        ).toBe(true);

        // Resolve the Tutor → suspends into a search-library choice (CR 701.19).
        resolveTopOfStack(world);
        const head = world.pendingChoices?.[0];
        expect(head?.kind).toBe("search-library");
        expect(head?.playerId).toBe("bot");

        // The candidate generator (#1429) sees REAL fetchable cards: distinct
        // leads keyed by real card identities, each move picking a real library
        // instance — not a single collapsed placeholder identity worth ~0.
        const cands = choiceCandidates(world, head!);
        expect(cands.length).toBeGreaterThan(1);

        const libById = new Map(botLib.map((c) => [c.id, defIdOf(c)]));
        const pickedDefIds = new Set<string>();
        for (const cand of cands) {
            const ids =
                (cand.move as { cardInstanceIds?: string[] }).cardInstanceIds ??
                [];
            for (const instId of ids) {
                const defId = libById.get(instId);
                expect(defId).toBeDefined();
                expect(defId).not.toBe(PLACEHOLDER_CARD_ID);
                expect(tryGetDefinition(defId!)).toBeDefined();
                pickedDefIds.add(defId!);
            }
        }
        // The leads span the distinct real fetchables, not one degenerate id.
        expect(pickedDefIds.size).toBeGreaterThan(1);
        for (const defId of pickedDefIds) {
            expect([FOREST, BOLT, MOUNTAIN]).toContain(defId);
        }
    });
});

// The COMPOSITION the two features must observe together (#1506 × #1509). The
// per-feature tests above cover the ownDeck reconstruction in isolation; the
// isolated-lookahead Tutor test resolves the search INSIDE the world (a fresh
// `search-library` choice arises mid-simulation, after the pile is already
// real). Neither exercises the case the review flagged: a search-library choice
// that is ALREADY LIVE at the root (`librarySearch` set on the wire) while the
// SAME player's `ownDeck` is supplied. The ownDeck reconstruction fabricates
// `libcard:<player>:<i>` ids the server never issued; a live search's candidate
// moves must name the REAL revealed-pile instance ids the server can accept. So
// `librarySearch` MUST win over the ownDeck reconstruction — the nesting in
// `projectedToGameState`. If ownDeck were allowed to overwrite the live pile,
// the fetch move would carry a `libcard:` id and the server would reject it
// forever — reintroducing #1506's fabricated-id bug through the #1509 path.
describe("live root search-library composes with ownDeck (#1506 × #1509)", () => {
    afterAll(() => disposeBrain());

    const BOT = "u1-p2";
    const HUMAN = "u1-p1";

    /** A board owned by the bot with a live `search-library` choice (CR 701.19)
     *  over a REAL revealed library pile — the shape a fetchland / tutor opens
     *  once resolution suspends. A vanilla creature host sits on the stack so
     *  `applyPendingChoiceSubmit` finds its `stackItemId` and resolves cleanly. */
    function stateWithLiveBotSearch(names: string[]): GameState {
        const state = makeState({
            players: [
                makePlayer(HUMAN),
                makePlayer(BOT, {
                    library: names.map((name, i) =>
                        makeInstance(getCardByName(name).id, {
                            id: `lib-${i}`,
                            controllerId: BOT,
                            ownerId: BOT,
                            zone: "library",
                        })
                    ),
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        state.stack = [
            {
                ...makeInstance(getCardByName("Grizzly Bears").id, {
                    id: "stack-1",
                    controllerId: BOT,
                    ownerId: BOT,
                    zone: "stack",
                }),
                castById: BOT,
                targets: [],
            } as unknown as GameState["stack"][number],
        ];
        state.pendingChoices = [
            {
                stackItemId: "stack-1",
                step: 0,
                choiceId: "c1",
                playerId: BOT,
                count: 1,
                prompt: "Search your library for a card.",
                kind: "search-library",
                zone: "library",
            } as PendingChoice,
        ];
        return state;
    }

    it("with ownDeck set, a searched fetch STILL names real librarySearch pile ids (not fabricated libcard: ids)", async () => {
        const names = ["Forest", "Craw Wurm", "Grizzly Bears"];
        const state = stateWithLiveBotSearch(names);
        const publicState = projectPublicState(state, 1, BOT);

        // The real, server-issued instance ids of the live revealed pile.
        const realIds = new Set(
            state.players.find((p) => p.id === BOT)!.library.map((c) => c.id)
        );

        // Supply the SAME player's decklist — this is the composition under
        // test. The projected pile carries `librarySearch`; ownDeck would
        // otherwise rebuild the library with fabricated `libcard:` ids.
        const ownDeck = {
            playerId: BOT,
            cardIds: names.map((n) => getCardByName(n).id),
        };
        const { move } = await consultBrain(
            publicState,
            BOT,
            { iterations: 24 },
            ownDeck
        );

        expect(move?.kind).toBe("resolution-choice");
        const picked = (move as { cardInstanceIds: string[] }).cardInstanceIds;
        expect(picked.length).toBeGreaterThan(0);
        for (const id of picked) {
            // Real pile id the server will accept — NOT a fabricated placeholder.
            expect(realIds.has(id)).toBe(true);
            expect(id.startsWith("libcard:")).toBe(false);
            expect(id.startsWith("placeholder:")).toBe(false);
        }
    });

    it("the adapter itself keeps the live librarySearch pile even when ownDeck is the same player", () => {
        const names = ["Forest", "Craw Wurm", "Grizzly Bears"];
        const state = stateWithLiveBotSearch(names);
        const publicState = projectPublicState(state, 1, BOT);
        const realIds = new Set(
            state.players.find((p) => p.id === BOT)!.library.map((c) => c.id)
        );

        const world = projectedToGameState(publicState, {
            playerId: BOT,
            cardIds: names.map((n) => getCardByName(n).id),
        });
        const botLib = world.players.find((p) => p.id === BOT)!.library;
        // Every instance is a real revealed-pile id — the ownDeck path did NOT
        // overwrite the live search with fabricated ids.
        for (const c of botLib) {
            expect(realIds.has(c.id)).toBe(true);
            expect(defIdOf(c)).not.toBe(PLACEHOLDER_CARD_ID);
        }
    });
});
