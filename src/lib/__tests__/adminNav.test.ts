// `ADMIN_NAV` is rendered by two surfaces (the header's Admin menu and the
// `/admin` index) but the ROUTES it points at are declared separately in
// `src/router.tsx`. A typo in either place is a dead link that type-checking
// can't see — TanStack's `to` is a string here — and that nobody notices until
// they click it. This test ties the two together.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ADMIN_NAV } from "../adminNav";

const ROUTER_SOURCE = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "router.tsx"),
    "utf-8"
);

describe("ADMIN_NAV", () => {
    it("is non-empty and free of duplicate paths", () => {
        expect(ADMIN_NAV.length).toBeGreaterThan(0);
        const paths = ADMIN_NAV.map((e) => e.to);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it("every entry lives under /admin/", () => {
        for (const entry of ADMIN_NAV) {
            expect(entry.to.startsWith("/admin/")).toBe(true);
        }
    });

    it("every entry has a route declared under the admin parent", () => {
        for (const entry of ADMIN_NAV) {
            const segment = entry.to.slice("/admin/".length);
            // Child routes of `adminRoute` are declared with a RELATIVE path
            // (`path: "banlists"`), so the segment is what to look for.
            expect(
                ROUTER_SOURCE.includes(`path: "${segment}"`),
                `ADMIN_NAV points at ${entry.to} but src/router.tsx declares no admin child route with path "${segment}"`
            ).toBe(true);
        }
    });

    it("every entry carries a label and a description", () => {
        for (const entry of ADMIN_NAV) {
            expect(entry.label.trim().length).toBeGreaterThan(0);
            expect(entry.description.trim().length).toBeGreaterThan(0);
        }
    });

    it("every admin child route is reachable from the menu", () => {
        // The converse of the check above, and the one that actually catches
        // the common regression: adding a page to the router and forgetting to
        // list it. `/admin` itself (the index, `path: "/"`) is excluded — it is
        // the page the list is ON.
        const adminSection = ROUTER_SOURCE.slice(
            ROUTER_SOURCE.indexOf("const adminRoute =")
        );
        const declared = [
            ...adminSection.matchAll(
                /getParentRoute: \(\) => adminRoute,\s*\n\s*path: "([^"]+)"/g
            ),
        ]
            .map((m) => m[1])
            .filter((p) => p !== "/");
        expect(declared.length).toBeGreaterThan(0);
        const listed = new Set(
            ADMIN_NAV.map((e) => e.to.slice("/admin/".length))
        );
        for (const segment of declared) {
            expect(
                listed.has(segment),
                `/admin/${segment} is routed but missing from ADMIN_NAV, so nothing links to it`
            ).toBe(true);
        }
    });
});
