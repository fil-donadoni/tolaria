import { createContext, useCallback, useContext, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice, PendingChoiceKind } from "~/types/game";
import { extractMutationError, type MutationError } from "~/lib/mutation-error";

/** Pending choice kinds that have migrated to the client-buffered submit
 *  model (ADR 0007). Used by the UI to decide whether to route a click
 *  through `bufferCtx.toggle` (new) or the legacy per-click
 *  `selectResolutionChoice` mutation (old). Slice #80 onboards
 *  `discard-hand`; #83 adds `untap-pick`; #84 adds `mulligan-bottom`; #85
 *  removes the legacy path entirely and this set can collapse to
 *  "everything except may-pay". */
export const CLIENT_BUFFERED_KINDS: ReadonlySet<PendingChoiceKind> =
    new Set<PendingChoiceKind>([
        "discard-hand",
        "untap-pick",
        "mulligan-bottom",
        "choose-permanents",
        "choose-damage-target",
        "option-pick",
        // Recall (LEG) — graveyard pick of N cards to return to hand.
        "choose-graveyard-card",
        // Legend rule keep-one (CR 704.5j, #378) — battlefield pick of exactly
        // one same-name legendary to keep.
        "legend-keep",
    ]);

export function isClientBufferedKind(kind: PendingChoiceKind): boolean {
    return CLIENT_BUFFERED_KINDS.has(kind);
}

/** Stable identity key for a `PendingChoice`. Used to drive the buffer's
 *  auto-clear `useEffect` — when the key changes (next choice in a chain,
 *  or queue empties), the buffer resets. Mulligan-bottom and cleanup-step
 *  discard carry `stackItemId === ""`, so we include `choiceId` and
 *  `playerId` to disambiguate. */
export function deriveChoiceKey(
    choice: PendingChoice | undefined
): string | null {
    if (!choice) return null;
    return `${choice.stackItemId}:${choice.step}:${choice.choiceId}:${choice.playerId}`;
}

/** Pure helper for the toggle operation. Adds the id if absent, removes it
 *  if present. Exported for unit testing. */
export function toggleId(buffer: string[], id: string): string[] {
    return buffer.includes(id)
        ? buffer.filter((x) => x !== id)
        : [...buffer, id];
}

export type PendingChoiceBuffer = {
    /** Ordered list of card instance ids the chooser has locally picked.
     *  Order matches click order (used by mulligan-bottom — first picked
     *  becomes top of the bottomed group). */
    buffer: string[];
    /** Toggle an id: add if absent, remove if present. No-op for non-
     *  chooser viewers (defensive — the UI should not call toggle in
     *  that case). */
    toggle: (id: string) => void;
    /** Clear the local buffer. */
    clear: () => void;
    /** Submit the buffered selection atomically via
     *  `api.game.submitResolutionChoice`. No-op if no active choice or a
     *  submission is already in-flight. */
    submit: () => Promise<void>;
    /** True between submit dispatch and its resolution. Action buttons
     *  must gate on this to prevent double-clicks (see
     *  `feedback-disable-while-pending`). */
    isPending: boolean;
    /** Last submission error (server-side rejection), shown via the error
     *  toast. `null` when there's nothing to surface. */
    lastError: MutationError | null;
    /** Route an arbitrary mutation rejection to the shared error toast. Used
     *  by fire-and-forget commit sites (hand cast, flashback, exile cast) that
     *  don't own a toast of their own, so a server-side validation rejection
     *  (e.g. "Not enough matching cards in your graveyard to pay the flashback
     *  cost") surfaces to the player instead of an uncaught console rejection. */
    reportError: (error: unknown) => void;
    /** Clear the error after the toast dismisses. */
    dismissError: () => void;
};

export const PendingChoiceBufferContext =
    createContext<PendingChoiceBuffer | null>(null);

/** Owns the buffer state for the active pending choice. Mounted by the
 *  board so all click sites share one source of truth. Resets when the
 *  choice identity changes. */
export function usePendingChoiceBufferState(args: {
    gameId: Id<"games">;
    playerId: string;
    activeChoice: PendingChoice | undefined;
}): PendingChoiceBuffer {
    const { gameId, playerId, activeChoice } = args;
    const [buffer, setBuffer] = useState<string[]>([]);
    const [isPending, setIsPending] = useState(false);
    const [lastError, setLastError] = useState<MutationError | null>(null);
    const submitMutation = useMutation(api.game.submitResolutionChoice);

    const choiceKey = deriveChoiceKey(activeChoice);

    // Reset buffer when the choice identity changes (next choice in a chain,
    // or queue empties). The official React pattern for "adjust some state
    // when a prop changes" — setState during render is supported here.
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const [trackedChoiceKey, setTrackedChoiceKey] = useState<string | null>(
        choiceKey
    );
    if (trackedChoiceKey !== choiceKey) {
        setTrackedChoiceKey(choiceKey);
        setBuffer([]);
        setLastError(null);
    }

    const toggle = useCallback((id: string) => {
        setBuffer((prev) => toggleId(prev, id));
    }, []);

    const clear = useCallback(() => setBuffer([]), []);

    const submit = useCallback(async () => {
        if (!activeChoice) return;
        if (isPending) return;
        setIsPending(true);
        try {
            await submitMutation({
                gameId,
                playerId,
                stackItemId: activeChoice.stackItemId,
                step: activeChoice.step,
                choiceId: activeChoice.choiceId,
                cardInstanceIds: buffer,
            });
        } catch (e) {
            setLastError(extractMutationError(e));
        } finally {
            setIsPending(false);
        }
    }, [activeChoice, isPending, buffer, gameId, playerId, submitMutation]);

    const reportError = useCallback(
        (error: unknown) => setLastError(extractMutationError(error)),
        []
    );

    const dismissError = useCallback(() => setLastError(null), []);

    return {
        buffer,
        toggle,
        clear,
        submit,
        isPending,
        lastError,
        reportError,
        dismissError,
    };
}

export function usePendingChoiceBuffer(): PendingChoiceBuffer {
    const ctx = useContext(PendingChoiceBufferContext);
    if (!ctx)
        throw new Error(
            "usePendingChoiceBuffer must be used within PendingChoiceBufferContext.Provider"
        );
    return ctx;
}
