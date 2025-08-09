import { expect, describe, it, vi, beforeEach } from 'vitest';
import { proxy, type ValtioPlugin } from '../src';

describe('onGet Plugin Hook', () => {
  beforeEach(() => {
    proxy.clearPlugins();
    vi.clearAllMocks();
  });

  describe('Basic onGet functionality', () => {
    it('should allow plugin to return custom value', () => {
      const plugin: ValtioPlugin = {
        id: 'custom-value',
        onGet: (path, value) => {
          if (path[0] === 'customProp') {
            return 'custom value from plugin';
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        normalProp: 'normal value',
        customProp: 'original value' 
      });

      expect(store.normalProp).toBe('normal value');
      expect(store.customProp).toBe('custom value from plugin');
    });

    it('should pass through when returning undefined', () => {
      const plugin: ValtioPlugin = {
        id: 'pass-through',
        onGet: (path, value) => {
          // Always return undefined to pass through
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        prop1: 'value1',
        prop2: 42,
        prop3: { nested: true }
      });

      expect(store.prop1).toBe('value1');
      expect(store.prop2).toBe(42);
      expect(store.prop3).toEqual({ nested: true });
    });

    it('should work with nested property access', () => {
      const plugin: ValtioPlugin = {
        id: 'nested-transform',
        onGet: (path, value) => {
          if (path.join('.') === 'user.name') {
            return value ? String(value).toUpperCase() : value;
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        user: {
          name: 'john doe',
          age: 30
        }
      });

      expect(store.user.name).toBe('JOHN DOE');
      expect(store.user.age).toBe(30);
    });
  });

  describe('Virtual properties', () => {
    it('should create virtual properties that do not exist', () => {
      const plugin: ValtioPlugin = {
        id: 'virtual-props',
        onGet: (path, value) => {
          // Create virtual properties starting with 'virtual_'
          if (path[path.length - 1]?.toString().startsWith('virtual_')) {
            const propName = path[path.length - 1].toString();
            return `Virtual: ${propName}`;
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        realProp: 'real value'
      });

      expect(store.realProp).toBe('real value');
      expect((store as any).virtual_foo).toBe('Virtual: virtual_foo');
      expect((store as any).virtual_bar).toBe('Virtual: virtual_bar');
      
      // Virtual properties should not be enumerable
      expect(Object.keys(store)).toEqual(['realProp']);
    });

    it('should create computed properties based on other values', () => {
      const plugin: ValtioPlugin = {
        id: 'computed',
        onGet: (path, value, state) => {
          const pathStr = path.join('.');
          
          if (pathStr === 'fullName') {
            const s = state as any;
            return `${s.firstName || ''} ${s.lastName || ''}`.trim();
          }
          
          if (pathStr === 'total') {
            const s = state as any;
            return (s.price || 0) * (s.quantity || 0);
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        firstName: 'John',
        lastName: 'Doe',
        price: 10,
        quantity: 5
      });

      expect((store as any).fullName).toBe('John Doe');
      expect((store as any).total).toBe(50);
      
      // Should update when dependencies change
      store.firstName = 'Jane';
      expect((store as any).fullName).toBe('Jane Doe');
      
      store.quantity = 10;
      expect((store as any).total).toBe(100);
    });
  });

  describe('Multiple plugins with onGet', () => {
    it('should use last plugin that returns non-undefined', () => {
      const plugin1: ValtioPlugin = {
        id: 'plugin1',
        onGet: (path, value) => {
          if (path[0] === 'test') {
            return 'from plugin1';
          }
        }
      };

      const plugin2: ValtioPlugin = {
        id: 'plugin2',
        onGet: (path, value) => {
          if (path[0] === 'test') {
            return 'from plugin2';
          }
        }
      };

      const plugin3: ValtioPlugin = {
        id: 'plugin3',
        onGet: (path, value) => {
          // This one returns undefined, so plugin2's value should be used
        return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use([plugin1, plugin2, plugin3]);
      
      const store = instance({ test: 'original' });

      // plugin2 is the last one to return a non-undefined value
      expect(store.test).toBe('from plugin2');
    });

    it('should work with global and instance plugins', () => {
      const globalPlugin: ValtioPlugin = {
        id: 'global',
        onGet: (path, value) => {
          if (path[0] === 'globalValue') {
            return 'from global';
          }
        }
      };

      const instancePlugin: ValtioPlugin = {
        id: 'instance',
        onGet: (path, value) => {
          if (path[0] === 'instanceValue') {
            return 'from instance';
          }
          // Override global plugin for globalValue
          if (path[0] === 'globalValue') {
            return 'overridden by instance';
          }
        }
      };

      proxy.use(globalPlugin);
      
      const instance = proxy.createInstance();
      instance.use(instancePlugin);
      
      const store = instance({ 
        globalValue: 'original',
        instanceValue: 'original'
      });

      expect(store.globalValue).toBe('overridden by instance');
      expect(store.instanceValue).toBe('from instance');
    });
  });

  describe('Value transformation', () => {
    it('should transform string values', () => {
      const plugin: ValtioPlugin = {
        id: 'string-transform',
        onGet: (path, value) => {
          if (typeof value === 'string') {
            return value.toUpperCase();
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        name: 'john',
        nested: {
          title: 'hello world'
        },
        count: 42
      });

      expect(store.name).toBe('JOHN');
      expect(store.nested.title).toBe('HELLO WORLD');
      expect(store.count).toBe(42); // Number unchanged
    });

    it('should format numbers', () => {
      const plugin: ValtioPlugin = {
        id: 'number-format',
        onGet: (path, value) => {
          if (typeof value === 'number' && path[path.length - 1]?.toString().endsWith('_formatted')) {
            return value.toLocaleString('en-US', { 
              style: 'currency', 
              currency: 'USD' 
            });
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        price: 1234.56,
        price_formatted: 1234.56,
        count: 42
      });

      expect(store.price).toBe(1234.56);
      expect(store.price_formatted).toBe('$1,234.56');
      expect(store.count).toBe(42);
    });
  });

  describe('Access control', () => {
    it('should redact sensitive fields', () => {
      const plugin: ValtioPlugin = {
        id: 'security',
        onGet: (path, value) => {
          const field = path[path.length - 1]?.toString();
          if (field && ['password', 'secret', 'apiKey', 'token'].includes(field)) {
            return '***REDACTED***';
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        username: 'john',
        password: 'secret123',
        apiKey: 'sk-1234567890',
        data: {
          token: 'jwt-token-here',
          public: 'visible'
        }
      });

      expect(store.username).toBe('john');
      expect(store.password).toBe('***REDACTED***');
      expect(store.apiKey).toBe('***REDACTED***');
      expect(store.data.token).toBe('***REDACTED***');
      expect(store.data.public).toBe('visible');
    });

    it('should implement permission-based access', () => {
      let currentUser = { role: 'user' };
      
      const plugin: ValtioPlugin = {
        id: 'permissions',
        onGet: (path, value) => {
          if (path[0] === 'adminData' && currentUser.role !== 'admin') {
            return { error: 'Access denied' };
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        publicData: 'everyone can see',
        adminData: { sensitive: 'admin only' }
      });

      // As regular user
      expect(store.publicData).toBe('everyone can see');
      expect(store.adminData).toEqual({ error: 'Access denied' });
      
      // Change to admin
      currentUser = { role: 'admin' };
      expect(store.adminData).toEqual({ sensitive: 'admin only' });
    });
  });

  describe('Error handling', () => {
    it('should handle errors in onGet gracefully', () => {
      const plugin: ValtioPlugin = {
        id: 'error-plugin',
        onGet: (path, value) => {
          if (path[0] === 'errorProp') {
            throw new Error('onGet error');
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        normalProp: 'normal',
        errorProp: 'will cause error'
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Should not throw, but return original value
      expect(store.errorProp).toBe('will cause error');
      
      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in plugin'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    it('should continue with other plugins after error', () => {
      const errorPlugin: ValtioPlugin = {
        id: 'error-plugin',
        onGet: () => {
          throw new Error('Always fails');
        }
      };

      const workingPlugin: ValtioPlugin = {
        id: 'working-plugin',
        onGet: (path, value) => {
          if (path[0] === 'test') {
            return 'from working plugin';
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use([errorPlugin, workingPlugin]);
      
      const store = instance({ test: 'original' });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Working plugin should still process despite error in first plugin
      expect(store.test).toBe('from working plugin');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Complex scenarios', () => {
    it('should allow adding virtual properties based on path', () => {
      // This test shows that we can add virtual properties to any object
      // by checking the path and returning appropriate values
      const plugin: ValtioPlugin = {
        id: 'virtual-props',
        onGet: (path, value, state) => {
          const pathStr = path.join('.');
          
          // Add virtual properties to items array
          if (pathStr === 'items.first') {
            return 1; // Return first element directly
          }
          if (pathStr === 'items.last') {
            return 5; // Return last element directly
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        items: [1, 2, 3, 4, 5]
      });

      expect((store.items as any).first).toBe(1);
      expect((store.items as any).last).toBe(5);
      
      // Should still work as normal array
      expect(store.items.length).toBe(5);
      expect(store.items[2]).toBe(3);
    });

    it('should work with dynamic property generation', () => {
      const plugin: ValtioPlugin = {
        id: 'dynamic-props',
        onGet: (path, value, state) => {
          const propName = path[path.length - 1]?.toString();
          
          // Generate item_N properties dynamically
          if (propName?.startsWith('item_') && value === undefined) {
            const index = parseInt(propName.replace('item_', ''));
            if (!isNaN(index)) {
              return {
                id: index,
                name: `Item ${index}`,
                generated: true
              };
            }
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        title: 'Inventory'
      });

      // Access non-existent properties
      expect((store as any).item_1).toEqual({
        id: 1,
        name: 'Item 1',
        generated: true
      });
      
      expect((store as any).item_999).toEqual({
        id: 999,
        name: 'Item 999',
        generated: true
      });
      
      // Original properties still work
      expect(store.title).toBe('Inventory');
    });

    it('should handle recursive onGet calls', () => {
      const plugin: ValtioPlugin = {
        id: 'recursive',
        onGet: (path, value, state) => {
          // When accessing 'double', return twice the 'value' property
          if (path[path.length - 1] === 'double') {
            return (state as any).value * 2;
          }
          // When accessing 'triple', return three times the 'value' property
          if (path[path.length - 1] === 'triple') {
            return (state as any).value * 3;
          }
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        value: 10
      });

      expect((store as any).double).toBe(20);
      expect((store as any).triple).toBe(30);
      
      // Update value and check computed properties update
      store.value = 5;
      expect((store as any).double).toBe(10);
      expect((store as any).triple).toBe(15);
    });
  });

  describe('Integration with other hooks', () => {
    it('should work alongside beforeChange and afterChange', () => {
      const events: string[] = [];
      
      const plugin: ValtioPlugin = {
        id: 'integrated',
        onGet: (path, value) => {
          events.push(`onGet: ${path.join('.')}`);
          if (path[0] === 'computed') {
            return 'computed value';
          }
        },
        beforeChange: (path, value) => {
          events.push(`beforeChange: ${path.join('.')}`);
          return true;
        },
        afterChange: (path, value) => {
          events.push(`afterChange: ${path.join('.')}`);
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        normal: 'value',
        computed: 'original'
      });

      events.length = 0; // Clear init events
      
      // Access properties
      const normalValue = store.normal;
      const computedValue = store.computed;
      
      expect(normalValue).toBe('value');
      expect(computedValue).toBe('computed value');
      
      // Change property
      store.normal = 'new value';
      
      expect(events).toContain('onGet: normal');
      expect(events).toContain('onGet: computed');
      expect(events).toContain('beforeChange: normal');
      expect(events).toContain('afterChange: normal');
    });

    it('should provide path and root state for context navigation', () => {
      // This test demonstrates that we can use the path and root state
      // to implement computed properties that depend on parent context
      const plugin: ValtioPlugin = {
        id: 'state-access',
        onGet: (path, value, state) => {
          // Only handle 'summary' properties
          if (path[path.length - 1] !== 'summary') {
            return undefined;
          }
          
          // Navigate from root state to parent object
          let parent: any = state;
          for (let i = 0; i < path.length - 1; i++) {
            parent = parent?.[path[i]];
            if (!parent) break;
          }
          
          // Generate summary if parent has expected properties
          if (parent && typeof parent === 'object' && 'name' in parent && 'type' in parent) {
            return `${parent.name} (${parent.type})`;
          }
          
          // Return a default value for the test
          return 'No summary available';
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        user: {
          name: 'John',
          type: 'admin',
          nested: {
            name: 'Nested',
            type: 'object'
          }
        }
      });

      // Should get computed summary based on parent properties
      expect((store.user as any).summary).toBe('John (admin)');
      expect((store.user.nested as any).summary).toBe('Nested (object)');
    });
  });
});