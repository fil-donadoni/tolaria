// PROTOTYPE — throwaway. A single battlefield permanent rendered at board size,
// with an absolutely-positioned overlay slot for the attachment cluster. No
// GameContext dependency (unlike the real BoardBattlefieldCard) so it mounts on
// a bare prototype route.
import type { CardInstance } from "~/types/game";
import CardImage from "../cards/card-image";

export default function MockHostCard({
    host,
    behind,
    children,
}: {
    host: CardInstance;
    /** Overlay painted BEHIND the host art (lower z) — satellites tucked behind
     *  the card so only their overhang shows. */
    behind?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <div className="relative w-[132px] aspect-5/7">
            {behind}
            <div className="relative z-10 w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]">
                <CardImage card={host} />
            </div>
            {children}
        </div>
    );
}
