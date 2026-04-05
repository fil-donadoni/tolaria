import { createContext, useContext } from "react";

type CastErrorContext = {
    showError: (message: string) => void;
};

export const CastErrorContext = createContext<CastErrorContext | null>(null);

export function useCastError(): CastErrorContext {
    const ctx = useContext(CastErrorContext);
    if (!ctx)
        throw new Error(
            "useCastError must be used within CastErrorContext.Provider"
        );
    return ctx;
}
