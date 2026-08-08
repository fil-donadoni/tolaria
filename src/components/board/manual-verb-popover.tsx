import { Popover, PopoverContent } from "~/components/ui/popover";
import GameDialog from "~/components/ui/game-dialog";
import ManualVerbForm from "./manual-verb-form";
import type { PendingManualVerb } from "~/hooks/useManualVerbPopover";

/** The prompt surface for every parameterised manual verb (issue #2170) —
 *  never a native `window.prompt`/`window.confirm`/`window.alert`. Renders
 *  nothing while no verb is pending, and picks its shell from whether the verb
 *  HAS an element to point at:
 *
 *  - **anchored popover** — the pile tile or battlefield permanent the verb
 *    acts on, dismissible (ESC / outside click), board still visible behind it.
 *  - **centred dialog** — when `anchor` is `null`. Concede acts on the whole
 *    game and has no card or pile referent; it used to anchor to the board
 *    ROOT, which is the bug this split fixes. A popover anchored to a
 *    full-viewport element with `side="top"` positions itself ABOVE that
 *    element, i.e. off-screen (measured: `y: -94` on a 620px-tall board) —
 *    while Base UI still marks the rest of the page `data-base-ui-inert`. The
 *    result is a button that opens an invisible prompt and freezes the board
 *    behind it: indistinguishable from a dead button, which is exactly how it
 *    was reported. The same fallback covers any anchor selector that misses
 *    (a pile tile not currently mounted), where the old code positioned at an
 *    arbitrary point too.
 *
 *  `key={pending.nonce}` remounts the body on every new request, so its inputs
 *  reset even when two requests share the same title. */
export default function ManualVerbPopover({
    pending,
    onClose,
}: {
    pending: PendingManualVerb | null;
    onClose: () => void;
}) {
    if (!pending) return null;
    const { anchor, request, nonce } = pending;
    const body = (
        <ManualVerbForm key={nonce} request={request} onClose={onClose} />
    );

    if (!anchor) {
        return (
            <GameDialog
                open
                title={request.title}
                onOpenChange={(next) => {
                    if (!next) onClose();
                }}
            >
                {body}
            </GameDialog>
        );
    }

    return (
        <Popover
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <PopoverContent
                anchor={anchor}
                side="top"
                align="center"
                className="w-64"
            >
                <p className="mb-2.5 text-xs font-medium text-text">
                    {request.title}
                </p>
                {body}
            </PopoverContent>
        </Popover>
    );
}
