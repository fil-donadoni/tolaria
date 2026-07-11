import type { ReactNode } from "react";
import AmbientPageGround from "~/components/ui/ambient-page-ground";

/** Full-viewport frame for the invite antechamber states (general page layout:
 *  ambient ground + a centred opaque Panel supplied as children). Shared by the
 *  join form and its not-joinable fallbacks so every state sits on one layout. */
export default function JoinAntechamberShell({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="relative flex h-dvh flex-col items-center justify-center overflow-hidden bg-surface-base px-4 text-text">
            <AmbientPageGround ring />
            {children}
        </div>
    );
}
