import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useSeatYields } from "~/hooks/useYieldPreferences";
import {
    optionalPromptIdentity,
    rememberedOptionalAnswerFor,
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

/** True when a `may-pay` accept needs nothing beyond the click: no cost (mana,
 *  life, sacrifice, discard, return) and no permanent/card pick. */
function acceptNeedsNoInput(choice: PendingChoice): boolean {
    return !choice.cost && !choice.zone;
}

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
    const isOwnMayPay =
        choice.kind === "may-pay" && choice.playerId === playerId;
    const item = isOwnMayPay
        ? stackItems.find((s) => s.id === choice.stackItemId)
        : undefined;
    const identity = useMemo(
        () =>
            item
                ? optionalPromptIdentity(item, {
                      step: choice.step,
                      choiceId: choice.choiceId,
                  })
                : null,
        [item, choice.step, choice.choiceId]
    );
    const offerYes = identity !== null && acceptNeedsNoInput(choice);
    const choiceKey = `${choice.stackItemId}:${choice.step}:${choice.choiceId}`;

    const remembered = rememberedOptionalAnswerFor(
        seat.optionalAnswers,
        identity
    );
    // A remembered "yes" applies only while accepting still needs no input: a
    // prompt of the same identity that now carries a cost is shown.
    const applicable =
        remembered === "skip" || (remembered === "yes" && offerYes)
            ? remembered
            : null;

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
