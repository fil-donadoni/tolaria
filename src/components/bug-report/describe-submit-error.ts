import { ConvexError } from "convex/values";

/**
 * Turns a bug-report submission failure into a message worth showing.
 *
 * Convex strips the message of an ordinary `Error` thrown by a server function
 * in production — the client only ever sees `"Server Error"` plus a request id.
 * A `ConvexError` is the documented exception: its payload crosses the wire
 * intact, so the readable reason ("missing GITHUB_TOKEN", a GitHub API status)
 * arrives on `err.data`. Read that first, then fall back to the plain message
 * for client-side failures (file too large, upload failed).
 */
export function describeSubmitError(err: unknown): string {
    if (err instanceof ConvexError) {
        const data: unknown = err.data;
        if (typeof data === "string" && data.trim()) return data;
        if (
            data &&
            typeof data === "object" &&
            "message" in data &&
            typeof (data as { message: unknown }).message === "string"
        ) {
            return (data as { message: string }).message;
        }
    }
    if (err instanceof Error && err.message.trim()) return err.message;
    return "Something went wrong";
}
