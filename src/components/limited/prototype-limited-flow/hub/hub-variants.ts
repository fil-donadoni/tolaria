// PROTOTYPE — throwaway.
import type { ProtoVariant } from "../limited-flow-prototype";
import HubBento from "./hub-a-bento";
import HubCarousel from "./hub-b-carousel";
import HubLanes from "./hub-c-lanes";

export const HUB_VARIANTS: ProtoVariant[] = [
    { key: "a", name: "A · Bento", Component: HubBento },
    { key: "b", name: "B · Now playing", Component: HubCarousel },
    { key: "c", name: "C · Phase lanes", Component: HubLanes },
];
