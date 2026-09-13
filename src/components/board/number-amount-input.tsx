import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

/** Bounded amount picker for a `number-pick` pending choice (CR 107.1b /
 *  107.3f, issue #1701) — "choose a number", and with a mana cost attached
 *  "pay any amount of mana" / "you may pay {X}", where the controller chooses
 *  the value AS THE ABILITY RESOLVES.
 *
 *  Bounded, never free-form: `max` is the choice's live ceiling (for a paying
 *  nomination, what the chooser's pool can actually cover), computed by the
 *  parent from `numberChoiceRange` — the SAME authority the submit mutation
 *  re-validates against, so the stepper can never offer an amount the server
 *  refuses. Typed input is clamped into the range on the way out for the same
 *  reason.
 *
 *  The value starts at `min`, which for every shipped shape is 0 — and 0 IS the
 *  decline (CR 107.3f: paying {X} with X = 0 and declining are
 *  game-observably identical). So declining is ONE action, the confirm button,
 *  with no second prompt to dismiss (Arena parity, issue #2244).
 *
 *  Stateless w.r.t. the game — the parent owns the submit mutation and the
 *  in-flight `disabled` gate (project-wide: buttons firing a Convex mutation
 *  disable while it's in flight). */
export default function NumberAmountInput({
    min,
    max,
    paysMana,
    disabled,
    onSubmit,
}: {
    min: number;
    max: number;
    paysMana: boolean;
    disabled: boolean;
    onSubmit: (amount: number) => void;
}) {
    const [amount, setAmount] = useState(min);
    // The ceiling MOVES while the prompt is open: a may-pay window lets the
    // chooser go on tapping lands (CR 605.3a), and each tap re-projects a
    // bigger pool. Re-clamping on every bound change is what lets the stepper
    // grow with the pool instead of freezing at the amount that was affordable
    // when the prompt opened — and it pulls a stale value back down if mana
    // drains out from under it.
    useEffect(() => {
        setAmount((current) => Math.min(Math.max(current, min), max));
    }, [min, max]);

    const clamp = (next: number) => Math.min(Math.max(next, min), max);
    const submit = () => {
        if (disabled) return;
        onSubmit(clamp(amount));
    };

    return (
        <div className="flex flex-col items-center gap-1.5 mt-1">
            <div className="flex items-center gap-1.5">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Decrease amount"
                    disabled={disabled || amount <= min}
                    onClick={() => setAmount(clamp(amount - 1))}
                >
                    −
                </Button>
                <Input
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={String(amount)}
                    disabled={disabled}
                    aria-label="Amount"
                    className="h-auto w-20 px-2.5 py-1.5 text-center text-xs"
                    onChange={(e) => {
                        const parsed = Number(e.target.value);
                        setAmount(
                            Number.isFinite(parsed) ? clamp(parsed) : min
                        );
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            submit();
                        }
                    }}
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Increase amount"
                    disabled={disabled || amount >= max}
                    onClick={() => setAmount(clamp(amount + 1))}
                >
                    +
                </Button>
            </div>
            <p className="text-text-disabled text-xs">
                {min} – {max} available
            </p>
            <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={disabled}
                onClick={submit}
            >
                {amount === min && min === 0
                    ? "Decline"
                    : paysMana
                      ? `Pay ${amount}`
                      : `Choose ${amount}`}
            </Button>
        </div>
    );
}
