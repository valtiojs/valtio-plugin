

import { expect, describe, it, vi, beforeEach } from 'vitest';
import { useSnapshot } from 'valtio/react';
// Import the enhanced proxy
import { proxy } from '../src'

// Mock React for testing
vi.mock('react', () => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn((cb) => cb()),
  useRef: vi.fn(() => ({ current: undefined })),
  useMemo: vi.fn((fn) => fn()),
  useCallback: vi.fn((fn) => fn),
  useSyncExternalStore: vi.fn((subscribe, getSnapshot) => getSnapshot()),
}));

// Mock Valtio React hooks
vi.mock('valtio/react', () => ({
  useSnapshot: vi.fn((proxy) => ({ ...proxy })),
}));

describe('Integration Tests', () => {
  beforeEach(() => {
    // Clear all global plugins before each test
    proxy.clearPlugins();
  });

  describe('Real-world plugin usage', () => {
    it('should work with a persistence plugin', () => {
      // Mock localStorage
      const mockStorage = {
        setItem: vi.fn(),
        getItem: vi.fn(),
        removeItem: vi.fn(),
      };
      
      // Create a persistence plugin with methods directly on plugin object
      const createPersistPlugin = (options = { name: 'default-store' }) => ({
        id: 'persist',
        name: 'Persistence Plugin',
        
        // Plugin API methods directly on plugin
        pause: vi.fn(),
        resume: vi.fn(),
        clear: vi.fn(),
        
        onInit: () => {
          // Would normally load from storage here
          mockStorage.getItem(options.name);
        },
        
        afterChange: (path, value, state) => {
          // Save to storage
          mockStorage.setItem(options.name, JSON.stringify(state));
        },
      });
      
      // Use the plugin
      const instance = proxy.createInstance();
      const persistPlugin = createPersistPlugin({ name: 'my-store' });
      instance.use(persistPlugin);
      
      const store = instance({ count: 0 });
      
      // Initial state should trigger localStorage.getItem
      expect(mockStorage.getItem).toHaveBeenCalledWith('my-store');
      
      // Modifying the state should trigger localStorage.setItem
      store.count = 1;
      expect(mockStorage.setItem).toHaveBeenCalledWith('my-store', expect.any(String));
      
      // We should be able to access the plugin API
      (instance as any).persist.pause();
      expect((instance as any).persist.pause).toHaveBeenCalled();
    });
    
    it('should work with a global logging plugin', () => {
      // Mock logger
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      
      // Create a logging plugin with methods directly on plugin object
      const createLoggerPlugin = (options = { level: 'info' }) => ({
        id: 'logger',
        name: 'Logger Plugin',
        
        // Plugin API methods directly on plugin
        ...mockLogger,
        setLevel: vi.fn(),
        
        beforeChange: (path, value, prevValue, state) => {
          mockLogger.debug(`Will change ${path.join('.')} from ${prevValue} to ${value}`);
          return true;
        },
        
        afterChange: (path, value, state) => {
          mockLogger.info(`Changed ${path.join('.')} to ${value}`);
        },
      });
      
      // Use the plugin globally
      const loggerPlugin = createLoggerPlugin({ level: 'debug' });
      proxy.use(loggerPlugin);
      
      const store = proxy({ count: 0 });
      
      // Log methods should be accessible
      (proxy as any).logger.debug('Custom debug message');
      expect((proxy as any).logger.debug).toHaveBeenCalledWith('Custom debug message');
      
      // Changing state should trigger log messages
      store.count = 1;
      expect((proxy as any).logger.debug).toHaveBeenCalledWith(expect.stringContaining('Will change count'));
      expect((proxy as any).logger.info).toHaveBeenCalledWith(expect.stringContaining('Changed count'));
    });
    
    it('should work with a validation plugin', () => {
      // Create a validation plugin with methods directly on plugin object
      const createValidationPlugin = () => ({
        id: 'validation',
        name: 'Validation Plugin',
        
        // Plugin API methods directly on plugin
        validate: vi.fn(),
        addSchema: vi.fn(),
        
        beforeChange: (path, value, prevValue, state) => {
          // Simple validation - count must be >= 0
          if (path[0] === 'count' && typeof value === 'number' && value < 0) {
            console.error('Validation failed: count must be >= 0');
            return false;
          }
          return true;
        },
      });
      
      // Use the plugin
      const instance = proxy.createInstance();
      const validationPlugin = createValidationPlugin();
      instance.use(validationPlugin);
      
      const store = instance({ count: 0 });
      
      // Valid change should work
      store.count = 5;
      expect(store.count).toBe(5);
      
      // Mock console.error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Invalid change should be rejected
      store.count = -1;
      expect(store.count).toBe(5); // Still 5, not -1
      expect(consoleSpy).toHaveBeenCalledWith('Validation failed: count must be >= 0');
      
      // Cleanup
      consoleSpy.mockRestore();
    });
  });
  
  describe('React integration', () => {
    it('should work with useSnapshot', () => {
      // Create a plugin
      const testPlugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        alterSnapshot: vi.fn(snapshot => snapshot),
      };
      
      const instance = proxy.createInstance();
      instance.use(testPlugin);
      
      const store = instance({ count: 0 });
      
      // Mock useSnapshot
      const mockSnap = useSnapshot(store);
      
      // useSnapshot should work with our proxied store
      expect(useSnapshot).toHaveBeenCalledWith(store);
    });
  });
  
  describe('Multiple plugins working together', () => {
    it('should handle multiple plugins modifying the same operations', () => {
      // Create plugins that all modify the same operations
      const validationPlugin = {
        id: 'validation',
        name: 'Validation Plugin',
        beforeChange: vi.fn((path, value) => {
          // Only allow even numbers for count
          if (path[0] === 'count' && typeof value === 'number') {
            return value % 2 === 0;
          }
          return true;
        }),
      };
      
      const loggingPlugin = {
        id: 'logging',
        name: 'Logging Plugin',
        beforeChange: vi.fn(() => true),
        afterChange: vi.fn(),
      };
      
      const transformPlugin = {
        id: 'transform',
        name: 'Transform Plugin',
        beforeChange: vi.fn((path, value) => {
          // Double any number values for count
          if (path[0] === 'count' && typeof value === 'number') {
            // This doesn't actually modify the value, just tests the logic
            return true;
          }
          return true;
        }),
      };
      
      // Register all plugins
      const instance = proxy.createInstance();
      instance.use([validationPlugin, loggingPlugin, transformPlugin]);
      
      const store = instance({ count: 0 });
      
      // Valid change (even number)
      store.count = 2;
      expect(store.count).toBe(2);
      expect(validationPlugin.beforeChange).toHaveBeenCalled();
      expect(loggingPlugin.beforeChange).toHaveBeenCalled();
      expect(transformPlugin.beforeChange).toHaveBeenCalled();
      expect(loggingPlugin.afterChange).toHaveBeenCalled();
      
      // Reset mocks
      vi.clearAllMocks();
      
      // Invalid change (odd number)
      store.count = 3;
      expect(store.count).toBe(2); // Still 2, not 3
      expect(validationPlugin.beforeChange).toHaveBeenCalled();
      expect(loggingPlugin.beforeChange).not.toHaveBeenCalled(); // Shouldn't be called if validation fails
      expect(transformPlugin.beforeChange).not.toHaveBeenCalled(); // Shouldn't be called if validation fails
      expect(loggingPlugin.afterChange).not.toHaveBeenCalled(); // Shouldn't be called if validation fails
    });
  });

  describe('Global vs Instance plugins', () => {
    it('should demonstrate global plugins affecting all stores', () => {
      const globalPlugin = {
        id: 'global-logger',
        afterChange: vi.fn(),
      };
      
      // Register global plugin
      proxy.use(globalPlugin);
      
      // Create multiple stores - both should be affected
      const store1 = proxy({ count: 0 });
      const store2 = proxy({ value: 'test' });
      
      store1.count = 1;
      store2.value = 'changed';
      
      // Global plugin should be called for both stores
      expect(globalPlugin.afterChange).toHaveBeenCalledTimes(2);
    });
    
    it('should demonstrate instance plugins only affecting instance stores', () => {
      const globalPlugin = {
        id: 'global-logger',
        afterChange: vi.fn(),
      };
      
      const instancePlugin = {
        id: 'instance-logger',
        afterChange: vi.fn(),
      };
      
      // Register global plugin
      proxy.use(globalPlugin);
      
      // Create instance with its own plugin
      const instance = proxy.createInstance();
      instance.use(instancePlugin);
      
      // Create stores
      const globalStore = proxy({ count: 0 });
      const instanceStore = instance({ count: 0 });
      
      globalStore.count = 1;
      instanceStore.count = 1;
      
      // Global plugin should be called for both
      expect(globalPlugin.afterChange).toHaveBeenCalledTimes(2);
      
      // Instance plugin should only be called for instance store
      expect(instancePlugin.afterChange).toHaveBeenCalledTimes(1);
    });
  });
});