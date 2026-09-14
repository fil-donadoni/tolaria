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
 *  An OPEN-ENDED bare nomination (CR 107.1c "any number", issue #1421) arrives
 *  here already bounded: `numberChoiceRange` applies the engine cap, so `max`
 *  is always a real number and the stepper always renders a true range. The
 *  client never invents a bound of its own — that is the drift
 *  `numberChoiceRange` exists to prevent.
 *
 *  The value starts at `min`. For a PAYING nomination 0 is the decline
 *  (CR 107.3f: paying {X} with X = 0 and declining are game-observably
 *  identical), so declining is ONE action, the confirm button, with no second
 *  prompt to dismiss (Arena parity, issue #2244). For a BARE one it is not a
 *  decline at all: a mid-resolution choice cannot be refused (CR 608.2) and 0
 *  is a substantive answer — Void naming 0 destroys every mana-value-0
 *  artifact and creature. Hence the label consults `paysMana`.
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
    // CR 107.1 — the game uses only integers, and `applyNumberChoiceSubmit`
    // refuses a fractional amount outright. A typed "2.5" must therefore never
    // reach the mutation: truncating here is what keeps the field's own value
    // legal rather than round-tripping through a server error.
    const clamp = (next: number) =>
        Math.trunc(Math.min(Math.max(next, min), max));
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
                {paysMana
                    ? amount === 0
                        ? "Decline"
                        : `Pay ${amount}`
                    : `Choose ${amount}`}
            </Button>
        </div>
    );
}
