import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const localPreview = mode === 'local-preview';
  const voiceQueryDev: Plugin = {
    name: 'qoe:voice-query-dev',
    configureServer(server) {
      const require = createRequire(resolve(process.cwd(), 'package.json'));
      const { createVoiceQueryHandler } = require('./scripts/voice-query-api.cjs');
      const { createQwenAnalysisHandler } = require('./scripts/qwen-analysis-api.cjs');
      const handler = createVoiceQueryHandler({ root: process.cwd() });
      const analysis = createQwenAnalysisHandler({ root: process.cwd() });
      server.middlewares.use((req, res, next) => {
        void analysis(req, res).then((handled: boolean) => {
          if (handled) return;
          return handler(req, res).then((voiceHandled: boolean) => { if (!voiceHandled) next(); });
        }).catch(next);
      });
      server.httpServer?.once('close', () => { void Promise.all([handler.close(), analysis.close()]); });
    },
  };
  const localPreviewBuild: Plugin = {
    name: 'qoe:local-preview-build',
    writeBundle(options) {
      if (this.environment.name !== 'client') return;
      if (!options.dir) throw new Error('Local preview client output directory is required');
      // Keep this outside client/ so it cannot be downloaded as a public file.
      const marker = resolve(options.dir, '..', '.qoe-local-preview.json');
      mkdirSync(dirname(marker), { recursive: true });
      writeFileSync(marker, JSON.stringify({ schemaVersion: 1, mode: 'local-preview' }));
    },
  };
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    // Local data is streamed by the loopback preview, avoiding a 150k-file
    // public route literal and copying private datasets into each UI build.
    ...(localPreview ? { publicDir: false as const } : {}),
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      watch: {
        // Windows: Excel keeps raw workbooks in data/ exclusively locked, and
        // file edits stage hidden `.<name>.<pid>.<guid>.tmpdir` swap dirs that
        // fire EBUSY the instant the watcher touches them. None of data/,
        // scripts/ or these temp dirs is imported by the app, so HMR never
        // needs them; extraction is script-driven via npm run data:*.
        ignored: [
          '**/data/**',
          '**/scripts/**',
          '**/__pycache__/**',
          '**/._*.tmpdir/**',
          '**/.*.tmpdir/**',
        ],
        ...(isCodexSeatbeltSandbox
          ? { useFsEvents: false, usePolling: true }
          : undefined),
      },
    },
    plugins: [
      voiceQueryDev,
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
      ...(localPreview ? [localPreviewBuild] : []),
    ],
  };
});
