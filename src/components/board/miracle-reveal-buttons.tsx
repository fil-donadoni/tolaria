import { Button } from "~/components/ui/button";

/** The two answers of a `miracle-reveal` pending choice (CR 702.94a — "You may
 *  reveal this card from your hand as you draw it"): Reveal, which shows the
 *  card to every player and puts its miracle trigger on the stack, or Don't
 *  reveal, which keeps it an ordinary hidden card. Stateless w.r.t. the game —
 *  the parent owns the `submitMiracleReveal` mutation and the in-flight
 *  `disabled` gate. */
export default function MiracleRevealButtons({
    disabled,
    onAnswer,
}: {
    disabled: boolean;
    onAnswer: (reveal: boolean) => void;
}) {
    return (
        <div className="flex gap-2 mt-1">
            <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={disabled}
                onClick={() => onAnswer(true)}
            >
                Reveal
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onAnswer(false)}
            >
                Don't reveal
            </Button>
        </div>
    );
}
