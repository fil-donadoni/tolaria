import { Minus, Plus } from "lucide-react";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from "@/components/ui/input-group";

type NumberStepperProps = {
    /** Raw text value (kept as a string so the field can be cleared / invalid
     *  while typing; the parent parses + validates before acting on it). */
    value: string;
    onChange: (raw: string) => void;
    /** Lower bound — the field never steps below this and the decrement button
     *  disables at it. Defaults to 0. */
    min?: number;
    id?: string;
    "aria-label"?: string;
    autoFocus?: boolean;
};

/** A small integer stepper (−/input/+) built on the shared `InputGroup` atoms.
 *  Used by cost-choice dialogs (X mana cost, Multikicker count). Stateless: the
 *  raw string lives in the parent so it can validate before submitting. */
export default function NumberStepper({
    value,
    onChange,
    min = 0,
    id,
    "aria-label": ariaLabel,
    autoFocus,
}: NumberStepperProps) {
    const parsed = Number.parseInt(value, 10);
    const current = Number.isFinite(parsed) ? parsed : min;
    const canDecrement = Number.isFinite(parsed) && parsed > min;

    const step = (delta: number) => {
        onChange(String(Math.max(min, current + delta)));
    };

    return (
        <InputGroup>
            <InputGroupAddon>
                <InputGroupButton
                    aria-label="Decrease"
                    disabled={!canDecrement}
                    onClick={() => step(-1)}
                >
                    <Minus />
                </InputGroupButton>
            </InputGroupAddon>
            <InputGroupInput
                id={id}
                type="number"
                inputMode="numeric"
                min={min}
                step={1}
                value={value}
                aria-label={ariaLabel}
                autoFocus={autoFocus}
                onChange={(e) => onChange(e.target.value)}
                className="text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <InputGroupAddon align="inline-end">
                <InputGroupButton aria-label="Increase" onClick={() => step(1)}>
                    <Plus />
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    );
}
