import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
    noteResident,
    residencyVersion,
    subscribeResidency,
} from "../residency";

/**
 * Issue #9822: the verdict quiz makes every hand-written Set resident at once,
 * and the installs settle one microtask after another. One synchronous
 * fan-out per Set forced one SYNC re-render of each `useSyncExternalStore`
 * subscriber; with a subscriber whose effect schedules an update on the new
 * version, every such commit left that update pending and React counted it
 * as nested — the 51st threw "Maximum update depth exceeded" (#185) out of the
 * install's `Promise.all`, and the quiz refused with `builder-threw`.
 */

/** A residency reader shaped like the board's: reads the version as an
 *  external store, and an effect keyed on it publishes ordinary state. */
function Reader({ onSeen }: { onSeen: (v: number) => void }) {
    const version = useSyncExternalStore(
        subscribeResidency,
        residencyVersion,
        residencyVersion
    );
    const [seen, setSeen] = useState(-1);
    useEffect(() => {
        // The hazard's shape, on purpose: an effect publishing state off the
        // new version is what leaves an update pending at each sync commit.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSeen(version);
    }, [version]);
    useEffect(() => {
        onSeen(seen);
    }, [seen, onSeen]);
    return <p>{seen}</p>;
}

/** `count` installs settling in one task, each a few microtask hops after the
 *  previous — the shape of `Promise.all` over a burst of Set chunks. */
function settleInstallBurst(count: number): Promise<void[]> {
    return Promise.all(
        Array.from({ length: count }, async (_, i) => {
            for (let hop = 0; hop < i * 3; hop++) await null;
            noteResident();
        })
    );
}

afterEach(() => {
    cleanup();
});

describe("residency notification (issue #9822)", () => {
    it("a burst of ~180 Sets becoming resident never trips React's nested-update guard", async () => {
        let last = -1;
        render(<Reader onSeen={(v) => (last = v)} />);
        const before = residencyVersion();

        await expect(settleInstallBurst(180)).resolves.toHaveLength(180);

        // Every change is counted at once; the reader catches up to the last.
        expect(residencyVersion()).toBe(before + 180);
        await waitFor(() => expect(last).toBe(before + 180));
    });

    it("tells a subscriber once per task, after the burst", async () => {
        let calls = 0;
        const unsubscribe = subscribeResidency(() => calls++);
        try {
            await settleInstallBurst(20);
            expect(calls).toBe(0);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(calls).toBe(1);
        } finally {
            unsubscribe();
        }
    });
});
