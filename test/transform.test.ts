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
          return undefined;
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
          return undefined; // Always pass through
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
        firstName: 'Jane',
        lastName: '',
        price: 10,
        quantity: 5
      });

      expect((store as any).fullName).toBe('Jane');
      expect((store as any).total).toBe(50);
      
      // Should update when dependencies change
      store.lastName = 'Doe';
      expect((store as any).fullName).toBe('Jane Doe');
      
      store.quantity = 10;
      expect((store as any).total).toBe(100);
    });
  });

  describe('transformSet functionality', () => {
    it('should transform values before setting', () => {
      const plugin: ValtioPlugin = {
        id: 'string-transformer',
        transformSet: (path, value) => {
          if (typeof value === 'string') {
            return value.toUpperCase();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        name: 'initial',
        count: 0
      });

      store.name = 'john doe';
      store.count = 42;

      expect(store.name).toBe('JOHN DOE');
      expect(store.count).toBe(42);
    });

    it('should trim strings when setting', () => {
      const plugin: ValtioPlugin = {
        id: 'trimmer',
        transformSet: (path, value) => {
          if (typeof value === 'string') {
            return value.trim();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        name: '',
        email: ''
      });

      store.name = '   John Doe  ';
      store.email = '\t user@example.com \n';

      expect(store.name).toBe('John Doe');
      expect(store.email).toBe('user@example.com');
    });

    it('should validate and transform email addresses', () => {
      const plugin: ValtioPlugin = {
        id: 'email-transformer',
        transformSet: (path, value) => {
          const fieldName = path[path.length - 1];
          if (fieldName === 'email' && typeof value === 'string' && value.includes('@')) {
            return value.toLowerCase().trim();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ email: '' });

      store.email = '   JOHN.DOE@EXAMPLE.COM  ';

      expect(store.email).toBe('john.doe@example.com');
    });

    it('should add timestamps to objects', () => {
      const plugin: ValtioPlugin = {
        id: 'timestamp-adder',
        transformSet: (path, value) => {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const obj = value as Record<string, any>;
            if ('name' in obj && !('timestamp' in obj)) {
              return { ...obj, timestamp: 1754785610880 };
            }
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ items: [] as any[] });

      (store.items as any).push({ name: 'Item 1' });

      expect((store.items as any)[0]).toEqual({
        name: 'Item 1',
        timestamp: 1754785610880
      });

      // Objects with existing timestamp shouldn't be modified
      (store.items as any).push({ name: 'Item 2', timestamp: 12345 });
      expect((store.items as any)[1]).toEqual({
        name: 'Item 2',
        timestamp: 12345
      });
    });

    it('should sanitize HTML input', () => {
      const plugin: ValtioPlugin = {
        id: 'html-sanitizer',
        transformSet: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          if (fieldName?.endsWith('_html') && typeof value === 'string') {
            // Simple script tag removal
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
      expect(store.plainText).toBe('<script>alert("ok in plain text")</script>');
    });

    it('should normalize phone numbers', () => {
      const plugin: ValtioPlugin = {
        id: 'phone-normalizer',
        transformSet: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          if (fieldName === 'phone' && typeof value === 'string') {
            // Simple phone number formatting for US numbers
            const digits = value.replace(/\D/g, '');
            if (digits.length === 10) {
              return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
            }
          }
          if (fieldName === 'mobile' && typeof value === 'string') {
            // Different format for mobile
            return value.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        phone: '',
        mobile: ''
      });

      store.phone = '123-456-7890';
      expect(store.phone).toBe('(123) 456-7890');

      store.phone = '(555) 123 4567';
      expect(store.phone).toBe('(555) 123-4567');

      store.phone = '123'; // Too short
      expect(store.phone).toBe('123');

      store.mobile = '123-456-7890';
      expect(store.mobile).toBe('123-456-7890');
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
          const fieldName = path[path.length - 1]?.toString();
          if (fieldName === 'name' && typeof value === 'string') {
            return value.toUpperCase();
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use([trimPlugin, uppercasePlugin]);
      
      const store = instance({ 
        name: '',
        description: ''
      });

      store.name = '   john doe  ';
      store.description = '   some description  ';

      expect(store.name).toBe('JOHN DOE'); // Trimmed then uppercased
      expect(store.description).toBe('some description'); // Only trimmed
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
        transformGet: (path, value) => {
          return undefined; // This one returns undefined
        }
      };

      const instance = proxy.createInstance();
      instance.use([plugin1, plugin2, plugin3]);
      
      const store = instance({ test: 'original' });

      expect(store.test).toBe('from plugin2'); // Last non-undefined
    });

    it('should work with global and instance plugins', () => {
      const globalPlugin: ValtioPlugin = {
        id: 'global',
        transformSet: (path, value) => {
          if (typeof value === 'string') {
            return `[GLOBAL] ${value}`;
          }
          return undefined;
        }
      };

      const instancePlugin: ValtioPlugin = {
        id: 'instance',
        transformSet: (path, value) => {
          if (typeof value === 'string' && value.startsWith('[GLOBAL]')) {
            return `${value} [INSTANCE]`;
          }
          return undefined;
        }
      };

      proxy.use(globalPlugin);
      
      const instance = proxy.createInstance();
      instance.use(instancePlugin);
      
      const store = instance({ test: '' });

      store.test = 'hello';
      expect(store.test).toBe('[GLOBAL] hello [INSTANCE]');
    });
  });

  describe('onGet for observation (no transformation)', () => {
    it('should observe property access without changing values', () => {
      const accessLog: string[] = [];
      
      const plugin: ValtioPlugin = {
        id: 'observer',
        onGet: (path, value) => {
          accessLog.push(`Accessed: ${path.join('.')} = ${value}`);
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        name: 'John',
        age: 30
      });

      // Access properties
      const name = store.name;
      const age = store.age;

      expect(name).toBe('John');
      expect(age).toBe(30);
      expect(accessLog).toContain('Accessed: name = John');
      expect(accessLog).toContain('Accessed: age = 30');
    });

    it('should work alongside transformGet', () => {
      const accessLog: string[] = [];
      
      const plugin: ValtioPlugin = {
        id: 'hybrid',
        onGet: (path, value) => {
          accessLog.push(`Observed: ${path.join('.')}`);
        },
        transformGet: (path, value) => {
          if (path[0] === 'doubled') {
            return (value as number) * 2;
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        doubled: 5,
        normal: 10
      });

      expect(store.doubled).toBe(10); // Transformed
      expect(store.normal).toBe(10); // Not transformed
      expect(accessLog).toContain('Observed: doubled');
      expect(accessLog).toContain('Observed: normal');
    });
  });

  describe('Complex transformation scenarios', () => {
    it('should implement a validation system with transformSet', () => {
      const plugin: ValtioPlugin = {
        id: 'validation-system',
        
        transformSet: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          
          // Transform emails to lowercase and trim - only if valid format
          if (fieldName === 'email' && typeof value === 'string' && value.includes('@')) {
            return value.toLowerCase().trim();
          }
          
          // Transform age to integer
          if (fieldName === 'age' && typeof value === 'number') {
            return Math.floor(value);
          }
          
          return undefined;
        },
        
        beforeChange: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          
          // Validate email format (after transformation attempt)
          if (fieldName === 'email' && typeof value === 'string' && !value.includes('@')) {
            return false;
          }
          
          // Validate age is positive (after transformation)
          if (fieldName === 'age' && typeof value === 'number' && value < 0) {
            return false;
          }
          
          return true;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        email: 'user@example.com',
        age: 30
      });

      // Valid transformations
      store.email = '   USER@EXAMPLE.COM  ';
      expect(store.email).toBe('user@example.com');
      
      store.age = 30.7;
      expect(store.age).toBe(30);
      
      // Should keep previous valid values
      store.email = 'invalid-email';
      expect(store.email).toBe('user@example.com');
      expect(store.age).toBe(30);
    });

    it('should implement data normalization across multiple fields', () => {
      const plugin: ValtioPlugin = {
        id: 'normalizer',
        transformSet: (path, value) => {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const obj = value as any;
            if (obj.name && obj.email) {
              return {
                ...obj,
                name: obj.name.trim().toLowerCase(),
                email: obj.email.trim(),
                username: obj.name.trim().toLowerCase().replace(/\s+/g, '_'),
                id: Math.random().toString(36).substr(2, 9),
                createdAt: new Date().toISOString()
              };
            }
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ users: [] as any[] });

      (store.users as any).push({ name: '  John Doe  ', email: 'john@example.com' });

      expect((store.users as any)[0].name).toBe('john doe');
      expect((store.users as any)[0].email).toBe('john@example.com');
      expect((store.users as any)[0].username).toBe('john_doe');
      expect((store.users as any)[0].id).toBeDefined();
      expect((store.users as any)[0].createdAt).toBeDefined();
    });

    it('should implement transformGet for currency formatting', () => {
      const plugin: ValtioPlugin = {
        id: 'currency',
        transformGet: (path, value) => {
          const fieldName = path[path.length - 1]?.toString();
          if (fieldName?.endsWith('_currency') && typeof value === 'number') {
            return new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD'
            }).format(value);
          }
          return undefined;
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ 
        price: 1234.56,
        price_currency: 1234.56,
        total_currency: 9876.54
      });

      expect(store.price).toBe(1234.56);
      expect(store.price_currency).toBe('$1,234.56');
      expect(store.total_currency).toBe('$9,876.54');
    });
  });

  describe('Error handling', () => {
    it('should handle errors in transformGet gracefully', () => {
      const plugin: ValtioPlugin = {
        id: 'error-plugin',
        transformGet: () => {
          throw new Error('transformGet error');
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ test: 'value' });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(store.test).toBe('value'); // Should return original value
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle errors in transformSet gracefully', () => {
      const plugin: ValtioPlugin = {
        id: 'error-plugin',
        transformSet: () => {
          throw new Error('transformSet error');
        }
      };

      const instance = proxy.createInstance();
      instance.use(plugin);
      
      const store = instance({ errorProp: 'initial' });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      store.errorProp = 'new value';
      expect(store.errorProp).toBe('new value'); // Should work despite error
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });
});