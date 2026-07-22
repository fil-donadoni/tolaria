// Two-step "Play vs AI" setup (PRD #589 lobby flow). Clicking "Play vs AI" in
// the Play panel no longer starts a match directly — it opens this dialog, the
// second step, which collects the two vs-AI knobs (difficulty, AI opponent
// deck) and only fires `createSoloGame` on Confirm. The player's OWN deck
// remains the Lobby hero selection and is NOT asked here. Match format is NOT
// vs-AI-specific — it governs Solo and Create Multiplayer too, so its selector
// lives in the Play box (`dashboard-play-box`) and is not duplicated here.
//
// The selectors are the same reusable controls that used to live inline in the
// Play panel; they edit the lobby's persisted state through their setters, so
// last-used values reappear as defaults on the next open.

import type { Difficulty } from "@convex/gre";
import type { LobbyDeck } from "~/lib/deckTypes";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import DifficultySelector from "./difficulty-selector";
import AiDeckSelector from "./ai-deck-selector";

interface VsAiSetupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    difficulty: Difficulty;
    onDifficultyChange: (difficulty: Difficulty) => void;
    /** All decks selectable as the AI opponent's deck (user + preset). */
    decks: LobbyDeck[];
    /** Selected AI opponent deck presetId, or null to mirror the player. */
    aiDeckId: string | null;
    onAiDeckChange: (presetId: string | null) => void;
    onConfirm: () => void;
    /** Create mutation in-flight: keeps the controls + Confirm inert so a
     *  double-fire can't slip through (project rule: mutation buttons disable
     *  while pending). */
    pending?: boolean;
}

export default function VsAiSetupDialog({
    open,
    onOpenChange,
    difficulty,
    onDifficultyChange,
    decks,
    aiDeckId,
    onAiDeckChange,
    onConfirm,
    pending = false,
}: VsAiSetupDialogProps) {
    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Play vs AI"
            subtitle="Choose the difficulty and the deck your AI opponent will play."
            footer={
                <>
                    <ActionButton
                        onClick={() => onOpenChange(false)}
                        label="Cancel"
                        tone="secondary"
                        disabled={pending}
                    />
                    <ActionButton
                        onClick={onConfirm}
                        label="Play vs AI"
                        tone="primary"
                        disabled={pending}
                    />
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <DifficultySelector
                    value={difficulty}
                    onChange={onDifficultyChange}
                    disabled={pending}
                />
                <AiDeckSelector
                    decks={decks}
                    value={aiDeckId}
                    onChange={onAiDeckChange}
                    disabled={pending}
                />
            </div>
        </GameDialog>
    );
}
