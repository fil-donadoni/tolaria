// FULL PATH — partial library-order knowledge survives from the engine to the
// search world (issue #1524).
//
// Four real seams in a row, because the bug lived in the joint between them and
// a hand-built view at any step would hide it:
//
//   grantKnowledge (ADR 0026, the engine primitive every scry / surveil /
//     Brainstorm submit path calls)
//     → projectPublicState  (strips raw `knownTo`, emits the sparse
//       `library.known[]` runs)
//     → projectedToGameState (rebuilds the library, overlays the known
//       identities, restores `knownTo` for the viewer)
//     → determinize          (must now PIN those positions instead of
//       reshuffling the whole library every ISMCTS iteration)
//
// Before this, the last step threw the first three away: a bot that had just
// scryed a card to the top forgot it on the search's first iteration, and every
// line whose value depended on the known next draw was valued as a random draw.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { grantKnowledge } from "@convex/gre/state";
import { determinize } from "@convex/gre/determinize";
import { makeRng } from "@convex/gre/rng";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectedToGameState } from "../state-adapter";

const BOLT = getCardByName("Lightning Bolt").id;
const BEARS = getCardByName("Grizzly Bears").id;
const MOUNTAIN = getCardByName("Mountain").id;

const SEEDS = [1, 2, 3, 7, 11, 42, 1337];

/** A bot library whose ends are distinguishable from its filler, so a pin that
 *  silently failed would show up as a Mountain rather than as a Bolt. */
const LIBRARY_IDS = [
    BOLT,
    BEARS,
    ...Array.from({ length: 10 }, () => MOUNTAIN),
    BEARS,
    BOLT,
];

/** The bot's own decklist, the way `brain-request.ts` hands it to BOTH the
 *  adapter and `determinize` (issue #2789) — without it the rebuilt library is
 *  all opaque placeholders and "the middle is still re-dealt" is unobservable,
 *  because every unknown slot looks identical. */
const DECK_KNOWLEDGE = [{ playerId: "bot", cardIds: LIBRARY_IDS }];

function botState() {
    const ids = LIBRARY_IDS;
    return makeState({
        turn: 5,
        players: [
            makePlayer("bot", {
                library: ids.map((cardId, i) =>
                    makeInstance(cardId, {
                        controllerId: "bot",
                        ownerId: "bot",
                        id: `bot-lib-${i}`,
                        zone: "library",
                    })
                ),
            }),
            makePlayer("human", {
                library: Array.from({ length: 12 }, (_, i) =>
                    makeInstance(MOUNTAIN, {
                        controllerId: "human",
                        ownerId: "human",
                        id: `human-lib-${i}`,
                        zone: "library",
                    })
                ),
            }),
        ],
    });
}

/** The exact hop the Brain takes: project for the bot's seat, rehydrate naming
 *  that seat as the viewer (`brain-request.ts` passes `botId` here). */
function searchWorld(state: ReturnType<typeof botState>) {
    return projectedToGameState(
        projectPublicState(state, 1, "bot"),
        DECK_KNOWLEDGE,
        "bot"
    );
}

/** …and determinize with the SAME knowledge both consumers get in production. */
const determinizeWorld = (state: ReturnType<typeof botState>, seed: number) =>
    determinize(searchWorld(state), "bot", makeRng(seed), DECK_KNOWLEDGE);

const botLibrary = (world: { players: { id: string; library: unknown[] }[] }) =>
    world.players.find((p) => p.id === "bot")!.library as {
        card: { id: string };
    }[];

describe("full path — a scry-kept top card survives determinization (issue #1524)", () => {
    it("carries the known TOP run from grantKnowledge to the determinized world", () => {
        const state = botState();
        // A scry 2 keeping both cards on top, through the engine's own
        // knowledge primitive.
        grantKnowledge(state, "bot", ["bot-lib-0", "bot-lib-1"], "bot");

        // The wire really does carry it (and only it).
        const projected = projectPublicState(state, 1, "bot");
        const wire = projected.players.find((p) => p.id === "bot")!.library;
        expect(wire.count).toBe(14);
        expect(wire.known.map((k) => k.index).sort((a, b) => a - b)).toEqual([
            0, 1,
        ]);

        for (const seed of SEEDS) {
            const world = determinizeWorld(state, seed);
            const library = botLibrary(world);
            expect(library[0].card.id).toBe(BOLT);
            expect(library[1].card.id).toBe(BEARS);
            expect(library).toHaveLength(14);
        }
    });

    it("carries the known BOTTOM run too — cards ordered onto the bottom stay there", () => {
        const state = botState();
        // An Impulse / Stock Up bottoming (CR 701.22 "in any order").
        grantKnowledge(state, "bot", ["bot-lib-12", "bot-lib-13"], "bot");

        for (const seed of SEEDS) {
            const library = botLibrary(determinizeWorld(state, seed));
            expect(library[12].card.id).toBe(BEARS);
            expect(library[13].card.id).toBe(BOLT);
            expect(library).toHaveLength(14);
        }
    });

    it("still re-deals the unknown middle, and leaves every zone count exact", () => {
        const state = botState();
        grantKnowledge(state, "bot", ["bot-lib-0"], "bot");

        const perSlot = new Map<number, Set<string>>();
        for (const seed of SEEDS) {
            const world = determinizeWorld(state, seed);
            botLibrary(world).forEach((c, i) => {
                if (!perSlot.has(i)) perSlot.set(i, new Set());
                perSlot.get(i)!.add(String(c.card.id));
            });
            expect(
                world.players.find((p) => p.id === "human")!.library
            ).toHaveLength(12);
        }
        // Index 0 is pinned; the Bears at index 1 and 12 must move around.
        expect(perSlot.get(0)!.size).toBe(1);
        expect(perSlot.get(1)!.size).toBeGreaterThan(1);
    });

    it("knows nothing when the engine granted nothing — the whole library re-deals", () => {
        const state = botState();
        const seen = new Set<string>();
        for (const seed of SEEDS) {
            seen.add(
                String(botLibrary(determinizeWorld(state, seed))[0].card.id)
            );
        }
        expect(seen.size).toBeGreaterThan(1);
    });
});
