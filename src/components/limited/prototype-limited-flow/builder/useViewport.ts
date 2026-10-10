// PROTOTYPE — throwaway. Viewport rungs for the builder variants: phone
// portrait, phone landscape (short), tablet, desktop — and the card width
// each rung draws a pile card at.
import { useEffect, useState } from "react";

function useMedia(query: string): boolean {
    const [matches, setMatches] = useState(
        () => window.matchMedia(query).matches
    );
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setMatches(mq.matches);
        onChange();
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [query]);
    return matches;
}

export interface Viewport {
    /** Landscape phone: short (≤ 500px tall) and wider than tall. */
    landscapePhone: boolean;
    /** ≥ 768px wide and NOT a landscape phone. */
    md: boolean;
    lg: boolean;
    /** Pile card width in px for this rung. */
    cardW: number;
}

export function useViewport(): Viewport {
    const landscapePhone = useMedia(
        "(orientation: landscape) and (max-height: 500px)"
    );
    const mdRaw = useMedia("(min-width: 768px)");
    const lg = useMedia("(min-width: 1180px)");
    const md = mdRaw && !landscapePhone;
    const cardW = landscapePhone ? 58 : lg ? 112 : md ? 92 : 70;
    return { landscapePhone, md, lg, cardW };
}
