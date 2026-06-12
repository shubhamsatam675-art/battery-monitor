/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      colors: {
        base: "#0b0f14",
        panel: "#131922",
        panel2: "#1a212c",
        line: "#28313d",
        ink: "#e6edf3",
        muted: "#8b97a6",
        nominal: "#34d399",
        low: "#fbbf24",
        critical: "#f87171",
        electric: "#38bdf8",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
