import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import { convexErrorData } from "~/lib/mutation-error";

interface DeckSaveErrorProps {
    error: unknown;
    onLeave: () => void;
}

/**
 * A failed deck save. The edit stays pending, so Done writes it again; a save
 * the server keeps refusing would otherwise trap the player on this screen, so
 * leaving without it is offered explicitly.
 */
export default function DeckSaveError({ error, onLeave }: DeckSaveErrorProps) {
    return (
        <Banner tone="danger" role="alert" className="shrink-0">
            <span className="flex flex-wrap items-center gap-2">
                <span>
                    Your latest changes are not saved.{" "}
                    {convexErrorData(error) ??
                        "The server could not save them."}{" "}
                    Press Done to try again.
                </span>
                <Button type="button" variant="secondary" onClick={onLeave}>
                    Leave without saving
                </Button>
            </span>
        </Banner>
    );
}
