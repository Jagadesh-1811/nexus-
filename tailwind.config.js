/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,js,ts}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#faf9f5',
        primary: '#cc785c',
        'primary-active': '#a9583e',
        ink: '#141413',
        muted: '#6c6a64',
        'surface-card': '#efe9de',
        'hairline': '#e6dfd8',
      },
      fontFamily: {
        heading: ['var(--font-heading)'],
        body: ['var(--font-body)'],
      },
    },
  },
  plugins: [],
}
