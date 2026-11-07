/** Seat-coloured chip naming who controls an object (signal-self for the
 *  viewer, signal-opponent otherwise). Shared by the stack row and the Random
 *  Reveal source row. */
export default function ControllerChip({
    name,
    mine,
}: {
    name: string;
    mine: boolean;
}) {
    return (
        <span
            className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                mine
                    ? "bg-signal-self/15 text-signal-self-strong"
                    : "bg-signal-opponent/15 text-signal-opponent-strong"
            }`}
        >
            <span
                className={`h-1.5 w-1.5 rounded-full ${
                    mine ? "bg-signal-self" : "bg-signal-opponent"
                }`}
            />
            {name}
        </span>
    );
}
