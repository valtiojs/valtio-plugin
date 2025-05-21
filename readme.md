# THIS LIBRARY IS UNDER CONSTRUCTOIN AND IS NOT MEANT TO BE USED YET

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

```jsx
import { proxyInstance } from 'valtio-plugin'
import { loggingPlugin } from 'valtio-logging-plugin'
import { persistPlugin } from 'valtio-persist-plugin'

// Create a proxy factory with plugins
// NOTE - these are just examples and not real plugins!
const { logger, loggerSymbol } = loggingPlugin()
const { persist, persistSymbol } = persistPlugin()

const proxy = proxyInstance()

// Register plugins
proxy.use([
  logger({
    level: 'debug',
  }),
  persist({
    name: 'my-store'
  })
])

// Create a proxy with the registered plugins
const store = proxy({
  count: 0,
  user: {
    name: 'John',
    preferences: {
      theme: 'dark'
    }
  }
})

// Access plugin API through symbols
proxy[loggerSymbol].log('Custom log message')
proxy[persistSymbol].pause() // Temporarily pause persistence
```

## Why Valtio Plugin?

Valtio Plugin provides:

1. **Plugin Extensions**: Add capabilities like persistence, logging, validation, and more
2. **Non-Intrusive**: Doesn't change Valtio's core, maintains API compatibility
3. **Flexible Architecture**: Use plugins globally or on specific stores
4. **Lifecycle Hooks**: Add custom logic at key points in the state management flow
5. **TypeScript Support**: Fully typed API for a great developer experience

## Creating a Plugin

Plugins are objects with lifecycle hooks and optional API:

```typescript
import { ValtioPlugin } from 'valtio-plugin'

export function createCustomPlugin() {
  // Create a symbol for API access
  const customSymbol = Symbol('custom-plugin')
  
  // Factory function that returns the configured plugin
  const createPlugin = (options = {}): ValtioPlugin => {
    // Plugin API that will be exposed
    const api = {
      doSomething: () => {
        console.log('Doing something...')
      }
    }
    
    // Return the plugin object
    return {
      id: 'custom-plugin',
      name: 'Custom Plugin',
      symbol: customSymbol,
      api,
      
      // Lifecycle hooks
      onInit: () => {
        console.log('Plugin initialized')
      },
      
      beforeChange: (path, value, prevValue, state) => {
        console.log(`About to change ${path.join('.')} from ${prevValue} to ${value}`)
        return true // Allow the change to proceed
      },
      
      afterChange: (path, value, state) => {
        console.log(`Changed ${path.join('.')} to ${value}`)
      },
      
      onSubscribe: (proxy, callback) => {
        console.log('New subscription created')
      },
      
      alterSnapshot: (snapshot) => {
        console.log('Taking snapshot')
        return snapshot
      }
    }
  }
  
  return {
    custom: createPlugin,
    customSymbol
  }
}
```

## Plugin Lifecycle Hooks

- **onInit**: Called when the plugin is initialized
- **beforeChange**: Called before a value changes, can prevent changes by returning `false`
- **afterChange**: Called after a value changes
- **onSubscribe**: Called when a subscription is created
- **alterSnapshot**: Called when a snapshot is created, can modify the snapshot and can specify your own return type

## API

### `proxyInstance()`

Creates a proxy factory with plugin support.

```typescript
const proxy = proxyInstance()
```

### `proxy.use(plugin | plugins[])`

Registers one or more plugins with the proxy factory.

```typescript
// Register a single plugin
proxy.use(logger())

// Register multiple plugins
proxy.use([
  logger(),
  persist()
])
```

### `proxy(initialState)`

Creates a proxy with the registered plugins.

```typescript
const store = proxy({
  count: 0
})
```

### `proxy[pluginSymbol]`

Accesses a plugin's API through its symbol.

```typescript
// Access plugin API
proxy[loggerSymbol].log('Custom message')
```

### `proxy.subscribe(proxyObject, callback, notifyInSync?)`

Subscribes to changes on a proxy object with plugin hooks applied.

```typescript
const unsubscribe = proxy.subscribe(store, () => {
  console.log('Store changed')
})
```

### `proxy.snapshot(proxyObject)`

Creates a snapshot of a proxy object with plugin hooks applied.

```typescript
const snapshot = proxy.snapshot(store)
```

### `proxy.dispose()`

Cleans up the proxy factory and plugins.

```typescript
proxy.dispose()
```

## Available Plugins

### Standard Schema Plugin

The Standard Schema Plugin provides runtime validation for your Valtio state using the Standard Schema specification. It supports various schema validation libraries that implement the Standard Schema spec, including Zod, Valibot, Arktype, and more.

#### Installation

```bash
# npm
npm install valtio valtio-plugin

# For Zod integration
npm install zod

# For Valibot integration
npm install valibot

# For Arktype integration
npm install arktype
```

#### Usage

```typescript
import { proxyInstance, standardSchemaPlugin } from 'valtio-plugin'
import * as z from 'zod'

// Create the validation plugin
const { schema, schemaSymbol } = standardSchemaPlugin()

// Create a proxy factory with plugin support
const proxy = proxyInstance()

// Register the standard schema plugin with validation rules
proxy.use(schema({
  schemas: {
    'user.name': z.string().min(3),
    'user.email': z.string().email(),
    'user.age': z.number().min(18),
    'settings': z.object({
      theme: z.enum(['light', 'dark']),
      notifications: z.boolean()
    })
  }
}))

// Create the state with validation
const store = proxy({
  user: {
    name: 'John',
    email: 'john@example.com',
    age: 25
  },
  settings: {
    theme: 'dark',
    notifications: true
  }
})

// Valid changes will work
store.user.name = 'Alice' // Works fine

// Invalid changes will be prevented
store.user.name = 'A' // Error: String must contain at least 3 character(s)
store.user.email = 'not-an-email' // Error: Invalid email
store.settings.theme = 'blue' // Error: Invalid enum value
```

#### Advanced Configuration

```typescript
import { proxyInstance, standardSchemaPlugin } from 'valtio-plugin'
import { object, string, number, email, minLength, minValue } from 'valibot'

const { schema, schemaSymbol } = standardSchemaPlugin()
const proxy = proxyInstance()

// Custom error handling
proxy.use(schema({
  schemas: {
    'user.name': string([minLength(3)]),
    'user.email': string([email()]),
    'user.age': number([minValue(18)])
  },
  onError: (path, value, issues) => {
    // Custom error handling instead of preventing the change
    console.warn(`Validation error at path ${path.join('.')}:`, issues)
    // You can throw, log, or send the errors to a monitoring service
  },
  // Allow async validation (use with caution)
  allowAsync: false
}))

// Create your store
const store = proxy({
  user: {
    name: 'John',
    email: 'john@example.com',
    age: 25
  }
})

// Access plugin API
// Validate a value manually against a schema
try {
  const result = await proxy[schemaSymbol].validate(
    string([email()]), 
    'test@example.com'
  )
  console.log('Valid:', result)
} catch (error) {
  console.error('Invalid:', error.issues)
}

// Add schemas dynamically
proxy[schemaSymbol].addSchemas({
  'user.country': string([minLength(2)])
})

// Remove schemas
proxy[schemaSymbol].removeSchemas(['user.email'])
```

## Example: React Integration

```jsx
import { useSnapshot } from 'valtio/react'
import { proxyInstance } from 'valtio-plugin'
import { persistPlugin } from 'valtio-persist-plugin'

const { persist } = persistPlugin()
const proxy = proxyInstance()
proxy.use(persist({ name: 'counter' }))

const store = proxy({
  count: 0,
  increment: () => {
    store.count++
  }
})

function Counter() {
  const snap = useSnapshot(store)
  
  return (
    <div>
      <p>Count: {snap.count}</p>
      <button onClick={snap.increment}>Increment</button>
    </div>
  )
}
```

## TypeScript Support

The plugin system is fully typed. You can define the type of your state:

```typescript
interface UserState {
  name: string;
  age: number;
  isActive: boolean;
}

const userStore = proxy<UserState>({
  name: '',
  age: 0,
  isActive: false
})
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.