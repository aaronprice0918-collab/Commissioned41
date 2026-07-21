import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // `white` rides a CSS variable so a LIGHT theme (Sky Command) can flip
        // every hardcoded white utility — text-white/60, border-white/10,
        // bg-white/5, from-white/… — to ink at the SAME opacity in one move.
        // Dark themes keep the 255 255 255 fallback; nothing changes for them.
        white: "rgb(var(--c41-white, 255 255 255) / <alpha-value>)",
        mission: {
          navy: "rgb(var(--mission-navy) / <alpha-value>)",
          deep: "rgb(var(--mission-deep) / <alpha-value>)",
          panel: "rgb(var(--mission-panel) / <alpha-value>)",
          gold: "rgb(var(--mission-gold) / <alpha-value>)",
          green: "rgb(var(--mission-green) / <alpha-value>)",
          red: "rgb(var(--mission-red) / <alpha-value>)",
          amber: "rgb(var(--mission-amber) / <alpha-value>)",
          line: "rgb(var(--mission-line) / <alpha-value>)",
        },
      },
      boxShadow: {
        glass: "0 10px 30px rgba(0, 0, 0, 0.22)",
        gold: "0 4px 12px rgba(0, 0, 0, 0.35)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
