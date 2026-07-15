import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ASSETS_MARKER = 'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__';
const CACHE_VERSION_MARKER = "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__";
const SHELL_DIGEST_MARKER = "const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__";
const SHELL_ASSET_PATTERN = /\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;

function assertUniqueInjectionMarker(
  serviceWorker: string,
  marker: string,
  placeholder: string,
): void {
  const occurrences = serviceWorker.split(placeholder).length - 1;
  if (occurrences !== 1 || !serviceWorker.includes(marker)) {
    throw new Error(`The service-worker injection marker ${placeholder} must appear exactly once.`);
  }
}

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
      const [serviceWorkerBytes, indexBytes, manifestBytes, iconBytes] = await Promise.all([
        readFile(serviceWorkerPath),
        readFile(resolve(outputOptions.dir, 'index.html')),
        readFile(resolve(outputOptions.dir, 'manifest.webmanifest')),
        readFile(resolve(outputOptions.dir, 'icon.svg')),
      ]);
      const serviceWorker = serviceWorkerBytes.toString('utf8');
      assertUniqueInjectionMarker(serviceWorker, BUILD_ASSETS_MARKER, '__VITE_BUILD_ASSETS__');
      assertUniqueInjectionMarker(serviceWorker, CACHE_VERSION_MARKER, '__VITE_CACHE_VERSION__');
      assertUniqueInjectionMarker(serviceWorker, SHELL_DIGEST_MARKER, '__VITE_SHELL_DIGEST__');

      const cacheVersionHash = createHash('sha256')
        .update(serviceWorkerBytes)
        .update('\0')
        .update(indexBytes)
        .update('\0')
        .update(manifestBytes)
        .update('\0')
        .update(iconBytes)
        .update('\0');
      for (const output of shellOutputs) {
        cacheVersionHash
          .update(output.fileName)
          .update('\0')
          .update(output.type === 'chunk' ? output.code : output.source)
          .update('\0');
      }
      const cacheVersion = cacheVersionHash.digest('hex').slice(0, 12);
      const shellDigest = createHash('sha256').update(indexBytes).digest('hex');
      const injectedServiceWorker = serviceWorker
        .replace(BUILD_ASSETS_MARKER, `const BUILD_ASSETS = ${JSON.stringify(buildAssets)};`)
        .replace(CACHE_VERSION_MARKER, `const CACHE_VERSION = '${cacheVersion}';`)
        .replace(SHELL_DIGEST_MARKER, `const SHELL_DIGEST = '${shellDigest}';`);
      if (injectedServiceWorker.includes('__VITE_')) {
        throw new Error('The built service worker contains an unresolved injection placeholder.');
      }

      await writeFile(serviceWorkerPath, injectedServiceWorker, 'utf8');
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
          const alternateVersion = 'ffffffffffff';
          const alternateDigest = 'f'.repeat(64);
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
                `const CACHE_VERSION = '${alternateVersion}';`,
              )
              .replace(
                /const SHELL_DIGEST = '[^']+';/,
                `const SHELL_DIGEST = '${alternateDigest}';`,
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
        if (fixture === 'near-matching-shell') {
          const indexHtml = await readFile(
            resolve(server.config.root, server.config.build.outDir, 'index.html'),
            'utf8',
          );
          response.statusCode = 200;
          response.setHeader('content-type', 'text/html; charset=utf-8');
          response.end(`${indexHtml} `);
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
                  : fixture === 'comment-fake-head'
                    ? `<!doctype html><!-- <head><meta name="open-voice-shell" content="${fixtureIdentity}"></head> --><html><body>Comment fake head</body></html>`
                    : fixture === 'raw-text-fake-head'
                      ? `<!doctype html><html><title><head><meta name="open-voice-shell" content="${fixtureIdentity}"></head></title><body>Raw-text fake head</body></html>`
                      : fixture === 'quoted-attribute-fake-head'
                        ? `<!doctype html><html data-note='<head><meta name="open-voice-shell" content="${fixtureIdentity}"></head>'><body>Quoted-attribute fake head</body></html>`
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
