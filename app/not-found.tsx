"use client";

import HttpError from "@/components/ui/HttpError";

export default function NotFound() {
  return <HttpError code="404" />;
}
