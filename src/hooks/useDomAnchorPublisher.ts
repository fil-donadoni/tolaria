import { useEffect, useRef, type RefObject } from "react";
import { ANCHORS_REPOSITION_EVENT } from "~/hooks/anchor-reposition";
import { useArrowAnchors, type AnchorKind } from "~/hooks/arrowAnchorContext";

/** `data-arrow-anchor-*` attribute name per anchor kind. */
const ANCHOR_ATTR: Record<AnchorKind, string> = {
    stack: "data-arrow-anchor-stack",
    permanent: "data-arrow-anchor-permanent",
    player: "data-arrow-anchor-player",
    graveyard: "data-arrow-anchor-graveyard",
};

/** Marker attribute identifying the spatial board root — the coordinate space
 *  every published anchor point lives in. */
const BOARD_ROOT_SELECTOR = "[data-board-root]";

type Published = { kind: AnchorKind; id: string };

/**
 * Publishes board-coordinate centers for the DOM-positioned arrow anchors that
 * have no shared layout placement — the stack panel (arrow source / spell
 * targets), player edge anchors, and graveyard piles (PRD #249, slice #257).
 *
 * These surfaces are discrete panels, not continuously spring-animating cards,
 * so reading their `getBoundingClientRect` is acceptable (the issue allows
 * anchors "only where a placement isn't available"). Battlefield permanents —
 * the cards that DO animate continuously — are published from layout placements
 * by {@link useZoneAnchorPublisher} instead, never measured here.
 *
 * Re-scans on resize, scroll, and the shared `leaderlines:reposition` event
 * (which the stack panel already dispatches as it is dragged), so dragging the
 * stack keeps its arrows attached. It only ever unpublishes anchors it
 * published itself (tracked in a ref), so it never fights the zone publishers
 * over a shared bucket.
 */
export function useDomAnchorPublisher(
    boardRef: RefObject<Element | null>,
    kinds: AnchorKind[],
    /** Bump this when the set of anchored elements changes (e.g. stack length)
     *  so freshly-mounted anchors get measured. */
    revision: unknown
): void {
    const registry = useArrowAnchors();
    // `publish` / `unpublish` are stable (defined with empty-dep useCallback in
    // the provider), so depending on them does not re-run the effect on every
    // anchor move — only `revision` / the ref / kind list drive re-subscription.
    const publish = registry?.publish;
    const unpublish = registry?.unpublish;
    // Ids this publisher owns, so cleanup only removes its own anchors.
    const ownedRef = useRef<Published[]>([]);
    const kindsKey = kinds.join(",");

    useEffect(() => {
        const self = boardRef.current;
        if (!self || !publish || !unpublish) return;
        // The passed ref lives inside the board root; anchors are siblings
        // elsewhere in the board, so resolve and query the root itself.
        const board =
            self.closest<HTMLElement>(BOARD_ROOT_SELECTOR) ??
            (self.parentElement as HTMLElement | null);
        if (!board) return;

        const measure = () => {
            const rootRect = board.getBoundingClientRect();
            const nextOwned: Published[] = [];
            const seen: Record<string, Set<string>> = {};
            for (const kind of kinds) {
                seen[kind] = new Set();
                const attr = ANCHOR_ATTR[kind];
                const els = board.querySelectorAll<HTMLElement>(`[${attr}]`);
                els.forEach((el) => {
                    const id = el.getAttribute(attr);
                    if (!id) return;
                    const r = el.getBoundingClientRect();
                    publish(kind, id, {
                        x: r.left - rootRect.left + r.width / 2,
                        y: r.top - rootRect.top + r.height / 2,
                    });
                    seen[kind].add(id);
                    nextOwned.push({ kind, id });
                });
            }
            // Drop only the anchors THIS publisher placed last pass that have
            // since vanished (resolved stack item, pile unmounted) — never
            // touch anchors a zone publisher owns.
            for (const prev of ownedRef.current) {
                if (!seen[prev.kind]?.has(prev.id)) {
                    unpublish(prev.kind, prev.id);
                }
            }
            ownedRef.current = nextOwned;
        };

        measure();

        const onChange = () => measure();
        window.addEventListener("resize", onChange);
        document.addEventListener("scroll", onChange, true);
        window.addEventListener(ANCHORS_REPOSITION_EVENT, onChange);
        return () => {
            window.removeEventListener("resize", onChange);
            document.removeEventListener("scroll", onChange, true);
            window.removeEventListener(ANCHORS_REPOSITION_EVENT, onChange);
            // Release this publisher's anchors on unmount.
            for (const owned of ownedRef.current) {
                unpublish(owned.kind, owned.id);
            }
            ownedRef.current = [];
        };
        // Re-run only when the board ref, the anchored-element set (revision),
        // or the kind list changes — NOT on every publish (publish/unpublish
        // are stable).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardRef, revision, kindsKey, publish, unpublish]);
}
