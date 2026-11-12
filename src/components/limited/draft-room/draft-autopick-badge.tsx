/** "AUTO-PICK IN Ns" badge, centred on the tile it is mounted in (issue
 *  #9165). `pointer-events-none`: never steals the tile's gestures. */
export default function DraftAutopickBadge({ seconds }: { seconds: number }) {
    return (
        <div
            data-testid="autopick-badge"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
            <span className="rounded-full bg-signal-pending px-2.5 py-1 text-xs font-extrabold tracking-wide whitespace-nowrap text-black shadow-lg">
                {seconds > 0 ? `AUTO-PICK IN ${seconds}s` : "AUTO-PICKING…"}
            </span>
        </div>
    );
}
