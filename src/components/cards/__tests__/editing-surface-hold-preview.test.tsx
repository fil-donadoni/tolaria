// The producer census, made executable (PRD #2405 gesture model A, issue
// #2583).
//
// `holdPreview` is a prop, so the interesting question is never "does the
// switch work" (`card-preview-hold-preview.test.tsx` answers that) but "did
// every surface that had to flip it actually flip it, and did no surface flip
// it that must not". That is a census, and a census is only checkable one row
// at a time — which is what this file is: one `it` per row of the table in the
// PR description, INCLUDING the must-NOT rows.
//
// Each row renders the REAL surface component in whatever context it needs and
// drives a REAL touch long-press, rather than grepping the source for the
// prop: a tile that passes `holdPreview={false}` to a CardImage it no longer
// renders would pass a grep and fail a user.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import DeckCardTile from "~/components/deckbuilder/deck-card-tile";
import LimitedDraftPackCard from "~/components/limited/limited-draft-pack-card";
import ResultCard from "~/components/lobby/deck-builder/result-card";
import SelectableCard from "../selectable-card";
import { GameContext } from "~/hooks/useGameContext";
import { PendingChoiceBufferContext } from "~/hooks/usePendingChoiceBuffer";
import CardPreview from "../card-preview";
import CardImage from "../card-image";
import { resetPreviewSingleton } from "../card-preview-singleton";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import type { CardIndexEntry } from "~/components/lobby/deck-builder/useCardSearch";
import type { CardInstance } from "~/types/game";
import type { Id } from "@convex/_generated/dataModel";

// `SelectableCard` (census row 11) routes its actions through
// `useHandCardCommit`, which is a real Convex mutation client. The row under
// test is its `onTouchStart`, not its mutations — stub the transport.
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn().mockResolvedValue(null),
    useQuery: () => undefined,
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

/** Past `useLongPress`' 400ms threshold — on any surface that still HAS the
 *  gesture, the centered overlay is up by now. */
const PAST_LONG_PRESS_MS = 500;

const overlay = () => document.querySelector(".fixed.inset-0");

/** `CardPreview` installs its touch listeners on its OWN wrapper div (or an
 *  enclosing `[data-card-tilt-root]`), which sits at a different depth in each
 *  surface's markup and carries no marker of its own. Touching every div in
 *  the tree reaches it wherever it is, and is safe precisely because only that
 *  one element has a listener bound — pressing the others is a no-op. */
function longPressEverything(container: HTMLElement) {
    act(() => {
        for (const el of container.querySelectorAll("div")) {
            fireEvent.touchStart(el, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        }
        vi.advanceTimersByTime(PAST_LONG_PRESS_MS);
    });
}

const DRAG_DATA: CardDragData = {
    kind: "main",
    cardId: BOLT_ID,
    cardName: "Lightning Bolt",
};

/** Census row 5 — one hit in the lobby's search grid. `oracleText` is
 *  non-empty so the card reads as an INDEXED entry, not a catalogue one (the
 *  catalogue branch would reach for Scryfall editions). */
const SEARCH_ENTRY: CardIndexEntry = {
    cardId: BOLT_ID,
    name: "Lightning Bolt",
    nameLower: "lightning bolt",
    nameFold: "lightning bolt",
    types: ["Instant"],
    subtypes: [],
    supertypes: [],
    colors: ["R"],
    manaValue: 1,
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    oracleFold: "lightning bolt deals 3 damage to any target.",
    prints: [{ printId: BOLT_ID, setCode: "lea" }],
};

/** Census row 11 — a hand card offering MORE THAN ONE action, which is the
 *  branch that renders the `ContextMenuTrigger` carrying the `onTouchStart`
 *  under test (`selectable-card.tsx:177`). */
function renderSelectable() {
    const cardInstance = {
        id: "ci-1",
        card: { id: BOLT_ID, name: "Lightning Bolt" },
        ownerId: "p1",
        controllerId: "p1",
        zone: "hand",
    } as unknown as CardInstance;
    const gameCtx = {
        gameId: "g1" as Id<"games">,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN" as const,
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    };
    const buffer = {
        buffer: [] as string[],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
    };
    return render(
        <GameContext value={gameCtx}>
            <PendingChoiceBufferContext
                value={
                    buffer as unknown as React.ContextType<
                        typeof PendingChoiceBufferContext
                    >
                }
            >
                <SelectableCard
                    cardInstance={cardInstance}
                    allowedActions={["cast", "discard"]}
                />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("editing-surface hold-preview census (issue #2583)", () => {
    beforeEach(() => {
        resetPreviewSingleton();
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        resetPreviewSingleton();
    });

    // ---- rows that MUST route through the new model (hold = drag) ----

    it("deckbuilder tile: a long press opens no preview", () => {
        const { container } = render(
            <DragDropProvider>
                <DeckCardTile
                    cardId={BOLT_ID}
                    dragId="d1"
                    dragData={DRAG_DATA}
                    title="Remove Lightning Bolt"
                    onClick={() => {}}
                />
            </DragDropProvider>
        );
        longPressEverything(container);
        expect(overlay()).toBeNull();
    });

    it("Draft Room pack card: a long press opens no preview", () => {
        const { container } = render(
            <LimitedDraftPackCard
                card={{
                    scryfallId: "s1",
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                    pickId: "r0-p0-c0",
                }}
                selected={false}
                onSelect={vi.fn()}
                onPick={vi.fn()}
                onOpenMenu={vi.fn()}
                pending={false}
            />
        );
        longPressEverything(container);
        expect(overlay()).toBeNull();
    });

    it("lobby search result card: a long press opens no preview", () => {
        const { container } = render(
            <ResultCard
                entry={SEARCH_ENTRY}
                activeSets={[]}
                enforceAvailability
                onAdd={vi.fn()}
            />
        );
        longPressEverything(container);
        expect(overlay()).toBeNull();
    });

    // ---- the must-NOT rows: everything else keeps ADR 0009 ----
    //
    // The board is the reason `holdPreview` defaults to TRUE rather than being
    // opted INTO. A default of false would silently strip the long-press
    // preview from ~30 board surfaces, none of which this issue touches, and
    // no test of the editing surfaces alone would notice.
    it("a plain CardImage (board, piles, lobby) still opens the preview on hold", () => {
        const { container } = render(
            <CardPreview cardId="bolt" cardName="Lightning Bolt">
                <CardImage card={{ id: BOLT_ID }} />
            </CardPreview>
        );
        longPressEverything(container);
        expect(overlay()).toBeTruthy();
    });

    // Census row 11 — THE REUSE TRAP. `selectable-card.tsx`'s `onTouchStart`
    // is the same event shape as an editing surface's tap and means something
    // entirely different: "the next click submits a game CHOICE, route it to
    // the ActionSheet instead of the desktop context menu". It must never
    // acquire the gesture engine's `tap → select → Peek Panel`. The PR
    // asserted this in prose; this is the assertion.
    it("selectable-card: a touch tap opens the game ActionSheet, never a Peek Panel", () => {
        const { container } = renderSelectable();
        const trigger = container.querySelector(
            "[class*=border-dashed]"
        ) as HTMLElement;

        fireEvent.touchStart(trigger, {
            touches: [{ clientX: 5, clientY: 5 }],
        });
        fireEvent.click(trigger);

        // The board's touch affordance — the ActionSheet's own CTA list —
        // and nothing from the editing model.
        const sheetLabels = [...document.body.querySelectorAll("button")].map(
            (b) => b.textContent
        );
        expect(sheetLabels).toContain("Cast");
        expect(sheetLabels).toContain("Discard");
        expect(document.querySelector("[data-peek-panel]")).toBeNull();
    });

    it("selectable-card: the ADR 0009 hold preview is untouched there", () => {
        // The other half of row 11 — it is a must-NOT row, so the long press
        // must still do what it always did. This is what would go red if
        // someone reached for `holdPreview={false}` on a board surface.
        const { container } = renderSelectable();
        longPressEverything(container);
        expect(overlay()).toBeTruthy();
    });
});

// The per-row tests above prove the rows they render. These two sweep the
// rows nothing renders — the ~13 must-NOT sites that are board chrome, sheets
// and menus, where a hand-written "it still works" test would mount half the
// board to assert something this slice never touched. A census's real claim
// is a CLOSED SET, and a closed set is checkable directly.
describe("editing-surface census closure (issue #2583)", () => {
    const SRC = resolve(process.cwd(), "src");

    function tsxFiles(dir: string, out: string[] = []): string[] {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) {
                if (name !== "__tests__") tsxFiles(full, out);
            } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
                out.push(full);
            }
        }
        return out;
    }

    /** Every censused site that turns the hold-preview OFF. Exactly the
     *  editing surfaces — census rows 2, 3, 5 and the two `DragOverlay`
     *  ghost tiles (rows 1 and 4), which render a card under the finger
     *  MID-DRAG and would be the worst possible place to open a preview. */
    const HOLD_PREVIEW_OFF_SITES = [
        "components/deckbuilder/deck-card-tile.tsx",
        "components/deckbuilder/deck-builder-shell.tsx",
        "components/limited/limited-draft-pack-card.tsx",
        "components/limited/limited-draft-table.tsx",
        "components/lobby/deck-builder/result-card.tsx",
    ];

    it("only the censused editing surfaces switch the hold-preview off", () => {
        const found = tsxFiles(SRC)
            .filter((f) =>
                /holdPreview[=:]\s*\{?false/.test(readFileSync(f, "utf8"))
            )
            .map((f) => relative(SRC, f))
            .sort();
        // A new `holdPreview={false}` on a board surface is a silently
        // stripped ADR 0009 long-press. It reds HERE, wherever it lands.
        expect(found).toEqual([...HOLD_PREVIEW_OFF_SITES].sort());
    });

    it("no shipped surface imports the gesture engine yet — the adoption is still owed", () => {
        // The engine (`~/lib/gesture/**`) ships in this slice with NO shipped
        // consumer: dnd-kit is still the drag transport everywhere, and the
        // Draft Room adopts only the Peek Panel / Inspect Overlay. Pinning
        // that is what makes the next slice's adoption a DELIBERATE, visible
        // change to this list rather than an accident — and it is what pins
        // every must-NOT row's "does not route through the engine" claim,
        // row 11 included, without mounting the board.
        const importers = tsxFiles(SRC)
            .filter((f) => !f.includes("/lib/gesture/"))
            .filter((f) =>
                /from\s+"~\/lib\/gesture/.test(readFileSync(f, "utf8"))
            )
            .map((f) => relative(SRC, f))
            .sort();
        expect(importers).toEqual(
            [
                // The ghost's prop TYPE only; the component itself has no
                // shipped mounter either.
                "components/editing/drag-ghost.tsx",
                // Thresholds only — dnd-kit's sensors configured FROM the core's
                // constants, so activation cannot drift between the two paths.
                "components/deckbuilder/useDeckDragSensors.ts",
            ].sort()
        );
    });
});
