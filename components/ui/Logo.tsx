"use client";
import { useState } from "react";

// Your monogram: save the image you sent as public/logo.png — PNG wins, SVG fallback.
export default function Logo({ size = 28 }: { size?: number }) {
  const [src, setSrc] = useState("/logo.png");
  return (
    <img
      src={src}
      alt="Eiden-Drive logo"
      width={size}
      height={size}
      className="rounded-lg"
      onError={() => { if (src !== "/logo.svg") setSrc("/logo.svg"); }}
    />
  );
}
