// The Draft Room bar shares AppContextBar's frame (issue #3682): the same
// safe-area-folded band and `short-viewport:` compact band, and its
// Table / Pool / More controls take --control-h-xs on a landscape phone.
// Class-shape coverage only — happy-dom resolves no calc()/env() (see
// `app-context-bar.test.tsx` header); the pixel proof is the check:ui receipt.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        children,
        ...props
    }: React.PropsWithChildren<{ to?: string } & Record<string, unknown>>) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

import LimitedDraftBar from "../limited-draft-bar";
import AppContextBar from "@/components/chrome/app-context-bar";

afterEach(() => cleanup());

function renderBar() {
    return render(
        <LimitedDraftBar
            eventId="e1"
            title="Draft"
            pack={null}
            poolVisible={false}
            onTogglePool={() => {}}
            onOpenTable={() => {}}
        />
    );
}

const classesOf = (el: Element) => el.className.split(/\s+/);

describe("LimitedDraftBar — shared frame (issue #3682)", () => {
    it("carries the same band classes as AppContextBar and no fixed height", () => {
        const draft = renderBar().container.querySelector(
            '[data-slot="draft-room-bar"]'
        )!;
        cleanup();
        const context = render(
            <AppContextBar title="Edit deck" exitTo="/x" />
        ).container.querySelector('[data-slot="app-context-bar"]')!;
        const draftClasses = classesOf(draft);
        for (const c of classesOf(context).filter((c) =>
            /min-h-|pt-\[env|bg-surface|border-/.test(c)
        )) {
            expect(draftClasses).toContain(c);
        }
        expect(draftClasses.some((c) => /^(?:[a-z-]+:)*h-\d/.test(c))).toBe(
            false
        );
    });

    it("Table, Pool and More drop to --control-h-xs under short-viewport", () => {
        const { container, getByRole } = renderBar();
        const controls = [
            container.querySelector("[data-draft-table-entry]")!,
            container.querySelector("[data-draft-pool-toggle]")!,
            getByRole("button", { name: "More" }),
        ];
        for (const el of controls) {
            const classes = classesOf(el);
            expect(classes).toContain("min-h-[var(--control-h)]");
            expect(classes).toContain(
                "short-viewport:min-h-[var(--control-h-xs)]"
            );
        }
    });
});
