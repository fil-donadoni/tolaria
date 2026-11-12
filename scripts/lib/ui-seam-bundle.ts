/**
 * The production half of the `check:ui` seam's client gate (issue #9271,
 * ADR 0179): no built asset may carry the seam namespace's marker.
 *
 * The router registers the seam's routes behind `import.meta.env.DEV`, which
 * `vite build` inlines as `false`, so the branch and the whole seam module are
 * dead-code eliminated. Every seam spelling — route prefix, parameter prefix,
 * the namespace constants themselves — derives from `UI_SEAM_MARKER`, so the
 * marker occurring in ANY emitted script, stylesheet, page or source map means
 * seam code survived into production: the gate was removed, or an ordinary
 * module imported the namespace. Run by `bun run check:bundle` on the real
 * build (HEALTH_ONLY: the build is the cost, the scan is milliseconds).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { UI_SEAM_MARKER } from "../../convex/lib/uiSeamNamespace";

/** Emitted text a seam module could survive into. Card data (`.json`) cannot
 *  carry code and is the bulk of `dist/`, so it is not read. */
const SCANNED_EXTENSIONS = [".js", ".mjs", ".css", ".html", ".map"];

export interface UiSeamBundleViolation {
    /** Path relative to the scanned directory. */
    file: string;
    /** Occurrences of the marker in it. */
    count: number;
}

export function uiSeamMarkerViolations(
    distDir: string,
    marker: string = UI_SEAM_MARKER
): UiSeamBundleViolation[] {
    const out: UiSeamBundleViolation[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
                continue;
            }
            if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
                continue;
            }
            const count = readFileSync(path, "utf8").split(marker).length - 1;
            if (count > 0) out.push({ file: relative(distDir, path), count });
        }
    };
    walk(distDir);
    return out.sort((a, b) => a.file.localeCompare(b.file));
}
