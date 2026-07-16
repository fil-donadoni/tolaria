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

        expect(screen.getByRole("radio", { name: "On" }).getAttribute(
            "aria-checked"
        )).toBe("true");

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

describe("CreateLimitedEventDialog — Seats bot hint (issue #1245)", () => {
    it("renders helper text under Seats explaining unfilled seats become bots", () => {
        renderDialog();
        expect(
            screen.getByText(
                /Unfilled seats become bots when the event starts/
            )
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
