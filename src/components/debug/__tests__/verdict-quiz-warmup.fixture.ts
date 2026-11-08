// Opening the verdict quiz in a test, without racing its designed latency
// (issue #8781).
//
// The quiz's first open waits on two things no assertion is about:
//
//   * on-demand loads — the post-game queue is a `lazy()` chunk, the quiz
//     builder an `import()`, and since issue #8728 every hand-written Set is
//     installed through one dynamic import each. Under vitest a cold load is a
//     module transform, whose cost grows with the machine's load;
//   * React 19's Suspense reveal throttle: content that suspended behind the
//     `lazy()` boundary commits no sooner than 300ms after the fallback
//     (`FALLBACK_THROTTLE_MS`), however fast the chunk resolves.
//
// Both sat inside a `findByText` on the 1000ms default: ~0.3s idle, 2.2s under
// the health run's load — a RED that a fresh run then cleared. The loads are
// paid once in a `beforeAll` (bounded by the hook's timeout), and the question
// is awaited with a ceiling stated for what it waits on; a quiz that never
// opens still fails, inside the test's own timeout.

import { screen } from "@testing-library/react";
import { installHandWrittenSets } from "~/lib/catalogue/definitionShards";

/** Ceiling for the warm-up hook: cold module transforms on a loaded machine. */
export const WARM_VERDICT_QUIZ_MS = 60_000;

/** Ceiling for the quiz to show once its loads are warm: the 300ms Suspense
 *  reveal throttle plus a render, on a loaded machine. */
export const QUIZ_OPEN_MS = 10_000;

export const QUIZ_QUESTION = "Which move was right here?";

/** Load, once, everything the quiz's first open would load on demand. The
 *  queue imports the quiz builder statically, so it warms both. */
export async function warmVerdictQuiz(): Promise<void> {
    await Promise.all([
        import("~/components/debug/verdict-proposal-queue"),
        installHandWrittenSets(),
    ]);
}

/** The quiz's question, once it has opened. */
export function findQuizQuestion(): Promise<HTMLElement> {
    return screen.findByText(QUIZ_QUESTION, {}, { timeout: QUIZ_OPEN_MS });
}
