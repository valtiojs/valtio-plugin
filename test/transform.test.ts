import { expect, describe, it, vi, beforeEach } from 'vitest';
import { proxy, type ValtioPlugin } from '../src';

describe('Transform Plugin Hooks', () => {
  beforeEach(() => {
    proxy.clearPlugins();
    vi.clearAllMocks();
  });

  describe('transformGet functionality', () => {
    it('should allow plugin to return custom value', () => {
      const plugin: ValtioPlugin = {
        id: 'custom-value',
        transformGet: (path, value) => {
          if (path[0] === 'customProp') {
            return 'custom value from plugin';
          }
          return undefined; // No transformation
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
        transformGet: (path, value) => {
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
        transformGet: (path, value) => {
          if (path.join('.') === 'user.name') {
            return value ? String(value).toUpperCase() : value;
          }
          return undefined;
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

    it('should create virtual properties that do not exist', () => {
      const plugin: ValtioPlugin = {
        id: 'virtual-props',
        transformGet: (path, value) => {
          // Create virtual properties starting with 'virtual_'
          if (path[path.length - 1]?.toString().startsWith('virtual_')) {
            const propName = path[path.length - 1].toString();
            return `Virtual: ${propName}`;
          }
          return undefined;
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
        transformGet: (path, value, state) => {
          const pathStr = path.join('.');
          
          if (pathStr === 'fullName') {
            const s = state as any;
            return `${s.firstName || ''} ${s.lastName || ''}`.trim();
          }
          
          if (pathStr === 'total') {
            const s = state as any;
            return (s.price || 0) * (s.quantity || 0);
          }
          
          return undefined;
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

  describe('transformSet functionality', () => {
    it('should transform values before setting', () => {
      const plugin: ValtioPlugin = {
        id: 'set-transform',
        transformSet: (path, value) => {
          // Auto-uppercase all string values
          if (typeof value === 'string') {
            return value.toUpperCase();
          }
          return undefined; // No transformation
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ name: '', count: 0 });
      
      store.name = 'john doe';
      store.count = 42;
      
      expect(store.name).toBe('JOHN DOE');
      expect(store.count).toBe(42); // Numbers unchanged
    });

    it('should trim strings when setting', () => {
      const plugin: ValtioPlugin = {
        id: 'trim-strings',
        transformSet: (path, value) => {
          if (typeof value === 'string') {
            return value.trim();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ name: '', email: '' });
      
      store.name = '  John Doe  ';
      store.email = '\t user@example.com \n';
      
      expect(store.name).toBe('John Doe');
      expect(store.email).toBe('user@example.com');
    });

    it('should validate and transform email addresses', () => {
      const plugin: ValtioPlugin = {
        id: 'email-transform',
        transformSet: (path, value) => {
          if (path[path.length - 1] === 'email' && typeof value === 'string') {
            // Convert to lowercase and trim
            return value.toLowerCase().trim();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ email: '' });
      
      store.email = '  JOHN.DOE@EXAMPLE.COM  ';
      expect(store.email).toBe('john.doe@example.com');
    });

    it('should add timestamps to objects', () => {
      const plugin: ValtioPlugin = {
        id: 'timestamp',
        transformSet: (path, value) => {
          // Add timestamp to all objects (except those that already have one)
          if (value && typeof value === 'object' && !Array.isArray(value) && !('timestamp' in value)) {
            return { ...value, timestamp: Date.now() };
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ items: [] as any[] });
      
      store.items.push({ name: 'Item 1' });
      store.items.push({ name: 'Item 2', timestamp: 12345 }); // Already has timestamp
      
      expect(store.items[0]).toEqual({
        name: 'Item 1',
        timestamp: expect.any(Number)
      });
      
      // Should not override existing timestamp
      expect(store.items[1]).toEqual({
        name: 'Item 2',
        timestamp: 12345
      });
    });

    it('should sanitize HTML input', () => {
      const plugin: ValtioPlugin = {
        id: 'sanitize',
        transformSet: (path, value) => {
          if (typeof value === 'string' && path[path.length - 1]?.toString().endsWith('_html')) {
            // Simple HTML sanitization - remove script tags
            return value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        content_html: '',
        description_html: '',
        plainText: ''
      });
      
      store.content_html = '<p>Safe content</p><script>alert("bad")</script>';
      store.description_html = '<div>Good content</div>';
      store.plainText = '<script>alert("ok in plain text")</script>';
      
      expect(store.content_html).toBe('<p>Safe content</p>');
      expect(store.description_html).toBe('<div>Good content</div>');
      expect(store.plainText).toBe('<script>alert("ok in plain text")</script>'); // Not transformed
    });

    it('should normalize phone numbers', () => {
      const plugin: ValtioPlugin = {
        id: 'phone-normalize',
        transformSet: (path, value) => {
          if (path[path.length - 1] === 'phone' && typeof value === 'string') {
            // Remove all non-digits
            const digits = value.replace(/\D/g, '');
            // Format as (XXX) XXX-XXXX if 10 digits
            if (digits.length === 10) {
              return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
            }
            return digits; // Return just digits if not 10 digits
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ phone: '', mobile: '' });
      
      store.phone = '123-456-7890';
      expect(store.phone).toBe('(123) 456-7890');
      
      store.phone = '(555) 123 4567';
      expect(store.phone).toBe('(555) 123-4567');
      
      store.phone = '123';
      expect(store.phone).toBe('123'); // Too short, just digits
      
      // Non-phone fields shouldn't be affected
      store.mobile = '123-456-7890';
      expect(store.mobile).toBe('123-456-7890'); // Not transformed
    });
  });

  describe('Multiple plugins with transforms', () => {
    it('should chain transformSet plugins', () => {
      const trimPlugin: ValtioPlugin = {
        id: 'trim',
        transformSet: (path, value) => {
          if (typeof value === 'string') {
            return value.trim();
          }
          return undefined;
        }
      };

      const uppercasePlugin: ValtioPlugin = {
        id: 'uppercase',
        transformSet: (path, value) => {
          if (typeof value === 'string' && path[path.length - 1] === 'name') {
            return value.toUpperCase();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use([trimPlugin, uppercasePlugin]);
      
      const store = instance({ name: '', description: '' });
      
      store.name = '  john doe  ';
      store.description = '  some description  ';
      
      // Name should be trimmed AND uppercased
      expect(store.name).toBe('JOHN DOE');
      // Description should only be trimmed
      expect(store.description).toBe('some description');
    });

    it('should use last transformGet plugin that returns non-undefined', () => {
      const plugin1: ValtioPlugin = {
        id: 'plugin1',
        transformGet: (path, value) => {
          if (path[0] === 'test') {
            return 'from plugin1';
          }
          return undefined;
        }
      };

      const plugin2: ValtioPlugin = {
        id: 'plugin2',
        transformGet: (path, value) => {
          if (path[0] === 'test') {
            return 'from plugin2';
          }
          return undefined;
        }
      };

      const plugin3: ValtioPlugin = {
        id: 'plugin3',
        transformGet: () => undefined // This one returns undefined
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
        transformGet: (path, value) => {
          if (path[0] === 'globalValue') {
            return 'from global';
          }
          return undefined;
        }
      };

      const instancePlugin: ValtioPlugin = {
        id: 'instance',
        transformGet: (path, value) => {
          if (path[0] === 'instanceValue') {
            return 'from instance';
          }
          // Override global plugin for globalValue
          if (path[0] === 'globalValue') {
            return 'overridden by instance';
          }
          return undefined;
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

  describe('onGet for observation (no transformation)', () => {
    it('should observe property access without changing values', () => {
      const accessLog: string[] = [];
      
      const plugin: ValtioPlugin = {
        id: 'observer',
        onGet: (path, value) => {
          accessLog.push(`Accessed: ${path.join('.')} = ${value}`);
          // Note: onGet doesn't return anything, just observes
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        name: 'John',
        age: 30,
        nested: { value: 'test' }
      });

      // Access properties
      const name = store.name;
      const age = store.age;
      const nestedValue = store.nested.value;

      expect(name).toBe('John');
      expect(age).toBe(30);
      expect(nestedValue).toBe('test');

      // Check that accesses were logged
      expect(accessLog).toContain('Accessed: name = John');
      expect(accessLog).toContain('Accessed: age = 30');
      expect(accessLog).toContain('Accessed: nested.value = test');
    });

    it('should work alongside transformGet', () => {
      const accessLog: string[] = [];
      
      const plugin: ValtioPlugin = {
        id: 'observer-transformer',
        onGet: (path, value) => {
          accessLog.push(`Observed: ${path.join('.')}`);
        },
        transformGet: (path, value) => {
          if (typeof value === 'string') {
            return value.toUpperCase();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        name: 'john',
        count: 42
      });

      const name = store.name;
      const count = store.count;

      // Value should be transformed
      expect(name).toBe('JOHN');
      expect(count).toBe(42);

      // Access should be observed
      expect(accessLog).toContain('Observed: name');
      expect(accessLog).toContain('Observed: count');
    });
  });

  describe('Complex transformation scenarios', () => {
    it('should implement a validation system with transformSet', () => {
      const plugin: ValtioPlugin = {
        id: 'validation',
        transformSet: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          
          // Email validation
          if (fieldName === 'email' && typeof value === 'string') {
            if (!value.includes('@')) {
              console.warn('Invalid email format');
              return undefined; // Keep original value
            }
            return value.toLowerCase().trim();
          }
          
          // Age validation
          if (fieldName === 'age' && typeof value === 'number') {
            if (value < 0 || value > 150) {
              console.warn('Invalid age');
              return undefined; // Keep original value
            }
            return Math.floor(value); // Round down to integer
          }
          
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        email: 'default@example.com',
        age: 25
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Valid transformations
      store.email = '  USER@EXAMPLE.COM  ';
      store.age = 30.7;
      
      expect(store.email).toBe('user@example.com');
      expect(store.age).toBe(30);

      // Invalid transformations
      store.email = 'invalid-email';
      store.age = -5;
      
      // Should keep previous valid values
      expect(store.email).toBe('user@example.com');
      expect(store.age).toBe(30);
      
      expect(consoleSpy).toHaveBeenCalledWith('Invalid email format');
      expect(consoleSpy).toHaveBeenCalledWith('Invalid age');

      consoleSpy.mockRestore();
    });

    it('should implement data normalization across multiple fields', () => {
      const plugin: ValtioPlugin = {
        id: 'normalization',
        transformSet: (path, value) => {
          // Normalize user objects
          if (typeof value === 'object' && value && 'name' in value) {
            const normalized = { ...value } as any;
            
            // Normalize name fields
            if (typeof normalized.name === 'string') {
              normalized.name = normalized.name.trim().toLowerCase();
            }
            
            // Auto-generate username from name if not provided
            if (!normalized.username && normalized.name) {
              normalized.username = normalized.name.replace(/\s+/g, '_');
            }
            
            // Ensure required fields
            normalized.id = normalized.id || Math.random().toString(36);
            normalized.createdAt = normalized.createdAt || new Date().toISOString();
            
            return normalized;
          }
          
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ users: [] as any[] });
      
      store.users.push({
        name: '  John Doe  ',
        email: 'john@example.com'
      });
      
      const user = store.users[0];
      expect(user.name).toBe('john doe');
      expect(user.username).toBe('john_doe');
      expect(user.email).toBe('john@example.com');
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeDefined();
    });

    it('should implement transformGet for currency formatting', () => {
      const plugin: ValtioPlugin = {
        id: 'currency',
        transformGet: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          
          // Format currency fields
          if (fieldName?.endsWith('_currency') && typeof value === 'number') {
            return new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD'
            }).format(value);
          }
          
          // Format percentage fields
          if (fieldName?.endsWith('_percent') && typeof value === 'number') {
            return new Intl.NumberFormat('en-US', {
              style: 'percent',
              minimumFractionDigits: 2
            }).format(value / 100);
          }
          
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        price: 1234.56,
        price_currency: 1234.56,
        discount: 15,
        discount_percent: 15
      });

      expect(store.price).toBe(1234.56); // Unchanged
      expect(store.price_currency).toBe('$1,234.56');
      expect(store.discount).toBe(15); // Unchanged
      expect(store.discount_percent).toBe('15.00%');
    });
  });

  describe('Error handling', () => {
    it('should handle errors in transformGet gracefully', () => {
      const plugin: ValtioPlugin = {
        id: 'error-plugin',
        transformGet: (path, value) => {
          if (path[0] === 'errorProp') {
            throw new Error('transformGet error');
          }
          return undefined;
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

    it('should handle errors in transformSet gracefully', () => {
      const plugin: ValtioPlugin = {
        id: 'error-plugin',
        transformSet: (path, value) => {
          if (path[0] === 'errorProp') {
            throw new Error('transformSet error');
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        normalProp: 'normal',
        errorProp: 'original'
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Should not throw, value should be set without transformation
      store.errorProp = 'new value';
      expect(store.errorProp).toBe('new value');
      
      // Error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in plugin'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });
});