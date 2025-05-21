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
  beforeChange?: (path: string[], value: unknown, prevValue: unknown, state: object) => undefined | boolean
  afterChange?: (path: string[], value: unknown, state: object) => void
  onSubscribe?: (proxy: object, callback: (ops: INTERNAL_Op[]) => void) => void
  
  // Path-specific handlers
  pathHandlers?: Record<string, (value: unknown, state: object) => void>
  
  // Snapshot modification
  alterSnapshot?: <T, AlteredSnapshot = Snapshot<T>>(snapshot: Snapshot<T>) => AlteredSnapshot

  // Plugin API access
  symbol?: symbol
  api?: Record<string, any>
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
  pluginApis: Map<symbol, unknown>
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

      /**
       * Get trap
       */
      const originalGet = handler.get
      handler.get = (target, prop, receiver) => {
        const result = originalGet
          ? originalGet(target, prop, receiver)
          : Reflect.get(target, prop, receiver)

        // If the result of the get is a proxy object (i.e. nested object)
        // make sure to propagate the "root" (aka instance) meta data
        if (isObject(result) && result !== receiver) {
          if (hasRootProxy(receiver)) {
            const rootProxy = receiver[ROOT_PROXY_SYMBOL]

            // If result doesn't have root metadata yet, add it
            if (!hasRootProxy(result)) {
              const resultTarget = proxyStateMap.get(result)?.[0]

              const instanceId = hasInstanceId(receiver) 
                ? receiver[INSTANCE_ID_SYMBOL]
                : undefined

              const parentPath = hasProxyPath(receiver)
                ? receiver[PROXY_PATH_SYMBOL] as (string | symbol)[]
                : []

              const path = [...parentPath, prop]

              const meta = { rootProxy, instanceId, path }

              if (result) addMetaData(result, meta)
              if (resultTarget) addMetaData(resultTarget, meta)
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
        const rootProxy = receiver[ROOT_PROXY_SYMBOL]
        const instanceId = receiver[INSTANCE_ID_SYMBOL]
        const registry = instanceRegistry.get(instanceId)

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
        
        const basePath = hasProxyPath(receiver)
          ? receiver[PROXY_PATH_SYMBOL] as (string | symbol)[]
          : []
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
              console.error(`Error in plugin {name: ${plugin.name}, id: ${plugin.id} in beforeChange within set trap: `, e)
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
                console.error(`Error in plugin: {name: ${plugin.name}, id: ${plugin.id}} in afterChange within set trap: `, e)
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
        if (isInitializing()) {
          return originalDeleteProperty 
            ? originalDeleteProperty(target, prop) 
            : Reflect.deleteProperty(target, prop)
        }

        // Find which target objects have our metadata
        const state = proxyStateMap.get(target)

        // Get the previous value
        const prevValue = Reflect.get(target, prop)

        // Check if target has our metadata
        if (
          !hasRootProxy(target)) {
          // Not one of our objects, use original handler
          return originalDeleteProperty 
            ? originalDeleteProperty(target, prop) 
            : Reflect.deleteProperty(target, prop)
        }

        const rootProxy = hasRootProxy(target)
          ? target[ROOT_PROXY_SYMBOL]
          : undefined
        const instanceId = hasInstanceId(target)
          ? target[INSTANCE_ID_SYMBOL]
          : undefined
        const basePath = hasProxyPath(target) 
          ? target[PROXY_PATH_SYMBOL as keyof typeof target] as (string | symbol)[]
          : []
        const registry = instanceRegistry.get(instanceId as string)
        const fullPath = [...basePath, prop]

        if (
          isInitializing() ||
          !rootProxy || 
          !instanceId ||
          !registry ||
          registry.isDisposed ||
          !state
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
                rootProxy as object
              )
              if (shouldContinue === false) {
                // Plugin prevented the deletion
                return false
              }
            } catch (e) {
              console.error(`Error in plugin: {name: ${plugin.name}, id: ${plugin.id}}: beforeChange: `, e)
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
                  rootProxy as object
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

export function proxyInstance() {
  initializePluginSystem()

  const instanceId = createInstanceId()

  const registry: InstanceRegistry = {
    id: instanceId,
    plugins: [],
    pluginApis: new Map(),
    isDisposed: false
  }

  instanceRegistry.set(instanceId, registry)

  const createProxy = <T extends object>(initialState: T) => {
    if (registry.isDisposed) {
      throw new Error('This instance has been disposed')
    }

    const valtioProxy = originalProxy(initialState)
    const meta = { rootProxy: valtioProxy, instanceId, path: []}

    addMetaData(valtioProxy, meta)

    for(const plugin of registry.plugins) {
      if (plugin.onInit) plugin.onInit()
    }

    return new Proxy(valtioProxy, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' && registry.pluginApis.has(prop)) {
          return registry.pluginApis.get(prop)
        }

        return Reflect.get(target, prop, receiver)
      }
    })
  }

  const proxyFn = Object.assign(createProxy, {
    use: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => {
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
        
        // Store the plugin API if provided
        if (plugin.symbol && plugin.api) {
          registry.pluginApis.set(plugin.symbol, plugin.api)
        }
      }
      
      return proxyFn // For chaining
    },

    subscribe: <T extends object>(
      proxyObject: T,
      callback: (ops: INTERNAL_Op[]) => void,
      notifyInSync?: boolean
    ): (() => void) => {
      if (registry.isDisposed) {
        throw new Error('This instance has been disposed')
      }
      
      // Check if this proxy belongs to this instance
      if (hasRootProxy(proxyObject)) {
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

    snapshot: <T extends object>(proxyObject: T) => {
      if (registry.isDisposed) {
        throw new Error('This instance has been disposed')
      }
      
      // Get the original snapshot
      let snap = originalSnapshot(proxyObject)
      
      // Check if this proxy belongs to this instance
      if (hasRootProxy(proxyObject)) {
        const instanceId = proxyObject[INSTANCE_ID_SYMBOL]
        if (instanceId === registry.id) {
          // Apply alterSnapshot hooks
          for(const plugin of registry.plugins) {
            if (plugin.alterSnapshot) {
              snap = plugin.alterSnapshot(snap)
            }
          }
        }
      }
      
      return snap
    },

    dispose: () => {
      if (registry.isDisposed) return;
      
      registry.isDisposed = true;
      registry.pluginApis.clear();
      registry.plugins.length = 0;
      instanceRegistry.delete(instanceId);
    }
  })

  return proxyFn
}