/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'chess-dark': '#312e2b',
                'chess-light': '#eeeed2',
                'chess-green': '#769656',
            },
        },
    },
    plugins: [],
}
