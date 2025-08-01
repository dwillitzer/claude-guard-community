#!/usr/bin/env node

import { spawn, execSync as exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
const CONFIG_DIR = join(homedir(), '.claude', 'guard');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const AUDIT_LOG = join(CONFIG_DIR, 'audit.log');
const CLAUDE_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json');
const CLAUDE_PROJECT_SETTINGS = join(process.cwd(), '.claude', 'settings.json');

function verifyIntegrity() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const manifestPath = join(__dirname, 'INTEGRITY.json');
    if (!existsSync(manifestPath)) {
      console.warn('⚠️  Warning: No integrity verification file found');
      return true;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    let verified = 0;
    let total = 0;

    for (const [file, expected] of Object.entries(manifest.files)) {
      total++;
      const filePath = join(__dirname, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath);
        const actualHash = crypto.createHash('sha256').update(content).digest('hex');
        if (actualHash === expected.sha256) {
          verified++;
        } else {
          console.error(`❌ Integrity check failed for ${file}`);
          console.error(`   Expected: ${expected.sha256}`);
          console.error(`   Actual:   ${actualHash}`);
          return false;
        }
      } else {
        console.error(`❌ Missing file: ${file}`);
        return false;
      }
    }

    console.log(`✅ Integrity verified (${verified}/${total} files)`);
    return true;
  } catch (error) {
    console.error('❌ Integrity verification failed:', error.message);
    return false;
  }
}

// Load Claude native settings
function loadClaudeSettings() {
  let claudeSettings = { allow: [], deny: [] };

  const settingsFiles = [CLAUDE_PROJECT_SETTINGS, CLAUDE_SETTINGS_FILE];

  for (const settingsFile of settingsFiles) {
    try {
      if (existsSync(settingsFile)) {
        const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
        if (settings.permissions) {
          claudeSettings.allow = [...claudeSettings.allow, ...(settings.permissions.allow || [])];
          claudeSettings.deny = [...claudeSettings.deny, ...(settings.permissions.deny || [])];
        }
        console.log(`📋 Loaded Claude settings from: ${settingsFile}`);
        break;
      }
    } catch (error) {
      console.warn(`⚠️  Warning: Could not load Claude settings from ${settingsFile}`);
    }
  }

  return claudeSettings;
}

if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

const defaultConfig = {
  version: '2.0',
  policies: {
    blockedPaths: ['/etc', '/usr/bin/rm', '/usr/bin/dd'],
    allowedCommands: ['*'],
    blockedCommands: [
      'rm -rf /',
      'rm -rf /*',
      'dd if=/dev/zero of=/dev/*',
      'mkfs.*',
      'format *',
      'sudo rm -rf /',
      'sudo chmod 777 /etc/passwd',
      'sudo chmod 777 /etc/shadow',
      ':(){ :|:& };:',
      'sudo dd if=/dev/zero of=/dev/sda*',
      'shutdown -h now',
      'reboot',
      'init 0',
      'killall -9 *',
    ],
    warnCommands: ['rm -rf *', 'sudo *', 'chmod 777 *', 'chown * /', 'mv * /dev/null', 'cp * /dev/null'],
    maxCommandLength: 1000,
    allowShellExpansion: false,
    requireConfirmation: ['rm -rf *', 'sudo *'],
    useClaudeSettings: true,
    claudeSettingsFirst: true,
  },
  aliases: {
    '@test': 'npm test',
    '@build': 'npm run build',
    '@lint': 'npm run lint',
  },
  security: {
    enableSandbox: true,
    timeoutSeconds: 300,
    maxMemoryMB: 1024,
    allowNetworkAccess: true,
    logAllCommands: true,
  },
};

class CommandMatcher {
  match(command, pattern) {
    if (!pattern || pattern === '*') return true;
    if (!command) return false;

    const normalizedCommand = command.toLowerCase();
    const normalizedPattern = pattern.toLowerCase();

    if (!normalizedPattern.includes('*')) {
      return normalizedCommand === normalizedPattern || normalizedCommand.includes(normalizedPattern);
    }

    const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    try {
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(normalizedCommand);
    } catch (e) {
      const parts = normalizedPattern.split('*').filter((p) => p.length > 0);
      return parts.every((part) => normalizedCommand.includes(part));
    }
  }

  extractToolPattern(patternStr) {
    if (!patternStr) return { tool: null, pattern: patternStr };

    const trimmed = patternStr.trim();
    const openParen = trimmed.indexOf('(');
    const closeParen = trimmed.lastIndexOf(')');

    if (openParen > 0 && closeParen > openParen && /^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed.substring(0, openParen))) {
      const tool = trimmed.substring(0, openParen);
      const pattern = trimmed.substring(openParen + 1, closeParen);
      return { tool, pattern };
    }

    return { tool: null, pattern: patternStr };
  }

  parseComplexCommand(command) {
    if (!command) return [];

    const commands = [];

    const parts = command.split(/\s*[|;&]\s*|\s*&&\s*/);

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        commands.push(trimmed);

        const subCommands = this.extractSubCommands(trimmed);
        commands.push(...subCommands);
      }
    }

    return commands.filter((cmd) => cmd.length > 0);
  }

  extractSubCommands(command) {
    const subCommands = [];

    const dollarMatches = command.match(/\$\(([^)]+)\)/g);
    if (dollarMatches) {
      for (const match of dollarMatches) {
        const inner = match.slice(2, -1).trim();
        if (inner) subCommands.push(inner);
      }
    }

    const backtickMatches = command.match(/`([^`]+)`/g);
    if (backtickMatches) {
      for (const match of backtickMatches) {
        const inner = match.slice(1, -1).trim();
        if (inner) subCommands.push(inner);
      }
    }

    return subCommands;
  }

  matchCommand(command, pattern) {
    if (!command || !pattern) return false;

    const { tool, pattern: actualPattern } = this.extractToolPattern(pattern);

    const allCommands = this.parseComplexCommand(command);
    allCommands.push(command);

    for (const cmd of allCommands) {
      if (this.match(cmd, actualPattern)) {
        return true;
      }
    }

    return false;
  }

  matchClaudeSettings(toolCall, patterns) {
    if (!patterns || !Array.isArray(patterns)) return false;

    const toolPattern = `Bash(${toolCall})`;

    for (const pattern of patterns) {
      if (pattern === toolPattern) return true;

      const { tool, pattern: actualPattern } = this.extractToolPattern(pattern);

      if (!tool || tool === 'Bash') {
        if (this.matchCommand(toolCall, actualPattern || pattern)) {
          return true;
        }
      }
    }

    return false;
  }
}

let config = defaultConfig;
try {
  if (existsSync(CONFIG_FILE)) {
    const userConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...defaultConfig, ...userConfig };
  }
} catch (error) {
  console.warn('⚠️  Warning: Could not load config file, using defaults');
}

// Load Claude native settings
let claudeSettings = { allow: [], deny: [] };
if (config.policies.useClaudeSettings) {
  claudeSettings = loadClaudeSettings();
}

function audit(action, details = {}) {
  const timestamp = new Date().toISOString();
  const entry = JSON.stringify({ timestamp, action, ...details });
  try {
    appendFileSync(AUDIT_LOG, entry + '\n');
  } catch (error) {}
}

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '-p')) {
  console.log('Claude Guard Community Edition v2.1.1');
  console.log('Starting interactive session...\n');

  const claude = spawn('claude', args.length === 1 && args[0] === '-p' ? ['-p'] : [], {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_GUARD_ACTIVE: 'true' },
  });

  claude.on('error', (err) => {
    console.error('❌ Failed to start Claude:', err.message);
    audit('interactive_session_error', { error: err.message });
    process.exit(1);
  });

  claude.on('exit', (code) => {
    audit('interactive_session_end', { exitCode: code });
    process.exit(code || 0);
  });
} else {
  if (args[0] === '--version') {
    console.log('Claude Guard Community Edition v2.1.1');
    process.exit(0);
  }

  if (args[0] === '--help') {
    console.log('Claude Guard Community Edition v2.1.1');
    console.log('Usage: claude-guard [options] <prompt>');
    console.log('       claude-guard                    # Start interactive session');
    console.log('\nOptions:');
    console.log('  --version       Show version');
    console.log('  --help          Show help');
    console.log('  --config        Show configuration');
    console.log('  --list-aliases  List command aliases');
    console.log('  --audit-tail    Show last 10 audit entries');
    console.log('  --audit-search  Search audit logs');
    process.exit(0);
  }

  if (args[0] === '--config') {
    console.log('Config:', JSON.stringify(config, null, 2));
    console.log('Config file:', CONFIG_FILE);
    process.exit(0);
  }

  if (args[0] === '--list-aliases') {
    console.log('Available aliases:');
    for (const [alias, command] of Object.entries(config.aliases || {})) {
      console.log(`  ${alias}: ${command}`);
    }
    process.exit(0);
  }

  if (args.includes('--audit-tail')) {
    try {
      const logs = readFileSync(AUDIT_LOG, 'utf8').trim().split('\n').slice(-10);
      console.log('\nLast 10 audit entries:');
      logs.forEach((log) => {
        try {
          const entry = JSON.parse(log);
          console.log(`[${entry.timestamp}] ${entry.action}: ${entry.command || ''}`);
        } catch (e) {
          console.log(log);
        }
      });
    } catch (e) {
      console.log('No audit logs found');
    }
    process.exit(0);
  }

  const searchIndex = args.indexOf('--audit-search');
  if (searchIndex !== -1) {
    const searchTerm = args[searchIndex + 1];
    if (!searchTerm) {
      console.error('Please provide a search term');
      process.exit(1);
    }
    try {
      const logs = readFileSync(AUDIT_LOG, 'utf8').trim().split('\n');
      const matches = logs.filter((log) => log.includes(searchTerm));
      console.log(`\nFound ${matches.length} matches for "${searchTerm}":`);
      matches.slice(-20).forEach((log) => {
        try {
          const entry = JSON.parse(log);
          console.log(`[${entry.timestamp}] ${entry.action}: ${entry.command || ''}`);
        } catch (e) {
          console.log(log);
        }
      });
    } catch (e) {
      console.log('Error reading audit logs');
    }
    process.exit(0);
  }

  let processedArgs = [...args];

  const command = processedArgs.join(' ');
  audit('command_start', { command, pid: process.pid, originalCommand: args.join(' ') });

  if (config.policies.maxCommandLength && command.length > config.policies.maxCommandLength) {
    console.error(`❌ Command too long: ${command.length} characters (max: ${config.policies.maxCommandLength})`);
    audit('command_blocked', { command, reason: 'command_too_long' });
    process.exit(1);
  }

  if (!config.policies.allowShellExpansion && command.match(/[`$(){}[\]|&;<>*?~]/)) {
    console.error('❌ Shell expansion and special characters are disabled');
    audit('command_blocked', { command, reason: 'shell_expansion_disabled' });
    process.exit(1);
  }

  if (existsSync('.git') && command.match(/rm|delete|remove|clean/i)) {
    console.warn('⚠️  WARNING: You are in a git repository root directory');
    console.warn('⚠️  This command might delete important files');
  }

  const matcher = new CommandMatcher();

  if (config.policies.useClaudeSettings && config.policies.claudeSettingsFirst) {
    if (matcher.matchClaudeSettings(command, claudeSettings.deny)) {
      const matchedPattern = claudeSettings.deny.find((pattern) => matcher.matchClaudeSettings(command, [pattern]));
      console.error(`❌ Blocked by Claude settings: ${matchedPattern}`);
      audit('command_blocked', { command, pattern: matchedPattern, source: 'claude_settings' });
      process.exit(1);
    }

    const allowedByClaude = matcher.matchClaudeSettings(command, claudeSettings.allow);
    if (allowedByClaude) {
      console.log('✅ Allowed by Claude settings');
      audit('command_allowed', { command, source: 'claude_settings' });
    } else {
      for (const blocked of config.policies.blockedCommands || []) {
        if (matcher.matchCommand(command, blocked)) {
          console.error(`❌ Blocked by guard pattern: ${blocked}`);
          audit('command_blocked', { command, pattern: blocked, source: 'guard_pattern' });
          process.exit(1);
        }
      }
    }
  } else {
    for (const blocked of config.policies.blockedCommands || []) {
      if (matcher.matchCommand(command, blocked)) {
        console.error(`❌ Blocked: ${blocked}`);
        audit('command_blocked', { command, pattern: blocked, source: 'guard_pattern' });
        process.exit(1);
      }
    }
  }

  for (const warn of config.policies.warnCommands || []) {
    if (matcher.matchCommand(command, warn)) {
      console.warn(`⚠️  Warning: ${warn}`);
      audit('command_warning', { command, pattern: warn });
    }
  }

  let claudeArgs = processedArgs;

  const claude = spawn('claude', claudeArgs, {
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_GUARD_ACTIVE: 'true' },
  });

  claude.on('error', (err) => {
    console.error('❌ Failed:', err.message);
    audit('command_error', { error: err.message });
    process.exit(1);
  });

  claude.on('exit', (code) => {
    audit('command_end', { exitCode: code });
    process.exit(code || 0);
  });
}
