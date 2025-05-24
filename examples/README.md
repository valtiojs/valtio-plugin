# Valtio Plugin Examples

This directory contains examples demonstrating how to use the Valtio Plugin System.

## Examples

### 1. Logging Plugin (`logging-plugin.ts`)

A comprehensive example showing:

- ✅ **Global Plugin Registration**: Register plugins that affect all proxy instances
- ✅ **TypeScript Support**: Full autocomplete and type safety when importing from 'valtio'
- ✅ **Plugin API Access**: Access plugin methods via `proxy.pluginId` 
- ✅ **Lifecycle Hooks**: Implement `onInit`, `beforeChange`, `afterChange` hooks
- ✅ **Method Chaining**: Use `proxy.use().method()` pattern
- ✅ **Instance Creation**: Create independent proxy instances with `proxy.createInstance()`

## Running the Examples

### Prerequisites

Make sure you have the plugin built:

```bash
npm run build
```

### Quick Start

```bash
# Run the JavaScript example (easiest)
node examples/logging-example.js

# Verify TypeScript compiles correctly
npx tsc --noEmit examples/typescript-example.ts

# Run TypeScript example with tsx (if you have it installed)
npx tsx examples/typescript-example.ts
```

### Available Examples

1. **`logging-example.js`** - JavaScript version, runs immediately
2. **`logging-plugin.ts`** - Full TypeScript version with detailed documentation  
3. **`typescript-example.ts`** - Focused on TypeScript autocomplete features

## Key Features Demonstrated

### TypeScript Module Augmentation

When you import any export from this package, the `proxy` from 'valtio' automatically gets enhanced:

```typescript
import { proxy } from 'valtio'
import { ValtioPlugin } from 'valtio-plugin' // This enables augmentation

// Now you have full TypeScript support:
proxy.use(myPlugin)           // ✅ Autocomplete
proxy.clearPlugins()          // ✅ Autocomplete  
proxy.createInstance()        // ✅ Autocomplete
proxy.getPlugins()           // ✅ Autocomplete
```

### Plugin API Access

Access your plugins as properties with full typing:

```typescript
const loggingPlugin = createLoggingPlugin()
proxy.use(loggingPlugin)

// Access with TypeScript support
const logger = proxy.logger as LoggingPlugin
logger.info('Hello world!')    // ✅ Autocomplete
logger.getLogCount()          // ✅ Autocomplete
```

### Global vs Instance Plugins

```typescript
// Global plugins affect ALL proxy instances
proxy.use(globalLoggingPlugin)

const store1 = proxy({ count: 0 })    // Logging enabled
const store2 = proxy({ name: 'John' }) // Logging enabled

// Instance plugins only affect that instance
const instance = proxy.createInstance()
instance.use(instanceOnlyPlugin)

const store3 = instance({ value: 'test' }) // Both global AND instance plugins
const store4 = proxy({ other: 'data' })     // Only global plugins
```

## Creating Your Own Plugins

### Basic Plugin Structure

```typescript
import { ValtioPlugin } from 'valtio-plugin'

const myPlugin: ValtioPlugin = {
  id: 'my-plugin',           // Required: unique identifier
  name: 'My Plugin',         // Optional: display name
  
  // Lifecycle hooks (all optional)
  onInit: () => {
    console.log('Plugin initialized')
  },
  
  onAttach: (proxyFactory) => {
    console.log('Plugin attached to factory')
  },
  
  beforeChange: (path, newValue, oldValue, state) => {
    console.log(`Changing ${path.join('.')}`)
    return true // Return false to prevent the change
  },
  
  afterChange: (path, newValue, state) => {
    console.log(`Changed ${path.join('.')}`)
  },
  
  onSubscribe: (proxyObject, callback) => {
    console.log('New subscription created')
  },
  
  alterSnapshot: (snapshot) => {
    // Modify snapshot before it's returned
    return { ...snapshot, _modified: true }
  },
  
  // Custom plugin methods
  myMethod: () => 'Hello from plugin!',
  customAction: (data: any) => { /* do something */ }
}
```

### Plugin with TypeScript Interface

```typescript
interface MyPlugin extends ValtioPlugin {
  myMethod: () => string
  customAction: (data: any) => void
}

const createMyPlugin = (): MyPlugin => ({
  id: 'my-plugin',
  myMethod: () => 'Hello!',
  customAction: (data) => console.log(data)
})

// Usage with typing
proxy.use(createMyPlugin())
const plugin = proxy['my-plugin'] as MyPlugin
plugin.myMethod() // ✅ Full TypeScript support
```

## Best Practices

1. **Use unique plugin IDs** to avoid conflicts
2. **Implement TypeScript interfaces** for better developer experience  
3. **Handle errors gracefully** in plugin hooks
4. **Use global plugins sparingly** - they affect all proxy instances
5. **Prefer instance plugins** for application-specific functionality
6. **Document your plugin APIs** for other developers