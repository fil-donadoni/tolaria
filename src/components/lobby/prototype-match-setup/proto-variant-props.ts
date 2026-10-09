// PROTOTYPE — throwaway. Props every layout variant receives.
import type { ProtoStepProps } from "./proto-step-body";
import type { StepInfo } from "./match-setup-logic";

export interface ProtoVariantProps extends ProtoStepProps {
    steps: StepInfo[];
    ready: boolean;
    onStart: () => void;
}
