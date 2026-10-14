import { Component, Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
    loadCatalogueGate,
    prefetchCatalogueGate,
    resetCatalogueGateForTests,
    type CatalogueGateComponent,
} from "~/lib/catalogueGateLoader";
import CatalogueGateFrame from "../catalogue-gate-frame";

// Issue #5584: once the Setup flow's prefetch has loaded the gate's chunk,
// mounting the gate (Start match) must not suspend — a suspended boundary
// shows "Loading cards..." for React's fallback throttle although nothing is
// left to load. Measured on a production build: 0.87 s and a loading screen
// with `React.lazy`, against 0.33 s before the Setup flow became light.

const Gate: CatalogueGateComponent = ({
    children,
}: {
    children: ReactNode;
}) => <div data-testid="gate">{children}</div>;

function deferred() {
    let resolve!: (gate: CatalogueGateComponent) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<CatalogueGateComponent>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

afterEach(() => {
    cleanup();
    resetCatalogueGateForTests();
    vi.restoreAllMocks();
});

/** Stands in for the router's error component. */
class Boundary extends Component<
    { children: ReactNode },
    { error: Error | null }
> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        return this.state.error ? (
            <p>error: {this.state.error.message}</p>
        ) : (
            this.props.children
        );
    }
}

const frame = () => (
    <Suspense fallback={<p>fallback</p>}>
        <CatalogueGateFrame mode="whole">
            <p>child</p>
        </CatalogueGateFrame>
    </Suspense>
);

describe("CatalogueGateFrame", () => {
    it("renders the gate on the first frame once its chunk is loaded", async () => {
        await loadCatalogueGate(async () => Gate);
        render(frame());
        // Synchronously: no fallback in between.
        expect(screen.getByTestId("gate").textContent).toBe("child");
        expect(screen.queryByText("fallback")).toBeNull();
    });

    it("suspends to the boundary while the chunk is still loading", async () => {
        const chunk = deferred();
        loadCatalogueGate(() => chunk.promise);
        // A render that suspends is awaited inside `act` (React 19).
        await act(async () => {
            render(frame());
        });
        expect(screen.getByText("fallback")).toBeTruthy();
        expect(screen.queryByTestId("gate")).toBeNull();
        await act(async () => {
            chunk.resolve(Gate);
            await chunk.promise;
        });
        expect(screen.getByTestId("gate").textContent).toBe("child");
    });
});

describe("loadCatalogueGate", () => {
    it("is one promise, tagged fulfilled with the component once loaded", async () => {
        const first = loadCatalogueGate(async () => Gate);
        expect(loadCatalogueGate()).toBe(first);
        await first;
        if (first.status !== "fulfilled") throw new Error(String(first.status));
        expect(first.value).toBe(Gate);
    });

    it("memoises a failure on the render path, as React.lazy does", async () => {
        const chunk = deferred();
        const failed = loadCatalogueGate(() => chunk.promise);
        chunk.reject(new Error("chunk 404"));
        await expect(failed).rejects.toThrow("chunk 404");
        expect(failed.status).toBe("rejected");
        expect(loadCatalogueGate(async () => Gate)).toBe(failed);
    });

    it("a failed chunk reaches the error boundary after ONE load — never a loading loop", async () => {
        const chunk = deferred();
        let loads = 0;
        loadCatalogueGate(() => {
            loads++;
            return chunk.promise;
        });
        vi.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => {
            render(<Boundary>{frame()}</Boundary>);
        });
        expect(screen.getByText("fallback")).toBeTruthy();
        await act(async () => {
            chunk.reject(new Error("chunk 404"));
            await chunk.promise.catch(() => {});
        });
        expect(screen.getByText("error: chunk 404")).toBeTruthy();
        expect(loads).toBe(1);
    });
});

describe("prefetchCatalogueGate", () => {
    it("installs the loaded gate, so the first render does not suspend", async () => {
        await prefetchCatalogueGate(async () => Gate);
        render(frame());
        expect(screen.getByTestId("gate").textContent).toBe("child");
    });

    it("a failed prefetch leaves nothing behind: the render loads the gate again", async () => {
        await prefetchCatalogueGate(() => Promise.reject(new Error("offline")));
        const next = loadCatalogueGate(async () => Gate);
        await expect(next).resolves.toBe(Gate);
    });
});
