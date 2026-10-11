import { SLOT_SPRING } from "./board-motion";

/**
 * Card fly (issue #5395, PRD #5384): one shared helper that makes a card
 * visibly travel from where it was to where it lands, FLIP-style — measure the
 * source, let the move commit, measure the destination, animate a floating
 * COPY between the two on a slight arc.
 *
 * The contract every caller relies on: **the state change is never deferred**.
 * The caller applies its move at once, right after calling {@link flyCard};
 * the flight is cosmetic, drawn by an `aria-hidden` clone on `document.body`
 * that owns no state and receives no pointer. Under reduced motion (the OS
 * query or the `[data-motion="reduced"]` Settings choice, `index.css`) the
 * helper does nothing at all — not even the scroll below.
 *
 * Destination resolution happens on the NEXT frame, after React has committed
 * the move: `destination()` names the landed element; when it sits inside a
 * horizontal scroller that scroller is brought round to it; when it is not
 * rendered or not on screen, `standIn()` names what to fly to instead (a tab
 * label, a strip header). Neither resolving → no flight.
 */
export interface CardFlyTarget {
    /** The landed element, queried once the move has committed. */
    destination: () => Element | null;
    /** What to fly to when the destination is unrendered or off screen. */
    standIn?: () => Element | null;
}

/** Attribute the flying copy carries — the handle tests and styles query. */
export const CARD_FLY_ATTR = "data-card-fly";

const FLY_DURATION_MS = 360;
/** Arc height cap: a long flight lifts at most this much above the chord. */
const MAX_ARC_PX = 80;
/** Attributes stripped from the clone so it is never a control or a query
 *  match for the real tile it was copied from. */
const STRIPPED_ATTRS = ["id", "role", "tabindex", "title"];

/** Reduced motion, read the way `index.css` gates its own animations: the
 *  OS query OR the Settings choice published on `<html>`. */
export function prefersReducedMotion(win: Window = window): boolean {
    if (win.document.documentElement.dataset.motion === "reduced") return true;
    return (
        win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    );
}

/**
 * Starts a flight from `source` (measured NOW, before the move applies) to
 * `target` (resolved after it). Call it immediately BEFORE applying the move,
 * in the same handler; it returns at once and never touches state.
 */
export function flyCard(
    source: Element | null,
    target: CardFlyTarget,
    win: Window = window
): void {
    if (source === null || prefersReducedMotion(win)) return;
    const from = source.getBoundingClientRect();
    if (from.width === 0 || from.height === 0) return;
    const ghost = cloneForFlight(source);
    win.requestAnimationFrame(() => {
        const landing = resolveLanding(target, win);
        if (landing === null) return;
        launch(ghost, from, landing, win);
    });
}

function cloneForFlight(source: Element): HTMLElement {
    const ghost = source.cloneNode(true) as HTMLElement;
    for (const el of [ghost, ...ghost.querySelectorAll("*")]) {
        for (const attr of [...el.attributes]) {
            if (
                STRIPPED_ATTRS.includes(attr.name) ||
                attr.name.startsWith("data-")
            )
                el.removeAttribute(attr.name);
        }
    }
    ghost.setAttribute(CARD_FLY_ATTR, "");
    ghost.setAttribute("aria-hidden", "true");
    return ghost;
}

interface Landing {
    rect: DOMRect;
    /** The real destination (hidden while the copy is in flight), or `null`
     *  when flying to a stand-in that must stay visible. */
    element: HTMLElement | null;
}

function resolveLanding(target: CardFlyTarget, win: Window): Landing | null {
    const dest = target.destination();
    if (dest !== null) {
        revealInHorizontalScroller(dest, win);
        const rect = dest.getBoundingClientRect();
        if (isOnScreen(rect, win)) {
            return {
                rect,
                element: dest instanceof HTMLElement ? dest : null,
            };
        }
    }
    const standIn = target.standIn?.() ?? null;
    if (standIn === null) return null;
    const rect = standIn.getBoundingClientRect();
    return isOnScreen(rect, win) ? { rect, element: null } : null;
}

function isOnScreen(rect: DOMRect, win: Window): boolean {
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < win.innerWidth &&
        rect.top < win.innerHeight
    );
}

/** Brings `el` into view inside its NEAREST horizontal scroller only — never
 *  an outer one. The nearest is judged by style (`overflow-x: auto|scroll`),
 *  not by current overflow, so a row that happens not to overflow still stops
 *  the walk: otherwise the walk would reach the portrait pane strip and swipe
 *  the player to the other pane on every move. A scroller that is itself off
 *  screen is left alone (the stand-in takes over). */
function revealInHorizontalScroller(el: Element, win: Window): void {
    let node = el.parentElement;
    while (node !== null) {
        const overflowX = win.getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") break;
        node = node.parentElement;
    }
    if (node === null) return;
    const box = node.getBoundingClientRect();
    if (!isOnScreen(box, win)) return;
    const rect = el.getBoundingClientRect();
    if (rect.left < box.left) node.scrollLeft -= box.left - rect.left;
    else if (rect.right > box.right) node.scrollLeft += rect.right - box.right;
}

function launch(
    ghost: HTMLElement,
    from: DOMRect,
    landing: Landing,
    win: Window
): void {
    if (typeof ghost.animate !== "function") return;
    const to = landing.rect;
    Object.assign(ghost.style, {
        position: "fixed",
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        margin: "0",
        pointerEvents: "none",
        transformOrigin: "center",
        zIndex: "1000",
    });
    // Centre to centre, scaled to fit: for a real destination (same aspect)
    // this is an exact overlay; for a stand-in (a tab label) the copy shrinks
    // into it and fades, reading as "it went there".
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const fit = Math.min(to.width / from.width, to.height / from.height);
    // A stand-in never grows the card: a wide strip header would otherwise
    // inflate it on the way in.
    const scale = landing.element ? fit : Math.min(1, fit);
    const lift = Math.min(MAX_ARC_PX, Math.hypot(dx, dy) * 0.2);
    const midScale = (1 + scale) / 2;
    win.document.body.appendChild(ghost);
    const hidden = landing.element;
    const previousVisibility = hidden?.style.visibility ?? "";
    if (hidden) hidden.style.visibility = "hidden";
    const animation = ghost.animate(
        [
            { transform: "translate(0px, 0px) scale(1)" },
            {
                offset: 0.5,
                transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) scale(${midScale})`,
            },
            {
                transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
                opacity: landing.element ? 1 : 0,
            },
        ],
        { duration: FLY_DURATION_MS, easing: SLOT_SPRING.cssEasing }
    );
    const land = () => {
        ghost.remove();
        if (hidden) hidden.style.visibility = previousVisibility;
    };
    animation.onfinish = land;
    animation.oncancel = land;
}
