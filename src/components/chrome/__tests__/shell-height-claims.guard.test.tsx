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
//  3. Every ROUTE ROOT — the element `<main>` renders as its direct flex child —
//     can be scrolled to its own bottom at every desktop height. This is the
//     guard the first cut of this PR did not have, and its absence is how `/`
//     was certified as correct while its `flex-1 overflow-hidden` root clipped
//     the page with no scrollbar anywhere. A census, not a spot-check: the
//     registry below is checked for completeness against `router.tsx`.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { render } from "@testing-library/react";
import { resolveShellChrome } from "@/lib/shellChrome";
import {
    SCROLLER_CLASSES,
    VIEWPORT_HEIGHT_CLASSES,
    arbitraryViewportClaims,
    deriveHeightClaim,
    resolveShellLayout,
    shellBands,
    type ShellModel,
    type ShellViewportMode,
} from "@/lib/shellLayout";
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
 * it is exempt. `routePath`, where given, is resolved through `shellChrome`
 * so the exemption's premise ("this never renders under a shell band") is
 * verified rather than asserted. Post-#2582 the premise is stronger than "no
 * header": an exempt surface must own its chrome outright, because a route in
 * either shell MODE now pays a band.
 */
const VIEWPORT_HEIGHT_ALLOWLIST: Record<
    string,
    { why: string; routePath?: string; outsideShell?: true }
> = {
    "components/chrome/app-shell.tsx": {
        why: "The shell root IS the hard bound the rest of the contract needs (issue #2056 defect 3).",
    },
    "routes/game.route.tsx": {
        why: "The board is the fullscreen play surface — no shared header, so `<main>` IS the viewport.",
        routePath: "/game",
    },
    "components/board/manual-board-container.tsx": {
        why: "Board-only machinery, reachable solely from `/game` (out of scope per issue #2274).",
        routePath: "/game",
    },
    "components/board/waiting-for-opponent.tsx": {
        why: "Rendered only by `game.route.tsx` while an opponent is awaited — `/game`, no header band.",
        routePath: "/game",
    },
    // The auth screens render OUTSIDE `AppShell` entirely — `router.tsx` wraps
    // the shell in `<AuthGate>`, so neither is ever a descendant of `<main>`.
    // That premise is checked structurally by the test below, not declared.
    // They are on this list because `min-h-svh` is a whole-viewport claim and
    // the vocabulary now sees it; it was invisible before, which is exactly the
    // idiom a future headered component would have copied unnoticed.
    "components/auth/auth-gate.tsx": {
        why: "Renders ABOVE the shell — `router.tsx` puts `<AuthGate>` outside `<AppShell/>`, so it is never inside `<main>`.",
        outsideShell: true,
    },
    "components/auth/auth-form.tsx": {
        why: "Rendered by `auth-gate.tsx`, i.e. also above the shell — never inside `<main>`.",
        outsideShell: true,
    },
};

const VIEWPORT_CLAIM_RE = new RegExp(
    `(?<![\\w-])(?:${VIEWPORT_HEIGHT_CLASSES.join("|")})(?![\\w-])|height:\\s*["'\`]?100d?vh`
);

function filesClaimingAViewportHeight(): string[] {
    return SOURCE_FILES.filter(
        (f) =>
            !SCAN_EXCLUDE.has(f.rel) &&
            (VIEWPORT_CLAIM_RE.test(f.code) ||
                arbitraryViewportClaims(f.code).length > 0)
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

    it("every allowlisted route really is a route the shell renders no band for", () => {
        for (const [rel, entry] of Object.entries(VIEWPORT_HEIGHT_ALLOWLIST)) {
            if (!entry.routePath) continue;
            const chrome = resolveShellChrome(entry.routePath);
            expect(
                chrome.ownChrome,
                `${rel} claims a viewport height but ${entry.routePath} wears shell chrome (${chrome.mode}) — <main> is the viewport MINUS that band`
            ).toBe(true);
            // Belt and braces: `ownChrome` must actually cost nothing.
            for (const viewport of [
                "portrait",
                "landscape-compact",
                "desktop",
            ] as const) {
                expect(
                    shellBands({
                        mode: chrome.mode,
                        ownChrome: chrome.ownChrome,
                        viewport,
                        returnBanner: true,
                    }),
                    `${rel} @ ${viewport}`
                ).toEqual({ headerBandHeightPx: 0, bottomBandHeightPx: 0 });
            }
        }
    });

    it("every `outsideShell` exemption really renders above the shell, not inside <main>", () => {
        const router = SOURCE_FILES.find((f) => f.rel === "router.tsx")!;
        const shellLine =
            router.code.split("\n").findIndex((l) => /<AppShell\b/.test(l)) + 1;
        expect(
            shellLine,
            "<AppShell/> not found in router.tsx"
        ).toBeGreaterThan(0);
        // `<AuthGate>` is an ANCESTOR of `<AppShell/>`, so everything AuthGate
        // renders in place of the shell is outside `<main>` by construction.
        expect(
            jsxAncestorsOf(router.code, shellLine).map((a) => a.tag)
        ).toContain("AuthGate");

        const gate = SOURCE_FILES.find(
            (f) => f.rel === "components/auth/auth-gate.tsx"
        )!;
        // ...and the form is AuthGate's own unauthenticated branch, so it
        // inherits the same position. Both premises are read from source.
        expect(gate.code).toMatch(/<AuthForm\b/);

        for (const [rel, entry] of Object.entries(VIEWPORT_HEIGHT_ALLOWLIST)) {
            if (!entry.outsideShell) continue;
            expect(
                [
                    "components/auth/auth-gate.tsx",
                    "components/auth/auth-form.tsx",
                ],
                `${rel} claims to render outside the shell but is not one of the files this test traced`
            ).toContain(rel);
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

/**
 * Every `className` carrying a `sticky` utility, repo-wide.
 *
 * Scans whole JSX opening TAGS, not source lines: a `sticky` inside a
 * multi-line `className={clsx(...)}` shares no line with the `className` token
 * and a per-line scan cannot see it. The census was complete under the
 * line-based version, but only by accident of formatting.
 */
function stickySites(): { rel: string; line: number; text: string }[] {
    const sites: { rel: string; line: number; text: string }[] = [];
    for (const file of SOURCE_FILES) {
        for (const tag of openingTags(file.code)) {
            if (!tag.text.includes("className")) continue;
            if (!/(?<![\w-])sticky(?![\w-])/.test(tag.text)) continue;
            sites.push({ rel: file.rel, line: tag.line, text: tag.text });
        }
    }
    return sites;
}

/**
 * The component whose JSX supplies a sticky element's scroller.
 *
 * `slottedBy` is the SLOT hop issue #1623 introduced. Both deckbuilders now
 * render through ONE `DeckBuilderShell`, so the file that owns the scroller no
 * longer renders the sticky element's file directly — it renders a `{slot}`
 * expression, and a thin wrapper passes the sticky element into that slot. BOTH
 * hops are read from source below: naming only the scroller's owner would leave
 * this guard green while nothing tied `results-grid.tsx` to it at all, which is
 * a census that covers nothing.
 */
interface StickyScrollerOwner {
    rel: string;
    usage: string;
    slottedBy?: { rel: string; slot: string; usage: string };
}

/**
 * How each sticky element gets a scroller that is NOT `<main>`.
 * `ownedBy` names the parent component whose JSX supplies the scroller (the
 * sticky element's own file does not contain it); `portaledBy` names the
 * overlay the element lives in, which escapes `<main>` entirely.
 */
const STICKY_SITES: Record<
    string,
    | { ownedBy: StickyScrollerOwner; why: string }
    | { portaledBy: { rel: string; portalIn: string }; why: string }
> = {
    "components/lobby/deck-builder/results-grid.tsx": {
        ownedBy: {
            rel: "components/deckbuilder/deck-builder-shell.tsx",
            usage: "{sourcePanel}",
            slottedBy: {
                rel: "components/lobby/deck-builder/deck-builder.tsx",
                slot: "sourcePanel",
                usage: "<ResultsGrid",
            },
        },
        why: "The results-count header pins to the shell's own source-panel scroller (`min-h-0 flex-1 basis-0 overflow-y-auto`), not to `<main>`; the Constructed wrapper passes `<ResultsGrid` into that slot (issue #1623).",
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

            // The SLOT hop (issue #1623). The owner above scrolls a `{slot}`
            // expression, so the chain only reaches the sticky element if the
            // wrapper really passes THIS file into THAT slot — and adds no
            // scroller of its own on the way, or the registry would be naming
            // the wrong owner and checking a box the header never pins to.
            const slot = entry.ownedBy.slottedBy;
            if (!slot) continue;
            const passer = SOURCE_FILES.find((f) => f.rel === slot.rel);
            expect(passer, `${slot.rel} not found`).toBeTruthy();
            const passerLines = passer!.code.split("\n");
            const slotIdx = passerLines.findIndex((l) =>
                new RegExp(`(?<![\\w-])${slot.slot}=\\{`).test(l)
            );
            expect(
                slotIdx,
                `${slot.rel} no longer passes a \`${slot.slot}\` prop to ${entry.ownedBy.rel}`
            ).toBeGreaterThanOrEqual(0);
            // A prop's VALUE is the run of MORE-indented lines beneath its own
            // line (the closing `}` returns to the prop's indent), so a usage
            // match elsewhere in the file cannot pass for one inside the slot.
            const slotIndent = /^(\s*)/.exec(passerLines[slotIdx])![1].length;
            let slotEnd = slotIdx + 1;
            while (
                slotEnd < passerLines.length &&
                (passerLines[slotEnd].trim() === "" ||
                    /^(\s*)/.exec(passerLines[slotEnd])![1].length > slotIndent)
            ) {
                slotEnd++;
            }
            expect(
                passerLines
                    .slice(slotIdx, slotEnd)
                    .some((l) => l.includes(slot.usage)),
                `${slot.rel} no longer renders ${slot.usage} inside the \`${slot.slot}\` slot — ${site.rel}'s sticky header would pin somewhere ${entry.ownedBy.rel} does not scroll`
            ).toBe(true);
            const passerUsageLine =
                passerLines.findIndex((l) => l.includes(slot.usage)) + 1;
            expect(
                jsxAncestorsOf(passer!.code, passerUsageLine).some((a) =>
                    isScroller(a.text)
                ),
                `${slot.rel} now wraps ${slot.usage} in a scroller of its OWN — the registry credits ${entry.ownedBy.rel} and would no longer be checking the box the sticky header actually pins to`
            ).toBe(false);
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Guard 3 — every route root can be scrolled to its own bottom
//
// The blocking finding on the first cut of this PR: `/` was certified as
// "no own scroller / `<main>` overflow 0 / `<main>` scrolls" while its root was
// `flex-1 overflow-hidden`. Per CSS Flexbox §4.5 that is a HARD box at exactly
// `<main>`'s height which CLIPS the column below it — `<main>.scrollHeight ===
// clientHeight`, so `overflow-y-auto` never engaged and no scrollbar existed
// anywhere. `LobbyFooter` was unreachable at both HITL sizes.
//
// A prose census in a PR body cannot fail. This one runs the shell's own
// arithmetic over every route root's REAL className at every desktop height,
// and its completeness is checked against `router.tsx`.
// ────────────────────────────────────────────────────────────────────────────

const DESKTOP_HEIGHTS_PX = [500, 600, 720, 768, 800, 900, 1080, 1200, 1440];

/** The shape `app-shell.tsx` ships — asserted against the real DOM in
 *  `app-shell-scroll-contract.test.tsx`. */
const SHELL: ShellModel = {
    rootBounded: true,
    headerPinned: true,
    bottomPinned: true,
    mainCanShrink: true,
    mainScrolls: true,
};

/**
 * The viewport regimes the census sweeps (issue #2582). `portrait` is not a
 * duplicate of `desktop` with smaller numbers: it is the ONLY regime with a
 * band BELOW `<main>`, so a route root that reaches its bottom on desktop can
 * still hide its last row under the bottom nav. Heights come from the sweep
 * below; the regime decides which bands are charged.
 */
const VIEWPORT_REGIMES: ShellViewportMode[] = [
    "desktop",
    "landscape-compact",
    "portrait",
];

/**
 * A content demand taller than any desktop viewport in the sweep. The question
 * this guard asks is not "does today's content fit" — it is "if this route's
 * content outgrows the shell's remainder, is the excess REACHABLE".
 */
const TALL_CONTENT_PX = 4000;

interface RouteRootFile {
    rel: string;
    /**
     * A scroller INSIDE the route spanning the whole content column, so the
     * route absorbs its own deficit (issue #2275's deckbuilder shape). Absent
     * means the route does not — the fail-closed default.
     */
    ownScroller?: { at: string; why: string };
    /**
     * Wrapper components on the route's render path that produce NO DOM element
     * of their own — they return another component, which is why `rel` is the
     * file followed THROUGH to. Listed so the follow-through stays a premise
     * read from source: the test below fails the moment a wrapper starts
     * returning an element of its own, because that element would be what
     * `<main>` lays out and would have to be registered as a root instead.
     */
    renderedThrough?: { rel: string; component: string }[];
}

/**
 * Both deckbuilder routes render their whole surface through ONE
 * `DeckBuilderShell` (ADR 0075 §1, issue #1623), so the element `<main>` lays
 * out as its direct flex child is the SHELL's root in both cases — the
 * Constructed and Limited wrappers contribute no box at all. The `ownScroller`
 * declaration moved with the markup: the whole-content-column scroller belongs
 * to the shell now, not to either wrapper.
 */
function deckBuilderShellRoot(wrapperRel: string): RouteRootFile {
    return {
        rel: "components/deckbuilder/deck-builder-shell.tsx",
        ownScroller: {
            at: "the `flex min-h-0 flex-1 flex-col overflow-y-auto` wrapper around the whole content column",
            why: "PR #2276 (issue #2275), generalised to both builders by issue #1623: the deficit is absorbed inside the shell, with `SaveDeckBar` as a `shrink-0` sibling outside it.",
        },
        renderedThrough: [{ rel: wrapperRel, component: "DeckBuilderShell" }],
    };
}

/**
 * Every route component `router.tsx` mounts → the files that can supply that
 * route's ROOT element. A route wrapper that only renders another component
 * (`LobbyRoute` → `<Lobby/>`) is followed through to the file that produces the
 * outermost DOM element, because that is what `<main>` lays out as its direct
 * flex child; EVERY early-return branch counts, not just the happy path.
 */
const ROUTE_ROOTS: Record<
    string,
    { routePath: string; files: RouteRootFile[] }
> = {
    LobbyRoute: {
        routePath: "/",
        files: [
            { rel: "components/lobby/lobby.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    DeckBuilderRoute: {
        routePath: "/decks/create",
        files: [
            { rel: "routes/deck-builder.route.tsx" },
            deckBuilderShellRoot(
                "components/lobby/deck-builder/deck-builder.tsx"
            ),
        ],
    },
    DeckDetailRoute: {
        routePath: "/decks/some-slug",
        files: [
            { rel: "routes/deck-detail.route.tsx" },
            { rel: "components/lobby/deck-detail.tsx" },
        ],
    },
    JoinRoute: {
        routePath: "/join/abc123",
        files: [
            { rel: "components/join/join-game.tsx" },
            { rel: "components/join/join-antechamber-shell.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    LimitedEventsRoute: {
        routePath: "/limited",
        files: [
            { rel: "components/limited/limited-events-page.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    LimitedYourEventsRoute: {
        routePath: "/limited/events",
        files: [
            { rel: "components/limited/limited-your-events-page.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    LimitedEventDetailRoute: {
        routePath: "/limited/abc123",
        files: [
            { rel: "components/limited/limited-event-page-frame.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    LimitedDraftRoomRoute: {
        // The Draft Room (issue #2587). `ownChrome`, so `<main>` IS the
        // viewport here — same as `/game` — and the room absorbs its own
        // deficit in the scroller below the thin bar.
        routePath: "/limited/abc123/draft",
        files: [
            {
                rel: "components/limited/limited-draft-room.tsx",
                ownScroller: {
                    at: "the `flex min-h-0 flex-1 flex-col overflow-y-auto` body under the thin bar",
                    why: "The bar is a `shrink-0` sibling and the body takes the remainder; the split layout's two halves then scroll inside it, so a long Pool never pushes the Booster off-screen.",
                },
            },
            { rel: "components/limited/limited-event-page-frame.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    LimitedDeckBuilderRoute: {
        routePath: "/limited/abc123/build",
        files: [
            deckBuilderShellRoot(
                "components/deckbuilder/pool-deck-builder-form.tsx"
            ),
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
    AdminLayoutRoute: {
        routePath: "/admin",
        files: [{ rel: "components/ui/not-found-page.tsx" }],
    },
    AdminIndexRoute: {
        routePath: "/admin",
        files: [{ rel: "routes/admin/admin-index.route.tsx" }],
    },
    AdminScenariosRoute: {
        routePath: "/admin/scenarios",
        files: [{ rel: "components/admin/admin-page-frame.tsx" }],
    },
    AdminBanlistsRoute: {
        routePath: "/admin/banlists",
        files: [{ rel: "components/admin/admin-page-frame.tsx" }],
    },
    AdminPickRatingsRoute: {
        routePath: "/admin/pick-ratings",
        files: [{ rel: "components/admin/admin-page-frame.tsx" }],
    },
    AdminCardProfilesRoute: {
        routePath: "/admin/card-profiles",
        files: [{ rel: "components/admin/admin-page-frame.tsx" }],
    },
    AdminBugReportsRoute: {
        routePath: "/admin/bug-reports",
        files: [{ rel: "components/admin/admin-page-frame.tsx" }],
    },
    DraftLabRoute: {
        routePath: "/admin/draft-lab",
        files: [{ rel: "routes/draft-lab.route.tsx" }],
    },
    DesignSystemRoute: {
        routePath: "/admin/design-system",
        files: [{ rel: "routes/design-system.route.tsx" }],
    },
    SettingsRoute: {
        // issue #2595: density/motion/phase-stops/preview Settings surface.
        // Single-file root, same shape as DesignSystemRoute — no ownScroller,
        // the page's own content grows the route root, which `<main>`'s
        // ambient scroller (not this route) is responsible for reaching.
        routePath: "/settings",
        files: [{ rel: "routes/settings.route.tsx" }],
    },
    NotFoundPage: {
        routePath: "/no-such-route",
        files: [{ rel: "components/ui/not-found-page.tsx" }],
    },
    GameRoute: {
        // The one route with no header band — `<main>` IS the viewport there.
        routePath: "/game",
        files: [
            { rel: "routes/game.route.tsx" },
            { rel: "components/board/waiting-for-opponent.tsx" },
            { rel: "components/ui/loading-screen.tsx" },
        ],
    },
};

/**
 * `router.tsx`'s root component is the SHELL, not a route root — it renders
 * `<AppShell/>`, which is the thing every route root is laid out inside.
 */
const SHELL_COMPONENTS = new Set(["AuthGate"]);

/** Every component `router.tsx` mounts as a route (or as the 404 fallback). */
function routerComponents(): string[] {
    const router = SOURCE_FILES.find((f) => f.rel === "router.tsx")!;
    const names = new Set<string>();
    for (const m of router.code.matchAll(
        /(?:component|defaultNotFoundComponent):\s*(?:\(\)\s*=>\s*\(?\s*)?<?\s*([A-Z]\w*)/g
    )) {
        if (!SHELL_COMPONENTS.has(m[1])) names.add(m[1]);
    }
    return [...names].sort();
}

/** The `className` of a JSX opening tag, when it is a static string literal. */
function staticClassName(tagText: string): string | null {
    const m = /className=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\})/.exec(tagText);
    if (!m) return null;
    return (m[1] ?? m[2]).replace(/\s+/g, " ").trim();
}

/**
 * A tag that HAS a `className` the sweep cannot read — a template literal, a
 * `clsx(...)` call, a variable. Distinct from a tag with no `className` at all
 * (`<LoadingScreen />`, a fragment), which claims nothing and is followed
 * through the registry instead.
 *
 * Reviewer-proven hole: with the identical clipping element in place, a static
 * literal reddened this guard 9x while a template literal left it 20/20 GREEN,
 * because the sweep `continue`d with no record. A census that silently covers
 * nothing is the exact shape this guard exists to prevent, so an unreadable
 * route-root className is a FAILURE, not a skip.
 */
function hasUnreadableClassName(tagText: string): boolean {
    return /className\s*=/.test(tagText) && staticClassName(tagText) === null;
}

/**
 * Every JSX element a file `return`s — one per branch. Only blank lines may sit
 * between the `return (` and its element, so a `return` of a non-JSX value is
 * skipped rather than mis-attributed to the next tag in the file.
 */
function returnedRoots(source: string): JsxOpeningTag[] {
    const lines = source.split("\n");
    const tags = openingTags(source);
    const roots: JsxOpeningTag[] = [];
    lines.forEach((text, i) => {
        const inline = /^\s*return\s+(<[\s\S]*)$/.exec(text);
        if (inline) {
            const tag = tags.find((t) => t.line === i + 1);
            if (tag) roots.push(tag);
            return;
        }
        if (!/^\s*return\s*\(\s*$/.test(text)) return;
        const next = tags.find((t) => t.line > i + 1);
        if (!next) return;
        // Everything between must be blank (comments are already stripped).
        const gap = lines.slice(i + 1, next.line - 1);
        if (gap.some((l) => l.trim() !== "")) return;
        roots.push(next);
    });
    return roots;
}

describe("every route root reaches its own bottom, at every desktop height (issue #2274)", () => {
    it("the route-root registry covers every component router.tsx mounts", () => {
        expect(Object.keys(ROUTE_ROOTS).sort()).toEqual(routerComponents());
    });

    it("every registered root file exists and returns at least one element with a static className", () => {
        for (const [component, entry] of Object.entries(ROUTE_ROOTS)) {
            for (const file of entry.files) {
                const src = SOURCE_FILES.find((f) => f.rel === file.rel);
                expect(src, `${component}: ${file.rel} not found`).toBeTruthy();
                const withClass = returnedRoots(src!.code).filter((t) =>
                    staticClassName(t.text)
                );
                expect(
                    withClass.length,
                    `${component}: ${file.rel} yields no returned element with a static className — the census below would silently cover nothing`
                ).toBeGreaterThan(0);
            }
        }
    });

    it("a `renderedThrough` wrapper contributes no box of its own — the follow-through is read from source, not asserted", () => {
        for (const [component, entry] of Object.entries(ROUTE_ROOTS)) {
            for (const file of entry.files) {
                for (const hop of file.renderedThrough ?? []) {
                    const src = SOURCE_FILES.find((f) => f.rel === hop.rel);
                    expect(
                        src,
                        `${component}: ${hop.rel} not found`
                    ).toBeTruthy();
                    const roots = returnedRoots(src!.code);
                    expect(
                        roots.length,
                        `${component}: ${hop.rel} returns no element at all — it cannot be the wrapper that mounts <${hop.component}>`
                    ).toBeGreaterThan(0);
                    for (const root of roots) {
                        expect(
                            root.tag,
                            `${component}: ${hop.rel}:${root.line} returns <${root.tag}>, not <${hop.component}> — that element IS a route root and must be registered as one rather than followed through`
                        ).toBe(hop.component);
                        expect(
                            staticClassName(root.text),
                            `${component}: ${hop.rel}:${root.line} gives <${hop.component}> a className of its own, so ${file.rel}'s root is no longer what <main> lays out`
                        ).toBeNull();
                    }
                }
            }
        }
    });

    it("every returned route root's className is READABLE — the sweep below cannot skip one", () => {
        const unreadable: string[] = [];
        for (const [component, entry] of Object.entries(ROUTE_ROOTS)) {
            for (const file of entry.files) {
                const src = SOURCE_FILES.find((f) => f.rel === file.rel)!;
                for (const root of returnedRoots(src.code)) {
                    if (!hasUnreadableClassName(root.text)) continue;
                    unreadable.push(`${component} → ${file.rel}:${root.line}`);
                }
            }
        }
        expect(
            unreadable,
            `these route roots hide their className behind an expression, so the height sweep below silently skips them: ${unreadable.join(
                ", "
            )}. Give the root a static className (put the dynamic part on an inner element), or the census covers nothing.`
        ).toEqual([]);
    });

    it.each(
        DESKTOP_HEIGHTS_PX.flatMap((h) =>
            VIEWPORT_REGIMES.map((v) => [h, v] as const)
        )
    )(
        "at %ipx / %s: no route root clips its content, and every one of them reaches its bottom",
        (viewportHeightPx, viewport) => {
            for (const [component, entry] of Object.entries(ROUTE_ROOTS)) {
                const chrome = resolveShellChrome(entry.routePath);
                // The bands the SHELL would charge this route in this regime —
                // asked of `shellBands`, never restated, so the census can
                // never certify a layout against a band model the shell has
                // stopped using (the #2274 shape).
                const bands = shellBands({
                    mode: chrome.mode,
                    ownChrome: chrome.ownChrome,
                    viewport,
                    returnBanner: false,
                });
                for (const file of entry.files) {
                    const src = SOURCE_FILES.find((f) => f.rel === file.rel)!;
                    for (const root of returnedRoots(src.code)) {
                        const className = staticClassName(root.text);
                        if (className === null) continue;
                        const claim = deriveHeightClaim(
                            className,
                            TALL_CONTENT_PX,
                            { hasOwnScroller: file.ownScroller !== undefined }
                        );
                        const layout = resolveShellLayout(
                            SHELL,
                            { viewportHeightPx, ...bands },
                            claim
                        );
                        const where = `${component} → ${file.rel}:${root.line} (${className}) @ ${viewport}`;
                        expect(
                            layout.clippedPx,
                            `${where} CLIPS ${layout.clippedPx}px — a shrinkable flex child of <main> that hides its overflow, so <main> sees nothing to scroll and there is no scrollbar anywhere. DROP the clipping class (\`overflow-hidden\`/\`-clip\`) — changing the HEIGHT claim does not help, that was measured as a no-op. Otherwise: give the route its own whole-column scroller and declare it here, or make the root \`shrink-0\`.`
                        ).toBe(0);
                        expect(
                            layout.bottomReachable,
                            `${where} cannot be scrolled to its own bottom at ${viewportHeightPx}px`
                        ).toBe(true);
                    }
                }
            }
        }
    );

    it("a declared `ownScroller` really exists in that file — the premise is read from source, not asserted", () => {
        for (const [component, entry] of Object.entries(ROUTE_ROOTS)) {
            for (const file of entry.files) {
                if (!file.ownScroller) continue;
                const src = SOURCE_FILES.find((f) => f.rel === file.rel)!;
                const scrollers = openingTags(src.code).filter((t) =>
                    isScroller(t.text)
                );
                expect(
                    scrollers.length,
                    `${component}: ${file.rel} declares an own scroller (${file.ownScroller.at}) but contains none`
                ).toBeGreaterThan(0);
                expect(file.ownScroller.why.length).toBeGreaterThan(20);
            }
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
