// PROTOTYPE — throwaway. The table's settings, read-only.
import { EVENT_META } from "./event-mock";
import TileFrame from "./tile-frame";

export default function SettingsTile({
    openDecklists,
    className,
}: {
    openDecklists: boolean;
    className?: string;
}) {
    const rows: [string, string][] = [
        ["Pack Source", EVENT_META.source],
        ["Boosters", EVENT_META.packs],
        ["Games", EVENT_META.gamesFormat],
        ["Pick timer", "60 seconds"],
        ["Rounds", `${EVENT_META.rounds} Swiss · 50 min`],
        ["Open Decklists", openDecklists ? "On" : "Off"],
    ];
    return (
        <TileFrame title="Table settings" className={className}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                        <dt className="text-text-muted">{k}</dt>
                        <dd className="truncate text-right text-parchment">
                            {v}
                        </dd>
                    </div>
                ))}
            </dl>
        </TileFrame>
    );
}
