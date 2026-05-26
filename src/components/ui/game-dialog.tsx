import * as React from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Panel, SunburstIcon } from "@/components/ui/panel";

type GameDialogSize = "default" | "wide";

type GameDialogProps = {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    size?: GameDialogSize;
    dismissable?: boolean;
    showCloseButton?: boolean;
    className?: string;
    children: React.ReactNode;
};

const sizeClasses: Record<GameDialogSize, string> = {
    default: "max-w-md w-[calc(100vw-2rem)]",
    wide: "max-w-[90vw] w-[calc(100vw-2rem)]",
};

export default function GameDialog({
    open,
    onOpenChange,
    title,
    subtitle,
    icon,
    size = "default",
    dismissable = true,
    showCloseButton = false,
    className,
    children,
}: GameDialogProps) {
    const handleOpenChange = (next: boolean) => {
        if (!next && !dismissable) return;
        onOpenChange?.(next);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={false}
                className={cn(
                    "border-none bg-transparent shadow-none p-0 overflow-visible flex justify-center items-center",
                    sizeClasses[size],
                    className
                )}
            >
                <Panel tone="neutral">
                    <div
                        className={cn(
                            "flex gap-4 sm:gap-6",
                            icon
                                ? "flex-col sm:flex-row items-center"
                                : "flex-col"
                        )}
                    >
                        {icon && <SunburstIcon>{icon}</SunburstIcon>}

                        <div className="flex-1 flex flex-col w-full min-w-0">
                            <DialogTitle className="heading-panel">
                                {title}
                            </DialogTitle>

                            {subtitle && (
                                <p className="text-text-muted text-sm text-center mt-1">
                                    {subtitle}
                                </p>
                            )}

                            <div className="divider-gradient my-2" />

                            <DialogDescription className="sr-only">
                                {subtitle ?? title}
                            </DialogDescription>

                            {children}
                        </div>
                    </div>

                    {showCloseButton && (
                        <button
                            type="button"
                            onClick={() => onOpenChange?.(false)}
                            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-text-disabled hover:text-text-muted transition-colors cursor-pointer"
                        >
                            ✕
                        </button>
                    )}
                </Panel>
            </DialogContent>
        </Dialog>
    );
}

export { SunburstIcon };
