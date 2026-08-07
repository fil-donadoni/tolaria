// Popover-collection state for every parameterised manual verb (issue
// #2170): draw/mill/exile-top/peek N, shuffle's confirm, a custom counter's
// name, a card's note and Concede's confirm. ONE instance is mounted on the
// Manual Board (`ManualBoardView`) and fed to every pile/card/controller verb
// factory through `ManualRuntime.requestVerbInput`, so at most one popover is
// ever open at a time — the anchored replacement for what used to be a
// synchronous `window.prompt`/`window.confirm` call at each verb's own call
// site.
//
// Split from `manual-verb-popover.tsx` (not co-located) because a file
// exporting both a hook and a component breaks Fast Refresh
// (`react-refresh/only-export-components` — verified by the lint failure
// this split fixes).

import { useCallback, useState } from "react";
import type { ManualVerbRequest, RequestVerbInput } from "~/lib/manual-runtime";

/** One open popover request: WHICH verb, WHERE it's anchored, and a `nonce`
 *  that changes on every new request so the popover's local form resets even
 *  when two requests share the same title (see `ManualVerbPopover`'s
 *  render-time reset, `CastCostDialog`'s own `prevOpen` pattern). */
export type PendingManualVerb = {
    anchor: Element | null;
    request: ManualVerbRequest;
    nonce: number;
};

export function useManualVerbPopoverState(): {
    pending: PendingManualVerb | null;
    requestVerbInput: RequestVerbInput;
    closeVerbPopover: () => void;
} {
    const [pending, setPending] = useState<PendingManualVerb | null>(null);
    const requestVerbInput = useCallback<RequestVerbInput>(
        (anchor, request) =>
            setPending((prev) => ({
                anchor,
                request,
                nonce: (prev?.nonce ?? 0) + 1,
            })),
        []
    );
    const closeVerbPopover = useCallback(() => setPending(null), []);
    return { pending, requestVerbInput, closeVerbPopover };
}
