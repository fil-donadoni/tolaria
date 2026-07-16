// PROTOTYPE route (/prototype/put-back) — Brainstorm "put back 2 on top" picker,
// 3 variants switchable via ?variant=. Throwaway (see NOTES.md); delete once a
// variant wins and fold it into the real PutBackPicker.
import PrototypeSwitcher, { type Variant } from "./switcher";
import VariantA from "./variant-a";
import VariantB from "./variant-b";
import VariantC from "./variant-c";

export default function PrototypePutBackRoute({
    variant,
}: {
    variant: Variant;
}) {
    return (
        <>
            {variant === "A" && <VariantA />}
            {variant === "B" && <VariantB />}
            {variant === "C" && <VariantC />}
            <PrototypeSwitcher current={variant} />
        </>
    );
}
