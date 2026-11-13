// PROTOTYPE (issue #9500, attack-target sequence legibility) — throwaway,
// branch prototype/attack-sequence-9500. The active variant, read from the URL
// by every touched site (banner dock, click router, board overlay).
//   /game/<id>?atkProto=1&variant=<A|B|C|D>
import { useSyncExternalStore } from "react";

const EVENT = "atkproto:change";

export const ATK_PROTO_VARIANTS = [
    { key: "A", name: "Named banner, fixed order" },
    { key: "B", name: "Order badges + free pick" },
    { key: "C", name: "Attacker queue strip" },
    { key: "D", name: "Inline chooser on the creature" },
] as const;

export function readAtkProtoVariant(): string | null {
    if (!import.meta.env.DEV) return null;
    const q = new URLSearchParams(window.location.search);
    return q.has("atkProto") ? (q.get("variant") ?? "A") : null;
}

export function writeAtkProtoVariant(variant: string) {
    const q = new URLSearchParams(window.location.search);
    q.set("atkProto", "1");
    q.set("variant", variant);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
    window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
}

export function useAtkProtoVariant(): string | null {
    return useSyncExternalStore(subscribe, readAtkProtoVariant, () => null);
}

/** Variants where clicking another declared attacker mid-sequence makes it
 *  the one choosing (no forced left-to-right walk). */
export function atkProtoFreePick(): boolean {
    const v = readAtkProtoVariant();
    return v === "B" || v === "C" || v === "D";
}
