import { useEffect, useState } from "react";
import { useGameContext } from "~/hooks/useGameContext";
import { Panel } from "~/components/ui/panel";
import CardImage from "~/components/cards/card-image";

/** Auto-dismiss window for a one-shot look/reveal popup. The server clears
 *  `pendingReveals` on its next resolution, but that can be many priority
 *  passes away, so the client times the dialog out on its own; a click (or
 *  Enter/Space/Escape) dismisses it immediately. */
const REVEAL_NOTIFICATION_MS = 5000;

/** Transient center-screen popup for a private look or public reveal
 *  (`SpellContext.notifyReveal`, ADR 0026 / CR 400.2 look / CR 701.20
 *  reveal). The projection has already filtered `pendingReveals` to the entries
 *  this viewer may see — a private look (Urza's Bauble) reaches only the looker,
 *  a public reveal reaches everyone — so every entry here is for us to show.
 *
 *  Each reveal id is shown ONCE: dismissed on click or after
 *  `REVEAL_NOTIFICATION_MS`, tracked in a client-only `dismissed` set. A
 *  reactive re-render of the same server snapshot therefore never re-pops an
 *  already-seen reveal, while the next resolution's fresh batch (new ids) shows
 *  again. Card-advantage baubles (Urza's Bauble, Mishra's Bauble) and hand /
 *  library peeks are the callers. The persistent visibility of a looked card
 *  (it stays face-up in its zone) is the separate `knownTo` grant the caller
 *  also performs — this overlay is only the momentary "here is what you saw". */
export default function RevealNotificationOverlay() {
    const { pendingReveals } = useGameContext();
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
        () => new Set()
    );

    // The most recent still-undismissed reveal (entries are enqueued in order,
    // so the last one is the newest). Showing one at a time keeps the dialog
    // simple; the next tick surfaces the one below once this is dismissed.
    const active = (pendingReveals ?? [])
        .filter((r) => !dismissed.has(r.id))
        .at(-1);

    const activeId = active?.id;
    useEffect(() => {
        if (activeId === undefined) return;
        const timer = setTimeout(() => {
            setDismissed((prev) => new Set(prev).add(activeId));
        }, REVEAL_NOTIFICATION_MS);
        return () => clearTimeout(timer);
    }, [activeId]);

    // Space / Enter / Escape dismiss from anywhere — the overlay div is never
    // focused, so its own onKeyDown alone would never fire and Space would fall
    // through to the global Pass-priority hotkey (`useControllerActions`).
    // Listening on the CAPTURE phase at window puts us ahead of that bubble
    // listener; stopPropagation there keeps the keystroke from also passing
    // priority while a look/reveal is on screen.
    useEffect(() => {
        if (activeId === undefined) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.code !== "Space" && e.key !== "Enter" && e.key !== "Escape")
                return;
            if (e.repeat) return;
            e.preventDefault();
            e.stopPropagation();
            setDismissed((prev) => new Set(prev).add(activeId!));
        }
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [activeId]);

    if (!active) return null;

    const dismiss = () => setDismissed((prev) => new Set(prev).add(active.id));

    const multiple = active.cards.length > 1;
    const heading =
        active.kind === "look"
            ? multiple
                ? "You look at these cards"
                : "You look at this card"
            : multiple
              ? "Revealed cards"
              : "Revealed card";

    return (
        <div
            className="absolute inset-0 z-modal flex items-center justify-center modal-scrim"
            role="button"
            tabIndex={0}
            onClick={dismiss}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
                    dismiss();
                }
            }}
        >
            <Panel
                density="compact"
                className="flex flex-col items-center gap-4 px-8 py-6"
            >
                <p className="text-display text-sm text-text">{heading}</p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {active.cards.map((c) => (
                        <div key={c.instanceId} className="w-40 aspect-5/7">
                            <CardImage
                                card={{ id: c.cardId }}
                                sizes="160px"
                                includeThumb={false}
                            />
                        </div>
                    ))}
                </div>
                <p className="text-xs text-text-muted">
                    Click or press Space to dismiss
                </p>
            </Panel>
        </div>
    );
}
