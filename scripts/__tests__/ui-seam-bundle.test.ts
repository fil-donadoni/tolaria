// The production-bundle scan behind `check:bundle`'s ui-seam row (issue
// #9271, ADR 0180), over a hand-built `dist/`. The real-build half — a
// production `vite build` with the DEV gate removed reds the row — is proven
// by hand in the PR (the build is minutes; this file is milliseconds).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UI_SEAM_MARKER } from "../../convex/lib/uiSeamNamespace";
import { uiSeamMarkerViolations } from "../lib/ui-seam-bundle";

let dist: string;

beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), "ui-seam-bundle-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<div id=root></div>");
    writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
});

afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
});

describe("uiSeamMarkerViolations (issue #9271)", () => {
    it("passes a dist with no seam marker", () => {
        expect(uiSeamMarkerViolations(dist)).toEqual([]);
    });

    it("names every script, stylesheet, page and map carrying the marker", () => {
        const line = `const p="/${UI_SEAM_MARKER}/echo",k="${UI_SEAM_MARKER}_echo";`;
        writeFileSync(join(dist, "assets", "router-x.js"), line);
        writeFileSync(join(dist, "assets", "router-x.js.map"), line);
        writeFileSync(
            join(dist, "index.html"),
            `<a href="/${UI_SEAM_MARKER}">`
        );
        expect(uiSeamMarkerViolations(dist)).toEqual([
            { file: "assets/router-x.js", count: 2 },
            { file: "assets/router-x.js.map", count: 2 },
            { file: "index.html", count: 1 },
        ]);
    });

    it("does not read card data", () => {
        writeFileSync(join(dist, "assets", "cards.json"), UI_SEAM_MARKER);
        expect(uiSeamMarkerViolations(dist)).toEqual([]);
    });
});
