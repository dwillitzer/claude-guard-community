#!/usr/bin/env node
/**
 * Basic tests for Claude Guard Community Edition
 */

import { strict as assert } from 'assert';
import { test, describe } from 'node:test';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLAUDE_GUARD_PATH = join(__dirname, '..', 'claude-guard.js');

describe('Claude Guard Community Edition', () => {
  test('should show version', async () => {
    const result = await runCommand(['--version']);
    assert(result.stdout.includes('Claude Guard Community Edition v2.0.4'));
    assert.equal(result.code, 0);
  });

  test('should show help', async () => {
    const result = await runCommand(['--help']);
    assert(result.stdout.includes('Usage: claude-guard'));
    assert(result.stdout.includes('Options:'));
    assert.equal(result.code, 0);
  });

  test('should handle config commands', async () => {
    const result = await runCommand(['--config']);
    assert(result.stdout.includes('Config:'));
    assert(result.stdout.includes('.claude/guard/config.json'));
    assert.equal(result.code, 0);
  });

  test('should list default aliases', async () => {
    const result = await runCommand(['--list-aliases']);
    assert(result.stdout.includes('@test'));
    assert(result.stdout.includes('@build'));
    assert(result.stdout.includes('@lint'));
    assert.equal(result.code, 0);
  });

  test('should verify file structure', () => {
    assert(existsSync(CLAUDE_GUARD_PATH), 'claude-guard.js should exist');
    assert(existsSync(join(__dirname, '..', 'package.json')), 'package.json should exist');
    assert(existsSync(join(__dirname, '..', 'README.md')), 'README.md should exist');
    assert(existsSync(join(__dirname, '..', 'LICENSE')), 'LICENSE should exist');
  });

  test('should have correct package.json structure', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'claude-guard');
    assert.equal(pkg.version, '2.0.4');
    assert.equal(pkg.type, 'module');
    assert(pkg.bin['claude-guard']);
    assert(pkg.peerDependencies['@anthropic-ai/claude-code']);
  });
});

/**
 * Helper function to run claude-guard commands
 */
function runCommand(args) {
  return new Promise((resolve) => {
    const child = spawn('node', [CLAUDE_GUARD_PATH, ...args], {
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}
