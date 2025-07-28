#!/usr/bin/env node

/**
 * Test Runner for Claude Guard
 */

import { execSync } from 'child_process';

console.log('🧪 Running Claude Guard Test Suite\n');

try {
  // Run unit tests
  console.log('📦 Running Unit Tests...');
  execSync('node test/unit.test.js', { stdio: 'inherit' });
  
  console.log('\n✅ All tests completed successfully!');
  process.exit(0);
} catch (error) {
  console.log('\n❌ Tests failed!');
  process.exit(1);
}