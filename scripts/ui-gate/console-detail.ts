/**
 * A browser console error, readable (issue #6072).
 *
 * React reports a render error as `console.error("%o", error)`, so the
 * message TEXT is the bare format string: a whole `check:ui` run reported
 * five `%o` lines while the real cause, a Convex query timing out under the
 * shell, sat in the arguments. Each argument is read page-side (an `Error` by
 * its stack), with the text as the fallback when the page is gone.
 *
 * Diagnostic only: these lines print in the diagnostic block, which `land`
 * never reads.
 */

/** The slice of Playwright's `ConsoleMessage` this reads — a test double
 *  needs nothing more. */
export interface ConsoleMessageLike {
    text(): string;
    args(): readonly {
        evaluate<R>(fn: (value: unknown) => R): Promise<R>;
    }[];
}

export async function consoleErrorDetail(
    msg: ConsoleMessageLike
): Promise<string> {
    const text = msg.text();
    if (!text.includes("%")) return text;
    try {
        const parts = await Promise.all(
            msg.args().map((arg) =>
                arg.evaluate((value: unknown) => {
                    // Self-contained: Playwright ships this function's
                    // SOURCE to the page, where no outer name exists.
                    if (value instanceof Error) {
                        return value.stack ?? value.message;
                    }
                    if (typeof value === "string") return value;
                    try {
                        return JSON.stringify(value) ?? String(value);
                    } catch {
                        return String(value);
                    }
                })
            )
        );
        return parts.join(" ").replace(/\s+/g, " ");
    } catch {
        return text;
    }
}
