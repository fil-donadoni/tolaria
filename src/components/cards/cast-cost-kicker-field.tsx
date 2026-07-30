import NumberStepper from "~/components/ui/number-stepper";

type CastCostKickerFieldProps = {
    /** `KickerCost.id` — keys this Kicker's entry in the payment record. */
    kickerId: string;
    /** `KickerCost.description` — the cost text, rendered verbatim so a NON-MANA
     *  Kicker leg ("Kicker — Sacrifice two lands") is legible BEFORE the caster
     *  commits (CR 702.33a, ADR 0079). */
    description: string;
    /** CR 702.33e — Multikicker: render a numeric "times to pay" stepper instead
     *  of a yes/no toggle, because THIS Kicker may be paid any number of times. */
    multi: boolean;
    /** Times this Kicker is currently set to be paid, as raw stepper text for the
     *  multi variant (so a half-typed value round-trips) and 0/1 for the toggle. */
    value: string;
    onChange: (next: string) => void;
    autoFocus?: boolean;
};

/** One row of the cast-cost dialog's Kicker section: a single independently
 *  payable Kicker (CR 702.33). A card with "Kicker {A} and/or {B}" renders TWO of
 *  these, each toggled on its own, because the two are paid independently and
 *  each drives its own intervening-if trigger (ADR 0079). */
export default function CastCostKickerField({
    kickerId,
    description,
    multi,
    value,
    onChange,
    autoFocus,
}: CastCostKickerFieldProps) {
    const fieldId = `cast-cost-kicker-${kickerId}`;
    if (multi) {
        return (
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor={fieldId}
                    className="text-sm font-medium text-text"
                >
                    Times to pay {description}
                </label>
                <NumberStepper
                    id={fieldId}
                    aria-label={`Times to pay ${description}`}
                    value={value}
                    onChange={onChange}
                    autoFocus={autoFocus}
                />
            </div>
        );
    }
    return (
        <label className="flex items-center gap-2.5">
            <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={value !== "0"}
                onChange={(e) => onChange(e.target.checked ? "1" : "0")}
            />
            <span className="text-sm font-medium text-text">
                Pay {description}
            </span>
        </label>
    );
}
