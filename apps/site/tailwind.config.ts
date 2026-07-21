import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The site is a light world: `white` rides --c41-white (ink), so the
        // text-white/NN utilities written for the dark identity read as ink/NN.
        // For literal white, use #fff / bg-[#ffffff].
        white: "rgb(var(--c41-white) / <alpha-value>)",
        mission: {
          navy: "rgb(var(--mission-navy) / <alpha-value>)",
          deep: "rgb(var(--mission-deep) / <alpha-value>)",
          panel: "rgb(var(--mission-panel) / <alpha-value>)",
          green: "rgb(var(--mission-green) / <alpha-value>)",
          gold: "rgb(var(--mission-gold) / <alpha-value>)",
          line: "rgb(var(--mission-line) / <alpha-value>)",
          crimson: "rgb(var(--mission-crimson) / <alpha-value>)",
          platinum: "rgb(var(--mission-platinum) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      maxWidth: {
        shell: "1180px",
      },
    },
  },
  plugins: [],
};

export default config;
