// Offline banner (issue #2592, PRD #2405 D51). Drives the REAL
// `useConvexConnectionState` hook (convex/react) through a fake client that
// implements exactly the two members that hook reads —
// `connectionState()` / `subscribeToConnectionState()` — rather than mocking
// the hook itself. Mocking the hook would only prove the component reads
// whatever the mock hands it; wiring a fake CLIENT and mutating its state
// proves the subscription plumbing (ConvexProvider → context →
// useSyncExternalStore) actually reacts the way the app's real client would.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import type { ConnectionState } from "convex/browser";
import OfflineBanner from "../offline-banner";

afterEach(cleanup);

/** Minimal `connectionState()`/`subscribeToConnectionState()` pair — the only
 *  two `ConvexReactClient` members `useConvexConnectionState` reads. Kept as
 *  its own small class (rather than a `vi.fn()` stub) so `setState` can
 *  notify subscribers the same way the real client's connection-state
 *  transitions do. */
class FakeConvexClient {
    private state: ConnectionState;
    private listeners = new Set<() => void>();

    constructor(state: ConnectionState) {
        this.state = state;
    }

    connectionState(): ConnectionState {
        return this.state;
    }

    subscribeToConnectionState(cb: (state: ConnectionState) => void) {
        const listener = () => cb(this.state);
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    setState(next: ConnectionState) {
        this.state = next;
        for (const listener of this.listeners) listener();
    }
}

function connectionState(
    overrides: Partial<ConnectionState> = {}
): ConnectionState {
    return {
        hasInflightRequests: false,
        isWebSocketConnected: true,
        timeOfOldestInflightRequest: null,
        hasEverConnected: true,
        connectionCount: 1,
        connectionRetries: 0,
        inflightMutations: 0,
        inflightActions: 0,
        ...overrides,
    };
}

function renderWithClient(client: FakeConvexClient) {
    return render(
        <ConvexProvider client={client as unknown as ConvexReactClient}>
            <OfflineBanner />
        </ConvexProvider>
    );
}

describe("OfflineBanner (issue #2592)", () => {
    it("renders nothing while connected", () => {
        const client = new FakeConvexClient(connectionState());
        renderWithClient(client);
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("renders nothing before the FIRST connect (loading, not offline)", () => {
        const client = new FakeConvexClient(
            connectionState({
                isWebSocketConnected: false,
                hasEverConnected: false,
            })
        );
        renderWithClient(client);
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("appears when the socket drops after having connected", () => {
        const client = new FakeConvexClient(connectionState());
        renderWithClient(client);
        expect(screen.queryByRole("status")).toBeNull();

        act(() => {
            client.setState(
                connectionState({
                    isWebSocketConnected: false,
                    hasEverConnected: true,
                    connectionRetries: 1,
                })
            );
        });

        const banner = screen.getByRole("status");
        expect(banner.textContent).toContain("Offline");
    });

    it("disappears again once the socket reconnects", () => {
        const client = new FakeConvexClient(
            connectionState({ isWebSocketConnected: false })
        );
        renderWithClient(client);
        expect(screen.getByRole("status")).not.toBeNull();

        act(() => {
            client.setState(connectionState({ isWebSocketConnected: true }));
        });

        expect(screen.queryByRole("status")).toBeNull();
    });
});
