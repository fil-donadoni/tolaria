// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-turn=A|B|C`).
// "Make green/red more visible to understand whose TURN it is." Today's edge
// glow is keyed on PRIORITY; every variant here is keyed on the ACTIVE PLAYER.
import PrototypeTurnFrameThick from "./prototype-turn-frame-thick";
import PrototypeTurnFrameHandoff from "./prototype-turn-frame-handoff";
import PrototypeTurnFrameSplit from "./prototype-turn-frame-split";
import { usePrototypeTurnState } from "./use-prototype-turn-state";

export default function PrototypeTurnFrame({ variant }: { variant: string }) {
    const { gameOver } = usePrototypeTurnState();
    if (gameOver) return null;
    if (variant === "B") return <PrototypeTurnFrameHandoff />;
    if (variant === "C") return <PrototypeTurnFrameSplit />;
    return <PrototypeTurnFrameThick />;
}
