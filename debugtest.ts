// Debug test script - add this to a separate file like debug-test.ts
import { proxy, type ValtioPlugin } from './src'; // adjust path as needed

// Helper to check if something is a proxy
function isProxy(obj: any): boolean {
  try {
    // Try to get proxy state - this will throw for non-proxies
    const snap = JSON.stringify(obj);
    return obj !== JSON.parse(snap);
  } catch {
    return false;
  }
}

// Simple version of isProxy that just checks if the object has Valtio's internal state
function isProxySimple(obj: any): boolean {
  try {
    return obj && typeof obj === 'object' && '__valtio_state' in obj;
  } catch {
    return false;
  }
}

console.log('=== Starting debug test ===');

const plugin: ValtioPlugin = {
  id: 'dynamic-no-proxy',
  canProxy: (value) => {
    console.log('[PLUGIN] canProxy called with:', value);
    if (value && typeof value === 'object' && 'noProxy' in value) {
      console.log('[PLUGIN] Returning false for noProxy object');
      return false;
    }
    console.log('[PLUGIN] Returning undefined (no opinion)');
    return undefined;
  }
};

console.log('Creating instance...');
const instance = proxy.createInstance();

console.log('Adding plugin to instance...');
instance.use(plugin);

console.log('Creating initial store...');
const store = instance({
  data: {}
});

console.log('store.data is proxy?', isProxy(store.data));

console.log('=== Adding normal object ===');
store.data.proxied = { value: 'should be proxied' };

console.log('=== Adding noProxy object ===');
store.data.notProxied = { noProxy: true, value: 'should not be proxied' };

console.log('Final results:');
console.log('store.data.proxied is proxy?', isProxy(store.data.proxied));
console.log('store.data.notProxied is proxy?', isProxy(store.data.notProxied));

console.log('=== Expected vs Actual ===');
console.log('Expected store.data.proxied to be proxy: true');
console.log('Actual store.data.proxied is proxy:', isProxy(store.data.proxied));
console.log('Expected store.data.notProxied to be proxy: false');
console.log('Actual store.data.notProxied is proxy:', isProxy(store.data.notProxied));

if (isProxy(store.data.notProxied)) {
  console.log('❌ TEST FAILED: notProxied object should not be a proxy but it is');
} else {
  console.log('✅ TEST PASSED: notProxied object is correctly not a proxy');
}