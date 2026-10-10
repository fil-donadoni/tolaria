// PROTOTYPE — throwaway. Builder surface variants (structural difference is
// on mobile): A split rows scrolling sideways · B phone tabs, landscape
// side-by-side · C true MTGO combined grid with a creature divider.
import type { ProtoVariant } from "../limited-flow-prototype";
import VariantDChosenMix from "./variant-d-chosen-mix";
import VariantASplitRows from "./variant-a-split-rows";
import VariantBTabs from "./variant-b-tabs";
import VariantCMtgoGrid from "./variant-c-mtgo-grid";

export const BUILDER_VARIANTS: ProtoVariant[] = [
    {
        key: "d",
        name: "Chosen mix + split toggle",
        Component: VariantDChosenMix,
    },
    {
        key: "a",
        name: "Split rows, swipe each row",
        Component: VariantASplitRows,
    },
    {
        key: "b",
        name: "Phone tabs, landscape side-by-side",
        Component: VariantBTabs,
    },
    { key: "c", name: "MTGO grid with divider", Component: VariantCMtgoGrid },
];
