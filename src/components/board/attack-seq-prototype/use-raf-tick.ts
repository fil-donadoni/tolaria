// PROTOTYPE (issue #9500) — re-render every frame so overlays track the cards.
import { useEffect, useState } from "react";

export function useRafTick(active: boolean): number {
    const [t, setT] = useState(0);
    useEffect(() => {
        if (!active) return;
        let id = 0;
        const loop = () => {
            setT((x) => (x + 1) % 1_000_000);
            id = requestAnimationFrame(loop);
        };
        id = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(id);
    }, [active]);
    return t;
}
