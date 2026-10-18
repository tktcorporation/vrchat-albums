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
        // Semantic status colors
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        // Surface hierarchy
        surface: {
          elevated: 'hsl(var(--surface-elevated))',
          sunken: 'hsl(var(--surface-sunken))',
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
        // 幅の 1/2 の光を、親の左外から右外まで通す（起動画面の進捗バーの塗られた部分）
        'progress-sheen': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(200%)' },
        },
        // 幅の 1/3 の帯を、親の左外から右外まで通す（進捗が止まっている間の残り部分）
        'progress-pending': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'gradient-x': 'gradient-x 3s ease infinite',
        'progress-sheen': 'progress-sheen 2.4s ease-in-out infinite',
        'progress-pending': 'progress-pending 1.8s ease-in-out infinite',
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
