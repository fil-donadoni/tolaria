import type { ReactNode } from "react";
import AmbientPageGround from "~/components/ui/ambient-page-ground";

/** Shell-filling frame for the invite antechamber states (general page layout:
 *  ambient ground + a centred opaque Panel supplied as children). Shared by the
 *  join form and its not-joinable fallbacks so every state sits on one layout.
 *
 *  Claims the shell's REMAINING height as a FLOOR (`min-h-full`), never a whole
 *  viewport (issue #2274): `/join/$gameId` wears the shared header, so an
 *  `h-dvh` here overflowed `<main>` by exactly the header band. A floor rather
 *  than a hard height, and with NO `overflow-hidden` — hiding the overflow of a
 *  shrinkable flex child of `<main>` clamps it to the remainder and CLIPS a
 *  tall Panel with no scrollbar anywhere (browser-measured on the lobby, which
 *  shares this shape). The ambient ring is clipped by `AmbientPageGround`'s own
 *  `absolute inset-0 overflow-hidden`. */
export default function JoinAntechamberShell({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="relative flex min-h-full flex-col items-center justify-center bg-surface-base px-4 text-text">
            <AmbientPageGround ring />
            {children}
        </div>
    );
}
