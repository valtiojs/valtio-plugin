import { expect, describe, it, vi, beforeEach, afterEach } from 'vitest';
import { proxy, subscribe, snapshot } from 'valtio';
import { proxyInstance, ValtioPlugin } from '../src';

// Define the shape of hook spies for TypeScript
interface HookSpies {
  onInit?: ReturnType<typeof vi.fn>;
  onAttach?: ReturnType<typeof vi.fn>;
  beforeChange?: ReturnType<typeof vi.fn>;
  afterChange?: ReturnType<typeof vi.fn>;
  onSubscribe?: ReturnType<typeof vi.fn>;
  alterSnapshot?: ReturnType<typeof vi.fn>;
  onDispose?: ReturnType<typeof vi.fn>;
  [key: string]: ReturnType<typeof vi.fn> | undefined;
}

// Helper to create a test plugin - UPDATED FOR NEW API
function createTestPlugin(id = 'test-plugin', hookSpies: HookSpies = {}) {
  // Create spies for all hooks if not provided
  const spies: Required<HookSpies> = {
    onInit: hookSpies.onInit || vi.fn(),
    onAttach: hookSpies.onAttach || vi.fn(),
    beforeChange: hookSpies.beforeChange || vi.fn().mockReturnValue(true),
    afterChange: hookSpies.afterChange || vi.fn(),
    onSubscribe: hookSpies.onSubscribe || vi.fn(),
    alterSnapshot: hookSpies.alterSnapshot || vi.fn(snapshot => snapshot),
    onDispose: hookSpies.onDispose || vi.fn(),
  };
  
  const plugin: ValtioPlugin = {
    id,
    name: `Test Plugin (${id})`,
    
    // Lifecycle hooks
    onInit: spies.onInit,
    onAttach: spies.onAttach,
    beforeChange: spies.beforeChange,
    afterChange: spies.afterChange,
    onSubscribe: spies.onSubscribe,
    alterSnapshot: spies.alterSnapshot,
    onDispose: spies.onDispose,
    
    // Plugin API methods directly on plugin object
    getSpy: (name: string) => spies[name],
    testMethod: vi.fn().mockReturnValue('test-result'),
    resetSpies: () => {
      Object.values(spies).forEach(spy => spy?.mockClear());
      plugin.testMethod.mockClear();
    }
  };
  
  return plugin;
}

describe('Valtio Plugin System', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });
  
  describe('proxyInstance()', () => {
    it('should create a factory function', () => {
      const proxy = proxyInstance();
      expect(typeof proxy).toBe('function');
      expect(typeof proxy.use).toBe('function');
      expect(typeof proxy.subscribe).toBe('function');
      expect(typeof proxy.snapshot).toBe('function');
      expect(typeof proxy.dispose).toBe('function');
    });
    
    it('should create independent instances', () => {
      const proxy1 = proxyInstance();
      const proxy2 = proxyInstance();
      const proxy3 = proxyInstance()
      const proxy4 = proxyInstance()
      expect(proxy1).not.toBe(proxy2);

      // Register a plugin with proxy1 but not proxy2
      const testPlugin = createTestPlugin();
      proxy1.use(testPlugin);
      
      // Create stores
      const store4 = proxy4({ count: 0 })
      const store1 = proxy1({ count: 0, s: store4 });
      const store2 = proxy2({ count: 0 });
      const store3 = proxy3({ s: store1 })
      store3.s.count++
      store1.count++
      
      // Plugin should be initialized for store1 but not store2
      expect(testPlugin.getSpy('onInit')).toHaveBeenCalledTimes(1);
      expect(testPlugin.getSpy('beforeChange')).toHaveBeenCalledTimes(2)
      
      // Plugin should be accessible from proxy1 but not proxy2
      expect(proxy1['test-plugin']).toBeDefined();
      expect(proxy2['test-plugin']).toBeUndefined();
    });
  });

  describe('plugin.use()', () => {
    it('should register a single plugin', () => {
      const proxy = proxyInstance();
      const testPlugin = createTestPlugin();
      
      proxy.use(testPlugin);
      expect(proxy['test-plugin']).toBeDefined();
      expect(proxy['test-plugin'].testMethod()).toBe('test-result');
    });
    
    it('should register multiple plugins', () => {
      const proxy = proxyInstance();
      const testPlugin1 = createTestPlugin('test-plugin');
      const testPlugin2 = createTestPlugin('another-plugin');
      
      proxy.use([testPlugin1, testPlugin2]);
      
      expect(proxy['test-plugin']).toBeDefined();
      expect(proxy['another-plugin']).toBeDefined();
    });
    
    it('should replace plugins with the same id', () => {
      const proxy = proxyInstance();
      
      // For this test, we need to manually create plugins with different implementations
      const testPlugin1: ValtioPlugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        testMethod: vi.fn().mockReturnValue('result1')
      };
      
      const testPlugin2: ValtioPlugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        testMethod: vi.fn().mockReturnValue('result2')
      };
      
      proxy.use(testPlugin1);
      proxy.use(testPlugin2);
      
      expect(proxy['test-plugin'].testMethod()).toBe('result2');
    });
    
    it('should support method chaining', () => {
      const proxy = proxyInstance();
      const testPlugin1 = createTestPlugin('test-plugin');
      const testPlugin2 = createTestPlugin('another-plugin');
      
      const result = proxy.use(testPlugin1).use(testPlugin2);
      expect(result).toBe(proxy);
    });
    
    it('should throw if instance is disposed', () => {
      const proxy = proxyInstance();
      const testPlugin = createTestPlugin();
      
      proxy.dispose();
      
      expect(() => {
        proxy.use(testPlugin);
      }).toThrow('This instance has been disposed');
    });
    
    it('should call onAttach when plugin is attached', () => {
      const proxy = proxyInstance();
      const testPlugin = createTestPlugin();
      
      proxy.use(testPlugin);
      
      expect(testPlugin.onAttach).toHaveBeenCalledTimes(1);
      expect(testPlugin.onAttach).toHaveBeenCalledWith(proxy);
    });
    
    it('should call onAttach for multiple plugins', () => {
      const proxy = proxyInstance();
      const testPlugin1 = createTestPlugin('plugin1');
      const testPlugin2 = createTestPlugin('plugin2');
      
      proxy.use([testPlugin1, testPlugin2]);
      
      expect(testPlugin1.onAttach).toHaveBeenCalledTimes(1);
      expect(testPlugin1.onAttach).toHaveBeenCalledWith(proxy);
      expect(testPlugin2.onAttach).toHaveBeenCalledTimes(1);
      expect(testPlugin2.onAttach).toHaveBeenCalledWith(proxy);
    });
    
    it('should handle errors in onAttach', () => {
      const proxy = proxyInstance();
      const errorPlugin: ValtioPlugin = {
        id: 'error-plugin',
        onAttach: vi.fn().mockImplementation(() => {
          throw new Error('onAttach error');
        })
      };
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Should not throw
      expect(() => proxy.use(errorPlugin)).not.toThrow();
      
      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in plugin error-plugin onAttach:',
        expect.any(Error)
      );
      
      // Plugin should still be registered
      expect(proxy['error-plugin']).toBeDefined();
      
      consoleSpy.mockRestore();
    });
    
    it('should allow plugin to use factory from onAttach', () => {
      const proxy = proxyInstance();
      let capturedFactory: any = null;
      
      const plugin: ValtioPlugin = {
        id: 'test-plugin',
        onAttach: (factory) => {
          capturedFactory = factory;
          // Test that the factory can create proxy instances
          const testState = factory({ value: 42 });
          expect(testState.value).toBe(42);
        }
      };
      
      proxy.use(plugin);
      
      // Verify the factory was captured
      expect(capturedFactory).toBe(proxy);
    });
  });
  
  describe('plugin lifecycle hooks', () => {
    let proxy;
    let testPlugin;
    let store;
    
    beforeEach(() => {
      proxy = proxyInstance();
      testPlugin = createTestPlugin();
      proxy.use(testPlugin);
      store = proxy({ count: 0 });
    });
    
    it('should call onInit when plugin is registered', () => {
      expect(testPlugin.onInit).toHaveBeenCalledTimes(1);
    });
    
    it('should call beforeChange before property is changed', () => {
      store.count = 1;
      
      expect(testPlugin.beforeChange).toHaveBeenCalledWith(
        ['count'],
        1,
        0,
        expect.any(Object)
      );
    });
    
    it('should call afterChange after property is changed', () => {
      store.count = 1;
      
      expect(testPlugin.afterChange).toHaveBeenCalledWith(
        ['count'],
        1,
        expect.any(Object)
      );
    });
    
    it('should prevent property change when beforeChange returns false', () => {
      // Override beforeChange to return false for count > 5
      testPlugin.beforeChange.mockImplementation((path, value) => {
        if (path[0] === 'count' && value > 5) {
          return false;
        }
        return true;
      });
      
      // This should go through
      store.count = 5;
      expect(store.count).toBe(5);
      
      // This should be prevented
      store.count = 10;
      expect(store.count).toBe(5);
      
      // beforeChange should be called for both attempts
      expect(testPlugin.beforeChange).toHaveBeenCalledTimes(2);
      
      // afterChange should only be called for the successful change
      expect(testPlugin.afterChange).toHaveBeenCalledTimes(1);
    });
    
    it('should call onSubscribe when subscribing to a proxy', () => {
      const callback = vi.fn();
      const unsubscribe = proxy.subscribe(store, callback);
      
      expect(testPlugin.onSubscribe).toHaveBeenCalledWith(
        store,
        callback
      );
      
      // Cleanup
      unsubscribe();
    });
    
    it('should call alterSnapshot when creating a snapshot', () => {
      const snap = proxy.snapshot(store);
      
      expect(testPlugin.alterSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ count: 0 })
      );
    });
  });
  
  describe('nested object handling', () => {
    let proxy;
    let testPlugin;
    let store;
    
    beforeEach(() => {
      proxy = proxyInstance();
      testPlugin = createTestPlugin();
      proxy.use(testPlugin);
      store = proxy({
        user: {
          profile: {
            name: 'John',
            settings: {
              theme: 'dark'
            }
          }
        }
      });
      
      // Reset spies after creating the store
      testPlugin.resetSpies();
    });
    
    it('should handle changes to deeply nested properties', () => {
      store.user.profile.settings.theme = 'light';
      
      expect(testPlugin.beforeChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings', 'theme'],
        'light',
        'dark',
        expect.any(Object)
      );
      
      expect(testPlugin.afterChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings', 'theme'],
        'light',
        expect.any(Object)
      );
    });
    
    it('should handle adding new properties to nested objects', () => {
      store.user.profile.settings.fontSize = 16;
      
      expect(testPlugin.beforeChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings', 'fontSize'],
        16,
        undefined,
        expect.any(Object)
      );
      
      expect(testPlugin.afterChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings', 'fontSize'],
        16,
        expect.any(Object)
      );
    });
    
    it('should handle replacing entire nested objects', () => {
      const newSettings = { theme: 'light', fontSize: 16 };
      store.user.profile.settings = newSettings;
      
      expect(testPlugin.beforeChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings'],
        newSettings,
        expect.objectContaining({ theme: 'dark' }),
        expect.any(Object)
      );
      
      expect(testPlugin.afterChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings'],
        newSettings,
        expect.any(Object)
      );
    });
    
    it('should handle deleting properties from nested objects', () => {
      const prevTheme = store.user.profile.settings.theme;
      delete store.user.profile.settings.theme;
      
      expect(testPlugin.beforeChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings', 'theme'],
        undefined,
        prevTheme,
        expect.any(Object)
      );
      
      expect(testPlugin.afterChange).toHaveBeenCalledWith(
        ['user', 'profile', 'settings', 'theme'],
        undefined,
        expect.any(Object)
      );
    });
  });
  
  describe('proxy.subscribe()', () => {
    it('should work with plugin hooks', async () => {
      const proxy = proxyInstance();
      const testPlugin = createTestPlugin();
      proxy.use(testPlugin);
      
      const store = proxy({ count: 0 });
      const callback = vi.fn();
      
      const unsubscribe = proxy.subscribe(store, callback);
      
      // Modify the store
      store.count = 1;
      
      // Need to wait for the next tick for subscribers to be notified
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Plugin hooks should be called
      expect(testPlugin.beforeChange).toHaveBeenCalled();
      expect(testPlugin.afterChange).toHaveBeenCalled();
      
      // Callback should be called
      expect(callback).toHaveBeenCalled();
      
      // Cleanup
      unsubscribe();
    });
    
    it('should handle errors in plugin hooks', () => {
      const proxy = proxyInstance();
      
      // Create a plugin with a hook that throws an error
      const errorPlugin = createTestPlugin('error-plugin', {
        onSubscribe: vi.fn().mockImplementation(() => {
          throw new Error('Test error');
        })
      });
      
      proxy.use(errorPlugin);
      
      const store = proxy({ count: 0 });
      const callback = vi.fn();
      
      // This should not throw, the error should be caught and logged
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const unsubscribe = proxy.subscribe(store, callback);
      
      expect(consoleSpy).toHaveBeenCalled();
      expect(unsubscribe).toBeInstanceOf(Function);
      
      // Cleanup
      unsubscribe();
      consoleSpy.mockRestore();
    });
  });
  
  describe('proxy.snapshot()', () => {
    it('should work with plugin hooks', () => {
      const proxy = proxyInstance();
      
      // Create a plugin that modifies snapshots
      const modifierPlugin = createTestPlugin('modifier-plugin', {
        alterSnapshot: vi.fn((snap) => ({
          ...snap,
          _modified: true
        }))
      });
      
      proxy.use(modifierPlugin);
      
      const store = proxy({ count: 0 });
      const snap = proxy.snapshot(store);
      
      // Plugin hook should be called
      expect(modifierPlugin.alterSnapshot).toHaveBeenCalled();
      
      // Snapshot should be modified
      expect(snap).toEqual({
        count: 0,
        _modified: true
      });
    });
    
    it('should handle errors in plugin hooks', () => {
      const proxy = proxyInstance();
      
      // Create a plugin with a hook that throws an error
      const errorPlugin = createTestPlugin('error-plugin', {
        alterSnapshot: vi.fn().mockImplementation(() => {
          throw new Error('Test error');
        })
      });
      
      proxy.use(errorPlugin);
      
      const store = proxy({ count: 0 });
      
      // This should not throw, the error should be caught and logged
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const snap = proxy.snapshot(store);
      
      expect(consoleSpy).toHaveBeenCalled();
      expect(snap).toEqual({ count: 0 }); // Should return original snapshot
      
      // Cleanup
      consoleSpy.mockRestore();
    });
  });
  
  describe('proxy.dispose()', () => {
    it('should clean up resources', () => {
      const proxy = proxyInstance();
      const testPlugin = createTestPlugin();
      proxy.use(testPlugin);
      
      const store = proxy({ count: 0 });
      
      // Before disposal
      expect(proxy['test-plugin']).toBeDefined();
      
      proxy.dispose();
      
      // After disposal
      expect(proxy['test-plugin']).toBeUndefined();
      
      // Methods should throw
      expect(() => proxy.use(testPlugin)).toThrow('This instance has been disposed');
      expect(() => proxy.subscribe(store, vi.fn())).toThrow('This instance has been disposed');
      expect(() => proxy.snapshot(store)).toThrow('This instance has been disposed');
      
      // Dispose should be idempotent
      expect(() => proxy.dispose()).not.toThrow();
    });
  });
  
  describe('compatibility with standard Valtio', () => {
    it('should work with useSnapshot from valtio/react', () => {
      // Mock React hooks
      const mockUseSnapshot = vi.fn((proxy) => snapshot(proxy));
      vi.mock('valtio/react', () => ({
        useSnapshot: (proxy) => mockUseSnapshot(proxy)
      }));
      
      const proxy = proxyInstance();
      const store = proxy({ count: 0 });
      
      // This would be called from a React component
      const snap = mockUseSnapshot(store);
      
      expect(snap).toEqual({ count: 0 });
      expect(mockUseSnapshot).toHaveBeenCalledWith(store);
    });
    
    it('should work with original subscribe from valtio', async () => {
      const proxy = proxyInstance();
      const store = proxy({ count: 0 });
      
      const callback = vi.fn();
      const unsubscribe = subscribe(store, callback);
      
      // Modify the store
      store.count = 1;
      
      // Need to wait for the next tick for subscribers to be notified
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Callback should be called
      expect(callback).toHaveBeenCalled();
      
      // Cleanup
      unsubscribe();
    });
    
    it('should work with original snapshot from valtio', () => {
      const proxy = proxyInstance();
      const store = proxy({ count: 0 });
      
      const snap = snapshot(store);
      
      expect(snap).toEqual({ count: 0 });
    });
  });
  
  describe('error handling', () => {
    it('should catch and log errors in plugin hooks', () => {
      const proxy = proxyInstance();
      
      // Create plugins with hooks that throw errors
      const errorPlugin1 = createTestPlugin('error-plugin-1', {
        beforeChange: vi.fn().mockImplementation(() => {
          throw new Error('Error in beforeChange');
        })
      });
      
      const errorPlugin2 = createTestPlugin('error-plugin-2', {
        afterChange: vi.fn().mockImplementation(() => {
          throw new Error('Error in afterChange');
        })
      });
      
      proxy.use([errorPlugin1, errorPlugin2]);
      
      const store = proxy({ count: 0 });
      
      // Mock console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // This should not throw, the errors should be caught and logged
      store.count = 1;
      
      // Both errors should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[0][0]).toContain('Error in plugin');
      expect(consoleSpy.mock.calls[1][0]).toContain('Error in plugin');
      
      // The operation should still complete
      expect(store.count).toBe(1);
      
      // Cleanup
      consoleSpy.mockRestore();
    });
    
    it('should continue with remaining plugins if one fails', () => {
      const proxy = proxyInstance();
      
      // Create one plugin that throws and one that works
      const errorPlugin = createTestPlugin('error-plugin', {
        beforeChange: vi.fn().mockImplementation(() => {
          throw new Error('Error in beforeChange');
        })
      });
      
      const workingPlugin = createTestPlugin('working-plugin');
      
      proxy.use([errorPlugin, workingPlugin]);
      
      const store = proxy({ count: 0 });
      
      // Mock console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // This should not throw
      store.count = 1;
      
      // Error should be logged
      expect(consoleSpy).toHaveBeenCalled();
      
      // The working plugin's hooks should still be called
      expect(workingPlugin.beforeChange).toHaveBeenCalled();
      expect(workingPlugin.afterChange).toHaveBeenCalled();
      
      // Cleanup
      consoleSpy.mockRestore();
    });
  });
});