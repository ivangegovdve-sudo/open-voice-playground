import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../../..');
const workflowPath = resolve(root, '.github/workflows/ci.yml');
const workflow = parse(readFileSync(workflowPath, 'utf8')) as unknown;
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
const gitignoreEntries = gitignore
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0 && !entry.startsWith('#'));
const companionMain = readFileSync(resolve(root, 'apps/companion/src-tauri/src/main.rs'), 'utf8');
const windowsNativeScriptPath = resolve(root, 'apps/companion/scripts/verify-windows-native.ps1');
const windowsNativeScript = existsSync(windowsNativeScriptPath)
  ? readFileSync(windowsNativeScriptPath, 'utf8')
  : '';
const normalizedWindowsNativeScript = windowsNativeScript
  .replace(/\s+/g, ' ')
  .replace(/@\(\s*/g, '@(')
  .replace(/\s*\)/g, ')')
  .trim();

function powershellArrayCall(functionName: string, arguments_: string[]): string {
  const quotedArguments = arguments_.map((argument) => `'${argument}'`).join(', ');
  return `${functionName} -Arguments @(${quotedArguments})`;
}

const companionManifest = 'apps/companion/src-tauri/Cargo.toml';
const companionBinary = 'open-voice-companion';
const hostileBindTest =
  'windows_listener::tests::c9_windows_exclusive_bind_blocks_both_directions_and_maps_both_codes';
const rebindCycleTest =
  'windows_listener::tests::c9_windows_exclusive_rebind_cycles_and_full_server_shutdowns';
const twoTestSummary = String.raw`^test result: ok\. 2 passed; 0 failed; 0 ignored;`;
const oneTestSummary = String.raw`^test result: ok\. 1 passed; 0 failed; 0 ignored;`;
const providerDiagnostic = 'SENSITIVE_PROVIDER_DIAGNOSTIC';

function runWindowsNativeWithPortShim(mode: 'no-listeners' | 'occupied' | 'provider-error') {
  const scriptPath = windowsNativeScriptPath.replaceAll("'", "''");
  const portBehavior = {
    'no-listeners':
      "Write-Error -Message 'No matching MSFT_NetTCPConnection objects found by CIM query.' -Category ObjectNotFound -ErrorId 'CmdletizationQuery_NotFound' -TargetObject 'MSFT_NetTCPConnection'",
    occupied: "[pscustomobject]@{ LocalAddress = '0.0.0.0' }",
    'provider-error': `Write-Error '${providerDiagnostic}'`,
  }[mode];
  const harness = `
function rustc {
    $global:LASTEXITCODE = 0
    Write-Output 'rustc 1.97.0 (test shim)'
    Write-Output 'host: x86_64-pc-windows-msvc'
    Write-Output 'release: 1.97.0'
}

function cargo {
    $cargoArguments = @($args)
    $global:LASTEXITCODE = 0
    if ($cargoArguments -contains 'windows_listener::tests::') {
        Write-Output 'test result: ok. 2 passed; 0 failed; 0 ignored;'
    }
    elseif (
        $cargoArguments -contains '${hostileBindTest}' -or
        $cargoArguments -contains '${rebindCycleTest}'
    ) {
        Write-Output 'test result: ok. 1 passed; 0 failed; 0 ignored;'
    }
    else {
        Write-Output 'cargo shim success'
    }
}

function Get-CimInstance {
    [pscustomobject]@{
        Caption = 'Windows test shim'
        Version = '10.0.0'
        BuildNumber = '0'
    }
}

function Get-NetTCPConnection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $State,

        [Parameter(Mandatory = $true)]
        [int] $LocalPort
    )

    ${portBehavior}
}

. '${scriptPath}'
`;

  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
    {
      cwd: root,
      encoding: 'utf8',
      input: harness,
      windowsHide: true,
    },
  );
}

function readManifest(path: string): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as {
    scripts: Record<string, string>;
  };
}

describe('root and companion policy', () => {
  it('requires complete Linux and native Windows CI', () => {
    expect(workflow).toEqual({
      name: 'CI',
      on: {
        push: null,
        pull_request: null,
      },
      permissions: {
        contents: 'read',
      },
      jobs: {
        verify: {
          name: 'JavaScript and Linux Rust',
          'runs-on': 'ubuntu-24.04',
          'timeout-minutes': 60,
          steps: [
            {
              name: 'Check out repository',
              uses: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
              with: {
                'persist-credentials': false,
              },
            },
            {
              name: 'Set up Node.js',
              uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
              with: {
                'node-version': '22.13.0',
                cache: 'npm',
                'cache-dependency-path': 'package-lock.json',
              },
            },
            {
              name: 'Install repository npm version',
              run: [
                'npm install --global npm@11.16.0',
                'test "$(node --version)" = "v22.13.0"',
                'test "$(npm --version)" = "11.16.0"',
                '',
              ].join('\n'),
            },
            {
              name: 'Install exact Rust toolchain',
              run: [
                'rustup toolchain install 1.97.0 --profile minimal --component rustfmt --component clippy',
                'rustup show active-toolchain',
                'rustc --version --verbose',
                'cargo --version --verbose',
                "rustc --version --verbose | grep --fixed-strings 'release: 1.97.0'",
                "cargo --version | grep --fixed-strings 'cargo 1.97.0 '",
                '',
              ].join('\n'),
            },
            {
              name: 'Cache Cargo registry',
              uses: 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830',
              with: {
                path: '~/.cargo/registry',
                key: "cargo-registry-${{ runner.os }}-1.97.0-${{ hashFiles('apps/companion/src-tauri/Cargo.lock') }}",
              },
            },
            {
              name: 'Install dependencies',
              run: 'npm ci',
            },
            {
              name: 'Check dependency and lock policy',
              run: 'npm run dependency:check',
            },
            {
              name: 'Check companion contract drift',
              run: 'npm run companion:contract:check',
            },
            {
              name: 'Check formatting',
              run: ['npm run format:check', 'npm run rust:fmt:check', ''].join('\n'),
            },
            {
              name: 'Lint',
              run: ['npm run lint', 'npm run rust:clippy', ''].join('\n'),
            },
            {
              name: 'Check release panic policy',
              run: 'npm run rust:check:release',
            },
            {
              name: 'Typecheck',
              run: 'npm run typecheck',
            },
            {
              name: 'Test all workspaces and Rust',
              run: 'npm test',
            },
            {
              name: 'Validate catalog',
              run: ['npm run catalog:check', 'npm run catalog:validate', ''].join('\n'),
            },
            {
              name: 'Audit production dependencies',
              run: 'npm run audit',
            },
            {
              name: 'Build',
              run: 'npm run build',
            },
          ],
        },
        'windows-native': {
          name: 'Native Windows companion',
          'runs-on': 'windows-2025',
          'timeout-minutes': 90,
          steps: [
            {
              name: 'Check out repository',
              uses: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
              with: {
                'persist-credentials': false,
              },
            },
            {
              name: 'Install exact Rust toolchain',
              shell: 'pwsh',
              run: [
                'rustup toolchain install 1.97.0 --profile minimal --component rustfmt --component clippy',
                'rustup show active-toolchain',
                '',
              ].join('\n'),
            },
            {
              name: 'Cache Cargo registry',
              uses: 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830',
              with: {
                path: '~/.cargo/registry',
                key: "cargo-registry-${{ runner.os }}-1.97.0-${{ hashFiles('apps/companion/src-tauri/Cargo.lock') }}",
              },
            },
            {
              name: 'Verify native Windows listener and lifecycle',
              shell: 'pwsh',
              run: './apps/companion/scripts/verify-windows-native.ps1',
            },
          ],
        },
      },
    });
  });

  it('keeps required build ignores without blanket binary or asset ignores', () => {
    expect(gitignoreEntries).toEqual(
      expect.arrayContaining([
        'node_modules/',
        'dist/',
        'coverage/',
        '.vercel/',
        '.vite/',
        'playwright-report/',
        'test-results/',
        'target/',
        '.superpowers/',
        '*.tsbuildinfo',
        '*.log',
        '*.tmp',
      ]),
    );

    const blanketArtifactIgnore = /^\/?(?:\*\*\/)*\*\.(?:exe|dll|msi|bin|onnx|wav|mp3|zip)$/i;
    expect(gitignoreEntries.filter((entry) => blanketArtifactIgnore.test(entry))).toEqual([]);
  });

  it('keeps the companion entry point byte-exact and non-operational', () => {
    expect(companionMain).toBe(
      '#![deny(unsafe_op_in_unsafe_fn)]\n\n' +
        '#[cfg(target_os = "windows")]\n' +
        'pub mod windows_listener;\n\n' +
        'fn main() {}\n',
    );

    const forbiddenCalls = [
      /\bWindowsExclusiveListenerPort\s*::\s*new\s*\(/,
      /\bCompanionServer\s*::\s*start\s*\(/,
      /\btauri\s*::\s*Builder\b/,
      /\blisten\s*\(/,
      /\bspawn\s*\(/,
      /\b(?:std|tokio|async_std)\s*::\s*(?:process|net)\s*::/,
      /\b(?:process|net|network)\s*::/,
      /\b(?:TcpListener|TcpStream|UdpSocket|Command)\s*::/,
    ];
    for (const forbiddenCall of forbiddenCalls) {
      expect(companionMain).not.toMatch(forbiddenCall);
    }
  });

  it('provides the native Windows evidence script', () => {
    expect(existsSync(windowsNativeScriptPath)).toBe(true);
  });

  it('uses strict execution and fail-closed cargo helpers', () => {
    expect(windowsNativeScript).toContain('Set-StrictMode -Version Latest');
    expect(windowsNativeScript).toMatch(/\$ErrorActionPreference\s*=\s*'Stop'/);
    expect(windowsNativeScript).toMatch(/function\s+Invoke-Cargo\s*\{/);
    expect(windowsNativeScript).toMatch(/function\s+Invoke-CountedCargoTest\s*\{/);
    expect(windowsNativeScript).toMatch(/\[string\[\]\]\s*\$Arguments/);
    expect(windowsNativeScript).toContain('& cargo @Arguments');
    expect(windowsNativeScript).toContain('& cargo @Arguments 2>&1');
    expect(windowsNativeScript).toMatch(/\$cargoExitCode\s*=\s*\$LASTEXITCODE/g);
    expect(windowsNativeScript).toMatch(/foreach\s*\(\$line\s+in\s+\$output\)/);
    expect(windowsNativeScript).toContain('Write-Output ($line.ToString())');
    expect(windowsNativeScript).toMatch(/if\s*\(\$cargoExitCode\s+-ne\s+0\)/g);
    expect(windowsNativeScript).toMatch(/\[regex\]::Matches\(/);
    expect(windowsNativeScript).toMatch(/\$summaryMatches\.Count\s+-ne\s+1/);
  });

  it('scopes native stderr capture without weakening fail-closed exit checks', () => {
    expect([
      ...windowsNativeScript.matchAll(
        /\$previousErrorActionPreference\s*=\s*\$ErrorActionPreference/g,
      ),
    ]).toHaveLength(2);
    expect([
      ...windowsNativeScript.matchAll(/\$ErrorActionPreference\s*=\s*'Continue'/g),
    ]).toHaveLength(2);
    expect([
      ...windowsNativeScript.matchAll(
        /\$ErrorActionPreference\s*=\s*\$previousErrorActionPreference/g,
      ),
    ]).toHaveLength(2);
    expect([...windowsNativeScript.matchAll(/finally\s*\{/g)]).toHaveLength(2);
  });

  it('fails closed on the exact Windows toolchain and fixed-port preflight', () => {
    expect(windowsNativeScript).toContain('& rustc --version --verbose 2>&1');
    expect(windowsNativeScript).toMatch(/\$rustcExitCode\s*=\s*\$LASTEXITCODE/);
    expect(windowsNativeScript).toContain('release: 1\\.97\\.0');
    expect(windowsNativeScript).toContain('host: x86_64-pc-windows-msvc');
    expect(normalizedWindowsNativeScript).toContain(
      powershellArrayCall('Invoke-Cargo', ['--version', '--verbose']),
    );
    expect(windowsNativeScript).toMatch(/Get-CimInstance\s+Win32_OperatingSystem/);
    expect(windowsNativeScript).toContain('$operatingSystem.Caption');
    expect(windowsNativeScript).toContain('$operatingSystem.Version');
    expect(windowsNativeScript).toContain('$operatingSystem.BuildNumber');
    expect(normalizedWindowsNativeScript).toContain(
      'Get-NetTCPConnection -State Listen -LocalPort 17843 -ErrorAction SilentlyContinue',
    );
    expect(windowsNativeScript).toMatch(/if\s*\(\$listeners\.Count\s+-gt\s+0\)/);
  });

  it('checks captured fixed-port query errors before accepting listener results', () => {
    const initializeErrors = '$portQueryErrors = @()';
    const query =
      'Get-NetTCPConnection -State Listen -LocalPort 17843 -ErrorAction SilentlyContinue -ErrorVariable portQueryErrors';
    const classifyQueryErrors = '$portQueryFailures = @(';
    const noListenerErrorId = "'CmdletizationQuery_NotFound,Get-NetTCPConnection'";
    const noListenerCategory = '[System.Management.Automation.ErrorCategory]::ObjectNotFound';
    const noListenerTarget = "'MSFT_NetTCPConnection'";
    const rejectQueryErrors =
      "if ($portQueryFailures.Count -gt 0) { throw 'TCP listener query failed.' }";
    const rejectListeners =
      "if ($listeners.Count -gt 0) { throw 'TCP port 17843 is already occupied.' }";

    expect(windowsNativeScript).toContain(noListenerErrorId);
    expect(windowsNativeScript).toContain(noListenerCategory);
    expect(windowsNativeScript).toContain(noListenerTarget);

    const orderedPortChecks = [
      initializeErrors,
      query,
      classifyQueryErrors,
      rejectQueryErrors,
      rejectListeners,
    ];
    let previousIndex = -1;
    for (const check of orderedPortChecks) {
      const checkIndex = normalizedWindowsNativeScript.indexOf(check, previousIndex + 1);
      expect(checkIndex, `missing or misordered port check: ${check}`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = checkIndex;
    }
  });

  it('runs the exact default and focused native test evidence', () => {
    const defaultTests = powershellArrayCall('Invoke-CountedCargoTest', [
      'test',
      '--manifest-path',
      companionManifest,
      '--locked',
      '--bin',
      companionBinary,
      'windows_listener::tests::',
      '--',
      '--nocapture',
    ]);
    const hostileBind = powershellArrayCall('Invoke-CountedCargoTest', [
      'test',
      '--manifest-path',
      companionManifest,
      '--locked',
      '--bin',
      companionBinary,
      hostileBindTest,
      '--',
      '--exact',
      '--test-threads=1',
      '--nocapture',
    ]);
    const rebindCycle = powershellArrayCall('Invoke-CountedCargoTest', [
      'test',
      '--manifest-path',
      companionManifest,
      '--locked',
      '--bin',
      companionBinary,
      rebindCycleTest,
      '--',
      '--exact',
      '--test-threads=1',
      '--nocapture',
    ]);

    expect(normalizedWindowsNativeScript).toContain(
      `${defaultTests} -SummaryPattern '${twoTestSummary}'`,
    );
    expect(normalizedWindowsNativeScript).toContain(
      `${hostileBind} -SummaryPattern '${oneTestSummary}'`,
    );
    expect(normalizedWindowsNativeScript).toContain(
      `${rebindCycle} -SummaryPattern '${oneTestSummary}'`,
    );
    expect(defaultTests).not.toContain('--test-threads');
  });

  it('runs the exact strict quality and full-suite cargo gates', () => {
    const clippy = powershellArrayCall('Invoke-Cargo', [
      'clippy',
      '--manifest-path',
      companionManifest,
      '--locked',
      '--all-targets',
      '--all-features',
      '--',
      '-D',
      'warnings',
    ]);
    const releaseCheck = powershellArrayCall('Invoke-Cargo', [
      'check',
      '--manifest-path',
      companionManifest,
      '--release',
      '--locked',
      '--lib',
    ]);
    const fullSuite = powershellArrayCall('Invoke-Cargo', [
      'test',
      '--manifest-path',
      companionManifest,
      '--locked',
      '--all-targets',
      '--all-features',
      '--',
      '--test-threads=1',
    ]);

    expect(normalizedWindowsNativeScript).toContain(clippy);
    expect(normalizedWindowsNativeScript).toContain(releaseCheck);
    expect(normalizedWindowsNativeScript).toContain(fullSuite);
  });

  it('keeps preflight and evidence stages in the required order', () => {
    const orderedStages = [
      '& rustc --version --verbose 2>&1',
      powershellArrayCall('Invoke-Cargo', ['--version', '--verbose']),
      'Get-CimInstance Win32_OperatingSystem',
      'Get-NetTCPConnection -State Listen -LocalPort 17843 -ErrorAction SilentlyContinue',
      powershellArrayCall('Invoke-CountedCargoTest', [
        'test',
        '--manifest-path',
        companionManifest,
        '--locked',
        '--bin',
        companionBinary,
        'windows_listener::tests::',
        '--',
        '--nocapture',
      ]),
      hostileBindTest,
      rebindCycleTest,
      powershellArrayCall('Invoke-Cargo', [
        'clippy',
        '--manifest-path',
        companionManifest,
        '--locked',
        '--all-targets',
        '--all-features',
        '--',
        '-D',
        'warnings',
      ]),
      powershellArrayCall('Invoke-Cargo', [
        'check',
        '--manifest-path',
        companionManifest,
        '--release',
        '--locked',
        '--lib',
      ]),
      powershellArrayCall('Invoke-Cargo', [
        'test',
        '--manifest-path',
        companionManifest,
        '--locked',
        '--all-targets',
        '--all-features',
        '--',
        '--test-threads=1',
      ]),
    ];

    let previousIndex = -1;
    for (const stage of orderedStages) {
      const stageIndex = normalizedWindowsNativeScript.indexOf(stage, previousIndex + 1);
      expect(stageIndex, `missing or misordered stage: ${stage}`).toBeGreaterThan(previousIndex);
      previousIndex = stageIndex;
    }
  });

  it('forbids bypasses, mutation, listener startup, and command evaluation', () => {
    expect(windowsNativeScript).not.toMatch(
      /\b(?:skip|fallback|retry|reuseaddress|so_reuseaddr|exclusiveaddressuse)\b/i,
    );
    expect(windowsNativeScript).not.toMatch(
      /\b(?:Stop-Process|taskkill|kill|Start-Process|Start-Job|Start-ThreadJob)\b/i,
    );
    expect(windowsNativeScript).not.toMatch(
      /\b(?:New-NetFirewallRule|Set-NetFirewallRule|Remove-NetFirewallRule|netsh|reg(?:\.exe)?)\b/i,
    );
    expect(windowsNativeScript).not.toMatch(
      /\b(?:Invoke-Expression|iex|cargo\s+run|TcpListener|ScriptBlock::Create)\b/i,
    );
    expect(windowsNativeScript).not.toMatch(/\$env:|EnvironmentVariable|-AsJob\b/i);
    expect(windowsNativeScript).not.toMatch(/(?:^|\s)&\s*(?:$|#)/m);
    expect(windowsNativeScript).not.toMatch(/\b(?:while|do)\s*\(/i);

    const fiveDigitLiterals = [...windowsNativeScript.matchAll(/\b\d{5}\b/g)].map(
      ([literal]) => literal,
    );
    expect(new Set(fiveDigitLiterals)).toEqual(new Set(['17843']));
  });

  it('wires complete root and companion gates', () => {
    const rootScripts = readManifest('package.json').scripts;
    const companionScripts = readManifest('apps/companion/package.json').scripts;

    expect(companionScripts.build).toBe(
      'npm run openapi:check && npm run corpus:check && tsc -p tsconfig.json',
    );
    expect(companionScripts['dependency:check']).toBe('node ./scripts/dependency-policy.mjs');

    expect(rootScripts.test).toBe(
      'npm run build:contracts && npm run build:catalog && npm run test:contracts && npm run test:catalog && npm run test:companion && npm run test:web && npm run rust:test',
    );
    expect(rootScripts['dependency:check']).toBe(
      'npm run dependency:check --workspace @open-voice/companion',
    );
    expect(rootScripts['companion:contract:check']).toBe(
      'npm run openapi:check --workspace @open-voice/companion && npm run corpus:check --workspace @open-voice/companion',
    );
    expect(rootScripts['rust:fmt:check']).toBe(
      'cargo fmt --manifest-path apps/companion/src-tauri/Cargo.toml -- --check',
    );
    expect(rootScripts['rust:clippy']).toBe(
      'cargo clippy --manifest-path apps/companion/src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings',
    );
    expect(rootScripts['rust:test']).toBe(
      'cargo test --manifest-path apps/companion/src-tauri/Cargo.toml --locked --all-targets --all-features -- --test-threads=1',
    );
    expect(rootScripts['rust:check:release']).toBe(
      'cargo check --manifest-path apps/companion/src-tauri/Cargo.toml --release --locked --lib',
    );
    expect(rootScripts['test:companion']).toBe('npm run test --workspace @open-voice/companion');

    expect(companionScripts.build.split(' && ')).toEqual([
      'npm run openapi:check',
      'npm run corpus:check',
      'tsc -p tsconfig.json',
    ]);

    const rootTestGates = rootScripts.test.split(' && ');
    expect(rootTestGates.slice(0, 2)).toEqual(['npm run build:contracts', 'npm run build:catalog']);
    expect(rootTestGates.findIndex((gate) => gate.startsWith('npm run test:'))).toBeGreaterThan(1);
    expect(rootTestGates).toContain('npm run test:companion');
    expect(rootTestGates.at(-1)).toBe('npm run rust:test');
  });
});

const describeWindowsNativeBehavior = process.platform === 'win32' ? describe : describe.skip;

describeWindowsNativeBehavior('native Windows fixed-port query behavior', () => {
  it('fails closed without echoing provider diagnostics when the query reports an error', () => {
    const result = runWindowsNativeWithPortShim('provider-error');
    const output = `${result.stdout}${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain('TCP listener query failed.');
    expect(output).not.toContain(providerDiagnostic);
  });

  it('fails closed when the fixed port has a listener', () => {
    const result = runWindowsNativeWithPortShim('occupied');
    const output = `${result.stdout}${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain('TCP port 17843 is already occupied.');
  });

  it('continues only when the fixed-port query succeeds with no listeners', () => {
    const result = runWindowsNativeWithPortShim('no-listeners');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
