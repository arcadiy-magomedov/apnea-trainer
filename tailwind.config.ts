import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ocean: { 900: 'var(--ocean-900)', 700: 'var(--ocean-700)' },
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        cyan: { DEFAULT: 'var(--cyan)', deep: 'var(--cyan-deep)' },
        teal: 'var(--teal)',
        success: 'var(--success)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
    },
  },
  plugins: [],
} satisfies Config;
