import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f1c18",
        sand: "#f7f4ef",
        ember: "#c65d31",
        dune: "#6f655a",
        panel: "#fff8ef",
        border: "#e4d8c8",
      },
      fontFamily: {
        display: ["'IBM Plex Serif'", "'Noto Serif SC'", "serif"],
        sans: ["'IBM Plex Sans'", "'Noto Sans SC'", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
