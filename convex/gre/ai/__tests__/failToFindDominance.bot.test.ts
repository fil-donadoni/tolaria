// CR 701.23b — "fail to find" pruned where finding is a strict gain (issue
// #6761).
//
// THE BUG. A "may search" tutor (`count: { min: 0, max: 1 }`) always offered
// the empty pick as its own tree branch. ISMCTS backs the MEAN of a choice
// node's children up to the cast, so the visits the losing empty branch took
// dragged the cast below `pass` at a small budget: once PR #6562 made Tinker's
// search optional, the Bot-play sweep read Tinker as `ignored`.
//
// The prune is narrow on purpose. Each gate below is a reason finding could
// cost something, and each keeps the empty branch when it fires: a find that
// does not go to the searcher's hand or battlefield, a script that reads the
// find beyond moving it, a library at the decking horizon. And an empty pool
// still answers with the empty pick, the only legal one.
//
// Every choice here is the engine's own, raised by really resolving the tutor
// through `resolveTopOfStack`: the derivation reads the SOURCE stack item, which
// a hand-built `PendingChoice` would not carry.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import {
    resolveTopOfStack,
    type GameState,
    type PendingChoice,
} from "../../state";
import { choiceCandidates } from "../choiceCandidates";
import { choicePicksOnlyMoved } from "../searchDestination";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { tinker } from "../../../cards/sets/ulg/blue.cards";
import { mysticalTutor } from "../../../cards/sets/mir/blue.cards";
import { eladamrisCall } from "../../../cards/sets/pls/multicolor.cards";
import { juggernaut } from "../../../cards/sets/lea/colorless.cards";
import { ornithopter } from "../../../cards/sets/atq/colorless.cards";
import { island } from "../../../cards/sets/lea/index.cards";
import { registerTokenDefinition } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";

const ME = "p1";
const OPP = "p2";
const NONE = "search-library:none";

/** The live `search-library` choice of `tutorId`, over a library of `library`
 *  card ids. */
function openSearchChoice(
    tutorId: string,
    library: string[]
): { state: GameState; choice: PendingChoice } {
    const state = makeState({
        players: [
            makePlayer(ME, {
                battlefield: [
                    makeInstance(island().id, {
                        controllerId: ME,
                        ownerId: ME,
                    }),
                ],
                library: library.map((id) =>
                    makeInstance(id, {
                        controllerId: ME,
                        ownerId: ME,
                        zone: "library",
                    })
                ),
            }),
            makePlayer(OPP),
        ],
    });
    pushSpell(state, tutorId, ME);
    resolveTopOfStack(state);
    const choice = state.pendingChoices?.[0];
    if (!choice || choice.kind !== "search-library") {
        throw new Error(
            `expected a live search-library choice, got ${choice?.kind ?? "none"}`
        );
    }
    return { state, choice };
}

function keys(state: GameState, choice: PendingChoice): string[] {
    return choiceCandidates(state, choice).map((c) => c.key);
}

/** A library that keeps exactly the decking horizon once one card is found. */
const ROOMY = DEFAULT_EVAL_WEIGHTS.deckingHorizon + 1;

describe("fail to find is pruned where finding is a strict gain (CR 701.23b)", () => {
    it("a battlefield find out of the searcher's own library drops the empty branch", () => {
        const { state, choice } = openSearchChoice(
            tinker().id,
            Array.from({ length: ROOMY }, () => juggernaut().id)
        );
        expect(keys(state, choice)).toEqual(["search-library:Juggernaut"]);
    });

    it("keeps the empty branch when the find would take the library below the decking horizon", () => {
        const { state, choice } = openSearchChoice(
            tinker().id,
            Array.from({ length: ROOMY - 1 }, () => juggernaut().id)
        );
        expect(keys(state, choice)).toContain(NONE);
    });

    it("keeps the empty branch for a library-top find (a reorder the searcher may decline)", () => {
        const { state, choice } = openSearchChoice(
            mysticalTutor().id,
            Array.from({ length: ROOMY }, () => mysticalTutor().id)
        );
        expect(keys(state, choice)).toContain(NONE);
    });

    it("keeps the empty branch for an exile find (a trade the searcher may decline)", () => {
        // Synthetic: no shipped may-search exiles its find with nothing else
        // reading it, and only that shape isolates the destination gate.
        const id = "test-6761-may-search-exile";
        registerTokenDefinition({
            id,
            name: "Test May-Search Exile",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Artifact" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an artifact card.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "exile",
                },
            ],
        } as CardDefinition);
        const { state, choice } = openSearchChoice(
            id,
            Array.from({ length: ROOMY }, () => juggernaut().id)
        );
        expect(choicePicksOnlyMoved(state, choice)).toBe(true);
        expect(keys(state, choice)).toContain(NONE);
    });

    it("keeps the empty branch when the move re-binds what entered for a later clause", () => {
        // "Put it onto the battlefield. Sacrifice it at the beginning of the
        // next end step": the moveZone's own `bind` hands the find on.
        const id = "test-6761-may-search-rebind";
        registerTokenDefinition({
            id,
            name: "Test May-Search Rebind",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Artifact" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an artifact card.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                    bind: "$entered",
                },
            ],
        } as CardDefinition);
        const { state, choice } = openSearchChoice(
            id,
            Array.from({ length: ROOMY }, () => juggernaut().id)
        );
        expect(choicePicksOnlyMoved(state, choice)).toBe(false);
        expect(keys(state, choice)).toContain(NONE);
    });

    it("keeps the empty branch when the script reads the find beyond moving it", () => {
        // Eladamri's Call reveals the find before it moves it to hand: the
        // binding has a second reader.
        const { state, choice } = openSearchChoice(
            eladamrisCall().id,
            Array.from({ length: ROOMY }, () => ornithopter().id)
        );
        expect(choicePicksOnlyMoved(state, choice)).toBe(false);
        expect(keys(state, choice)).toContain(NONE);
    });

    it("an empty eligible pool still answers with the empty pick", () => {
        const { state, choice } = openSearchChoice(
            tinker().id,
            Array.from({ length: ROOMY }, () => island().id)
        );
        expect(keys(state, choice)).toEqual([NONE]);
    });
});

describe("choicePicksOnlyMoved", () => {
    it("is true for a search whose binding only a moveZone consumes", () => {
        const { state, choice } = openSearchChoice(tinker().id, [
            juggernaut().id,
        ]);
        expect(choicePicksOnlyMoved(state, choice)).toBe(true);
    });

    it("is false for a choice the stack item's controller does not make", () => {
        const { state, choice } = openSearchChoice(tinker().id, [
            juggernaut().id,
        ]);
        expect(choicePicksOnlyMoved(state, { ...choice, playerId: OPP })).toBe(
            false
        );
    });
});
