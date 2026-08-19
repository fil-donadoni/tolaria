// PROTOTYPE — throwaway. Surfaces the engine's decisions (why a gesture
// resolved as scroll / drag / tap / preview) so a touch test is legible.
export default function TouchEventLog({ lines }: { lines: string[] }) {
    return (
        <div className="pointer-events-none fixed top-1 right-1 z-[9998] max-w-[46vw] rounded bg-black/70 px-2 py-1 font-mono text-[10px] leading-tight text-signal-pending-strong">
            {lines.length === 0 ? <div>gesture log</div> : null}
            {lines.map((l, i) => (
                <div
                    key={i}
                    className={
                        i === lines.length - 1 ? "text-parchment" : "opacity-70"
                    }
                >
                    {l}
                </div>
            ))}
        </div>
    );
}
