// `/admin/bot-findings` — the tab switch (ADR 0141, issue #4177): Cards is
// the default tab; Classes renders once selected, and only one panel is on
// screen at a time.
//
// Assertions read `aria-selected` via `.getAttribute` rather than jest-dom's
// `toHaveAttribute` — `tsconfig.app.json`'s restricted `types` array doesn't
// pick up jest-dom's type augmentation (see `segmented-control.test.tsx`).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BotFindingsAdminPanel from "../bot-findings-admin-panel";

const answers: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }) => answers[query._name],
    useMutation: () => () => Promise.resolve(null),
}));

vi.mock("@convex/_generated/api", () => {
    const leaf = (name: string): unknown =>
        new Proxy(
            { _name: name },
            {
                get: (target, prop) =>
                    prop === "_name" || typeof prop === "symbol"
                        ? Reflect.get(target, prop)
                        : leaf(String(prop)),
            }
        );
    return { api: leaf("") };
});

// The launcher is the same hook `/admin/scenarios` uses (issue #4178); its
// own behaviour is pinned by its tests, this page only mounts it.
vi.mock("~/hooks/useScenarioTestGame", () => ({
    useScenarioTestGame: () => ({
        test: vi.fn(),
        launchingId: null,
        error: null,
        clearError: vi.fn(),
        blockingActiveGame: null,
        cancelBlockingActiveGame: vi.fn(),
        resolveBlockingActiveGame: vi.fn(),
        resolvingActiveGame: false,
    }),
}));

beforeEach(() => {
    answers.listFindings = [];
    answers.listClasses = [];
    answers.latestMeasurement = null;
    answers.listDebugScenarios = [];
});

describe("BotFindingsAdminPanel — the tab switch", () => {
    it("shows the Cards panel by default, and Classes is not rendered", () => {
        render(<BotFindingsAdminPanel />);
        expect(
            screen
                .getByRole("tab", { name: "Cards" })
                .getAttribute("aria-selected")
        ).toBe("true");
        expect(screen.getByText("No findings on this deployment")).toBeTruthy();
        expect(
            screen.queryByText("No Bot Gap classes on this deployment")
        ).toBeNull();
    });

    it("switches to the Classes panel on click, replacing the Cards panel", () => {
        render(<BotFindingsAdminPanel />);
        fireEvent.click(screen.getByRole("tab", { name: "Classes" }));
        expect(
            screen
                .getByRole("tab", { name: "Classes" })
                .getAttribute("aria-selected")
        ).toBe("true");
        expect(
            screen.getByText("No Bot Gap classes on this deployment")
        ).toBeTruthy();
        expect(screen.queryByText("No findings on this deployment")).toBeNull();
    });

    it("raises the ready marker once every query answered, and keeps it across a tab switch", () => {
        answers.latestMeasurement = undefined;
        const { container, rerender } = render(<BotFindingsAdminPanel />);
        expect(container.querySelector("[data-surface-ready]")).toBeNull();
        answers.latestMeasurement = null;
        rerender(<BotFindingsAdminPanel />);
        expect(container.querySelectorAll("[data-surface-ready]")).toHaveLength(
            1
        );
        fireEvent.click(screen.getByRole("tab", { name: "Classes" }));
        expect(container.querySelectorAll("[data-surface-ready]")).toHaveLength(
            1
        );
    });
});
