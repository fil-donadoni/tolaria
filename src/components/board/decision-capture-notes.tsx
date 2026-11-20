// The play-time notes of the Verdict Proposal capture (issue #10088, PRD
// issue #10083): the plainest affordance that makes the capture usable — a
// collapsed "Notes" toggle in a corner, away from every game action. Opened,
// it states a Plan (which stands until another is stated) and annotates the
// decision the seat is on: a comment in the player's own words, or the
// one-gesture "obvious" mark. Everything lands in `human-decision-capture.ts`,
// persisted with the decisions; a commented decision is always offered in the
// post-game review. The Brain is never asked anything here.
//
// Deliberately plain: the designed overlay is a later ticket (PRD issue
// #10083 § The capture overlay).

import { useState, useSyncExternalStore } from "react";
import {
    annotateHumanDecision,
    humanCaptureVersion,
    humanCaptureView,
    stateHumanPlan,
    subscribeHumanCapture,
} from "~/lib/ai/human-decision-capture";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export default function DecisionCaptureNotes({
    gameId,
    seatId,
    seq,
}: {
    gameId: string;
    /** The seat the notes are about — the viewer's (solo: the seat it
     *  follows). */
    seatId: string;
    /** The `seq` of the state on screen: a Plan is tied to it. */
    seq: number;
}) {
    useSyncExternalStore(subscribeHumanCapture, humanCaptureVersion);
    const { plan, decision } = humanCaptureView(gameId, seatId);
    const [open, setOpen] = useState(false);
    const [planDraft, setPlanDraft] = useState("");
    const [comment, setComment] = useState("");

    const statePlan = () => {
        if (stateHumanPlan(gameId, seatId, seq, planDraft)) setPlanDraft("");
    };
    const annotate = (kind: "comment" | "obvious") => {
        if (!decision) return;
        const done = annotateHumanDecision(
            gameId,
            seatId,
            decision.seq,
            kind === "comment" ? { kind, text: comment } : { kind }
        );
        if (done && kind === "comment") setComment("");
    };

    return (
        <div
            data-testid="decision-capture-notes"
            className="pointer-events-auto fixed left-2 top-14 z-hud flex max-w-72 flex-col gap-1.5 text-[11px]"
        >
            <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                {open ? "Hide notes" : "Notes"}
            </Button>
            {open && (
                <div className="flex flex-col gap-1.5 rounded-sm border border-border-strong bg-surface p-2">
                    <p className="break-words text-text-muted">
                        {plan ? `Plan: ${plan.text}` : "No plan stated."}
                    </p>
                    <Input
                        aria-label="Plan"
                        placeholder="Your plan for the coming turns"
                        value={planDraft}
                        onChange={(e) => setPlanDraft(e.target.value)}
                    />
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={planDraft.trim() === ""}
                        onClick={statePlan}
                    >
                        State plan
                    </Button>
                    {decision ? (
                        <>
                            <p className="break-words text-text-muted">
                                {decision.annotation?.kind === "comment"
                                    ? `This decision: ${decision.annotation.text}`
                                    : decision.annotation?.kind === "obvious"
                                      ? "This decision: obvious."
                                      : "This decision: no note."}
                            </p>
                            <Input
                                aria-label="Why this decision"
                                placeholder="Why this decision"
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                            />
                            <div className="flex gap-1.5">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={comment.trim() === ""}
                                    onClick={() => annotate("comment")}
                                >
                                    Comment
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => annotate("obvious")}
                                >
                                    Obvious
                                </Button>
                            </div>
                        </>
                    ) : (
                        <p className="text-text-disabled">No decision open.</p>
                    )}
                </div>
            )}
        </div>
    );
}
