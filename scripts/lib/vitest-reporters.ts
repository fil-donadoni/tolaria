/**
 * The run's `reporters` key: vitest's own unless a sidecar asks for a slot.
 * Health's duration file (`vitest-duration-reporter.ts`) sits beside the
 * default reporter when `TOLARIA_TEST_DURATIONS_DIR` is set; Mergify CI
 * Insights' reporter (`@mergifyio/vitest`) when `MERGIFY_TOKEN` is — it also
 * installs a setup file in every project (quarantine, test selection), so no
 * run without the token loads it. With neither, the key is absent and vitest
 * picks its reporter itself (`agent` under an agent).
 */
import MergifyReporter from "@mergifyio/vitest";
import { isAgent } from "std-env";
import type { Reporter } from "vitest/node";
import { durationReporterOption } from "./vitest-duration-reporter";

export function reporterOption(env: NodeJS.ProcessEnv): {
    reporters?: (string | Reporter)[];
} {
    const base = durationReporterOption(env).reporters;
    if (!env.MERGIFY_TOKEN) return base ? { reporters: base } : {};
    return {
        reporters: [
            ...(base ?? [isAgent ? "agent" : "default"]),
            new MergifyReporter(),
        ],
    };
}
