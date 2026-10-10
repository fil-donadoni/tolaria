// PROTOTYPE — throwaway.
import type { ProtoVariant } from "../limited-flow-prototype";
import VariantARail from "./variant-a-rail";
import VariantBHero from "./variant-b-hero";
import VariantCSummary from "./variant-c-summary";

export const SETUP_VARIANTS: ProtoVariant[] = [
    { key: "a", name: "A · Rail + art tiles", Component: VariantARail },
    { key: "b", name: "B · Rail + hero showcase", Component: VariantBHero },
    { key: "c", name: "C · Summary + inline edit", Component: VariantCSummary },
];
