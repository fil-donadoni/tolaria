/**
 * PROTOTYPE — faithful hybrid board demo (/prototype/board-full).
 * DOM board + CSS 3D card tilt + Pixi FX overlay. Throwaway.
 */

import FullBoard from "./prototype-board/full-board";

export default function PrototypeBoardFullRoute() {
    return (
        <div
            className="fixed inset-0 overflow-hidden"
            style={{
                backgroundImage:
                    "radial-gradient(ellipse at 50% 18%, #1a2433 0%, #0a0c10 55%, #06070a 100%)",
            }}
        >
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[60] text-[11px] text-white/40">
                PROTOTYPE · hover cards for 3D tilt + glare · Cast → BF for
                particle burst
            </div>
            <FullBoard />
        </div>
    );
}
