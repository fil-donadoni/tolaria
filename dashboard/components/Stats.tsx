import type { ReactNode } from "react";

/** A row of stat boxes — the one layout every section's figures use. */
export function Stats({ children }: { children: ReactNode }) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {children}
        </div>
    );
}
