import { useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ManualDispatch } from "~/lib/manual-runtime";

/** Binds every manual verb this board surfaces to one game id (PRD #2162,
 *  issue #2169).
 *
 *  This is the ONLY place the Manual Board reaches Convex for a write, which is
 *  what lets every injected seam stay a plain function: they receive the bound
 *  dispatcher rather than calling `useMutation` themselves, so none of them is
 *  a hook and none of them cares where it is mounted.
 *
 *  Every entry maps 1:1 onto a `manual*` mutation that already exists in
 *  `convex/game.ts` — issue #2169 adds no server capability whatsoever. */
export function useManualDispatch(gameId: Id<"games">): ManualDispatch {
    const moveCard = useMutation(api.game.manualMoveCard);
    const setTapped = useMutation(api.game.manualSetTapped);
    const untapAll = useMutation(api.game.manualUntapAll);
    const adjustLife = useMutation(api.game.manualAdjustLife);
    const adjustCounter = useMutation(api.game.manualAdjustCounter);
    const setFaceDown = useMutation(api.game.manualSetFaceDown);
    const setLane = useMutation(api.game.manualSetLane);
    const attach = useMutation(api.game.manualAttach);
    const setArrow = useMutation(api.game.manualSetArrow);
    const clearArrow = useMutation(api.game.manualClearArrow);
    const draw = useMutation(api.game.manualDraw);
    const mill = useMutation(api.game.manualMill);
    const exileTop = useMutation(api.game.manualExileTop);
    const peek = useMutation(api.game.manualPeek);
    const shuffle = useMutation(api.game.manualShuffle);
    const setNote = useMutation(api.game.manualSetNote);
    const endTurn = useMutation(api.game.manualEndTurn);
    const concede = useMutation(api.game.manualConcede);

    return useMemo<ManualDispatch>(
        () => ({
            moveCard: (args) => void moveCard({ gameId, ...args }),
            setTapped: (args) => void setTapped({ gameId, ...args }),
            untapAll: (args) => void untapAll({ gameId, ...args }),
            adjustLife: (args) => void adjustLife({ gameId, ...args }),
            adjustCounter: (args) => void adjustCounter({ gameId, ...args }),
            setFaceDown: (args) => void setFaceDown({ gameId, ...args }),
            setLane: (args) => void setLane({ gameId, ...args }),
            attach: (args) => void attach({ gameId, ...args }),
            setArrow: (args) => void setArrow({ gameId, ...args }),
            clearArrow: (args) => void clearArrow({ gameId, ...args }),
            draw: (args) => void draw({ gameId, ...args }),
            mill: (args) => void mill({ gameId, ...args }),
            exileTop: (args) => void exileTop({ gameId, ...args }),
            peek: (args) => void peek({ gameId, ...args }),
            shuffle: (args) => void shuffle({ gameId, ...args }),
            setNote: (args) => void setNote({ gameId, ...args }),
            endTurn: (args) => void endTurn({ gameId, ...args }),
            concede: (args) => void concede({ gameId, ...args }),
        }),
        [
            gameId,
            moveCard,
            setTapped,
            untapAll,
            adjustLife,
            adjustCounter,
            setFaceDown,
            setLane,
            attach,
            setArrow,
            clearArrow,
            draw,
            mill,
            exileTop,
            peek,
            shuffle,
            setNote,
            endTurn,
            concede,
        ]
    );
}
