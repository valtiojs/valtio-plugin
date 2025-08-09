

import { expect, describe, it, vi, beforeEach } from 'vitest';
import { useSnapshot } from 'valtio/react';
// Import the enhanced proxy
import { proxy, ValtioPlugin } from '../src'

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
        onSnapshot: vi.fn(snapshot => snapshot),
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

  describe('Real-world onGet usage patterns', () => {
    it('should implement a lazy loading system with onGet', () => {
      const mockApi = {
        fetchUser: vi.fn().mockResolvedValue({ id: 1, name: 'John Doe', email: 'john@example.com' }),
        fetchPosts: vi.fn().mockResolvedValue([
          { id: 1, title: 'First Post' },
          { id: 2, title: 'Second Post' }
        ])
      };

      const lazyLoadPlugin: ValtioPlugin = {
        id: 'lazy-load',
        name: 'Lazy Load Plugin',
        
        // Internal cache
        _cache: new Map<string, any>(),
        _loading: new Set<string>(),
        
        onGet: function(path, value, state) {
          const pathKey = path.join('.');
          
          // Only handle properties starting with 'lazy_'
          if (!path[path.length - 1]?.toString().startsWith('lazy_')) {
            return undefined;
          }
          
          // Check cache first
          if (this._cache.has(pathKey)) {
            return this._cache.get(pathKey);
          }
          
          // If already loading, return loading state
          if (this._loading.has(pathKey)) {
            return { loading: true };
          }
          
          // Start loading
          this._loading.add(pathKey);
          
          // Determine what to load based on path
          if (pathKey === 'lazy_user') {
            mockApi.fetchUser().then(data => {
              this._cache.set(pathKey, data);
              this._loading.delete(pathKey);
              // In real app, would trigger re-render here
            });
          } else if (pathKey === 'lazy_posts') {
            mockApi.fetchPosts().then(data => {
              this._cache.set(pathKey, data);
              this._loading.delete(pathKey);
            });
          }
          
          return { loading: true };
        }
      };

      const instance = proxy.createInstance();
      instance.use(lazyLoadPlugin);
      
      const store = instance({ 
        title: 'My App'
      });

      // First access should return loading state
      expect((store as any).lazy_user).toEqual({ loading: true });
      expect((store as any).lazy_posts).toEqual({ loading: true });
      
      // API should have been called
      expect(mockApi.fetchUser).toHaveBeenCalledTimes(1);
      expect(mockApi.fetchPosts).toHaveBeenCalledTimes(1);
    });

    it('should implement computed properties with dependency tracking', () => {
      // Simulated dependency tracking
      const dependencies = new Map<string, Set<string>>();
      const cache = new Map<string, any>();
      
      const computedPlugin: ValtioPlugin = {
        id: 'computed',
        name: 'Computed Properties Plugin',
        
        onGet: (path, value, state) => {
          const pathStr = path.join('.');
          
          // Handle computed properties (properties ending with _computed)
          if (pathStr.endsWith('_computed')) {
            // Check cache
            const cacheKey = pathStr;
            
            if (cache.has(cacheKey)) {
              return cache.get(cacheKey);
            }
            
            // Compute new value based on property name
            let computedValue;
            
            if (pathStr === 'subtotal_computed') {
              const s = state as any;
              computedValue = s.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
            } else if (pathStr === 'total_computed') {
              const s = state as any;
              // First compute subtotal
              const subtotal = s.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
              computedValue = subtotal * (1 + s.taxRate);
            }
            
            cache.set(cacheKey, computedValue);
            return computedValue;
          }
          
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(computedPlugin);
      
      const store = instance({
        items: [
          { name: 'Apple', price: 1.00, quantity: 5 },
          { name: 'Banana', price: 0.50, quantity: 10 },
          { name: 'Orange', price: 0.75, quantity: 3 }
        ],
        taxRate: 0.08
      });

      // First access computes values
      expect((store as any).subtotal_computed).toBe(12.25);
      expect((store as any).total_computed).toBeCloseTo(13.23);
      
      // Subsequent accesses should use cache (in real implementation)
      const subtotal2 = (store as any).subtotal_computed;
      expect(subtotal2).toBe(12.25);
    });

    it('should implement a permissions system with onGet', () => {
      interface User {
        id: string;
        role: 'admin' | 'user' | 'guest';
        department?: string;
      }
      
      let currentUser: User = { id: '1', role: 'guest' };
      
      const permissionsPlugin: ValtioPlugin = {
        id: 'permissions',
        name: 'Permissions Plugin',
        
        // Method to update current user
        setCurrentUser(user: User) {
          currentUser = user;
        },
        
        onGet: (path, value, state) => {
          const pathStr = path.join('.');
          
          // Admin panel - admins only
          if (pathStr.startsWith('adminPanel') && currentUser.role !== 'admin') {
            return { error: 'Unauthorized', message: 'Admin access required' };
          }
          
          // Sensitive data - hide from guests
          if (pathStr.includes('sensitive') && currentUser.role === 'guest') {
            return { hidden: true, message: 'Login required' };
          }
          
          // Department-specific data
          if (pathStr.startsWith('departments.') && currentUser.role === 'user') {
            const dept = path[1];
            if (dept !== currentUser.department) {
              return { error: 'Access denied', message: 'Wrong department' };
            }
          }
          
          // Mask personal data for non-admins
          if (pathStr.includes('email') && currentUser.role !== 'admin') {
            if (typeof value === 'string') {
              const [local, domain] = value.split('@');
              return `${local.substring(0, 2)}***@${domain}`;
            }
          }
          
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(permissionsPlugin);
      
      const store = instance({
        publicData: 'Everyone can see this',
        adminPanel: {
          users: ['user1', 'user2'],
          logs: ['log1', 'log2']
        },
        sensitiveInfo: {
          apiKey: 'sk-12345',
          database: 'prod-db'
        },
        departments: {
          sales: { revenue: 100000 },
          engineering: { budget: 500000 }
        },
        users: [
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' }
        ]
      });

      // As guest
      expect(store.publicData).toBe('Everyone can see this');
      expect(store.adminPanel).toEqual({ error: 'Unauthorized', message: 'Admin access required' });
      expect(store.sensitiveInfo).toEqual({ hidden: true, message: 'Login required' });
      
      // As user
      (instance as any).permissions.setCurrentUser({ id: '2', role: 'user', department: 'sales' });
      expect(store.departments.sales).toEqual({ revenue: 100000 });
      expect(store.departments.engineering).toEqual({ error: 'Access denied', message: 'Wrong department' });
      expect(store.users[0].email).toBe('jo***@example.com');
      
      // As admin
      (instance as any).permissions.setCurrentUser({ id: '3', role: 'admin' });
      expect(store.adminPanel).toEqual({ users: ['user1', 'user2'], logs: ['log1', 'log2'] });
      expect(store.users[0].email).toBe('john@example.com'); // Full email visible
    });

    it('should implement i18n with onGet', () => {
      const translations = {
        en: {
          greeting: 'Hello',
          farewell: 'Goodbye',
          items: {
            apple: 'Apple',
            banana: 'Banana'
          }
        },
        es: {
          greeting: 'Hola',
          farewell: 'Adiós',
          items: {
            apple: 'Manzana',
            banana: 'Plátano'
          }
        }
      };
      
      let currentLocale = 'en';
      
      const i18nPlugin: ValtioPlugin = {
        id: 'i18n',
        name: 'Internationalization Plugin',
        
        setLocale(locale: string) {
          currentLocale = locale;
        },
        
        onGet: (path, value) => {
          // Only transform strings starting with 't.'
          if (typeof value === 'string' && value.startsWith('t.')) {
            const key = value.substring(2);
            const keys = key.split('.');
            let translation: any = translations[currentLocale as keyof typeof translations];
            
            for (const k of keys) {
              translation = translation?.[k];
            }
            
            return translation || value; // Return original if not found
          }
          
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(i18nPlugin);
      
      const store = instance({
        title: 't.greeting',
        subtitle: 't.farewell',
        menu: {
          fruit1: 't.items.apple',
          fruit2: 't.items.banana'
        },
        untranslated: 'Regular text'
      });

      // English (default)
      expect(store.title).toBe('Hello');
      expect(store.subtitle).toBe('Goodbye');
      expect(store.menu.fruit1).toBe('Apple');
      expect(store.menu.fruit2).toBe('Banana');
      expect(store.untranslated).toBe('Regular text');
      
      // Switch to Spanish
      (instance as any).i18n.setLocale('es');
      expect(store.title).toBe('Hola');
      expect(store.subtitle).toBe('Adiós');
      expect(store.menu.fruit1).toBe('Manzana');
      expect(store.menu.fruit2).toBe('Plátano');
    });
  });
});