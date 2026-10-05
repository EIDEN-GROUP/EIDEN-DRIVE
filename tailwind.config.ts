import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // EIDEN brand (from presentation HTMLs — verified eiden-group.com)
        eiden: {
          950: "#0E1B17",
          900: "#122620",
          800: "#16302F"
        },
        teal: { 700: "#1C5C58", 600: "#0C5752", 500: "#0E7A73", 300: "#6FA9A4" },
        gold: { 600: "#B7A97B", 500: "#CFC292", 300: "#DFD6AC" },
        cream: { 200: "#F4EBD0", 50: "#FEFFF8" },
        // Design.md functional tokens
        primary: {
          50: "#f1f6fe", 100: "#e2edfd", 200: "#bcd5fb", 300: "#86b6fe",
          400: "#3d8bff", 500: "#0d6efd", 600: "#0256d4", 700: "#0146ac",
          800: "#013584", 900: "#082a5e", 950: "#051c3d"
        },
        success: "#198754",
        warning: "#ffc107",
        error: "#dc3545"
      },
      fontFamily: {
        body: ["Inter", "system-ui", "sans-serif"],
        display: ["Anton", "Impact", "sans-serif"],
        serif: ["Besley", "Georgia", "serif"]
      },
      borderRadius: { "2xl": "1rem", full: "9999px" }
    }
  },
  plugins: []
};
export default config;
