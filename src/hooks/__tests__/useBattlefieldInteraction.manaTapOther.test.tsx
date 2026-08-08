// Non-tap MANA ability with a `cost.tapOtherFilter` leg (issue #2371) — Urza,
// Lord High Artificer's "Tap an untapped artifact you control: Add {U}." has no
// {T} of its own, so it is reachable ONLY through the activated-ability menu,
// and its cost taps a DIFFERENT permanent the player has to choose.
//
// This drives the REAL `useBattlefieldInteraction` reducer end-to-end against
// the REAL catalogue definition (no mocked card def): `getActivatable` must
// surface the ability only when an untapped artifact exists,
// `handleActivateAbility` must auto-commit a forced pick and otherwise open the
// picker, `canInteract` must gate clicks to the legal artifacts, and the
// finished pick must dispatch `activateManaAbility` with `tapOtherIds`.
//
// The bug it guards: PR #2419 round 1 shipped `tapOtherIds` on the mutation with
// NO client that ever passes it, so every human activation of the card's
// signature ability threw "Not enough untapped permanents to pay the tap cost".
// Nothing failed, because `activation-affordability.catalogue.test.ts` skips
// `!useStack` abilities and no test drove this hook.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { urzaLordHighArtificer } from "@convex/cards/sets/mh1/blue";
import { ornithopter, millstone } from "@convex/cards/sets/atq/colorless";
import { grizzlyBears } from "@convex/cards/sets/lea";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const activateManaAbility = vi.fn<MutFn>(() => Promise.resolve());
const activateAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    activateManaAbility,
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
        "getFullState",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
        dismissError: vi.fn(),
    }),
}));

// Import AFTER mocks are registered.
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

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

function artifact(id: string, isTapped = false): CardInstance {
    return {
        id,
        card: { id: ornithopter.id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped,
        isSummoningSick: false,
        types: ["Artifact", "Creature"],
        subtypes: ["Thopter"],
        staticAbilities: ["flying"],
        power: 0,
        toughness: 2,
    } as CardInstance;
}

/** An artifact candidate that ALSO owns its own activated ability (Millstone),
 *  unlike `artifact()` (Ornithopter, ability-less) — reproduces issue where a
 *  candidate with abilities of its own stays in `getActivatable`'s own list
 *  while the picker is open, so the board never binds its plain `onClick` and
 *  a click opens Millstone's OWN menu instead of paying Urza's cost. */
function millstoneCard(id: string, isTapped = false): CardInstance {
    return {
        id,
        card: { id: millstone.id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped,
        isSummoningSick: false,
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
    } as CardInstance;
}

function bear(): CardInstance {
    return {
        id: "bear1",
        card: { id: grizzlyBears.id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: ["Bear"],
        staticAbilities: [],
        power: 2,
        toughness: 2,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
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

type Interaction = ReturnType<typeof useBattlefieldInteraction>;

/** Mounts the REAL hook + its `overlays` (where the tap-other banner lives) and
 *  exposes the latest interaction handle so a test can call
 *  `handleActivateAbility` / `handleClick` / `canInteract` and then inspect the
 *  DOM the resulting re-render produces. */
function renderInteraction(me: Player) {
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

    const handle: { current: Interaction | null } = { current: null };
    function Harness() {
        const interaction = useBattlefieldInteraction(me);
        handle.current = interaction;
        return <>{interaction.overlays}</>;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    const utils = render(<Harness />, { wrapper });
    return { ...utils, handle };
}

describe("useBattlefieldInteraction — tap-another-artifact mana ability (Urza, Lord High Artificer, issue #2371)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        activateManaAbility.mockClear();
        activateAbility.mockClear();
        cleanup();
    });

    it("getActivatable surfaces the mana ability when an untapped artifact can pay the cost", () => {
        const source = urza();
        const me = player("me", [source, artifact("art1")]);
        const { handle } = renderInteraction(me);

        expect(handle.current!.getActivatable(source)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: MANA_ABILITY_ID }),
            ])
        );
    });

    it("getActivatable WITHHOLDS it when every artifact is tapped (CR 602.5b — unpayable cost)", () => {
        const source = urza();
        const me = player("me", [source, artifact("art1", true), bear()]);
        const { handle } = renderInteraction(me);

        const ids = handle.current!.getActivatable(source).map((a) => a.id);
        // The bear is untapped but is not an Artifact, and the source itself is
        // never a legal pick (CR 602.1 "another") — so nothing can pay.
        expect(ids).not.toContain(MANA_ABILITY_ID);
    });

    it("auto-commits the FORCED pick: one legal artifact dispatches activateManaAbility with its id, no picker", () => {
        const source = urza();
        const me = player("me", [source, artifact("art1"), bear()]);
        const { handle, container } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });

        expect(activateManaAbility).toHaveBeenCalledTimes(1);
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "urza1",
            abilityId: MANA_ABILITY_ID,
            tapOtherIds: ["art1"],
        });
        expect(tapUntap).not.toHaveBeenCalled();
        // No prompt: a choice with one legal answer is not a choice.
        expect(container.textContent).not.toContain("Activation cost");
    });

    it("opens the picker when the choice is real, and the finished pick carries tapOtherIds", () => {
        const source = urza();
        const me = player("me", [source, artifact("art1"), artifact("art2")]);
        const { handle, container } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });

        // Parked, not dispatched — the player has two artifacts to choose from.
        expect(activateManaAbility).not.toHaveBeenCalled();
        expect(container.textContent).toContain("Urza, Lord High Artificer");
        expect(container.textContent).toContain("tap an artifact");

        // Only the legal artifacts are clickable; the source is not (CR 602.1).
        expect(handle.current!.canInteract(artifact("art1"))).toBe(true);
        expect(handle.current!.canInteract(artifact("art2"))).toBe(true);
        expect(handle.current!.canInteract(source)).toBe(false);
        expect(handle.current!.canInteract(bear())).toBe(false);

        act(() => {
            handle.current!.handleClick(artifact("art2"));
        });

        expect(activateManaAbility).toHaveBeenCalledTimes(1);
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "urza1",
            abilityId: MANA_ABILITY_ID,
            tapOtherIds: ["art2"],
        });
    });

    it("the picker's gold ring marks exactly the permanents the click gate accepts", () => {
        const source = urza();
        const me = player("me", [source, artifact("art1"), artifact("art2")]);
        const { handle } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });

        // SURFACE assertion through the real visual-state reducer: a
        // highlighted-but-inert (or clickable-but-unlit) permanent is the whole
        // bug class this picker's two surfaces have to avoid.
        const ring = (c: CardInstance) =>
            handle.current!.getVisualState(c).ringClass ?? "";
        expect(ring(artifact("art1"))).toContain("ring-accent");
        expect(ring(artifact("art2"))).toContain("ring-accent");
        expect(ring(source)).not.toContain("ring-accent");
    });

    it("a candidate with its OWN activated ability (Millstone) is withheld from getActivatable while the picker is open, so the board binds a plain click to it (issue: dialog opens, click on the artifact does nothing / opens ITS menu instead)", () => {
        const source = urza();
        const rock = millstoneCard("mill1");
        const me = player("me", [source, rock, artifact("art1")]);
        const { handle } = renderInteraction(me);

        // Before the picker opens, Millstone offers its own ability normally.
        expect(handle.current!.getActivatable(rock).map((a) => a.id)).toContain(
            "millstone-mill"
        );

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });
        // Two legal artifacts (rock, art1) — a real choice, picker stays open.
        expect(activateManaAbility).not.toHaveBeenCalled();

        // Modal pick in progress: Millstone must NOT offer its own ability —
        // otherwise the board withholds `onClick` from it (routes the click to
        // the ability-menu gesture instead) and the pick can never land on it.
        expect(handle.current!.getActivatable(rock)).toEqual([]);
        expect(handle.current!.canInteract(rock)).toBe(true);

        act(() => {
            handle.current!.handleClick(rock);
        });

        expect(activateManaAbility).toHaveBeenCalledTimes(1);
        expect(activateManaAbility).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "urza1",
            abilityId: MANA_ABILITY_ID,
            tapOtherIds: ["mill1"],
        });
    });

    it("Cancel abandons the pick — nothing dispatched, the board unlocks", () => {
        const source = urza();
        const me = player("me", [source, artifact("art1"), artifact("art2")]);
        const { handle, container } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(
                "urza1",
                MANA_ABILITY_ID,
                false
            );
        });
        const cancel = Array.from(container.querySelectorAll("button")).find(
            (b) => b.textContent === "Cancel"
        )!;
        expect(cancel).toBeDefined();
        act(() => {
            fireEvent.click(cancel);
        });

        expect(activateManaAbility).not.toHaveBeenCalled();
        // Out of the modal pick mode: the source is no longer gated by it.
        expect(handle.current!.canInteract(artifact("art1"))).toBe(false);
    });
});
