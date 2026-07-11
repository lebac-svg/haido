import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installClaudeCode,
  installClaudeDesktop,
} from '../src/integrations/claude-code/install.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'haido-install-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Settings {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  keepMe?: number;
}

describe('installClaudeCode', () => {
  it('writes hooks + .mcp.json and is idempotent', () => {
    const r1 = installClaudeCode({ root: tmp });
    expect(r1.wrote.some((w) => w.endsWith('settings.json'))).toBe(true);
    expect(r1.wrote.some((w) => w.endsWith('.mcp.json'))).toBe(true);

    const settings = JSON.parse(
      readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(settings.hooks['SessionStart']?.[0]?.hooks[0]?.command).toBe('haido hook session-start');
    const post = settings.hooks['PostToolUse']?.[0];
    expect(post?.matcher).toBe('Read|Edit|Write|MultiEdit');
    expect(post?.hooks[0]?.command).toBe('haido hook post-tool');

    const mcp = JSON.parse(readFileSync(path.join(tmp, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(mcp.mcpServers['haido']).toEqual({ command: 'haido', args: ['serve'] });

    // run twice — no duplicates
    installClaudeCode({ root: tmp });
    const again = JSON.parse(
      readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(again.hooks['SessionStart']).toHaveLength(1);
    expect(again.hooks['PostToolUse']).toHaveLength(1);
    expect(again.hooks['Stop']).toHaveLength(1);
  });

  it('preserves existing settings and backs the file up', () => {
    mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    writeFileSync(
      path.join(tmp, '.claude', 'settings.json'),
      JSON.stringify({
        keepMe: 7,
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
      }),
    );
    installClaudeCode({ root: tmp });
    const settings = JSON.parse(
      readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(settings.keepMe).toBe(7);
    expect(settings.hooks['Stop']).toHaveLength(2); // the user's own hook + haido's
    expect(settings.hooks['Stop']?.[0]?.hooks[0]?.command).toBe('x'); // untouched
    expect(settings.hooks['Stop']?.[1]?.hooks[0]?.command).toBe('haido hook stop');
    expect(settings.hooks['SessionStart']).toHaveLength(1);
    expect(readFileSync(path.join(tmp, '.claude', 'settings.json.bak-haido'), 'utf8')).toContain(
      'keepMe',
    );
  });

  it('honours a dev launcher override with spaces quoted', () => {
    installClaudeCode({ root: tmp, command: ['node', 'C:\\Dự án\\haido\\dist\\cli.js'] });
    const settings = JSON.parse(
      readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'),
    ) as Settings;
    expect(settings.hooks['SessionStart']?.[0]?.hooks[0]?.command).toBe(
      'node "C:\\Dự án\\haido\\dist\\cli.js" hook session-start',
    );
    const mcp = JSON.parse(readFileSync(path.join(tmp, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(mcp.mcpServers['haido']?.command).toBe('node');
    expect(mcp.mcpServers['haido']?.args).toEqual(['C:\\Dự án\\haido\\dist\\cli.js', 'serve']);
  });
});

describe('installClaudeDesktop', () => {
  it('registers a per-project MCP entry pinned via --root', () => {
    const cfg = path.join(tmp, 'desktop', 'claude_desktop_config.json');
    const r = installClaudeDesktop({ root: tmp, configPath: cfg });
    expect(r.wrote).toEqual([cfg]);
    const parsed = JSON.parse(readFileSync(cfg, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const name = `haido-${path.basename(tmp)}`;
    expect(parsed.mcpServers[name]?.args).toEqual(['serve', '--root', tmp]);
  });
});
