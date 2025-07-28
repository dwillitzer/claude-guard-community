#!/usr/bin/env node


import { spawn, execSync as exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Configuration
const CONFIG_DIR = join(homedir(), '.claude', 'guard');
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
    blockedPaths: ["/etc", "/usr/bin/rm", "/usr/bin/dd"],
    allowedCommands: ["*"],
    blockedCommands: [
      "rm -rf /",
      "rm -rf /*", 
      "dd if=/dev/zero of=/dev/*",
      "mkfs.*",
      "format *",
      "sudo rm -rf /",
      "sudo chmod 777 /etc/passwd",
      "sudo chmod 777 /etc/shadow",
      ":(){ :|:& };:",
      "sudo dd if=/dev/zero of=/dev/sda*",
      "shutdown -h now",
      "reboot",
      "init 0",
      "killall -9 *"
    ],
    warnCommands: [
      "rm -rf *",
      "sudo *",
      "chmod 777 *",
      "chown * /",
      "mv * /dev/null",
      "cp * /dev/null"
    ],
    maxCommandLength: 1000,
    allowShellExpansion: false,
    requireConfirmation: ["rm -rf *", "sudo *"]
  },
  aliases: {
    "@test": "npm test",
    "@build": "npm run build", 
    "@lint": "npm run lint"
  },
  security: {
    enableSandbox: true,
    timeoutSeconds: 300,
    maxMemoryMB: 1024,
    allowNetworkAccess: true,
    logAllCommands: true
  }
};

// Command matching utility class
class CommandMatcher {
  // Simple wildcard matching
  match(command, pattern) {
    if (!pattern || pattern === '*') return true;
    if (!command) return false;
    
    const normalizedCommand = command.toLowerCase();
    const normalizedPattern = pattern.toLowerCase();
    
    // For exact matches without wildcards, use simple string comparison
    if (!normalizedPattern.includes('*')) {
      return normalizedCommand === normalizedPattern || normalizedCommand.includes(normalizedPattern);
    }
    
    // For wildcard patterns, escape special regex characters except *
    const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      
    try {
      const regex = new RegExp(`^${escaped}$`);
      return regex.test(normalizedCommand);
    } catch (e) {
      // Fallback: split on * and check all parts exist
      const parts = normalizedPattern.split('*').filter(p => p.length > 0);
      return parts.every(part => normalizedCommand.includes(part));
    }
  }

  // Extract tool and pattern from claude-settings format like 'Bash(git *)' 
  extractToolPattern(patternStr) {
    if (!patternStr) return { tool: null, pattern: patternStr };
    
    // Use simple string matching instead of regex
    const trimmed = patternStr.trim();
    const openParen = trimmed.indexOf('(');
    const closeParen = trimmed.lastIndexOf(')');
    
    // Only treat as tool(pattern) format if it looks like a valid tool name
    // Tool names should be alphanumeric and start at the beginning
    if (openParen > 0 && closeParen > openParen && /^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed.substring(0, openParen))) {
      const tool = trimmed.substring(0, openParen);
      const pattern = trimmed.substring(openParen + 1, closeParen);
      return { tool, pattern };
    }
    
    return { tool: null, pattern: patternStr };
  }

  // Parse complex command structures into individual commands
  parseComplexCommand(command) {
    if (!command) return [];
    
    const commands = [];
    
    // Split on pipes, semicolons, and && operators
    const parts = command.split(/\s*[|;&]\s*|\s*&&\s*/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        commands.push(trimmed);
        
        // Also check for command substitution and subshells
        const subCommands = this.extractSubCommands(trimmed);
        commands.push(...subCommands);
      }
    }
    
    return commands.filter(cmd => cmd.length > 0);
  }

  // Extract commands from $() and backtick substitution
  extractSubCommands(command) {
    const subCommands = [];
    
    // Match $(command) patterns
    const dollarMatches = command.match(/\$\(([^)]+)\)/g);
    if (dollarMatches) {
      for (const match of dollarMatches) {
        const inner = match.slice(2, -1).trim();
        if (inner) subCommands.push(inner);
      }
    }
    
    // Match `command` patterns
    const backtickMatches = command.match(/`([^`]+)`/g);
    if (backtickMatches) {
      for (const match of backtickMatches) {
        const inner = match.slice(1, -1).trim();
        if (inner) subCommands.push(inner);
      }
    }
    
    return subCommands;
  }

  // Enhanced match method that handles complex commands and claude-settings syntax
  matchCommand(command, pattern) {
    if (!command || !pattern) return false;
    
    // Extract tool-specific pattern
    const { tool, pattern: actualPattern } = this.extractToolPattern(pattern);
    
    // Parse complex command structures
    const allCommands = this.parseComplexCommand(command);
    allCommands.push(command); // Also check the full command
    
    // Check if any command or sub-command matches the pattern
    for (const cmd of allCommands) {
      if (this.match(cmd, actualPattern)) {
        return true;
      }
    }
    
    return false;
  }
}

// Load configuration
let config = defaultConfig;
try {
  if (existsSync(CONFIG_FILE)) {
    const userConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...defaultConfig, ...userConfig };
  }
} catch (error) {
  console.warn('⚠️  Warning: Could not load config file, using defaults');
}

// Audit logging function
function audit(action, details = {}) {
  const timestamp = new Date().toISOString();
  const entry = JSON.stringify({ timestamp, action, ...details });
  try {
    appendFileSync(AUDIT_LOG, entry + '\n');
  } catch (error) {
    // Ignore audit failures to avoid blocking the command
  }
}

// Process arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Claude Guard Community Edition v2.0.4');
  console.log('Usage: claude-guard [options] <prompt>');
  console.log('\nOptions:');
  console.log('  --version       Show version');
  console.log('  --help          Show help');
  console.log('  --config        Show configuration');
  console.log('  --list-aliases  List command aliases');
  console.log('  --audit-tail    Show last 10 audit entries');
  console.log('  --audit-search  Search audit logs');
  process.exit(0);
}

// Handle special flags
if (args[0] === '--version') {
  console.log('Claude Guard Community Edition v2.0.4');
  process.exit(0);
}

if (args[0] === '--help') {
  console.log('Claude Guard Community Edition v2.0.4');
  console.log('Usage: claude-guard [options] <prompt>');
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

// Handle --audit-tail
if (args.includes('--audit-tail')) {
  try {
    const logs = readFileSync(AUDIT_LOG, 'utf8').trim().split('\n').slice(-10);
    console.log('\nLast 10 audit entries:');
    logs.forEach(log => {
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

// Process command
let processedArgs = [...args];

// Check blocked commands
const command = processedArgs.join(' ');
audit('command_start', { command, pid: process.pid, originalCommand: args.join(' ') });

// Security validation checks
if (config.policies.maxCommandLength && command.length > config.policies.maxCommandLength) {
  console.error(`❌ Command too long: ${command.length} characters (max: ${config.policies.maxCommandLength})`);
  audit('command_blocked', { command, reason: 'command_too_long' });
  process.exit(1);
}

// Check for shell expansion if disabled
if (!config.policies.allowShellExpansion && command.match(/[`$(){}[\]|&;<>*?~]/)) {
  console.error('❌ Shell expansion and special characters are disabled');
  audit('command_blocked', { command, reason: 'shell_expansion_disabled' });
  process.exit(1);
}

// Safety check - warn if in git repo root
if (existsSync('.git') && command.match(/rm|delete|remove|clean/i)) {
  console.warn('⚠️  WARNING: You are in a git repository root directory');
  console.warn('⚠️  This command might delete important files');
}

const matcher = new CommandMatcher();

for (const blocked of config.policies.blockedCommands || []) {
  if (matcher.matchCommand(command, blocked)) {
    console.error(`❌ Blocked: ${blocked}`);
    audit('command_blocked', { command, pattern: blocked });
    process.exit(1);
  }
}

// Check warn commands
for (const warn of config.policies.warnCommands || []) {
  if (matcher.matchCommand(command, warn)) {
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
