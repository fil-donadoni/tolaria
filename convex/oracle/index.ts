/** Oracle compiler — pure module. No Convex, no `node:fs`, no network. */
export * from "./types";
export * from "./compile";
export * from "./normalize";
export * from "./manaCost";
export * from "./typeLine";
export * from "./gates";
export * from "./lower";
export * from "./version";
export { explainLine, routeLine, SLOTS } from "./grammar/router";
export type {
    KeywordIR,
    LineParse,
    ManaProductionIR,
    SlotIR,
} from "./grammar/ir";
