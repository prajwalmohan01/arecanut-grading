/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#f1f7f2',
          100: '#dfeede',
          200: '#c0ddc3',
          300: '#93c49f',
          400: '#61a675',
          500: '#3f8958',
          600: '#2f6e46',
          700: '#28583a',
          800: '#224731',
          900: '#1c3b2a',
          950: '#0b1f16',
        },
        emerald: {
          400: '#4fb985',
          500: '#2f9d6d',
          600: '#23805a',
        },
        mint: {
          50: '#f2faf6',
          100: '#e3f4eb',
          200: '#c8e8d7',
          300: '#9fd7ba',
        },
        gold: {
          300: '#e6cf9a',
          400: '#d8b46a',
          500: '#b08c42',
          600: '#8f6f2f',
        },
        charcoal: '#17251d',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 28px 70px -32px rgba(18, 56, 36, 0.48)',
        'glass-soft': '0 14px 36px -24px rgba(18, 56, 36, 0.38)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease both',
        float: 'float 7s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};
