/**
 * The Floors `bun run check:ui` gates, the Shape Readings it only prints, and
 * the surfaces it declares unwalked (ADR 0132 §1, §2; issue #3648).
 *
 * FLOORS, NOT CEILINGS. Nine counts describe a DEFECT — a zero-size card, a
 * control clipped where no gesture reaches it, a square or soft card face, a
 * serious axe violation, a page that scrolls sideways. They are held at zero on
 * every walked surface and viewport, with no per-surface exception, and they
 * are constants here: there is no number to record, so there is no budget file,
 * no `--record` and no `--accept=`. A nonzero reading is `FAIL`, with the
 * reading on the line.
 *
 * SHAPE READINGS ARE DIAGNOSTIC. `cardsOcc`, `ctrlsOcc`, `small` and `starved`
 * describe the screen AS DESIGNED — a fanned hand overlaps, a sheet covers the
 * board under `lg`, a scroll port is shorter than its content — so their value
 * moves with the position on the screen. A ceiling on them was a ceiling on the
 * position, and they flapped (ADR 0132 § Context). They are measured and
 * printed in the diagnostic block of every receipt, and compared against
 * nothing.
 *
 * A SURFACE THAT CANNOT HOLD A FLOOR is listed in `UNWALKED_SURFACES` with its
 * reason and its issue — never carried as an exception.
 */

/** The counts held at zero. Order is the order a broken-floor line names them. */
export const FLOORS = [
    "cardsZero",
    "cardsStranded",
    "cardsSquare",
    "cardsSoft",
    "ctrlsZero",
    "ctrlsStranded",
    "axeSerious",
    "axeCritical",
    "hOverflow",
] as const;

export type Floor = (typeof FLOORS)[number];

/** The counts printed and never compared. */
export const SHAPE_READINGS = [
    "cardsOcc",
    "ctrlsOcc",
    "small",
    "starved",
] as const;

export type ShapeReading = (typeof SHAPE_READINGS)[number];

/** One surface × viewport's readings: every Floor and every Shape Reading. */
export type Readings = Record<Floor | ShapeReading, number>;

/** One `cards`/`ctrls` bucket out of `probe.js`'s result (issue #2580). */
export interface ProbeCounts {
    n: number;
    zero: number;
    occ: number;
    reachable: number;
    stranded: number;
}

/** The raw shape `probe.js` (browser-side) hands back for one viewport. */
export interface ProbeResult {
    vp: string;
    cards: ProbeCounts;
    /** SQUARE card surfaces (ADR 0103 §7, issue #2724) — a card showing page
     *  background inside its own rectangle instead of the printed rounded
     *  corner. A Floor.
     *
     *  Measured by COMPUTED RADIUS, not by a hit test and not by pixels
     *  (`probe.js`'s square-corner block): the probe walks the card's own box
     *  chain — the image plus any ancestor with the same rect — takes the
     *  largest `border-top-left-radius` on an element that actually CLIPS to it
     *  (the image itself, or an ancestor with non-visible `overflow` / paint
     *  containment), and reds when that radius is under 2.4% of the card's
     *  width, half the printed fraction. A hit test at the corner was the FIRST
     *  implementation and was withdrawn: the corner is an ellipse quadrant, so
     *  the usable inset is under ~0.29·r — ~1.1px on a 78px phone tile — and
     *  `elementFromPoint` snaps CSS pixels to device pixels, which made it
     *  report 36 square cards on a tree whose cards were all correctly rounded.
     *  A pixel read is impossible at all: card art is cross-origin, so the
     *  canvas is tainted. */
    cardsSquareN: number;
    cardsSquare: SquareExample[];
    /** SOFT card faces (issue #3553) — a printed card face whose RESOLVED
     *  source is narrower than the slot it paints into, measured in DEVICE
     *  pixels (`slot CSS width × devicePixelRatio` vs the published width of
     *  the rendition the browser selected). A Floor.
     *
     *  It measures the OUTCOME, not the markup: `currentSrc` is the candidate
     *  the browser actually selected and fetched, so a `sizes` hint below the
     *  slot shows up as the rendition it really cost. `naturalWidth` was the
     *  first implementation and was withdrawn: for a width-descriptor srcset
     *  the spec divides it by the resource's current pixel density, so it
     *  reports the `sizes` hint back and can never disagree with the markup
     *  (see `probe.js`). This measures the RESOURCE, so a compositor
     *  re-decoding a correct resource at lower resolution is outside what any
     *  JS-visible quantity can see.
     *
     *  Scoped to `data-card-face="printed"`; the art / art_crop preview
     *  pipeline is a different rendition family. */
    cardsSoftN: number;
    cardsSoft: SoftExample[];
    /** Printed faces the browser had not yet resolved a candidate for when the
     *  probe ran (no `currentSrc`). Reported, never gated: a lazy card below
     *  the fold legitimately has no resolved source, and `cardsZero` already
     *  owns "no box". */
    cardsSoftPending: number;
    /** Printed faces whose resolved rendition the probe does not know the
     *  pixel width of — a new CDN variant, or an art pipeline that grew the
     *  marker. Counted INTO the `cardsSoft` Floor (`readingsOf`): a face the
     *  probe cannot measure is a face it cannot prove sharp, and a coverage
     *  hole reds rather than reads green. The fix is a row in `probe.js`'s
     *  `RENDITION_W`, or removing a marker that does not belong. */
    cardsSoftUnknown: number;
    ctrls: ProbeCounts;
    starvedN: number;
    starved: unknown[];
    /** Visible in-band interactive controls whose smaller dimension is under
     *  44px (issue #2658). POINTER-BLIND by design: `--control-h` is 32px under
     *  `pointer: fine` on purpose (WCAG 2.5.8 is a touch-target rule), so a
     *  desktop reading is mostly the intended control height, while a reading
     *  at a `mobile,touch` viewport is a real sub-target control. A Shape
     *  Reading for exactly that reason: one number cannot tell the two apart. */
    smallN: number;
    /** The SHELL RETURN BAND's contribution, which `probe.js` culls out of
     *  every control count (issue #3337). `AppReturnBanner` mounts only while
     *  the signed-in account has a game or Limited event in flight, so its
     *  controls were a function of DEPLOYMENT STATE, not of the tree. Reported
     *  rather than merely dropped: an excluded control the run does not name is
     *  exactly the unattributable number the cull replaces. */
    shellBand: { mounted: boolean; excluded: number };
    tinyText: number;
    /** `documentElement.scrollWidth` minus the viewport width: a page that
     *  scrolls sideways. A Floor on anything above zero. */
    hOverflow: number;
    cardW: { min: number; max: number } | null;
}

/** One square-cornered card, named so the run says WHICH card (issue #2724).
 *  `t` is the image's `alt` (the card name), `cls` the first 40 chars of its
 *  class list. */
export interface SquareExample {
    t: string;
    cls: string;
    w: number;
    h: number;
    /** The largest corner radius found on the card's own box chain, in px. */
    r: number;
}

/** One soft card face, named so the run says WHICH card and by how much
 *  (issue #3553). `t` is the image's `alt`, `w` the slot's CSS width, `need`
 *  that width in device pixels, `have` the published pixel width of the
 *  rendition the browser resolved, `src` that rendition's CDN path segment. */
export interface SoftExample {
    t: string;
    w: number;
    need: number;
    have: number;
    src: string;
    /** The `sizes` hint the element declares at probe time. Distinguishes an
     *  under-declaration from a stale candidate the browser has not re-picked
     *  after the slot grew — see `probe.js`. */
    dec: string;
}

/** axe-core's violation counts for one viewport (issue #2580/#2593). */
export interface AxeCount {
    serious: number;
    critical: number;
    ids: string[];
    /** How many axe-exempt subtrees the run excluded (issue #2593) — see
     *  `AXE_EXEMPT_SELECTOR` in `index.ts`. */
    exempt: number;
}

/**
 * Maps one browser walk's raw measurements onto `Readings`. Pure and outside
 * `index.ts` (which boots the whole CLI on import) so the mapping is
 * unit-testable without a browser.
 */
export function readingsOf(probe: ProbeResult, axe: AxeCount): Readings {
    return {
        cardsZero: probe.cards.zero,
        cardsStranded: probe.cards.stranded,
        cardsSquare: probe.cardsSquareN,
        cardsSoft: probe.cardsSoftN + probe.cardsSoftUnknown,
        ctrlsZero: probe.ctrls.zero,
        ctrlsStranded: probe.ctrls.stranded,
        axeSerious: axe.serious,
        axeCritical: axe.critical,
        hOverflow: probe.hOverflow,
        cardsOcc: probe.cards.occ,
        ctrlsOcc: probe.ctrls.occ,
        small: probe.smallN,
        starved: probe.starvedN,
    };
}

/** Every Floor a measurement breaks, with its reading, in `FLOORS` order.
 *  Shape Readings are never consulted. */
export function brokenFloors(
    readings: Readings
): { floor: Floor; reading: number }[] {
    return FLOORS.filter((floor) => readings[floor] > 0).map((floor) => ({
        floor,
        reading: readings[floor],
    }));
}

/** A surface the lane defines and does not walk, and why. */
export interface UnwalkedSurface {
    surface: string;
    /** Why it cannot hold the Floors today, and what would let it. */
    reason: string;
    /** The open issue that walks it. */
    issue: number;
}

/**
 * The surfaces declared unwalked. Each is named on the coverage line of every
 * receipt whose scope contains it, counted out of the measured numerator, and
 * never a failure. An entry is deleted by the slice that walks the surface;
 * `ui-gate-floors.test.ts` refuses one naming an undefined surface or no issue.
 */
export const UNWALKED_SURFACES: readonly UnwalkedSurface[] = [
    {
        surface: "game-board",
        reason: "the walk deals a solo game, so it measures a position nobody chose — two runs of one unchanged tree read different card counts; it needs a declared position (ADR 0132 §4)",
        issue: 3695,
    },
    {
        surface: "game-card-preview",
        reason: "the Card Preview is measured over the fixed stress position, which the lane has not yet re-proven it reaches (see game-stress)",
        issue: 3506,
    },
    {
        surface: "game-stress",
        reason: "the stress-position board walk was withdrawn behind a blocker that has since been fixed, and has not been re-proven",
        issue: 3506,
    },
];
