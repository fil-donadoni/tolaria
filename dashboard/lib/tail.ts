import { useEffect, useRef, useState } from "react";
import { fmtAgoMs } from "./format";
import type { SessionView, TailEntry, TailPage } from "./nowPayload";

/**
 * The session tail's TRANSPORT (PRD #3148 S2), ported from
 * `scripts/dashboard/now-tail.js` (issue #3135).
 *
 * `/api/tail?session=<uuid>` returns the last entries and a byte `offset`;
 * every poll after that passes the offset back and receives only what was
 * appended, so following a multi-megabyte transcript costs a few hundred bytes
 * a tick. Two seconds, while the drawer is open and the tab visible; nothing
 * polls when it is closed — passing `null` stops it.
 *
 * The drawer is NON-MODAL, so the loop-status poll behind it keeps running.
 * That is the whole reason this is a second, independent transport rather than
 * a field on the loop-status payload: a conversation moves on its own clock.
 */

export const TAIL_POLL_MS = 2_000;
const TAIL_PATH = "/api/tail";
/** How many entries the log keeps before dropping the oldest. */
export const MAX_ENTRIES = 600;

export interface TailState {
    entries: TailEntry[];
    summary: SessionView | null;
    /** The foot line: `following · last write 3m ago · 2 new`, or an error. */
    status: string;
    /** Set when the status line is reporting a failure, so the component can
     *  tone it — never inferred by sniffing the string. */
    failed: boolean;
    /** True when the FIRST read did not reach the file's beginning. */
    truncated: boolean;
}

const EMPTY: TailState = {
    entries: [],
    summary: null,
    status: "connecting…",
    failed: false,
    truncated: false,
};

/**
 * Follow one session. `session === null` is closed: no timer, no request.
 *
 * The hook owns the DATA and nothing else — the component owns the scroll
 * container and reacts to `entries` changing. A callback out of here would
 * have to be held in a ref written during render, which is the shape React
 * asks you not to write.
 */
export function useTail(session: string | null): TailState {
    const [state, setState] = useState<TailState>(EMPTY);
    const offsetRef = useRef<number | null>(null);
    const inflightRef = useRef(false);

    useEffect(() => {
        if (!session) {
            setState(EMPTY);
            return;
        }
        // A NEW session starts from scratch: a stale offset would ask the
        // server for bytes past the end of a different file.
        offsetRef.current = null;
        inflightRef.current = false;
        setState(EMPTY);

        let cancelled = false;

        const poll = async (): Promise<void> => {
            if (
                cancelled ||
                inflightRef.current ||
                document.visibilityState !== "visible"
            ) {
                return;
            }
            inflightRef.current = true;
            try {
                const q = new URLSearchParams({ session });
                if (offsetRef.current !== null) {
                    q.set("offset", String(offsetRef.current));
                }
                const res = await fetch(`${TAIL_PATH}?${q}`);
                const page = (await res.json()) as TailPage & {
                    error?: string;
                };
                if (!res.ok)
                    throw new Error(page.error || `HTTP ${res.status}`);
                // The drawer may have been re-pointed while this was out.
                if (cancelled) return;
                const first = offsetRef.current === null;
                offsetRef.current = page.offset;
                setState((prev) => {
                    const kept = first ? [] : prev.entries;
                    const entries = [...kept, ...page.entries].slice(
                        -MAX_ENTRIES
                    );
                    return {
                        entries,
                        summary: page.summary,
                        // "last write" is the ONE fact the entry list
                        // cannot carry: a transcript that stopped moving
                        // renders identically to one that never had much in
                        // it, and this line is what tells the two apart.
                        status:
                            `following · last write ${fmtAgoMs(page.lastWriteMs)}` +
                            ` · ${page.entries.length} new`,
                        failed: false,
                        truncated: first ? page.truncated : prev.truncated,
                    };
                });
            } catch (e) {
                if (cancelled) return;
                setState((prev) => ({
                    ...prev,
                    status: `error: ${e instanceof Error ? e.message : String(e)}`,
                    failed: true,
                }));
            } finally {
                inflightRef.current = false;
            }
        };

        void poll();
        const timer = setInterval(() => void poll(), TAIL_POLL_MS);
        const onVisible = () => {
            if (document.visibilityState === "visible") void poll();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [session]);

    return state;
}

/** How each entry kind is labelled — the terminal's own vocabulary. */
export const KIND_LABEL: Record<string, string> = {
    user: "you",
    assistant: "claude",
    thinking: "thinking",
    tool_use: "tool",
    tool_result: "result",
    system: "system",
};

/** The word an entry's gutter prints: a tool call says which tool. */
export const entryLabel = (e: TailEntry): string =>
    e.kind === "tool_use" ? (e.tool ?? "tool") : (KIND_LABEL[e.kind] ?? e.kind);
