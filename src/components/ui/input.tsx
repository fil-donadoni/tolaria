import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
    return (
        <InputPrimitive
            type={type}
            data-slot="input"
            className={cn(
                "h-8 w-full min-w-0 rounded-sm border border-border-strong bg-surface-elevated/20 px-2.5 py-1 text-base text-text transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-text-disabled focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-disabled aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/40 md:text-sm",
                className
            )}
            {...props}
        />
    );
}

export { Input };
