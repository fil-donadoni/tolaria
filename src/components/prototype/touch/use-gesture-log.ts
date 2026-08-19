// PROTOTYPE — throwaway. Ring buffer of engine decisions for TouchEventLog.
import { useCallback, useState } from "react";

export function useGestureLog(cap = 8) {
    const [lines, setLines] = useState<string[]>([]);
    const log = useCallback(
        (line: string) => {
            const t = new Date();
            const ts = `${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
            setLines((prev) => [...prev, `${ts} ${line}`].slice(-cap));
        },
        [cap]
    );
    return { lines, log };
}
