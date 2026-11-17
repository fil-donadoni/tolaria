import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useSeatYields } from "~/hooks/useYieldPreferences";
import {
    optionalPromptStatus,
    type OptionalAnswer,
    type OptionalPromptIdentity,
} from "~/lib/yields";

export type OptionalAnswerControl = {
    /** The prompt's identity, or `null` when it has none (not a `may-pay`, not
     *  this seat's, or a stack object with no **Yield** identity) — then
     *  neither toggle renders. */
    identity: OptionalPromptIdentity | null;
    /** "Always yes" is offered: accepting needs no further input (no cost, so
     *  nothing is ever paid unattended). */
    offerYes: boolean;
    /** "Always skip" is offered (any prompt with an identity). */
    offerSkip: boolean;
    /** The remembered answer is being submitted for this choice — the prompt
     *  renders nothing. */
    autoAnswering: boolean;
    /** The answer a toggle is submitting, or `null`. */
    answering: OptionalAnswer | null;
    /** Turn a toggle on: record the rule AND answer the current prompt. */
    answerAlways: (answer: OptionalAnswer) => void;
};

/** **Auto-answer** (issue #9863) for the optional-action (`may-pay`) prompt:
 *  the identity, the two toggles' availability, and the auto-submit.
 *
 *  The auto-submit mirrors **Auto-order**'s latch in `TriggerOrderPrompt`: the
 *  decision is latched per choice (`stackItemId:step:choiceId`), submitted once
 *  through the same `submitMayPay` the buttons use — the server re-validates it
 *  (ADR 0074) — and a refused submit shows the prompt instead of retrying. */
export function useOptionalAnswer(
    choice: PendingChoice,
    gameId: Id<"games">,
    playerId: string
): OptionalAnswerControl {
    const { stackItems } = useGameContext();
    const seat = useSeatYields();
    const submitMayPay = useMutation(api.game.submitMayPay);
    const { identity, offerYes, applicable } = optionalPromptStatus(
        choice,
        playerId,
        stackItems ?? [],
        seat.optionalAnswers
    );
    const choiceKey = `${choice.stackItemId}:${choice.step}:${choice.choiceId}`;

    // The choice a toggle already answered. Recording the rule happens while
    // the choice is still in the state, so the still-mounted prompt would
    // otherwise match its own fresh memory and submit a second time.
    const [answered, setAnswered] = useState<{
        key: string;
        answer: OptionalAnswer;
    } | null>(null);
    // The choice this client decided to auto-answer, LATCHED with the answer:
    // a reset landing while the submit is in flight must not reopen a prompt
    // whose button would answer the same choice again.
    const [auto, setAuto] = useState<{
        key: string;
        answer: OptionalAnswer;
    } | null>(null);
    if (
        applicable !== null &&
        answered?.key !== choiceKey &&
        auto?.key !== choiceKey
    ) {
        setAuto({ key: choiceKey, answer: applicable });
    }
    const [failedKey, setFailedKey] = useState<string | null>(null);
    const submittedKey = useRef<string | null>(null);
    const autoAnswering = auto?.key === choiceKey && failedKey !== choiceKey;

    useEffect(() => {
        if (!autoAnswering || !auto) return;
        if (submittedKey.current === choiceKey) return;
        submittedKey.current = choiceKey;
        submitMayPay({
            gameId,
            playerId,
            accept: auto.answer === "yes",
        }).catch(() => setFailedKey(choiceKey));
    }, [autoAnswering, auto, choiceKey, submitMayPay, gameId, playerId]);

    const answerAlways = (answer: OptionalAnswer) => {
        if (!identity || answered?.key === choiceKey) return;
        if (answer === "yes" && !offerYes) return;
        setAnswered({ key: choiceKey, answer });
        seat.rememberOptionalAnswer({
            ...identity,
            prompt: choice.prompt,
            answer,
        });
        // A refused submit shows the prompt again, and marks the choice failed
        // so the rule just recorded does not auto-submit it a second time.
        submitMayPay({ gameId, playerId, accept: answer === "yes" }).catch(
            () => {
                setFailedKey(choiceKey);
                setAnswered(null);
            }
        );
    };

    return {
        identity,
        offerYes,
        offerSkip: identity !== null,
        autoAnswering,
        answering: answered?.key === choiceKey ? answered.answer : null,
        answerAlways,
    };
}
