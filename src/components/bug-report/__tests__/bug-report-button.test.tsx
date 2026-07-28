import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { BESIDE_CONTROLLER_STRIP } from "~/lib/controller-bar-metrics";
import BugReportButton from "../bug-report-button";

// `BugReportButton` always mounts `BugReportDialog` (open or closed), which
// calls Convex hooks unconditionally — stub them out so this test exercises
// only the button's own anchoring, not the dialog's data wiring (covered by
// `bug-report-dialog.test.tsx`).
vi.mock("convex/react", () => ({
    useQuery: () => null,
    useMutation: () => vi.fn(),
    useAction: () => vi.fn(),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: { _name: "currentUser" } },
        bugReports: {
            generateUploadUrl: { _name: "generateUploadUrl" },
            submitBugReport: { _name: "submitBugReport" },
        },
    },
}));

// #1764: the button used to reserve a hard-coded `bottom-32` on mobile, which
// sat correctly only for the portrait bottom bar's one-line state and let the
// grown (two-line, DECLARE_ATTACKERS) bar cover it. It also sat at `z-sheet`
// (50) — the SAME layer as the phase sheet — and, mounted at the router root
// AFTER the board, won DOM-order ties and painted over an open sheet, eating
// taps meant for the sheet's own controls.
describe("BugReportButton anchoring + z-order (issue #1764)", () => {
    it("anchors above the controller bar's MEASURED height, not a fixed inset", () => {
        const { getByRole } = render(<BugReportButton />);
        const button = getByRole("button", { name: "Report a bug" });
        expect(button.className).toContain("var(--controller-bar-h");
        expect(button.className).not.toContain("bottom-32");
    });

    it("sits below sheets/modals — above the board, not on top of a sheet", () => {
        const { getByRole } = render(<BugReportButton />);
        const button = getByRole("button", { name: "Report a bug" });
        expect(button.className).toContain("z-dev-overlay");
        expect(button.className).not.toContain("z-sheet");
        expect(button.className).not.toContain("z-modal");
    });

    it("stays bottom-right, never colliding with the left-anchored dev rail", () => {
        const { getByRole } = render(<BugReportButton />);
        const button = getByRole("button", { name: "Report a bug" });
        expect(button.className).not.toContain("left-");
    });

    // #1770 follow-up from #1802's review: the landscape-compact control
    // strip (#1769) docks to the right edge too, and a flat `right-3` used to
    // float the button underneath the strip's own Pass Turn button.
    it("anchors beside the landscape-compact control strip, not a flat inset", () => {
        const { getByRole } = render(<BugReportButton />);
        const button = getByRole("button", { name: "Report a bug" });
        expect(button.className).toContain(BESIDE_CONTROLLER_STRIP);
        // The seam's own `0px` fallback reproduces the old `right-3` (12px)
        // when no strip is mounted (portrait, desktop, lobby) — verified by
        // `BESIDE_CONTROLLER_STRIP`'s own module tests, not re-derived here.
        expect(button.className).not.toContain("right-3");
    });

    // #1770 second review round: `toContain(BESIDE_CONTROLLER_STRIP)` alone is
    // blind to a LATER-cascade override — a flat `md:right-4` sat alongside
    // the strip-aware anchor and won at md+ (Tailwind emits breakpoint
    // utilities after base ones), so the `contain` assertion above stayed
    // green while the button was dead in landscape-compact >=768px. Pin the
    // exact `md:right-*` / `md:bottom-*` utilities present so a mutation of
    // either (e.g. swapping in a competing flat inset, or corrupting the
    // sanctioned one) fails this test instead of sliding through unnoticed.
    it("carries no competing md: right/bottom utility beyond the sanctioned strip-aware anchor", () => {
        const { getByRole } = render(<BugReportButton />);
        const button = getByRole("button", { name: "Report a bug" });
        const classes = button.className.split(/\s+/).filter(Boolean);
        const mdRight = classes.filter((c) => /^md:right-/.test(c));
        const mdBottom = classes.filter((c) => /^md:bottom-/.test(c));
        expect(mdRight).toEqual([
            "md:right-[calc(var(--controller-strip-w,0px)+1rem)]",
        ]);
        expect(mdBottom).toEqual(["md:bottom-4"]);
    });
});
