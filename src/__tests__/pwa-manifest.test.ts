// PWA installability guard (issue #2594) — Lighthouse's "installable
// manifest" audit (and iOS home-screen add-to-homescreen) both read the same
// handful of fields: name/short_name, a start_url, standalone display, icons
// covering 192/512 with an "any" purpose alongside "maskable" (a
// maskable-only icon set fails the icon check in some Lighthouse versions —
// #2594 site map), and (for standalone launch to feel native rather than a
// bookmarked tab) `apple-mobile-web-app-capable` / `mobile-web-app-capable`
// in `index.html`. jsdom/happy-dom never load `index.html` or fetch the
// manifest, so this is a plain text/JSON read (same pattern as
// `design-tokens.test.ts`'s stylesheet parse).
//
// The trap this guards against: the issue's own target-file list names
// `public/manifest.webmanifest` as new, but a working manifest already
// existed at `public/site.webmanifest`, linked from `index.html`. Shipping a
// SECOND manifest file would silently orphan one of them — this guard pins
// the existing filename and refuses a duplicate.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

describe("PWA manifest (issue #2594)", () => {
    const manifestPath = resolve(REPO_ROOT, "public", "site.webmanifest");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    it("does not ship a second manifest.webmanifest", () => {
        expect(
            existsSync(resolve(REPO_ROOT, "public", "manifest.webmanifest"))
        ).toBe(false);
    });

    it("has the fields Lighthouse's installable-manifest audit reads", () => {
        expect(manifest.name).toBe("Tolaria");
        expect(manifest.short_name).toBe("Tolaria");
        expect(manifest.display).toBe("standalone");
        expect(manifest.start_url).toBe("/");
        expect(manifest.scope).toBe("/");
        expect(manifest.id).toBeTruthy();
        expect(manifest.theme_color).toBeTruthy();
        expect(manifest.background_color).toBeTruthy();
    });

    it("has a 192px and a 512px icon, each covering purpose 'any'", () => {
        const icons: Array<{ sizes: string; purpose?: string }> =
            manifest.icons;
        for (const size of ["192x192", "512x512"]) {
            const icon = icons.find((i) => i.sizes === size);
            expect(icon, `missing a ${size} icon`).toBeTruthy();
            const purposes = (icon!.purpose ?? "any").split(/\s+/);
            expect(
                purposes.includes("any"),
                `${size} icon must cover purpose "any" (found "${icon!.purpose}") — maskable-only fails Lighthouse's icon check`
            ).toBe(true);
        }
    });

    it("index.html links exactly one manifest, the existing site.webmanifest", () => {
        const html = readFileSync(resolve(REPO_ROOT, "index.html"), "utf8");
        const manifestLinks =
            html.match(/rel="manifest"[^>]*href="([^"]+)"/g) ?? [];
        expect(manifestLinks.length).toBe(1);
        expect(manifestLinks[0]).toMatch(/href="\/site\.webmanifest"/);
    });

    it("index.html declares standalone-capable + theme-color meta tags", () => {
        const html = readFileSync(resolve(REPO_ROOT, "index.html"), "utf8");
        expect(html).toMatch(
            /<meta name="apple-mobile-web-app-capable" content="yes" \/>/
        );
        expect(html).toMatch(
            /<meta name="mobile-web-app-capable" content="yes" \/>/
        );
        expect(html).toMatch(/<meta name="theme-color" content="#9491a8" \/>/);
    });

    it("index.html's viewport meta sets viewport-fit=cover — the precondition every env(safe-area-inset-*) in the app depends on (issue #2594)", () => {
        const html = readFileSync(resolve(REPO_ROOT, "index.html"), "utf8");
        const viewportMeta = html.match(
            /<meta\s+name="viewport"\s+content="([^"]+)"/
        );
        expect(viewportMeta).toBeTruthy();
        expect(viewportMeta![1]).toContain("viewport-fit=cover");
    });
});
