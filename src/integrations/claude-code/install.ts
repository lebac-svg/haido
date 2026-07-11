import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Installers (SPEC §8): idempotent, merge-friendly, and they back up whatever
 * they touch (<file>.bak-haido) instead of asking interactive questions.
 * `command` is the launcher argv (default ['haido']); override for dev/dogfood:
 *   haido install claude-code --command node "C:\path\dist\cli.js"
 */
export interface InstallResult {
  wrote: string[];
  notes: string[];
}

const HOOK_MARK = 'haido hook';

function quoteJoin(parts: string[]): string {
  return parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonWithBackup(file: string, data: unknown, wrote: string[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak-haido`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  wrote.push(file);
}

export function installClaudeCode(opts: {
  root: string;
  command?: string[];
  globalSettings?: boolean;
}): InstallResult {
  const cmd = opts.command ?? ['haido'];
  const wrote: string[] = [];
  const notes: string[] = [];

  // 1) hooks -> .claude/settings.json (project) or ~/.claude/settings.json (--global)
  const settingsPath = opts.globalSettings
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(opts.root, '.claude', 'settings.json');
  const settings = readJson(settingsPath);
  const hooks = (settings['hooks'] ??= {}) as Record<string, unknown[]>;

  const ensureHook = (event: string, matcher: string | null, hookCmd: string): void => {
    const entries = (hooks[event] ??= []) as Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string }>;
    }>;
    const exists = entries.some((e) =>
      (e.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARK)),
    );
    if (exists) {
      notes.push(`${event}: haido hook already present — left as is`);
      return;
    }
    entries.push({
      ...(matcher !== null ? { matcher } : {}),
      hooks: [{ type: 'command', command: hookCmd }],
    });
  };

  ensureHook('SessionStart', null, quoteJoin([...cmd, 'hook', 'session-start']));
  ensureHook('PostToolUse', 'Read|Edit|Write|MultiEdit', quoteJoin([...cmd, 'hook', 'post-tool']));
  ensureHook('Stop', null, quoteJoin([...cmd, 'hook', 'stop']));
  writeJsonWithBackup(settingsPath, settings, wrote);

  // 2) MCP server -> .mcp.json (project scope, picked up by Claude Code)
  const mcpPath = path.join(opts.root, '.mcp.json');
  const mcp = readJson(mcpPath);
  const servers = (mcp['mcpServers'] ??= {}) as Record<string, unknown>;
  servers['haido'] = { command: cmd[0], args: [...cmd.slice(1), 'serve'] };
  writeJsonWithBackup(mcpPath, mcp, wrote);

  notes.push('restart your Claude Code session so hooks + MCP are picked up');
  return { wrote, notes };
}

export function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    return path.join(
      process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

export function installClaudeDesktop(opts: {
  root: string;
  command?: string[];
  configPath?: string;
}): InstallResult {
  const cmd = opts.command ?? ['haido'];
  const wrote: string[] = [];
  const file = opts.configPath ?? claudeDesktopConfigPath();
  const config = readJson(file);
  const servers = (config['mcpServers'] ??= {}) as Record<string, unknown>;
  const name = `haido-${path.basename(opts.root)}`;
  // Desktop does not run inside the repo -> pin the project root via --root
  servers[name] = { command: cmd[0], args: [...cmd.slice(1), 'serve', '--root', opts.root] };
  writeJsonWithBackup(file, config, wrote);
  return {
    wrote,
    notes: [
      `registered MCP server '${name}' (recall on demand — Desktop has no hooks)`,
      'restart Claude Desktop to load it',
    ],
  };
}
