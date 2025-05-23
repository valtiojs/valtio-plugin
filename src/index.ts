import {
  type INTERNAL_Op,
  proxy as originalProxy,
  snapshot as originalSnapshot,
  subscribe as originalSubscribe,
  Snapshot,
  unstable_getInternalStates,
  unstable_replaceInternalFunction,
} from 'valtio'

const ROOT_PROXY_SYMBOL = Symbol('valtio-plugin-root')
const PROXY_PATH_SYMBOL = Symbol('valtio-plugin-path')
const INSTANCE_ID_SYMBOL = Symbol('valtio-plugin-instance-id')

const { proxyStateMap } = unstable_getInternalStates()

// Plugin type definition
export type ValtioPlugin = {
  id: string
  name?: string
  
  // Lifecycle hooks
  onInit?: () => void
  onAttach?: (proxyFactory: ProxyFactory) => void
  beforeChange?: (path: string[], value: unknown, prevValue: unknown, state: object) => undefined | boolean
  afterChange?: (path: string[], value: unknown, state: object) => void
  onSubscribe?: (proxy: object, callback: (ops: INTERNAL_Op[]) => void) => void
  onGet?: (path: string[], value: unknown, state: object) => void
  onDispose?: () => void
  
  // Path-specific handlers
  pathHandlers?: Record<string, (value: unknown, state: object) => void>
  
  // Snapshot modification
  alterSnapshot?: (snapshot: Record<string, unknown>) => Record<string, unknown>

  // Plugin authors should be able to add whatevery they want here
  [key: string]: any
}

// Define the type for the proxy factory function
export interface ProxyFactory {
  <T extends object>(initialState: T): T
  use: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => ProxyFactory
  subscribe: <T extends object>(
    proxyObject: T,
    callback: (ops: INTERNAL_Op[]) => void,
    notifyInSync?: boolean
  ) => (() => void)
  snapshot: <T extends object>(proxyObject: T) => Snapshot<T> | Record<string, unknown>
  dispose: () => void
  [key: string | symbol]: any // For plugin symbol access
}

interface EnhancedProxy {
  [ROOT_PROXY_SYMBOL]?: object,
  [PROXY_PATH_SYMBOL]?: (string | symbol)[],
  [INSTANCE_ID_SYMBOL]?: string
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

let currentId = 0
const createInstanceId = () => {
  return `valtio-plugin-${currentId++}`
}

const isObject = (x: unknown): x is object =>
  typeof x === 'object' && x !== null

interface InstanceRegistry {
  id: string
  plugins: ValtioPlugin[]
  isDisposed: boolean
}

const instanceRegistry = new Map<string, InstanceRegistry>()

const addMetaData = (obj: object, meta: {rootProxy?: object, instanceId?: string, path?: (string | symbol)[]}) => {
  const { rootProxy, instanceId, path } = meta

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
}

let isInitialized = false

const initializePluginSystem = () => {
  if (isInitialized) return
  isInitialized = true

  unstable_replaceInternalFunction('createHandler', (originalHandler) => {
    return (isInitializing, addPropListener, removePropListener, notifyUpdate) => {
      const handler = originalHandler(
        isInitializing,
        addPropListener,
        removePropListener,
        notifyUpdate
      )

      // Propagate "root proxy" metadata to nested objects so there's
      // no need to traverse through objects when modifying nested values
      // in order to know which "instance" we're working with

      /**
       * Get trap
       */
      const originalGet = handler.get
      handler.get = (target, prop, receiver) => {
        // Skip metadata symbol access to prevent infinite recursion
        if (prop === ROOT_PROXY_SYMBOL || prop === INSTANCE_ID_SYMBOL || prop === PROXY_PATH_SYMBOL) {
          return Reflect.get(target, prop, receiver)
        }
        
        const result = originalGet
          ? originalGet(target, prop, receiver)
          : Reflect.get(target, prop, receiver)

        // Get metadata for plugin hooks
        const rootProxy = Reflect.get(receiver, ROOT_PROXY_SYMBOL, receiver)
        const instanceId = Reflect.get(receiver, INSTANCE_ID_SYMBOL, receiver)
        const registry = instanceId ? instanceRegistry.get(instanceId) : undefined

        // If the result of the get is a proxy object (i.e. nested object)
        // make sure to propagate the "root" (aka instance) meta data
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
              const meta = { rootProxy, instanceId, path }

              if (result) addMetaData(result, meta)
              if (resultTarget) addMetaData(resultTarget, meta)
            }
          }
        }

        // Call onGet hooks for ALL property access (not just nested objects)
        if (
          !isInitializing() &&
          rootProxy && 
          instanceId &&
          registry &&
          !registry.isDisposed
        ) {
          let basePath: (string | symbol)[] = []
          if (hasProxyPath(receiver)) {
            basePath = Reflect.get(receiver, PROXY_PATH_SYMBOL, receiver) as (string | symbol)[]
          }
          const fullPath = [...basePath, prop]

          for (const plugin of registry.plugins) {
            if (plugin.onGet) {
              try {
                plugin.onGet(
                  fullPath.map(String),
                  result,
                  rootProxy
                )
              } catch (e) {
                console.error(`Error in plugin {name: ${plugin.name || 'unnamed'}, id: ${plugin.id}} in onGet: `, e)
              }
            }
          }
        }

        return result
      }

      /**
       * Set trap
       */
      const originalSet = handler.set
      handler.set = (target, prop, value, receiver) => {
        // Skip metadata symbol handling
        if (prop === ROOT_PROXY_SYMBOL || prop === INSTANCE_ID_SYMBOL || prop === PROXY_PATH_SYMBOL) {
          return Reflect.set(target, prop, value, receiver)
        }
        
        // Get metadata directly using Reflect to avoid infinite recursion
        const rootProxy = Reflect.get(receiver, ROOT_PROXY_SYMBOL, receiver)
        const instanceId = Reflect.get(receiver, INSTANCE_ID_SYMBOL, receiver)
        const registry = instanceId ? instanceRegistry.get(instanceId) : undefined

        if (
          isInitializing() ||
          !rootProxy || 
          !instanceId ||
          !registry ||
          registry.isDisposed
        ) {
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

        for (const plugin of registry.plugins) {
          if (plugin.beforeChange) {
            try {
              const shouldContinue = plugin.beforeChange(
                fullPath.map(String),
                value,
                prevValue,
                rootProxy
              )

              if (shouldContinue === false) {
                // Plugin prevented the update
                return true // Indicate success without actually setting
              }
            } catch (e) {
              console.error(`Error in plugin {name: ${plugin.name || 'unnamed'}, id: ${plugin.id}} in beforeChange: `, e)
            }
          }
        }

        const result = originalSet
          ? originalSet(target, prop, value, receiver)
          : Reflect.set(target, prop, value, receiver)

        // afterChange lifecycle
        if (result) {
          for (const plugin of registry.plugins) {
            if (plugin.afterChange) {
              try {
                plugin.afterChange(
                  fullPath.map(String),
                  value,
                  rootProxy
                )
              } catch (e) {
                console.error(`Error in plugin: {name: ${plugin.name || 'unnamed'}, id: ${plugin.id}} in afterChange: `, e)
              }
            }
          }
        }
        return result
      }

      /**
       * Delete Property
       */
      const originalDeleteProperty = handler.deleteProperty
      handler.deleteProperty = (target, prop) => {
        // Skip metadata symbol handling
        if (prop === ROOT_PROXY_SYMBOL || prop === INSTANCE_ID_SYMBOL || prop === PROXY_PATH_SYMBOL) {
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
        
        let basePath: (string | symbol)[] = []
        if (hasProxyPath(target)) {
          basePath = Reflect.get(target, PROXY_PATH_SYMBOL, target) as (string | symbol)[]
        }
        
        const registry = instanceId ? instanceRegistry.get(instanceId) : undefined
        const fullPath = [...basePath, prop]

        if (
          isInitializing() ||
          !rootProxy || 
          !instanceId ||
          !registry ||
          registry.isDisposed
        ) {
          return originalDeleteProperty
            ? originalDeleteProperty(target, prop)
            : Reflect.deleteProperty(target, prop)
        }

        // Run beforeChange hooks
        for (const plugin of registry.plugins) {
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
              console.error(`Error in plugin: {name: ${plugin.name || 'unnamed'}, id: ${plugin.id}}: beforeChange: `, e)
            }
          }
        }

        // Proceed with the deletion
        const result = originalDeleteProperty 
          ? originalDeleteProperty(target, prop) 
          : Reflect.deleteProperty(target, prop)

        // Run afterChange hooks
        if (result) {
          for (const plugin of registry.plugins) {
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
      }

      return handler
    }
  })
}

export function proxyInstance(): ProxyFactory {
  initializePluginSystem()

  const instanceId = createInstanceId()

  const registry: InstanceRegistry = {
    id: instanceId,
    plugins: [],
    isDisposed: false
  }

  instanceRegistry.set(instanceId, registry)

  const createProxy = <T extends object>(initialState: T): T => {
    if (registry.isDisposed) {
      throw new Error('This instance has been disposed')
    }

    // Create the proxy with valtio
    const valtioProxy = originalProxy(initialState)
    
    // Add our metadata
    const meta = { rootProxy: valtioProxy, instanceId, path: []}
    addMetaData(valtioProxy, meta)

    // Call plugin initialization hooks
    for(const plugin of registry.plugins) {
      if (plugin.onInit) {
        try {
          plugin.onInit()
        } catch (e) {
          console.error(`Error in plugin ${plugin.id} onInit:`, e)
        }
      }
    }

    // We need to return valtioProxy directly without wrapping it
    // because valtio's subscribe and snapshot rely on the original proxy
    return valtioProxy
  }

  // Create a proxy for the factory function to expose plugin APIs
  const proxyFn = new Proxy(createProxy, {
    get(target, prop) {
      // First check if it's one of our methods
      if (prop === 'use' || prop === 'subscribe' || prop === 'snapshot' || prop === 'dispose') {
        return Reflect.get(target, prop)
      }

      // Check if it's a plugin
      if (typeof prop === 'string') {
        const plugin = registry.plugins.find(p => p.id === prop)
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

    subscribe: {
      value: <T extends object>(
        proxyObject: T,
        callback: (ops: INTERNAL_Op[]) => void,
        notifyInSync?: boolean
      ): (() => void) => {
        if (registry.isDisposed) {
          throw new Error('This instance has been disposed')
        }
        
        // Check if this proxy belongs to this instance
        if (isObject(proxyObject) && hasInstanceId(proxyObject)) {
          const instanceId = proxyObject[INSTANCE_ID_SYMBOL]
          if (instanceId === registry.id) {
            // Run onSubscribe hooks
            registry.plugins.forEach(plugin => {
              if (plugin.onSubscribe) {
                try {
                  plugin.onSubscribe(proxyObject, callback)
                } catch (e) {
                  console.error(`Error in plugin ${plugin.id} onSubscribe:`, e)
                }
              }
            })
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
          const instanceId = proxyObject[INSTANCE_ID_SYMBOL]
          if (instanceId === registry.id) {
            for(const plugin of registry.plugins) {
              if (plugin.alterSnapshot) {
                try {
                  snap = plugin.alterSnapshot(snap)
                } catch (e) {
                  console.error(`Error in plugin ${plugin.id} alterSnapshot:`, e)
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
        if (registry.isDisposed) return
        
        // Give plugins a chance to clean up
        for (const plugin of registry.plugins) {
          if (plugin.onDispose) {
            try {
              plugin.onDispose()
            } catch (e) {
              console.error(`Error disposing plugin ${plugin.id}:`, e)
            }
          }
        }
        
        registry.isDisposed = true
        registry.plugins.length = 0
        instanceRegistry.delete(instanceId)
      }
    }
  })

  return proxyFn as ProxyFactory
}

