// PROTOTYPE — throwaway. Orientation, live.
import { useEffect, useState } from "react";

export function useLandscape(): boolean {
    const [l, setL] = useState(
        () =>
            typeof window !== "undefined" &&
            window.matchMedia("(orientation: landscape)").matches
    );
    useEffect(() => {
        const mq = window.matchMedia("(orientation: landscape)");
        const on = () => setL(mq.matches);
        mq.addEventListener("change", on);
        return () => mq.removeEventListener("change", on);
    }, []);
    return l;
}
