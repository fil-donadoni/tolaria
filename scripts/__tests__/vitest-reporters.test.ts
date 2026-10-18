import MergifyReporter from "@mergifyio/vitest";
import { describe, expect, it } from "vitest";
import { DurationReporter } from "../lib/vitest-duration-reporter";
import { reporterOption } from "../lib/vitest-reporters";
import { DURATIONS_ENV } from "../lib/test-headroom";

describe("reporterOption — sidecar reporters only when their env var asks", () => {
    it("leaves the key absent with neither var, so vitest picks its own", () => {
        expect(reporterOption({})).toEqual({});
    });

    it("adds the Mergify reporter only under MERGIFY_TOKEN", () => {
        const reporters =
            reporterOption({ MERGIFY_TOKEN: "t" }).reporters ?? [];
        expect(reporters.some((r) => r instanceof MergifyReporter)).toBe(true);
        expect(reporters).toHaveLength(2);
    });

    it("keeps the duration reporter beside Mergify's when both are set", () => {
        const reporters =
            reporterOption({ MERGIFY_TOKEN: "t", [DURATIONS_ENV]: "/tmp/d" })
                .reporters ?? [];
        expect(reporters.some((r) => r instanceof DurationReporter)).toBe(true);
        expect(reporters.some((r) => r instanceof MergifyReporter)).toBe(true);
        expect(reporters).toHaveLength(3);
    });
});
