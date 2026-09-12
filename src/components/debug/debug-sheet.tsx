import type { Id } from "@convex/_generated/dataModel";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "~/components/ui/sheet";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";
import { useDebugSheet } from "~/hooks/debugSheetContext";
import AiDecisionTraceBox from "./ai-decision-trace-box";
import DebugPanel from "./debug-panel";
import { DEBUG_SHEET_DESKTOP_WIDTH_CLASS } from "./debug-sheet-metrics";
import { DEBUG_SHEET_SHORTCUT_KEY } from "./debug-sheet-provider";

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
 * At `lg` and wider it also stops COVERING the board (issue #3493): the popup
 * is still `position: fixed`, but {@link DebugBoardArea} gives up exactly
 * {@link DEBUG_SHEET_DESKTOP_WIDTH_PX} while the sheet is open, so the board
 * reflows into the remaining width instead of hiding half a battlefield under
 * an overlay. That is why the open flag lives in
 * {@link DebugSheetProvider} rather than here — the board area is a SIBLING of
 * this component, not a descendant.
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
    // Mounted by the route INSIDE `DebugSheetProvider` — the null branch is
    // the "no provider" case, which for this component means no sheet at all
    // rather than a second, private copy of the open flag.
    const sheetState = useDebugSheet();
    if (!sheetState) return null;
    const { open, setOpen } = sheetState;

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
                    // scenario forms keep usable field widths at 400px, capped
                    // at `sm:max-w-sm` from there — until `lg`, where the sheet
                    // takes space beside the board and can afford the 480px the
                    // scenario form's per-seat pairs want (issue #3493).
                    className={`w-[88%] gap-0 ${DEBUG_SHEET_DESKTOP_WIDTH_CLASS}`}
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
                    <div
                        data-debug-sheet-body=""
                        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-xs"
                    >
                        {vsAi && <AiDecisionTraceBox />}
                        <DebugPanel gameId={gameId} playerId={playerId} />
                    </div>
                </SheetContent>
            </Sheet>
        </>
    );
}
