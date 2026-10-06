"use client";

import HttpError from "@/components/ui/HttpError";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <HttpError code="500" detail={error.digest ? `ref ${error.digest}` : undefined} onRetry={reset} />;
}
