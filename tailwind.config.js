/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./App.tsx",
        "./index.tsx",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                "primary": "#e65000",
                "primary-dark": "#c24100",
                "background-light": "#f8f6f5",
                "background-dark": "#23160f",
                "surface-light": "#ffffff",
                "surface-dark": "#2d1e17",
            },
            fontFamily: {
                "display": ["Plus Jakarta Sans", "sans-serif"],
                "sans": ["Plus Jakarta Sans", "sans-serif"]
            },
            borderRadius: {
                "DEFAULT": "1rem",
                "lg": "1.5rem",
                "xl": "2rem",
                "2xl": "2.5rem"
            },
            boxShadow: {
                "glow": "0 0 20px rgba(230, 80, 0, 0.3)",
                "inner-glow": "inset 0 2px 4px 0 rgba(255, 255, 255, 0.3)"
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }
        },
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries'),
    ],
}
