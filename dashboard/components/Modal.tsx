import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import {
    ownsEscape,
    useOverlayRegistration,
    type OverlayId,
} from "../lib/overlays";

/**
 * The dashboard's modal shell (PRD #3148 S2) — a centred dialog with a
 * backdrop, a focus trap and a scroll lock.
 *
 * ── WHY NOT `src/components/ui/dialog.tsx` ────────────────────────────────
 *
 * Same reason `Section` is not built on `panel.tsx` (S1): that primitive's
 * appearance is the GAME's, declared in `src/index.css` — `play-area-center-x`
 * for its horizontal centring, `modal-scrim` for the backdrop,
 * `ring-border-accent` for its edge. The dashboard has its own Tailwind entry
 * and does not import that stylesheet (ADR 0117), so those class names resolve
 * to nothing here and the dialog would render UNPOSITIONED. What IS shared is
 * what matters: the same `@base-ui/react/dialog` primitive underneath, and the
 * same shadcn token vocabulary on top of it.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 *
 * Two consumers, so it is extracted once rather than written twice: the
 * shortcuts sheet and the action-confirmation dialog. `scripts/dashboard/
 * dialog.js` existed for exactly this reason (#2636, "extract after the
 * second") and held only the Tab trap, because that was the one piece the two
 * hand-built dialogs genuinely shared. Here the primitive owns the trap, the
 * scrim and the focus restore, so what is left to share is the SHELL.
 *
 * Escape precedence is arbitrated, not raced — see `overlays.ts`.
 */
export function Modal({
    overlay,
    open,
    onClose,
    title,
    description,
    className,
    children,
}: {
    overlay: OverlayId;
    open: boolean;
    onClose: () => void;
    title: string;
    description?: ReactNode;
    className?: string;
    children?: ReactNode;
}) {
    useOverlayRegistration(overlay, open);
    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next, details) => {
                if (next) return;
                if (details.reason === "escape-key" && !ownsEscape(overlay)) {
                    details.cancel();
                    return;
                }
                onClose();
            }}
        >
            <Dialog.Portal>
                <Dialog.Backdrop className="z-modal fixed inset-0 bg-black/40" />
                <Dialog.Popup
                    className={cn(
                        "bg-popover text-popover-foreground z-modal fixed top-1/2 left-1/2 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border p-4 shadow-lg outline-none",
                        className
                    )}
                >
                    <Dialog.Title className="text-sm font-semibold tracking-tight">
                        {title}
                    </Dialog.Title>
                    {description ? (
                        <Dialog.Description className="text-muted-foreground text-xs">
                            {description}
                        </Dialog.Description>
                    ) : null}
                    {children}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
