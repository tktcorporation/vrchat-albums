/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        glass: {
          DEFAULT: 'hsl(var(--glass-bg))',
          border: 'hsl(var(--glass-border))',
        },
        gradient: {
          start: 'hsl(var(--gradient-start))',
          middle: 'hsl(var(--gradient-middle))',
          end: 'hsl(var(--gradient-end))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: [
          '"Noto Sans CJK JP"',
          '"Noto Sans JP"',
          '"-apple-system"',
          '"blinkmacsystemfont"',
          '"Segoe UI"',
          '"Hiragino Kaku Gothic ProN"',
          '"BIZ UDPGothic"',
          '"meiryo"',
          '"sans-serif"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'glass-morph': {
          '0%': {
            opacity: '0',
            transform: 'translateY(20px) scale(0.95)',
            backdropFilter: 'blur(0px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)',
            backdropFilter: 'blur(20px)',
          },
        },
        'glass-hover': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-2px)' },
        },
        'glass-shine': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'gradient-x': {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center',
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'glass-morph': 'glass-morph 0.6s ease-out',
        'glass-hover': 'glass-hover 0.2s ease-out',
        'glass-shine': 'glass-shine 2s ease-in-out infinite',
        'gradient-x': 'gradient-x 3s ease infinite',
      },
      backdropBlur: {
        xs: '2px',
        '3xl': '64px',
      },
      boxShadow: {
        glass: '0 4px 16px rgba(31, 38, 135, 0.15)',
        'glass-inset': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        'glass-hover': '0 6px 24px rgba(31, 38, 135, 0.25)',
      },
    },
  },
  plugins: [],
};
