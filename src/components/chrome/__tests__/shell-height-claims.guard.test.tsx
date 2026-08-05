// Issue #2274 — repo-wide guards for the AppShell scroll contract.
//
// Two invariants, both of which used to be prose in `app-shell.tsx`'s comment
// block ("every existing `position: sticky` header already lives inside its OWN
// nested `overflow-y-auto` panel") and therefore could not fail:
//
//  1. NO component rendered under the shared header may claim a WHOLE viewport
//     height. `<main>` is only the viewport MINUS the header band, so an
//     `h-dvh`/`h-screen` below it overflows by exactly the band — at every
//     height, which is why a browser pass taken only under 300px never saw it.
//     Allowlist: the shell root (which IS the bound) plus the `/game` surfaces,
//     for which `shellShowsHeader()` is false — asserted here, not asserted by
//     hand.
//
//  2. Every `position: sticky` element sits inside its OWN nested scroller (or
//     a portaled overlay), never against the app-level scroller `<main>` — the
//     one that MOVED in #2056. A sticky header pinned to a scroller that is no
//     longer the one its content scrolls in is the classic symptom of exactly
//     this kind of relocation.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render } from "@testing-library/react";
import { shellShowsHeader } from "@/lib/shellChrome";
import { VIEWPORT_HEIGHT_CLASSES } from "@/lib/shellLayout";
import GameDialog from "@/components/ui/game-dialog";

const SRC_ROOT = resolve(__dirname, "../../..");

function walkSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "__tests__" || entry === "node_modules") continue;
            walkSourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** Strip comments so a class name discussed in prose is not read as a claim. */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The one file excluded from the scan: it DEFINES the vocabulary the scan
 * looks for (`VIEWPORT_HEIGHT_CLASSES`), so matching itself is not a claim. It
 * is not on the allowlist because the allowlist's entries carry a
 * "renders under no header" premise this file has no route to check.
 */
const SCAN_EXCLUDE = new Set(["lib/shellLayout.ts"]);

const SOURCE_FILES = walkSourceFiles(SRC_ROOT).map((path) => ({
    path,
    rel: relative(SRC_ROOT, path).replaceAll("\\", "/"),
    raw: readFileSync(path, "utf8"),
    get code() {
        return stripComments(readFileSync(path, "utf8"));
    },
}));

// ────────────────────────────────────────────────────────────────────────────
// Guard 1 — no whole-viewport height claim under the shared header
// ────────────────────────────────────────────────────────────────────────────

/**
 * The only files allowed to claim a whole viewport height, each with the reason
 * it is exempt. `routePath`, where given, is checked against `shellShowsHeader`
 * so the exemption's premise ("this never renders under the header") is
 * verified rather than asserted.
 */
const VIEWPORT_HEIGHT_ALLOWLIST: Record<
    string,
    { why: string; routePath?: string }
> = {
    "components/chrome/app-shell.tsx": {
        why: "The shell root IS the hard bound the rest of the contract needs (issue #2056 defect 3).",
    },
    "routes/game.route.tsx": {
        why: "The board is the fullscreen play surface — no shared header, so `<main>` IS the viewport.",
        routePath: "/game/abc123",
    },
    "components/board/manual-board.tsx": {
        why: "Board-only machinery, reachable solely from `/game` (out of scope per issue #2274).",
        routePath: "/game/abc123",
    },
    "components/board/waiting-for-opponent.tsx": {
        why: "Rendered only by `game.route.tsx` while an opponent is awaited — `/game`, no header band.",
        routePath: "/game/abc123",
    },
};

const VIEWPORT_CLAIM_RE = new RegExp(
    `(?<![\\w-])(?:${VIEWPORT_HEIGHT_CLASSES.join("|")})(?![\\w-])|height:\\s*["'\`]?100d?vh`
);

function filesClaimingAViewportHeight(): string[] {
    return SOURCE_FILES.filter(
        (f) => !SCAN_EXCLUDE.has(f.rel) && VIEWPORT_CLAIM_RE.test(f.code)
    ).map((f) => f.rel);
}

describe("no component under the shared header claims a whole viewport height (issue #2274)", () => {
    it("only the allowlisted fullscreen surfaces claim h-dvh / h-screen / min-h-dvh / min-h-screen", () => {
        expect(filesClaimingAViewportHeight().sort()).toEqual(
            Object.keys(VIEWPORT_HEIGHT_ALLOWLIST).sort()
        );
    });

    it("the allowlist has no stale entries — every exempt file still carries a claim", () => {
        const claiming = new Set(filesClaimingAViewportHeight());
        for (const rel of Object.keys(VIEWPORT_HEIGHT_ALLOWLIST)) {
            expect(
                claiming.has(rel),
                `${rel} no longer claims a viewport height — drop its allowlist entry`
            ).toBe(true);
        }
    });

    it("every allowlisted route really is a route the shared header skips", () => {
        for (const [rel, entry] of Object.entries(VIEWPORT_HEIGHT_ALLOWLIST)) {
            if (!entry.routePath) continue;
            expect(
                shellShowsHeader(entry.routePath),
                `${rel} claims a viewport height but ${entry.routePath} DOES wear the shared header`
            ).toBe(false);
        }
    });

    it("the fixed state screens claim the shell's remainder instead", () => {
        // The four sites issue #2274 names: the shared loading screen, the join
        // antechamber shell, and the deck-builder / deck-detail route branches.
        for (const rel of [
            "components/ui/loading-screen.tsx",
            "components/join/join-antechamber-shell.tsx",
            "components/join/join-game.tsx",
            "routes/deck-builder.route.tsx",
            "routes/deck-detail.route.tsx",
        ]) {
            const file = SOURCE_FILES.find((f) => f.rel === rel)!;
            expect(file, `${rel} not found`).toBeTruthy();
            expect(file.code, `${rel} lost its remainder claim`).toMatch(
                /(?<![\w-])min-h-full(?![\w-])/
            );
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Guard 2 — every sticky element scrolls against its OWN nested scroller
// ────────────────────────────────────────────────────────────────────────────

const SCROLLER_CLASSES = [
    "overflow-y-auto",
    "overflow-auto",
    "overflow-y-scroll",
    "overflow-scroll",
];

interface JsxOpeningTag {
    line: number;
    indent: number;
    tag: string;
    text: string;
}

/** Every JSX opening tag in a file, with its indentation and full attribute text. */
function openingTags(source: string): JsxOpeningTag[] {
    const lines = source.split("\n");
    const tags: JsxOpeningTag[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)<([A-Z][\w.]*|[a-z][\w-]*)\b/.exec(lines[i]);
        if (!m) continue;
        let text = lines[i];
        let j = i;
        while (j + 1 < lines.length && !/\/?>\s*$/.test(lines[j])) {
            j++;
            text += "\n" + lines[j];
        }
        tags.push({
            line: i + 1,
            indent: m[1].length,
            tag: m[2],
            text,
        });
    }
    return tags;
}

/**
 * The JSX ancestors of `line` within one file, innermost first. Walks upward
 * accepting only opening tags at STRICTLY smaller indentation than everything
 * accepted so far — which is what makes an already-closed uncle (same or deeper
 * indent) impossible to mistake for a parent.
 */
function jsxAncestorsOf(source: string, line: number): JsxOpeningTag[] {
    const tags = openingTags(source).filter((t) => t.line < line);
    const startIndent =
        /^(\s*)/.exec(source.split("\n")[line - 1])?.[1].length ?? 0;
    let minIndent = startIndent;
    const ancestors: JsxOpeningTag[] = [];
    for (let i = tags.length - 1; i >= 0; i--) {
        if (tags[i].indent < minIndent) {
            ancestors.push(tags[i]);
            minIndent = tags[i].indent;
        }
    }
    return ancestors;
}

function isScroller(tagText: string): boolean {
    return SCROLLER_CLASSES.some((c) =>
        new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(tagText)
    );
}

/** Every `className` carrying a `sticky` utility, repo-wide. */
function stickySites(): { rel: string; line: number; text: string }[] {
    const sites: { rel: string; line: number; text: string }[] = [];
    for (const file of SOURCE_FILES) {
        const lines = file.code.split("\n");
        lines.forEach((text, i) => {
            if (!text.includes("className")) return;
            if (!/(?<![\w-])sticky(?![\w-])/.test(text)) return;
            sites.push({ rel: file.rel, line: i + 1, text });
        });
    }
    return sites;
}

/**
 * How each sticky element gets a scroller that is NOT `<main>`.
 * `ownedBy` names the parent component whose JSX supplies the scroller (the
 * sticky element's own file does not contain it); `portaledBy` names the
 * overlay the element lives in, which escapes `<main>` entirely.
 */
const STICKY_SITES: Record<
    string,
    | { ownedBy: { rel: string; usage: string }; why: string }
    | { portaledBy: { rel: string; portalIn: string }; why: string }
> = {
    "components/lobby/deck-builder/results-grid.tsx": {
        ownedBy: {
            rel: "components/lobby/deck-builder/deck-builder.tsx",
            usage: "<ResultsGrid",
        },
        why: "The results-count header pins to the deck-builder's own results pane, not to `<main>`.",
    },
    "components/board/cards-pile.tsx": {
        portaledBy: {
            rel: "components/ui/game-dialog.tsx",
            portalIn: "components/ui/dialog.tsx",
        },
        why: "The pile browser's footer row lives inside a portaled GameDialog — never a descendant of `<main>`.",
    },
};

describe("every sticky header sits inside its own nested scroller, not the shell's (issue #2274)", () => {
    it("the sticky census matches the registry — a new sticky element must be classified", () => {
        const found = [...new Set(stickySites().map((s) => s.rel))].sort();
        expect(found).toEqual(Object.keys(STICKY_SITES).sort());
    });

    it("each registered sticky element resolves to a scroller below <main>", () => {
        for (const site of stickySites()) {
            const entry = STICKY_SITES[site.rel];
            const file = SOURCE_FILES.find((f) => f.rel === site.rel)!;
            const ownAncestors = jsxAncestorsOf(file.code, site.line);

            // Never satisfied by <main> itself, and never by nothing at all.
            expect(
                ownAncestors.some((a) => a.tag === "main"),
                `${site.rel}:${site.line} pins directly against <main>`
            ).toBe(false);

            if ("portaledBy" in entry) {
                // The nearest ancestor is the overlay named in the registry,
                // and that overlay really is portaled out of the tree.
                const overlay = SOURCE_FILES.find(
                    (f) => f.rel === entry.portaledBy.rel
                )!;
                const portalHost = SOURCE_FILES.find(
                    (f) => f.rel === entry.portaledBy.portalIn
                )!;
                const overlayName = entry.portaledBy.rel
                    .split("/")
                    .pop()!
                    .replace(/\.tsx?$/, "")
                    .split("-")
                    .map((p) => p[0].toUpperCase() + p.slice(1))
                    .join("");
                expect(
                    ownAncestors.some((a) => a.tag === overlayName),
                    `${site.rel}:${site.line} is not inside <${overlayName}>`
                ).toBe(true);
                // The overlay renders through the portal-providing primitive,
                // and that primitive really portals (out of `<main>` entirely).
                // The DOM proof of the same fact is the render test below.
                expect(overlay.code).toMatch(
                    new RegExp(
                        `from\\s+["'][^"']*${entry.portaledBy.portalIn
                            .split("/")
                            .pop()!
                            .replace(/\.tsx?$/, "")}["']`
                    )
                );
                expect(portalHost.code).toMatch(/Portal/);
                continue;
            }

            // Own file has no scroller of its own — that is precisely why the
            // registry has to name the owner. Assert both halves.
            expect(
                ownAncestors.some((a) => isScroller(a.text)),
                `${site.rel}:${site.line} now has its own scroller — simplify its registry entry`
            ).toBe(false);

            const owner = SOURCE_FILES.find(
                (f) => f.rel === entry.ownedBy.rel
            )!;
            const ownerLines = owner.code.split("\n");
            const usageLine =
                ownerLines.findIndex((l) => l.includes(entry.ownedBy.usage)) +
                1;
            expect(
                usageLine,
                `${entry.ownedBy.usage} not found in ${entry.ownedBy.rel}`
            ).toBeGreaterThan(0);
            const ownerAncestors = jsxAncestorsOf(owner.code, usageLine);
            expect(
                ownerAncestors.some((a) => isScroller(a.text)),
                `${entry.ownedBy.rel} no longer wraps ${entry.ownedBy.usage} in a scroller — ${site.rel}'s sticky header would pin against <main>`
            ).toBe(true);
            expect(
                ownerAncestors.some((a) => a.tag === "main"),
                `${entry.ownedBy.rel} renders ${entry.ownedBy.usage} directly under <main>`
            ).toBe(false);
        }
    });
});

describe("a portaled overlay escapes <main>'s overflow (issue #2274)", () => {
    it("GameDialog's content is NOT a descendant of the <main> it was rendered inside", () => {
        const { baseElement } = render(
            <main data-testid="shell-main" style={{ overflowY: "auto" }}>
                <GameDialog open title="Pile">
                    <p data-testid="dialog-body">body</p>
                </GameDialog>
            </main>
        );
        const main = baseElement.querySelector(
            '[data-testid="shell-main"]'
        ) as HTMLElement;
        const body = baseElement.querySelector(
            '[data-testid="dialog-body"]'
        ) as HTMLElement;
        expect(body).toBeTruthy();
        expect(main.contains(body)).toBe(false);
    });
});
