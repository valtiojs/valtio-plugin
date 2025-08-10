// We want to import this from vanilla so that we don't get any
// errors when not using react (valtio main pacakge exports useSnapshot)
// which has a react dependency
import {
  proxy as valtioProxy,
  snapshot as originalSnapshot,
  subscribe as originalSubscribe,
  Snapshot,
  unstable_getInternalStates,
  unstable_replaceInternalFunction,
} from 'valtio/vanilla'

// It's important to import something from the main package that doesn't
// require react so that we can augment the main valtio module
import { INTERNAL_Op } from 'valtio'

// Import types from the separate augmentation file
import type { ValtioPlugin, ProxyFactory, EnhancedGlobalProxy } from './valtio-plugin'

// Re-export types for convenience
export type { ValtioPlugin, ProxyFactory, EnhancedGlobalProxy }

// Module augmentation to add methods to valtio's proxy function
declare module 'valtio' {
  namespace proxy {
    function use(pluginOrPlugins: ValtioPlugin | ValtioPlugin[]): typeof proxy
    function subscribe<T extends object>(
      proxyObject: T,
      callback: (ops: INTERNAL_Op[]) => void,
      notifyInSync?: boolean
    ): (() => void)
    function snapshot<T extends object>(proxyObject: T): Snapshot<T>
    function removePlugin(pluginId: string): boolean
    function getPlugins(): readonly ValtioPlugin[]
    function clearPlugins(): void
    function createInstance(): ProxyFactory
  }
}

const ROOT_PROXY_SYMBOL = Symbol('valtio-plugin-root')
const PROXY_PATH_SYMBOL = Symbol('valtio-plugin-path')
const INSTANCE_ID_SYMBOL = Symbol('valtio-plugin-instance-id')
const GLOBAL_PROXY_SYMBOL = Symbol('valtio-plugin-global')

const { proxyStateMap } = unstable_getInternalStates()

interface EnhancedProxy {
  [ROOT_PROXY_SYMBOL]?: object,
  [PROXY_PATH_SYMBOL]?: (string | symbol)[],
  [INSTANCE_ID_SYMBOL]?: string,
  [GLOBAL_PROXY_SYMBOL]?: boolean
}

// type guards
const hasRootProxy = (obj: object): obj is EnhancedProxy => {
  return ROOT_PROXY_SYMBOL in obj
}

const hasProxyPath = (obj: object): obj is EnhancedProxy => {
  return PROXY_PATH_SYMBOL in obj
}

const hasInstanceId = (obj: object): obj is EnhancedProxy => {
  return INSTANCE_ID_SYMBOL in obj
}

const isGlobalProxy = (obj: object): obj is EnhancedProxy => {
  return GLOBAL_PROXY_SYMBOL in obj
}

let currentId = 0
const createInstanceId = () => {
  return `valtio-plugin-${currentId++}`
}

const createGlobalId = () => {
  return `valtio-global-${currentId++}`
}

const isObject = (x: unknown): x is object =>
  typeof x === 'object' && x !== null

interface InstanceRegistry {
  id: string
  parentId?: string // Track parent instance for nested instances
  plugins: ValtioPlugin[]
  isDisposed: boolean
  children: Set<string> // Track child instance IDs
}

// Global plugin registry for enhanced proxy
const globalPluginRegistry: ValtioPlugin[] = []
const instanceRegistry = new Map<string, InstanceRegistry>()

const addMetaData = (obj: object, meta: {
  rootProxy?: object, 
  instanceId?: string, 
  path?: (string | symbol)[],
  isGlobal?: boolean
}) => {
  const { rootProxy, instanceId, path, isGlobal } = meta

  if (rootProxy) {
    Object.defineProperty(obj, ROOT_PROXY_SYMBOL, {
      value: rootProxy,
      enumerable: false,
      configurable: true
    })
  }

  if (instanceId) {
    Object.defineProperty(obj, INSTANCE_ID_SYMBOL, {
      value: instanceId,
      enumerable: false,
      configurable: true
    })
  }

  if (Array.isArray(path) && path.length > 0) {
    Object.defineProperty(obj, PROXY_PATH_SYMBOL, {
      value: path,
      enumerable: false,
      configurable: true
    })
  }

  if (isGlobal) {
    Object.defineProperty(obj, GLOBAL_PROXY_SYMBOL, {
      value: true,
      enumerable: false,
      configurable: true
    })
  }
}

// Helper to get all applicable plugins for a proxy (including inherited from parent instances)
const getApplicablePlugins = (obj: object): ValtioPlugin[] => {
  const plugins: ValtioPlugin[] = []
  
  // Always add global plugins first (they run before instance plugins)
  plugins.push(...globalPluginRegistry)
  
  // Add instance-specific plugins if this is an instance proxy
  if (hasInstanceId(obj)) {
    const instanceId = obj[INSTANCE_ID_SYMBOL]
    
    // Walk up the instance hierarchy to collect inherited plugins
    const hierarchy: string[] = []
    let currentInstanceId: string | undefined = instanceId
    
    while (currentInstanceId) {
      hierarchy.unshift(currentInstanceId)
      const registry = instanceRegistry.get(currentInstanceId)
      if (!registry) break
      currentInstanceId = registry.parentId
    }
    
    // Add plugins from parent to child (parent plugins run before child plugins)
    for (const id of hierarchy) {
      const registry = instanceRegistry.get(id)
      if (registry && !registry.isDisposed) {
        plugins.push(...registry.plugins)
      }
    }
  }
  
  return plugins
}

let isProxyEnhanced = false

// Function to enhance the proxy function with plugin methods
const enhanceProxyFunction = () => {
  if (isProxyEnhanced) return
  isProxyEnhanced = true

  // Add methods directly to the proxy function
  Object.defineProperties(valtioProxy, {
    use: {
      value: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => {
        const pluginsToAdd = Array.isArray(pluginOrPlugins) 
          ? pluginOrPlugins 
          : [pluginOrPlugins]

        for (const plugin of pluginsToAdd) {
          const existingIndex = globalPluginRegistry.findIndex(p => p.id === plugin.id)
          if (existingIndex >= 0) {
            globalPluginRegistry[existingIndex] = plugin
          } else {
            globalPluginRegistry.push(plugin)
          }
          
          // Call onAttach if it exists
          if (plugin.onAttach) {
            try {
              plugin.onAttach(valtioProxy as EnhancedGlobalProxy)
            } catch (e) {
              console.error(`Error in global plugin ${plugin.id} onAttach:`, e)
            }
          }
        }
        
        return valtioProxy as EnhancedGlobalProxy
      },
      enumerable: true,
      configurable: true,
    },

    subscribe: {
      value: <T extends object>(
        proxyObject: T,
        callback: (ops: INTERNAL_Op[]) => void,
        notifyInSync?: boolean
      ): (() => void) => {
        // Run onSubscribe hooks for applicable plugins
        if (isObject(proxyObject)) {
          const applicablePlugins = getApplicablePlugins(proxyObject)
          for (const plugin of applicablePlugins) {
            if (plugin.onSubscribe) {
              try {
                plugin.onSubscribe(proxyObject, callback)
              } catch (e) {
                console.error(`Error in plugin ${plugin.id} onSubscribe:`, e)
              }
            }
          }
        }
        
        return originalSubscribe(proxyObject, callback, notifyInSync)
      },
      enumerable: true,
      configurable: true,
    },

    snapshot: {
      value: <T extends object>(proxyObject: T): Snapshot<T> => {
        let snap: Record<string, unknown> = originalSnapshot(proxyObject) as Record<string, unknown>
        
        if (isObject(proxyObject)) {
          const applicablePlugins = getApplicablePlugins(proxyObject)
          for (const plugin of applicablePlugins) {
            if (plugin.onSnapshot) {
              try {
                plugin.onSnapshot(snap)
              } catch (e) {
                console.error(`Error in plugin ${plugin.id} onSnapshot:`, e)
              }
            }
          }
        }
        
        return snap as Snapshot<T>
      },
      enumerable: true,
      configurable: true,
    },

    removePlugin: {
      value: (pluginId: string): boolean => {
        const index = globalPluginRegistry.findIndex(p => p.id === pluginId)
        if (index >= 0) {
          const plugin = globalPluginRegistry[index]
          
          // Call onDispose if it exists
          if (plugin.onDispose) {
            try {
              plugin.onDispose()
            } catch (e) {
              console.error(`Error disposing global plugin ${plugin.id}:`, e)
            }
          }
          
          globalPluginRegistry.splice(index, 1)
          return true
        }
        return false
      },
      enumerable: true,
      configurable: true,
    },

    getPlugins: {
      value: (): readonly ValtioPlugin[] => {
        return [...globalPluginRegistry]
      },
      enumerable: true,
      configurable: true,
    },

    clearPlugins: {
      value: (): void => {
        for (const plugin of globalPluginRegistry) {
          if (plugin.onDispose) {
            try {
              plugin.onDispose()
            } catch (e) {
              console.error(`Error disposing global plugin ${plugin.id}:`, e)
            }
          }
        }
        globalPluginRegistry.length = 0
      },
      enumerable: true,
      configurable: true,
    },

    createInstance: {
      value: (): ProxyFactory => {
        return createProxyInstance()
      },
      enumerable: true,
      configurable: true,
    }
  })

  // Create a proxy wrapper to handle plugin property access
  const originalValtioProxy = valtioProxy
  const proxyHandler: ProxyHandler<typeof valtioProxy> = {
    get(target, prop) {
      // Check if it's a plugin access
      if (typeof prop === 'string') {
        const plugin = globalPluginRegistry.find(p => p.id === prop)
        if (plugin) {
          return plugin
        }
      }
      
      return Reflect.get(target, prop)
    },
    
    apply(target, thisArg, argArray) {
      return Reflect.apply(target, thisArg, argArray)
    }
  }

  // Replace the proxy function in the module's namespace
  return new Proxy(originalValtioProxy, proxyHandler)
}

let isInitialized = false

const initializePluginSystem = () => {
  if (isInitialized) return
  isInitialized = true

  // Enhance the proxy function with plugin methods
  enhanceProxyFunction()

  // Use newProxy to intercept proxy creation and add metadata
  unstable_replaceInternalFunction('newProxy', (originalNewProxy) => {
    return <T extends object>(target: T, handler: ProxyHandler<T>): T => {
      const proxyObj = originalNewProxy(target, handler)
      
      // Check if this proxy should have global plugins
      if (globalPluginRegistry.length > 0) {
        const globalId = createGlobalId()
        const meta = { 
          rootProxy: proxyObj, 
          instanceId: globalId, 
          path: [], 
          isGlobal: true 
        }
        addMetaData(proxyObj, meta)
        
        // Call onInit for global plugins
        for (const plugin of globalPluginRegistry) {
          if (plugin.onInit) {
            try {
              plugin.onInit()
            } catch (e) {
              console.error(`Error in global plugin ${plugin.id} onInit:`, e)
            }
          }
        }
      }
      
      return proxyObj
    }
  })

  // Enhanced canProxy hook with proper context handling
  unstable_replaceInternalFunction('canProxy', (originalCanProxy) => {
    return (value: unknown): boolean => {
      // First check original canProxy
      if (!originalCanProxy(value)) {
        return false;
      }
      
      // Get applicable plugins based on current context
      let plugins: ValtioPlugin[] = [];
      
      if (currentInstanceContext) {
        // Instance-specific context - get plugins directly from registry
        const hierarchy: string[] = [];
        let currentId: string | undefined = currentInstanceContext;
        
        // Walk up the instance hierarchy
        while (currentId) {
          hierarchy.unshift(currentId);
          const registry = instanceRegistry.get(currentId);
          if (!registry) break;
          currentId = registry.parentId;
        }
        
        // Add global plugins first
        plugins.push(...globalPluginRegistry);
        
        // Add instance plugins from parent to child
        for (const id of hierarchy) {
          const registry = instanceRegistry.get(id);
          if (registry && !registry.isDisposed) {
            plugins.push(...registry.plugins);
          }
        }
      } else {
        // Global context - only global plugins
        plugins = [...globalPluginRegistry];
      }
      
      // Check each plugin's canProxy
      for (const plugin of plugins) {
        if (plugin.canProxy) {
          try {
            const result = plugin.canProxy(value);
            // If any plugin returns false, don't proxy
            if (result === false) {
              return false;
            }
            // If plugin returns true, continue checking others
            // If undefined, defer to other plugins/default behavior
          } catch (e) {
            console.error(`Error in plugin ${plugin.id} canProxy:`, e);
          }
        }
      }
      
      // No plugin prevented proxying
      return true;
    };
  });

  unstable_replaceInternalFunction('createHandler', (originalHandler) => {
    return (isInitializing, addPropListener, removePropListener, notifyUpdate) => {
      const handler = originalHandler(
        isInitializing,
        addPropListener,
        removePropListener,
        notifyUpdate
      )

      /**
       * Get trap - Updated with separate onGet and transformGet hooks
       */
      const originalGet = handler.get
      handler.get = (target, prop, receiver) => {
        // Skip metadata symbol access to prevent infinite recursion
        if (prop === ROOT_PROXY_SYMBOL || prop === INSTANCE_ID_SYMBOL || prop === PROXY_PATH_SYMBOL || prop === GLOBAL_PROXY_SYMBOL) {
          return Reflect.get(target, prop, receiver)
        }
        
        let result = originalGet
          ? originalGet(target, prop, receiver)
          : Reflect.get(target, prop, receiver)

        // Get metadata for plugin hooks
        const rootProxy = Reflect.get(receiver, ROOT_PROXY_SYMBOL, receiver)
        const instanceId = Reflect.get(receiver, INSTANCE_ID_SYMBOL, receiver)

        // If the result of the get is a proxy object (i.e. nested object)
        // make sure to propagate the metadata
        if (isObject(result) && result !== receiver) {
          if (rootProxy) {
            // If result doesn't have root metadata yet, add it
            if (!hasRootProxy(result)) {
              const resultTarget = proxyStateMap.get(result)?.[0]

              let parentPath: (string | symbol)[] = []
              if (hasProxyPath(receiver)) {
                parentPath = Reflect.get(receiver, PROXY_PATH_SYMBOL, receiver) as (string | symbol)[]
              }

              const path = [...parentPath, prop]
              const isGlobal = Reflect.get(receiver, GLOBAL_PROXY_SYMBOL, receiver) as boolean | undefined
              const meta = { rootProxy, instanceId, path, isGlobal }

              if (result) addMetaData(result, meta)
              if (resultTarget) addMetaData(resultTarget, meta)
            }
          }
        }

        // Call plugin hooks for property access
        if (
          !isInitializing() &&
          rootProxy && 
          instanceId
        ) {
          let basePath: (string | symbol)[] = []
          if (hasProxyPath(receiver)) {
            basePath = Reflect.get(receiver, PROXY_PATH_SYMBOL, receiver) as (string | symbol)[]
          }
          const fullPath = [...basePath, prop]
          const applicablePlugins = getApplicablePlugins(receiver)

          // Call onGet hooks (observation only, no return value)
          for (const plugin of applicablePlugins) {
            if (plugin.onGet) {
              try {
                plugin.onGet(fullPath.map(String), result, rootProxy)
              } catch (e) {
                console.error(`Error in plugin ${plugin.id} onGet:`, e)
              }
            }
          }

          // Call transformGet hooks (can modify return value)
          for (const plugin of applicablePlugins) {
            if (plugin.transformGet) {
              try {
                const transformedValue = plugin.transformGet(fullPath.map(String), result, rootProxy)
                if (transformedValue !== undefined) {
                  result = transformedValue
                }
              } catch (e) {
                console.error(`Error in plugin ${plugin.id} transformGet:`, e)
              }
            }
          }
        }

        return result
      }

      /**
       * Set trap - Fixed with proper context management and transformSet hook
       */
      const originalSet = handler.set
      handler.set = (target, prop, value, receiver) => {
        // Skip metadata symbol handling
        if (prop === ROOT_PROXY_SYMBOL || prop === INSTANCE_ID_SYMBOL || prop === PROXY_PATH_SYMBOL || prop === GLOBAL_PROXY_SYMBOL) {
          return Reflect.set(target, prop, value, receiver)
        }
        
        // Get metadata directly using Reflect to avoid infinite recursion
        const rootProxy = Reflect.get(receiver, ROOT_PROXY_SYMBOL, receiver)
        const instanceId = Reflect.get(receiver, INSTANCE_ID_SYMBOL, receiver)
        const isGlobal = Reflect.get(receiver, GLOBAL_PROXY_SYMBOL, receiver)

        if (isInitializing()) {
          return originalSet
            ? originalSet(target, prop, value, receiver)
            : Reflect.set(target, prop, value, receiver)
        }

        if (!rootProxy || !instanceId) {
          return originalSet
            ? originalSet(target, prop, value, receiver)
            : Reflect.set(target, prop, value, receiver)
        }

        const prevValue = Reflect.get(target, prop)
        
        let basePath: (string | symbol)[] = []
        if (hasProxyPath(receiver)) {
          basePath = Reflect.get(receiver, PROXY_PATH_SYMBOL, receiver) as (string | symbol)[]
        }
        const fullPath = [...basePath, prop]
        const applicablePlugins = getApplicablePlugins(receiver)

        // Transform the value before setting if any plugins have transformSet
        let transformedValue = value
        for (const plugin of applicablePlugins) {
          if (plugin.transformSet) {
            try {
              const result = plugin.transformSet(fullPath.map(String), transformedValue, rootProxy)
              if (result !== undefined) {
                transformedValue = result
              }
            } catch (e) {
              console.error(`Error in plugin ${plugin.id} transformSet:`, e)
            }
          }
        }

        // In the set handler, before the beforeChange loop:
console.log('[DEBUG] Set handler called for:', String(prop), 'with value:', value);

        
        for (const plugin of applicablePlugins) {
          if (plugin.beforeChange) {
            try {
              const shouldContinue = plugin.beforeChange(
                fullPath.map(String),
                transformedValue,
                prevValue,
                rootProxy
              )

              // In the beforeChange loop:
if (shouldContinue === false) {
  console.log('[DEBUG] PREVENTING CHANGE - beforeChange returned false');
  console.log('[DEBUG] Current target value:', Reflect.get(target, prop));
  console.log('[DEBUG] Returning true from set trap without calling originalSet');
  return true;
}
            } catch (e) {
              console.error(`Error in plugin ${plugin.id} beforeChange:`, e)
            }
          }
        }

        // After the beforeChange loop:
console.log('[DEBUG] All beforeChange hooks passed, calling originalSet');

        // CRITICAL: Set the instance context before calling originalSet
        const previousContext = currentInstanceContext;
        
        // For global proxies, use null context; for instance proxies, use their instance ID
        if (isGlobal) {
          currentInstanceContext = null;
        } else {
          currentInstanceContext = instanceId;
        }

        try {
          const result = originalSet
            ? originalSet(target, prop, transformedValue, receiver)
            : Reflect.set(target, prop, transformedValue, receiver)

            // After originalSet:
console.log('[DEBUG] originalSet result:', result);
console.log('[DEBUG] Final target value:', Reflect.get(target, prop));

          // afterChange lifecycle
          if (result) {
            for (const plugin of applicablePlugins) {
              if (plugin.afterChange) {
                try {
                  plugin.afterChange(
                    fullPath.map(String),
                    transformedValue,
                    rootProxy
                  )
                } catch (e) {
                  console.error(`Error in plugin ${plugin.id} afterChange:`, e)
                }
              }
            }
          }
          return result
        } finally {
          // Restore previous context
          currentInstanceContext = previousContext;
        }
      }

      /**
       * Delete Property - Updated with proper context management
       */
      const originalDeleteProperty = handler.deleteProperty
      handler.deleteProperty = (target, prop) => {
        // Skip metadata symbol handling
        if (prop === ROOT_PROXY_SYMBOL || prop === INSTANCE_ID_SYMBOL || prop === PROXY_PATH_SYMBOL || prop === GLOBAL_PROXY_SYMBOL) {
          return Reflect.deleteProperty(target, prop)
        }
        
        if (isInitializing()) {
          return originalDeleteProperty 
            ? originalDeleteProperty(target, prop) 
            : Reflect.deleteProperty(target, prop)
        }

        // Get the previous value
        const prevValue = Reflect.get(target, prop)

        // Check if target has our metadata
        if (!hasRootProxy(target)) {
          // Not one of our objects, use original handler
          return originalDeleteProperty 
            ? originalDeleteProperty(target, prop) 
            : Reflect.deleteProperty(target, prop)
        }

        // Use Reflect directly to avoid infinite recursion
        const rootProxy = Reflect.get(target, ROOT_PROXY_SYMBOL, target)
        const instanceId = Reflect.get(target, INSTANCE_ID_SYMBOL, target)
        const isGlobal = Reflect.get(target, GLOBAL_PROXY_SYMBOL, target)
        
        let basePath: (string | symbol)[] = []
        if (hasProxyPath(target)) {
          basePath = Reflect.get(target, PROXY_PATH_SYMBOL, target) as (string | symbol)[]
        }
        
        const fullPath = [...basePath, prop]
        const applicablePlugins = getApplicablePlugins(target)

        if (!rootProxy || !instanceId) {
          return originalDeleteProperty
            ? originalDeleteProperty(target, prop)
            : Reflect.deleteProperty(target, prop)
        }

        // Run beforeChange hooks
        for (const plugin of applicablePlugins) {
          if (plugin.beforeChange) {
            try {
              const shouldContinue = plugin.beforeChange(
                fullPath.map(String), 
                undefined, 
                prevValue, 
                rootProxy
              )
              if (shouldContinue === false) {
                // Plugin prevented the deletion
                return false
              }
            } catch (e) {
              console.error(`Error in plugin ${plugin.id} beforeChange:`, e)
            }
          }
        }

        // Set the instance context before calling originalDeleteProperty
        const previousContext = currentInstanceContext;
        
        if (isGlobal) {
          currentInstanceContext = null;
        } else {
          currentInstanceContext = instanceId;
        }

        try {
          // Proceed with the deletion
          const result = originalDeleteProperty 
            ? originalDeleteProperty(target, prop) 
            : Reflect.deleteProperty(target, prop)

          // Run afterChange hooks
          if (result) {
            for (const plugin of applicablePlugins) {
              if (plugin.afterChange) {
                try {
                  plugin.afterChange(
                    fullPath.map(String), 
                    undefined, 
                    rootProxy
                  )
                } catch (e) {
                  console.error(`Error in plugin ${plugin.id} afterChange:`, e)
                }
              }
            }
          }
          return result
        } finally {
          // Restore previous context
          currentInstanceContext = previousContext;
        }
      }

      return handler
    }
  })
}

// Helper to dispose an instance and all its children
const disposeInstanceRecursively = (instanceId: string): void => {
  const registry = instanceRegistry.get(instanceId)
  if (!registry || registry.isDisposed) return

  // Dispose all children first
  for (const childId of registry.children) {
    disposeInstanceRecursively(childId)
  }

  // Remove from parent's children set
  if (registry.parentId) {
    const parentRegistry = instanceRegistry.get(registry.parentId)
    if (parentRegistry) {
      parentRegistry.children.delete(instanceId)
    }
  }

  // Dispose plugins
  for (const plugin of registry.plugins) {
    if (plugin.onDispose) {
      try {
        plugin.onDispose()
      } catch (e) {
        console.error(`Error disposing plugin ${plugin.id}:`, e)
      }
    }
  }

  // Mark as disposed and remove from registry
  registry.isDisposed = true
  registry.children.clear()
  instanceRegistry.delete(instanceId)
}

// Track the current instance context during proxy creation
let currentInstanceContext: string | null = null;

function createProxyInstance(parentInstanceId?: string): ProxyFactory {
  initializePluginSystem()

  const instanceId = createInstanceId()

  const registry: InstanceRegistry = {
    id: instanceId,
    parentId: parentInstanceId,
    plugins: [],
    isDisposed: false,
    children: new Set()
  }

  instanceRegistry.set(instanceId, registry)

  // If this is a child instance, register with parent
  if (parentInstanceId) {
    const parentRegistry = instanceRegistry.get(parentInstanceId)
    if (parentRegistry) {
      parentRegistry.children.add(instanceId)
    }
  }

  const createProxy = <T extends object>(initialState: T): T => {
    if (registry.isDisposed) {
      throw new Error('This instance has been disposed')
    }

    // Set the instance context before creating proxy
    const previousContext = currentInstanceContext;
    currentInstanceContext = instanceId;

    try {
      // Use the original proxy function from valtio
      const valtioProxyInstance = valtioProxy(initialState)
      
      // Add our metadata - mark as instance proxy (NOT global)
      const meta = { 
        rootProxy: valtioProxyInstance, 
        instanceId, 
        path: [],
        isGlobal: false  // Critical: mark as NOT global
      }
      addMetaData(valtioProxyInstance, meta)

      // Call plugin initialization hooks for all applicable plugins (including inherited)
      const applicablePlugins = getApplicablePlugins(valtioProxyInstance)
      for(const plugin of applicablePlugins) {
        if (plugin.onInit) {
          try {
            plugin.onInit()
          } catch (e) {
            console.error(`Error in plugin ${plugin.id} onInit:`, e)
          }
        }
      }

      return valtioProxyInstance
    } finally {
      // Restore previous context
      currentInstanceContext = previousContext;
    }
  }

  // Create a proxy for the factory function to expose plugin APIs
  const proxyFn = new Proxy(createProxy, {
    get(target, prop) {
      // First check if it's one of our methods
      if (prop === 'use' || prop === 'subscribe' || prop === 'snapshot' || prop === 'dispose' || prop === 'createInstance') {
        return Reflect.get(target, prop)
      }

      // Check if it's a plugin (including inherited ones)
      if (typeof prop === 'string') {
        const applicablePlugins = getApplicablePlugins({ [INSTANCE_ID_SYMBOL]: instanceId } as EnhancedProxy)
        const plugin = applicablePlugins.find(p => p.id === prop)
        if (plugin) {
          return plugin // Return the whole plugin object
        }
      }
      
      // Otherwise return the property from the target
      return Reflect.get(target, prop)
    }
  })
  
  // Add methods to the proxied function
  Object.defineProperties(proxyFn, {
    use: {
      value: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => {
        if (registry.isDisposed) {
          throw new Error('This instance has been disposed')
        }
        
        const pluginsToAdd = Array.isArray(pluginOrPlugins) 
          ? pluginOrPlugins 
          : [pluginOrPlugins]

        for (const plugin of pluginsToAdd) {
          const existingIndex = registry.plugins.findIndex(p => p.id === plugin.id)
          if (existingIndex >= 0) {
            registry.plugins[existingIndex] = plugin
          } else {
            registry.plugins.push(plugin)
          }
          
          // Call onAttach if it exists
          if (plugin.onAttach) {
            try {
              plugin.onAttach(proxyFn as ProxyFactory)
            } catch (e) {
              console.error(`Error in plugin ${plugin.id} onAttach:`, e)
            }
          }
        }
        
        return proxyFn as ProxyFactory // For chaining
      },
      enumerable: true,
      configurable: true,
    },

    createInstance: {
      value: (): ProxyFactory => {
        if (registry.isDisposed) {
          throw new Error('This instance has been disposed')
        }
        
        // Create a child instance with this instance as parent
        return createProxyInstance(instanceId)
      },
      enumerable: true,
      configurable: true,
    },

    subscribe: {
      value: <T extends object>(
        proxyObject: T,
        callback: (ops: INTERNAL_Op[]) => void,
        notifyInSync?: boolean
      ): (() => void) => {
        if (registry.isDisposed) {
          throw new Error('This instance has been disposed')
        }
        
        // Check if this proxy belongs to this instance hierarchy
        if (isObject(proxyObject) && hasInstanceId(proxyObject)) {
          const proxyInstanceId = proxyObject[INSTANCE_ID_SYMBOL]
          
          // Check if this proxy belongs to this instance or any of its descendants
          const isFromThisHierarchy = (checkId: string): boolean => {
            if (checkId === instanceId) return true
            const checkRegistry = instanceRegistry.get(checkId)
            return checkRegistry?.parentId ? isFromThisHierarchy(checkRegistry.parentId) : false
          }
          
          if (proxyInstanceId && isFromThisHierarchy(proxyInstanceId)) {
            // Run onSubscribe hooks for applicable plugins
            const applicablePlugins = getApplicablePlugins(proxyObject)
            for (const plugin of applicablePlugins) {
              if (plugin.onSubscribe) {
                try {
                  plugin.onSubscribe(proxyObject, callback)
                } catch (e) {
                  console.error(`Error in plugin ${plugin.id} onSubscribe:`, e)
                }
              }
            }
          }
        }
        
        // Use Valtio's subscribe
        return originalSubscribe(proxyObject, callback, notifyInSync)
      },
      enumerable: true,
      configurable: true,
    },

    snapshot: {
      value: <T extends object>(proxyObject: T): Snapshot<T> | Record<string, unknown> => {
        if (registry.isDisposed) {
          throw new Error('This instance has been disposed')
        }
        
        let snap: Record<string, unknown> = originalSnapshot(proxyObject) as Record<string, unknown>
        
        if (isObject(proxyObject) && hasInstanceId(proxyObject)) {
          const proxyInstanceId = proxyObject[INSTANCE_ID_SYMBOL]
          
          // Check if this proxy belongs to this instance hierarchy
          const isFromThisHierarchy = (checkId: string): boolean => {
            if (checkId === instanceId) return true
            const checkRegistry = instanceRegistry.get(checkId)
            return checkRegistry?.parentId ? isFromThisHierarchy(checkRegistry.parentId) : false
          }
          
          if (proxyInstanceId && isFromThisHierarchy(proxyInstanceId)) {
            const applicablePlugins = getApplicablePlugins(proxyObject)
            for(const plugin of applicablePlugins) {
              if (plugin.onSnapshot) {
                try {
                  plugin.onSnapshot(snap)
                } catch (e) {
                  console.error(`Error in plugin ${plugin.id} onSnapshot:`, e)
                }
              }
            }
          }
        }
        
        // Cast back to the union type for the return
        return snap as Snapshot<T> | Record<string, unknown>
      },
      enumerable: true,
      configurable: true,
    },

    dispose: {
      value: () => {
        disposeInstanceRecursively(instanceId)
      },
      enumerable: true,
      configurable: true,
    }
  })

  return proxyFn as ProxyFactory
}

// Initialize the plugin system when this module is imported
initializePluginSystem()

// Augment the original valtio proxy with plugin methods
const augmentValtioProxy = () => {
  const originalProxy = valtioProxy as any
  
  // Store the original proxy call functionality
  const originalProxyCall = originalProxy.bind({})
  
  const globalId = createGlobalId()

  const createGlobalProxy = <T extends object>(initialState: T): T => {
    const previousContext = currentInstanceContext;
    currentInstanceContext = null;

    try {
      // Use the original proxy function from valtio
      const valtioProxyInstance = originalProxyCall(initialState)
      
      // Add global metadata
      const meta = { rootProxy: valtioProxyInstance, instanceId: globalId, path: [], isGlobal: true}
      addMetaData(valtioProxyInstance, meta)

      // Call plugin initialization hooks for global plugins
      for(const plugin of globalPluginRegistry) {
        if (plugin.onInit) {
          try {
            plugin.onInit()
          } catch (e) {
            console.error(`Error in plugin ${plugin.id} onInit:`, e)
          }
        }
      }

      return valtioProxyInstance
    } finally {
      currentInstanceContext = previousContext;
    }
  }

  // Add methods directly to the valtio proxy function using defineProperty
  Object.defineProperty(originalProxy, 'use', {
    value: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => {
      const pluginsToAdd = Array.isArray(pluginOrPlugins) 
        ? pluginOrPlugins 
        : [pluginOrPlugins]

      for (const plugin of pluginsToAdd) {
        const existingIndex = globalPluginRegistry.findIndex(p => p.id === plugin.id)
        if (existingIndex >= 0) {
          globalPluginRegistry[existingIndex] = plugin
        } else {
          globalPluginRegistry.push(plugin)
        }
        
        // Call onAttach if it exists
        if (plugin.onAttach) {
          try {
            plugin.onAttach(originalProxy)
          } catch (e) {
            console.error(`Error in plugin ${plugin.id} onAttach:`, e)
          }
        }
      }
      
      return originalProxy // For chaining
    },
    writable: true,
    configurable: true
  })

  Object.defineProperty(originalProxy, 'subscribe', {
    value: <T extends object>(
      proxyObject: T,
      callback: (ops: INTERNAL_Op[]) => void,
      notifyInSync?: boolean
    ): (() => void) => {
      // Get applicable plugins for this proxy
      const applicablePlugins = getApplicablePlugins(proxyObject)
      
      // Call onSubscribe hooks for all applicable plugins
      for (const plugin of applicablePlugins) {
        if (plugin.onSubscribe) {
          try {
            plugin.onSubscribe(proxyObject, callback)
          } catch (e) {
            console.error(`Error in plugin ${plugin.id} onSubscribe:`, e)
          }
        }
      }
      
      return originalSubscribe(proxyObject, callback, notifyInSync)
    },
    writable: true,
    configurable: true
  })

  Object.defineProperty(originalProxy, 'snapshot', {
    value: <T extends object>(proxyObject: T): Snapshot<T> => {
      let snap = originalSnapshot(proxyObject) as Record<string, unknown>
      
      // Apply onSnapshot hooks from applicable plugins
      const applicablePlugins = getApplicablePlugins(proxyObject)
      for (const plugin of applicablePlugins) {
        if (plugin.onSnapshot) {
          try {
            plugin.onSnapshot(snap)
          } catch (e) {
            console.error(`Error in plugin ${plugin.id} onSnapshot:`, e)
          }
        }
      }
      
      return snap as Snapshot<T>
    },
    writable: true,
    configurable: true
  })

  Object.defineProperty(originalProxy, 'createInstance', {
    value: () => createProxyInstance(),
    writable: true,
    configurable: true
  })

  Object.defineProperty(originalProxy, 'clearPlugins', {
    value: () => {
      globalPluginRegistry.length = 0
    },
    writable: true,
    configurable: true
  })

  Object.defineProperty(originalProxy, 'getPlugins', {
    value: () => {
      return [...globalPluginRegistry] as readonly ValtioPlugin[]
    },
    writable: true,
    configurable: true
  })

  Object.defineProperty(originalProxy, 'removePlugin', {
    value: (pluginId: string): boolean => {
      const index = globalPluginRegistry.findIndex(p => p.id === pluginId)
      if (index >= 0) {
        globalPluginRegistry.splice(index, 1)
        return true
      }
      return false
    },
    writable: true,
    configurable: true
  })

  // Add proxy access for plugins
  const proxyHandler = {
    get(target: any, prop: string | symbol) {
      // Check if it's a plugin
      if (typeof prop === 'string') {
        const plugin = globalPluginRegistry.find(p => p.id === prop)
        if (plugin) {
          return plugin // Return the whole plugin object
        }
      }
      
      // Otherwise return the property from the target
      return Reflect.get(target, prop)
    },
    apply(target: any, thisArg: any, argArray: any[]) {
      return createGlobalProxy(argArray[0])
    }
  }

  return new Proxy(originalProxy, proxyHandler)
}

// Augment the valtio proxy and export it
const augmentedProxy = augmentValtioProxy()

// Store reference to the exported proxy for method chaining
let exportedProxy: any = null

// Update the use method to return the exported proxy for chaining
const originalUse = (augmentedProxy as any).use
Object.defineProperty(augmentedProxy, 'use', {
  value: (...args: any[]) => {
    originalUse.apply(augmentedProxy, args)
    return exportedProxy // Return the exported proxy for chaining
  },
  writable: true,
  configurable: true
})

export const proxy = augmentedProxy
exportedProxy = proxy

// Also export as enhancedProxy for backward compatibility
export { proxy as enhancedProxy }