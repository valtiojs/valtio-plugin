# Valtio Plugin System

A plugin system for Valtio that allows extending the state management library with custom functionality without modifying its core.

[![NPM Version](https://img.shields.io/npm/v/valtio-plugin.svg)](https://www.npmjs.com/package/valtio-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
# npm
npm install valtio valtio-plugin

# yarn
yarn add valtio valtio-plugin

# pnpm
pnpm add valtio valtio-plugin
```

## Basic Usage

```typescript
import { proxyInstance } from 'valtio-plugin'

// Create a simple logging plugin
const loggingPlugin = {
  id: 'logger',
  name: 'Logging Plugin',
  
  // Lifecycle hooks
  afterChange: (path, value, state) => {
    console.log(`🔄 ${path.join('.')} changed to:`, value)
  },
  
  onGet: (path, value, state) => {
    console.log(`👁️  Accessed ${path.join('.')}: `, value)
  },
  
  // Plugin API methods - add whatever you want!
  log: (level, message) => {
    console.log(`[${level.toUpperCase()}]:`, message)
  },
  
  setLevel: (level) => {
    console.log('Log level set to:', level)
  },
  
  // Configuration
  config: {
    logChanges: true,
    logAccess: false
  }
}

// Create a proxy factory with the plugin
const factory = proxyInstance().use(loggingPlugin)

// Create state
const store = factory({
  count: 0,
  user: {
    name: 'John',
    preferences: {
      theme: 'dark'
    }
  }
})

// Access plugin API directly - no symbols needed!
factory.logger.log('info', 'Application started')
factory.logger.setLevel('debug')
factory.logger.config.logAccess = true

// State changes trigger plugin hooks
store.count++ // Logs: "🔄 count changed to: 1"
store.user.name = 'Jane' // Logs: "🔄 user.name changed to: Jane"
```

## Why Valtio Plugin?

Valtio Plugin provides:

1. **Plugin Extensions**: Add capabilities like persistence, logging, validation, reactive tracking, and more
2. **Non-Intrusive**: Doesn't change Valtio's core, maintains API compatibility
3. **Flexible Architecture**: Use plugins globally or on specific stores
4. **Lifecycle Hooks**: Add custom logic at key points in the state management flow
5. **TypeScript Support**: Fully typed API for excellent developer experience
6. **Direct API Access**: Clean, discoverable plugin APIs with full IntelliSense
7. **Instance Isolation**: Different proxy factories can have different plugin behaviors
8. **Performance Optimized**: Minimal overhead when plugins aren't used

## Creating a Plugin

Plugins are objects with lifecycle hooks and any custom properties you want to expose:

```typescript
import type { ValtioPlugin } from 'valtio-plugin'

export const createValidationPlugin = (options = {}) => {
  const errors = new Map<string, string[]>()
  
  const plugin: ValtioPlugin = {
    id: 'validation',
    name: 'Validation Plugin',
    
    // Lifecycle hooks
    onInit: () => {
      console.log('Validation plugin initialized')
    },
    
    beforeChange: (path, value, prevValue, state) => {
      // Validate the change
      if (typeof value === 'string' && value.length < 2) {
        const pathKey = path.join('.')
        errors.set(pathKey, ['Must be at least 2 characters'])
        return false // Prevent the change
      }
      
      // Clear errors for valid values
      errors.delete(path.join('.'))
      return true // Allow the change
    },
    
    afterChange: (path, value, state) => {
      console.log(`✅ Validated change: ${path.join('.')} = ${value}`)
    },
    
    // Cleanup when instance is disposed
    onDispose: () => {
      errors.clear()
    },
    
    // Plugin API methods - add whatever you want!
    validate: (schema, value) => {
      return schema.safeParse(value)
    },
    
    getErrors: () => Array.from(errors.entries()),
    
    clearErrors: () => errors.clear(),
    
    hasErrors: () => errors.size > 0,
    
    // Configuration object
    config: {
      strict: options.strict || false,
      showWarnings: options.showWarnings || true
    },
    
    // Nested API structure
    rules: {
      required: (value) => value != null,
      minLength: (min) => (value) => typeof value === 'string' && value.length >= min,
      email: (value) => /\S+@\S+\.\S+/.test(value)
    }
  }
  
  return plugin
}
```

## Plugin Lifecycle Hooks

- **onInit**: Called when the plugin is first added to a factory
- **onAttach**: Called when the plugin is attached to a proxy factory, receives the factory instance
- **onGet**: Called when a property is accessed (useful for tracking, analytics, reactive systems)
- **beforeChange**: Called before a value changes, can prevent changes by returning `false`
- **afterChange**: Called after a value changes
- **onSubscribe**: Called when a subscription is created on a proxy
- **alterSnapshot**: Called when a snapshot is created, can modify the snapshot
- **onDispose**: Called when the factory is disposed, for cleanup

### Using onAttach Hook

The `onAttach` hook is particularly useful when your plugin needs to create additional proxy instances with the same plugin configuration. Here's a simple example:

```typescript
const createCachePlugin = () => {
  let proxyFactory = null
  const caches = new Map()
  
  return {
    id: 'cache',
    name: 'Cache Plugin',
    
    // Store the factory reference when attached
    onAttach: (factory) => {
      proxyFactory = factory
    },
    
    // Plugin API methods can now use the factory
    createCache: (name, initialData = {}) => {
      if (!proxyFactory) {
        throw new Error('Plugin not attached to a factory')
      }
      
      // Create a new cache instance with the same plugins
      const cache = proxyFactory(initialData)
      caches.set(name, cache)
      
      return cache
    },
    
    getCache: (name) => caches.get(name),
    
    clearCache: (name) => {
      const cache = caches.get(name)
      if (cache) {
        Object.keys(cache).forEach(key => delete cache[key])
      }
    },
    
    listCaches: () => Array.from(caches.keys())
  }
}

// Usage
const factory = proxyInstance().use(createCachePlugin())

// Create different cache instances
const userCache = factory.cache.createCache('users', { john: { age: 30 } })
const productCache = factory.cache.createCache('products')

// All cache instances have the same plugin behavior
userCache.jane = { age: 25 }
productCache.laptop = { price: 999 }
```

## API

### `proxyInstance()`

Creates a proxy factory with plugin support.

```typescript
const factory = proxyInstance()
```

### `factory.use(plugin | plugins[])`

Registers one or more plugins with the proxy factory. Returns the factory for chaining.

```typescript
// Register a single plugin
factory.use(loggingPlugin)

// Register multiple plugins
factory.use([loggingPlugin, validationPlugin])

// Chain plugin registration
const factory = proxyInstance()
  .use(loggingPlugin)
  .use(validationPlugin)
  .use(persistPlugin)
```

### `factory(initialState)`

Creates a proxy with the registered plugins.

```typescript
const store = factory({
  count: 0,
  user: { name: 'John' }
})
```

### `factory.pluginId.*`

Access a plugin's API directly using its ID. The plugin ID becomes a property on the factory.

```typescript
// Access plugin methods
factory.logger.log('info', 'Custom message')
factory.validation.validate(schema, value)
factory.persist.save()

// Access plugin configuration
factory.validation.config.strict = true

// Access nested plugin APIs
const isValid = factory.validation.rules.email('test@example.com')

// Check plugin state
if (factory.validation.hasErrors()) {
  console.log('Validation errors:', factory.validation.getErrors())
}
```

### `factory.subscribe(proxyObject, callback, notifyInSync?)`

Subscribes to changes on a proxy object with plugin hooks applied.

```typescript
const unsubscribe = factory.subscribe(store, (ops) => {
  console.log('Store changed:', ops)
})
```

### `factory.snapshot(proxyObject)`

Creates a snapshot of a proxy object with plugin hooks applied.

```typescript
const snapshot = factory.snapshot(store)
```

### `factory.dispose()`

Cleans up the proxy factory and all plugins. Calls `onDispose` on each plugin.

```typescript
factory.dispose()
```

## Example Plugins

### Persistence Plugin

```typescript
const createPersistPlugin = (key) => ({
  id: 'persist',
  name: 'Persistence Plugin',
  
  onInit: () => {
    console.log(`Loading state from ${key}`)
  },
  
  afterChange: (path, value, state) => {
    // Debounced save to localStorage
    this.debouncedSave()
  },
  
  onDispose: () => {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
  },
  
  // Plugin API
  save: () => {
    const snapshot = factory.snapshot(store)
    localStorage.setItem(key, JSON.stringify(snapshot))
  },
  
  load: () => {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : null
  },
  
  clear: () => {
    localStorage.removeItem(key)
  },
  
  debouncedSave: () => {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 500)
  },
  
  saveTimer: null
})
```

### Reactive Plugin with onAttach

```typescript
const createReactivePlugin = () => {
  const watchers = new Map()
  let isBatching = false
  const batchCallbacks = new Set()
  let proxyFactory = null
  
  return {
    id: 'reactive',
    name: 'Reactive Plugin',
    
    // Store reference to the factory when attached
    onAttach: (factory) => {
      proxyFactory = factory
    },
    
    onGet: (path, value, state) => {
      // Track dependencies for active watchers
      const pathKey = path.join('.')
      for (const watcher of watchers.values()) {
        watcher.dependencies.add(pathKey)
      }
    },
    
    afterChange: (path, value, state) => {
      // Trigger relevant watchers
      const pathKey = path.join('.')
      for (const watcher of watchers.values()) {
        if (watcher.dependencies.has(pathKey)) {
          if (isBatching) {
            batchCallbacks.add(watcher.callback)
          } else {
            watcher.callback()
          }
        }
      }
    },
    
    onDispose: () => {
      watchers.clear()
      batchCallbacks.clear()
    },
    
    // Plugin API
    watch: (fn, callback) => {
      const id = Symbol('watcher')
      const watcher = {
        fn,
        callback: callback || fn,
        dependencies: new Set()
      }
      
      watchers.set(id, watcher)
      fn() // Capture initial dependencies
      
      return () => watchers.delete(id) // unwatch
    },
    
    // Create a derived store that automatically updates
    createDerived: (deriveFn) => {
      if (!proxyFactory) {
        throw new Error('Plugin not attached to a factory')
      }
      
      // Create a new proxy instance with the same plugins
      const derived = proxyFactory({ value: null })
      
      // Watch and automatically update the derived state
      this.watch(() => {
        derived.value = deriveFn()
      })
      
      return derived
    },
    
    batch: (fn) => {
      if (isBatching) return fn()
      
      isBatching = true
      try {
        const result = fn()
        for (const callback of batchCallbacks) {
          callback()
        }
        batchCallbacks.clear()
        return result
      } finally {
        isBatching = false
      }
    },
    
    getWatcherCount: () => watchers.size
  }
}

// Usage example showing onAttach in action
const factory = proxyInstance().use(createReactivePlugin())

const mainStore = factory({ 
  count: 0, 
  name: 'John' 
})

// Plugin can now create derived stores using the same factory
const doubledCount = factory.reactive.createDerived(() => mainStore.count * 2)
const displayName = factory.reactive.createDerived(() => `Hello, ${mainStore.name}!`)

// All stores share the same plugin configuration
mainStore.count = 5
console.log(doubledCount.value) // 10
console.log(displayName.value) // "Hello, John!"
```

### DevTools Plugin

```typescript
const createDevToolsPlugin = () => ({
  id: 'devtools',
  name: 'DevTools Plugin',
  
  onInit: () => {
    this.history = []
    this.currentIndex = -1
  },
  
  afterChange: (path, value, state) => {
    // Capture state changes
    const snapshot = factory.snapshot(state)
    
    if (this.currentIndex < this.history.length - 1) {
      this.history.splice(this.currentIndex + 1)
    }
    
    this.history.push({
      snapshot,
      operation: `${path.join('.')} = ${JSON.stringify(value)}`,
      timestamp: Date.now()
    })
    
    this.currentIndex = this.history.length - 1
  },
  
  onDispose: () => {
    this.history = []
  },
  
  // Plugin API
  undo: () => {
    if (this.currentIndex > 0) {
      this.currentIndex--
      return this.history[this.currentIndex].snapshot
    }
    return null
  },
  
  redo: () => {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++
      return this.history[this.currentIndex].snapshot
    }
    return null
  },
  
  getHistory: () => [...this.history],
  
  jumpToState: (index) => {
    if (index >= 0 && index < this.history.length) {
      this.currentIndex = index
      return this.history[index].snapshot
    }
    return null
  },
  
  history: [],
  currentIndex: -1
})
```

## Advanced Usage

### Multiple Plugin Instances

```typescript
// Different factories can have different plugin configurations
const debugFactory = proxyInstance()
  .use(createLoggingPlugin({ logAccess: true }))
  .use(createReactivePlugin())
  .use(createDevToolsPlugin())

const productionFactory = proxyInstance()
  .use(createPersistPlugin('app-state'))
  .use(createValidationPlugin({ strict: true }))

// Each factory maintains its own plugin state
const debugStore = debugFactory({ debug: true })
const prodStore = productionFactory({ user: 'John' })
```

### Plugin Export Patterns

Plugin authors can create clean, focused APIs:

```typescript
// reactive-store.ts
export const createReactiveStore = () => {
  const plugin = createReactivePlugin()
  const factory = proxyInstance().use(plugin)
  
  return {
    // Main store creator
    store: factory,
    
    // Direct access to reactive methods
    watch: plugin.watch,
    batch: plugin.batch,
    
    // Utilities
    getWatcherCount: plugin.getWatcherCount
  }
}

// Usage
import { createReactiveStore } from 'reactive-store'

const { store, watch, batch } = createReactiveStore()
const state = store({ count: 0 })

const unwatch = watch(() => {
  console.log('Count:', state.count)
})

batch(() => {
  state.count++
})
```

### React Integration

```jsx
import { useSnapshot } from 'valtio/react'
import { proxyInstance } from 'valtio-plugin'

const factory = proxyInstance()
  .use(createLoggingPlugin({ logChanges: true }))
  .use(createPersistPlugin('counter-state'))
  .use(createReactivePlugin())

const store = factory({
  count: 0,
  increment: () => {
    store.count++
  },
  decrement: () => {
    store.count--
  }
})

// Load persisted state
const savedState = factory.persist.load()
if (savedState) {
  Object.assign(store, savedState)
}

// Set up reactive tracking
factory.reactive.watch(
  () => store.count,
  () => console.log('Count changed!')
)

function Counter() {
  const snap = useSnapshot(store)
  
  return (
    <div>
      <p>Count: {snap.count}</p>
      <button onClick={snap.increment}>+</button>
      <button onClick={snap.decrement}>-</button>
      <button onClick={() => factory.persist.clear()}>
        Clear Saved State
      </button>
      <p>Active watchers: {factory.reactive.getWatcherCount()}</p>
    </div>
  )
}
```

## Plugin Best Practices

### 1. Use Descriptive IDs

```typescript
// Good
{ id: 'validation', ... }
{ id: 'persist', ... }
{ id: 'devtools', ... }

// Avoid
{ id: 'plugin1', ... }
{ id: 'myPlugin', ... }
```

### 2. Organize API Methods Logically

```typescript
const plugin = {
  id: 'analytics',
  
  // Core methods
  track: (event, data) => { /* ... */ },
  identify: (userId) => { /* ... */ },
  
  // Configuration
  config: {
    debug: false,
    endpoint: 'https://api.example.com'
  },
  
  // Utilities
  utils: {
    sanitize: (data) => { /* ... */ },
    validate: (event) => { /* ... */ }
  }
}
```

### 3. Handle Errors Gracefully

```typescript
const plugin = {
  id: 'myPlugin',
  
  beforeChange: (path, value, prevValue, state) => {
    try {
      return this.validateValue(value)
    } catch (error) {
      console.error('Plugin validation error:', error)
      return true // Allow change on error to avoid breaking the app
    }
  },
  
  onDispose: () => {
    try {
      this.cleanup()
    } catch (error) {
      console.error('Plugin cleanup error:', error)
    }
  }
}
```

### 4. Provide Configuration Options

```typescript
const createPlugin = (options = {}) => ({
  id: 'configurable',
  
  config: {
    enabled: options.enabled ?? true,
    level: options.level ?? 'info',
    ...options
  },
  
  updateConfig: (newOptions) => {
    Object.assign(this.config, newOptions)
  }
})
```

### 5. Use onDispose for Cleanup

```typescript
const plugin = {
  id: 'timer',
  
  onInit: () => {
    this.interval = setInterval(() => {
      console.log('Timer tick')
    }, 1000)
  },
  
  onDispose: () => {
    if (this.interval) {
      clearInterval(this.interval)
    }
  }
}
```

## Performance Considerations

- **onGet hooks** can be called frequently - keep them lightweight
- **Use batching** when making multiple related changes
- **Dispose factories** when no longer needed to prevent memory leaks
- **Plugin instances are isolated** - different factories don't interfere with each other

## TypeScript Support

The plugin system is fully typed. You can define the type of your state and get full IntelliSense:

```typescript
interface UserState {
  name: string
  age: number
  isActive: boolean
}

const userStore = factory<UserState>({
  name: '',
  age: 0,
  isActive: false
})

// TypeScript will enforce the interface
userStore.name = 'John' // ✅ Valid
userStore.age = '25' // ❌ Type error
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.