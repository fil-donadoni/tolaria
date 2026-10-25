// The shared overflow-popover navigation row (issue #3681, ADR 0103 §5): the
// 44px `--menu-row-h` floor that AppContextBar, the Draft Room bar and the
// Admin menu all route through. Modelled on the `ContextMenu` row test.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        children,
        className,
        onClick,
    }: {
        to: string;
        children: React.ReactNode;
        className?: string;
        onClick?: () => void;
    }) => (
        <a href={to} className={className} onClick={onClick}>
            {children}
        </a>
    ),
}));

import OverflowNavLink from "../overflow-nav-link";

afterEach(cleanup);

describe("OverflowNavLink (ADR 0103 §5 — 44px row floor)", () => {
    it("carries the --menu-row-h min-height floor", () => {
        render(<OverflowNavLink to="/">Home</OverflowNavLink>);
        expect(screen.getByText("Home").className).toContain(
            "min-h-[var(--menu-row-h)]"
        );
    });

    it("keeps a caller className beside the floor", () => {
        render(
            <OverflowNavLink to="/" className="extra">
                Home
            </OverflowNavLink>
        );
        const cls = screen.getByText("Home").className;
        expect(cls).toContain("extra");
        expect(cls).toContain("min-h-[var(--menu-row-h)]");
    });
});
