import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f0f0f",
        sand: "#f7f7f5",
        ember: "#111111",
        dune: "#6b6b6b",
        panel: "#ffffff",
        border: "#e5e7eb",
      },
      fontFamily: {
        display: ["var(--font-display)", "'Noto Sans SC'", "sans-serif"],
        sans: ["var(--font-body)", "'Noto Sans SC'", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
