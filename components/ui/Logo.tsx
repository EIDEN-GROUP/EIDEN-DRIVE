"use client";
import { useState } from "react";

// PNG first, SVG fallback if the PNG 404s.
export default function Logo({ size = 28 }: { size?: number }) {
  const [src, setSrc] = useState("/logo.png");
  return (
    <img
      src={src}
      alt="Eiden logo"
      width={size}
      height={size}
      className="rounded-[22%]"
      onError={() => { if (src !== "/logo.svg") setSrc("/logo.svg"); }}
    />
  );
}
