import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        {
            name: 'inject-build-info',
            transformIndexHtml(html) {
                return html
                    .replace('%APP_NAME%', pkg.name)
                    .replace('%APP_VERSION%', pkg.version)
                    .replace('%BUILD_TIME%', new Date().toISOString());
            },
        },
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        open: true,
    },
    build: {
        outDir: 'build',
        sourcemap: true,
        minify: 'terser',
        terserOptions: {
            compress: {
                pure_funcs: ['_dc'],
            },
        },
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('pdfjs-dist'))
                            return 'pdfjs';
                        if (id.includes('@mui'))
                            return 'mui';
                        return 'vendor';
                    }
                }
            }
        }
    },
    optimizeDeps: {
        include: [
            'react',
            'react-dom',
            'react-router-dom',
            '@mui/material',
            '@mui/icons-material'
        ],
    },
});
