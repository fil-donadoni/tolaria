// The body of every parameterised manual verb prompt (issue #2170): the
// numeric stepper for draw/mill/exile-top/peek N, the text field for a custom
// counter's name or a card's note, the bare confirm for shuffle and concede —
// plus Cancel/Confirm.
//
// Split out of `manual-verb-popover.tsx` because that file now picks between
// TWO shells (an anchored popover, or a centred dialog when the verb has no
// element to anchor to) and the body must not be written twice.
//
// It owns its own input state, and the caller remounts it (`key={nonce}`) on
// every new request — so "the same verb, picked twice in a row" starts empty
// instead of leaking the previous entry, without a render-time reset dance.

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import NumberStepper from "~/components/ui/number-stepper";
import type { ManualVerbRequest } from "~/lib/manual-runtime";

export default function ManualVerbForm({
    request,
    onClose,
}: {
    request: ManualVerbRequest;
    onClose: () => void;
}) {
    const [numberRaw, setNumberRaw] = useState(
        request.kind === "number" ? String(request.defaultValue) : ""
    );
    const [text, setText] = useState(
        request.kind === "text" ? request.defaultValue : ""
    );

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
        <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
                e.preventDefault();
                submit();
            }}
        >
            {request.kind === "confirm" && request.description && (
                <p className="text-xs text-text-muted">{request.description}</p>
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
    );
}
