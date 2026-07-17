// Create Limited Event dialog — Pick Timer On/Off control (ADR 0060, issue
// #1243). Replaces the old checkbox + seconds-field pair with a clear On/Off
// radiogroup, Draft only (never shown for Sealed), and no seconds input at
// all — the per-pick length always follows the server-side descending
// schedule. Drives the SURFACE assertion through the real component render
// (not a hand-built view), per the project's frontend wiring discipline.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import CreateLimitedEventDialog from "../create-limited-event-dialog";

const DRAFTABLE_SETS: DraftableSetInfo[] = [
    {
        setCode: "lea",
        draftable: true,
        missingCardCount: 0,
        sheets: [{ sheetName: "common", coverage: 1, passes: true }],
    },
];

function renderDialog(
    overrides: Partial<Parameters<typeof CreateLimitedEventDialog>[0]> = {}
) {
    const props = {
        open: true,
        onOpenChange: vi.fn(),
        draftableSets: DRAFTABLE_SETS,
        onCreate: vi.fn(),
        pending: false,
        ...overrides,
    };
    return { props, ...render(<CreateLimitedEventDialog {...props} />) };
}

describe("CreateLimitedEventDialog — Pick Timer (ADR 0060, issue #1243)", () => {
    it("never shows the Pick Timer control for a Sealed event (default type)", () => {
        renderDialog();
        expect(screen.queryByRole("radiogroup", { name: "Pick Timer" })).toBe(
            null
        );
    });

    it("shows an On/Off Pick Timer control, defaulting to Off, once Draft is selected — no seconds field", () => {
        renderDialog();
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));

        const timerGroup = screen.getByRole("radiogroup", {
            name: "Pick Timer",
        });
        expect(timerGroup).toBeTruthy();
        const off = screen.getByRole("radio", { name: "Off" });
        const on = screen.getByRole("radio", { name: "On" });
        expect(off.getAttribute("aria-checked")).toBe("true");
        expect(on.getAttribute("aria-checked")).toBe("false");

        // No seconds input anywhere — the control is on/off only.
        expect(screen.queryByText(/seconds per pick/i)).toBe(null);
        expect(screen.queryByRole("spinbutton", { name: /seconds/i })).toBe(
            null
        );
    });

    it("toggles to On and submits timerEnabled: true", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: "On" }));

        expect(
            screen
                .getByRole("radio", { name: "On" })
                .getAttribute("aria-checked")
        ).toBe("true");

        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "draft", timerEnabled: true })
        );
    });

    it("submits timerEnabled: false when the timer is left Off for a Draft", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));

        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "draft", timerEnabled: false })
        );
    });

    it("submits timerEnabled: false for a Sealed event regardless of any prior Draft timer choice", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        // Switch to Draft, turn the timer on, then switch back to Sealed.
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: "On" }));
        fireEvent.click(screen.getByRole("radio", { name: "Sealed" }));

        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "sealed", timerEnabled: false })
        );
    });
});

// Draft 3-booster packSlots + fixed booster count (PRD #1241 story 7, issue
// #1246): the create path was emitting a single-element `packSlots` for
// EVERY event type, which made `applyPick` complete a Draft after just one
// booster (the bug this issue fixes). Drives the SURFACE assertion through
// the real `onCreate` payload the dialog submits — a hand-built payload
// would mask the exact bug (a single-element array) this test exists to
// catch.
describe("CreateLimitedEventDialog — Draft 3-booster packSlots (issue #1246)", () => {
    it("submits a 3-element packSlots (three copies of the chosen set) for a Draft", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByText("Create Event"));

        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "draft",
                packSlots: ["lea", "lea", "lea"],
            })
        );
    });

    it("submits a single-element packSlots for Sealed (unchanged)", () => {
        const onCreate = vi.fn();
        renderDialog({ onCreate });
        fireEvent.click(screen.getByText("Create Event"));

        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "sealed", packSlots: ["lea"] })
        );
    });

    it("never renders an editable booster-count field for Draft (fixed at 3, not user-editable)", () => {
        renderDialog();
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));

        expect(screen.queryByText(/Sealed Boosters per Seat/)).toBe(null);
        expect(screen.queryByRole("spinbutton", { name: /booster/i })).toBe(
            null
        );
    });

    it("still renders the editable Sealed Boosters per Seat field for Sealed", () => {
        renderDialog();
        expect(screen.getByText(/Sealed Boosters per Seat/)).toBeTruthy();
    });

    it("re-derives packSlots to 3× the newly-picked set when switching the Pack Source while Draft is selected", () => {
        const onCreate = vi.fn();
        renderDialog({
            onCreate,
            draftableSets: [
                ...DRAFTABLE_SETS,
                {
                    setCode: "ice",
                    draftable: true,
                    missingCardCount: 5,
                    sheets: [
                        { sheetName: "common", coverage: 0.9, passes: true },
                    ],
                },
            ],
        });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: /^ICE$/i }));
        fireEvent.click(screen.getByText("Create Event"));

        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "draft",
                packSlots: ["ice", "ice", "ice"],
            })
        );
    });
});

// Vintage Cube pool source (ADR 0062) driven through the REAL dialog render
// with the exact `DraftableSetInfo` shape `listDraftableSets` emits for the
// cube (`isCube: true`, `availableCardCount: N`, `missingCardCount: 0`). A
// cube is Draft-only and shows an availability note, never the Incompleteness
// "N missing" disable.
describe("CreateLimitedEventDialog — Vintage Cube pool source (ADR 0062)", () => {
    const CUBE: DraftableSetInfo = {
        setCode: "vintage-cube",
        draftable: true,
        missingCardCount: 0,
        sheets: [],
        isCube: true,
        availableCardCount: 283,
    };
    const withCube = [DRAFTABLE_SETS[0], CUBE];

    it("lists the cube as 'Vintage Cube' with its available-card count", () => {
        renderDialog({ draftableSets: withCube });
        // The radio's accessible name is composed from the label text.
        expect(
            screen.getByRole("radio", { name: /Vintage Cube/ })
        ).toBeTruthy();
        // Its pool size is surfaced in the row (never a "missing" count).
        expect(screen.getByText(/283 cards/)).toBeTruthy();
    });

    it("makes the cube SELECTABLE for Draft (not disabled) and shows 'available'", () => {
        renderDialog({ draftableSets: withCube });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        const cubeRadio = screen.getByRole("radio", {
            name: /Vintage Cube/,
        }) as HTMLInputElement;
        expect(cubeRadio.disabled).toBe(false);
        expect(screen.getByText(/283 cards available/)).toBeTruthy();
    });

    it("disables the cube for Sealed (Draft-only pool source)", () => {
        renderDialog({ draftableSets: withCube });
        // Default type is Sealed.
        const cubeRadio = screen.getByRole("radio", {
            name: /Vintage Cube/,
        }) as HTMLInputElement;
        expect(cubeRadio.disabled).toBe(true);
        expect(screen.getByText(/Draft only/)).toBeTruthy();
    });

    it("shows the availability note (not the Incompleteness Notice) when the cube is selected", () => {
        renderDialog({ draftableSets: withCube });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: /Vintage Cube/ }));

        const note = screen.getByRole("status");
        expect(note.textContent).toMatch(/Vintage Cube/);
        expect(note.textContent).toMatch(/283 cards available/);
        expect(note.textContent).not.toMatch(/Incompleteness Notice/);
    });

    it("submits a 3-element cube packSlots for a Draft", () => {
        const onCreate = vi.fn();
        renderDialog({ draftableSets: withCube, onCreate });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: /Vintage Cube/ }));
        fireEvent.click(screen.getByText("Create Event"));

        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "draft",
                packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
            })
        );
    });
});

// Vintage Cube singleton seat cap (ADR 0062 rev): a cube deals one copy of
// each card, so the seat control is clamped to what the implemented pool fills
// singleton over 3 boosters — `⌊283 / 45⌋ = 6` — matching the server guard in
// `createLimitedEvent`. Driven through the REAL dialog render + submitted
// payload (a hand-built payload would mask the clamp).
describe("CreateLimitedEventDialog — Vintage Cube seat cap (ADR 0062 rev)", () => {
    const CUBE: DraftableSetInfo = {
        setCode: "vintage-cube",
        draftable: true,
        missingCardCount: 0,
        sheets: [],
        isCube: true,
        availableCardCount: 283,
    };
    const withCube = [DRAFTABLE_SETS[0], CUBE];

    function selectCubeDraft() {
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        fireEvent.click(screen.getByRole("radio", { name: /Vintage Cube/ }));
    }

    it("clamps the Seats input max to the singleton capacity (6 at 283 cards)", () => {
        renderDialog({ draftableSets: withCube });
        selectCubeDraft();
        const seats = screen.getByRole("spinbutton") as HTMLInputElement;
        expect(seats.getAttribute("max")).toBe("6");
        // The default 8 is clamped down to the cap in the displayed value.
        expect(seats.value).toBe("6");
    });

    it("explains the cap under the Seats field while the cube is selected", () => {
        renderDialog({ draftableSets: withCube });
        selectCubeDraft();
        expect(
            screen.getByText(
                /capped at 6 seats until the implemented pool grows/
            )
        ).toBeTruthy();
    });

    it("submits the clamped seat count (never an oversized cube table)", () => {
        const onCreate = vi.fn();
        renderDialog({ draftableSets: withCube, onCreate });
        selectCubeDraft();
        fireEvent.click(screen.getByText("Create Event"));
        expect(onCreate).toHaveBeenCalledWith(
            expect.objectContaining({ type: "draft", seatCount: 6 })
        );
    });

    it("keeps the full 2–8 range for a non-cube Draft source", () => {
        renderDialog({ draftableSets: withCube });
        fireEvent.click(screen.getByRole("radio", { name: "Draft" }));
        // LEA (non-cube) is selected by default — no cap.
        const seats = screen.getByRole("spinbutton") as HTMLInputElement;
        expect(seats.getAttribute("max")).toBe("8");
    });
});

describe("CreateLimitedEventDialog — Seats bot hint (issue #1245)", () => {
    it("renders helper text under Seats explaining unfilled seats become bots", () => {
        renderDialog();
        expect(
            screen.getByText(/Unfilled seats become bots when the event starts/)
        ).toBeTruthy();
        // Mentions setting the full table size for a solo draft.
        expect(screen.getByText(/solo draft/)).toBeTruthy();
    });
});

// Incompleteness Notice (ADR 0059, PRD #1242 AC5) driven through the REAL
// dialog render — the exact `DraftableSetInfo[]` shape `listDraftableSets`
// (convex/limited/registry.ts) returns over the wire, not a hand-built
// `<IncompletenessNotice>` render — per the project's frontend wiring
// discipline (a hand-built view would mask a dropped/mis-threaded field
// between the query result and the component prop).
describe("CreateLimitedEventDialog — Incompleteness Notice (ADR 0059, PRD #1242 AC5)", () => {
    const ICE_LIKE: DraftableSetInfo = {
        setCode: "ice",
        draftable: true,
        missingCardCount: 42,
        sheets: [
            { sheetName: "common", coverage: 0.86, passes: true },
            { sheetName: "uncommon", coverage: 0.83, passes: true },
            { sheetName: "rare", coverage: 0.81, passes: true },
        ],
    };
    const LEA_COMPLETE: DraftableSetInfo = {
        setCode: "lea",
        draftable: true,
        missingCardCount: 0,
        sheets: [
            { sheetName: "common", coverage: 1, passes: true },
            { sheetName: "uncommon", coverage: 1, passes: true },
            { sheetName: "rare", coverage: 1, passes: true },
        ],
    };

    it("shows the Notice, naming the set and its drop count, for the selected below-100% set", () => {
        renderDialog({ draftableSets: [ICE_LIKE, LEA_COMPLETE] });

        // ICE_LIKE is first in the list, so it's the default selection.
        const notice = screen.getByRole("status");
        expect(notice.textContent).toMatch(/Incompleteness Notice/);
        expect(notice.textContent).toMatch(/ICE/);
        expect(notice.textContent).toMatch(/42 cards/);
    });

    it("shows no Notice once the selected set reaches 100% (missingCardCount 0)", () => {
        renderDialog({ draftableSets: [LEA_COMPLETE, ICE_LIKE] });

        // LEA_COMPLETE is first, so it's the default selection — no Notice.
        expect(screen.queryByRole("status")).toBe(null);
    });

    it("toggles the Notice on/off as the admin switches the Pack Source selection", () => {
        renderDialog({ draftableSets: [LEA_COMPLETE, ICE_LIKE] });
        expect(screen.queryByRole("status")).toBe(null);

        fireEvent.click(screen.getByRole("radio", { name: /^ICE$/i }));
        expect(screen.getByRole("status").textContent).toMatch(/ICE/);

        fireEvent.click(screen.getByRole("radio", { name: /^LEA$/i }));
        expect(screen.queryByRole("status")).toBe(null);
    });

    it("renders no Notice at all when no set is below 100% (e.g. only LEA checked in)", () => {
        renderDialog({ draftableSets: [LEA_COMPLETE] });
        expect(screen.queryByRole("status")).toBe(null);
    });
});
