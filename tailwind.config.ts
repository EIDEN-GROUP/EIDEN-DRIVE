import type { Config } from "tailwindcss";

// Design tokens live in app/globals.css as CSS variables (light + dark).
// Legacy names (teal / cream / gold / eiden) are re-pointed at the new violet system
// so any leftover class keeps working while pages are migrated.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        soft: "var(--soft)",
        tint: "var(--tint)",
        head: "var(--head)",
        line: "var(--line)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        brand: { DEFAULT: "var(--brand)", deep: "var(--brand-deep)", icon: "var(--icon)" },
        danger: "var(--danger)",
        teal: { 700: "var(--brand-deep)", 600: "var(--brand)", 500: "var(--brand)", 300: "var(--tint)" },
        cream: { 200: "var(--tint)", 50: "#ffffff" },
        gold: { 600: "var(--muted)", 500: "var(--line)", 300: "var(--line)" },
        success: "#22c32e",
        warning: "#f59e0b",
        error: "#e5322d"
      },
      fontFamily: {
        body: ["var(--font-poppins)", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "system-ui", "sans-serif"],
        brand: ["var(--font-fredoka)", "var(--font-poppins)", "sans-serif"],
        material: ["var(--font-roboto)", "system-ui", "sans-serif"]
      },
      borderRadius: { "2xl": "1rem", full: "9999px" },
      boxShadow: {
        pop: "0 12px 32px -8px rgba(30,20,80,.22), 0 2px 8px rgba(30,20,80,.08)",
        win: "0 30px 80px -30px rgba(30,20,80,.25)"
      }
    }
  },
  plugins: []
};
export default config;
