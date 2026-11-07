// The verdict quiz on a page holding only its game's Sets (issue #8728).
//
// A CLIENT graph: Sets load through the browser seam, so a Set nobody installed
// is not resident and `getAllCards` throws at its first card. The node graph
// every other quiz test runs in has them all, which is why none of them saw it.
// The positions reach the panel as the wire projection, as they do in play.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock(
    "@convex/cards/compiledPool",
    () => import("~/lib/catalogue/compiled-pool.browser")
);
vi.mock(
    "@convex/cards/setModules",
    () => import("~/lib/catalogue/set-modules.browser")
);
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => ({ nickname: "Tessa", isTester: true }),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: "users:currentUser" },
        verdicts: { submit: "verdicts:submit" },
    },
}));
vi.mock("~/lib/session", () => ({
    getStoredSession: () => ({ gameId: "game-7", playerId: "p1" }),
}));

import { tokenDefinitionId } from "@convex/cards";
import { GOBLIN_TOKEN } from "@convex/cards/sharedTokens";
import { listTokenCatalogue } from "@convex/cards/tokenCatalogue";
import { makeState } from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { buildStateFromScenario } from "@convex/gre/scenarioBuilder";
import type { TokenSpec } from "@convex/cards/types";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import { installShards, isSetResident } from "~/lib/catalogue/definitionShards";
import AiDecisionVerdictQuiz from "../ai-decision-verdict-quiz";

/** The first `leb` row of the Definition Index, which follows all of `lea`. */
const FIRST_LEB_CARD = "fa47b4cd-8da4-4544-b011-ba92b7009203";
const QUESTION = "Which move was right here?";
/** Installing every Set means transforming every Set under vitest. */
const INSTALL_MS = 120_000;
const findQuestion = () =>
    screen.findByText(QUESTION, {}, { timeout: INSTALL_MS });

function buildBoard(extra: ScenarioSpec["cards"]): GameState {
    return buildStateFromScenario(makeState(), {
        cards: [
            { name: "Mountain", owner: "me", zone: "hand" },
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ...extra,
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        landCount: 0,
        libraryCount: 20,
    });
}

function renderQuiz(state: GameState) {
    const botId = state.players[0].id;
    return render(
        <AiDecisionVerdictQuiz
            subject={{
                id: 1,
                seq: 7,
                feed: {
                    kind: "trace",
                    trace: { chosen: "pass" } as never,
                    source: {
                        state: projectPublicState(state, 7, botId),
                        botId,
                    },
                },
            }}
            onJudged={() => {}}
            onClose={() => {}}
        />
    );
}

describe("the verdict quiz with only the game's Sets resident (issue #8728)", () => {
    beforeAll(async () => {
        await installShards(["lea"]);
    });

    it("starts from the failure: the token catalogue stops at the first Set not resident", () => {
        expect(isSetResident("lea")).toBe(true);
        expect(isSetResident("leb")).toBe(false);
        expect(() => listTokenCatalogue()).toThrow(
            `Card not found: ${FIRST_LEB_CARD}`
        );
    });

    it(
        "rebuilds an attachment, whose host name reads the token catalogue",
        async () => {
            // Placed unattached and linked here: the builder's own attachment path
            // is the read under test, and it must not run before the panel does.
            const state = buildBoard([
                { name: "Holy Strength", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ]);
            const [aura, host] = state.players[0].battlefield;
            aura.attachedTo = host.id;
            renderQuiz(state);
            expect(await findQuestion()).toBeTruthy();
            cleanup();
        },
        INSTALL_MS
    );

    it(
        "lowers a token, whose name is the token catalogue's key",
        async () => {
            const state = buildBoard([]);
            const seat = state.players[0];
            seat.battlefield.push({
                ...GOBLIN_TOKEN,
                id: "token-instance",
                card: { id: tokenDefinitionId(GOBLIN_TOKEN as TokenSpec) },
                isToken: true,
                controllerId: seat.id,
                ownerId: seat.id,
                zone: "battlefield",
                isTapped: false,
                staticAbilities: [],
            } as unknown as CardInstanceState);
            renderQuiz(state);
            expect(await findQuestion()).toBeTruthy();
            cleanup();
        },
        INSTALL_MS
    );
});
