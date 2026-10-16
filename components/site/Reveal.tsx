"use client";
import { useEffect, useRef } from "react";

// Scroll-triggered reveal: elements render visible in SSR/no-JS, then animate
// in once when they enter the viewport. Respects prefers-reduced-motion.
export default function Reveal({ children, variant = "up", delay = 0, className = "" }: {
  children: React.ReactNode;
  variant?: "up" | "fade" | "scale";
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      el.classList.add("is-visible");
      return;
    }
    el.classList.add("reveal", `reveal-${variant}`);
    if (delay > 0) el.style.transitionDelay = `${delay}ms`;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [variant, delay]);

  return <div ref={ref} className={className}>{children}</div>;
}
