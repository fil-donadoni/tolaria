// How the verdict quiz's build settles, and how a failed publish is reported
// (issue #9822). Split from the panel so the two failures the old single
// `.catch` conflated have two homes: a build that throws is `builder-threw`; a
// React error raised by the panel's own `setState` is not a builder fault.

import * as Sentry from "@sentry/react";
import {
    describeCause,
    quizRefusal,
    type QuizFeed,
    type QuizSubject,
    type VerdictQuiz,
    type VerdictQuizRefusal,
} from "~/lib/ai/verdict-quiz";
import { installHandWrittenSets } from "~/lib/catalogue/definitionShards";

export type QuizState =
    | { status: "loading" }
    | { status: "unbuildable"; refusal: VerdictQuizRefusal }
    | { status: "ready"; quiz: VerdictQuiz };

/** Load the builder, make the Sets resident, build. Never rejects: every
 *  throw on the way is a `builder-threw` refusal carrying the raw cause. */
export async function settleQuiz(feed: QuizFeed): Promise<QuizState> {
    try {
        // Lowering and rebuilding a position read the token catalogue, a walk
        // of the whole hand-written catalogue, and a game holds only its own
        // Sets.
        const [{ buildVerdictQuiz }] = await Promise.all([
            import("~/lib/ai/verdict-quiz"),
            installHandWrittenSets(),
        ]);
        // A decision taken over a stack lowers like any other since issue
        // #3514: the stack travels in `spec.stack`.
        const result = buildVerdictQuiz(feed);
        return result.ok
            ? { status: "ready", quiz: result.quiz }
            : { status: "unbuildable", refusal: result.refusal };
    } catch (cause: unknown) {
        return {
            status: "unbuildable",
            refusal: quizRefusal(
                "builder-threw",
                `the quiz could not be built: ${describeCause(cause)}`
            ),
        };
    }
}

/** A throw out of the panel's publishing `setState`: to the console and to
 *  Sentry with the decision's identity (never the position), so the next
 *  occurrence carries a stack instead of a minified code. Best-effort. */
export function reportPublishFailure(
    cause: unknown,
    subject: QuizSubject
): void {
    console.error("verdict quiz: publishing the build result threw", cause);
    try {
        Sentry.captureException(cause, {
            tags: { feature: "verdict-quiz", step: "publish" },
            extra: {
                decisionId: subject.id,
                seq: subject.seq ?? null,
                gameId: subject.gameId ?? null,
                feed: subject.feed?.kind ?? null,
            },
        });
    } catch {
        // Monitoring never costs the panel its refusal.
    }
}
