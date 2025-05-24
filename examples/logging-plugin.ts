/**
 * Simple Logging Plugin Example
 * 
 * This example demonstrates:
 * - Creating a global plugin with logging functionality
 * - Using TypeScript with full autocomplete support
 * - Accessing plugin methods via proxy properties
 * - Global plugin lifecycle hooks
 */

import { proxy } from 'valtio'
import { ValtioPlugin } from '../src/index' // This enables TypeScript augmentation

// Define the logging plugin with typed methods
interface LoggingPlugin extends ValtioPlugin {
  // Plugin methods that will be accessible via proxy.logger
  debug: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  getLogCount: () => number
}

// Create the logging plugin
const createLoggingPlugin = (): LoggingPlugin => {
  let logCount = 0
  
  const log = (level: string, message: string) => {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`)
    logCount++
  }

  return {
    id: 'logger',
    name: 'Logging Plugin',
    
    // Lifecycle hooks
    onInit: () => {
      log('info', '🚀 Logging plugin initialized')
    },
    
    beforeChange: (path, newValue, oldValue) => {
      log('debug', `📝 Changing ${path.join('.')} from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`)
      return true // Allow the change
    },
    
    afterChange: (path, newValue) => {
      log('info', `✅ Changed ${path.join('.')} to ${JSON.stringify(newValue)}`)
    },
    
    // Plugin API methods
    debug: (message: string) => log('debug', message),
    info: (message: string) => log('info', message),
    warn: (message: string) => log('warn', message),
    error: (message: string) => log('error', message),
    getLogCount: () => logCount
  }
}

// Example usage
console.log('=== Valtio Plugin System - Logging Example ===\n')

// 1. Create and register the global logging plugin
const loggingPlugin = createLoggingPlugin()
proxy.use(loggingPlugin) // ✅ Full TypeScript support

// 2. Access plugin methods with TypeScript autocomplete
const logger = (proxy as any).logger as LoggingPlugin

// 3. Use plugin methods directly
logger.info('Logger is ready! 🎉')
logger.debug('This is a debug message')

// 4. Create a store - the plugin will automatically log changes
const userStore = proxy({
  name: 'John Doe',
  age: 30,
  preferences: {
    theme: 'dark',
    notifications: true
  }
})

// 5. Make changes - watch the logging in action
logger.info('Making changes to user store...')

userStore.name = 'Jane Smith'
userStore.age = 25
userStore.preferences.theme = 'light'
userStore.preferences.notifications = false

// 6. Add new properties
logger.info('Adding new properties...')
;(userStore as any).email = 'jane@example.com'

// 7. Show log statistics
console.log(`\n📊 Total log entries: ${logger.getLogCount()}`)

// 8. Demonstrate other global proxy methods
logger.info('Demonstrating other proxy methods...')

const allPlugins = proxy.getPlugins() // ✅ TypeScript autocomplete
console.log(`📦 Registered plugins: ${allPlugins.map(p => p.name || p.id).join(', ')}`)

// 9. Create an instance to show the difference
const instance = proxy.createInstance() // ✅ TypeScript autocomplete
const instanceStore = instance({ count: 0 })

logger.info('Created instance store - this change will be logged by global plugin')
instanceStore.count = 42

console.log('\n✅ Example completed! Check the logs above to see the plugin in action.')

export { createLoggingPlugin, type LoggingPlugin }