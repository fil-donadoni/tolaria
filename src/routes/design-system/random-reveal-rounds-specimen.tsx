import { useEffect, useRef, type ReactNode } from "react";

/** The two-player Random Reveal (CR 705.2, issue #5520) over a fixed screen,
 *  the way the board mounts it. On mount it plays the viewer's click-to-end,
 *  so the lane measures the finished clash — every round in the table and the
 *  consequence line — rather than whichever hold between tosses it settles in.
 *  A viewer's click never acks. The section passes the mount in as `children`:
 *  only the section imports a row's mount. */
export default function RandomRevealRoundsSpecimen({
    children,
}: {
    children: ReactNode;
}) {
    const layer = useRef<HTMLDivElement>(null);
    useEffect(() => {
        layer.current
            ?.querySelector<HTMLElement>(
                '[data-testid="random-reveal-overlay"]'
            )
            ?.click();
    }, []);
    return (
        <div
            ref={layer}
            data-random-reveal-specimen
            className="fixed inset-0 z-modal"
        >
            {children}
        </div>
    );
}
