// Player-facing chrome + interaction parity on the spatial board (PRD #249,
// issue #280). The classic life chrome (`PlayerLife`) and the spatial player
// (`BoardPlayer`) BOTH consume the extracted `usePlayerInteraction` hook,
// so clicking a player as a target / damage-choice dispatches the SAME
// GRE-boundary mutation / toggles the SAME buffer on either board:
//   (a) target selection  → selectTarget (targetType "player")
//   (b) damage-target pick → buffer.toggle (Cuombajj Witches, CR 115.4 / 608.2)
// Plus: the spatial board renders both players' life totals + names.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { GameContext } from "~/hooks/useGameContext";
import { PORTRAIT_VIEWER_NAMEPLATE_BOTTOM } from "~/lib/portrait-board-bands";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { PlayerInteractionProvider } from "~/hooks/usePlayerInteractionContext";

// Capture the selectTarget mutation so we can compare classic vs spatial args.
const selectTargetSpy = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => selectTargetSpy,
}));

// Drive the portrait seam explicitly so jsdom's flaky matchMedia never decides
// where the seat chrome anchors.
let portrait = false;
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => portrait,
}));

// Same seam `board-landscape-bands.test.tsx` drives, needed here (round-3
// review finding 1) to exercise `BoardPlayer`'s `landscapeCompact` branch —
// `useIsPortrait` alone can't select landscape-compact.
const viewportHolder = vi.hoisted(() => ({ mode: "desktop" as ViewportMode }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => viewportHolder.mode,
}));

import PlayerLife from "../player-life";
import BoardPlayer from "../board-player";

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: `${id}-name`,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeBuffer(overrides: Partial<PendingChoiceBuffer> = {}) {
    return {
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(async () => {}),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
        ...overrides,
    } as PendingChoiceBuffer;
}

type Ctx = React.ContextType<typeof GameContext>;

function makeContext(overrides: Partial<NonNullable<Ctx>> = {}): Ctx {
    return {
        gameId: "game-id" as never,
        playerId: "p2",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as Ctx;
}

function renderClassic(
    player: Player,
    ctx: Partial<NonNullable<Ctx>>,
    buffer?: PendingChoiceBuffer
) {
    return render(
        <GameContext value={makeContext(ctx)}>
            <PendingChoiceBufferContext value={buffer ?? makeBuffer()}>
                <PlayerLife player={player} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function renderSpatial(
    player: Player,
    ctx: Partial<NonNullable<Ctx>>,
    side: "top" | "bottom" = "bottom",
    buffer?: PendingChoiceBuffer
) {
    return render(
        <GameContext value={makeContext(ctx)}>
            <PendingChoiceBufferContext value={buffer ?? makeBuffer()}>
                <BoardPlayer player={player} side={side} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

beforeEach(() => {
    selectTargetSpy.mockClear();
    portrait = false;
    viewportHolder.mode = "desktop";
    cleanup();
});

/** The top-EDGE anchor exactly — `top-1`, never a midline anchor. */
const TOP_EDGE_ANCHOR = /\btop-1\b(?!\/)/;

describe("seat anchoring — nothing under the portrait bottom bar (#1759, #1814)", () => {
    function anchorClass(side: "top" | "bottom") {
        const { container } = renderSpatial(
            makePlayer("p2"),
            { playerId: "p2" },
            side
        );
        return (container.firstElementChild as HTMLElement).className;
    }

    it("portrait anchors the VIEWER's chrome bottom-center, clear of the bar's fixed edge", () => {
        portrait = true;
        const className = anchorClass("bottom");
        expect(className).not.toContain("bottom-1");
        // #1814: mirrors the opponent's top-center placement onto the bottom
        // edge — same horizontal centering utility, anchored at the hand
        // band's own top edge (derived from the bar's measured clearance,
        // never a hardcoded offset) so it can never land on the interactive
        // hand fan below it.
        expect(className).toContain(PORTRAIT_VIEWER_NAMEPLATE_BOTTOM);
        expect(className).toContain("play-area-center-x");
        expect(className).toContain("-translate-x-1/2");
        expect(className).not.toContain("left-2");
    });

    it("landscape/desktop keep the classic bottom-edge anchor", () => {
        portrait = false;
        expect(anchorClass("bottom")).toContain("bottom-1");
    });

    it("the opponent's chrome stays on the top edge either way", () => {
        // `\btop-1\b(?!\/)` and NOT `toContain("top-1")`: the substring also
        // matches a `top-1/2`-style midline anchor, so a regression that
        // swapped the opponent onto the midline would still pass.
        portrait = true;
        expect(anchorClass("top")).toMatch(TOP_EDGE_ANCHOR);
        cleanup();
        portrait = false;
        expect(anchorClass("top")).toMatch(TOP_EDGE_ANCHOR);
    });

    it("portrait: both seats' anchors differ ONLY in which edge they pin to — a true mirror", () => {
        // #1814 acceptance: "symmetric anchors" / "same horizontal alignment
        // ... as the opponent's". Tests (1) and (3) above already assert each
        // anchor string CONTAINS the centering classes individually — this
        // assertion is deliberately distinct (and can fail on its own): strip
        // each anchor's vertical-anchor tokens and compare what's LEFT, so a
        // regression that gives one seat extra/different horizontal classes
        // (not just a missing centering class) is caught too.
        portrait = true;
        const stripVerticalAnchor = (className: string) =>
            className
                .replace(TOP_EDGE_ANCHOR, "")
                .replace(PORTRAIT_VIEWER_NAMEPLATE_BOTTOM, "")
                .split(/\s+/)
                .filter(Boolean)
                .sort()
                .join(" ");
        const top = stripVerticalAnchor(anchorClass("top"));
        const bottom = stripVerticalAnchor(anchorClass("bottom"));
        expect(top).toBe(bottom);
        expect(top).toContain("play-area-center-x");
        expect(top).toContain("-translate-x-1/2");
    });
});

describe("compact nameplate variant follows the portrait seam (#1814 round-3 fixup)", () => {
    // `BoardPlayer` passes `compact={isPortrait}` straight through to
    // `PlayerNameplate` (board-player.tsx), which is what shrinks the box
    // `PORTRAIT_NAMEPLATE_BAND_H` reserves a band for
    // (`portrait-board-bands.ts`). The exact class strings pinned here —
    // `py-0.5` / `border` (nameplate box) and `text-lg` (life total) — are
    // what `PORTRAIT_NAMEPLATE_PADDING_PX` / `PORTRAIT_NAMEPLATE_BORDER_PX` /
    // `PORTRAIT_NAMEPLATE_ROW_PX` derive from (see the comment at their use
    // site in `player-nameplate.tsx`); pinning the literal strings here — not
    // just "a compact variant renders" — is the mechanical link a class
    // rename would trip, since the numeric constants can't catch that on
    // their own. Mutation check: dropping `compact={isPortrait}` from
    // `board-player.tsx` makes both tests below fail.
    it("portrait renders the compact box (py-0.5, border, text-lg life total)", () => {
        portrait = true;
        const { container } = renderSpatial(
            makePlayer("p2", { life: 20 }),
            { playerId: "p2" },
            "bottom"
        );
        const plate = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-player="p2"]'
        )!;
        expect(plate.className).toContain("py-0.5");
        expect(plate.className).toContain("border");
        const lifeNode = plate.querySelector(".font-bold.tabular-nums")!;
        expect(lifeNode.className).toContain("text-lg");
    });

    it("compact box trims horizontal padding and clips overflow (issue #2589 round-2 fixup finding 7)", () => {
        // Landscape-compact's seat rail (`LANDSCAPE_SIDE_GUTTER`, 4rem) gives
        // this box a ~48px max-width; the old `px-3` (24px) + border (2px)
        // left only ~22px for life + name + poison/energy, so the badges had
        // nowhere to go but past the box's own edge — into the battlefield
        // band, contradicting the rail's own "chrome can never overlap a
        // card" invariant. `px-1.5` buys back width at zero budget cost (it
        // only changes how the SAME gutter is spent); `overflow-hidden` is
        // what makes the invariant true BY CONSTRUCTION even for content the
        // narrowed padding still can't fit (e.g. both poison AND energy
        // counters live at once).
        portrait = true;
        const { container } = renderSpatial(
            makePlayer("p2", { life: 20 }),
            { playerId: "p2" },
            "bottom"
        );
        const plate = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-player="p2"]'
        )!;
        expect(plate.className).toContain("overflow-hidden");
        expect(plate.className).toContain("px-1.5");
        expect(plate.className).not.toContain("px-3");
    });

    it("landscape/desktop renders the full box (py-2, text-3xl life total)", () => {
        portrait = false;
        const { container } = renderSpatial(
            makePlayer("p2", { life: 20 }),
            { playerId: "p2" },
            "bottom"
        );
        const plate = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-player="p2"]'
        )!;
        expect(plate.className).toContain("py-2");
        expect(plate.className).not.toContain("py-0.5");
        const lifeNode = plate.querySelector(".font-bold.tabular-nums")!;
        expect(lifeNode.className).toContain("text-3xl");
    });
});

describe("landscape-compact nameplate never clips the life total (round-3 review finding 1)", () => {
    // Round-2's `overflow-hidden` fix for finding 7 made "chrome can never
    // overlap a card" true by construction — but the compact row it clips
    // used `justify-center`, which overflows UNSAFELY at BOTH ends. At the
    // landscape-compact seat rail's ~34px content box, a poison OR energy
    // badge alone pushes the row past that width, and centering clipped the
    // LEADING edge — the life total, always the row's first child (a life
    // of 20 rendered as `0`). The fix: `justify-start` (life is then never
    // the clipped end) + dropping the name span in landscape-compact, where
    // it already renders unreadable (~8px after `truncate`) the moment a
    // badge is live. Portrait's box is unconstrained, so it keeps the name.
    function findCompactRow(container: HTMLElement) {
        return container.querySelector<HTMLElement>(
            ".flex.flex-nowrap.items-center"
        )!;
    }

    it("landscape-compact: the row is justify-start, never justify-center", () => {
        viewportHolder.mode = "landscape-compact";
        portrait = false;
        const { container } = renderSpatial(
            makePlayer("p2", { life: 20, poisonCounters: 3 }),
            { playerId: "p2" },
            "bottom"
        );
        const row = findCompactRow(container);
        expect(row.className).toContain("justify-start");
        expect(row.className).not.toContain("justify-center");
    });

    it("landscape-compact: drops the name span entirely — no room for it once a badge is live", () => {
        viewportHolder.mode = "landscape-compact";
        portrait = false;
        const { container, queryByText } = renderSpatial(
            makePlayer("p2", { name: "Urza", life: 20, poisonCounters: 3 }),
            { playerId: "p2" },
            "bottom"
        );
        expect(queryByText("Urza")).toBeNull();
        // The life total and the poison badge still render — only the name
        // is cut, not the whole row.
        const plate = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-player="p2"]'
        )!;
        expect(plate.querySelector(".font-bold.tabular-nums")).not.toBeNull();
        expect(plate.textContent).toContain("3");
    });

    it("landscape-compact: the life total is the row's FIRST child (never clipped by justify-start + overflow-hidden)", () => {
        viewportHolder.mode = "landscape-compact";
        portrait = false;
        const { container } = renderSpatial(
            makePlayer("p2", {
                life: 20,
                poisonCounters: 3,
                energyCounters: 2,
            }),
            { playerId: "p2" },
            "bottom"
        );
        const row = findCompactRow(container);
        const firstChild = row.firstElementChild!;
        expect(
            firstChild.querySelector(".font-bold.tabular-nums")
        ).not.toBeNull();
    });

    it("portrait-compact: keeps the name span (its box is unconstrained — dropping it would cost nothing back)", () => {
        viewportHolder.mode = "desktop";
        portrait = true;
        const { queryByText } = renderSpatial(
            makePlayer("p2", { name: "Urza", life: 20, poisonCounters: 3 }),
            { playerId: "p2" },
            "bottom"
        );
        expect(queryByText("Urza")).not.toBeNull();
    });

    it("Manual Board (lifeStepButton −/+ affordances live too): the life total STILL renders as the row's first child, not pushed out by the steppers", () => {
        // Manual Board injects `onLifeStep` via `PlayerInteractionProvider`
        // (PRD #2162 / issue #2169) — the shape the review flagged as
        // "worse" than the plain badge case, since `lifeRow` then wraps the
        // life total between two extra buttons. `justify-start` protects
        // the row's first CHILD (the whole lifeRow span), which is what
        // keeps it flush against the box's left edge instead of centered
        // and clipped from both sides.
        viewportHolder.mode = "landscape-compact";
        portrait = false;
        // Not a React hook — mirrors `makeManualPlayerInteraction`
        // (`~/lib/manual-player-interaction.ts`), the real Manual Board
        // interaction value, which also calls no hooks.
        const injectedHook =
            (): import("~/hooks/usePlayerInteraction").PlayerInteraction => ({
                isMe: true,
                hasPriority: false,
                isTargetable: false,
                isDamageTargetPickable: false,
                isPlayerPicked: false,
                isDivideTarget: false,
                divideAssigned: 0,
                divideCanPlus: false,
                incDivide: () => {},
                decDivide: () => {},
                handleClick: () => {},
                onLifeStep: vi.fn(),
            });
        const { container } = render(
            <GameContext value={makeContext({ playerId: "p2" })}>
                <PendingChoiceBufferContext value={makeBuffer()}>
                    <PlayerInteractionProvider value={injectedHook}>
                        <BoardPlayer
                            player={makePlayer("p2", {
                                life: 20,
                                poisonCounters: 3,
                            })}
                            side="bottom"
                        />
                    </PlayerInteractionProvider>
                </PendingChoiceBufferContext>
            </GameContext>
        );
        const row = findCompactRow(container);
        expect(row.className).toContain("justify-start");
        const firstChild = row.firstElementChild!;
        expect(
            firstChild.querySelector(".font-bold.tabular-nums")
        ).not.toBeNull();
        expect(
            firstChild.querySelector('[data-life-step="p2:-"]')
        ).not.toBeNull();
    });
});

describe("board player target parity (#280)", () => {
    // The viewer (p2) is asked to choose a player target; p1 is targetable.
    const targetCtx: Partial<NonNullable<Ctx>> = {
        playerId: "p2",
        pendingTarget: {
            playerId: "p2",
            targetType: "player",
            selected: [],
        } as never,
    };

    it("(a) clicking a player dispatches the SAME selectTarget args on both boards", () => {
        renderClassic(makePlayer("p1"), targetCtx);
        fireEvent.click(
            document.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        const classicArgs = selectTargetSpy.mock.calls[0][0];

        selectTargetSpy.mockClear();
        cleanup();

        const { container } = renderSpatial(makePlayer("p1"), targetCtx, "top");
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        const spatialArgs = selectTargetSpy.mock.calls[0][0];

        expect(spatialArgs).toEqual(classicArgs);
        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "p2",
            targetType: "player",
            targetId: "p1",
        });
    });

    // Regression: Lava Spike's requirement is the ARRAY ["player",
    // "Planeswalker"], not the scalar "player". The player face must still be
    // clickable — a raw === "player" left it inert.
    it("(a2) an array target type ['player','Planeswalker'] still targets the player", () => {
        const arrayCtx: Partial<NonNullable<Ctx>> = {
            playerId: "p2",
            pendingTarget: {
                playerId: "p2",
                targetType: ["player", "Planeswalker"],
                selected: [],
            } as never,
        };
        const { container } = renderSpatial(makePlayer("p1"), arrayCtx, "top");
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(selectTargetSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                targetType: "player",
                targetId: "p1",
            })
        );
    });

    it("a non-targetable player is inert on the spatial board", () => {
        // No pendingTarget → nothing to dispatch.
        const { container } = renderSpatial(makePlayer("p1"), {
            playerId: "p2",
        });
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });
});

describe("board damage-target choice parity (#280, CR 115.4)", () => {
    // The choice is owed to the viewer (p2 — the opponent doing the choosing);
    // p1 is an eligible candidate.
    const damageChoice = [
        {
            stackItemId: "witches",
            step: 0,
            choiceId: "cuombajj-witches",
            playerId: "p2",
            kind: "choose-damage-target" as const,
            zone: "battlefield" as const,
            allControllers: true,
            count: 1,
            prompt: "Cuombajj Witches: choose any target.",
            candidateIds: ["body-1"],
            candidatePlayerIds: ["p1", "p2"],
        },
    ];

    it("(b) clicking an eligible player toggles the SAME buffer id on both boards", () => {
        const classicBuffer = makeBuffer();
        renderClassic(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: damageChoice as never },
            classicBuffer
        );
        fireEvent.click(
            document.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(classicBuffer.toggle).toHaveBeenCalledWith("p1");
        // Damage-target picks route through the buffer, never selectTarget.
        expect(selectTargetSpy).not.toHaveBeenCalled();

        cleanup();

        const spatialBuffer = makeBuffer();
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: damageChoice as never },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).toHaveBeenCalledWith("p1");
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });

    it("an ineligible player (not a candidate) is inert on the spatial board", () => {
        const spatialBuffer = makeBuffer();
        const onlyP2 = [
            { ...damageChoice[0], candidatePlayerIds: ["p2"] },
        ] as never;
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: onlyP2 },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).not.toHaveBeenCalled();
    });
});

describe("board choose-player choice (CR 115.1a, Endurance #1207)", () => {
    // Endurance's ETB owes a trigger-time player pick to its controller (p2 as
    // the viewer here). The pick routes through the SAME nameplate → buffer path
    // as the damage-target pick, so a `choose-player` choice must light up the
    // candidate players too (zone is "graveyard" — never a battlefield pick).
    const playerChoice = [
        {
            stackItemId: "end1",
            step: 0,
            choiceId: "endurance-etb",
            playerId: "p2",
            kind: "choose-player" as const,
            zone: "graveyard" as const,
            count: { min: 0, max: 1 },
            prompt: "Choose up to one player.",
            candidatePlayerIds: ["p1", "p2"],
        },
    ];

    it("clicking an eligible player toggles the buffer (not selectTarget)", () => {
        const spatialBuffer = makeBuffer();
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: playerChoice as never },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).toHaveBeenCalledWith("p1");
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });

    it("an ineligible player (not a candidate) is inert", () => {
        const spatialBuffer = makeBuffer();
        const onlyP2 = [
            { ...playerChoice[0], candidatePlayerIds: ["p2"] },
        ] as never;
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", pendingChoices: onlyP2 },
            "top",
            spatialBuffer
        );
        fireEvent.click(
            container.querySelector('[data-arrow-anchor-player="p1"]')!
        );
        expect(spatialBuffer.toggle).not.toHaveBeenCalled();
    });
});

describe("board player life totals (#280)", () => {
    it("renders the life total and name for each player on the spatial board", () => {
        const opp = renderSpatial(
            makePlayer("p1", { life: 17, name: "Opponent" }),
            { playerId: "p2" },
            "top"
        );
        expect(opp.container.textContent).toContain("17");
        expect(opp.container.textContent).toContain("Opponent");

        cleanup();

        const me = renderSpatial(
            makePlayer("p2", { life: 12, name: "Me" }),
            { playerId: "p2" },
            "bottom"
        );
        expect(me.container.textContent).toContain("12");
        expect(me.container.textContent).toContain("Me");
    });

    it("anchors the opponent to the top edge and the viewer to the bottom edge", () => {
        // The edge-positioning class lives on the wrapper that pairs the
        // nameplate with the (restored) mana-pool indicator; the player anchor
        // is the nameplate inside it.
        const top = renderSpatial(makePlayer("p1"), { playerId: "p2" }, "top");
        expect(
            top.container.querySelector(
                '.top-1 [data-arrow-anchor-player="p1"]'
            )
        ).toBeTruthy();

        cleanup();

        const bottom = renderSpatial(
            makePlayer("p2"),
            { playerId: "p2" },
            "bottom"
        );
        expect(
            bottom.container.querySelector(
                '.bottom-1 [data-arrow-anchor-player="p2"]'
            )
        ).toBeTruthy();
    });

    it("centers the nameplate on the play area via the shared utility", () => {
        // Play-area layout rule: the nameplate wrapper centers on the play area
        // (viewport minus the right strip) through the single documented
        // `.play-area-center-x` utility (index.css), combined with the
        // `-translate-x-1/2` half-shift — NOT an inline `left-[calc(...)]`.
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2" },
            "top"
        );
        const wrapper = container.querySelector<HTMLElement>(
            ".play-area-center-x"
        );
        expect(wrapper).toBeTruthy();
        expect(wrapper!.className).toContain("-translate-x-1/2");
    });

    it("no longer shows the Monarch on the nameplate — it moved to a marker tile beside the piles (#1305)", () => {
        // Even when p1 IS the monarch, the nameplate carries no crown badge /
        // 'Monarch' text; the designation renders as a marker-card tile in
        // `board-piles.tsx` (`PlayerMonarchTile`), covered by its own test.
        const classic = renderClassic(makePlayer("p1"), {
            playerId: "p2",
            monarchId: "p1",
        });
        expect(classic.container.textContent).not.toContain("Monarch");
        cleanup();

        const spatial = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", monarchId: "p1" },
            "top"
        );
        expect(spatial.container.textContent).not.toContain("Monarch");
    });

    it("shows a priority ring on the player who holds priority", () => {
        // p1 has priority (default ctx), viewer is p2. The priority ring is a
        // token-based box-shadow (teal `secondary-accent` for both seats),
        // not a chromatic Tailwind ring class (ADR 0007).
        const { container } = renderSpatial(
            makePlayer("p1"),
            { playerId: "p2", priorityPlayerId: "p1" },
            "top"
        );
        const plate = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-player="p1"]'
        );
        expect(plate?.style.boxShadow).toContain("--color-secondary-accent");
    });
});
