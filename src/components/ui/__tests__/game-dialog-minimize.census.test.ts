// Issue #6984 — EVERY dialog offers minimize, mechanically. The affordance is
// built into `GameDialog` (default on, no opt-out prop); this census keeps it
// that way: a dialog can only skip it by bypassing `GameDialog` (a raw
// `DialogContent` / base-ui dialog primitive) or by growing an opt-out.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../..");

/** Files allowed to touch the dialog primitives directly: the primitive, the
 *  one wrapper that adds minimize, the command palette (a search surface, not
 *  a dialog) and the design-system catalogue page. */
const PRIMITIVE_ALLOWLIST = [
    "components/ui/dialog.tsx",
    "components/ui/game-dialog.tsx",
    "components/ui/command.tsx",
    // side drawer primitive (the debug sheet), not a modal dialog
    "components/ui/sheet.tsx",
    "routes/design-system/sections-panels-dialogs.tsx",
];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory())
            return name === "__tests__" ? [] : sourceFiles(p);
        return /\.tsx$/.test(name) ? [p] : [];
    });
}

const files = sourceFiles(SRC).map((p) => ({
    rel: p.slice(SRC.length + 1),
    text: readFileSync(p, "utf8"),
}));

describe("every dialog can minimize (issue #6984)", () => {
    it("no component renders a dialog primitive outside GameDialog", () => {
        const offenders = files
            .filter(
                (f) =>
                    !PRIMITIVE_ALLOWLIST.includes(f.rel) &&
                    /<DialogContent\b|react\/dialog"|ui\/dialog"/.test(f.text)
            )
            .map((f) => f.rel);
        expect(offenders).toEqual([]);
    });

    it("GameDialog renders its minimize control unconditionally", () => {
        const game = files.find(
            (f) => f.rel === "components/ui/game-dialog.tsx"
        )!;
        expect(game.text).toContain("onClick={minimize}");
        // no opt-out prop, and the control is not gated on a prop
        expect(game.text).not.toMatch(/minimiz(e|able)\??:\s*(boolean|false)/i);
        expect(game.text).not.toMatch(/\{\s*onMinimize\s*&&/);
    });
});
