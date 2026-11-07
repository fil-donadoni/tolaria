/**
 * The Viewport Matrix (ADR 0101, issue #2580; ADR 0168, issue #8321).
 *
 * Five, not three. The tablet pair is where the deck builders hid their worst
 * clipping, and `.claude/rules/chrome-debug.md` named only three until this
 * lane existed. The ids are the SAME strings the manual chrome-devtools-mcp
 * `emulate` call uses, so a probe line from the gate and a probe line a human
 * pasted into a PR are directly comparable — and so a receipt's viewport column reads
 * the same as the guide.
 *
 * Six since issue #8321: every one of the five is DPR 2 or 3, so a 1x
 * display — the external monitor the owner reads grainy card art on — had
 * never been walked. The sixth, `1440x900x1`, is the desktop at DPR 1, and it
 * differs from the five in two declared ways (ADR 0168):
 *
 *   - it walks ONLY the surfaces that draw printed card faces
 *     (`Surface.cards`), because that is the one thing a DPR 1 pass can
 *     reveal that the DPR 2 desktop cannot — every other Floor is a function
 *     of CSS pixels and reads identically at both ratios;
 *   - it runs in the FULL Chromium binary (`renderer: "chrome"`, Playwright's
 *     `channel: "chromium"`), not the headless shell the five run in. Measured
 *     on this lane (issue #8321, 2026-11-07, `raster.js`'s maths on a synthetic
 *     page): the shell rasters an `<img>` with the same resampler the canvas
 *     reference uses, so shot/reference read 1.00 for every rendition at every
 *     slot width — a probe that cannot disagree with its own reference. The
 *     full binary (headed and new-headless read the same numbers) mips the
 *     resource the way the owner's desktop does: `grid` in an 84px slot read
 *     1.35, in a 64px slot 0.84.
 */
export interface Viewport {
    /** Receipt column and output label — matches the `emulate` string. */
    readonly id: string;
    readonly label: string;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
    readonly mobile: boolean;
    /** Walks only the surfaces that draw printed card faces
     *  (`Surface.cards`) — `viewportWalks` is the one place the rule lives. */
    readonly cardsOnly?: boolean;
    /** Which Chromium rasters this viewport: the headless `shell` (the lane's
     *  default) or the full `chrome` binary, whose image resampler is the one
     *  a desktop user sees. */
    readonly renderer?: "shell" | "chrome";
}

export const VIEWPORTS: readonly Viewport[] = [
    {
        id: "1440x900x2",
        label: "desktop",
        width: 1440,
        height: 900,
        dpr: 2,
        mobile: false,
    },
    {
        id: "390x844x3",
        label: "phone portrait",
        width: 390,
        height: 844,
        dpr: 3,
        mobile: true,
    },
    {
        id: "844x390x3",
        label: "phone landscape",
        width: 844,
        height: 390,
        dpr: 3,
        mobile: true,
    },
    {
        id: "820x1180x2",
        label: "tablet portrait",
        width: 820,
        height: 1180,
        dpr: 2,
        mobile: true,
    },
    {
        id: "1180x820x2",
        label: "tablet landscape",
        width: 1180,
        height: 820,
        dpr: 2,
        mobile: true,
    },
    {
        id: "1440x900x1",
        label: "desktop 1x",
        width: 1440,
        height: 900,
        dpr: 1,
        mobile: false,
        cardsOnly: true,
        renderer: "chrome",
    },
];

export const VIEWPORT_IDS: readonly string[] = VIEWPORTS.map((v) => v.id);

/** The renderer a viewport walks in; the shell unless it says otherwise. */
export function rendererOf(viewport: Viewport): "shell" | "chrome" {
    return viewport.renderer ?? "shell";
}

/** Whether `viewport` walks `surface`: every viewport walks every surface,
 *  except a `cardsOnly` viewport, which walks only a surface that declares
 *  `cards` (ADR 0168). The one rule `index.ts` (the walk), `receipt.ts` (the
 *  cells owed) and `verify-receipt.ts` (the re-derivation) all read. */
export function viewportWalks(
    viewport: Pick<Viewport, "cardsOnly">,
    surface: { readonly cards?: boolean }
): boolean {
    return !viewport.cardsOnly || surface.cards === true;
}

/** The viewport ids owed by one surface, in matrix order. */
export function viewportIdsFor(
    surface: { readonly cards?: boolean },
    viewports: readonly Viewport[] = VIEWPORTS
): string[] {
    return viewports.filter((v) => viewportWalks(v, surface)).map((v) => v.id);
}
