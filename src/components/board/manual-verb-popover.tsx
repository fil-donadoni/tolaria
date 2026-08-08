import { useState } from "react";
import { Popover, PopoverContent } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import NumberStepper from "~/components/ui/number-stepper";
import type { PendingManualVerb } from "~/hooks/useManualVerbPopover";

/** The anchored popover itself (issue #2170 AC): a numeric stepper for
 *  draw/mill/exile-top/peek N, a text field for the custom counter's name and
 *  a card's note, or an inline confirm for shuffle — never a native
 *  `window.prompt`/`window.confirm`/`window.alert`. Anchored to the pile tile
 *  or battlefield permanent the verb acts on, dismissible (ESC / outside
 *  click), and never blocks the board behind it. Renders nothing while no
 *  verb is pending. */
export default function ManualVerbPopover({
    pending,
    onClose,
}: {
    pending: PendingManualVerb | null;
    onClose: () => void;
}) {
    const [numberRaw, setNumberRaw] = useState("");
    const [text, setText] = useState("");
    // Render-time reset on a NEW request (`nonce` changed) — same pattern
    // `CastCostDialog` uses for its `prevOpen` diff. `pending` is a fresh
    // object per request, so this also covers "the same verb, picked twice
    // in a row" (the raw text must not leak the previous entry).
    const [prevNonce, setPrevNonce] = useState<number | undefined>(undefined);
    if (pending && pending.nonce !== prevNonce) {
        setPrevNonce(pending.nonce);
        setNumberRaw(
            pending.request.kind === "number"
                ? String(pending.request.defaultValue)
                : ""
        );
        setText(
            pending.request.kind === "text" ? pending.request.defaultValue : ""
        );
    }

    if (!pending) return null;
    const { anchor, request } = pending;

    const parsedNumber = Number.parseInt(numberRaw, 10);
    const numberMin = request.kind === "number" ? (request.min ?? 1) : 1;
    const numberValid =
        Number.isFinite(parsedNumber) && parsedNumber >= numberMin;

    const submit = () => {
        if (request.kind === "number") {
            if (!numberValid) return;
            request.onConfirm(parsedNumber);
        } else if (request.kind === "text") {
            request.onConfirm(text);
        } else {
            request.onConfirm();
        }
        onClose();
    };

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
                <form
                    className="flex flex-col gap-2.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                    }}
                >
                    <p className="text-xs font-medium text-text">
                        {request.title}
                    </p>
                    {request.kind === "confirm" && request.description && (
                        <p className="text-xs text-text-muted">
                            {request.description}
                        </p>
                    )}
                    {request.kind === "number" && (
                        <NumberStepper
                            value={numberRaw}
                            onChange={setNumberRaw}
                            min={numberMin}
                            autoFocus
                            aria-label={request.title}
                        />
                    )}
                    {request.kind === "text" && (
                        <Input
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={request.placeholder}
                            autoFocus
                            aria-label={request.title}
                        />
                    )}
                    <div className="mt-1 flex items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={request.kind === "number" && !numberValid}
                        >
                            Confirm
                        </Button>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    );
}
