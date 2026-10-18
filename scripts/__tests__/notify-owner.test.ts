import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    forgetNotice,
    lastNoticeKey,
    noticeDueAfter,
    notifyOnce,
} from "../lib/notify-owner";

/** `notifyOnce` (issue #5873): a job that fails on every push or every hour
 *  tells the owner once per distinct failure, and again after a green run. */
describe("notify-owner.ts — notifyOnce", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "notify-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("sends a key once, a new key at once, and the same key again after forgetNotice", () => {
        const marker = join(dir, "telemetry", "notice.json");
        // `sh -c true`: the notice goes nowhere; the marker is what is tested.
        const env = { TOLARIA_NOTIFY_CMD: "true" };
        expect(noticeDueAfter("a", null)).toBe(true);
        expect(notifyOnce(marker, "a", "msg a", "t", env)).toBe(true);
        expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({
            last: "a",
        });
        expect(lastNoticeKey(marker)).toBe("a");
        expect(notifyOnce(marker, "a", "msg a", "t", env)).toBe(false);
        expect(notifyOnce(marker, "b", "msg b", "t", env)).toBe(true);
        expect(lastNoticeKey(marker)).toBe("b");
        forgetNotice(marker);
        expect(lastNoticeKey(marker)).toBeNull();
        expect(notifyOnce(marker, "b", "msg b", "t", env)).toBe(true);
    });
});
