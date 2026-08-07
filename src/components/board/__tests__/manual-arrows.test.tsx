// Manual arrows and attachment clusters (issue #2171, PRD #2162).
//
// Two Manual Mode features were already written to the server (`arrows[]` /
// `attachedTo` on `ManualCardInstance`) and had never been drawn on screen.
// This file proves the four acceptance criteria, each through the REAL
// production code path — never a hand-built view:
//
//   AC1 — an arrow drawn between two permanents renders on the board and
//         follows the cards as they move: `buildManualArrowPairs`
//         (`manual-runtime.ts`) turns manual state into `BoardArrows`'
//         `extraArrows` input, which `BoardArrows` resolves through the same
//         anchor registry every other arrow uses (`board-arrows.tsx`).
//   AC2 — an arrow can be removed from the ACTING card's menu:
//         `manualBattlefieldVerbs` / `dispatchManualCardVerb`
//         (`manual-card-verbs.ts`) through the real
//         `makeManualBattlefieldInteraction` seam.
//   AC3 — an attached card renders on its host through the SHARED attachment
//         cluster (`AttachedCardsCluster`, mechanism-agnostic in
//         `board-battlefield.tsx` — issue #2334 already wired this for the
//         Manual Board; this locks it in with a targeted test).
//   AC4 — an attachment whose host has left the battlefield still renders
//         rather than vanishing (the `hostExistsAnywhere` fallback in
//         `board-battlefield.tsx`, likewise pre-existing and here verified
//         for a Manual card).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    fireEvent,
    cleanup,
    screen,
    act,
} from "@testing-library/react";
import { useEffect } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { BattlefieldInteractionProvider } from "~/hooks/useBattlefieldInteractionContext";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import { useArrowAnchors, type AnchorKind } from "~/hooks/arrowAnchorContext";
import type { AnchorPoint } from "~/lib/target-arrow-geometry";
import { adaptManualPlayers } from "~/lib/manual-board-adapter";
import { makeManualBattlefieldInteraction } from "~/lib/manual-battlefield-interaction";
import { buildManualArrowPairs, indexManualCards } from "~/lib/manual-runtime";
import {
    manualCard,
    manualRuntime,
    manualSeat,
    manualState,
    spyDispatch,
} from "~/lib/__tests__/manual-test-fixtures";
import BoardArrows from "../board-arrows";

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => undefined,
}));
vi.mock("@convex/_generated/api", () => ({ api: { game: {} } }));
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, (id: string) => ({ name: id })),
    tryGetDefinition: (id: string) => ({ name: id }),
    FACE_DOWN_CARD_ID: "__faceDownDef",
}));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));
// SpatialZone measures its box via ResizeObserver, which is stubbed to a
// no-op in the jsdom test environment — real placements never resolve. The
// only thing under test here is which ITEMS reach the zone (host vs. orphan,
// aura folded vs. not), never their pixel position, so the mock renders every
// item's node directly (same pattern as manual-battlefield-interaction.test).
vi.mock("../spatial-zone", () => ({
    default: ({
        items,
    }: {
        items: { key: string; node: React.ReactNode }[];
    }) => (
        <div data-testid="spatial-zone">
            {items.map((it) => (
                <div key={it.key}>{it.node}</div>
            ))}
        </div>
    ),
}));
vi.mock("../combat-panels", () => ({ default: () => null }));

const { default: BoardBattlefield } = await import("../board-battlefield");
const { default: ActivatableAbilityMenu } =
    await import("../activatable-ability-menu");

function makeContext(
    allPlayers: Player[]
): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers,
        showAllCards: false,
        onSwitchGame: () => {},
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
}

beforeEach(cleanup);

// --- AC1 — arrow rendering (via BoardArrows + extraArrows) -----------------

type Published = { kind: AnchorKind; id: string; point: AnchorPoint };

/** The interaction hook only reads `card.id` (it re-resolves the manual card
 *  via `cardById`), so a minimal stub — typed, never `any` — is enough to
 *  drive `getActivatable`/`handleActivateAbility` in these tests. */
function stubCard(id: string): CardInstance {
    return { id } as unknown as CardInstance;
}

/** `makeManualBattlefieldInteraction`'s returned hook ignores its `Player`
 *  argument entirely (every field closes over `runtime` instead), so a typed
 *  placeholder is enough — never `any`. */
const stubPlayer = {} as unknown as Player;

function Publisher({ entries }: { entries: Published[] }) {
    const registry = useArrowAnchors();
    useEffect(() => {
        if (!registry) return;
        for (const e of entries) registry.publish(e.kind, e.id, e.point);
    }, [registry, entries]);
    return null;
}

describe("manual arrows render through the shared arrow layer (#2171 AC1)", () => {
    it("buildManualArrowPairs turns a card's arrows[] into fromId/toId pairs", () => {
        // Real production reducer, not a hand-built substitute: the same
        // function `manual-board-view.tsx` calls to build `extraArrows`.
        const state = manualState([
            manualSeat("me", {
                battlefield: [
                    manualCard("bolt", { arrows: ["bear"] }),
                    manualCard("bear"),
                ],
            }),
        ]);
        const cardById = indexManualCards(state);
        expect(buildManualArrowPairs(cardById)).toEqual([
            { key: "manual:bolt->bear", fromId: "bolt", toId: "bear" },
        ]);
    });

    it("dedupes a duplicate target in one card's arrows[] (defensive, #2338)", () => {
        // `manualSetArrow` is idempotent going forward, but a state persisted
        // before that fix (or a future writer) could still carry a repeated
        // target. Two identical-key pairs feed `<g key={arrow.key}>`
        // (`board-arrows.tsx`) and crash React with a duplicate-key error —
        // this reducer is the last line before that key reaches JSX.
        const state = manualState([
            manualSeat("me", {
                battlefield: [
                    manualCard("bolt", { arrows: ["bear", "bear"] }),
                    manualCard("bear"),
                ],
            }),
        ]);
        const cardById = indexManualCards(state);
        expect(buildManualArrowPairs(cardById)).toEqual([
            { key: "manual:bolt->bear", fromId: "bolt", toId: "bear" },
        ]);
    });

    it("draws an arrow between two permanents from extraArrows at their published anchors", () => {
        const { container } = render(
            <div data-board-root>
                <ArrowAnchorProvider>
                    <Publisher
                        entries={[
                            {
                                kind: "permanent",
                                id: "bolt",
                                point: { x: 50, y: 60 },
                            },
                            {
                                kind: "permanent",
                                id: "bear",
                                point: { x: 400, y: 320 },
                            },
                        ]}
                    />
                    <BoardArrows
                        stack={[]}
                        extraArrows={[
                            {
                                key: "manual:bolt->bear",
                                fromId: "bolt",
                                toId: "bear",
                            },
                        ]}
                    />
                </ArrowAnchorProvider>
            </div>
        );
        const paths = container.querySelectorAll<SVGPathElement>(
            "path[data-arrow-key='manual:bolt->bear']"
        );
        expect(paths).toHaveLength(1);
        expect(paths[0].getAttribute("d")).toContain("M 50 60");
    });

    it("re-targets the arrow when the target's anchor moves (follows the card, AC1)", () => {
        const { container, rerender } = render(
            <div data-board-root>
                <ArrowAnchorProvider>
                    <Publisher
                        entries={[
                            {
                                kind: "permanent",
                                id: "bolt",
                                point: { x: 0, y: 0 },
                            },
                            {
                                kind: "permanent",
                                id: "bear",
                                point: { x: 200, y: 200 },
                            },
                        ]}
                    />
                    <BoardArrows
                        stack={[]}
                        extraArrows={[
                            {
                                key: "manual:bolt->bear",
                                fromId: "bolt",
                                toId: "bear",
                            },
                        ]}
                    />
                </ArrowAnchorProvider>
            </div>
        );
        expect(
            container
                .querySelector("path[data-arrow-key='manual:bolt->bear']")!
                .getAttribute("d")
        ).toContain("200 200");

        act(() => {
            rerender(
                <div data-board-root>
                    <ArrowAnchorProvider>
                        <Publisher
                            entries={[
                                {
                                    kind: "permanent",
                                    id: "bolt",
                                    point: { x: 0, y: 0 },
                                },
                                {
                                    kind: "permanent",
                                    id: "bear",
                                    point: { x: 360, y: 260 },
                                },
                            ]}
                        />
                        <BoardArrows
                            stack={[]}
                            extraArrows={[
                                {
                                    key: "manual:bolt->bear",
                                    fromId: "bolt",
                                    toId: "bear",
                                },
                            ]}
                        />
                    </ArrowAnchorProvider>
                </div>
            );
        });
        expect(
            container
                .querySelector("path[data-arrow-key='manual:bolt->bear']")!
                .getAttribute("d")
        ).toContain("360 260");
    });

    it("draws nothing when the target's endpoint has no published anchor yet", () => {
        const { container } = render(
            <div data-board-root>
                <ArrowAnchorProvider>
                    <Publisher
                        entries={[
                            {
                                kind: "permanent",
                                id: "bolt",
                                point: { x: 0, y: 0 },
                            },
                        ]}
                    />
                    <BoardArrows
                        stack={[]}
                        extraArrows={[
                            {
                                key: "manual:bolt->bear",
                                fromId: "bolt",
                                toId: "bear",
                            },
                        ]}
                    />
                </ArrowAnchorProvider>
            </div>
        );
        expect(container.querySelectorAll("path[data-arrow-key]")).toHaveLength(
            0
        );
    });
});

// --- AC2 — remove an arrow from the acting card's menu ----------------------

describe("an arrow can be removed from the acting card's menu (#2171 AC2)", () => {
    it("offers no 'Remove arrow(s)' verb on a card with no arrows", () => {
        const dispatch = spyDispatch();
        const state = manualState([
            manualSeat("me", { battlefield: [manualCard("perm1")] }),
        ]);
        const runtime = manualRuntime(state, dispatch);
        const interaction =
            makeManualBattlefieldInteraction(runtime)(stubPlayer);
        const abilities = interaction.getActivatable(stubCard("perm1"));
        expect(abilities.some((a) => a.id === "clear-arrows")).toBe(false);
    });

    it("offers 'Remove arrow(s)' on the ACTING card (the one with arrows[]) and dispatches clearArrow for it", () => {
        const dispatch = spyDispatch();
        const state = manualState([
            manualSeat("me", {
                battlefield: [
                    manualCard("bolt", { arrows: ["bear"] }),
                    manualCard("bear"),
                ],
            }),
        ]);
        const runtime = manualRuntime(state, dispatch);
        const interaction =
            makeManualBattlefieldInteraction(runtime)(stubPlayer);

        // The TARGET card ("bear") carries no arrows of its own — only the
        // source ever does (`manualSetArrow` appends to the dragged card's
        // `arrows[]`) — so its menu must not offer the verb.
        const targetAbilities = interaction.getActivatable(stubCard("bear"));
        expect(targetAbilities.some((a) => a.id === "clear-arrows")).toBe(
            false
        );

        const abilities = interaction.getActivatable(stubCard("bolt"));
        render(
            <ActivatableAbilityMenu
                abilities={abilities}
                onActivate={(abilityId, keepPriority) =>
                    interaction.handleActivateAbility(
                        "bolt",
                        abilityId,
                        keepPriority
                    )
                }
                sheetOpen
                onSheetClose={() => {}}
            >
                <div data-testid="card" />
            </ActivatableAbilityMenu>
        );
        expect(screen.getAllByText("Remove arrow(s)").length).toBeGreaterThan(
            0
        );
        fireEvent.click(screen.getAllByText("Remove arrow(s)")[0]);
        expect(dispatch.clearArrow).toHaveBeenCalledWith({
            instanceId: "bolt",
        });
        expect(dispatch.clearArrow).not.toHaveBeenCalledWith({
            instanceId: "bear",
        });
    });
});

// --- AC3 / AC4 — attachment cluster + orphan --------------------------------

describe("attachments render through the shared cluster (#2171 AC3/AC4)", () => {
    it("renders an attached aura on its host through AttachedCardsCluster, no text badge", () => {
        const state = manualState([
            manualSeat("me", {
                battlefield: [
                    manualCard("host1"),
                    manualCard("aura1", { attachedTo: "host1" }),
                ],
            }),
        ]);
        const [me] = adaptManualPlayers(state);
        const { container } = render(
            <GameContext value={makeContext([me])}>
                <BattlefieldInteractionProvider
                    value={makeManualBattlefieldInteraction(
                        manualRuntime(state, spyDispatch())
                    )}
                >
                    <BoardBattlefield player={me} />
                </BattlefieldInteractionProvider>
            </GameContext>
        );

        // The host and its aura both reach the DOM…
        expect(
            container.querySelectorAll('[data-arrow-anchor-permanent="host1"]')
        ).toHaveLength(1);
        expect(
            container.querySelectorAll('[data-arrow-anchor-permanent="aura1"]')
        ).toHaveLength(1);
        // …the aura rides ON the host through the shared cluster's ×N badge
        // (not the deleted hand-written board's three-letter text badge)…
        expect(screen.getByLabelText("1 attached — open pile")).toBeTruthy();
        // …and the aura is a DESCENDANT of the host's own slot wrapper, i.e.
        // folded into ONE battlefield slot rather than occupying its own.
        const hostSlot = container.querySelector(
            '[data-testid="spatial-zone"] > div'
        )!;
        expect(
            hostSlot.querySelector('[data-arrow-anchor-permanent="aura1"]')
        ).not.toBeNull();
    });

    it("keeps an attachment visible when its host has left the battlefield, rather than vanishing", () => {
        // "orphan1" points at a host that is NOT present on any battlefield —
        // the host permanent left play (destroyed / bounced / sacrificed).
        const state = manualState([
            manualSeat("me", {
                battlefield: [
                    manualCard("orphan1", { attachedTo: "gone-host" }),
                ],
            }),
        ]);
        const [me] = adaptManualPlayers(state);
        const { container } = render(
            <GameContext value={makeContext([me])}>
                <BattlefieldInteractionProvider
                    value={makeManualBattlefieldInteraction(
                        manualRuntime(state, spyDispatch())
                    )}
                >
                    <BoardBattlefield player={me} />
                </BattlefieldInteractionProvider>
            </GameContext>
        );
        expect(
            container.querySelectorAll(
                '[data-arrow-anchor-permanent="orphan1"]'
            )
        ).toHaveLength(1);
        // Never folded into a nonexistent cluster.
        expect(screen.queryByLabelText(/attached — open pile/)).toBeNull();
    });
});
