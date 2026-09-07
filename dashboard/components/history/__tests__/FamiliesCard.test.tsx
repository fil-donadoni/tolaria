// Assertions read the DOM directly rather than through jest-dom's matchers —
// see the note in `NowView.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FamiliesCard } from "../FamiliesCard";
import { GLOSSARY } from "../../../glossary";
import { ROLE_COLS } from "../../../lib/historyRows";
import { FAMILIES } from "./fixture";
import type { FamiliesPayload } from "../../../lib/historyPayload";

/**
 * The Agent family × role pivot (#2634, ported in PRD #3148 S3).
 *
 * The pivot's own hazard is that its four role columns already read as plain
 * English, so a port can leave them looking correct while they explain
 * nothing: before #2634 all four carried ONE generic dimension tip. Each
 * column earning its own `role.<name>` entry is what this file exists to keep,
 * and the tooltips are OPENED and read rather than inferred from a class.
 */

const renderCard = (
    payload: FamiliesPayload | null = FAMILIES,
    error: string | null = null
) =>
    render(
        <TooltipProvider>
            <FamiliesCard payload={payload} error={error} />
        </TooltipProvider>
    );

const table = () => screen.getByRole("table", { name: "Agent family by role" });

const rowFor = (family: string) =>
    [...table().querySelectorAll("tbody tr")].find((tr) =>
        tr.textContent?.startsWith(family)
    )!;

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Family × role pivot", () => {
    it("keeps the role names as header text but gives each its OWN glossary tooltip, never one generic tip repeated four times", async () => {
        renderCard();
        const head = table().querySelector("thead")!;
        for (const role of ROLE_COLS) {
            const entry = GLOSSARY[`role.${role}`];
            const trigger = [...head.querySelectorAll("span")].find(
                (s) => s.textContent === role
            )!;
            expect(trigger, role).not.toBeUndefined();
            fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
            fireEvent.mouseEnter(trigger);
            await waitFor(() =>
                expect(screen.getByText(entry.tip), role).not.toBeNull()
            );
            fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
            fireEvent.mouseLeave(trigger);
            await waitFor(() =>
                expect(screen.queryByText(entry.tip), role).toBeNull()
            );
        }
        // The four tips really are four different sentences — a port that
        // wired one tip to every column would pass a "has a tooltip" check.
        const tips = new Set(ROLE_COLS.map((r) => GLOSSARY[`role.${r}`].tip));
        expect(tips.size).toBe(ROLE_COLS.length);
    });

    it("takes its title and subtitle from the glossary, and renders them even when the read FAILED", () => {
        renderCard(null, "database is locked");
        expect(
            screen.getByText(GLOSSARY["card.family-role"].label)
        ).not.toBeNull();
        expect(
            screen.getByText(GLOSSARY["card.family-role"].tip)
        ).not.toBeNull();
        // The whole reason those two writes moved out of the fetch in #2634:
        // three awaited reads used to leave the card with no subtitle at all.
        expect(screen.getByRole("status").textContent).toContain(
            "database is locked"
        );
    });

    it("never prints a raw float for a family's total cost", () => {
        renderCard();
        // 12.5 + 3.25 + 0.5 = 16.25.
        expect(rowFor("dashboard").textContent).toContain("$16.25");
        expect(rowFor("dashboard").textContent).not.toContain("16.250");
        expect(rowFor("engine").textContent).toContain("$1.25");
    });

    it("orders families by total cost, descending — the pivot has no interactive sort to reach the big one with", () => {
        renderCard();
        const families = [...table().querySelectorAll("tbody tr")].map((tr) =>
            tr.getAttribute("data-row")
        );
        expect(families).toEqual(["dashboard", "engine"]);
        // And no header is a sort control: a button promising an ordering the
        // pivot cannot deliver is worse than no button.
        expect(table().querySelectorAll("thead button").length).toBe(0);
    });

    it("renders the empty mark for a role the family never ran, not a zero", () => {
        renderCard();
        // `engine` ran `implement` only.
        const cells = [...rowFor("engine").querySelectorAll("td")];
        expect(cells[2].textContent).toContain("10' · $1.25");
        expect(cells[3].textContent).toBe("—");
    });

    it("renders the empty mark for a role cell that exists but sums to zero — `0' · $0.00` would claim a measurement", () => {
        renderCard({
            rows: [
                {
                    family: "quiet",
                    role: "implement",
                    minutes: 0,
                    cost: 0,
                    out_tok: 0,
                    issues: 1,
                },
            ],
        });
        const cells = [...rowFor("quiet").querySelectorAll("td")];
        expect(cells[2].textContent).toBe("—");
    });

    it("an empty state reads as a sentence, not a blank table", () => {
        renderCard({ rows: [] });
        expect(
            screen.getByText(GLOSSARY["empty.families.none"].tip)
        ).not.toBeNull();
        // The header row survives, so the card still says what it WOULD show.
        expect(table().querySelectorAll("thead th").length).toBe(
            ROLE_COLS.length + 3
        );
    });
});
