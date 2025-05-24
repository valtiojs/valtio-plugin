/**
 * TypeScript Example with Full Autocomplete
 * 
 * This demonstrates the TypeScript module augmentation working with 
 * the valtio proxy import and full autocomplete support.
 */

import { proxy } from 'valtio'
import { ValtioPlugin } from '../src/index' // This enables TypeScript augmentation

// Define a strongly typed plugin interface
interface CounterPlugin extends ValtioPlugin {
  increment: () => void
  decrement: () => void
  reset: () => void
  getCount: () => number
}

// Create a counter plugin with TypeScript
const createCounterPlugin = (): CounterPlugin => {
  let count = 0
  
  return {
    id: 'counter',
    name: 'Counter Plugin',
    
    onInit: () => {
      console.log('🧮 Counter plugin initialized')
    },
    
    beforeChange: (path, newValue, oldValue) => {
      console.log(`📊 State change detected: ${path.join('.')}`)
      return true
    },
    
    // Plugin API methods with full typing
    increment: () => {
      count++
      console.log(`➕ Count incremented to ${count}`)
    },
    
    decrement: () => {
      count--
      console.log(`➖ Count decremented to ${count}`)
    },
    
    reset: () => {
      count = 0
      console.log(`🔄 Count reset to ${count}`)
    },
    
    getCount: () => count
  }
}

// Example showing TypeScript autocomplete in action
console.log('=== TypeScript Autocomplete Demo ===\n')

// 1. Register plugin with full TypeScript support
const counterPlugin = createCounterPlugin()
proxy.use(counterPlugin) // ✅ Autocomplete works on proxy.use

// 2. Access all global proxy methods with autocomplete
console.log('Available global methods:')
proxy.clearPlugins        // ✅ Autocomplete
proxy.getPlugins()        // ✅ Autocomplete with return type
proxy.createInstance()    // ✅ Autocomplete with return type
proxy.removePlugin('id')  // ✅ Autocomplete with parameter info

// 3. Re-add the plugin
proxy.use(counterPlugin)

// 4. Access plugin with full typing
const counter = (proxy as any).counter as CounterPlugin

// 5. Use plugin methods with autocomplete
counter.increment()       // ✅ Autocomplete
counter.increment()       // ✅ Autocomplete
counter.decrement()       // ✅ Autocomplete
console.log(`Current count: ${counter.getCount()}`) // ✅ Autocomplete + return type

// 6. Create store and show global plugin affects all instances
const appState = proxy({
  user: { name: 'Alice', score: 100 },
  settings: { theme: 'dark' }
})

console.log('\nMaking changes to app state...')
appState.user.name = 'Bob'
appState.settings.theme = 'light'
appState.user.score = 150

// 7. Demonstrate instance-specific vs global plugins
const instance = proxy.createInstance()

// Instance-specific plugin
const localPlugin: ValtioPlugin = {
  id: 'local',
  name: 'Local Plugin',
  beforeChange: (path) => {
    console.log(`🏠 Local plugin: ${path.join('.')} changing`)
    return true
  }
}

instance.use(localPlugin) // ✅ Autocomplete on instance methods

const instanceStore = instance({ 
  data: 'instance-specific'
})

console.log('\nChanging instance store (both global + local plugins active):')
instanceStore.data = 'modified data'

console.log('\nChanging global store (only global plugin active):')
appState.user.score = 200

// 8. Show final state
console.log(`\n📈 Final plugin count: ${counter.getCount()}`)
console.log(`🔌 Total plugins: ${proxy.getPlugins().length}`)

console.log('\n✅ TypeScript example completed with full autocomplete support!')

export { createCounterPlugin, type CounterPlugin }