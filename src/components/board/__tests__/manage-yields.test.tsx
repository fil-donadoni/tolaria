// Issue #3629 — the "Manage yields" box: the VIEWING seat's **Yields** and
// remembered **Auto-order** entries, each removable on its own.
//
// Runs the REAL CTA and box against the REAL store (`useYieldPrefsState`), with
// every key minted by `yieldKeyForStackItem` from the real projection.
import { useEffect, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    YieldPrefsContext,
    useYieldPrefsState,
    type YieldPrefsStore,
} from "~/hooks/useYieldPreferences";
import { yieldKeyForStackItem } from "~/lib/yields";

vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            concede: "concede",
            forfeitMatch: "forfeitMatch",
            manualConcedeMatch: "manualConcedeMatch",
        },
    },
}));
vi.mock("convex/react", () => ({
    useMutation: () => () => Promise.resolve(null),
}));

import ClearYieldsButton from "../clear-yields-button";
import ManageYieldsButton from "../manage-yields-button";
import PauseMenuDialog from "../pause-menu-dialog";

const NOBLE = getCardByName("Noble Hierarch");
const IGNOBLE = getCardByName("Ignoble Hierarch");
const BOLT = getCardByName("Lightning Bolt");

function mint(defId: string, trigger: boolean): string {
    const item = {
        ...makeInstance(defId, {
            id: `o-${defId}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        ...(trigger
            ? { triggeredAbilityId: "exalted", triggerSourceId: "s" }
            : {}),
    } as EngineStackItem;
    const state: GameState = makeState({ stack: [item] } as Partial<GameState>);
    const [projected] = projectPublicState(state, 1, "p1")
        .stack as unknown as StackItem[];
    return yieldKeyForStackItem(projected)!;
}

const nobleKey = mint(NOBLE.id, true);
const ignobleKey = mint(IGNOBLE.id, true);
const boltKey = mint(BOLT.id, false);

let store: YieldPrefsStore;
/** Every `onOpenChange` the Game Menu received — a nested box that closed
 *  the menu behind it would show up here as `false`. */
const menuOpenChanges: boolean[] = [];

function Board({ viewer, menu = false }: { viewer: string; menu?: boolean }) {
    const prefs = useYieldPrefsState("g1");
    // Published from an effect, not assigned during render: `act` flushes it
    // before any assertion reads `store`.
    useEffect(() => {
        store = prefs;
    }, [prefs]);
    const [menuOpen, setMenuOpen] = useState(true);
    return (
        <GameContext value={{ playerId: viewer } as never}>
            <YieldPrefsContext value={prefs}>
                <div data-home="panel">
                    <ClearYieldsButton />
                    <ManageYieldsButton />
                </div>
                {menu && (
                    <PauseMenuDialog
                        open={menuOpen}
                        onOpenChange={(next) => {
                            menuOpenChanges.push(next);
                            setMenuOpen(next);
                        }}
                        gameId={"g1" as never}
                        playerId={viewer}
                        match={null}
                    />
                )}
            </YieldPrefsContext>
        </GameContext>
    );
}

const $ = (selector: string) => document.querySelector(selector);
const rows = () =>
    Array.from(document.querySelectorAll("[data-manage-yields-row]"));
const rowTitles = () =>
    rows().map((row) => row.querySelector("div > div")?.textContent);
const openBox = () =>
    act(() => {
        fireEvent.click($('[data-manage-yields="panel"]')!);
    });
const removeButton = (label: string) =>
    $(`[data-manage-yields-remove][aria-label="${label}"]`) as HTMLElement;

/** Seat p1: two yields and two remembered orders, Auto-order on. Seat p2: one
 *  yield of its own, which p1's box must never show. */
function seed() {
    act(() => {
        store.toggle("p1", nobleKey);
        store.toggle("p1", boltKey);
        store.toggle("p2", ignobleKey);
        store.confirmTriggerOrder("p1", true, [nobleKey, ignobleKey, nobleKey]);
        store.confirmTriggerOrder("p1", true, [ignobleKey, boltKey]);
    });
}

afterEach(() => {
    cleanup();
    menuOpenChanges.length = 0;
});

describe("Manage yields box opened from the Game Menu (issue #3629)", () => {
    it("opens over the menu, and dismissing it — Escape or its own backdrop — leaves the menu open", () => {
        render(<Board viewer="p1" menu />);
        seed();
        const menuTitle = () =>
            Array.from(document.querySelectorAll("h2")).some(
                (h) => h.textContent === "Game Menu"
            );
        const openFromMenu = () =>
            act(() => {
                fireEvent.click($('[data-manage-yields="menu"]')!);
            });

        openFromMenu();
        expect($("[data-manage-yields-box]")).not.toBeNull();
        act(() => {
            fireEvent.keyDown(document.activeElement ?? document.body, {
                key: "Escape",
            });
        });
        expect($("[data-manage-yields-box]")).toBeNull();
        expect(menuOpenChanges).not.toContain(false);
        expect(menuTitle()).toBe(true);

        openFromMenu();
        const popups = document.querySelectorAll(
            '[data-slot="dialog-content"]'
        );
        act(() => {
            fireEvent.click(popups[popups.length - 1]);
        });
        expect($("[data-manage-yields-box]")).toBeNull();
        expect(menuOpenChanges).not.toContain(false);
        expect(menuTitle()).toBe(true);
    });
});

describe("Manage yields CTA (issue #3629)", () => {
    it("is absent while the seat holds no yield and no remembered order — in both homes", () => {
        render(<Board viewer="p1" menu />);
        expect($("[data-manage-yields]")).toBeNull();
        expect($("[data-clear-yields]")).toBeNull();
    });

    it("is visible in both homes with the Clear all count", () => {
        render(<Board viewer="p1" menu />);
        seed();
        for (const home of ["panel", "menu"]) {
            expect($(`[data-manage-yields="${home}"]`)?.textContent).toBe(
                "Manage yields (4)"
            );
            expect($(`[data-clear-yields="${home}"]`)?.textContent).toBe(
                "Clear all yields (4)"
            );
        }
    });
});

describe("Manage yields box (issue #3629)", () => {
    it("lists the seat's yields and its remembered orders by name", () => {
        render(<Board viewer="p1" />);
        seed();
        openBox();
        expect(rowTitles()).toEqual([
            "Noble Hierarch — triggered ability",
            "Lightning Bolt — cast",
            "Noble Hierarch → Ignoble Hierarch → Noble Hierarch",
            "Ignoble Hierarch → Lightning Bolt",
        ]);
    });

    it("removing one Yield row drops only that key and keeps the box open", () => {
        render(<Board viewer="p1" />);
        seed();
        openBox();
        act(() => {
            fireEvent.click(
                removeButton("Remove yield: Noble Hierarch — triggered ability")
            );
        });
        expect(store.yields).toEqual({ p1: [boltKey], p2: [ignobleKey] });
        expect(store.triggerOrders.p1).toEqual({
            enabled: true,
            orders: [
                [nobleKey, ignobleKey, nobleKey],
                [ignobleKey, boltKey],
            ],
        });
        expect($("[data-manage-yields-box]")).not.toBeNull();
        expect(rows()).toHaveLength(3);
    });

    it("removing one Auto-order row forgets only that order — yields and the toggle stay", () => {
        render(<Board viewer="p1" />);
        seed();
        openBox();
        act(() => {
            fireEvent.click(
                removeButton(
                    "Forget order: Noble Hierarch → Ignoble Hierarch → Noble Hierarch"
                )
            );
        });
        expect(store.triggerOrders.p1).toEqual({
            enabled: true,
            orders: [[ignobleKey, boltKey]],
        });
        expect(store.yields).toEqual({
            p1: [nobleKey, boltKey],
            p2: [ignobleKey],
        });
    });

    it("after the last row goes, the CTA disappears and the box shows its empty state", () => {
        render(<Board viewer="p1" />);
        seed();
        openBox();
        while (rows().length > 0) {
            act(() => {
                fireEvent.click(
                    rows()[0].querySelector("[data-manage-yields-remove]")!
                );
            });
        }
        expect($("[data-manage-yields]")).toBeNull();
        expect($("[data-clear-yields]")).toBeNull();
        expect($("[data-manage-yields-empty]")).not.toBeNull();
        expect(store.triggerOrders.p1?.enabled).toBe(true);
    });

    it("shows only the VIEWING seat's entries (solo mode)", () => {
        const { rerender } = render(<Board viewer="p1" />);
        seed();
        rerender(<Board viewer="p2" />);
        expect($('[data-manage-yields="panel"]')?.textContent).toBe(
            "Manage yields (1)"
        );
        openBox();
        expect(rowTitles()).toEqual(["Ignoble Hierarch — triggered ability"]);
    });
});
