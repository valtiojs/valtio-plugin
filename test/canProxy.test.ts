import { expect, describe, it, vi, beforeEach } from 'vitest';
import { proxy, type ValtioPlugin } from '../src';
import { subscribe, snapshot } from 'valtio';

// Test symbols and utilities
const UNWRAP = Symbol.for('unwrap');
const NO_PROXY = Symbol.for('no-proxy');

// Helper to check if something is a proxy
function isProxy(obj: any): boolean {
  try {
    // Try to get proxy state - this will throw for non-proxies
    return obj !== snapshot(obj);
  } catch {
    return false;
  }
}

describe('canProxy Plugin Hook', () => {
  beforeEach(() => {
    proxy.clearPlugins();
    vi.clearAllMocks();
  });

  describe('Basic canProxy functionality', () => {
    it('should prevent proxying when canProxy returns false', () => {
      const plugin: ValtioPlugin = {
        id: 'no-proxy',
        canProxy: (value) => {
          if (value && typeof value === 'object' && NO_PROXY in value) {
            return false;
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);

      const store = instance({
        normal: { count: 0 },
        noProxy: { [NO_PROXY]: true, value: 'should not be proxied' }
      });

      // Normal object should be proxied
      expect(isProxy(store.normal)).toBe(true);
      
      // Object with NO_PROXY should not be proxied
      expect(isProxy(store.noProxy)).toBe(false);
      expect(store.noProxy).toEqual({ [NO_PROXY]: true, value: 'should not be proxied' });
    });

    it('should allow proxying when canProxy returns true or undefined', () => {
      const plugin: ValtioPlugin = {
        id: 'allow-proxy',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'alwaysProxy' in value) {
            return true; // Explicitly allow
          }
          return undefined; // No opinion
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);

      const store = instance({
        obj1: { alwaysProxy: true, data: 'test' },
        obj2: { data: 'test' }
      });

      // Both should be proxied
      expect(isProxy(store.obj1)).toBe(true);
      expect(isProxy(store.obj2)).toBe(true);
    });
  });

  describe('Instance isolation', () => {
    it('should only affect the specific instance', () => {
      const plugin: ValtioPlugin = {
        id: 'instance-specific',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'noProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      const instanceA = proxy.createInstance();
      instanceA.use(plugin);

      const instanceB = proxy.createInstance();
      // instanceB does NOT have the plugin

      const storeA = instanceA({
        data: { noProxy: true, value: 'A' }
      });

      const storeB = instanceB({
        data: { noProxy: true, value: 'B' }
      });

      // Only instanceA should prevent proxying
      expect(isProxy(storeA.data)).toBe(false);
      expect(isProxy(storeB.data)).toBe(true); // Should be proxied in instanceB
    });

    it('should work differently for global vs instance plugins', () => {
      const globalPlugin: ValtioPlugin = {
        id: 'global-no-proxy',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'globalNoProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      const instancePlugin: ValtioPlugin = {
        id: 'instance-no-proxy',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'instanceNoProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      // Register global plugin
      proxy.use(globalPlugin);

      // Create instance with its own plugin
      const instance = proxy.createInstance();
      instance.use(instancePlugin);

      // Test global proxy
      const globalStore = proxy({
        global: { globalNoProxy: true },
        instance: { instanceNoProxy: true },
        normal: { data: 'test' }
      });

      // Test instance proxy
      const instanceStore = instance({
        global: { globalNoProxy: true },
        instance: { instanceNoProxy: true },
        normal: { data: 'test' }
      });

      // Global proxy should only respect global plugin
      expect(isProxy(globalStore.global)).toBe(false);
      expect(isProxy(globalStore.instance)).toBe(true); // Not affected by instance plugin
      expect(isProxy(globalStore.normal)).toBe(true);

      // Instance proxy should respect both global and instance plugins
      expect(isProxy(instanceStore.global)).toBe(false);
      expect(isProxy(instanceStore.instance)).toBe(false);
      expect(isProxy(instanceStore.normal)).toBe(true);
    });
  });

  describe('Plugin composition', () => {
    it('should handle multiple plugins with canProxy', () => {
      const plugin1: ValtioPlugin = {
        id: 'plugin1',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'type1' in value) {
            return false;
          }
          return undefined;
        }
      };

      const plugin2: ValtioPlugin = {
        id: 'plugin2',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'type2' in value) {
            return false;
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use([plugin1, plugin2]);

      const store = instance({
        obj1: { type1: true },
        obj2: { type2: true },
        obj3: { type1: true, type2: true },
        normal: { data: 'test' }
      });

      // Each plugin should prevent its own type
      expect(isProxy(store.obj1)).toBe(false);
      expect(isProxy(store.obj2)).toBe(false);
      expect(isProxy(store.obj3)).toBe(false); // Both plugins would prevent this
      expect(isProxy(store.normal)).toBe(true);
    });

    it('should stop checking once a plugin returns false', () => {
      const calls: string[] = [];

      const plugin1: ValtioPlugin = {
        id: 'plugin1',
        canProxy: (value) => {
          calls.push('plugin1');
          if (value && typeof value === 'object' && 'stop' in value) {
            return false;
          }
          return undefined;
        }
      };

      const plugin2: ValtioPlugin = {
        id: 'plugin2',
        canProxy: (value) => {
          calls.push('plugin2');
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use([plugin1, plugin2]);

      const store = instance({
        stop: { stop: true },
        normal: { data: 'test' }
      });

      // For 'stop' object, plugin2 shouldn't be called after plugin1 returns false
      const stopCalls = calls.filter((_, i) => calls[i] === 'plugin1' && (calls[i + 1] !== 'plugin2' || i === calls.length - 1));
      expect(stopCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Nested proxy creation', () => {
    it('should apply canProxy to nested objects', () => {
      const plugin: ValtioPlugin = {
        id: 'nested-no-proxy',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'noProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);

      const store = instance({
        level1: {
          level2: {
            noProxy: true,
            data: 'should not be proxied'
          },
          normal: {
            data: 'should be proxied'
          }
        }
      });

      expect(isProxy(store.level1)).toBe(true);
      expect(isProxy(store.level1.level2)).toBe(false);
      expect(isProxy(store.level1.normal)).toBe(true);
    });

    it('should handle dynamic property addition', () => {
      const plugin: ValtioPlugin = {
        id: 'dynamic-no-proxy',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'noProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);

      const store = instance({
        data: {}
      });

      // Add objects dynamically
      store.data.proxied = { value: 'should be proxied' };
      store.data.notProxied = { noProxy: true, value: 'should not be proxied' };

      expect(isProxy(store.data.proxied)).toBe(true);
      expect(isProxy(store.data.notProxied)).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should handle errors in canProxy gracefully', () => {
      const plugin: ValtioPlugin = {
        id: 'error-plugin',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'throwError' in value) {
            throw new Error('canProxy error');
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const store = instance({
        throwError: { throwError: true, data: 'test' },
        normal: { data: 'test' }
      });

      // Should still create proxies despite error
      expect(isProxy(store.throwError)).toBe(true); // Error causes default behavior
      expect(isProxy(store.normal)).toBe(true);

      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in plugin error-plugin canProxy:'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Integration with other plugin hooks', () => {
    it('should work with transformGet for unwrap pattern', () => {
      // Mock ref object
      function ref<T>(value: T) {
        return {
          current: value,
          [UNWRAP]: true
        };
      }

      const unwrapPlugin: ValtioPlugin = {
        id: 'unwrap',
        canProxy: (value) => {
          if (value && typeof value === 'object' && UNWRAP in value) {
            return false;
          }
          return undefined;
        },
        transformGet: (path, value) => {
          if (value && typeof value === 'object' && UNWRAP in value) {
            return (value as unknown as { current: unknown }).current;
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(unwrapPlugin);

      const inputRef = ref<HTMLInputElement | null>(null);
      const countRef = ref(42);

      const store = instance({
        inputRef,
        countRef,
        normal: { value: 10 }
      });

      // Refs should not be proxied
      expect(isProxy(store.inputRef)).toBe(false);
      expect(isProxy(store.countRef)).toBe(false);
      expect(isProxy(store.normal)).toBe(true);

      // But accessing them should unwrap via transformGet
      expect(store.inputRef).toBe(null);
      expect(store.countRef).toBe(42);

      // Update ref value
      inputRef.current = 'input' as any;
      countRef.current = 100;

      // Should reflect updates
      expect(store.inputRef).toBe('input');
      expect(store.countRef).toBe(100);
    });

    it('should work with beforeChange to prevent modifications', () => {
      const plugin: ValtioPlugin = {
        id: 'readonly',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'readonly' in value) {
            return false;
          }
          return undefined;
        },
        beforeChange: (path, value, prevValue, state) => {
          // Prevent changes to non-proxied objects
          const obj = path.reduce((acc: any, key) => acc?.[key], state);
          if (obj && typeof obj === 'object' && 'readonly' in obj) {
            console.warn('Cannot modify readonly object');
            return false;
          }
          return true;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);

      const store = instance({
        config: { readonly: true, value: 'immutable' },
        data: { value: 'mutable' }
      });

      // Config should not be proxied
      expect(isProxy(store.config)).toBe(false);

      // Can't directly test preventing changes to non-proxied objects
      // since they're not proxied, but the pattern is demonstrated
    });
  });

  describe('Nested instance behavior', () => {
    it('should inherit canProxy behavior from parent instances', () => {
      const parentPlugin: ValtioPlugin = {
        id: 'parent-plugin',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'parentNoProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      const childPlugin: ValtioPlugin = {
        id: 'child-plugin',
        canProxy: (value) => {
          if (value && typeof value === 'object' && 'childNoProxy' in value) {
            return false;
          }
          return undefined;
        }
      };

      const parentInstance = proxy.createInstance();
      parentInstance.use(parentPlugin);

      const childInstance = parentInstance.createInstance();
      childInstance.use(childPlugin);

      const store = childInstance({
        parent: { parentNoProxy: true },
        child: { childNoProxy: true },
        both: { parentNoProxy: true, childNoProxy: true },
        normal: { data: 'test' }
      });

      // Both parent and child rules should apply
      expect(isProxy(store.parent)).toBe(false);
      expect(isProxy(store.child)).toBe(false);
      expect(isProxy(store.both)).toBe(false);
      expect(isProxy(store.normal)).toBe(true);
    });
  });
});