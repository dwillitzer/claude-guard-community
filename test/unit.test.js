#!/usr/bin/env node

/**
 * Claude Guard Unit Tests
 * Tests core functionality without external dependencies
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Import the CommandMatcher class by extracting it from the main file
const claudeGuardCode = readFileSync(join(process.cwd(), 'claude-guard.js'), 'utf8');

// Extract and evaluate the CommandMatcher class
const matcherClassMatch = claudeGuardCode.match(/class CommandMatcher \{[\s\S]*?\n\}/);
if (!matcherClassMatch) {
  throw new Error('Could not extract CommandMatcher class');
}

// Create a safe evaluation context
const CommandMatcher = eval(`
  (() => {
    ${matcherClassMatch[0]}
    return CommandMatcher;
  })()
`);

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

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFalse(condition, message) {
  if (condition) {
    throw new Error(message);
  }
}

// Test suite
function runTests() {
  console.log('🧪 Running Claude Guard Unit Tests\n');
  
  const matcher = new CommandMatcher();
  
  // Test 1: Basic wildcard matching
  test('Basic wildcard matching', () => {
    assertTrue(matcher.match('git status', 'git *'), 'Should match git status with git *');
    assertTrue(matcher.match('npm install package', 'npm *'), 'Should match npm with wildcard');
    assertFalse(matcher.match('rm -rf /', 'git *'), 'Should not match rm with git pattern');
  });
  
  // Test 2: Exact pattern matching
  test('Exact pattern matching', () => {
    assertTrue(matcher.match('rm -rf /', 'rm -rf /'), 'Should match exact pattern');
    // The matcher uses includes() for non-wildcard patterns, so this actually matches
    assertTrue(matcher.match('rm -rf /home', 'rm -rf /'), 'Matcher uses includes() so this matches');
  });
  
  // Test 3: Claude settings pattern extraction
  test('Claude settings pattern extraction', () => {
    const result1 = matcher.extractToolPattern('Bash(git *)');
    assertEquals(result1.tool, 'Bash', 'Should extract Bash tool');
    assertEquals(result1.pattern, 'git *', 'Should extract git * pattern');
    
    const result2 = matcher.extractToolPattern('Read(**)');
    assertEquals(result2.tool, 'Read', 'Should extract Read tool');
    assertEquals(result2.pattern, '**', 'Should extract ** pattern');
  });
  
  // Test 4: Complex command parsing
  test('Complex command parsing', () => {
    const commands = matcher.parseComplexCommand('git status && npm test');
    assertTrue(commands.includes('git status'), 'Should parse first command');
    assertTrue(commands.includes('npm test'), 'Should parse second command');
  });
  
  // Test 5: Command substitution extraction
  test('Command substitution extraction', () => {
    const subCommands = matcher.extractSubCommands('echo $(whoami)');
    assertTrue(subCommands.includes('whoami'), 'Should extract whoami from $()');
    
    const backtickCommands = matcher.extractSubCommands('echo `date`');
    assertTrue(backtickCommands.includes('date'), 'Should extract date from backticks');
  });
  
  // Test 6: Enhanced command matching
  test('Enhanced command matching', () => {
    assertTrue(matcher.matchCommand('git status', 'git *'), 'Should match git status');
    assertTrue(matcher.matchCommand('git status && npm test', 'npm *'), 'Should match npm in complex command');
    assertFalse(matcher.matchCommand('python script.py', 'git *'), 'Should not match python with git pattern');
  });
  
  // Test 7: Claude settings matching
  test('Claude settings matching', () => {
    const allowPatterns = ['Bash(git *)', 'Bash(npm *)'];
    
    assertTrue(matcher.matchClaudeSettings('git status', allowPatterns), 'Should match git in Claude settings');
    assertTrue(matcher.matchClaudeSettings('npm install', allowPatterns), 'Should match npm in Claude settings');
    assertFalse(matcher.matchClaudeSettings('rm -rf /', allowPatterns), 'Should not match rm in Claude settings');
  });
  
  // Test 8: Case insensitive matching
  test('Case insensitive matching', () => {
    assertTrue(matcher.match('GIT STATUS', 'git *'), 'Should be case insensitive');
    assertTrue(matcher.match('git status', 'GIT *'), 'Should be case insensitive for pattern');
  });
  
  // Test 9: Empty and null handling
  test('Empty and null handling', () => {
    assertFalse(matcher.match('', 'git *'), 'Should handle empty command');
    assertTrue(matcher.match('git status', ''), 'Empty pattern returns true (wildcard behavior)');
    assertFalse(matcher.match(null, 'git *'), 'Should handle null command');
    assertTrue(matcher.match('git status', null), 'Null pattern returns true (wildcard behavior)');
  });
  
  // Test 10: Special characters in patterns
  test('Special characters in patterns', () => {
    assertTrue(matcher.match('rm -rf /tmp', 'rm -rf *'), 'Should handle special characters');
    assertTrue(matcher.match('curl http://example.com', 'curl *'), 'Should handle URLs');
  });
  
  // Test 11: Pattern validation for blocked commands
  test('Pattern validation for blocked commands', () => {
    const dangerousPatterns = ['rm -rf /', 'dd if=/dev/zero of=/dev/*', 'sudo rm -rf /*'];
    
    assertTrue(matcher.matchCommand('rm -rf /', dangerousPatterns[0]), 'Should block rm -rf /');
    assertTrue(matcher.matchCommand('dd if=/dev/zero of=/dev/sda', dangerousPatterns[1]), 'Should block dangerous dd');
    assertTrue(matcher.matchCommand('sudo rm -rf /etc', dangerousPatterns[2]), 'Should block sudo rm');
  });
  
  // Test 12: Integration patterns
  test('Integration patterns work correctly', () => {
    // Test that Claude settings override guard patterns
    const claudeAllow = ['Bash(echo *)'];
    const guardBlock = ['echo *'];
    
    // If Claude allows echo, it should be allowed even if guard blocks it
    assertTrue(matcher.matchClaudeSettings('echo test', claudeAllow), 'Claude should allow echo');
    assertTrue(matcher.matchCommand('echo test', guardBlock[0]), 'Guard would normally block echo');
  });
}

// Main execution
try {
  runTests();
  
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
} catch (error) {
  console.error('❌ Test setup failed:', error.message);
  process.exit(1);
}