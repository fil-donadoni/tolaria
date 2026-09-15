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
import { render, cleanup, fireEvent, act } from "@testing-library/react";
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
import BoardBattlefieldCard from "../board-battlefield-card";
import type { CardVisualState, ActivatableAbility } from "../battlefield-card";
import { resetPreviewSingleton } from "../../cards/card-preview-singleton";

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

// Issue #3616 — the reset lives on the PREVIEW gestures, never on the left
// click. Rendered through the real battlefield card (its real CardImage →
// CardPreview → ActivatableAbilityMenu), so the gestures hit the same
// elements a player's do.
describe("The Yield reset rides the right click and the long-press, never the left click (issue #3616)", () => {
    const NEUTRAL_VS: CardVisualState = {
        interactive: false,
        enabled: false,
        dimmed: false,
        combatOffset: "",
        ringClass: "",
        badge: null,
    };
    const MANA_ABILITY = {
        id: "noble-mana",
        oracleText: "{T}: Add {G}, {W}, or {U}.",
    } as unknown as ActivatableAbility;

    function Board({ children }: { children: React.ReactNode }) {
        const noble = projectedTrigger(NOBLE.id, "trig-noble");
        const ignoble = projectedTrigger(IGNOBLE.id, "trig-ignoble");
        return (
            <Harness>
                <YieldArmer items={[noble, ignoble]} />
                {children}
            </Harness>
        );
    }

    const permanentEl = (container: HTMLElement, id: string) =>
        container.querySelector<HTMLElement>(
            `[data-arrow-anchor-permanent="${id}"]`
        )!;
    const tiltRoot = (container: HTMLElement, id: string) =>
        permanentEl(container, id).querySelector<HTMLElement>(
            "[data-card-tilt-root]"
        )!;
    function rightClick(target: HTMLElement) {
        fireEvent.pointerDown(target, { button: 2, clientX: 40, clientY: 40 });
        fireEvent(window, new Event("pointerup"));
    }
    const menuRows = () =>
        Array.from(
            document.querySelectorAll<HTMLElement>(
                '[data-slot="dialog-content"] button'
            )
        ).map((b) => b.textContent);
    const anchored = () =>
        document.querySelector("[data-card-preview-anchored]");

    afterEach(() => {
        vi.useRealTimers();
        resetPreviewSingleton();
    });

    it("a left click lists the permanent's abilities only — never the reset", () => {
        const { container } = render(
            <Board>
                <BoardBattlefieldCard
                    card={permanent(NOBLE.id, "perm-noble")}
                    vs={NEUTRAL_VS}
                    activatableAbilities={[MANA_ABILITY]}
                    onActivateAbility={() => {}}
                />
            </Board>
        );
        fireEvent.click(container.querySelector("[data-arm]")!);

        fireEvent.click(permanentEl(container, "perm-noble"));
        const items = Array.from(
            document.querySelectorAll('[role="menuitem"]')
        ).map((i) => i.textContent ?? "");
        expect(items).toHaveLength(1);
        expect(items.some((t) => t.includes("auto-yield"))).toBe(false);
    });

    it("a right click on a card with a Yield opens exactly Preview + the reset; Preview opens the preview, the reset clears only that card", () => {
        const { container } = render(
            <Board>
                <BoardBattlefieldCard
                    card={permanent(NOBLE.id, "perm-noble")}
                    vs={NEUTRAL_VS}
                />
                <CardMenuProbe card={permanent(IGNOBLE.id, "perm-ignoble")} />
            </Board>
        );
        fireEvent.click(container.querySelector("[data-arm]")!);

        rightClick(tiltRoot(container, "perm-noble"));
        expect(menuRows()).toEqual([
            "Preview",
            "Turn off auto-yield for Noble Hierarch",
        ]);
        expect(anchored()).toBeNull();

        fireEvent.click(
            document.querySelector('[data-testid="card-preview-menu-preview"]')!
        );
        expect(menuRows()).toEqual([]);
        expect(anchored()).not.toBeNull();

        // Close the pin, reopen the menu, take the reset.
        rightClick(tiltRoot(container, "perm-noble"));
        expect(anchored()).toBeNull();
        rightClick(tiltRoot(container, "perm-noble"));
        fireEvent.click(
            document.querySelector(
                '[data-testid="card-preview-menu-yield-off"]'
            )!
        );
        expect(
            Array.from(
                container.querySelectorAll("[data-card-menu-entry]")
            ).map((e) => e.textContent)
        ).toEqual(["Turn off auto-yield for Ignoble Hierarch"]);

        // No Yield left on this card: the right click is the preview again.
        rightClick(tiltRoot(container, "perm-noble"));
        expect(menuRows()).toEqual([]);
        expect(anchored()).not.toBeNull();
    });

    it("a right click on a card without a Yield opens the preview directly, no menu", () => {
        const { container } = render(
            <Board>
                <BoardBattlefieldCard
                    card={permanent(NOBLE.id, "perm-noble")}
                    vs={NEUTRAL_VS}
                />
            </Board>
        );
        rightClick(tiltRoot(container, "perm-noble"));
        expect(menuRows()).toEqual([]);
        expect(anchored()).not.toBeNull();
    });

    it("the touch long-press overlay carries the reset only while a Yield exists", () => {
        vi.useFakeTimers();
        const { container } = render(
            <Board>
                <BoardBattlefieldCard
                    card={permanent(NOBLE.id, "perm-noble")}
                    vs={NEUTRAL_VS}
                />
            </Board>
        );
        const longPress = () => {
            act(() => {
                fireEvent.touchStart(tiltRoot(container, "perm-noble"), {
                    touches: [{ clientX: 10, clientY: 10 }],
                });
                vi.advanceTimersByTime(400);
            });
        };
        const resetRow = () =>
            document.querySelector("[data-card-preview-yield-actions]");

        longPress();
        expect(document.querySelector(".fixed.inset-0")).not.toBeNull();
        expect(resetRow()).toBeNull();
        act(() => {
            fireEvent.click(document.querySelector(".fixed.inset-0")!);
        });

        act(() => {
            fireEvent.click(container.querySelector("[data-arm]")!);
        });
        longPress();
        expect(resetRow()?.textContent).toBe(
            "Turn off auto-yield for Noble Hierarch"
        );
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
