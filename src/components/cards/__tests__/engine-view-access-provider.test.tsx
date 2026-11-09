// Engine view is admin-only (issue #7430): the provider resolves
// `canViewEngineView` from the current user once for the app shell.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import EngineViewAccessProvider from "../engine-view-access-provider";
import { useCanViewEngineView } from "~/hooks/engineViewAccessContext";

let mockUser: { isAdmin?: boolean } | null | undefined;
vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => mockUser,
}));

function Probe() {
    return <span data-can={String(useCanViewEngineView())} />;
}

function read(): string | null | undefined {
    const { container } = render(
        <EngineViewAccessProvider>
            <Probe />
        </EngineViewAccessProvider>
    );
    return container.querySelector("span")?.getAttribute("data-can");
}

afterEach(cleanup);

describe("EngineViewAccessProvider (issue #7430)", () => {
    it("grants an admin", () => {
        mockUser = { isAdmin: true };
        expect(read()).toBe("true");
    });
    it("denies a non-admin, a signed-out viewer and a loading query", () => {
        for (const u of [{ isAdmin: false }, null, undefined]) {
            mockUser = u;
            expect(read()).toBe("false");
            cleanup();
        }
    });
});
