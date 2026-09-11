import { useEffect, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";
import AiDecisionTraceBox from "./ai-decision-trace-box";
import DebugPanel from "./debug-panel";

/** Persisted open flag, per device (issue #3403). "1" = open. */
const OPEN_KEY = "tolaria:debugSheetOpen";

/** The keyboard shortcut that toggles the sheet. Backquote is the classic
 *  dev-console key and is the one printable character no gameplay surface
 *  binds — Escape belongs to the pause menu (`board.tsx`), and every
 *  `Ctrl/Cmd+Shift+<letter>` a debug panel would want is already claimed by
 *  the browser itself (`Ctrl+Shift+D` bookmarks every open tab in Chrome, and
 *  a page cannot preventDefault a browser-level chord). */
export const DEBUG_SHEET_SHORTCUT_KEY = "`";

function readOpen(): boolean {
    try {
        return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
        return false;
    }
}

/** Whether a keystroke landed in something the user is TYPING into — the
 *  scenario editor inside the sheet is full of text fields, and a bare
 *  printable shortcut that fires while you type a card name is a shortcut that
 *  eats your input. */
function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The debug area as a LEFT SHEET (issue #3403, PRD #3397).
 *
 * Replaces the dev-only bottom-left `DevPanelRail`, which stacked two
 * free-floating overlays over the play area and was mounted behind
 * `import.meta.env.DEV` — invisible in production, which is exactly where a
 * tester needs it. The route now mounts this for a tester (or in dev) and the
 * whole surface lives inside the shared sheet primitive, side `left`, so it
 * shares the app's scrim/animation/escape contract instead of reinventing one.
 *
 * NON-MODAL and pointer-undismissable on purpose (`modal={false}`,
 * `disablePointerDismissal`, `showOverlay={false}`): the entire point of the
 * surface is to watch the BOARD while it is open — loading a scenario, then
 * clicking through the resulting position. A modal sheet, or one that closed
 * on the first click on the battlefield, would be unusable for that. The
 * backdrop is suppressed for the same reason: base-ui's `Backdrop` is a
 * `fixed inset-0` element with no `pointer-events: none`, so rendering one
 * would swallow every click on the board behind it (see `sheet.tsx`).
 *
 * Escape still closes it — `board.tsx`'s `POPUP_SELECTORS` lists
 * `[data-slot="sheet-content"]`, so that keystroke closes the sheet INSTEAD of
 * also popping the pause menu behind it.
 *
 * The edge toggle is a slim tab pinned to the left edge just above the
 * portrait controller bar ({@link ABOVE_CONTROLLER_BAR}, #1759/#1764) — the
 * same clearance the rail used, so it cannot be covered by the bar when the
 * command row wraps. It sits at `z-dev-overlay` (45): above the board/HUD (40)
 * so it stays tappable, below the sheet itself (`z-sheet`, 50) so the open
 * sheet paints over it rather than around it.
 */
export default function DebugSheet({
    gameId,
    playerId,
    vsAi,
}: {
    gameId: Id<"games">;
    playerId: string;
    /** vs-AI game: the AI decision box has a trace to show. */
    vsAi: boolean;
}) {
    const [open, setOpen] = useState(readOpen);

    useEffect(() => {
        try {
            localStorage.setItem(OPEN_KEY, open ? "1" : "0");
        } catch {
            // storage unavailable — session-only state is fine
        }
    }, [open]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== DEBUG_SHEET_SHORTCUT_KEY) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            event.preventDefault();
            setOpen((v) => !v);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <>
            <button
                type="button"
                data-debug-sheet-toggle=""
                aria-label={`${open ? "Close" : "Open"} the debug sheet (${DEBUG_SHEET_SHORTCUT_KEY})`}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={`fixed ${ABOVE_CONTROLLER_BAR} left-0 z-dev-overlay flex h-11 w-5 items-center justify-center rounded-r-md border border-l-0 border-border-subtle bg-black/70 font-mono text-[10px] text-text-muted shadow hover:text-parchment md:bottom-4`}
            >
                {open ? "«" : "»"}
            </button>

            <Sheet
                open={open}
                onOpenChange={setOpen}
                modal={false}
                disablePointerDismissal
            >
                <SheetContent
                    side="left"
                    showOverlay={false}
                    data-debug-sheet=""
                    // `w-[88%]` rather than the primitive's `w-3/4` so the
                    // scenario forms keep usable field widths at 400px, still
                    // capped at `sm:max-w-sm` on anything wider.
                    className="w-[88%] gap-0"
                >
                    <SheetHeader className="border-b border-border-accent/20 pb-3">
                        <SheetTitle>Debug</SheetTitle>
                        <SheetDescription>
                            Tester tools for this game. Toggle with{" "}
                            <kbd className="font-mono">
                                {DEBUG_SHEET_SHORTCUT_KEY}
                            </kbd>
                            .
                        </SheetDescription>
                    </SheetHeader>
                    {/* `min-h-0` so this scrolls instead of pushing the header
                        off a short (landscape-phone) viewport. */}
                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-xs">
                        {vsAi && <AiDecisionTraceBox />}
                        <DebugPanel gameId={gameId} playerId={playerId} />
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}
