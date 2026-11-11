import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONVEX_BACKEND_ENV } from "../lib/convex-backend-env";

// Issue #9105: the local backend's knobs live in ONE table; `convex:ensure`
// spawns with it (covered in convex-ensure.test.ts), and the two service
// templates that own the backend on the runner machines must carry every
// entry verbatim — a template that drifts runs the binary's default (14 days
// of document history) and the sqlite file grows without bound again.
const unit = (file: string) =>
    readFileSync(`scripts/runner-units/${file}`, "utf8");

describe("CONVEX_BACKEND_ENV reaches every service template", () => {
    const entries = Object.entries(CONVEX_BACKEND_ENV);

    it("is not empty", () => {
        expect(entries.length).toBeGreaterThan(0);
    });

    it.each(entries)("launchd agent sets %s=%s", (key, value) => {
        expect(unit("com.tolaria.convex.plist")).toContain(
            `<key>${key}</key>\n        <string>${value}</string>`
        );
    });

    it.each(entries)("systemd unit sets %s=%s", (key, value) => {
        expect(unit("tolaria-convex.service")).toMatch(
            new RegExp(`^Environment=${key}=${value}$`, "m")
        );
    });
});
