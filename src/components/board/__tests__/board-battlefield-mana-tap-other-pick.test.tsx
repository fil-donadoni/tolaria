// Board-level regression for the NON-stack mana ability tap-other picker (Urza,
// Lord High Artificer, issue #2371 follow-up).
//
// The hook-level test (`useBattlefieldInteraction.manaTapOther.test.tsx`) drives
// `getVisualState` / `getActivatable` / `handleClick` DIRECTLY and passed while
// the feature was dead in the real UI: the player saw the "Activation cost — tap
// an artifact" banner, no candidate ring, and a click on a candidate opened THAT
// permanent's own ability menu instead of paying Urza's cost.
//
// The reason only a board-level test can catch it: `board-battlefield.tsx`
// memoises its card nodes with each card's `getVisualState` / `getActivatable`
// result already baked in. Every OTHER picker is server-parked, so opening one
// also changes `player` and invalidates that memo for free. `manaTapOtherPick`
// is client-local React state — unless the board's memo key reflects it, the
// whole battlefield stays frozen on its pre-picker nodes.
//
// So this renders the REAL hook inside the REAL `BoardBattlefield` and asserts
// the DOM after the picker opens.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { BattlefieldInteractionProvider } from "~/hooks/useBattlefieldInteractionContext";
import { urzaLordHighArtificer } from "@convex/cards/sets/mh1/blue";
import { millstone } from "@convex/cards/sets/atq/colorless";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const activateManaAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    activateManaAbility,
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
        "getFullState",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

// The buffer object must keep a STABLE identity across renders, exactly like
// the real `useState`-backed hook: `board-battlefield.tsx` uses `buffer` as a
// memo key for its card nodes, so a fresh `[]` per render would invalidate that
// memo every time and mask the very staleness this file exists to catch.
const STABLE_BUFFER: string[] = [];
const PENDING_CHOICE_BUFFER = {
    buffer: STABLE_BUFFER,
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(),
    isPending: false,
    lastError: null,
    reportError: vi.fn(),
    dismissError: vi.fn(),
};
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => PENDING_CHOICE_BUFFER,
}));

// SpatialZone measures its box via ResizeObserver; stub it so layout doesn't
// matter — the card nodes themselves are what these assertions read.
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

// Imported AFTER the mocks are registered.
import BoardBattlefield from "../board-battlefield";
import { useBattlefieldInteraction } from "~/hooks/useBattlefieldInteraction";
import type { BattlefieldInteractionResult } from "~/hooks/useBattlefieldInteractionContext";

const MANA_ABILITY_ID = "urza-lha-mana";

function urza(): CardInstance {
    return {
        id: "urza1",
        card: { id: urzaLordHighArtificer.id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: true,
        types: ["Creature"],
        subtypes: ["Human", "Artificer"],
        supertypes: ["Legendary"],
        staticAbilities: [],
        power: 1,
        toughness: 4,
    } as CardInstance;
}

/** Two Millstones: artifacts that carry an activated ability of their OWN, so
 *  the frozen-node bug shows on both surfaces at once (no candidate ring, and
 *  the ability-menu click binding kept instead of the cost-pick click). Two of
 *  them also makes the pick a REAL choice, so the picker actually opens instead
 *  of auto-committing a forced pick. */
function millstoneCard(id: string): CardInstance {
    return {
        id,
        card: { id: millstone.id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
    } as CardInstance;
}

function player(battlefield: CardInstance[]): Player {
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
    } as Player;
}

/** Renders the REAL `BoardBattlefield` driven by the REAL interaction hook,
 *  injected through the provider only so the test can hold the hook's result
 *  and open the picker the way the ability menu would. */
function renderBoard(me: Player) {
    const ctx = {
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
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;

    const handle: { current: BattlefieldInteractionResult | null } = {
        current: null,
    };
    // Named `use…` so the rules-of-hooks lint sees a custom hook: it IS one —
    // the real hook, plus a tap that records its result for the test.
    const useTappedInteraction = (p: Player) => {
        const result = useBattlefieldInteraction(p);
        handle.current = result as BattlefieldInteractionResult;
        return result as BattlefieldInteractionResult;
    };

    const utils = render(
        <GameContext value={ctx}>
            <BattlefieldInteractionProvider value={useTappedInteraction}>
                <BoardBattlefield player={me} />
            </BattlefieldInteractionProvider>
        </GameContext>
    );
    return { ...utils, handle };
}

afterEach(() => {
    cleanup();
    activateManaAbility.mockClear();
});

describe("BoardBattlefield — non-stack mana ability tap-other picker (Urza, Lord High Artificer)", () => {
    it("opening the picker re-renders the card nodes: candidates light up and stop offering their own ability menu", () => {
        const me = player([
            urza(),
            millstoneCard("mill1"),
            millstoneCard("mill2"),
        ]);
        const { handle, container } = renderBoard(me);

        // Baseline: no picker, no candidate ring anywhere on the board.
        expect(container.querySelectorAll(".card-ring-candidate").length).toBe(
            0
        );

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });

        // The picker is open (two artifacts = a real choice), so nothing is
        // dispatched yet and the banner is up.
        expect(activateManaAbility).not.toHaveBeenCalled();
        expect(container.textContent).toContain("Activation cost");

        // SURFACE assertion, the whole point of this file: the RENDERED nodes
        // must carry the candidate ring. A stale memo leaves this at 0 while
        // every hook-level assertion still passes.
        expect(
            container.querySelectorAll(".card-ring-candidate").length
        ).toBeGreaterThanOrEqual(2);

        // The same staleness that hides the ring also keeps each candidate's
        // own ability menu armed, which is what swallowed the click.
        expect(handle.current!.getActivatable(millstoneCard("mill1"))).toEqual(
            []
        );

        // …and the ring must actually be PAINTED, not merely present in the
        // class list. This used to mean "carries no competing ring colour": the
        // candidate ring and the card's black hairline were the same CSS
        // property (`--tw-ring-color`), Tailwind emitted `ring-black/40` AFTER
        // `ring-accent/40`, and a card wearing both rendered its candidate ring
        // BLACK — invisible on a dark board, exactly the "banner is up but
        // nothing is highlighted" report. Issue #2724 moved state rings onto an
        // inset pseudo-element (`.card-ring`), so the contention is gone and
        // the invariant flips: a candidate now carries the recipe that paints
        // it AND keeps its hairline. jsdom loads no stylesheet and cannot
        // resolve a cascade, so both halves are asserted on the composition.
        const candidates = container.querySelectorAll(".card-ring-candidate");
        expect(candidates.length).toBeGreaterThanOrEqual(2);
        for (const el of candidates) {
            // The role class is only a colour variable; `.card-ring` is what
            // draws anything at all.
            expect(el.className).toContain("card-ring ");
            expect(el.className).toContain("ring-black/40");
        }
    });

    it("cancelling the picker puts the board back: rings gone, own ability menus offered again", () => {
        const me = player([
            urza(),
            millstoneCard("mill1"),
            millstoneCard("mill2"),
        ]);
        const { handle, container } = renderBoard(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });
        expect(
            container.querySelectorAll(".card-ring-candidate").length
        ).toBeGreaterThanOrEqual(2);

        const cancel = Array.from(container.querySelectorAll("button")).find(
            (b) => b.textContent === "Cancel"
        )!;
        act(() => {
            cancel.click();
        });

        // The nodes must recompute on the way OUT too — a board left ringed and
        // click-locked after Cancel is the same staleness in the other
        // direction.
        expect(container.querySelectorAll(".card-ring-candidate").length).toBe(
            0
        );
        expect(
            handle.current!.getActivatable(millstoneCard("mill1")).length
        ).toBeGreaterThan(0);
    });
});
