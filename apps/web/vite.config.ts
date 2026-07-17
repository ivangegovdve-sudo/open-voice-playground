import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

const BUILD_ASSETS_MARKER = 'const BUILD_ASSETS = []; // __VITE_BUILD_ASSETS__';
const CACHE_VERSION_MARKER = "const CACHE_VERSION = 'development'; // __VITE_CACHE_VERSION__";
const SHELL_DIGEST_MARKER = "const SHELL_DIGEST = 'development'; // __VITE_SHELL_DIGEST__";
const CATALOG_URL_MARKER = "const CATALOG_URL = 'development'; // __VITE_CATALOG_URL__";
const CATALOG_DIGEST_MARKER = "const CATALOG_DIGEST = 'development'; // __VITE_CATALOG_DIGEST__";
const CATALOG_BYTES_MARKER = 'const CATALOG_BYTES = 0; // __VITE_CATALOG_BYTES__';
const ZOD_DYNAMIC_OBJECT_COMPILATION_MARKER =
  'const fastEnabled = jit && allowsEval.value; // && !def.catchall;';
const ZOD_JITLESS_OBJECT_COMPILATION =
  'const fastEnabled = false; // Open Voice static shells forbid dynamic code generation.';
const SHELL_ASSET_PATTERN = /\.(?:css|js|mjs|woff2?|png|svg|webp|avif|ico)$/i;
const INITIAL_JAVASCRIPT_PATTERN = /\.(?:js|mjs)$/i;
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
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const FORBIDDEN_RESOURCE_HINT_RELATIONS = new Set([
  'compression-dictionary',
  'dns-prefetch',
  'modulepreload',
  'next',
  'preconnect',
  'prefetch',
  'preload',
  'prerender',
  'subresource',
]);
const REVIEWED_PUBLIC_LINK_PATHS = {
  icon: '/icon.svg',
  manifest: '/manifest.webmanifest',
} as const;
const REVIEWED_RESOURCE_LINK_RELATIONS = new Set(['icon', 'manifest', 'stylesheet']);
const FORBIDDEN_WORKER_GLOBAL_NAMES = new Set(['Worker', 'SharedWorker']);
const FORBIDDEN_EXECUTABLE_STRING_GLOBAL_NAMES = new Set(['eval', 'Function']);
const FORBIDDEN_STATIC_SHELL_GLOBAL_NAMES = new Set([
  ...FORBIDDEN_WORKER_GLOBAL_NAMES,
  ...FORBIDDEN_EXECUTABLE_STRING_GLOBAL_NAMES,
]);

interface HtmlSourceLocation {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly attrs?: Readonly<Record<string, HtmlSourceLocation>>;
}

interface JsdomDocument {
  readonly window: { readonly document: Document };
  nodeLocation(node: Node): HtmlSourceLocation | null;
}

interface JsdomConstructor {
  new (
    html: string,
    options: { readonly includeNodeLocations: true; readonly url: string },
  ): JsdomDocument;
}

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { readonly JSDOM: JsdomConstructor };
const SHELL_ORIGIN = 'https://open-voice.invalid';

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  );
}

function astChildren(value: unknown): readonly AstNode[] {
  if (isAstNode(value)) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter(isAstNode);
}

function staticStringValue(node: AstNode | undefined): string | undefined {
  if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node?.type !== 'TemplateLiteral') return undefined;
  const expressions = astChildren(node.expressions);
  const quasis = Array.isArray(node.quasis) ? node.quasis.filter(isAstNode) : [];
  if (expressions.length > 0 || quasis.length !== 1) return undefined;
  const value = quasis[0]?.value;
  if (typeof value !== 'object' || value === null) return undefined;
  const cooked = Reflect.get(value, 'cooked');
  if (typeof cooked === 'string') return cooked;
  const raw = Reflect.get(value, 'raw');
  return typeof raw === 'string' ? raw : undefined;
}

function identifierName(node: AstNode | undefined): string | undefined {
  return node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : undefined;
}

function isMemberExpression(node: AstNode | undefined): node is AstNode {
  return node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression';
}

function isStaticProperty(node: AstNode | undefined): boolean {
  if (node?.type === 'Literal') return true;
  return node?.type === 'TemplateLiteral' && astChildren(node.expressions).length === 0;
}

function isGlobalObject(node: AstNode | undefined): boolean {
  return ['globalThis', 'window', 'self'].includes(identifierName(node) ?? '');
}

function staticMemberPropertyName(node: AstNode): string | undefined {
  if (!isMemberExpression(node)) return undefined;
  const property = isAstNode(node.property) ? node.property : undefined;
  return node.computed === true ? staticStringValue(property) : identifierName(property);
}

function isExactMemberAccess(
  node: AstNode | undefined,
  object: AstNode,
  propertyName: string,
): node is AstNode {
  return (
    node?.type === 'MemberExpression' &&
    node.object === object &&
    staticMemberPropertyName(node) === propertyName
  );
}

function extendsCallResult(node: AstNode | undefined, call: AstNode): boolean {
  return (
    (isMemberExpression(node) && node.object === call) ||
    ((node?.type === 'CallExpression' || node?.type === 'NewExpression') && node.callee === call) ||
    (node?.type === 'TaggedTemplateExpression' && node.tag === call)
  );
}

function isReviewedFunctionPrototypeInvocation(
  node: AstNode,
  ancestors: readonly AstNode[],
): boolean {
  if (identifierName(node) !== 'Function') return false;
  const prototypeMember = ancestors.at(-1);
  if (!isExactMemberAccess(prototypeMember, node, 'prototype')) return false;
  const utilityMember = ancestors.at(-2);
  if (
    utilityMember === undefined ||
    !['bind', 'toString'].some((name) => isExactMemberAccess(utilityMember, prototypeMember, name))
  ) {
    return false;
  }

  let callee = utilityMember;
  let call = ancestors.at(-3);
  let callParent = ancestors.at(-4);
  if (
    call !== undefined &&
    ['call', 'apply'].some((name) => isExactMemberAccess(call, utilityMember, name))
  ) {
    callee = call;
    call = ancestors.at(-4);
    callParent = ancestors.at(-5);
  }
  return (
    call?.type === 'CallExpression' &&
    call.optional !== true &&
    call.callee === callee &&
    !extendsCallResult(callParent, call)
  );
}

function isForbiddenReflectGetGlobalCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return false;
  const callee = isAstNode(node.callee) ? node.callee : undefined;
  if (!isMemberExpression(callee) || !isAstNode(callee.object)) return false;
  if (identifierName(callee.object) !== 'Reflect') return false;
  const methodProperty = isAstNode(callee.property) ? callee.property : undefined;
  const isGet =
    callee.computed === true
      ? methodProperty?.type === 'Literal' && methodProperty.value === 'get'
      : identifierName(methodProperty) === 'get';
  if (!isGet) return false;
  const arguments_ = astChildren(node.arguments);
  const target = arguments_[0];
  const property = arguments_[1];
  return (
    isGlobalObject(target) &&
    property !== undefined &&
    (!isStaticProperty(property) ||
      FORBIDDEN_STATIC_SHELL_GLOBAL_NAMES.has(staticStringValue(property) ?? ''))
  );
}

function isDynamicComputedGlobalMember(node: AstNode): boolean {
  if (!isMemberExpression(node) || node.computed !== true || !isAstNode(node.object)) return false;
  const property = isAstNode(node.property) ? node.property : undefined;
  return isGlobalObject(node.object) && !isStaticProperty(property);
}

function objectPatternSource(pattern: AstNode, owner: AstNode | undefined): AstNode | undefined {
  if (owner?.type === 'VariableDeclarator' && owner.id === pattern && isAstNode(owner.init)) {
    return owner.init;
  }
  if (owner?.type === 'AssignmentExpression' && owner.left === pattern && isAstNode(owner.right)) {
    return owner.right;
  }
  return undefined;
}

function isForbiddenGlobalObjectPatternProperty(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
): boolean {
  if (
    (node.type !== 'Property' && node.type !== 'ObjectProperty') ||
    !isAstNode(node.key) ||
    parent?.type !== 'ObjectPattern' ||
    !isGlobalObject(objectPatternSource(parent, grandparent))
  ) {
    return false;
  }
  return (
    (node.computed === true && !isStaticProperty(node.key)) ||
    FORBIDDEN_STATIC_SHELL_GLOBAL_NAMES.has(
      identifierName(node.key) ?? staticStringValue(node.key) ?? '',
    )
  );
}

function isObjectPatternPropertyKey(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
): boolean {
  return (
    (parent?.type === 'Property' || parent?.type === 'ObjectProperty') &&
    parent.key === node &&
    grandparent?.type === 'ObjectPattern'
  );
}

function isOrdinaryObjectMetadataKey(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
): boolean {
  return (
    (parent?.type === 'Property' || parent?.type === 'ObjectProperty') &&
    parent.key === node &&
    parent.computed !== true &&
    parent.shorthand !== true &&
    grandparent?.type === 'ObjectExpression'
  );
}

function isForbiddenStaticShellReference(
  node: AstNode,
  parent: AstNode | undefined,
  grandparent: AstNode | undefined,
  ancestors: readonly AstNode[],
): boolean {
  if (
    isForbiddenReflectGetGlobalCall(node) ||
    isDynamicComputedGlobalMember(node) ||
    isForbiddenGlobalObjectPatternProperty(node, parent, grandparent)
  ) {
    return true;
  }
  const identifier = identifierName(node);
  if (identifier !== undefined && FORBIDDEN_WORKER_GLOBAL_NAMES.has(identifier)) {
    if (isObjectPatternPropertyKey(node, parent, grandparent)) return false;
    return !isOrdinaryObjectMetadataKey(node, parent, grandparent);
  }
  if (identifier !== undefined && FORBIDDEN_EXECUTABLE_STRING_GLOBAL_NAMES.has(identifier)) {
    if (isObjectPatternPropertyKey(node, parent, grandparent)) return false;
    if (isOrdinaryObjectMetadataKey(node, parent, grandparent)) return false;
    if (isReviewedFunctionPrototypeInvocation(node, ancestors)) return false;
    if (isMemberExpression(parent) && parent.property === node) {
      return isAstNode(parent.object) && isGlobalObject(parent.object);
    }
    return true;
  }

  const stringValue = staticStringValue(node);
  if (stringValue === undefined || parent === undefined) return false;
  if (FORBIDDEN_WORKER_GLOBAL_NAMES.has(stringValue)) {
    if (isObjectPatternPropertyKey(node, parent, grandparent)) return false;
    if (isOrdinaryObjectMetadataKey(node, parent, grandparent)) return false;
    return (
      (isMemberExpression(parent) && parent.property === node) ||
      ((parent.type === 'Property' || parent.type === 'ObjectProperty') && parent.key === node)
    );
  }
  if (!FORBIDDEN_EXECUTABLE_STRING_GLOBAL_NAMES.has(stringValue)) return false;
  return (
    isMemberExpression(parent) &&
    parent.property === node &&
    isAstNode(parent.object) &&
    isGlobalObject(parent.object)
  );
}

/**
 * The initial shell is deliberately free of worker constructors and
 * executable-string seams. Runtime constructors live in dynamically imported
 * modules, so any such global reference in a statically reachable shell chunk
 * is a production-boundary regression.
 */
function assertStaticShellCodePolicy(program: AstNode, fileName: string): void {
  const ancestors: AstNode[] = [];
  const visit = (node: AstNode): void => {
    const parent = ancestors.at(-1);
    const grandparent = ancestors.at(-2);
    if (isForbiddenStaticShellReference(node, parent, grandparent, ancestors)) {
      throw new Error(
        `The initial production static shell chunk ${fileName} contains a forbidden Worker, SharedWorker, eval, or Function reference; runtime constructors must remain behind post-consent dynamic imports and executable-string seams are not allowed.`,
      );
    }
    ancestors.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'range', 'start', 'end', 'type'].includes(key)) continue;
      for (const child of astChildren(value)) visit(child);
    }
    ancestors.pop();
  };

  visit(program);
}

function canonicalizeCssRequestSyntax(css: string): string {
  let canonical = '';
  let index = 0;
  let quote: '"' | "'" | undefined;

  while (index < css.length) {
    const character = css[index]!;
    const next = css[index + 1];
    if (quote !== undefined) {
      if (character === '\\') {
        index += next === '\r' && css[index + 2] === '\n' ? 3 : 2;
      } else {
        if (character === quote) quote = undefined;
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      const commentEnd = css.indexOf('*/', index + 2);
      index = commentEnd === -1 ? css.length : commentEnd + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (character !== '\\') {
      canonical += character.toLowerCase();
      index += 1;
      continue;
    }

    index += 1;
    if (index >= css.length) break;
    if (css[index] === '\r' && css[index + 1] === '\n') {
      index += 2;
      continue;
    }
    if (css[index] === '\r' || css[index] === '\n' || css[index] === '\f') {
      index += 1;
      continue;
    }
    const hexStart = index;
    while (index < css.length && index - hexStart < 6 && /[\da-f]/i.test(css[index]!)) {
      index += 1;
    }
    if (index > hexStart) {
      const codePoint = Number.parseInt(css.slice(hexStart, index), 16);
      canonical += String.fromCodePoint(
        codePoint === 0 || codePoint > 0x10ffff ? 0xfffd : codePoint,
      ).toLowerCase();
      if (/\s/.test(css[index] ?? '')) {
        index += css[index] === '\r' && css[index + 1] === '\n' ? 2 : 1;
      }
      continue;
    }
    canonical += css[index]!.toLowerCase();
    index += 1;
  }

  return canonical;
}

function containsRequestCapableCss(css: string): boolean {
  const canonical = canonicalizeCssRequestSyntax(css);
  return /(?:^|[^a-z\d_-])url\s*\(/.test(canonical) || /@import(?:$|[^a-z\d_-])/.test(canonical);
}

function assertNoRequestCapableCss(css: string, context: string): void {
  if (containsRequestCapableCss(css)) {
    throw new Error(
      `The initial production shell contains request-capable CSS (${context}); url() and @import are not allowed in the static shell.`,
    );
  }
}

/**
 * Zod's supported interpreter path has the same validation semantics as its
 * optional object-schema JIT. Pin that decision at build time so Rollup can
 * remove Zod's Function-constructor probe and compiler from the static shell.
 */
function disableZodDynamicObjectCompilation(): Plugin {
  return {
    name: 'disable-zod-dynamic-object-compilation',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]zod[\\/]v4[\\/]core[\\/]schemas\.js(?:\?.*)?$/.test(id)) {
        return undefined;
      }
      const markerCount = code.split(ZOD_DYNAMIC_OBJECT_COMPILATION_MARKER).length - 1;
      if (markerCount !== 1) {
        throw new Error(
          `The reviewed Zod jitless build marker must appear exactly once in ${id}; found ${markerCount}.`,
        );
      }
      return code.replace(ZOD_DYNAMIC_OBJECT_COMPILATION_MARKER, ZOD_JITLESS_OBJECT_COMPILATION);
    },
  };
}

function hasExactReviewedJsonType(script: Element, html: string, dom: JsdomDocument): boolean {
  if (script.getAttribute('type') !== 'application/json') return false;

  const sourceLocation = dom.nodeLocation(script)?.attrs?.type;
  if (sourceLocation === undefined) return false;

  // Character references are decoded in the parsed value. Keep the reviewed policy narrower:
  // the exact literal value must also appear in the parser-owned source range.
  return !html.slice(sourceLocation.startOffset, sourceLocation.endOffset).includes('&');
}

function executableScriptSources(element: Element): readonly string[] {
  const sources: string[] = [];
  const source = element.getAttribute('src');
  if (source !== null) sources.push(source);
  if (element.namespaceURI === SVG_NAMESPACE) {
    const href = element.getAttribute('href');
    const xlinkHref = element.getAttributeNS(XLINK_NAMESPACE, 'href');
    if (href !== null) sources.push(href);
    if (xlinkHref !== null) sources.push(xlinkHref);
  }
  return sources;
}

function assertScriptSourcePolicy(
  scriptSource: string,
  document: Document,
  ownedEntryFileNames?: ReadonlySet<string>,
): void {
  let resolvedSource: URL;
  let absoluteSource: boolean;
  try {
    resolvedSource = new URL(scriptSource, document.baseURI);
    try {
      new URL(scriptSource);
      absoluteSource = true;
    } catch {
      absoluteSource = false;
    }
  } catch {
    throw new Error(`The production shell contains an invalid script source: ${scriptSource}`);
  }
  if (
    scriptSource.trim() === '' ||
    absoluteSource ||
    /^[\\/]{2}/.test(scriptSource.trimStart()) ||
    resolvedSource.protocol !== 'https:' ||
    resolvedSource.origin !== SHELL_ORIGIN ||
    resolvedSource.username !== '' ||
    resolvedSource.password !== ''
  ) {
    throw new Error(
      `The production shell script source must be a same-origin build-owned entry: ${scriptSource}`,
    );
  }
  if (ownedEntryFileNames !== undefined) {
    const fileName = resolvedSource.pathname.replace(/^\//, '');
    if (
      resolvedSource.search !== '' ||
      resolvedSource.hash !== '' ||
      !ownedEntryFileNames.has(fileName)
    ) {
      throw new Error(
        `The production shell script source is not an exact build-owned emitted entry: ${scriptSource}`,
      );
    }
  }
}

function linkRelationTokens(element: Element): readonly string[] {
  return (element.getAttribute('rel') ?? '')
    .split(/[\t\n\f\r ]+/)
    .filter((token) => token !== '')
    .map((token) => token.toLowerCase());
}

function resolveLocalLinkTarget(target: string, document: Document): URL {
  let resolvedTarget: URL;
  let absoluteTarget: boolean;
  try {
    resolvedTarget = new URL(target, document.baseURI);
    try {
      new URL(target);
      absoluteTarget = true;
    } catch {
      absoluteTarget = false;
    }
  } catch {
    throw new Error(`The production link target is invalid: ${target}`);
  }
  if (
    target.trim() === '' ||
    target !== target.trim() ||
    absoluteTarget ||
    /^[\\/]{2}/.test(target) ||
    resolvedTarget.protocol !== 'https:' ||
    resolvedTarget.origin !== SHELL_ORIGIN ||
    resolvedTarget.username !== '' ||
    resolvedTarget.password !== '' ||
    resolvedTarget.search !== '' ||
    resolvedTarget.hash !== ''
  ) {
    throw new Error(
      `The production link target must be a local same-origin URL without credentials, query, or hash: ${target}`,
    );
  }
  return resolvedTarget;
}

function assertLinkPolicy(
  link: Element,
  document: Document,
  ownedStylesheetFileNames?: ReadonlySet<string>,
): string | undefined {
  const relations = linkRelationTokens(link);
  const forbiddenRelation = relations.find((relation) =>
    FORBIDDEN_RESOURCE_HINT_RELATIONS.has(relation),
  );
  if (forbiddenRelation !== undefined) {
    throw new Error(
      `The production shell must not contain the browser-initiated resource hint link relation ${forbiddenRelation}.`,
    );
  }

  const target = link.getAttribute('href');
  if (target === null) {
    const resourceRelation = relations.find((relation) =>
      REVIEWED_RESOURCE_LINK_RELATIONS.has(relation),
    );
    if (resourceRelation === undefined) return undefined;
    throw new Error(
      `The production ${resourceRelation} link must declare a reviewed local target.`,
    );
  }
  if (relations.length !== 1 || !REVIEWED_RESOURCE_LINK_RELATIONS.has(relations[0]!)) {
    throw new Error('A production link with href must declare exactly one reviewed link relation.');
  }
  const relation = relations[0]!;
  const resolvedTarget = resolveLocalLinkTarget(target, document);
  if (relation === 'icon' || relation === 'manifest') {
    if (resolvedTarget.pathname !== REVIEWED_PUBLIC_LINK_PATHS[relation]) {
      throw new Error(
        `The production ${relation} link must use its reviewed public path ${REVIEWED_PUBLIC_LINK_PATHS[relation]}.`,
      );
    }
  } else if (ownedStylesheetFileNames !== undefined) {
    const fileName = resolvedTarget.pathname.replace(/^\//, '');
    if (!ownedStylesheetFileNames.has(fileName)) {
      throw new Error(
        `The production stylesheet link is not an exact build-owned emitted CSS asset: ${target}`,
      );
    }
  }
  return target;
}

function assertShellHtmlPolicy(
  html: string,
  ownedEntryFileNames?: ReadonlySet<string>,
  ownedStylesheetFileNames?: ReadonlySet<string>,
): readonly string[] {
  const dom = new JSDOM(html, { includeNodeLocations: true, url: `${SHELL_ORIGIN}/` });
  const document = dom.window.document;
  const assetReferences: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === 1) {
      const element = node as Element;
      const localName = element.localName.toLowerCase();
      if (localName === 'base') {
        throw new Error('The production shell must not contain a base element.');
      }
      for (const attribute of Array.from(element.attributes)) {
        const attributeName = attribute.name.toLowerCase();
        if (attributeName === 'srcdoc') {
          throw new Error('The production shell must not contain an iframe srcdoc attribute.');
        }
        if (attributeName.startsWith('on') && attribute.value.trim() !== '') {
          throw new Error(
            `The production shell contains a nonempty inline event handler (${attribute.name}); handlers must be installed from a budgeted external module.`,
          );
        }
        if (attributeName === 'style') {
          assertNoRequestCapableCss(attribute.value, 'an inline style attribute');
        }
      }

      const src = element.getAttribute('src');
      if (localName !== 'script' && src !== null && src !== '') {
        throw new Error(
          `The production shell contains an automatic request from a non-script ${localName} src attribute.`,
        );
      }
      for (const attributeName of ['srcset', 'imagesrcset']) {
        if ((element.getAttribute(attributeName) ?? '') !== '') {
          throw new Error(
            `The production shell contains an automatic request from a ${attributeName} attribute.`,
          );
        }
      }
      for (const attributeName of ['background', 'poster']) {
        if ((element.getAttribute(attributeName) ?? '') !== '') {
          throw new Error(
            `The production shell contains an automatic request from a ${attributeName} attribute.`,
          );
        }
      }
      if (localName === 'object' && (element.getAttribute('data') ?? '') !== '') {
        throw new Error(
          'The production shell contains an automatic request from an object data attribute.',
        );
      }
      if (localName === 'html' && (element.getAttribute('manifest') ?? '') !== '') {
        throw new Error(
          'The production shell contains an automatic request from an application-cache manifest attribute.',
        );
      }
      if (
        localName === 'meta' &&
        (element.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'refresh'
      ) {
        throw new Error(
          'The production shell must not contain an automatic request from meta refresh.',
        );
      }
      if (
        element.namespaceURI === SVG_NAMESPACE &&
        ['image', 'use', 'feimage'].includes(localName) &&
        ((element.getAttribute('href') ?? '') !== '' ||
          (element.getAttributeNS(XLINK_NAMESPACE, 'href') ?? '') !== '')
      ) {
        throw new Error(
          `The production shell contains an automatic request from an SVG ${localName} href attribute.`,
        );
      }
      if (localName === 'style') {
        assertNoRequestCapableCss(element.textContent ?? '', 'a style element');
      }

      if (localName === 'link') {
        const linkTarget = assertLinkPolicy(element, document, ownedStylesheetFileNames);
        if (linkTarget !== undefined) assetReferences.push(linkTarget);
      }

      if (localName === 'script') {
        const scriptSources = executableScriptSources(element);
        if (scriptSources.length === 0) {
          if (
            (element.textContent ?? '').trim() !== '' &&
            !hasExactReviewedJsonType(element, html, dom)
          ) {
            throw new Error(
              'The production shell contains an inline executable script or non-reviewed inline script data; executable JavaScript must be emitted as a budgeted module and only the exact raw type application/json is allowed for inline data.',
            );
          }
        } else {
          for (const scriptSource of scriptSources) {
            assertScriptSourcePolicy(scriptSource, document, ownedEntryFileNames);
            assetReferences.push(scriptSource);
          }
        }
      }

      if (localName === 'template') {
        const content = Reflect.get(element, 'content');
        if (content instanceof document.defaultView!.DocumentFragment) visit(content);
      }
    }

    for (const child of Array.from(node.childNodes)) visit(child);
  };

  visit(document);
  return assetReferences;
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
        assertShellHtmlPolicy(html);
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
      const ownedEntryFileNames = new Set(
        Object.values(bundle)
          .filter((output) => output.type === 'chunk' && output.isEntry)
          .map((output) => output.fileName),
      );
      const ownedStylesheetFileNames = new Set(
        Object.values(bundle)
          .filter((output) => output.type === 'asset' && output.fileName.endsWith('.css'))
          .map((output) => output.fileName),
      );
      const shellHtmlReferences = assertShellHtmlPolicy(
        indexBytes.toString('utf8'),
        ownedEntryFileNames,
        ownedStylesheetFileNames,
      );
      const requestCapableInitialCssFileNames = new Set<string>();
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
      for (const reference of shellHtmlReferences) enqueueShellFile(reference);
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
          if (containsRequestCapableCss(css)) requestCapableInitialCssFileNames.add(fileName);
          for (const match of css.matchAll(/(?:\.?\.?\/)?assets\/[^"'()\s]+/g)) {
            enqueueShellFile(match[0]);
          }
        }
      }
      const shellOutputs = [...shellFileNames]
        .map((fileName) => bundle[fileName]!)
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
      const buildAssets = shellOutputs.map((output) => `/${output.fileName}`);
      const initialJavaScriptOutputs = shellOutputs.filter((output) =>
        INITIAL_JAVASCRIPT_PATTERN.test(output.fileName),
      );
      if (initialJavaScriptOutputs.length === 0) {
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
      let initialJavaScriptGzipBytes = 0;
      for (const output of initialJavaScriptOutputs) {
        if (output.type !== 'chunk') {
          throw new Error(
            `The initial production JavaScript shell output ${output.fileName} must be a Rollup chunk, not a raw asset.`,
          );
        }
        if (output.moduleIds.some((moduleId) => isGuardedInitialModule(moduleId))) {
          throw new Error(
            `The initial production module graph contains guarded runtime implementation code: ${output.fileName}`,
          );
        }
        assertStaticShellCodePolicy(this.parse(output.code) as unknown as AstNode, output.fileName);
        initialJavaScriptGzipBytes += gzipSync(Buffer.from(output.code, 'utf8'), {
          level: 9,
        }).byteLength;
      }
      if (requestCapableInitialCssFileNames.size > 0) {
        throw new Error(
          `The initial emitted CSS graph contains request-capable CSS url()/@import syntax: ${[...requestCapableInitialCssFileNames].sort().join(', ')}`,
        );
      }
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
  worker: { format: 'es' },
  plugins: [
    disableZodDynamicObjectCompilation(),
    react(),
    injectServiceWorkerShellAssets(),
    pwaE2eResponseFixtures(),
  ],
});
