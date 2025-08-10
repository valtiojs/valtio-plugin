# Valtio Plugin System

A powerful plugin system that extends Valtio with custom functionality while maintaining full TypeScript support and API compatibility.

[![NPM Version](https://img.shields.io/npm/v/valtio-plugin.svg)](https://www.npmjs.com/package/valtio-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## ✨ Key Features

- 🔌 **Global & Instance Plugins**: Extend Valtio globally or per-instance
- 📘 **Full TypeScript Support**: Complete autocomplete when importing from 'valtio'
- 🔄 **Rich Lifecycle Hooks**: `onInit`, `beforeChange`, `afterChange`, `onSubscribe`, `onAttach`
- 🎯 **Direct Plugin Access**: Access plugins as properties (e.g., `proxy.logger`)
- ⛓️ **Method Chaining**: `proxy.use(plugin1).use(plugin2)`
- 🌍 **Module Augmentation**: Import from 'valtio' and get enhanced functionality
- 🎪 **Zero Breaking Changes**: Works alongside existing Valtio code

## 🚀 Quick Start

```bash
# Install
npm install valtio valtio-plugin

# Run the example
node examples/logging-example.js
```

See the [`examples/`](./examples) directory for complete usage examples!

## 📘 TypeScript Magic

When you import this package, the `proxy` from 'valtio' automatically gets enhanced with full TypeScript support:

```typescript
import { proxy } from 'valtio'  // Standard valtio import
import 'valtio-plugin'          // Enables the magic ✨

// Now proxy has enhanced methods with full autocomplete:
proxy.use(myPlugin)           // ✅ Full TypeScript support
proxy.clearPlugins()          // ✅ Autocomplete works
proxy.createInstance()        // ✅ Returns ProxyFactory
proxy.getPlugins()           // ✅ Returns readonly ValtioPlugin[]

// Access your plugins with typing:
const logger = proxy.logger   // ✅ Your plugin is accessible
```

## 🌍 Global Plugins

Register plugins that affect **all** proxy instances:

```typescript
import { proxy } from 'valtio'
import { ValtioPlugin } from 'valtio-plugin'

// Create a logging plugin
const loggingPlugin: ValtioPlugin = {
  id: 'logger',
  name: 'Global Logger',
  
  // Lifecycle hooks
  onInit: () => console.log('🚀 Logger initialized'),
  
  beforeChange: (path, newValue, oldValue) => {
    console.log(`📝 ${path.join('.')} changing from ${oldValue} to ${newValue}`)
    return true // Allow change
  },
  
  afterChange: (path, newValue) => {
    console.log(`✅ ${path.join('.')} = ${newValue}`)
  },
  
  // Plugin API methods
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`)
}

// Register globally - affects ALL proxy instances
proxy.use(loggingPlugin)

// Access plugin methods with full TypeScript support
proxy.logger.info('Application started!')

// Create stores - logging automatically applies
const userStore = proxy({ name: 'John', age: 30 })
const appStore = proxy({ theme: 'dark', version: '1.0' })

// All changes are logged
userStore.name = 'Jane'      // Logs the change
appStore.theme = 'light'     // Logs the change

// Create instances that inherit global plugins
const instance = proxy.createInstance()
const instanceStore = instance({ data: 'test' })
instanceStore.data = 'updated' // Also logged by global plugin!
```

## 🏠 Instance Plugins

Create isolated proxy instances with specific plugins:

```typescript
import { proxy } from 'valtio'
import { ValtioPlugin } from 'valtio-plugin'

// Create validation plugin
const validationPlugin: ValtioPlugin = {
  id: 'validator',
  
  beforeChange: (path, value, oldValue) => {
    if (typeof value === 'string' && value.length < 2) {
      console.log(`❌ ${path.join('.')} must be at least 2 characters`)
      return false // Prevent change
    }
    return true
  },
  
  // Plugin API
  validateRequired: (obj, fields) => {
    return fields.every(field => obj[field] != null)
  }
}

// Create instance with specific plugins
const instance = proxy.createInstance()
instance.use(validationPlugin)

// Access instance plugin methods
instance.validator.validateRequired({ name: 'John' }, ['name']) // true

// Create store with instance plugins
const formStore = instance({
  name: '',
  email: ''
})

// Validation applies only to this instance
formStore.name = 'A'     // ❌ Prevented by validation
formStore.name = 'Alice' // ✅ Allowed

// Other proxy instances are unaffected
const otherStore = proxy({ name: 'X' }) // ✅ No validation
```

## 🔄 Plugin Lifecycle Hooks

Plugins can hook into key points in the state management flow:

```typescript
const comprehensivePlugin: ValtioPlugin = {
  id: 'comprehensive',
  
  // Called when plugin is first registered
  onInit: () => {
    console.log('Plugin initialized')
  },
  
  // Called when plugin is attached to a factory
  onAttach: (proxyFactory) => {
    console.log('Plugin attached to factory')
    // Store factory reference for creating related proxies
  },
  
  // Called before any property change
  beforeChange: (path, newValue, oldValue, state) => {
    console.log(`Before: ${path.join('.')} = ${oldValue} -> ${newValue}`)
    return true // Return false to prevent change
  },
  
  // Called after any property change
  afterChange: (path, newValue, state) => {
    console.log(`After: ${path.join('.')} = ${newValue}`)
  },
  
  // Called when a subscription is created
  onSubscribe: (proxyObject, callback) => {
    console.log('New subscription created')
  },
  
  // Called when creating snapshots
  onSnapshot: (snapshot) => {
    console.log('Snapshot created')
  },

  onGet: (path, value) => {
    console.log(`Path: ${path} = ${value}`)
  },

  transformGet: (path, value) => {
    if (path.includes("foo")) {
      // always return "bar" if the path contains "foo"
      return "bar"
    }
    return value
  },

  transformSet: (path, value) => {
    if (path === "boo") {
      // override whatever the value was being sent to and instead return "boo"
      return "AHHH"
    }
    return value
  },

  canProxy: (value, prev) => {
    // return a boolean value to tell valtio whether or not to proxy that object
    if (typeof value === 'number') {
      return false
    }
    return prev(value)
  },
  
  // Called when factory is disposed
  onDispose: () => {
    console.log('Plugin cleaning up')
  }
}
```

## 🎯 Plugin API Access

Access your plugins directly as properties with full TypeScript support:

```typescript
// Create plugin with custom methods
const analyticsPlugin: ValtioPlugin = {
  id: 'analytics',
  
  // Plugin methods
  track: (event: string, data: any) => {
    console.log(`📊 ${event}:`, data)
  },
  
  identify: (userId: string) => {
    console.log(`👤 User: ${userId}`)
  },
  
  // Nested API
  events: {
    pageView: (page: string) => console.log(`📄 Page: ${page}`),
    click: (element: string) => console.log(`🖱️ Click: ${element}`)
  },
  
  // Configuration
  config: {
    debug: true,
    endpoint: 'https://api.example.com'
  }
}

proxy.use(analyticsPlugin)

// Access with full TypeScript autocomplete
proxy.analytics.track('user_signup', { plan: 'pro' })
proxy.analytics.identify('user123')
proxy.analytics.events.pageView('/dashboard')
proxy.analytics.config.debug = false
```

## 🏗️ Advanced Plugin Examples

### Smart Logger with onAttach

```typescript
const createSmartLogger = (): ValtioPlugin => {
  let proxyFactory: any = null
  const logs: any[] = []
  
  return {
    id: 'smart-logger',
    
    // Store factory reference when attached
    onAttach: (factory) => {
      proxyFactory = factory
    },
    
    afterChange: (path, value) => {
      logs.push({
        path: path.join('.'),
        value,
        timestamp: new Date().toISOString()
      })
    },
    
    // Plugin API methods
    getLogs: () => [...logs],
    
    clearLogs: () => {
      logs.length = 0
    },
    
    // Create a log viewer using the same factory
    createLogViewer: () => {
      if (!proxyFactory) throw new Error('Plugin not attached')
      
      // Create new proxy with same plugins
      return proxyFactory({
        logs: [],
        filter: '',
        refresh: () => {
          // Access logs from main plugin
          this.logs = [...logs]
        }
      })
    }
  }
}
```

### Persistence Plugin

```typescript
const createPersistencePlugin = (storageKey: string): ValtioPlugin => {
  return {
    id: 'persistence',
    
    onInit: () => {
      console.log(`💾 Persistence enabled for key: ${storageKey}`)
    },
    
    afterChange: (path, value, state) => {
      // Auto-save after changes
      this.save()
    },
    
    onDispose: () => {
      this.save() // Final save
    },
    
    // Plugin API
    save: () => {
      try {
        const snapshot = proxy.snapshot(state)
        localStorage.setItem(storageKey, JSON.stringify(snapshot))
        console.log('💾 State saved')
      } catch (error) {
        console.error('Save failed:', error)
      }
    },
    
    load: () => {
      try {
        const saved = localStorage.getItem(storageKey)
        return saved ? JSON.parse(saved) : null
      } catch (error) {
        console.error('Load failed:', error)
        return null
      }
    },
    
    clear: () => {
      localStorage.removeItem(storageKey)
      console.log('💾 Storage cleared')
    }
  }
}

// Usage
proxy.use(createPersistencePlugin('my-app-state'))

const store = proxy({ count: 0, name: 'John' })

// Auto-loads saved state
const savedState = proxy.persistence.load()
if (savedState) {
  Object.assign(store, savedState)
}

// Changes are auto-saved
store.count++ // Automatically persisted
```

### Validation Plugin

```typescript
const createValidationPlugin = (): ValtioPlugin => {
  const errors = new Map<string, string[]>()
  
  return {
    id: 'validation',
    
    beforeChange: (path, value, oldValue, state) => {
      const pathKey = path.join('.')
      const fieldErrors: string[] = []
      
      // Required validation
      if (value == null || value === '') {
        fieldErrors.push('Field is required')
      }
      
      // String length validation
      if (typeof value === 'string' && value.length < 2) {
        fieldErrors.push('Must be at least 2 characters')
      }
      
      // Email validation
      if (pathKey.includes('email') && value) {
        const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
        if (!emailRegex.test(value)) {
          fieldErrors.push('Invalid email format')
        }
      }
      
      if (fieldErrors.length > 0) {
        errors.set(pathKey, fieldErrors)
        console.log(`❌ Validation failed for ${pathKey}:`, fieldErrors)
        return false // Prevent change
      }
      
      errors.delete(pathKey)
      return true
    },
    
    // Plugin API
    getErrors: () => Object.fromEntries(errors),
    
    hasErrors: () => errors.size > 0,
    
    clearErrors: () => {
      errors.clear()
    },
    
    validateField: (path: string, value: any) => {
      // Manual validation
      return !this.getErrors()[path]
    }
  }
}
```

## 🔄 Method Chaining

Chain plugin registrations and method calls:

```typescript
import { proxy } from 'valtio'

// Chain plugin registration
proxy
  .use(loggingPlugin)
  .use(validationPlugin)
  .use(persistencePlugin)

// Method chaining returns the proxy for fluent API
const result = proxy
  .use(analyticsPlugin)
  .use(debugPlugin)

// Access chained plugin methods
result.analytics.track('app_loaded')
result.debug.enable()
```

## 🏭 Factory Pattern

Create reusable factory configurations:

```typescript
// Create configured factories
const createDebugFactory = () => {
  return proxy.createInstance()
    .use(createLoggingPlugin({ debug: true }))
    .use(createValidationPlugin())
    .use(createAnalyticsPlugin({ debug: true }))
}

const createProductionFactory = () => {
  return proxy.createInstance()
    .use(createPersistencePlugin('prod-state'))
    .use(createValidationPlugin())
    .use(createAnalyticsPlugin({ debug: false }))
}

// Use in different environments
const factory = process.env.NODE_ENV === 'development' 
  ? createDebugFactory()
  : createProductionFactory()

const store = factory({ user: null, settings: {} })
```

## ⚛️ React Integration

Perfect integration with Valtio's React hooks:

```jsx
import { useSnapshot } from 'valtio/react'
import { proxy } from 'valtio'
import 'valtio-plugin'

// Set up global plugins
proxy.use(createLoggingPlugin())
proxy.use(createPersistencePlugin('app-state'))

const store = proxy({
  count: 0,
  increment: () => store.count++,
  decrement: () => store.count--,
  reset: () => store.count = 0
})

// Load persisted state
const saved = proxy.persistence.load()
if (saved) Object.assign(store, saved)

function Counter() {
  const snap = useSnapshot(store)
  
  return (
    <div>
      <p>Count: {snap.count}</p>
      <button onClick={snap.increment}>+</button>
      <button onClick={snap.decrement}>-</button>
      <button onClick={snap.reset}>Reset</button>
      <button onClick={() => proxy.persistence.clear()}>
        Clear Storage
      </button>
    </div>
  )
}
```

## 📚 API Reference

### Global Proxy Methods

These methods are available on the global `proxy` import from 'valtio':

```typescript
import { proxy } from 'valtio'
import 'valtio-plugin'

// Plugin management
proxy.use(plugin | plugins[])     // Register global plugins
proxy.clearPlugins()              // Clear all global plugins  
proxy.getPlugins()               // Get readonly plugin list
proxy.removePlugin(id)           // Remove specific plugin

// Instance creation
proxy.createInstance()           // Create new factory instance

// Standard Valtio methods (enhanced with plugin hooks)
proxy.subscribe(obj, callback)   // Subscribe with plugin hooks
proxy.snapshot(obj)             // Snapshot with plugin hooks

// Plugin access
proxy[pluginId]                 // Access plugin by ID
```

### Instance Factory Methods

Created via `proxy.createInstance()`:

```typescript
const instance = proxy.createInstance()

// Plugin management
instance.use(plugin | plugins[]) // Register instance plugins
instance.dispose()              // Clean up and dispose

// Proxy creation
instance(initialState)          // Create proxy with plugins

// Enhanced methods
instance.subscribe(obj, cb)     // Subscribe with hooks
instance.snapshot(obj)         // Snapshot with hooks

// Plugin access
instance[pluginId]             // Access plugin by ID
```

### ValtioPlugin Interface

```typescript
interface ValtioPlugin {
  id: string                    // Required: unique identifier
  name?: string                // Optional: display name
  
  // Lifecycle hooks (all optional)
  onInit?: () => void
  onAttach?: (factory) => void
  beforeChange?: (path, newValue, oldValue, state) => boolean | undefined
  afterChange?: (path, newValue, state) => void
  onSubscribe?: (proxyObject, callback) => void
  onSnapshot?: (snapshot) => void
  onDispose?: () => void
  onGet?: (path: string[], value: unknown, state: object) => void
  transformGet?: (path: string[], value: unknown, state: object) => unknown | void
  transformSet?: (path: string[], value: unknown, state: object) => unknown | void
  canProxy?: (value: unknown) => boolean | undefined
  
  // Custom properties (plugin API)
  [key: string]: unknown
}
```

## 🎨 Plugin Development Guide

### Plugin Structure

```typescript
const createMyPlugin = (options = {}) => {
  // Private state
  let pluginState = {}
  
  return {
    id: 'my-plugin',
    name: 'My Awesome Plugin',
    
    // Lifecycle hooks
    onInit: () => {
      // Initialize plugin
    },
    
    onAttach: (factory) => {
      // Store factory reference if needed
    },
    
    beforeChange: (path, value, oldValue, state) => {
      // Validate or transform changes
      return true // or false to prevent
    },
    
    afterChange: (path, value, state) => {
      // React to changes
    },

    transformGet: (path, value) => {
      // Use this if you need to send special values back when a property is accessed
    },

    transformSet: (path, value) => {
      // Use this to transform a value while it is being set
    },

    canProxy: (value) => {
      // You can use this to overwrite the default canProxy global function from valtio
      // This can either be place on the global proxy object or on instances
    },
    
    onDispose: () => {
      // Cleanup resources
    },
    
    // Public API methods
    publicMethod: () => {
      // Plugin functionality
    },
  }
}
```

### Best Practices

1. **Use descriptive IDs**: `'logger'`, `'validation'`, `'persistence'`
2. **Handle errors gracefully**: Don't break the app if plugin fails
3. **Provide configuration**: Make plugins customizable
4. **Use onDispose**: Clean up timers, subscriptions, etc.
5. **Type your plugins**: Export TypeScript interfaces
6. **Document your API**: Clear method names and documentation

### Publishing Plugins

```typescript
// my-valtio-plugin/index.ts
import { ValtioPlugin } from 'valtio-plugin'

export interface MyPluginAPI extends ValtioPlugin {
  doSomething: () => void
  config: { enabled: boolean }
}

export const createMyPlugin = (options = {}): MyPluginAPI => {
  return {
    id: 'my-plugin',
    doSomething: () => console.log('Hello!'),
    config: { enabled: true, ...options }
  }
}

// Usage by consumers
import { proxy } from 'valtio'
import { createMyPlugin } from 'my-valtio-plugin'

proxy.use(createMyPlugin({ enabled: true }))
```

## 🚀 Examples

Check out the [`examples/`](./examples) directory for:

- **`logging-example.js`** - Working JavaScript example
- **`typescript-example.ts`** - TypeScript with full autocomplete
- **`autocomplete-demo.ts`** - Interactive demo for testing TypeScript support

```bash
# Run examples
node examples/logging-example.js
npx tsx examples/typescript-example.ts
```

## 🔧 Installation

```bash
npm install valtio valtio-plugin
```

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests to improve the plugin system.

---

**Ready to extend Valtio?** Start with the examples and build your first plugin! 🚀