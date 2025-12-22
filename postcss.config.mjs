// Tailwind CSS v4 uses @tailwindcss/vite plugin instead of PostCSS
// This config only includes autoprefixer for other CSS processing
const config = {
  plugins: {
    autoprefixer: {},
  },
};

export default config;
