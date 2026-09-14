// Issue #3556, owner comment — the per-CARD **Yield** reset on a battlefield
// permanent ("Turn off auto-yield for Noble Hierarch"), plus §5's second home
// for "Clear all yields" in the in-game Game Menu.
//
// The per-card reset is per card NAME, never per instance and never per
// keyword: a **Yield** on Noble Hierarch's exalted trigger must survive
// clearing from an Ignoble Hierarch, whose exalted trigger reads identically.
// Both the menu entry and the stack toggle key through the SAME derivation, so
// the stack item here comes out of the real projection.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { CardInstance, Player, StackItem } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";
import { GameContext } from "~/hooks/useGameContext";
import {
    YieldPrefsContext,
    useYieldPrefsState,
    useSeatYields,
} from "~/hooks/useYieldPreferences";
import { useCardYieldMenuItems } from "~/hooks/useCardYieldMenuItems";
import { yieldKeyForStackItem } from "~/lib/yields";

const concede = vi.fn(() => Promise.resolve(undefined));
vi.mock("convex/react", () => ({
    useMutation: () => concede,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { concede: {}, forfeitMatch: {}, manualConcedeMatch: {} } },
}));
vi.mock("~/lib/session", () => ({ clearSession: () => {} }));

import PauseMenuDialog from "../pause-menu-dialog";

const NOBLE = getCardByName("Noble Hierarch");
const IGNOBLE = getCardByName("Ignoble Hierarch");
const EXALTED = "exalted";

/** The exalted trigger of `defId`, as the CLIENT is handed it. */
function projectedTrigger(defId: string, instance: string): StackItem {
    const state: GameState = makeState({
        stack: [
            {
                ...makeInstance(defId, {
                    id: instance,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "stack",
                }),
                castById: "p1",
                triggeredAbilityId: EXALTED,
                triggerSourceId: "src",
            } as EngineStackItem,
        ],
    } as Partial<GameState>);
    return projectPublicState(state, 1, "p1").stack[0] as unknown as StackItem;
}

const permanent = (defId: string, id: string): CardInstance =>
    ({
        id,
        card: { id: defId },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
    }) as CardInstance;

/** Renders the menu entries a permanent would offer, plus a way to arm the
 *  store the way the stack row does. */
function CardMenuProbe({ card }: { card: CardInstance }) {
    const items = useCardYieldMenuItems(card);
    return (
        <div>
            {items.map((i) => (
                <button
                    key={i.key}
                    data-card-menu-entry
                    onClick={(e) => i.onSelect(e)}
                >
                    {i.label}
                </button>
            ))}
        </div>
    );
}

function YieldArmer({ items }: { items: StackItem[] }) {
    const seat = useSeatYields();
    return (
        <button
            data-arm
            onClick={() =>
                items.forEach((i) => seat.toggle(yieldKeyForStackItem(i)!))
            }
        />
    );
}

function Harness({ children }: { children: React.ReactNode }) {
    const yieldPrefs = useYieldPrefsState("game-a");
    const value = {
        gameId: "game-a" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [] as unknown as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={value}>
            <YieldPrefsContext value={yieldPrefs}>{children}</YieldPrefsContext>
        </GameContext>
    );
}

afterEach(cleanup);

describe("Per-card Yield reset on a battlefield permanent (issue #3556 comment)", () => {
    it("offers nothing while the seat holds no yield on that card", () => {
        const { container } = render(
            <Harness>
                <CardMenuProbe card={permanent(NOBLE.id, "perm-1")} />
            </Harness>
        );
        expect(
            container.querySelectorAll("[data-card-menu-entry]")
        ).toHaveLength(0);
    });

    it("appears once a yield is held, names the CARD, and clears every instance of it — leaving Ignoble Hierarch's identical trigger alone", () => {
        const noble = projectedTrigger(NOBLE.id, "trig-noble");
        const ignoble = projectedTrigger(IGNOBLE.id, "trig-ignoble");
        const { container } = render(
            <Harness>
                <YieldArmer items={[noble, ignoble]} />
                {/* A SECOND Noble Hierarch on the battlefield — the reset is
                    per card, so clearing from this instance clears the yield
                    that was set from the first one's trigger. */}
                <CardMenuProbe card={permanent(NOBLE.id, "perm-2")} />
                <CardMenuProbe card={permanent(IGNOBLE.id, "perm-3")} />
            </Harness>
        );
        fireEvent.click(container.querySelector("[data-arm]")!);

        const entries = () =>
            Array.from(container.querySelectorAll("[data-card-menu-entry]"));
        expect(entries().map((e) => e.textContent)).toEqual([
            "Turn off auto-yield for Noble Hierarch",
            "Turn off auto-yield for Ignoble Hierarch",
        ]);

        fireEvent.click(entries()[0]);
        expect(entries().map((e) => e.textContent)).toEqual([
            "Turn off auto-yield for Ignoble Hierarch",
        ]);
    });
});

describe("Clear all yields is reachable from the Game Menu (issue #3556 §5)", () => {
    it("is absent with none held and present, counted, once there are", () => {
        const noble = projectedTrigger(NOBLE.id, "trig-noble");
        const { container } = render(
            <Harness>
                <YieldArmer items={[noble]} />
                <PauseMenuDialog
                    open
                    onOpenChange={() => {}}
                    gameId={"g1" as Id<"games">}
                    playerId="p1"
                    match={null}
                />
            </Harness>
        );
        const menuReset = () =>
            document.querySelector('[data-clear-yields="menu"]');
        expect(menuReset()).toBeNull();

        fireEvent.click(container.querySelector("[data-arm]")!);
        expect(menuReset()?.textContent).toBe("Clear all yields (1)");

        fireEvent.click(menuReset()!);
        expect(menuReset()).toBeNull();
    });
});
