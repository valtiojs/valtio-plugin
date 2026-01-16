# Valtio Plugin System

A powerful plugin system that extends Valtio with custom functionality while maintaining full TypeScript support and API compatibility.

[![NPM Version](https://img.shields.io/npm/v/valtio-plugin.svg)](https://www.npmjs.com/package/valtio-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## ✨ Key Features

- 🔌 **Global & Instance Plugins**: Extend Valtio globally or per-instance
- 📘 **Full TypeScript Support**: Complete autocomplete when importing from 'valtio'
- 🔄 **Rich Lifecycle Hooks**: `onInit`, `beforeChange`, `afterChange`, `onSubscribe`, `onAttach`
- 🎯 **Direct Plugin Access**: Access plugins as properties (e.g., `proxy.logger`) or via reference
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
import { proxy } from 'valtio-plugin'  // import augmented proxy

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
import { proxy, type ValtioPlugin } from 'valtio-plugin'

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

// Access plugin methods - both patterns work:
proxy.logger.info('Application started!')
// OR keep a reference:
loggingPlugin.info('Application started!')

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
import { proxy, type ValtioPlugin } from 'valtio-plugin'

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

// Access instance plugin methods - both patterns work:
instance.validator.validateRequired({ name: 'John' }, ['name']) // true
// OR keep a reference:
validationPlugin.validateRequired({ name: 'John' }, ['name']) // true

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

  // Called when a property is accessed
  onGet: (path, value) => {
    console.log(`Path: ${path.join('.')} = ${value}`)
  },

  // Transform value on get
  transformGet: (path, value) => {
    if (path.includes("foo")) {
      // always return "bar" if the path contains "foo"
      return "bar"
    }
    return value
  },

  // Transform value on set
  transformSet: (path, value) => {
    if (path[path.length - 1] === "boo") {
      // override whatever value was being set
      return "AHHH"
    }
    return value
  },

  // Control what gets proxied
  canProxy: (value, defaultCanProxy) => {
    // return false to prevent proxying
    if (typeof value === 'number') {
      return false
    }
    return defaultCanProxy(value)
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

// Access with full TypeScript autocomplete - both patterns work:
proxy.analytics.track('user_signup', { plan: 'pro' })
proxy.analytics.identify('user123')
proxy.analytics.events.pageView('/dashboard')
proxy.analytics.config.debug = false

// OR use the plugin reference directly:
analyticsPlugin.track('user_signup', { plan: 'pro' })
```

## 🏗️ Advanced Plugin Examples

### Smart Logger with onAttach

```typescript
const createSmartLogger = (): ValtioPlugin => {
  let proxyFactory: ProxyFactory | null = null
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
        refresh: function() {
          this.logs = [...logs]
        }
      })
    }
  }
}

// Usage
const logger = createSmartLogger()
proxy.use(logger)

// Access methods via reference
const viewer = logger.createLogViewer()
```

### Simple Persistence Plugin (see [valtio-persist-plugin](https://gihtub.com/valtiojs/valtio-persist-plugin) for a production implementation)

```typescript
const createPersistencePlugin = (storageKey: string): ValtioPlugin => {
  return {
    id: 'persistence',
    
    onInit: () => {
      console.log(`💾 Persistence enabled for key: ${storageKey}`)
    },
    
    afterChange: (path, value, state) => {
      // Auto-save after changes - access via 'this'
      this.save(state)
    },
    
    onDispose: () => {
      // Final save handled by consumer
    },
    
    // Plugin API
    save: (state) => {
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
const persist = createPersistencePlugin('my-app-state')
proxy.use(persist)

const store = proxy({ count: 0, name: 'John' })

// Auto-loads saved state
const savedState = persist.load()
if (savedState) {
  Object.assign(store, savedState)
}

// Changes are auto-saved
store.count++ // Automatically persisted

// Manual operations
persist.clear()
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
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
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
      return !errors.has(path)
    }
  }
}

// Usage
const validation = createValidationPlugin()
proxy.use(validation)

const store = proxy({ email: '', name: '' })

store.email = 'invalid' // ❌ Prevented
console.log(validation.getErrors()) // { email: ['Invalid email format'] }

store.email = 'user@example.com' // ✅ Allowed
console.log(validation.hasErrors()) // false
```

## 🔄 Method Chaining

Chain plugin registrations and method calls:

```typescript
import { proxy } from 'valtio'

const logger = createLoggingPlugin()
const validation = createValidationPlugin()
const persist = createPersistencePlugin('app')

// Chain plugin registration
proxy
  .use(logger)
  .use(validation)
  .use(persist)

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
  const logger = createLoggingPlugin({ debug: true })
  const validation = createValidationPlugin()
  const analytics = createAnalyticsPlugin({ debug: true })
  
  return proxy.createInstance()
    .use(logger)
    .use(validation)
    .use(analytics)
}

const createProductionFactory = () => {
  const persist = createPersistencePlugin('prod-state')
  const validation = createValidationPlugin()
  const analytics = createAnalyticsPlugin({ debug: false })
  
  return proxy.createInstance()
    .use(persist)
    .use(validation)
    .use(analytics)
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
import { proxy }'valtio-plugin' // augmented proxy

// Set up plugins
const logger = createLoggingPlugin()
const persist = createPersistencePlugin('app-state')

proxy.use(logger)
proxy.use(persist)

const store = proxy({
  count: 0,
  increment: () => store.count++,
  decrement: () => store.count--,
  reset: () => store.count = 0
})

// Load persisted state
const saved = persist.load()
if (saved) Object.assign(store, saved)

function Counter() {
  const snap = useSnapshot(store)
  
  return (
    <div>
      <p>Count: {snap.count}</p>
      <button onClick={snap.increment}>+</button>
      <button onClick={snap.decrement}>-</button>
      <button onClick={snap.reset}>Reset</button>
      <button onClick={() => persist.clear()}>
        Clear Storage
      </button>
    </div>
  )
}
```

## 📚 API Reference

### Global Proxy Methods

These methods are available on the augmented global `proxy` imported from 'valtio-plugin':

```typescript
import { proxy } from 'valtio-plugin'

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

// Plugin access (both patterns work)
proxy[pluginId]                 // Access plugin by ID
const plugin = createMyPlugin()
proxy.use(plugin)
plugin.method()                 // Access via reference
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

// Plugin access (both patterns work)
instance[pluginId]             // Access plugin by ID
plugin.method()                // Access via reference
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
  onGetRaw?: (target: object, prop: string | symbol, receiver: unknown, value: unknown) => void
  transformGet?: (path: string[], value: unknown, state: object) => unknown | void
  transformSet?: (path: string[], value: unknown, state: object) => unknown | void
  canProxy?: (value: unknown, defaultCanProxy: (value: unknown) => boolean) => boolean | undefined
  
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
      // Transform value when accessed
      return value
    },

    transformSet: (path, value) => {
      // Transform value before setting
      return value
    },

    canProxy: (value, defaultCanProxy) => {
      // Control what gets proxied
      return defaultCanProxy(value)
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
7. **Keep references**: Store plugin references for easier access to methods

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
import { proxy } from 'valtio-plugin'
import { createMyPlugin } from 'my-valtio-plugin'

const myPlugin = createMyPlugin({ enabled: true })
proxy.use(myPlugin)

// Access via reference (recommended)
myPlugin.doSomething()

// Or via proxy
proxy['my-plugin'].doSomething()
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

---

**Ready to extend Valtio?** Start with the examples and build your first plugin! 🚀