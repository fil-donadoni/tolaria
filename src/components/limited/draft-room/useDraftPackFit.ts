import { useEffect, useState, type RefObject } from "react";
import { fitAllLayout, readCardWidth, type FitLayout } from "./draftPackSizing";

/** The Pool band's own floor under the Booster (`min-h-[17.5rem]`) + the gap
 *  above it. */
const POOL_RESERVE_PX = 280 + 12;
/** Controls row, timer and error banner above the grid. */
const CHROME_RESERVE_PX = 96;
const MIN_HEIGHT_PX = 120;

/**
 * Measures the Booster band and returns the `fit` layout for `count` cards
 * (issue #9166), or `null` while `enabled` is false / nothing is measured.
 * The band's parent is the Draft Room surface, whose height bounds the grid.
 */
export function useDraftPackFit(
    bandRef: RefObject<HTMLElement | null>,
    enabled: boolean,
    count: number,
    hasPool: boolean
): FitLayout | null {
    const [layout, setLayout] = useState<FitLayout | null>(null);

    useEffect(() => {
        const band = bandRef.current;
        const surface = band?.parentElement;
        if (!enabled || !band || !surface) return;
        const measure = () => {
            const height =
                surface.clientHeight -
                CHROME_RESERVE_PX -
                (hasPool ? POOL_RESERVE_PX : 0);
            setLayout(
                fitAllLayout({
                    count,
                    width: band.clientWidth,
                    height: Math.max(height, MIN_HEIGHT_PX),
                    ceiling: readCardWidth(window.innerWidth),
                })
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(surface);
        observer.observe(band);
        return () => observer.disconnect();
    }, [bandRef, enabled, count, hasPool]);

    return enabled ? layout : null;
}
