import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getImageUrl } from "~/lib/images";

const ZOOM_WIDTH = 128 * 2;
const ZOOM_ASPECT = 7 / 5;
const ZOOM_HEIGHT = ZOOM_WIDTH * ZOOM_ASPECT;
const GAP = 8;

function computeZoomPosition(cardRect: DOMRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: right if fits, otherwise left
    let left: number;
    if (cardRect.right + GAP + ZOOM_WIDTH <= vw) {
        left = cardRect.right + GAP;
    } else {
        left = cardRect.left - GAP - ZOOM_WIDTH;
    }

    // Vertical: centered on card, clamped to viewport
    const cardCenterY = cardRect.top + cardRect.height / 2;
    let top = cardCenterY - ZOOM_HEIGHT / 2;

    if (top < 0) {
        top = cardRect.top;
    } else if (top + ZOOM_HEIGHT > vh) {
        top = cardRect.bottom - ZOOM_HEIGHT;
    }

    return { top, left };
}

type CardPreviewProps = {
    cardId: string;
    cardName: string;
    children: React.ReactNode;
};

export default function CardPreview({
    cardId,
    cardName,
    children,
}: CardPreviewProps) {
    const [showZoom, setShowZoom] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const isHovered = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const updatePosition = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setPosition(computeZoomPosition(rect));
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "z" && isHovered.current) {
                updatePosition();
                setShowZoom(true);
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === "z") {
                setShowZoom(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [updatePosition]);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            updatePosition();
            setShowZoom(true);
            const onUp = () => {
                setShowZoom(false);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mouseup", onUp);
        },
        [updatePosition]
    );

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            onMouseEnter={() => {
                isHovered.current = true;
            }}
            onMouseLeave={() => {
                isHovered.current = false;
                setShowZoom(false);
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
        >
            {children}
            {showZoom &&
                createPortal(
                    <div
                        className="pointer-events-none fixed z-100"
                        style={{
                            top: position.top,
                            left: position.left,
                            width: ZOOM_WIDTH,
                        }}
                    >
                        <img
                            src={getImageUrl(cardId)}
                            className="rounded-2xl shadow-2xl"
                            alt={cardName}
                        />
                    </div>,
                    document.body
                )}
        </div>
    );
}
