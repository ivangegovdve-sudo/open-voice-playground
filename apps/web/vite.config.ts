import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ASSETS_MARKER = 'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__';
const CACHE_VERSION_MARKER = "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__";
const SHELL_DIGEST_MARKER = "const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__";
const CATALOG_URL_MARKER = "const CATALOG_URL = 'development'; // __VITE_CATALOG_URL__";
const CATALOG_DIGEST_MARKER = "const CATALOG_DIGEST = 'development'; // __VITE_CATALOG_DIGEST__";
const CATALOG_BYTES_MARKER = 'const CATALOG_BYTES = 0; // __VITE_CATALOG_BYTES__';
const SHELL_ASSET_PATTERN = /\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;
const LAUNCH_CATALOG_ASSET_PATTERN = /^assets\/launch-catalog\.public-[A-Za-z0-9_-]{6,}\.json$/;
const MAX_INITIAL_JAVASCRIPT_GZIP_BYTES = 250 * 1024;
const FORBIDDEN_INITIAL_ASSET_PATTERN =
  /(?:worker|inference|model|tokenizer|\.wasm$|\.onnx$|\.bin$|\.safetensors$|\.npz$)/i;
const FORBIDDEN_INITIAL_MODULE_PATTERNS = [
  /(?:^|[\\/])(?:onnxruntime-web|onnxruntime-web-use-extern-wasm|sherpa-onnx-web)(?:[\\/]|$)/i,
  /(?:^|[\\/])@huggingface[\\/]transformers(?:[\\/]|$)/i,
  /(?:^|[\\/])runtime[\\/](?:workers|supertonic|inference)(?:[\\/]|$)/i,
  /(?:^|[\\/])[^\\/]*\.worker\.(?:[cm]?[jt]s|[jt]sx)(?:$|[?&])/i,
];

function hasNonemptyScriptContent(script: DefaultTreeAdapterTypes.Element): boolean {
  return script.childNodes.some((child) => !('value' in child) || child.value.trim() !== '');
}

function hasExactReviewedJsonType(script: DefaultTreeAdapterTypes.Element, html: string): boolean {
  const typeAttribute = script.attrs.find((attribute) => attribute.name === 'type');
  if (typeAttribute?.value !== 'application/json') return false;

  const sourceLocation = script.sourceCodeLocation?.attrs?.[typeAttribute.name];
  if (sourceLocation === undefined) return false;

  // Character references are decoded in the parsed value. Keep the reviewed policy narrower:
  // the exact literal value must also appear in the parser-owned source range.
  return !html.slice(sourceLocation.startOffset, sourceLocation.endOffset).includes('&');
}

function assertNoInlineExecutableScripts(html: string): void {
  const document = parse(html, { sourceCodeLocationInfo: true });

  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if (
      'tagName' in node &&
      node.tagName.toLowerCase() === 'script' &&
      hasNonemptyScriptContent(node) &&
      !node.attrs.some((attribute) => attribute.name === 'src') &&
      !hasExactReviewedJsonType(node, html)
    ) {
      throw new Error(
        'The production shell contains an inline executable script or non-reviewed inline script data; executable JavaScript must be emitted as a budgeted module and only the exact raw type application/json is allowed for inline data.',
      );
    }

    if ('childNodes' in node) {
      for (const child of node.childNodes) visit(child);
    }
    if ('content' in node) {
      for (const child of node.content.childNodes) visit(child);
    }
  };

  visit(document);
}

function isGuardedInitialModule(moduleId: string): boolean {
  return FORBIDDEN_INITIAL_MODULE_PATTERNS.some((pattern) => pattern.test(moduleId));
}

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
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        assertNoInlineExecutableScripts(html);
        return html;
      },
    },
    async writeBundle(outputOptions, bundle) {
      if (outputOptions.dir === undefined) {
        throw new Error('The web build must write to a directory for PWA asset injection.');
      }

      const catalogOutputs = Object.values(bundle).filter(
        (output) => output.type === 'asset' && LAUNCH_CATALOG_ASSET_PATTERN.test(output.fileName),
      );

      if (catalogOutputs.length !== 1) {
        throw new Error(
          `The web build must emit exactly one content-addressed launch catalog; found ${catalogOutputs.length}.`,
        );
      }
      const catalogOutput = catalogOutputs[0]!;
      if (catalogOutput.type !== 'asset') {
        throw new Error('The emitted launch catalog must be a static asset.');
      }
      const catalogBytes =
        typeof catalogOutput.source === 'string'
          ? Buffer.from(catalogOutput.source, 'utf8')
          : Buffer.from(catalogOutput.source);
      const catalogUrl = `/${catalogOutput.fileName}`;
      const catalogDigest = `sha256:${createHash('sha256').update(catalogBytes).digest('hex')}`;

      const serviceWorkerPath = resolve(outputOptions.dir, 'sw.js');
      const [serviceWorkerBytes, indexBytes, manifestBytes, iconBytes] = await Promise.all([
        readFile(serviceWorkerPath),
        readFile(resolve(outputOptions.dir, 'index.html')),
        readFile(resolve(outputOptions.dir, 'manifest.webmanifest')),
        readFile(resolve(outputOptions.dir, 'icon.svg')),
      ]);
      assertNoInlineExecutableScripts(indexBytes.toString('utf8'));
      const pendingShellFiles: string[] = [];
      const shellFileNames = new Set<string>();
      const enqueueShellFile = (reference: string): void => {
        const fileName = new URL(reference, 'https://open-voice.invalid/').pathname.replace(
          /^\//,
          '',
        );
        if (
          !shellFileNames.has(fileName) &&
          bundle[fileName] !== undefined &&
          SHELL_ASSET_PATTERN.test(fileName)
        ) {
          shellFileNames.add(fileName);
          pendingShellFiles.push(fileName);
        }
      };
      for (const match of indexBytes.toString('utf8').matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
        enqueueShellFile(match[1]!);
      }
      while (pendingShellFiles.length > 0) {
        const fileName = pendingShellFiles.shift()!;
        const output = bundle[fileName]!;
        if (output.type === 'chunk') {
          for (const imported of output.imports) enqueueShellFile(imported);
          const metadata = (
            output as typeof output & { viteMetadata?: { importedCss?: ReadonlySet<string> } }
          ).viteMetadata;
          for (const importedCss of metadata?.importedCss ?? []) enqueueShellFile(importedCss);
        } else if (fileName.endsWith('.css')) {
          const css =
            typeof output.source === 'string'
              ? output.source
              : Buffer.from(output.source).toString('utf8');
          for (const match of css.matchAll(/(?:\.?\.?\/)?assets\/[^"'()\s]+/g)) {
            enqueueShellFile(match[0]);
          }
        }
      }
      const shellOutputs = [...shellFileNames]
        .map((fileName) => bundle[fileName]!)
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
      const buildAssets = shellOutputs.map((output) => `/${output.fileName}`);
      if (!buildAssets.some((path) => /\.(?:js|mjs)$/.test(path))) {
        throw new Error('The PWA shell build did not emit a JavaScript entry.');
      }
      const forbiddenShellAsset = buildAssets.find((path) =>
        FORBIDDEN_INITIAL_ASSET_PATTERN.test(path),
      );
      if (forbiddenShellAsset !== undefined) {
        throw new Error(
          `The initial production shell graph contains a forbidden inference/runtime asset: ${forbiddenShellAsset}`,
        );
      }
      for (const output of shellOutputs) {
        if (
          output.type === 'chunk' &&
          output.moduleIds.some((moduleId) => isGuardedInitialModule(moduleId))
        ) {
          throw new Error(
            `The initial production module graph contains guarded runtime implementation code: ${output.fileName}`,
          );
        }
      }
      const initialJavaScriptGzipBytes = shellOutputs.reduce(
        (total, output) =>
          output.type === 'chunk'
            ? total + gzipSync(Buffer.from(output.code, 'utf8'), { level: 9 }).byteLength
            : total,
        0,
      );
      if (initialJavaScriptGzipBytes >= MAX_INITIAL_JAVASCRIPT_GZIP_BYTES) {
        throw new Error(
          `The initial production JavaScript graph is ${initialJavaScriptGzipBytes} bytes gzip; it must stay below 250 KiB gzip.`,
        );
      }
      const serviceWorker = serviceWorkerBytes.toString('utf8');
      assertUniqueInjectionMarker(serviceWorker, BUILD_ASSETS_MARKER, '__VITE_BUILD_ASSETS__');
      assertUniqueInjectionMarker(serviceWorker, CACHE_VERSION_MARKER, '__VITE_CACHE_VERSION__');
      assertUniqueInjectionMarker(serviceWorker, SHELL_DIGEST_MARKER, '__VITE_SHELL_DIGEST__');
      assertUniqueInjectionMarker(serviceWorker, CATALOG_URL_MARKER, '__VITE_CATALOG_URL__');
      assertUniqueInjectionMarker(serviceWorker, CATALOG_DIGEST_MARKER, '__VITE_CATALOG_DIGEST__');
      assertUniqueInjectionMarker(serviceWorker, CATALOG_BYTES_MARKER, '__VITE_CATALOG_BYTES__');

      const cacheVersionHash = createHash('sha256')
        .update(serviceWorkerBytes)
        .update('\0')
        .update(indexBytes)
        .update('\0')
        .update(manifestBytes)
        .update('\0')
        .update(iconBytes)
        .update('\0')
        .update(catalogOutput.fileName)
        .update('\0')
        .update(catalogBytes)
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
        .replace(SHELL_DIGEST_MARKER, `const SHELL_DIGEST = '${shellDigest}';`)
        .replace(CATALOG_URL_MARKER, `const CATALOG_URL = '${catalogUrl}';`)
        .replace(CATALOG_DIGEST_MARKER, `const CATALOG_DIGEST = '${catalogDigest}';`)
        .replace(CATALOG_BYTES_MARKER, `const CATALOG_BYTES = ${catalogBytes.byteLength};`);
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
          const catalogFixture = url.searchParams.get('__pwa_catalog_fixture');
          let upgradedWorker = serviceWorker.replace(
            /const CACHE_VERSION = '[^']+';/,
            `const CACHE_VERSION = '${alternateVersion}';`,
          );
          if (catalogFixture === null) {
            upgradedWorker = upgradedWorker.replace(
              /const SHELL_DIGEST = '[^']+';/,
              `const SHELL_DIGEST = '${alternateDigest}';`,
            );
          } else if (catalogFixture === 'missing') {
            upgradedWorker = upgradedWorker.replace(
              /const CATALOG_URL = '[^']+';/,
              "const CATALOG_URL = '/__pwa_catalog_missing__.json';",
            );
          } else if (catalogFixture === 'unavailable') {
            upgradedWorker = upgradedWorker.replace(
              /const CATALOG_URL = '[^']+';/,
              "const CATALOG_URL = '/__pwa_catalog_unavailable__.json';",
            );
          } else if (catalogFixture === 'oversized') {
            upgradedWorker = upgradedWorker.replace(
              /const CATALOG_BYTES = (\d+);/,
              (_match, bytes: string) => `const CATALOG_BYTES = ${Number(bytes) - 1};`,
            );
          } else if (catalogFixture === 'wrong-digest') {
            upgradedWorker = upgradedWorker.replace(
              /const CATALOG_DIGEST = '[^']+';/,
              `const CATALOG_DIGEST = 'sha256:${alternateDigest}';`,
            );
          }
          response.end(upgradedWorker);
          return;
        }
        if (url.pathname === '/__pwa_catalog_missing__.json') {
          response.statusCode = 404;
          response.setHeader('content-type', 'application/json');
          response.end('{"error":"missing"}');
          return;
        }
        if (url.pathname === '/__pwa_catalog_unavailable__.json') {
          response.statusCode = 503;
          response.setHeader('content-type', 'application/json');
          response.end('{"error":"unavailable"}');
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
