import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ASSETS_MARKER = 'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__';
const CACHE_VERSION_MARKER = "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__";
const SHELL_IDENTITY_MARKER = "const SHELL_IDENTITY = 'development'; // __VITE_SHELL_IDENTITY__";
const SHELL_ASSET_PATTERN = /\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;

function injectServiceWorkerShellAssets(): Plugin {
  return {
    name: 'inject-service-worker-shell-assets',
    apply: 'build',
    async writeBundle(outputOptions, bundle) {
      if (outputOptions.dir === undefined) {
        throw new Error('The web build must write to a directory for PWA asset injection.');
      }

      const shellOutputs = Object.values(bundle)
        .filter((output) => SHELL_ASSET_PATTERN.test(output.fileName))
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
      const buildAssets = shellOutputs.map((output) => `/${output.fileName}`);

      if (!buildAssets.some((path) => path.endsWith('.js'))) {
        throw new Error('The PWA shell build did not emit a JavaScript entry.');
      }

      const serviceWorkerPath = resolve(outputOptions.dir, 'sw.js');
      const [serviceWorker, indexHtml, manifest, icon] = await Promise.all([
        readFile(serviceWorkerPath, 'utf8'),
        readFile(resolve(outputOptions.dir, 'index.html'), 'utf8'),
        readFile(resolve(outputOptions.dir, 'manifest.webmanifest'), 'utf8'),
        readFile(resolve(outputOptions.dir, 'icon.svg'), 'utf8'),
      ]);
      if (
        !serviceWorker.includes(BUILD_ASSETS_MARKER) ||
        !serviceWorker.includes(CACHE_VERSION_MARKER) ||
        !serviceWorker.includes(SHELL_IDENTITY_MARKER)
      ) {
        throw new Error('The service-worker precache injection markers are missing.');
      }

      const cacheVersionHash = createHash('sha256')
        .update(serviceWorker)
        .update('\0')
        .update(indexHtml)
        .update('\0')
        .update(manifest)
        .update('\0')
        .update(icon)
        .update('\0');
      for (const output of shellOutputs) {
        cacheVersionHash
          .update(output.fileName)
          .update('\0')
          .update(output.type === 'chunk' ? output.code : output.source)
          .update('\0');
      }
      const cacheVersion = cacheVersionHash.digest('hex').slice(0, 12);
      const injectedServiceWorker = serviceWorker
        .replace(
          BUILD_ASSETS_MARKER,
          `const BUILD_ASSETS = ${JSON.stringify(buildAssets)}; // __VITE_BUILD_ASSETS__`,
        )
        .replace(
          CACHE_VERSION_MARKER,
          `const CACHE_VERSION = '${cacheVersion}'; // __VITE_CACHE_VERSION__`,
        )
        .replace(
          SHELL_IDENTITY_MARKER,
          `const SHELL_IDENTITY = '${cacheVersion}'; // __VITE_SHELL_IDENTITY__`,
        );
      if (/open-voice-shell/i.test(indexHtml)) {
        throw new Error('The source index already contains the reserved open-voice-shell marker.');
      }
      const headOpeningIndex = indexHtml.indexOf('<head>');
      const headClosingIndex = indexHtml.indexOf('</head>', headOpeningIndex + '<head>'.length);
      if (
        headOpeningIndex < 0 ||
        indexHtml.search(/<head\b/i) !== headOpeningIndex ||
        (indexHtml.match(/<head\b/gi) ?? []).length !== 1 ||
        headClosingIndex < headOpeningIndex + '<head>'.length ||
        indexHtml.search(/<\/head\b/i) !== headClosingIndex ||
        (indexHtml.match(/<\/head\b/gi) ?? []).length !== 1
      ) {
        throw new Error(
          'The emitted index requires one canonical <head> element for shell identity injection.',
        );
      }
      const shellIdentityMeta = `<meta name="open-voice-shell" content="${cacheVersion}">`;
      const identityInsertionIndex = headOpeningIndex + '<head>'.length;
      const injectedIndexHtml = `${indexHtml.slice(0, identityInsertionIndex)}\n  ${shellIdentityMeta}${indexHtml.slice(identityInsertionIndex)}`;

      await Promise.all([
        writeFile(serviceWorkerPath, injectedServiceWorker, 'utf8'),
        writeFile(resolve(outputOptions.dir, 'index.html'), injectedIndexHtml, 'utf8'),
      ]);
    },
  };
}

function pwaE2eResponseFixtures(): Plugin {
  return {
    name: 'pwa-e2e-response-fixtures',
    configurePreviewServer(server) {
      if (process.env.OPEN_VOICE_PWA_TEST_FIXTURES !== '1') {
        return;
      }
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://preview.local');
        const fixture = url.searchParams.get('__pwa_fixture');
        if (url.pathname === '/sw-upgrade.js') {
          const alternateIdentity = 'ffffffffffff';
          const serviceWorker = await readFile(
            resolve(server.config.root, server.config.build.outDir, 'sw.js'),
            'utf8',
          );
          response.statusCode = 200;
          response.setHeader('content-type', 'text/javascript; charset=utf-8');
          response.setHeader('service-worker-allowed', '/');
          response.end(
            serviceWorker
              .replace(
                /const CACHE_VERSION = '[^']+';/,
                `const CACHE_VERSION = '${alternateIdentity}';`,
              )
              .replace(
                /const SHELL_IDENTITY = '[^']+';/,
                `const SHELL_IDENTITY = '${alternateIdentity}';`,
              ),
          );
          return;
        }
        if (
          url.pathname === '/index.html' &&
          request.headers.cookie?.includes('open_voice_install_fixture=arbitrary-html') === true
        ) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
          response.statusCode = 200;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end('<!doctype html><html><body>Install-time account page</body></html>');
          return;
        }
        if (fixture === 'redirect-login') {
          response.statusCode = 302;
          response.setHeader('location', '/login');
          response.end();
          return;
        }
        const requestedIdentity = url.searchParams.get('__pwa_identity') ?? '';
        const fixtureIdentity = /^[a-f0-9]{12}$/.test(requestedIdentity)
          ? requestedIdentity
          : '000000000000';
        const fixtureBody =
          fixture === 'arbitrary-html'
            ? '<!doctype html><html><body>Arbitrary account page</body></html>'
            : fixture === 'error-html'
              ? '<!doctype html><html><body><h1>Application error</h1></body></html>'
              : fixture === 'wrong-identity'
                ? `<!doctype html><html><head><meta name="open-voice-shell" content="${fixtureIdentity}"></head><body>Wrong build</body></html>`
                : fixture === 'comment-identity'
                  ? `<!doctype html><html><head><!-- <meta name="open-voice-shell" content="${fixtureIdentity}"> --></head><body>Comment marker</body></html>`
                  : fixture === 'title-identity'
                    ? `<!doctype html><html><head><title><meta name="open-voice-shell" content="${fixtureIdentity}"></title></head><body>Title marker</body></html>`
                    : fixture === 'textarea-identity'
                      ? `<!doctype html><html><head><textarea><meta name="open-voice-shell" content="${fixtureIdentity}"></textarea></head><body>Textarea marker</body></html>`
                      : fixture === 'template-identity'
                        ? `<!doctype html><html><head><template><meta name="open-voice-shell" content="${fixtureIdentity}"></template></head><body>Template marker</body></html>`
                        : fixture === 'duplicate-identity'
                          ? `<!doctype html><html><head><meta name="open-voice-shell" content="${fixtureIdentity}"><meta name="open-voice-shell" content="${fixtureIdentity}"></head><body>Duplicate marker</body></html>`
                          : fixture === 'malformed-identity'
                            ? `<!doctype html><html><head><meta name="open-voice-shell" content="${fixtureIdentity}"</head><body>Malformed marker</body></html>`
                            : fixture === 'quoted-head-identity'
                              ? `<!doctype html><html><head data-note="><meta name="open-voice-shell" content="${fixtureIdentity}">"><title>Quoted head marker</title></head><body></body></html>`
                              : fixture === 'body-identity'
                                ? `<!doctype html><html><head></head><body><meta name="open-voice-shell" content="${fixtureIdentity}">Spoofed body marker</body></html>`
                                : undefined;
        if (fixtureBody === undefined) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(fixtureBody);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), injectServiceWorkerShellAssets(), pwaE2eResponseFixtures()],
});
