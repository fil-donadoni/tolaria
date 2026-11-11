// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-preview-tabs=B|C`).
// The real toggle is rendered INSIDE the preview body, at its top. A variant
// that wants the tabs somewhere else on the desktop dock (left rail, bottom
// bar) portals itself into the dock PANEL from here, so the real dock and body
// stay untouched. Outside a dock (mobile overlay, deckbuilder) it renders
// inline, where the toggle already was.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const RAIL_WIDTH = 76;

export default function PrototypePreviewDockPortal({
    placement,
    children,
}: {
    placement: "left-rail" | "bottom";
    children: ReactNode;
}) {
    const marker = useRef<HTMLSpanElement>(null);
    // undefined = not resolved yet, null = no dock around (render inline).
    const [panel, setPanel] = useState<HTMLElement | null | undefined>(
        undefined
    );

    useLayoutEffect(() => {
        const el =
            marker.current?.closest<HTMLElement>(".card-preview-dock") ?? null;
        setPanel(el);
        if (!el || placement !== "left-rail") return;
        const scroll = el.querySelector<HTMLElement>(
            "[data-card-preview-scroll]"
        );
        const prev = {
            dir: el.style.flexDirection,
            width: el.style.width,
            flex: scroll?.style.flex ?? "",
            minWidth: scroll?.style.minWidth ?? "",
        };
        // The portal child is appended LAST; row-reverse puts it on the left.
        el.style.flexDirection = "row-reverse";
        el.style.width = `${el.offsetWidth + RAIL_WIDTH}px`;
        if (scroll) {
            scroll.style.flex = "1 1 0";
            scroll.style.minWidth = "0";
        }
        return () => {
            el.style.flexDirection = prev.dir;
            el.style.width = prev.width;
            if (scroll) {
                scroll.style.flex = prev.flex;
                scroll.style.minWidth = prev.minWidth;
            }
        };
    }, [placement]);

    return (
        <>
            <span ref={marker} hidden />
            {panel === undefined
                ? null
                : panel
                  ? createPortal(
                        <div
                            data-prototype-preview-tabs={placement}
                            className="shrink-0"
                            style={
                                placement === "left-rail"
                                    ? { width: RAIL_WIDTH }
                                    : undefined
                            }
                        >
                            {children}
                        </div>,
                        panel
                    )
                  : children}
        </>
    );
}
