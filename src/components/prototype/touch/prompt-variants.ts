// PROTOTYPE — throwaway. Chamfer prompt A/B variant list.
export type PromptVariant = "A" | "B";
export const PROMPT_VARIANTS: { key: PromptVariant; name: string }[] = [
    { key: "A", name: "Chamfer plate" },
    { key: "B", name: "Rounded panel (today)" },
];
