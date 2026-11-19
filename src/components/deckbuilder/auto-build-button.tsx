import { Button } from "~/components/ui/button";

export interface AutoBuildButtonProps {
    onAutoBuild: () => void;
    pending: boolean;
    /** Why the last press produced nothing, when it did not. */
    error: string | null;
    className?: string;
}

/**
 * The Limited builder's Auto-Build affordance (issue #9976): fills the Maindeck
 * and basics from the builder the Bot seats use; the result is a starting
 * point the player keeps editing. Disabled while the request is in flight
 * (one press, one build).
 */
export default function AutoBuildButton({
    onAutoBuild,
    pending,
    error,
    className,
}: AutoBuildButtonProps) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className={className}
            disabled={pending}
            title={error ?? undefined}
            onClick={onAutoBuild}
        >
            {pending ? "Building…" : error ? "Auto-Build ⚠" : "Auto-Build"}
        </Button>
    );
}
