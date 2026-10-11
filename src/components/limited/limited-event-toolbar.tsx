import { Button } from "@/components/ui/button";

/** The way back to the Limited hub, above the event header. The phase and the
 *  Games Format moved into the header's chips and the stepper (PRD #5383,
 *  issue #5389). */
export default function LimitedEventToolbar({
    onBack,
}: {
    onBack: () => void;
}) {
    return (
        <Button
            variant="link"
            size="sm"
            onClick={onBack}
            className="self-start px-0"
        >
            ← Back to Limited Events
        </Button>
    );
}
