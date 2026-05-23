import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, 'src');

export default defineConfig(({ mode }) => {
  const isUMD = mode === 'umd';

  return {
    plugins: [vue()],

    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },

    resolve: {
      alias: {
        '@': srcDir,
      },
    },

    build: {
      outDir: 'dist',
      emptyOutDir: !isUMD,
      cssCodeSplit: false,
      minify: 'esbuild',
      sourcemap: true,

      lib: {
        entry: resolve(srcDir, 'index.ts'),
        name: 'ElementPlusWrapper',
        formats: isUMD ? ['umd'] : ['es'],
        fileName: () => isUMD ? 'element-plus-wrapper.umd.js' : 'element-plus-wrapper.es.js',
      },

      rollupOptions: {
        external: ['vue', 'element-plus'],
        output: {
          exports: 'named',
          globals: {
            vue: 'Vue',
            'element-plus': 'ElementPlus',
          },
          assetFileNames: 'style.[ext]',
        },
      },
    },
  };
});
