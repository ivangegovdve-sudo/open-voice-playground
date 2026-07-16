import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

describe('Tauri WebView authority', () => {
  it('gives the local static main window no IPC command permissions', () => {
    const capability = JSON.parse(
      readFileSync(resolve(root, 'apps/companion/src-tauri/capabilities/main-window.json'), 'utf8'),
    ) as {
      local?: boolean;
      windows?: string[];
      permissions?: unknown[];
    };

    expect(capability.local).toBe(true);
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual([]);
    expect(JSON.stringify(capability.permissions)).not.toMatch(
      /(?:core|fs|filesystem|image|menu|tray|webview|shell|process|dialog):/i,
    );
  });
});
