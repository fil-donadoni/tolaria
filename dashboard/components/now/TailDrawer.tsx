import { useCallback, useEffect, useRef, useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { CONTROL_QUIET_CLASS } from "../../lib/controls";
import { StateBadge } from "../StateBadge";
import { IssueLink } from "../IssueLink";
import { TailEntryRow } from "./TailEntryRow";
import { useTail } from "../../lib/tail";
import { closeWatch, useWatchTarget } from "../../lib/watch";
import { ownsEscape, useOverlayRegistration } from "../../lib/overlays";
import { LIVENESS } from "../../lib/nowClaims";

/**
 * The session tail drawer (issue #3135), rebuilt on a shadcn `Sheet` for
 * PRD #3148 S2 — the slice's headline defect fix.
 *
 * ── THE TWO DEFECTS, FIXED BY CONSTRUCTION ────────────────────────────────
 *
 * The hand-written drawer bound `keydown` on its OWN element, so `Escape`
 * closed it only while focus was inside it — and it had no outside-click
 * handling at all, because only the easy half was written. Both were the
 * PRD's opening exhibit.
 *
 * base-ui binds `Escape` and outside-press on the DOCUMENT, so both work from
 * anywhere on the page. What this component still has to state is what a
 * primitive cannot know:
 *
 *   1. PRECEDENCE. Three overlays can be open at once and all three hear the
 *      same `Escape`. `ownsEscape` says which one acts; the others cancel
 *      base-ui's own handling rather than racing it. Order lives in
 *      `overlays.ts`: the shortcuts sheet, then the confirmation dialog, then
 *      this.
 *   2. ANOTHER ROW'S WATCH IS NOT "OUTSIDE". A click on a different Watch
 *      control must SWITCH the drawer to that session, not close it. base-ui
 *      dismisses on pointerdown, which lands before the button's own click, so
 *      the close is cancelled here and the click then re-points the store.
 *
 * ── NON-MODAL, AND MEANT ──────────────────────────────────────────────────
 *
 * `modal={false}` and no backdrop: the page behind keeps polling and stays
 * usable, which is the whole point of watching a session WHILE reading the
 * board. Base-ui's `Backdrop` has no `pointer-events: none` of its own, so a
 * non-modal sheet that painted one would swallow every click behind it —
 * hence `showOverlay={false}` (see `sheet.tsx`). Focus is likewise NOT
 * trapped: a keyboard user leaves the drawer the same way a pointer user does
 * (review of PR #3136 — a trap here was a modal wearing a non-modal role).
 *
 * FOLLOW MODE is the terminal convention: new entries scroll into view until
 * the operator scrolls up, at which point following pauses and a "Jump to
 * latest" button appears.
 */
export function TailDrawer() {
    const target = useWatchTarget();
    const open = target !== null;
    const [following, setFollowing] = useState(true);
    const logRef = useRef<HTMLDivElement>(null);

    useOverlayRegistration("tail", open);

    const scrollToEnd = useCallback(() => {
        const log = logRef.current;
        if (log) log.scrollTop = log.scrollHeight;
    }, []);

    const tail = useTail(target?.session ?? null);

    // Following means "keep the newest line in view". Driven off the entries
    // themselves rather than a callback out of the transport: the hook owns
    // the data, this component owns the scroll container, and neither has to
    // hold a ref written during render to talk to the other.
    useEffect(() => {
        if (following) scrollToEnd();
    }, [tail.entries, following, scrollToEnd]);

    const onScroll = () => {
        const log = logRef.current;
        if (!log) return;
        const atBottom =
            log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        if (atBottom !== following) setFollowing(atBottom);
    };

    const liveness = tail.summary?.liveness;

    return (
        <Sheet
            open={open}
            onOpenChange={(next, details) => {
                if (next) return;
                // `Escape` reaches every open overlay; only the topmost acts.
                if (details.reason === "escape-key" && !ownsEscape("tail")) {
                    details.cancel();
                    return;
                }
                // A press on another row's Watch is a SWITCH, not a dismissal.
                if (
                    details.reason === "outside-press" &&
                    (details.event.target as Element | null)?.closest?.(
                        "[data-watch]"
                    )
                ) {
                    details.cancel();
                    return;
                }
                closeWatch();
            }}
            modal={false}
        >
            <SheetContent
                side="right"
                showOverlay={false}
                showCloseButton={false}
                className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
                aria-label="Session tail"
            >
                <SheetHeader className="flex-row items-start gap-2 border-b">
                    <div className="flex min-w-0 flex-col gap-1">
                        <SheetTitle className="truncate text-sm">
                            {target?.label ?? ""}
                        </SheetTitle>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                            {target?.issue ? (
                                <span>
                                    issue <IssueLink issue={target.issue} />
                                </span>
                            ) : null}
                            {tail.summary?.gitBranch ? (
                                <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                                    {tail.summary.gitBranch}
                                </code>
                            ) : null}
                            {liveness ? (
                                <StateBadge
                                    tone={
                                        (LIVENESS[liveness] ?? LIVENESS.idle)
                                            .tone
                                    }
                                    term={
                                        (LIVENESS[liveness] ?? LIVENESS.idle)
                                            .term
                                    }
                                >
                                    {(LIVENESS[liveness] ?? LIVENESS.idle).word}
                                </StateBadge>
                            ) : null}
                            {target ? (
                                <span title={target.session}>
                                    {target.session.slice(0, 8)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            className={CONTROL_QUIET_CLASS}
                            aria-pressed={following}
                            onClick={() => {
                                setFollowing(!following);
                                if (!following) scrollToEnd();
                            }}
                        >
                            {following ? "Following" : "Paused"}
                        </button>
                        <button
                            type="button"
                            className={CONTROL_QUIET_CLASS}
                            aria-label="Close session tail"
                            onClick={closeWatch}
                        >
                            Close
                        </button>
                    </div>
                </SheetHeader>

                <div
                    ref={logRef}
                    onScroll={onScroll}
                    tabIndex={0}
                    aria-live="polite"
                    aria-label="Transcript"
                    className="min-h-0 flex-1 overflow-y-auto"
                >
                    {tail.truncated ? (
                        <div className="text-muted-foreground border-b px-3 py-1.5 text-[11px]">
                            … earlier entries not shown …
                        </div>
                    ) : null}
                    {tail.entries.map((entry, i) => (
                        <TailEntryRow
                            key={`${entry.ts ?? "x"}-${i}`}
                            entry={entry}
                        />
                    ))}
                </div>

                <div className="flex items-center gap-2 border-t px-3 py-2 text-xs">
                    <span
                        className={
                            tail.failed
                                ? "text-state-bad"
                                : "text-muted-foreground"
                        }
                    >
                        {tail.status}
                    </span>
                    {following ? null : (
                        <button
                            type="button"
                            className={`${CONTROL_QUIET_CLASS} ml-auto`}
                            onClick={() => {
                                setFollowing(true);
                                scrollToEnd();
                            }}
                        >
                            Jump to latest
                        </button>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
