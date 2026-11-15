// PROTOTYPE — throwaway. Three Sideboarding variants on the real dialog,
// switchable via `?variant=` (0 = current dialog) and the floating bar.
import { useMemo } from "react";
import type { SideboardSplit } from "~/lib/deckSideboard";
import { buildPool, sumBy } from "./proto-model";
import type { ProtoVariantProps } from "./proto-types";
import type { ProtoVariantKey } from "./proto-variants";
import VariantASpread from "./variant-a-spread";
import VariantBBench from "./variant-b-bench";
import VariantCLedger from "./variant-c-ledger";

export default function SideboardingPrototype({
    variant,
    start,
    ...rest
}: Omit<
    ProtoVariantProps,
    "pool" | "mainCount" | "sideCount" | "sizeOk" | "reset"
> & {
    variant: Exclude<ProtoVariantKey, "0">;
    start: SideboardSplit;
}) {
    const pool = useMemo(
        () => buildPool(start, rest.split),
        [start, rest.split]
    );
    const mainCount = sumBy(pool, "main");
    const props: ProtoVariantProps = {
        ...rest,
        pool,
        mainCount,
        sideCount: sumBy(pool, "side"),
        sizeOk: mainCount >= rest.lockedSize,
        reset: () =>
            rest.setSplit(() => ({
                cards: [...start.cards],
                sideboard: [...start.sideboard],
            })),
    };
    if (variant === "A") return <VariantASpread {...props} />;
    if (variant === "B") return <VariantBBench {...props} />;
    return <VariantCLedger {...props} />;
}
