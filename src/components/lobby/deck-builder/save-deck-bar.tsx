import { Button } from "~/components/ui/button";

interface SaveDeckBarProps {
    name: string;
    onChangeName: (name: string) => void;
    onDone: () => void;
    onDelete?: () => void;
    cardCount: number;
}

export default function SaveDeckBar({
    name,
    onChangeName,
    onDone,
    onDelete,
    cardCount,
}: SaveDeckBarProps) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onDone();
            }}
            className="flex flex-wrap items-center gap-2 border-t border-border-subtle/30 bg-surface/60 px-4 py-3 short-viewport:py-1 md:gap-3 md:px-6"
        >
            <span className="text-label">{cardCount} cards</span>
            <input
                type="text"
                value={name}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="Deck name"
                className="input-field min-w-0 flex-1 basis-40 px-3 md:max-w-md"
            />
            <span className="text-label text-accent/70 hidden md:inline">
                Auto-saved
            </span>
            <div className="flex items-center gap-2 ml-auto">
                {onDelete && (
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={onDelete}
                        className="md:px-4 md:py-2 md:text-sm"
                    >
                        Delete
                    </Button>
                )}
                <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="md:px-4 md:py-2 md:text-sm"
                >
                    Done
                </Button>
            </div>
        </form>
    );
}
