/**
 * The surfaces `bun run check:ui` walks, and the click sequences that reach
 * them (issue #2580). One entry here == one row in `budgets.json`; the two
 * lists are cross-checked by `evaluateRun`, so adding a surface without a
 * budget reds the lane instead of quietly measuring nothing.
 *
 * The walks are the executable copy of `docs/guides/ui-runbooks.md`. When one
 * of them drifts, update BOTH — the runbook is what a human follows when the
 * lane says a surface is unreachable and they have to see why.
 *
 * THE RULE FOR A WALK: reaching the screen is best-effort, but a failure to
 * reach it is never swallowed. Throw `Unreachable` with a reason a human can
 * act on ("no event with a pool"), and the lane reports the surface UNWALKED
 * and exits non-zero. Never fall back to a different screen and probe that.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION: the lane never concedes a match it did not
 * create and never loads a debug scenario into a game it did not create. A
 * pre-existing game is resumed read-only, and the surfaces that would clobber
 * it report UNWALKED. That is why an active game makes the lane red rather
 * than making it lie.
 */
import type { Page } from "playwright";
// The fixture's labels come from the leaf module the SEEDING mutation reads
// them from — one definition, so renaming a label cannot leave the lane
// addressing a row that no longer exists (issue #2822 review). It is that
// leaf and never `convex/limitedFixtures.ts` itself: the seeder is a
// registered Convex function module, and importing it here would pull
// gitignored `convex/_generated` into `bun run land` (round 2). Aliased to
// the shorter names the walks read with; see the block above
// `FIXTURE_LIST_PATH` for what they address.
import {
    UI_GATE_DRAFT_LABEL as FIXTURE_DRAFT_LABEL,
    UI_GATE_LABEL_PREFIX as FIXTURE_LABEL_PREFIX,
    UI_GATE_OPEN_LABEL as FIXTURE_OPEN_LABEL,
} from "../../convex/limited/uiGateFixtureLabels";

/** Thrown by a walk that could not reach its screen. Reason is user-facing. */
export class Unreachable extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "Unreachable";
    }
}

export interface WalkContext {
    baseUrl: string;
    /** The debug-scenario label the stress board surface loads. */
    stressScenarioLabel: string;
    /** Set once the lane has created the active game itself. */
    createdGame: boolean;
    /** Issue #2671 review H2. The `deck-builder` walk's fixture import trips
     *  `useDeckWorkspace`'s autosave, so a real `userDecks` row exists by the
     *  time `walk()` returns. `walk()` records the auto-assigned name here;
     *  `cleanup()` reads it (on the SAME page, right after the probe has
     *  measured this exact state) to delete that one row by name from the
     *  lobby's My Decks list, then clears the field. `undefined` means
     *  nothing to clean up. */
    lastCreatedDeckName?: string;
    log(message: string): void;
}

export interface Surface {
    id: string;
    label: string;
    /**
     * Walk this surface BEFORE the lane signs in, on the signed-out page.
     *
     * The auth screen is the one thing `<AuthGate>` makes unreachable to a
     * signed-in session, so it was invisible to this lane by construction —
     * the very screen every user meets first was the only one with no
     * measurement behind it. A `preAuth` surface is walked at the top of each
     * viewport's context; `ensureSignedIn` re-navigates to the app root
     * afterwards, so leaving the sign-in form mid-flow costs the rest of the
     * run nothing.
     */
    preAuth?: boolean;
    walk(page: Page, ctx: WalkContext): Promise<void>;
    /**
     * Runs AFTER the probe/axe/screenshot for this surface+viewport pass, on
     * the SAME page (issue #2671 review H2) — so it can undo state `walk()`
     * had to create for the probe to have something real to measure, without
     * touching what the probe already captured. A failure here is logged and
     * swallowed (`index.ts`'s `measure()`): cleanup is hygiene, not part of
     * the measurement this surface exists to take.
     */
    cleanup?(page: Page, ctx: WalkContext): Promise<void>;
}

const NAV_TIMEOUT = 20_000;
const STEP_TIMEOUT = 8_000;

/** Convex holds a websocket open, so `networkidle` never fires — settle on the
 *  app shell plus a short quiet period instead. */
async function settle(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await page
        .locator("main, [data-app-shell], body > #root")
        .first()
        .waitFor({ timeout: NAV_TIMEOUT })
        .catch(() => {});
    await page.waitForTimeout(1200);
}

async function goto(page: Page, ctx: WalkContext, path: string): Promise<void> {
    await page.goto(`${ctx.baseUrl}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
    });
    await settle(page);
}

async function visible(
    page: Page,
    selector: string,
    timeout = STEP_TIMEOUT
): Promise<boolean> {
    try {
        await page
            .locator(selector)
            .first()
            .waitFor({ state: "visible", timeout });
        return true;
    } catch {
        return false;
    }
}

async function clickIfVisible(
    page: Page,
    selector: string,
    timeout = STEP_TIMEOUT
): Promise<boolean> {
    if (!(await visible(page, selector, timeout))) return false;
    await page.locator(selector).first().click({ timeout: STEP_TIMEOUT });
    return true;
}

/**
 * Open an event's page from `/limited`.
 *
 * The row's `View` is a BUTTON that navigates programmatically, not an
 * anchor — harvesting `a[href^='/limited/']` finds nothing and reports "no
 * event on this deployment" on a page that is showing one. Click the control
 * the runbook names.
 */
const EVENT_VIEW = "button:has-text('View'), a:has-text('View')";

/**
 * THE SEEDED FIXTURE (issue #2822). Every Limited/Draft walk below addresses
 * ONE labelled event, never "the first row of whatever this account can see".
 *
 * The disease this cures: `listOpenLimitedEvents` returns every open event on
 * the deployment to everyone, so both the ROW COUNT of `/limited` and WHICH
 * SEAT the Draft Room walks measured were functions of a month of hand-made
 * events rather than of the code under test — `budgets.json` ceilings rotted
 * with no `src/` change, twice, with byte-identical numbers
 * (`docs/findings/2671-limited-list-budgets-drifted.md`). Giving the lane its
 * own account would not have bounded the list; addressing a fixture does.
 *
 * The rows are seeded by `convex/limitedFixtures.ts` and are DEPLOYMENT-LOCAL
 * (nothing in git, same tradeoff as a `debugScenarios` label). A missing
 * fixture is therefore an expected state, and it reports UNWALKED carrying
 * `SEED_FIXTURES_COMMAND` — never a fallback walk of some other event, which
 * is precisely what used to make a PASS mean less than it read.
 *
 * `FIXTURE_LABEL_PREFIX` / `FIXTURE_OPEN_LABEL` / `FIXTURE_DRAFT_LABEL` are
 * imported at the top of this file from `convex/limitedFixtures.ts` — the
 * seeder owns the strings, this file only addresses them.
 */
const SEED_FIXTURES_COMMAND = `bunx convex run limitedFixtures:seedUiGateFixtures '{"email":"<TOLARIA_UI_EMAIL>"}'`;

/** The list, narrowed to the fixture rows by the `?label=` prefix filter
 *  (`src/router.tsx`). This is what makes the two list surfaces' row count a
 *  function of the LANE (two seeded events) instead of the deployment. */
const FIXTURE_LIST_PATH = `/limited?label=${FIXTURE_LABEL_PREFIX}`;

/** The row handle `limited-event-list-item.tsx` renders for a labelled event.
 *  `key={event._id}` is a React key, not an attribute — before this there was
 *  nothing in the DOM to select one specific event with. */
function fixtureRow(label: string): string {
    return `[data-limited-event-label="${label}"]`;
}

/** A pack tile in the Draft Room. Two traps in one selector:
 *  - the card NAME is only in the aria-label (`limited-draft-pack-card.tsx`),
 *    never in the text content, so `:has-text('Draft pick')` matches nothing;
 *  - the tile is a `div role="button"` (it has to be — it is also the dnd-kit
 *    draggable), so the `button[...]` selector this used to be matched ZERO
 *    tiles on a live pack. That is why `budgets.json` recorded "renders no
 *    pack for this seat right now": the lane was looking for an element that
 *    does not exist (issue #2587). */
const DRAFT_PICK_TILE = "[role=button][aria-label^='Draft pick:']";

/** The phone-only snap surface and its two strip halves (issue #2588). Absent
 *  at desktop/tablet widths, where the room renders the STACKED arrangement
 *  instead — Booster band on top, Pool band beneath, each with its own
 *  scroller (issue #2820; there is no `"split"` layout value any more). */
const DRAFT_SNAP_SCROLLER = "[data-slot=draft-snap-scroller]";
const DRAFT_STRIP_DROP = "[data-slot=draft-strip-drop]";
const DRAFT_POOL = "[data-slot=draft-pool]";

/** The Pool's OWN scroll band in the stacked arrangement (issue #2820,
 *  `limited-draft-table.tsx` — `min-h-[17.5rem] flex-1 overflow-y-auto`).
 *
 *  Named explicitly, because the thing it replaced — "walk UP from
 *  `DRAFT_POOL` and scroll the first ancestor that overflows" — is precisely
 *  the shape issue #2822 exists to kill, one element up from the event list.
 *  An ancestor search does not say WHICH element it means, so when #2820
 *  changed the arrangement under it the search silently kept resolving: at
 *  every non-phone viewport it walked the whole chain to `<html>` and
 *  scrolled NOTHING (measured on the rebased tree: `draft-stacked-pool`
 *  508/508 at 1440x900x2, 287/287 at 820x1180x2, 441/441 at 1180x820x2 —
 *  `scrollHeight === clientHeight` at each, and every ancestor above it the
 *  same). Had ONE of those ancestors overflowed — `<main>` is one gesture
 *  from being a page scroller on this app, `docs/findings/2582-…` — it would
 *  have scrolled the PAGE and reported that as the pool at its far extent.
 *
 *  Its presence is now the walk's ASSERTION that the arrangement is still the
 *  one the walk was written for: absent, the surface goes UNWALKED and a
 *  human re-teaches it, rather than the lane quietly measuring elsewhere. The
 *  scrolling itself reaches past it into the pool's own scrollers — see
 *  `reachDraftPoolStop`. */
const DRAFT_STACKED_POOL = "[data-slot=draft-stacked-pool]";

/** A card tile inside the Pool/Sideboard pane, matched by the tooltip
 *  `DeckCardTile` always carries (`title="Remove <name>…"`,
 *  `limited-draft-pool.tsx`) — the same handle the component test suite
 *  drives (`getByTitle(/^Remove /)`). Scoped to `DRAFT_POOL`'s subtree so a
 *  desktop/tablet pane never accidentally matches a Booster tile instead
 *  (issue #2667, `draft-pool-peek`). */
const DRAFT_POOL_TILE = `${DRAFT_POOL} [data-card-tile][title^='Remove ']`;

/** The Peek Panel primitive both the Booster's own selection and the Pool's
 *  `DeckZonePeek` mount (`peek-panel.tsx`). Shared constant so `draft-pick`'s
 *  Booster panel and `draft-pool-peek`'s Pool panel assert the SAME mount
 *  point rather than two copies of the literal. */
const DRAFT_PEEK_PANEL = "[data-peek-panel]";

/** The one CTA that tells the POOL's `DeckZonePeek` apart from the BOOSTER's
 *  own `PeekPanel` — both render `[data-peek-panel]`, and the Booster's is
 *  already mounted by the time `draft-pool-peek` clicks anything
 *  (`pinDraftSelection`). `Move to…` is appended by `deck-zone-peek.tsx`
 *  alone, from its column-pin sheet. `EditingActionButton` publishes each
 *  CTA's label as `data-editing-action` (`editing-action-button.tsx`), which
 *  is the same handle the component suites drive. */
const DRAFT_POOL_PEEK_CTA = `${DRAFT_PEEK_PANEL} [data-editing-action="Move to…"]`;

/**
 * Pins the Draft Room's Selected Card state (issue #2677). `seat.selectedPickId`
 * is SERVER state (`selectDraftPick`, ADR 0060) that survives across gate runs
 * on the SAME deployment — it is not reset by loading the room, and there is
 * no UI affordance to clear it (`setPeekClosedFor`, the Peek Panel's own
 * close button, only hides the panel locally; the mutation's `pickId: null`
 * clear path is never called from the client). That made the two Draft Room
 * surfaces' readings depend on whatever a PRIOR session left selected on this
 * seat rather than on anything this run controls — three runs on one pass
 * produced three different occlusion counts.
 *
 * Of the two states, only "has a Selected Card" is reachable
 * DETERMINISTICALLY: a single click on whichever tile the pack shows on top
 * OVERWRITES any prior selection with that tile's own `pickId`
 * (`selectDraftPick`'s handler always overwrites, never toggles) — idempotent
 * regardless of what the deployment already held. "No Selected Card" has no
 * such reachable action from this walk, so it is the state left unpinned.
 *
 * Waits for the tile's OWN aria-label to grow the "(selected)" suffix
 * (`limited-draft-pack-card.tsx`) rather than for the Peek Panel to mount,
 * because the panel does NOT mount on a phone at all (issue #2588 inlines its
 * CTA row into the snap strip there) — the aria-label flip is the one
 * completion signal common to every viewport this lane walks.
 */
async function pinDraftSelection(page: Page): Promise<void> {
    await page
        .locator(DRAFT_PICK_TILE)
        .first()
        .click({ timeout: STEP_TIMEOUT });
    const selected = await visible(
        page,
        "[role=button][aria-label*='(selected)']",
        STEP_TIMEOUT
    );
    if (!selected) {
        throw new Unreachable(
            'clicked a Draft Room pack tile to pin the Selected Card seat state, but no tile\'s aria-label ever gained "(selected)" — the selectDraftPick round-trip did not land'
        );
    }
}

/**
 * Land on `/limited/<id>/draft` with a live pack for this seat, with the
 * Selected Card seat state pinned (`pinDraftSelection`, issue #2677).
 *
 * Issue #2587 moved the pick screen OFF the event page onto its own immersive
 * route. Two ways in, and the walk takes whichever the deployment offers: the
 * event page redirects a seated player while a Pick is pending (one-shot per
 * tab), and once that shot is spent the event page offers "Enter the Draft
 * Room". Shared by both draft surfaces, so the two can never drift apart
 * about what "the room" means OR what seat state they measure in.
 */
async function reachDraftRoom(page: Page, ctx: WalkContext): Promise<void> {
    const landed = await openFixtureEvent(page, ctx, FIXTURE_DRAFT_LABEL);
    if (landed === "event") {
        if (
            !(await clickIfVisible(
                page,
                "a:has-text('Enter the Draft Room')",
                4000
            ))
        ) {
            throw new Unreachable(
                `the "${FIXTURE_DRAFT_LABEL}" fixture's event page offered no "Enter the Draft Room" — its seat has no live pack. Re-seed it: ${SEED_FIXTURES_COMMAND}`
            );
        }
        await page
            .waitForURL(/\/draft$/, { timeout: NAV_TIMEOUT })
            .catch(() => {});
        await settle(page);
    }
    if (!page.url().endsWith("/draft")) {
        throw new Unreachable(
            `the "${FIXTURE_DRAFT_LABEL}" fixture did not land in the Draft Room — the page is at ${page.url()}`
        );
    }
    // The room renders for a Sealed seat too (reveal mode), so reaching the
    // URL is not enough: the surface these rows budget is the PICK screen, and
    // its tiles are the proof.
    if (!(await visible(page, DRAFT_PICK_TILE, 4000))) {
        throw new Unreachable(
            `the "${FIXTURE_DRAFT_LABEL}" fixture's Draft Room rendered no pack tile for this seat. Re-seed it: ${SEED_FIXTURES_COMMAND}`
        );
    }
    await pinDraftSelection(page);
}

/**
 * Reach the Draft Room's POOL stop — the SECOND state of `/draft`, and the
 * biggest new surface issue #2588 shipped. The `draft-pick` walk returns as
 * soon as a pack tile is visible, so it always measures the PACK stop; the
 * pool pane went in with no browser measurement at all (review finding 1 on
 * PR #2652), which is exactly the #2511 shape: in portrait `LimitedDraftPool`
 * runs `arrange="column"`, so two `DeckZoneSurface`s share ~70% of a 390x844
 * screen, and a collapsed MV row passes every happy-dom test there is.
 *
 * Off a phone there is no snap surface (`useViewportMode` calls both tablets
 * "desktop"), so the equivalent state is every scroller the pool owns driven
 * to its end — still the pool at its far extent, still a state `draft-pick`
 * never probes. Which element that IS changed with issue #2820: see the
 * scroll block below, and `DRAFT_STACKED_POOL`.
 *
 * Extracted (issue #2667 review) so `draft-pool-peek` can reach the SAME pool
 * stop and then go one gesture further (select a tile, mount the Peek Panel)
 * instead of duplicating this reach logic.
 */
async function reachDraftPoolStop(page: Page, ctx: WalkContext): Promise<void> {
    await reachDraftRoom(page, ctx);
    await assertTwoSnapStops(page);

    if (await visible(page, DRAFT_SNAP_SCROLLER, 2000)) {
        if (
            !(await clickIfVisible(
                page,
                `${DRAFT_STRIP_DROP}[data-zone=maindeck]`,
                4000
            ))
        ) {
            throw new Unreachable(
                "the phone Draft Room rendered a snap scroller but no pool strip drop target to swipe with"
            );
        }
        await page.waitForTimeout(700);
        const stop = await page
            .locator(DRAFT_SNAP_SCROLLER)
            .first()
            .getAttribute("data-stop");
        if (stop !== "pool") {
            throw new Unreachable(
                `tapping the pool strip left the Draft Room at data-stop="${stop ?? "null"}" instead of "pool"`
            );
        }
        // Reaching the stop is NOT reaching the pool. `pool.length === 0`
        // makes `LimitedDraftPool` return an `EmptyState` with no
        // `[data-slot=draft-pool]` at all, and neither `probe.js` (no
        // card-count floor) nor `budgets.ts` (no minimum-n rule) can
        // tell an empty pane from a healthy one: a Pick #1 seat would
        // score `zero0 occ0 stranded0 starved0` and pass GREEN, making
        // the one measurement that discharges the pool pane's layout
        // claims silently vacuous. Same guard the stacked branch below
        // runs — the fixture, not the stop, is what must be asserted.
        if (!(await visible(page, DRAFT_POOL, 4000))) {
            throw new Unreachable(
                'the phone Draft Room reached the pool stop but rendered no pool pane — this surface needs a seat with a NON-EMPTY pool (make a few picks in the room first: select a tile, then [data-editing-action="Pick"])'
            );
        }
        return;
    }

    if (!(await visible(page, DRAFT_POOL, 4000))) {
        throw new Unreachable(
            "the Draft Room rendered no pool pane — this seat's pool toggle may be off, or the pool is empty (this surface needs a NON-EMPTY pool: make a few picks first)"
        );
    }
    if (!(await visible(page, DRAFT_STACKED_POOL, 4000))) {
        throw new Unreachable(
            `the Draft Room rendered a pool pane but no "${DRAFT_STACKED_POOL}" band to scroll it in — the non-phone arrangement changed (issue #2820 restored the stacked one) and this walk has to be re-taught which element IS the pool's scroller. Refusing to guess: scrolling whatever ancestor happens to overflow is how a walk starts measuring the page instead of the pool`
        );
    }
    // Drive EVERY scroller the pool owns to its end, ON ITS OWN AXIS, and
    // count how many actually had somewhere to go.
    //
    // Both halves of that are load-bearing, and each replaces a wrong
    // assumption the split-era walk carried:
    //
    //   - The BAND is not where the pool's overflow lives. Measured on the
    //     rebased tree, `draft-stacked-pool` is 508/508, 287/287 and 441/441
    //     (`scrollHeight`/`clientHeight`) at the three non-phone viewports —
    //     it never overflows, because its `flex-1` gives it whatever the
    //     Booster band leaves and its `min-h-[17.5rem]` floor keeps that
    //     honest. Scrolling only the band is a guaranteed no-op.
    //   - The overflow lives INSIDE `[data-slot=draft-pool]`, in
    //     `DeckZoneSurface`'s own card scroller (`deck-zone-surface.tsx:674`,
    //     `flex overflow-auto md:snap-none` — `snap-x` in the columns
    //     branch, so its far extent is the LAST Mana-Value column). At
    //     820x1180x2 that box is 201px around a 358px column and 12 of the
    //     24 pool tiles sit outside their port. A walk that leaves them there
    //     has not reached "the pool at its far extent"; it has re-measured
    //     `draft-pick`'s DOM under a second surface id, which is coverage
    //     that reads as two rows and proves one.
    //
    // ONE AXIS PER SCROLLER, the one it actually scrolls on. `overflow-auto`
    // is both axes, and pinning both ends at once is not "the far extent" —
    // it is off the end of the content: driving the columns scroller's
    // scrollTop to a 358px column's bottom inside a 201px port lifts every
    // card clear of the port, and the row measures `cardsOcc 0 reach24`, a
    // pool pane with no pool visible in it. Horizontal wins where it exists
    // because that is the axis this pane READS on (`snap-x snap-mandatory`,
    // left-to-right by Mana Value); the vertical overflow beside it is the
    // starved-container debt the `starved` metric already reports, not a
    // reading direction.
    //
    // `moved` is what makes the difference reportable rather than assumed: 0
    // means every scroller already fit, so this row IS `draft-pick`'s DOM at
    // that viewport and the `knownDebt` note has to say so.
    const stop = (await page.evaluate(`(() => {
        const roots = [document.querySelector("${DRAFT_STACKED_POOL}")];
        const pool = document.querySelector("${DRAFT_POOL}");
        if (pool) roots.push(pool, ...pool.querySelectorAll("*"));
        let scrollers = 0;
        let moved = 0;
        for (const el of roots) {
            if (!el) continue;
            const cs = getComputedStyle(el);
            if (!/auto|scroll/.test(cs.overflowY + cs.overflowX)) continue;
            const dy = el.scrollHeight - el.clientHeight;
            const dx = el.scrollWidth - el.clientWidth;
            if (dy <= 2 && dx <= 2) continue;
            scrollers++;
            if (dx > 2) el.scrollLeft = el.scrollWidth;
            else el.scrollTop = el.scrollHeight;
            if (el.scrollTop > 2 || el.scrollLeft > 2) moved++;
        }
        return { scrollers: scrollers, moved: moved };
    })()`)) as { scrollers: number; moved: number };
    if (stop.scrollers > 0 && stop.moved === 0) {
        throw new Unreachable(
            `the Draft Room's pool has ${stop.scrollers} overflowing scroller(s) and not one of them would move — this surface measures the pool AT its far extent, and it is not there`
        );
    }
    await page.waitForTimeout(400);
}

/**
 * Issue #2588 AC 1/2: on a phone the room is ONE scroller with
 * `scroll-snap-type: y mandatory` holding two 85% panes, so exactly two
 * offsets rest — `0` and the scroller's own maximum. Nothing in between is a
 * resting position, which is what makes each strip a stable tab rather than a
 * band that drifts half off screen.
 *
 * `draftSnapStops.test.ts` proves the arithmetic that produces the
 * percentages, but it runs on happy-dom, which has no scroller and no
 * snapping — so it cannot prove the RESTING BEHAVIOUR, and until this helper
 * existed nothing did (review finding 1 on PR #2652). Sample offsets across
 * the range, let each settle, collect the distinct values it comes to rest at.
 *
 * A no-op off a phone: the stacked arrangement has no snap scroller.
 */
async function assertTwoSnapStops(page: Page): Promise<void> {
    if (!(await visible(page, DRAFT_SNAP_SCROLLER, 2000))) return;
    // Passed as a STRING, like `runProbe`'s call in `index.ts`: this file is
    // compiled by `tsconfig.node.json`, which carries no `dom` lib, so an
    // inline browser closure would not type-check.
    const result = (await page.evaluate(`(async () => {
        const s = document.querySelector("${DRAFT_SNAP_SCROLLER}");
        if (!s) return null;
        // The AXIS is the one thing the orientation changes (see
        // \`useDraftSnapStops\`): portrait swipes down, landscape sideways.
        // Reading scrollTop on the landscape scroller measures a range of 0
        // and reports the panes "did not lay out" on a screen that is fine.
        const x = s.getAttribute("data-orientation") === "landscape";
        const max = Math.round(
            x ? s.scrollWidth - s.clientWidth : s.scrollHeight - s.clientHeight
        );
        if (max < 8) return { axis: x ? "x" : "y", max: max, rested: [], note: "no scrollable range" };
        const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
        const to = (v) => s.scrollTo(x ? { left: v, behavior: "instant" } : { top: v, behavior: "instant" });
        const rested = [];
        for (let i = 0; i <= 10; i++) {
            to((max * i) / 10);
            await frame();
            const at = Math.round(x ? s.scrollLeft : s.scrollTop);
            const snapped = at <= 2 ? 0 : Math.abs(at - max) <= 2 ? max : at;
            if (rested.indexOf(snapped) === -1) rested.push(snapped);
        }
        to(0);
        await frame();
        return { axis: x ? "x" : "y", max: max, rested: rested, note: "" };
    })()`)) as {
        axis: string;
        max: number;
        rested: number[];
        note: string;
    } | null;

    if (result === null) return;
    if (result.note !== "") {
        throw new Unreachable(
            `the phone Draft Room's snap scroller has no scrollable range on its ${result.axis} axis (max ${result.max}px) — the two panes did not lay out`
        );
    }
    const unexpected = result.rested.filter((v) => v !== 0 && v !== result.max);
    if (unexpected.length > 0 || result.rested.length !== 2) {
        throw new Unreachable(
            `the phone Draft Room rests at ${result.rested.length} ${result.axis}-offsets [${result.rested.join(", ")}], not exactly the two AC 1 requires ([0, ${result.max}])`
        );
    }
}

/**
 * Land on the fixture-filtered `/limited` list and assert the fixture is
 * actually seeded on this deployment.
 *
 * Returns the number of fixture rows, which is a constant of
 * `convex/limitedFixtures.ts` — that is the whole point: the list surfaces
 * measure a row set the lane fixes.
 */
async function reachFixtureList(page: Page, ctx: WalkContext): Promise<number> {
    await goto(page, ctx, FIXTURE_LIST_PATH);
    if (!(await visible(page, "main, [role=main]", 10_000))) {
        throw new Unreachable("/limited rendered no main region");
    }
    const rows = await page.locator("[data-limited-event-label]").count();
    if (rows === 0) {
        throw new Unreachable(
            `no seeded Limited fixture on this deployment — seed it with: ${SEED_FIXTURES_COMMAND}`
        );
    }
    return rows;
}

/**
 * Open the fixture event with this label, and report where it landed.
 *
 * Since issue #2587 the event page REDIRECTS a seated player into the Draft
 * Room (`/limited/<id>/draft`) while a Pick is pending — one-shot per tab, so
 * the first open of a drafting event lands on the room and a later one does
 * not. Both are legitimate landings, which is why this returns the pathname
 * shape rather than a boolean "did we reach the event page": a walk that
 * demanded the old URL would report a drafting event as unreachable.
 *
 * `null` is never "try the next row" any more (issue #2822) — there is no
 * next row. It means this fixture's own View control led somewhere
 * unrecognised, and every caller turns that into UNWALKED.
 */
async function openFixtureEvent(
    page: Page,
    ctx: WalkContext,
    label: string
): Promise<"event" | "draft" | null> {
    await goto(page, ctx, `/limited?label=${label}`);
    const row = page.locator(fixtureRow(label));
    if ((await row.count()) === 0) {
        throw new Unreachable(
            `the seeded Limited fixture "${label}" is not on this deployment — seed it with: ${SEED_FIXTURES_COMMAND}`
        );
    }
    await row.first().locator(EVENT_VIEW).first().click({
        timeout: STEP_TIMEOUT,
    });
    await page
        .waitForURL(/\/limited\/[^/]+(\/draft)?$/, { timeout: NAV_TIMEOUT })
        .catch(() => {});
    await settle(page);
    const path = new URL(page.url()).pathname;
    if (/^\/limited\/[^/]+\/draft$/.test(path)) return "draft";
    if (/^\/limited\/[^/]+$/.test(path)) return "event";
    return null;
}

/** The event id the page is currently on — how a walk reaches a route that
 *  has no link from the event page (`/limited/<id>/build` for a seat still
 *  mid-draft). Derived from the URL the fixture's own row navigated to, so it
 *  is still the fixture being addressed, never a positional guess. */
function currentEventId(page: Page): string {
    const match = /^\/limited\/([^/]+)/.exec(new URL(page.url()).pathname);
    if (!match) {
        throw new Unreachable(
            `expected to be on a /limited/<id> route, but the page is at ${page.url()}`
        );
    }
    return match[1];
}

/* The v4 lobby's walk hooks (ADR 0103 §6, issue #2726). ATTRIBUTES, not
 * `:has-text()` literals, because neither control the walk needs carries a
 * stable string any more: a Deck Shelf tile's visible text is the deck NAME
 * (its "Select <name>" is an `aria-label`, which `:has-text` does not read),
 * and the Loadout's single ivory plate is NAMED BY the selected Mode Tile
 * ("Play vs Bot" on a cold lobby), so `button:has-text('Solo Game')` would
 * match the Mode TILE — which selects and starts nothing. Both attributes are
 * declared as walk seams at their component (`deck-shelf-tile.tsx`,
 * `lobby-loadout.tsx`) and exercised through the real lobby wiring in
 * `src/components/lobby/__tests__/lobby.test.tsx`. */
const DECK_TILE_SELECTED = '[data-deck-tile][data-selected="true"]';
const DECK_TILE_SELECT = "[data-deck-tile] [data-deck-select]:not([disabled])";
const MODE_TILE_SOLO = '[data-mode-tile="solo"]';
const LOBBY_PRIMARY = "[data-lobby-primary]:not([disabled])";

/**
 * Reach a live board. Runbook: "Start a solo game from cold" plus its
 * "Blocked by an active game" branch — with the branch resolved the safe way
 * round (Resume, never Concede: ending someone's match is their call).
 */
async function ensureBoard(page: Page, ctx: WalkContext): Promise<void> {
    if (page.url().includes("/game")) {
        if (await visible(page, "text=/Pass|YOUR GO|Untap|Upkeep/i", 4000))
            return;
    }
    await goto(page, ctx, "/");

    // Already inside a match? Resume it — read-only, and it is the only branch
    // that does not destroy state the developer may care about.
    if (await clickIfVisible(page, "button:has-text('Resume')", 4000)) {
        ctx.log("resumed the pre-existing active game");
    } else {
        // 1. A deck has to be the Loadout's ACTIVE one before the primary
        //    action ungates. An already-selected tile and an illegal one are
        //    both `disabled`, so this addresses the first tile that can
        //    actually take the selection — and the step is skipped outright
        //    when a tile already carries the selection. That is the SECOND
        //    `ensureBoard` call inside one viewport (`game-board` then
        //    `game-stress`, both below), which shares the context and so the
        //    `tolaria:selectedDeckId` the first call wrote. It is NOT how a
        //    later VIEWPORT starts: `index.ts`'s `browser.newContext({viewport,
        //    …})` passes no `storageState`, so every viewport begins with empty
        //    storage and viewports 2-5 reach a board through the `Resume`
        //    branch above, on the game viewport 1 created.
        if (!(await visible(page, DECK_TILE_SELECTED, 2000))) {
            if (!(await clickIfVisible(page, DECK_TILE_SELECT, 6000))) {
                throw new Unreachable(
                    "the lobby offered neither Resume nor a selectable Deck Shelf tile — is the deployment seeded with preset decks?"
                );
            }
            await page.waitForTimeout(400);
        }
        // 2. A Mode Tile SELECTS; it never starts anything. "Solo game" is the
        //    one whose primary action creates a game outright — the default
        //    "Play vs Bot" tile opens the vs-AI setup dialog instead, and
        //    "Open a table" hosts a seat and waits for a second player.
        if (!(await clickIfVisible(page, MODE_TILE_SOLO, 6000))) {
            throw new Unreachable(
                "the lobby's Mode Tiles offered no 'Solo game' tile — is the game-mode selector stuck on Cockatrice mode?"
            );
        }
        // 3. The single ivory plate, which now reads "Solo game".
        if (!(await clickIfVisible(page, LOBBY_PRIMARY, 6000))) {
            throw new Unreachable(
                "the Loadout's primary action stayed disabled after selecting a deck and the 'Solo game' Mode Tile"
            );
        }
        ctx.createdGame = true;
        ctx.log("created a solo game");
    }

    await page.waitForURL(/\/game/, { timeout: NAV_TIMEOUT }).catch(() => {
        throw new Unreachable("the lobby never routed to /game");
    });
    await settle(page);

    // Coin toss, then one mulligan prompt per seat. Both are conditional: a
    // resumed game is usually past them.
    await clickIfVisible(page, "button:has-text('Play')", 6000);
    for (let seat = 0; seat < 2; seat++) {
        if (!(await clickIfVisible(page, "button:has-text('Keep')", 6000)))
            break;
        await page.waitForTimeout(800);
    }
    await settle(page);

    if (
        !(await visible(
            page,
            "text=/Pass|YOUR GO|Untap|Upkeep|Library/i",
            10_000
        ))
    ) {
        throw new Unreachable(
            "reached /game but no board affordance rendered within 10s"
        );
    }
}

export const SURFACES: readonly Surface[] = [
    {
        id: "auth-sign-in",
        label: "Sign in (signed out, /)",
        preAuth: true,
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "input[type=email]", 15_000))) {
                throw new Unreachable(
                    "the app root did not render the sign-in form — is this context already signed in?"
                );
            }
        },
    },
    {
        id: "auth-forgot-password",
        label: "Password reset, step 1 (signed out, / → Forgot password?)",
        preAuth: true,
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "input[type=email]", 15_000))) {
                throw new Unreachable(
                    "the app root did not render the sign-in form — is this context already signed in?"
                );
            }
            if (
                !(await clickIfVisible(
                    page,
                    "button:has-text('Forgot password')"
                ))
            ) {
                throw new Unreachable(
                    "no `Forgot password?` control on the sign-in screen"
                );
            }
            if (!(await visible(page, "button:has-text('Send Code')", 6000))) {
                throw new Unreachable(
                    "`Forgot password?` did not swap in the reset form"
                );
            }
            await settle(page);
            // STEP 2 (code + new password) is NOT walked: reaching it needs a
            // live `flow: "reset"` round-trip, which mints a real OTP and
            // spends a real Resend send on every viewport of every run. The
            // step-2 layout is covered by
            // `src/components/auth/__tests__/forgot-password-form.test.tsx`
            // for behaviour and by a hand-driven CDP pass for layout — see
            // `docs/guides/ui-runbooks.md`.
        },
    },
    {
        id: "lobby",
        label: "Lobby (/)",
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable("the lobby rendered no main region");
            }
        },
    },
    {
        id: "deck-builder",
        label: "Constructed deck builder (/decks/create)",
        async walk(page, ctx) {
            await goto(page, ctx, "/decks/create");
            if (!(await visible(page, "input, button", 10_000))) {
                throw new Unreachable("the deck builder rendered no controls");
            }
            // Issue #2671: this walk used to leave both zones empty, which hid
            // a regression class from the probe entirely — `starved` can only
            // fire once a real card TILE exists to compare a shrunk port
            // against (`scripts/ui-gate/probe.js`), and an empty zone has no
            // tile. Importing a tiny decklist seeds both zones without a drag
            // simulation (the same `Import` entry point a player uses).
            const DIALOG_TEXTAREA = '[role="dialog"] textarea';
            const DIALOG_PREVIEW =
                "[role=\"dialog\"] button:has-text('Preview')";
            const DIALOG_CONFIRM = "[role=\"dialog\"] button:has-text('Add ')";
            if (
                !(await clickIfVisible(page, "button:has-text('Import')", 6000))
            ) {
                throw new Unreachable(
                    "the deck builder offered no Import button"
                );
            }
            if (!(await visible(page, DIALOG_TEXTAREA, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Import decklist dialog did not open"
                );
            }
            // Every card in this builder renders as a member of an OVERLAID
            // Column pile (ADR 0075, `deck-column-pile.tsx`), stacked
            // whenever 2+ cards share a grouping bucket — by design, not a
            // defect, and orthogonal to this issue. A decklist with any
            // duplicate name or two cards of the same mana value would stack
            // a pile and paint the probe's centre-point occlusion check on
            // ITS OWN buried tiles, noise this fixture has no reason to
            // carry. Every line below is both a UNIQUE name and its own
            // distinct mana value (one basic land total, so the "Lands" pile
            // never gets a second member either) — no two cards this walk
            // adds can ever land in the same pile.
            await page
                .locator(DIALOG_TEXTAREA)
                .fill(
                    "Deck\n1 Forest\n1 Llanowar Elves\n1 Grizzly Bears\n\nSideboard\n1 Shivan Dragon\n1 Circle of Protection: Red"
                );
            if (!(await clickIfVisible(page, DIALOG_PREVIEW, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Import dialog's Preview button never enabled"
                );
            }
            if (!(await visible(page, DIALOG_CONFIRM, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the pasted decklist resolved no cards to import"
                );
            }
            await page.locator(DIALOG_CONFIRM).first().click({
                timeout: STEP_TIMEOUT,
            });
            await page.waitForTimeout(600);
            // Issue #2671 review round 2 MUST-FIX: this capture used to sit
            // AFTER the "2/15" assertion below, so the one remaining throw
            // site in this walk (the sideboard check) left
            // `ctx.lastCreatedDeckName` unset — the one thing `cleanup()`
            // needs to find and delete the row — and `index.ts`'s cleanup
            // call (now always invoked, happy path or not — see the
            // `measure()` fix) had nothing to act on. The name is unrelated
            // to whether the import verifies: it is `nextDeckName()`'s
            // sequential "Deck N", computed client-side from the deck list at
            // MOUNT (`deck-builder.tsx:268`, `src/lib/userDecks.ts`), before
            // this walk ever opens the Import dialog — reading it here, right
            // after the confirm click, is no less accurate than reading it
            // after the sideboard check, and it moves the capture ahead of
            // every throw site that follows the import.
            //
            // The import above just tripped `useDeckWorkspace`'s autosave
            // (`useDeckWorkspace.ts`), which means a real `userDecks` row now
            // exists (or will, once `cleanup()` navigates away and the
            // flush-on-unmount fires).
            ctx.lastCreatedDeckName = await page
                .locator('input[placeholder="Deck name"]')
                .first()
                .inputValue()
                .catch(() => undefined);
            // "2/15" is this walk's own fixed decklist (Shivan Dragon +
            // Circle of Protection: Red) — a specific count, not just any
            // digit, so this fails loudly if the import silently dropped a
            // card instead of leaving the Sideboard genuinely empty.
            if (!(await visible(page, "text=/2\\/15/", STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Sideboard still reads empty after importing — the fixture card names may no longer resolve"
                );
            }
        },
        async cleanup(page, ctx) {
            const name = ctx.lastCreatedDeckName;
            if (!name) return;
            ctx.lastCreatedDeckName = undefined;
            // Navigating away unmounts the builder, which is what flushes a
            // still-pending autosave (`useDeckWorkspace`'s flush-on-unmount)
            // — the same mechanism that created the row, now guaranteed to
            // have run before the delete below looks for it.
            await goto(page, ctx, "/");
            const menuSelector = `button[aria-label="More actions for ${name}"]`;
            if (!(await visible(page, menuSelector, STEP_TIMEOUT))) {
                // Nothing to clean up — the row never landed (e.g. the
                // autosave lost a race with something else entirely).
                return;
            }
            await page.locator(menuSelector).first().click();
            const deleteItem = '[role="menuitem"]:has-text("Delete")';
            if (!(await clickIfVisible(page, deleteItem, STEP_TIMEOUT))) return;
            const confirmDelete = '[role="dialog"] button:has-text("Delete")';
            if (!(await clickIfVisible(page, confirmDelete, STEP_TIMEOUT))) {
                return;
            }
            await page.waitForTimeout(400);
        },
    },
    {
        id: "deck-detail",
        label: "Deck detail (/decks/mono-red-burn)",
        async walk(page, ctx) {
            // `mono-red-burn` is a code-defined preset (`convex/deckPresets.ts`)
            // seeded into the `presetDecks` table on every deployment — always
            // present, unlike a user deck, so the walk needs no prior create
            // step (issue #2591: curve + legality + Edit/Play). `findDeckBySlug`
            // (`src/lib/deckLookup.ts`) matches `presetId === slug` exactly, so
            // the slug here MUST be a real entry in `deckPresets.ts` — a
            // deployment-only slug (e.g. a manually renamed row) throws
            // Unreachable on any other deployment.
            await goto(page, ctx, "/decks/mono-red-burn");
            if (
                !(await visible(page, "h1:has-text('Mono Red Burn')", 10_000))
            ) {
                throw new Unreachable(
                    "/decks/mono-red-burn did not render the deck detail heading"
                );
            }
        },
    },
    {
        id: "design-system",
        label: "Design system census (/admin/design-system)",
        async walk(page, ctx) {
            // The permanent census page (ADR 0101 names it the living record
            // of v3). It lives UNDER /admin — it was moved off the guessable
            // top-level path with the other curation surfaces (router.tsx).
            //
            // The reachability check is the census HEADING, not `main`: the
            // 404 page also renders a `main`, so a `main`-only assertion
            // measured the not-found screen and reported PASS. Measured
            // exactly that on the wrong path while writing this walk.
            await goto(page, ctx, "/admin/design-system");
            if (
                !(await visible(
                    page,
                    "h1:has-text('Design system census')",
                    10_000
                ))
            ) {
                throw new Unreachable(
                    "/admin/design-system did not render the census heading"
                );
            }
        },
    },
    {
        id: "design-system-dialog",
        label: "GameDialog live demo (/admin/design-system → Open live demo)",
        async walk(page, ctx) {
            // The lane's only MODAL row. Every in-game dialog is a GameDialog,
            // and the census page opens a real one on demand — so the dialog
            // gets measured at all five viewports without touching a live game
            // (issue #2581; ADR 0101 §2 re-specifies the Panel frame those
            // dialogs are built on).
            await goto(page, ctx, "/admin/design-system");
            // The FIRST "Open live demo" is specimen A (GameDialog); B is the
            // plain shadcn dialog and C the ActionSheet. Wait rather than
            // probe: the census page is long and its sections mount late.
            const opener = page
                .getByRole("button", { name: "Open live demo" })
                .first();
            try {
                await opener.waitFor({ state: "visible", timeout: 10_000 });
            } catch {
                throw new Unreachable(
                    "/admin/design-system rendered no `Open live demo` button"
                );
            }
            await opener.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
            await opener.click({ timeout: STEP_TIMEOUT });
            if (!(await visible(page, "[role=dialog]", STEP_TIMEOUT))) {
                throw new Unreachable(
                    "`Open live demo` did not open a dialog within 8s"
                );
            }
            await page.waitForTimeout(400);
        },
    },
    {
        id: "limited-list",
        // Issue #2822: the list is walked FILTERED to the seeded fixture
        // (`?label=ui-gate/`). Unfiltered, this row measured however many
        // events the deployment happened to hold — 14 at the time, each one
        // adding interactive controls to the `small` count and pushing
        // `<main>` past the starvation threshold — so the ceiling moved
        // without a line of `src/` changing.
        label: "Limited events list (/limited, fixture-filtered)",
        async walk(page, ctx) {
            await reachFixtureList(page, ctx);
        },
    },
    {
        id: "limited-your-events",
        // Issue #2590: `/limited/events` is now a REDIRECT stub to
        // `/limited?mine=1` — the your-events page it used to render was
        // absorbed into the merged list. The walk proves the redirect
        // actually lands somewhere real rather than just checking "a main
        // region exists" (which a stuck redirect's own loading screen would
        // also satisfy).
        label: "Your Limited events redirect (/limited/events → /limited?mine=1)",
        async walk(page, ctx) {
            // The `label` param rides through the redirect (issue #2822, see
            // `limited-your-events.route.tsx`) — a redirect that dropped it
            // would land this surface back on the unbounded list, which is the
            // bug.
            await goto(
                page,
                ctx,
                `/limited/events?label=${FIXTURE_LABEL_PREFIX}`
            );
            // The redirect target's query string is `?mine=true`, not
            // `?mine=1` — `stringifySearch` serializes the boolean, it never
            // emits the numeric literal a hand-typed/bookmarked URL would use
            // (see `src/router.tsx`'s `validateSearch`, which accepts both on
            // the way IN). A pattern anchored to `?mine=1` can never match
            // this navigation, so it always burned the full NAV_TIMEOUT
            // before falling through to the weaker substring check below.
            await page
                .waitForURL(/\/limited(\?.*)?$/, { timeout: NAV_TIMEOUT })
                .catch(() => {});
            if (!page.url().includes("/limited")) {
                throw new Unreachable(
                    "/limited/events did not redirect to /limited"
                );
            }
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable(
                    "/limited/events redirected, but /limited rendered no main region"
                );
            }
            if (
                (await page.locator("[data-limited-event-label]").count()) === 0
            ) {
                throw new Unreachable(
                    `/limited/events redirected, but no seeded fixture row is on the list — either the redirect dropped ?label= or the fixture is missing. Seed it with: ${SEED_FIXTURES_COMMAND}`
                );
            }
        },
    },
    {
        id: "limited-antechamber",
        // Issue #2590: the event detail page — now a compact avatar row +
        // actions, with the Table Ring wired in as a dialog rather than
        // rendered inline. Lands specifically on the "event" case
        // `openLimitedEvent` reports — a drafting seat that gets redirected
        // straight to the Draft Room is a DIFFERENT surface (`draft-pick`
        // below), not this one.
        label: "Limited event antechamber (/limited/<id>)",
        async walk(page, ctx) {
            // The `ui-gate/open` fixture, specifically (issue #2822): seating
            // still open is the one event state whose detail page neither
            // redirects into the Draft Room (`useDraftRoomRedirect` needs a
            // pending pick) nor auto-opens the deck builder
            // (`useAutoOpenLimitedBuilder` needs a final pool). Both of those
            // are ONE-SHOT PER TAB, so a fixture that tripped either would
            // measure the antechamber at some viewports and a different screen
            // at others.
            if (
                (await openFixtureEvent(page, ctx, FIXTURE_OPEN_LABEL)) !==
                "event"
            ) {
                throw new Unreachable(
                    `the "${FIXTURE_OPEN_LABEL}" fixture did not land on its antechamber — it should still be OPEN (no pool, no pending pick). Re-seed it: ${SEED_FIXTURES_COMMAND}`
                );
            }
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable(
                    "the Limited event antechamber rendered no main region"
                );
            }
        },
    },
    {
        id: "limited-build",
        // Issue #2822 lifted this out of `unwalked`. It used to need "an
        // event whose seat offers Build Deck", which no event on the
        // deployment had; the mid-draft fixture supplies one — the builder
        // route needs only a dealt, non-empty pool
        // (`pool-deck-builder.tsx`), which is exactly what
        // `ui-gate/draft`'s seat 0 carries.
        label: "Limited pool builder (/limited/<id>/build)",
        async walk(page, ctx) {
            // Reached by URL rather than by a click: mid-draft there is no
            // Build Deck control on the event page (it appears once the pool
            // is FINAL), and the id comes from the fixture's own row, so this
            // is still label-addressed.
            await openFixtureEvent(page, ctx, FIXTURE_DRAFT_LABEL);
            const eventId = currentEventId(page);
            await goto(page, ctx, `/limited/${eventId}/build`);
            // A CARD TILE, not the "Build Limited Deck" heading: on a short
            // viewport `DeckBuilderHeader` hides the whole Back+title band by
            // design (`short-viewport:hidden`), so a title assertion reports
            // the builder unreachable at 844x390 while it is rendering fine.
            // A tile also distinguishes the real builder from
            // `PoolDeckBuilder`'s "No Pool has been generated for your seat
            // yet" empty state, which is the failure actually worth catching.
            if (!(await visible(page, "[data-card-tile]", 10_000))) {
                throw new Unreachable(
                    `/limited/${eventId}/build rendered no card tile — the fixture seat's pool may be empty. Re-seed it: ${SEED_FIXTURES_COMMAND}`
                );
            }
        },
    },
    {
        id: "draft-pick",
        label: "Draft Room (/limited/<id>/draft)",
        async walk(page, ctx) {
            await reachDraftRoom(page, ctx);
            // AC 1/2 of issue #2588 ("exactly two scroll positions are
            // reachable") is a LAYOUT claim, and happy-dom cannot make it.
            // This is the only place it is asserted against a real scroller.
            await assertTwoSnapStops(page);
        },
    },
    {
        id: "draft-pool-stop",
        label: "Draft Room, pool stop (/limited/<id>/draft, swiped)",
        async walk(page, ctx) {
            await reachDraftPoolStop(page, ctx);
        },
    },
    {
        id: "draft-pool-peek",
        label: "Draft Room, Pool Peek Panel open (/limited/<id>/draft, pool tile selected)",
        async walk(page, ctx) {
            // Review finding (PR #2797 round 1, MEDIUM, issue #2667): no walk
            // ever opened the Pool's own `DeckZonePeek` — `draft-pick`
            // measures the pack stop, `draft-pool-stop` measures the pool
            // PANE but never TAPS a tile in it, so `poolSelection` stayed
            // `null` and the fixed panel stayed unmounted through all 60 prior
            // rows, including the two phone viewports issue #2667's own AC
            // names (390x844x3 / 844x390x3) — exactly the state
            // `draft-selection-actions.tsx` records was MEASURED to occlude
            // in portrait before this feature deleted that budget row. This
            // surface is `draft-pool-stop` plus the one gesture that was
            // missing: select a Pool tile and measure with the panel open.
            await reachDraftPoolStop(page, ctx);
            // The LAST tile, not the first (issue #2822). The pool renders as
            // OVERLAID column piles (ADR 0075), so on a full pool the first
            // tile of a pile is covered by the ones stacked on top of it and
            // Playwright's actionability check waits out its whole timeout on
            // it — measured, as a walk-threw UNWALKED at 1440x900x2, the
            // moment the fixture gave this seat a realistic 24-card pool. The
            // last tile is the top of its own pile at every viewport.
            const poolTile = page.locator(DRAFT_POOL_TILE).last();
            if ((await page.locator(DRAFT_POOL_TILE).count()) === 0) {
                throw new Unreachable(
                    "reached the Draft Room's pool stop but found no Pool card tile to select — this surface needs the same NON-EMPTY pool `draft-pool-stop` does"
                );
            }
            await poolTile.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
            await poolTile.click({ timeout: STEP_TIMEOUT });
            if (!(await visible(page, DRAFT_PEEK_PANEL, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "selected a Pool card tile but the Pool's Peek Panel (`[data-peek-panel]`) never mounted"
                );
            }
            // `[data-peek-panel]` alone cannot discharge this surface's claim.
            // `reachDraftRoom` has ALREADY pinned a Booster selection
            // (`pinDraftSelection`, issue #2677), and the Booster's own
            // `PeekPanel` uses the SAME attribute — so a pool click that did
            // nothing at all would leave the Booster's panel standing and the
            // assertion above green, which is the "the test never reaches the
            // code" shape. The two panels' CTA rows are what differ: only the
            // Pool's `DeckZonePeek` appends `Move to…` (its column-pin sheet,
            // `deck-zone-peek.tsx`), and the Booster's never offers it.
            if (!(await visible(page, DRAFT_POOL_PEEK_CTA, STEP_TIMEOUT))) {
                throw new Unreachable(
                    `a Peek Panel is mounted but it is not the POOL's — no ${DRAFT_POOL_PEEK_CTA} in it, which means the pool tile's click did not take and this row would have measured \`draft-pick\`'s Booster panel under a different surface id`
                );
            }
            await page.waitForTimeout(300);
        },
    },
    {
        id: "game-board",
        label: "Game board (/game)",
        async walk(page, ctx) {
            await ensureBoard(page, ctx);
        },
    },
    {
        id: "game-stress",
        label: "Game board — UI stress scenario",
        async walk(page, ctx) {
            await ensureBoard(page, ctx);
            if (!ctx.createdGame) {
                throw new Unreachable(
                    "an active game the lane did not create is in progress; loading a scenario would clobber it. Finish or concede it, then re-run"
                );
            }
            if (
                !(await clickIfVisible(page, "button:has-text('Debug')", 6000))
            ) {
                throw new Unreachable(
                    "no Debug panel toggle on the board — the signed-in account is probably not an admin"
                );
            }
            if (
                !(await clickIfVisible(
                    page,
                    "button:has-text('Scenarios')",
                    6000
                ))
            ) {
                throw new Unreachable(
                    "the Debug panel offered no Scenarios button"
                );
            }
            const search = page
                .locator("input[placeholder*='Search scenarios']")
                .first();
            if (
                !(await visible(
                    page,
                    "input[placeholder*='Search scenarios']",
                    6000
                ))
            ) {
                throw new Unreachable(
                    "the Scenarios list did not open (listDebugScenarios is admin-gated — is this account an admin?)"
                );
            }
            await search.fill(ctx.stressScenarioLabel);
            await page.waitForTimeout(600);
            const row = page.locator(
                `button:has-text(${JSON.stringify(ctx.stressScenarioLabel)})`
            );
            if ((await row.count()) === 0) {
                throw new Unreachable(
                    `debug scenario "${ctx.stressScenarioLabel}" is absent from this deployment — seed it with debugScenarios:seedScenarioDirect (see the PR receipt's scenario field)`
                );
            }
            await row.first().click({ timeout: STEP_TIMEOUT });
            await page.waitForTimeout(2500);
            await settle(page);
        },
    },
];

export const SURFACE_IDS: readonly string[] = SURFACES.map((s) => s.id);
