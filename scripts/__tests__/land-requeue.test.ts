import { describe, expect, it } from "vitest";
import {
    lastDequeueAt,
    needsDequeueRequeue,
    readBackVerdict,
} from "../lib/land-requeue";

const comment = (login: string, body: string, createdAt: string) => ({
    author: { login },
    body,
    createdAt,
});

describe("lastDequeueAt (issue #6163)", () => {
    it("takes the newest Mergify dequeue comment, ignoring others", () => {
        expect(
            lastDequeueAt([
                comment(
                    "mergify",
                    "**merge queue: dequeued**",
                    "2026-10-20T10:00:00Z"
                ),
                comment("someone", "dequeued?", "2026-10-20T12:00:00Z"),
                comment(
                    "mergify",
                    "merge queue: dequeued again",
                    "2026-10-20T11:00:00Z"
                ),
            ])
        ).toBe("2026-10-20T11:00:00Z");
        expect(lastDequeueAt([])).toBeNull();
    });
});

describe("needsDequeueRequeue (issue #6163)", () => {
    const base = {
        toQueue: true,
        lastDequeueAt: "2026-10-20T11:00:00Z",
        headCommittedAt: "2026-10-20T10:00:00Z",
    };
    it("requeues a queue PR dequeued after its head was committed", () => {
        expect(needsDequeueRequeue(base)).toBe(true);
    });
    it("does not when the head is newer than the dequeue, none happened, or the owner merges", () => {
        expect(
            needsDequeueRequeue({
                ...base,
                headCommittedAt: "2026-10-20T12:00:00Z",
            })
        ).toBe(false);
        expect(needsDequeueRequeue({ ...base, lastDequeueAt: null })).toBe(
            false
        );
        expect(needsDequeueRequeue({ ...base, toQueue: false })).toBe(false);
    });
});

describe("readBackVerdict (issue #6163)", () => {
    it("reads land-failed as failure, queued as success, else pending", () => {
        expect(readBackVerdict(["land-failed"])).toBe("relabelled-failed");
        expect(readBackVerdict(["ready-to-land", "queued"])).toBe("queued");
        expect(readBackVerdict(["ready-to-land"])).toBe("pending");
    });
});
