import { useEffect, useRef } from "react";
import { Banner } from "~/components/ui/banner";

type CastErrorToastProps = {
    message: string | null;
    onDismiss: () => void;
};

export default function CastErrorToast({
    message,
    onDismiss,
}: CastErrorToastProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        if (message) {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(onDismiss, 2500);
            return () => clearTimeout(timerRef.current);
        }
    }, [message, onDismiss]);

    if (!message) return null;

    return (
        <div className="absolute left-1/2 bottom-48 -translate-x-1/2 z-modal pointer-events-none">
            <Banner tone="danger" role="alert">
                <p className="font-beleren text-sm tracking-wide px-2">
                    Tap {message}
                </p>
            </Banner>
        </div>
    );
}
