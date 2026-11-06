import type { OriginGroup } from "~/lib/matchSetupDeckGrid";
import LimitedDeckArchiveEntry from "./limited-deck-archive-entry";

/** One Limited Origin of the Limited Deck Archive (issue #8409). */
export default function LimitedDeckArchiveGroup({
    group,
}: {
    group: OriginGroup;
}) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="flex items-baseline gap-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
                {group.label}
                <span className="font-normal text-text-disabled">
                    {group.entries.length}
                </span>
            </h2>
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {group.entries.map((entry) => (
                    <LimitedDeckArchiveEntry
                        key={entry.deck.presetId}
                        deck={entry.deck}
                    />
                ))}
            </ul>
        </section>
    );
}
