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

// Create a plugin
const loggingPlugin = {
  id: 'logger',
  name: 'Logging Plugin',
  
  // Lifecycle hooks
  afterChange: (path, value, state) => {
    console.log(`Changed ${path.join('.')} to:`, value)
  },
  
  // Plugin API methods
  log: (message) => {
    console.log('[Logger]:', message)
  },
  
  setLevel: (level) => {
    console.log('Log level set to:', level)
  }
}

// Create a proxy factory with plugins
const factory = proxyInstance().use(loggingPlugin)

// Create a proxy with the registered plugins
const store = factory({
  count: 0,
  user: {
    name: 'John',
    preferences: {
      theme: 'dark'
    }
  }
})

// Access plugin API directly
factory.logger.log('Custom log message')
factory.logger.setLevel('debug')

// State changes will trigger plugin hooks
store.count++ // Logs: "Changed count to: 1"
store.user.name = 'Jane' // Logs: "Changed user.name to: Jane"
```

## Why Valtio Plugin?

Valtio Plugin provides:

1. **Plugin Extensions**: Add capabilities like persistence, logging, validation, and more
2. **Non-Intrusive**: Doesn't change Valtio's core, maintains API compatibility
3. **Flexible Architecture**: Use plugins globally or on specific stores
4. **Lifecycle Hooks**: Add custom logic at key points in the state management flow
5. **TypeScript Support**: Fully typed API for a great developer experience
6. **Direct API Access**: Clean, discoverable plugin APIs without symbols

## Creating a Plugin

Plugins are objects with lifecycle hooks and any custom properties you want to expose:

```typescript
import { ValtioPlugin } from 'valtio-plugin'

export const createValidationPlugin = (options = {}) => {
  const errors = new Map()
  
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
        console.error(`Validation failed: ${path.join('.')} must be at least 2 characters`)
        return false // Prevent the change
      }
      return true // Allow the change
    },
    
    afterChange: (path, value, state) => {
      // Clear any previous errors for this path
      errors.delete(path.join('.'))
    },
    
    // Plugin API methods - add whatever you want!
    validate: (schema, value) => {
      // Custom validation logic
      return schema.safeParse(value)
    },
    
    getErrors: () => Array.from(errors.entries()),
    
    clearErrors: () => errors.clear(),
    
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

- **onInit**: Called when the plugin is initialized
- **onGet**: Called when a property is accessed (useful for tracking, analytics, etc.)
- **beforeChange**: Called before a value changes, can prevent changes by returning `false`
- **afterChange**: Called after a value changes
- **onSubscribe**: Called when a subscription is created
- **alterSnapshot**: Called when a snapshot is created, can modify the snapshot

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

Access a plugin's API directly using its ID.

```typescript
// Access plugin methods
factory.logger.log('Custom message')
factory.validation.validate(schema, value)
factory.persist.save()

// Access plugin configuration
factory.validation.config.strict = true

// Access nested plugin APIs
const isValid = factory.validation.rules.email('test@example.com')
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

Cleans up the proxy factory and plugins.

```typescript
factory.dispose()
```

## Example Plugins

### Logging Plugin

```typescript
const createLoggingPlugin = (options = {}) => ({
  id: 'logger',
  name: 'Logging Plugin',
  
  afterChange: (path, value, state) => {
    if (options.logChanges) {
      console.log(`🔄 ${path.join('.')} changed to:`, value)
    }
  },
  
  onGet: (path, value, state) => {
    if (options.logAccess) {
      console.log(`👁️  Accessed ${path.join('.')}: `, value)
    }
  },
  
  // Plugin API
  log: (level, message) => {
    console.log(`[${level.toUpperCase()}]:`, message)
  },
  
  config: {
    logChanges: options.logChanges ?? true,
    logAccess: options.logAccess ?? false
  }
})
```

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
    localStorage.setItem(key, JSON.stringify(state))
  },
  
  // Plugin API
  save: () => {
    const state = factory.snapshot(store)
    localStorage.setItem(key, JSON.stringify(state))
  },
  
  load: () => {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : null
  },
  
  clear: () => {
    localStorage.removeItem(key)
  }
})
```

### Reactive Tracking Plugin

```typescript
const createReactivePlugin = () => {
  const watchers = new Set()
  
  return {
    id: 'reactive',
    name: 'Reactive Plugin',
    
    onGet: (path, value, state) => {
      // Track property access for active watchers
      for (const watcher of watchers) {
        watcher.dependencies.add(path.join('.'))
      }
    },
    
    afterChange: (path, value, state) => {
      // Trigger relevant watchers
      const pathKey = path.join('.')
      for (const watcher of watchers) {
        if (watcher.dependencies.has(pathKey)) {
          watcher.callback()
        }
      }
    },
    
    // Plugin API
    watch: (fn, callback) => {
      const watcher = {
        fn,
        callback: callback || fn,
        dependencies: new Set()
      }
      
      watchers.add(watcher)
      fn() // Run once to capture dependencies
      
      return () => watchers.delete(watcher) // unwatch
    },
    
    batch: (fn) => {
      // Batch multiple changes
      const callbacks = new Set()
      // Implementation...
      return fn()
    }
  }
}
```

## Example: React Integration

```jsx
import { useSnapshot } from 'valtio/react'
import { proxyInstance } from 'valtio-plugin'

const factory = proxyInstance()
  .use(createLoggingPlugin({ logChanges: true }))
  .use(createPersistPlugin('counter-state'))

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
      // Validation logic
      return isValid(value)
    } catch (error) {
      console.error('Plugin error:', error)
      return true // Allow change on error
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
    Object.assign(plugin.config, newOptions)
  }
})
```

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