// PROTOTYPE — throwaway. FLIP "fly" for a card that changes zone: the click
// records the source rect (First), React re-renders the card in its new zone
// (Last), and a fixed ghost is Inverted onto the source rect then Played to
// the destination with a CSS transform. The real destination card stays
// hidden until the ghost lands. prefers-reduced-motion → no ghost at all.
import { useLayoutEffect, useRef } from "react";

interface PendingFly {
    key: string;
    from: DOMRect;
    src: string;
    /** Selector to fly to when the card's new home is not on screen (a
     *  hidden tab) — e.g. the Sideboard tab pill. */
    fallback?: string;
}

const DURATION_MS = 460;

function reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function visible(el: Element | null): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

/** Bring the target inside its horizontal scroller (never scrolls the page). */
function revealInScroller(el: HTMLElement) {
    const scroller = el.closest<HTMLElement>("[data-hscroll]");
    if (!scroller) return;
    const s = scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < s.left) scroller.scrollLeft -= s.left - r.left + 12;
    else if (r.right > s.right) scroller.scrollLeft += r.right - s.right + 12;
}

function pulse(el: HTMLElement) {
    el.animate(
        [
            { transform: "scale(1)" },
            { transform: "scale(1.12)" },
            { transform: "scale(1)" },
        ],
        { duration: 320, easing: "ease-out" }
    );
}

function fly(p: PendingFly) {
    const target = document.querySelector(
        `[data-fly-key="${CSS.escape(p.key)}"]`
    );
    const landed = visible(target) ? target : null;
    const fallback = p.fallback
        ? document.querySelector<HTMLElement>(p.fallback)
        : null;
    if (!landed && !visible(fallback)) return;
    if (landed) revealInScroller(landed);
    const dest = (landed ?? fallback) as HTMLElement;
    const to = dest.getBoundingClientRect();
    // Fallback (a tab pill): land a card-sized ghost centred on it, shrinking.
    const w = landed ? to.width : p.from.width;
    const h = landed ? to.height : p.from.height;
    const left = landed ? to.left : to.left + to.width / 2 - w / 2;
    const top = landed ? to.top : to.top + to.height / 2 - h / 2;
    const endScale = landed ? 1 : 0.25;

    const ghost = document.createElement("img");
    ghost.src = p.src;
    ghost.alt = "";
    Object.assign(ghost.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${w}px`,
        height: `${h}px`,
        borderRadius: `${w * 0.048}px`,
        zIndex: "80",
        pointerEvents: "none",
        transformOrigin: "top left",
        boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
        willChange: "transform",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
    if (landed) landed.style.visibility = "hidden";

    const dx = p.from.left - left;
    const dy = p.from.top - top;
    const sx = p.from.width / w;
    const sy = p.from.height / h;
    // A shallow arc: the midpoint lifts above the straight line.
    const midX = dx / 2;
    const midY = dy / 2 - Math.min(80, Math.abs(dx) * 0.15 + 30);
    const anim = ghost.animate(
        [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            {
                transform: `translate(${midX}px, ${midY}px) scale(${(sx + endScale) / 2 + 0.08}) rotate(-3deg)`,
                offset: 0.5,
            },
            {
                transform: `translate(0px, 0px) scale(${endScale})`,
                opacity: landed ? 1 : 0.2,
            },
        ],
        { duration: DURATION_MS, easing: "cubic-bezier(.25,.8,.25,1)" }
    );
    const done = () => {
        ghost.remove();
        if (landed) landed.style.visibility = "";
        else pulse(dest);
    };
    anim.onfinish = done;
    anim.oncancel = done;
}

/** Returns `launch(key, sourceEl, src, fallback?)`; call it in the same
 *  handler that moves the card. Must live in the component whose state the
 *  move changes (its layout effect runs after that commit). */
export function useFly() {
    const pending = useRef<PendingFly[]>([]);
    useLayoutEffect(() => {
        if (pending.current.length === 0) return;
        const batch = pending.current;
        pending.current = [];
        if (reducedMotion()) return;
        for (const p of batch) fly(p);
    });
    return (key: string, el: Element, src: string, fallback?: string) => {
        pending.current.push({
            key,
            from: el.getBoundingClientRect(),
            src,
            fallback,
        });
    };
}
