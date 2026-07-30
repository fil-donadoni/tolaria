// Guard: every page route names the tab.
//
// The title is set per page (`useDocumentTitle`) rather than by one effect
// over the matched routes — see the hook's comment for why a shell-level
// effect always loses the race against a page's dynamic name. The cost of
// that choice is that a NEW route can silently inherit whatever title the
// previous page left behind, which is exactly the "always says Tolaria" bug
// this shipped to fix. This sweep pays that cost once, catalogue-wide.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.resolve(__dirname, "..");

// Layout routes render nothing but an `Outlet` — the page inside names the
// tab. Adding a file here means asserting it is NOT a page.
const LAYOUT_ROUTES = new Set(["admin/admin-layout.route.tsx"]);

// A route satisfies the guard by calling the hook itself, or by rendering a
// frame that owns the title for a whole section (`AdminPageFrame` receives the
// page's name already).
const TITLE_MARKERS = ["useDocumentTitle(", "AdminPageFrame"];

function routeFiles(dir: string, prefix = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (entry.name === "__tests__") return [];
            return routeFiles(path.join(dir, entry.name), rel);
        }
        return entry.name.endsWith(".route.tsx") ? [rel] : [];
    });
}

describe("document title coverage", () => {
    const files = routeFiles(ROUTES_DIR).filter((f) => !LAYOUT_ROUTES.has(f));

    it("finds the route files to sweep", () => {
        // A broken glob would make every assertion below vacuously pass.
        expect(files.length).toBeGreaterThan(8);
    });

    it.each(files)("%s sets a document title", (file) => {
        const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");
        const named = TITLE_MARKERS.some((marker) => source.includes(marker));
        expect(
            named,
            `${file} sets no document title — call useDocumentTitle("<page>") ` +
                `(or render AdminPageFrame), or add it to LAYOUT_ROUTES if it ` +
                `is a layout route with no page identity of its own.`
        ).toBe(true);
    });

    it("keeps every LAYOUT_ROUTES entry a real file", () => {
        const all = new Set(routeFiles(ROUTES_DIR));
        for (const layout of LAYOUT_ROUTES) expect(all.has(layout)).toBe(true);
    });
});
