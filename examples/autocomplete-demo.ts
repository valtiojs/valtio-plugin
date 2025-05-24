/**
 * TypeScript Autocomplete Demo
 * 
 * Open this file in VS Code or your TypeScript-enabled editor
 * to see the autocomplete in action!
 */

import { proxy } from 'valtio'
import { ValtioPlugin } from '../src/index'

// Simple plugin for demonstration
const demoPlugin: ValtioPlugin = {
  id: 'demo',
  sayHello: () => 'Hello from plugin!'
}

// Register the plugin
proxy.use(demoPlugin)

// 🎯 TRY THIS: Place your cursor after the dot and see the autocomplete!

// Global proxy methods (these should all have autocomplete):
proxy.use          // ✅ Should show: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => typeof proxy
proxy.clearPlugins // ✅ Should show: () => void
proxy.getPlugins   // ✅ Should show: () => readonly ValtioPlugin[]
proxy.removePlugin // ✅ Should show: (pluginId: string) => boolean
proxy.createInstance // ✅ Should show: () => ProxyFactory
proxy.subscribe    // ✅ Should show: subscribe function
proxy.snapshot     // ✅ Should show: snapshot function

// Plugin access (these should work too):
const plugin = (proxy as any).demo // Should be accessible

// Instance methods (these should have autocomplete):
const instance = proxy.createInstance()
instance.use       // ✅ Should show: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => ProxyFactory
instance.dispose   // ✅ Should show: () => void
instance.subscribe // ✅ Should show: subscribe function
instance.snapshot  // ✅ Should show: snapshot function

console.log('✅ If you see autocomplete for all the methods above, the TypeScript augmentation is working!')

export {}