// The GRE half of the `clickActsWithAbilities` seam (issue #2169).
//
// `BoardBattlefieldCard` gained an opt-in click policy so the Manual Board can
// have a click both tap a permanent AND open its verb menu. The GRE board opts
// out by OMISSION: the real `useBattlefieldInteraction` never sets the field, so
// the whole GRE side rests on one destructuring default
// (`clickActsWithAbilities = false`, board-battlefield-card.tsx). That default
// re-states `useAbilityCardClick`'s documented policy — "a permanent that has
// both a tap and an ability is never tapped by a stray click"
// (useAbilityCardClick.tsx:18-20) — and flipping it silently inverts the
// behaviour of EVERY permanent with abilities on the GRE board.
//
// Nothing detected that: the review flipped this default (plus the two in
// `board-surface.tsx`) and the whole `src` suite stayed green, 0 failed. This is
// that missing guard. It drives the REAL `BoardBattlefield` under the REAL
// `useBattlefieldInteraction`, with only the Convex mutations mocked, so the
// assertion is "the GRE board does not dispatch a tap", not "a stub was not
// called".
//
// The subject needs a permanent that is BOTH activatable-by-menu and
// tappable-by-click, or the assertion is vacuous: `canInteract` gates the click
// path on the card having a mana ability, so a Prodigal Sorcerer would dispatch
// nothing on either policy. Basalt Monolith is the shape that discriminates —
// `{T}: Add {C}{C}{C}` (mana ability → clickable → tapUntap) plus
// `{3}: Untap` (stack ability → the card carries an ability menu).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const activateAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    activateAbility,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const names = [
        "tapUntap",
        "tapForPayment",
        "untapForPayment",
        "tapForActivationPayment",
        "untapForActivationPayment",
        "tapArtifactForImprovise",
        "untapArtifactForImprovise",
        "tapForAttackTax",
        "untapForAttackTax",
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "selectActivationCost",
        "selectSacrifice",
        "activateAbility",
        "activateManaAbility",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

/** Basalt Monolith: a mana ability AND a stack ability on one permanent. */
const DUAL_DEF = {
    id: "dual-def",
    name: "Basalt Monolith",
    activatedAbilities: [
        {
            id: "bm-mana",
            useStack: false,
            manaProduced: { C: 3 },
            oracleText: "{T}: Add {C}{C}{C}.",
            cost: { tap: true },
        },
        {
            id: "bm-untap",
            useStack: true,
            oracleText: "{3}: Untap Basalt Monolith.",
            cost: { mana: { generic: 3 } },
        },
    ],
};
const DEFS: Record<string, unknown> = { "dual-def": DUAL_DEF };
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, (id: string) => DEFS[id] ?? { id, name: id }),
    getDefinition: (id: string) => DEFS[id] ?? { id, name: id },
    tryGetDefinition: (id: string) => DEFS[id] ?? { id, name: id },
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
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

import BoardBattlefield from "../board-battlefield";

function permanent(): CardInstance {
    return {
        id: "bm1",
        card: { id: "dual-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Artifact"],
    } as CardInstance;
}

function makePlayer(battlefield: CardInstance[]): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function makeContext(me: Player): React.ContextType<typeof GameContext> {
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
        allPlayers: [me],
        showAllCards: false,
        onSwitchGame: () => {},
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
}

function renderGreBattlefield() {
    const me = makePlayer([permanent()]);
    // No `BattlefieldInteractionProvider`: this IS the GRE board's wiring, and
    // therefore the path on which `clickActsWithAbilities` is `undefined`.
    return render(
        <GameContext value={makeContext(me)}>
            <BoardBattlefield player={me} />
        </GameContext>
    );
}

beforeEach(() => {
    cleanup();
    for (const m of Object.values(MUTATIONS)) m.mockClear();
});

describe("GRE default click policy on a permanent with abilities (#2169)", () => {
    it("a desktop click does NOT tap it — the ability gesture owns the click", () => {
        const { container } = renderGreBattlefield();

        fireEvent.click(
            container.querySelector<HTMLElement>(
                '[data-arrow-anchor-permanent="bm1"]'
            )!
        );

        // THE assertion. With `clickActsWithAbilities` defaulting to true, the
        // card's own `onClick` fires alongside the menu and the permanent taps
        // for mana on a stray click — silently, on every GRE board.
        expect(tapUntap).not.toHaveBeenCalled();
        expect(activateAbility).not.toHaveBeenCalled();
    });

    it("the same click still opens the ability menu (the click is not simply dead)", () => {
        // The negative above only means something if the click reaches the
        // permanent at all: a card that swallowed every click would pass it.
        const { container } = renderGreBattlefield();

        fireEvent.click(
            container.querySelector<HTMLElement>(
                '[data-arrow-anchor-permanent="bm1"]'
            )!
        );

        const items = within(document.body).getAllByRole("menuitem");
        expect(items.length).toBeGreaterThan(0);
        expect(
            items.some((el) => (el.textContent ?? "").includes("Untap"))
        ).toBe(true);
    });
});
