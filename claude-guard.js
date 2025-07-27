#!/usr/bin/env node
/**
 * Claude Guard Community Edition v2.0.0
 * Simple security wrapper for Claude CLI
 */

import { spawn, execSync as exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Configuration
const CONFIG_DIR = join(homedir(), '.claude-guard');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const AUDIT_LOG = join(CONFIG_DIR, 'audit.log');

// Integrity verification
function verifyIntegrity() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const manifestPath = join(__dirname, 'INTEGRITY.json');
    if (!existsSync(manifestPath)) {
      console.warn('⚠️  Warning: No integrity verification file found');
      return true; // Don't block if verification file missing
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

// Ensure config directory exists
if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// Default configuration
const defaultConfig = {
  version: "2.0",
  policies: {
    blockedPaths: ["/etc/**", "/System/**", "/usr/**", "/bin/**", "/sbin/**"],
    blockedCommands: ["rm -rf /", "sudo rm", "dd if=", "mkfs", "format"],
    warnCommands: ["npm install", "pip install", "gem install", "cargo install"]
  },
  audit: {
    enabled: true,
    maxDays: 30
  },
  aliases: {
    "@test": "run all tests in this project",
    "@lint": "check code quality and style issues",
    "@build": "build the project for production",
    "@deploy": "deploy to production server"
  }
};

// Load configuration
let config = defaultConfig;
if (existsSync(CONFIG_FILE)) {
  try {
    const loaded = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    // Only use loaded config if it has the expected structure
    if (loaded.policies && loaded.policies.blockedCommands) {
      config = loaded;
    }
  } catch (e) {
    // Use defaults
  }
}

// Simple audit logging
function audit(event, details = {}) {
  if (!config.audit || !config.audit.enabled) return;
  
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details
  };
  
  try {
    appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Silent fail
  }
}

// Parse arguments
const args = process.argv.slice(2);

// Handle --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Claude Guard Community Edition

Usage: claude-guard [options] [prompt]

Options:
  --help, -h         Show this help
  --version, -v      Show version
  --config           Show config location
  --config-init      Create example config
  --audit-tail       Show last 10 audit entries
  --audit-search     Search audit logs
  --list-aliases     Show configured aliases
  --verify-integrity Check file integrity

Aliases:
  @<alias>           Use configured alias (e.g., @test)

Config: ${CONFIG_FILE}
Logs: ${AUDIT_LOG}
`);
  process.exit(0);
}

// Handle --version
if (args.includes('--version') || args.includes('-v')) {
  console.log('Claude Guard Community Edition v2.0.0');
  process.exit(0);
}

// Handle --config
if (args.includes('--config')) {
  console.log('Config:', CONFIG_FILE);
  process.exit(0);
}

// Handle --config-init
if (args.includes('--config-init')) {
  writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
  console.log('✅ Created example config at:', CONFIG_FILE);
  process.exit(0);
}

// Handle --list-aliases
if (args.includes('--list-aliases')) {
  console.log('\nConfigured aliases:');
  Object.entries(config.aliases || {}).forEach(([alias, command]) => {
    console.log(`  ${alias} → "${command}"`);
  });
  process.exit(0);
}

// Handle --audit-tail
if (args.includes('--audit-tail')) {
  try {
    const logs = readFileSync(AUDIT_LOG, 'utf8').trim().split('\n').slice(-10);
    console.log('\nLast 10 audit entries:');
    logs.forEach(log => {
      try {
        const entry = JSON.parse(log);
        console.log(`[${entry.timestamp}] ${entry.event}: ${entry.command || ''}`);
      } catch (e) {
        console.log(log);
      }
    });
  } catch (e) {
    console.log('No audit logs found');
  }
  process.exit(0);
}

// Handle --verify-integrity
if (args.includes('--verify-integrity')) {
  const isValid = verifyIntegrity();
  process.exit(isValid ? 0 : 1);
}

// Handle --audit-search
const searchIndex = args.indexOf('--audit-search');
if (searchIndex !== -1) {
  const searchTerm = args[searchIndex + 1];
  if (!searchTerm) {
    console.error('Please provide a search term');
    process.exit(1);
  }
  try {
    const logs = readFileSync(AUDIT_LOG, 'utf8').trim().split('\n');
    const matches = logs.filter(log => log.includes(searchTerm));
    console.log(`\nFound ${matches.length} matches for "${searchTerm}":`);
    matches.slice(-20).forEach(log => {
      try {
        const entry = JSON.parse(log);
        console.log(`[${entry.timestamp}] ${entry.event}: ${entry.command || ''}`);
      } catch (e) {
        console.log(log);
      }
    });
  } catch (e) {
    console.log('No audit logs found');
  }
  process.exit(0);
}

// Check Claude CLI
try {
  exec('which claude', { stdio: 'ignore' });
} catch (e) {
  console.error('❌ Claude CLI not found!');
  console.error('Install it first:');
  console.error('  npm install -g @anthropic-ai/claude-code');
  process.exit(1);
}

// Process aliases - expand @alias to full command
let processedArgs = args.map(arg => {
  if (arg.startsWith('@') && config.aliases && config.aliases[arg]) {
    console.log(`🔄 Expanding alias ${arg} → "${config.aliases[arg]}"`);
    return config.aliases[arg];
  }
  return arg;
});

// Check blocked commands
const command = processedArgs.join(' ');
audit('command_start', { command, pid: process.pid, originalCommand: args.join(' ') });

// Safety check - warn if in git repo root
if (existsSync('.git') && command.match(/rm|delete|remove|clean/i)) {
  console.warn('⚠️  WARNING: You are in a git repository root directory');
  console.warn('⚠️  This command might delete important files');
}

for (const blocked of config.policies.blockedCommands || []) {
  if (command.includes(blocked)) {
    console.error(`❌ Blocked: ${blocked}`);
    audit('command_blocked', { command, pattern: blocked });
    process.exit(1);
  }
}

// Check warn commands
for (const warn of config.policies.warnCommands || []) {
  if (command.includes(warn)) {
    console.warn(`⚠️  Warning: ${warn}`);
    audit('command_warning', { command, pattern: warn });
  }
}

// Run Claude
// If we have a command (not just flags), use print mode to avoid interactive issues
let claudeArgs = processedArgs;
if (processedArgs.length > 0 && !processedArgs[0].startsWith('-')) {
  // We have a prompt, use print mode if not already specified
  if (!processedArgs.includes('-p') && !processedArgs.includes('--print')) {
    claudeArgs = ['-p', ...processedArgs];
  }
}

const claude = spawn('claude', claudeArgs, { 
  stdio: 'inherit',
  env: { ...process.env, CLAUDE_GUARD_ACTIVE: 'true' }
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
