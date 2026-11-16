import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Bibliothèques isolées dans leurs propres fichiers : mieux mises en cache entre deux déploiements. */
const VENDORS: [string, RegExp][] = [
  ['react', /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/],
  ['supabase', /[\\/]node_modules[\\/]@supabase[\\/]/],
  ['dnd-kit', /[\\/]node_modules[\\/]@dnd-kit[\\/]/],
  ['icons', /[\\/]node_modules[\\/]lucide-react[\\/]/],
];

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return VENDORS.find(([, re]) => re.test(id))?.[0];
        },
      },
    },
  },
});
