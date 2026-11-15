// PROTOTYPE — throwaway. What every variant receives from the real dialog.
import type { PublicMatch } from "@convex/matches";
import type { SideboardSplit } from "~/lib/deckSideboard";
import type { PoolRow } from "./proto-model";

export type ProtoVariantProps = {
    pool: PoolRow[];
    split: SideboardSplit;
    setSplit: (f: (s: SideboardSplit) => SideboardSplit) => void;
    reset: () => void;
    lockedSize: number;
    mainCount: number;
    sideCount: number;
    sizeOk: boolean;
    seatName: string;
    gameNumber: number;
    isChooser: boolean;
    playDraw: "play" | "draw";
    setPlayDraw: (v: "play" | "draw") => void;
    opponent: PublicMatch["players"][number] | null;
    submitting: boolean;
    onReady: () => void;
    countdown: React.ReactNode;
};
