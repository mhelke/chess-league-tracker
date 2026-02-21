import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Vite plugin that routes data file requests to the correct site-specific
 * directory under public/data/<siteKey>/.
 *
 * - Dev server:  rewrites  /data/<file>  →  /data/<siteKey>/<file>
 * - Production:  copies    dist/data/<siteKey>/*  →  dist/data/*
 *                and removes all site sub-directories from dist/data/
 */
function siteDataPlugin(siteKey) {
    return {
        name: 'site-data',

        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                // Rewrite top-level /data/<file> requests to /data/<siteKey>/<file>
                if (req.url && req.url.startsWith('/data/')) {
                    const file = req.url.substring(6) // strip leading "/data/"
                    if (file && !file.includes('/')) {
                        req.url = `/data/${siteKey}/${file}`
                    }
                }
                next()
            })
        },

        closeBundle() {
            const distDir = path.resolve('dist')
            const dataDir = path.join(distDir, 'data')
            const siteDataDir = path.join(dataDir, siteKey)

            if (!fs.existsSync(siteDataDir)) return

            // Copy site-specific files up to dist/data/ root
            for (const file of fs.readdirSync(siteDataDir)) {
                const src = path.join(siteDataDir, file)
                if (fs.statSync(src).isFile()) {
                    fs.copyFileSync(src, path.join(dataDir, file))
                }
            }

            // Remove ALL sub-directories from dist/data/ (1dpmc/, teamusa/, etc.)
            for (const entry of fs.readdirSync(dataDir)) {
                const full = path.join(dataDir, entry)
                if (fs.statSync(full).isDirectory()) {
                    fs.rmSync(full, { recursive: true })
                }
            }
        },
    }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Resolve site key: SITE_KEY env var > Vite mode (when not a standard mode) > default
    const siteKey =
        process.env.SITE_KEY ||
        (mode !== 'development' && mode !== 'production' ? mode : '1dpmc')

    console.log(`\n  Site key: ${siteKey}\n`)

    return {
        plugins: [react(), siteDataPlugin(siteKey)],
        base: '/',
        build: {
            outDir: 'dist',
            assetsDir: 'assets',
        },
        define: {
            // Available in frontend as __SITE_KEY__ (string literal)
            __SITE_KEY__: JSON.stringify(siteKey),
        },
    }
})
