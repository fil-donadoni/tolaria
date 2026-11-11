// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=A|B|C`).
// DOM measurement for the target-arrow overlay. Deliberately reads the board
// the way a player sees it (the anchors and rings the real components already
// emit) instead of re-deriving target legality — the prototype asks what the
// choice should LOOK like, not who is legal.
import type { AnchorPoint } from "~/lib/target-arrow-geometry";

export type PrototypeTargetBox = {
    id: string;
    label: string;
    el: HTMLElement;
    /** Top-left + size, in the overlay's own coordinates. */
    x: number;
    y: number;
    w: number;
    h: number;
    center: AnchorPoint;
};

export type PrototypeTargetSessionShape = {
    kind: "attack" | "spell";
    verb: string;
    sourceIds: string[];
    /** Attack only: the defending planeswalkers (the real board gives them no
     *  ring to read back, so they come from state). */
    permanentTargetIds: string[];
};

const esc = (id: string) => CSS.escape(id);

function box(
    el: HTMLElement,
    id: string,
    label: string,
    origin: DOMRect
): PrototypeTargetBox | null {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    const x = r.left - origin.left;
    const y = r.top - origin.top;
    return {
        id,
        label,
        el,
        x,
        y,
        w: r.width,
        h: r.height,
        center: { x: x + r.width / 2, y: y + r.height / 2 },
    };
}

function sourceElement(id: string): HTMLElement | null {
    return (
        // A permanent (attacker / ability source) …
        document.querySelector<HTMLElement>(
            `[data-arrow-anchor-permanent="${esc(id)}"]`
        ) ??
        // … the card being cast, still in its hand slot …
        document.querySelector<HTMLElement>(`[data-card-slot="${esc(id)}"]`) ??
        // … or a trigger / copy already on the stack.
        document.querySelector<HTMLElement>("[data-arrow-anchor-stack]")
    );
}

export function measurePrototypeTargets(
    session: PrototypeTargetSessionShape,
    origin: DOMRect,
    nameOf: (kind: "permanent" | "player", id: string) => string
): { sources: PrototypeTargetBox[]; targets: PrototypeTargetBox[] } {
    const sources = session.sourceIds.flatMap((id) => {
        const el = sourceElement(id);
        const b = el && box(el, id, nameOf("permanent", id), origin);
        return b ? [b] : [];
    });

    const targets: PrototypeTargetBox[] = [];
    const seen = new Set<string>();
    const push = (
        el: HTMLElement,
        kind: "permanent" | "player",
        id: string
    ) => {
        const key = `${kind}:${id}`;
        if (seen.has(key)) return;
        const b = box(el, key, `${session.verb} ${nameOf(kind, id)}`, origin);
        if (!b) return;
        seen.add(key);
        targets.push(b);
    };

    if (session.kind === "attack") {
        for (const id of session.permanentTargetIds) {
            const el = document.querySelector<HTMLElement>(
                `[data-arrow-anchor-permanent="${esc(id)}"]`
            );
            if (el) push(el, "permanent", id);
        }
    } else {
        // The real board already rings every legal permanent target.
        document
            .querySelectorAll<HTMLElement>("[data-arrow-anchor-permanent]")
            .forEach((el) => {
                const id = el.dataset.arrowAnchorPermanent;
                if (!id || session.sourceIds.includes(id)) return;
                if (
                    el.matches(".card-ring-candidate") ||
                    el.querySelector(".card-ring-candidate")
                )
                    push(el, "permanent", id);
            });
    }
    document
        .querySelectorAll<HTMLElement>(
            "[data-arrow-anchor-player][data-prototype-targetable]"
        )
        .forEach((el) => {
            const id = el.dataset.arrowAnchorPlayer;
            if (id) push(el, "player", id);
        });
    return { sources, targets };
}

export function prototypeBoxContains(b: PrototypeTargetBox, p: AnchorPoint) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

export function prototypeNearestBox(
    boxes: PrototypeTargetBox[],
    p: AnchorPoint
): PrototypeTargetBox | null {
    let best: PrototypeTargetBox | null = null;
    let bestD = Infinity;
    for (const b of boxes) {
        const d = Math.hypot(b.center.x - p.x, b.center.y - p.y);
        if (d < bestD) {
            bestD = d;
            best = b;
        }
    }
    return best;
}
