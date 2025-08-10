// debug-beforechange.js (or .ts)
// Run this with: node debug-beforechange.js (or ts-node if TypeScript)

import { proxy } from './src/index.js'; // Adjust path to your built library

console.log('🔍 Debugging beforeChange behavior...\n');

// Create a plugin that should prevent invalid email changes
const validationPlugin = {
  id: 'debug-validation',
  
  transformSet: (path, value) => {
    const fieldName = path[path.length - 1]?.toString();
    console.log(`[TRANSFORM] transformSet called: field=${fieldName}, value=${JSON.stringify(value)}`);
    
    if (fieldName === 'email' && typeof value === 'string' && value.includes('@')) {
      const result = value.toLowerCase().trim();
      console.log(`[TRANSFORM] Normalizing email: ${value} → ${result}`);
      return result;
    }
    
    console.log(`[TRANSFORM] No transformation applied`);
    return undefined;
  },
  
  beforeChange: (path, value, prevValue, state) => {
    const fieldName = path[path.length - 1]?.toString();
    console.log(`[BEFORE] beforeChange called:`);
    console.log(`  - field: ${fieldName}`);
    console.log(`  - new value: ${JSON.stringify(value)}`);
    console.log(`  - prev value: ${JSON.stringify(prevValue)}`);
    console.log(`  - path: ${JSON.stringify(path)}`);
    
    if (fieldName === 'email' && typeof value === 'string') {
      if (!value.includes('@')) {
        console.log(`[BEFORE] ❌ INVALID EMAIL - Returning FALSE to prevent change`);
        return false;
      }
    }
    
    console.log(`[BEFORE] ✅ Valid change - Returning TRUE to allow`);
    return true;
  },
  
  afterChange: (path, value, state) => {
    console.log(`[AFTER] afterChange called: ${JSON.stringify(path)} = ${JSON.stringify(value)}`);
    console.log(`[AFTER] ⚠️  THIS SHOULD NOT BE CALLED IF CHANGE WAS PREVENTED!\n`);
  }
};

console.log('Creating instance and adding plugin...');
const instance = proxy.createInstance();
instance.use(validationPlugin);

console.log('Creating store with initial valid email...');
const store = instance({ 
  email: 'initial@example.com',
  name: 'Test User'
});

console.log(`Initial store.email: ${store.email}\n`);

// Test 1: Valid email change (should work and be transformed)
console.log('='.repeat(60));
console.log('TEST 1: Setting VALID email (should work + transform)');
console.log('='.repeat(60));
console.log('Calling: store.email = "  VALID@EXAMPLE.COM  "');

store.email = '  VALID@EXAMPLE.COM  ';

console.log(`Result: store.email = "${store.email}"`);
console.log(`Expected: "valid@example.com" (normalized)`);
console.log(`Actual result: ${store.email === 'valid@example.com' ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 2: Invalid email change (should be prevented)
console.log('='.repeat(60));
console.log('TEST 2: Setting INVALID email (should be PREVENTED)');
console.log('='.repeat(60));
console.log('Calling: store.email = "invalid-email"');

const previousEmail = store.email;
console.log(`Email before change: "${previousEmail}"`);

store.email = 'invalid-email';

console.log(`Email after change: "${store.email}"`);
console.log(`Expected: "${previousEmail}" (unchanged)`);
console.log(`Actual result: ${store.email === previousEmail ? '✅ PASS - Change was prevented!' : '❌ FAIL - Change was NOT prevented!'}\n`);

// Test 3: Try a non-email field to make sure plugin doesn't interfere
console.log('='.repeat(60));
console.log('TEST 3: Setting non-email field (should work normally)');
console.log('='.repeat(60));
console.log('Calling: store.name = "New Name"');

store.name = 'New Name';

console.log(`Result: store.name = "${store.name}"`);
console.log(`Expected: "New Name"`);
console.log(`Actual result: ${store.name === 'New Name' ? '✅ PASS' : '❌ FAIL'}\n`);

// Summary
console.log('='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log('If beforeChange is working correctly, you should see:');
console.log('1. ✅ Test 1 passes (valid email normalized)');
console.log('2. ✅ Test 2 passes (invalid email rejected)');
console.log('3. ✅ Test 3 passes (non-email field works)');
console.log('4. ❌ NO "afterChange called" logs for the invalid email');
console.log('');
console.log('If beforeChange is NOT working:');
console.log('- Test 2 will fail (invalid email will be set)');
console.log('- You will see "afterChange called" for the invalid email');
console.log('');

// Final state check
console.log('Final store state:');
console.log(`  email: "${store.email}"`);
console.log(`  name: "${store.name}"`);

console.log('\n🔍 Debug complete. Check the logs above to see what happened!');