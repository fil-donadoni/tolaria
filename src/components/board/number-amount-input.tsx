import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

/** Amount picker for a `number-pick` pending choice (CR 107.1b / 107.3f,
 *  issues #1701 / #1421) — "choose a number", and with a mana cost attached
 *  "pay any amount of mana" / "you may pay {X}", where the controller chooses
 *  the value AS THE ABILITY RESOLVES.
 *
 *  `max` is the choice's live ceiling (for a paying nomination, what the
 *  chooser's pool can actually cover), computed by the parent from
 *  `numberChoiceRange` — the SAME authority the submit mutation re-validates
 *  against, so the stepper can never offer an amount the server refuses.
 *  Typed input is clamped into the range on the way out for the same reason.
 *
 *  A non-finite `max` is the OPEN-ENDED bare nomination (CR 107.1b "choose a
 *  number", issue #1421): there is no ceiling to clamp to and none to render,
 *  so the field becomes FREE ENTRY — no `max` attribute, an increment button
 *  that never runs out, and a hint that names only the floor. Clamping to some
 *  invented cap would be the client refusing an answer the server accepts,
 *  which is the exact drift `numberChoiceRange` exists to prevent.
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
    const bounded = Number.isFinite(max);
    const clamp = (next: number) =>
        bounded ? Math.min(Math.max(next, min), max) : Math.max(next, min);
    const [nominated, setNominated] = useState(min);
    // The displayed amount is CLAMPED AT RENDER, not stored clamped. The
    // ceiling moves while the prompt is open — the payer may go on tapping
    // lands (CR 608.2g), and each tap re-projects a bigger pool — so deriving
    // the shown value from the live bounds is what lets the stepper grow with
    // the pool, and pulls a stale value back down if mana drains out from under
    // it. (An effect that re-clamped stored state did the same thing with a
    // cascading render, which `react-hooks/set-state-in-effect` rightly
    // refuses.)
    const amount = clamp(nominated);
    const setAmount = (next: number) => setNominated(clamp(next));
    const submit = () => {
        if (disabled) return;
        onSubmit(amount);
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
                    max={bounded ? max : undefined}
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
                    disabled={disabled || (bounded && amount >= max)}
                    onClick={() => setAmount(clamp(amount + 1))}
                >
                    +
                </Button>
            </div>
            <p className="text-text-disabled text-xs">
                {bounded ? `${min} – ${max} available` : `${min} or more`}
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
