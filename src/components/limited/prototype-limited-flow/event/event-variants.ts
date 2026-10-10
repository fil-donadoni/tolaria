// PROTOTYPE — throwaway. The /limited/{id} event-page variants.
import type { ProtoVariant } from "../limited-flow-prototype";
import VariantABento from "./variant-a-bento";
import VariantBCentrepiece from "./variant-b-centrepiece";
import VariantCRail from "./variant-c-rail";

export const EVENT_VARIANTS: ProtoVariant[] = [
    {
        key: "A",
        name: "Bento — table tile right of hero",
        Component: VariantABento,
    },
    {
        key: "B",
        name: "Centrepiece — hero on the table's felt",
        Component: VariantBCentrepiece,
    },
    {
        key: "C",
        name: "Rail — stepper + action left, table right",
        Component: VariantCRail,
    },
];
