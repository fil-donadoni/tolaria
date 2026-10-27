import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "~/lib/clipboard";

/** The event page's ⋯ menu (PRD #5383, issue #5389): every secondary action —
 *  Copy link, Cancel / Close event — lives here, never beside the hero's CTA
 *  (Leave Event is the hero's own button). Cancel/Close only OPENS its confirm
 *  dialog; the page owns it.
 *
 *  A plain in-flow disclosure rather than a portal popover: it needs no
 *  positioning engine for three items, and stays reachable in tests. Closes on
 *  Escape, on an outside press and after any choice. */
export default function LimitedEventMenu({
    eventId,
    canInvite,
    onCancel,
    cancelLabel,
    disabled,
}: {
    eventId: string;
    /** True while seating is open: the link can still bring a player in. */
    canInvite: boolean;
    /** Present only when the viewer may cancel / close the event. */
    onCancel: (() => void) | undefined;
    cancelLabel: string;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        const onPress = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onPress);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("mousedown", onPress);
        };
    }, [open]);

    const choose = (run: () => void) => () => {
        setOpen(false);
        run();
    };

    const copyLink = () => {
        void copyText(`${window.location.origin}/limited/${eventId}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div ref={root} className="relative" data-testid="event-menu">
            <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label="Event actions"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                ⋯
            </Button>
            {open && (
                <div
                    data-testid="event-menu-list"
                    className="absolute right-0 top-full z-[var(--z-sheet)] mt-1 flex min-w-44 flex-col gap-0.5 rounded-md border border-border-subtle bg-surface p-1 shadow-lg"
                >
                    <button
                        type="button"
                        className="rounded-sm px-3 py-2 text-left text-sm text-text hover:bg-surface-elevated"
                        onClick={copyLink}
                    >
                        {copied
                            ? "Link copied!"
                            : canInvite
                              ? "Share invite link"
                              : "Copy event link"}
                    </button>
                    {onCancel && (
                        <button
                            type="button"
                            disabled={disabled}
                            className="rounded-sm px-3 py-2 text-left text-sm text-danger-strong hover:bg-surface-elevated disabled:text-text-disabled"
                            onClick={choose(onCancel)}
                        >
                            {cancelLabel}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
