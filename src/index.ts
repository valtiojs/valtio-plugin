// We want to import this from vanilla so that we don't get any
// errors when not using react (valtio main pacakge exports useSnapshot)
// which has a react dependency

// It's important to import something from the main package that doesn't
// require react so that we can augment the main valtio module
import type { INTERNAL_Op } from "valtio"
import {
	snapshot as originalSnapshot,
	subscribe as originalSubscribe,
	type Snapshot,
	unstable_getInternalStates,
	unstable_replaceInternalFunction,
	proxy as valtioProxy,
} from "valtio/vanilla"

// Import types from the separate augmentation file
import type { EnhancedGlobalProxy, ProxyFactory, ValtioPlugin } from "./valtio-plugin"

// Re-export types for convenience
export type { ValtioPlugin, ProxyFactory, EnhancedGlobalProxy }

// Module augmentation to add methods to valtio's proxy function
declare module "valtio" {
	namespace proxy {
		function use(pluginOrPlugins: ValtioPlugin | ValtioPlugin[]): typeof proxy
		function subscribe<T extends object>(
			proxyObject: T,
			callback: (ops: INTERNAL_Op[]) => void,
			notifyInSync?: boolean,
		): () => void
		function snapshot<T extends object>(proxyObject: T): Snapshot<T>
		function removePlugin(pluginId: string): boolean
		function getPlugins(): readonly ValtioPlugin[]
		function clearPlugins(): void
		function createInstance(): ProxyFactory
	}
}

const ROOT_PROXY_SYMBOL = Symbol("valtio-plugin-root")
const PROXY_PATH_SYMBOL = Symbol("valtio-plugin-path")
const INSTANCE_ID_SYMBOL = Symbol("valtio-plugin-instance-id")
const GLOBAL_PROXY_SYMBOL = Symbol("valtio-plugin-global")
const RAW_HOOKS_COUNT_SYMBOL = Symbol("valtio-plugin-raw-hooks-count")

const { proxyStateMap } = unstable_getInternalStates()

interface EnhancedProxy {
	[ROOT_PROXY_SYMBOL]?: object
	[PROXY_PATH_SYMBOL]?: (string | symbol)[]
	[INSTANCE_ID_SYMBOL]?: string
	[GLOBAL_PROXY_SYMBOL]?: boolean
	[RAW_HOOKS_COUNT_SYMBOL]?: number
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

const createGlobalId = () => {
	return `valtio-global-${currentId++}`
}

const isObject = (x: unknown): x is object => typeof x === "object" && x !== null

interface InstanceRegistry {
	id: string
	parentId?: string
	plugins: ValtioPlugin[]
	isDisposed: boolean
	children: Set<string>
	rawHooksCount: number
	// Cache the full plugin chain for this instance (including inherited)
	cachedPluginChain: ValtioPlugin[] | null
}

// Global plugin registry for enhanced proxy
const globalPluginRegistry: ValtioPlugin[] = []
const instanceRegistry = new Map<string, InstanceRegistry>()
let globalRawHooksCount = 0

// Cache generation - bump when any plugin changes to invalidate caches
let pluginCacheGeneration = 0

// WeakMap cache for applicable plugins per proxy object
interface CachedPlugins extends Array<ValtioPlugin> {
	_generation?: number
	_instanceId?: string
}
const pluginCache = new WeakMap<object, CachedPlugins>()

const invalidatePluginCaches = () => {
	pluginCacheGeneration++
	// Clear instance-level caches
	for (const registry of instanceRegistry.values()) {
		registry.cachedPluginChain = null
	}
}

const addMetaData = (
	obj: object,
	meta: {
		rootProxy?: object
		instanceId?: string
		path?: (string | symbol)[]
		isGlobal?: boolean
		rawHooksCount?: number
	},
) => {
	const { rootProxy, instanceId, path, isGlobal, rawHooksCount } = meta

	if (rootProxy) {
		Object.defineProperty(obj, ROOT_PROXY_SYMBOL, {
			value: rootProxy,
			enumerable: false,
			configurable: true,
		})
	}

	if (instanceId) {
		Object.defineProperty(obj, INSTANCE_ID_SYMBOL, {
			value: instanceId,
			enumerable: false,
			configurable: true,
		})
	}

	if (Array.isArray(path) && path.length > 0) {
		Object.defineProperty(obj, PROXY_PATH_SYMBOL, {
			value: path,
			enumerable: false,
			configurable: true,
		})
	}

	if (isGlobal !== undefined) {
		Object.defineProperty(obj, GLOBAL_PROXY_SYMBOL, {
			value: isGlobal,
			enumerable: false,
			configurable: true,
		})
	}

	if (rawHooksCount !== undefined) {
		Object.defineProperty(obj, RAW_HOOKS_COUNT_SYMBOL, {
			value: rawHooksCount,
			enumerable: false,
			configurable: true,
			writable: true, // Allow updates when plugins change
		})
	}
}

// Build the plugin chain for an instance (including inherited plugins)
const buildInstancePluginChain = (instanceId: string): ValtioPlugin[] => {
	const plugins: ValtioPlugin[] = []

	// Always add global plugins first
	plugins.push(...globalPluginRegistry)

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

	return plugins
}

// Get the total raw hooks count for an instance (including inherited)
const getInstanceRawHooksCount = (instanceId: string): number => {
	let count = 0

	let currentInstanceId: string | undefined = instanceId
	while (currentInstanceId) {
		const registry = instanceRegistry.get(currentInstanceId)
		if (!registry) break
		count += registry.rawHooksCount
		currentInstanceId = registry.parentId
	}

	return count
}

// Optimized: Get applicable plugins with caching
const getApplicablePlugins = (obj: object): readonly ValtioPlugin[] => {
	// Fast path: no plugins at all
	if (globalPluginRegistry.length === 0 && instanceRegistry.size === 0) {
		return []
	}

	// Fast path: global proxy or no instance ID - just return global plugins
	if (!hasInstanceId(obj)) {
		return globalPluginRegistry
	}

	const instanceId = (obj as EnhancedProxy)[INSTANCE_ID_SYMBOL]
	if (!instanceId) {
		return globalPluginRegistry
	}

	// Check WeakMap cache first
	const cached = pluginCache.get(obj) as CachedPlugins | undefined
	if (cached && cached._generation === pluginCacheGeneration && cached._instanceId === instanceId) {
		return cached
	}

	// Check instance-level cache
	const registry = instanceRegistry.get(instanceId)
	if (registry) {
		if (!registry.cachedPluginChain) {
			registry.cachedPluginChain = buildInstancePluginChain(instanceId)
		}

		// Store in WeakMap for this specific object
		const result = registry.cachedPluginChain as CachedPlugins
		result._generation = pluginCacheGeneration
		result._instanceId = instanceId
		pluginCache.set(obj, result)

		return result
	}

	// Fallback: just global plugins
	return globalPluginRegistry
}

// Optimized: Get applicable plugins without caching (for one-off use)
const getApplicablePluginsUncached = (instanceId: string | undefined): readonly ValtioPlugin[] => {
	if (!instanceId) {
		return globalPluginRegistry
	}

	const registry = instanceRegistry.get(instanceId)
	if (registry) {
		if (!registry.cachedPluginChain) {
			registry.cachedPluginChain = buildInstancePluginChain(instanceId)
		}
		return registry.cachedPluginChain
	}

	return globalPluginRegistry
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
				const pluginsToAdd = Array.isArray(pluginOrPlugins) ? pluginOrPlugins : [pluginOrPlugins]

				for (const plugin of pluginsToAdd) {
					const existingIndex = globalPluginRegistry.findIndex((p) => p.id === plugin.id)
					if (existingIndex >= 0) {
						const oldPlugin = globalPluginRegistry[existingIndex]
						if (oldPlugin.onGetRaw) globalRawHooksCount--
						if (plugin.onGetRaw) globalRawHooksCount++

						globalPluginRegistry[existingIndex] = plugin
					} else {
						globalPluginRegistry.push(plugin)
						if (plugin.onGetRaw) globalRawHooksCount++
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

				// Invalidate caches when plugins change
				invalidatePluginCaches()

				return valtioProxy as EnhancedGlobalProxy
			},
			enumerable: true,
			configurable: true,
		},

		subscribe: {
			value: <T extends object>(
				proxyObject: T,
				callback: (ops: INTERNAL_Op[]) => void,
				notifyInSync?: boolean,
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
				const snap: Record<string, unknown> = originalSnapshot(proxyObject) as Record<
					string,
					unknown
				>

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
				const index = globalPluginRegistry.findIndex((p) => p.id === pluginId)
				if (index >= 0) {
					const plugin = globalPluginRegistry[index]

					if (plugin.onDispose) {
						try {
							plugin.onDispose()
						} catch (e) {
							console.error(`Error disposing global plugin ${plugin.id}:`, e)
						}
					}

					if (plugin.onGetRaw) globalRawHooksCount--

					globalPluginRegistry.splice(index, 1)

					// Invalidate caches
					invalidatePluginCaches()

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
				globalRawHooksCount = 0
				globalPluginRegistry.length = 0

				// Invalidate caches
				invalidatePluginCaches()
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
		},
	})

	// Create a proxy wrapper to handle plugin property access
	const originalValtioProxy = valtioProxy
	const proxyHandler: ProxyHandler<typeof valtioProxy> = {
		get(target, prop) {
			// Check if it's a plugin access
			if (typeof prop === "string") {
				const plugin = globalPluginRegistry.find((p) => p.id === prop)
				if (plugin) {
					return plugin
				}
			}

			return Reflect.get(target, prop)
		},

		apply(target, thisArg, argArray) {
			return Reflect.apply(target, thisArg, argArray)
		},
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
	unstable_replaceInternalFunction("newProxy", (originalNewProxy) => {
		return <T extends object>(target: T, handler: ProxyHandler<T>): T => {
			const proxyObj = originalNewProxy(target, handler)

			// Check if this proxy should have global plugins
			if (globalPluginRegistry.length > 0) {
				const globalId = createGlobalId()
				const meta = {
					rootProxy: proxyObj,
					instanceId: globalId,
					path: [],
					isGlobal: true,
					rawHooksCount: globalRawHooksCount,
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

	unstable_replaceInternalFunction("canProxy", (originalCanProxy) => {
		return (value: unknown): boolean => {
			// First check original canProxy
			if (!originalCanProxy(value)) {
				return false
			}

			// Fast path: no plugins
			if (globalPluginRegistry.length === 0 && !currentInstanceContext) {
				return true
			}

			// Get applicable plugins based on current context
			const plugins = getApplicablePluginsUncached(currentInstanceContext ?? undefined)

			// Check each plugin's canProxy
			for (const plugin of plugins) {
				if (plugin.canProxy) {
					try {
						const result = plugin.canProxy(value, originalCanProxy)
						if (result === false) {
							return false
						}
					} catch (e) {
						console.error(`Error in plugin ${plugin.id} canProxy:`, e)
					}
				}
			}

			return true
		}
	})

	unstable_replaceInternalFunction("createHandler", (originalHandler) => {
		return (isInitializing, addPropListener, removePropListener, notifyUpdate) => {
			const handler = originalHandler(
				isInitializing,
				addPropListener,
				removePropListener,
				notifyUpdate,
			)

			/** GET TRAP **/
			const originalGet = handler.get
			handler.get = (target, prop, receiver) => {
				// 1. Skip metadata symbol access to prevent infinite recursion
				if (
					prop === ROOT_PROXY_SYMBOL ||
					prop === INSTANCE_ID_SYMBOL ||
					prop === PROXY_PATH_SYMBOL ||
					prop === GLOBAL_PROXY_SYMBOL ||
					prop === RAW_HOOKS_COUNT_SYMBOL
				) {
					return Reflect.get(target, prop, receiver)
				}

				// 2. FAST PATH: No plugins at all
				if (globalPluginRegistry.length === 0 && instanceRegistry.size === 0) {
					return originalGet
						? originalGet(target, prop, receiver)
						: Reflect.get(target, prop, receiver)
				}

				// 3. Get the initial result (computed once)
				let result = originalGet
					? originalGet(target, prop, receiver)
					: Reflect.get(target, prop, receiver)

				// 4. Metadata Lookup
				const rootProxy = Reflect.get(receiver, ROOT_PROXY_SYMBOL, receiver)
				const instanceId = Reflect.get(receiver, INSTANCE_ID_SYMBOL, receiver) as string | undefined

				// 5. HOISTED VARIABLE: Store plugins here so we share the lookup
				let applicablePlugins: readonly ValtioPlugin[] | undefined

				// 6. Raw Hooks (Optimized with direct symbol access)
				// Get raw hooks count directly from proxy metadata (avoids Map lookup)
				const localRawCount = Reflect.get(receiver, RAW_HOOKS_COUNT_SYMBOL, receiver) as
					| number
					| undefined
				const shouldCheckRawHooks = globalRawHooksCount > 0 || (localRawCount ?? 0) > 0

				if (shouldCheckRawHooks) {
					applicablePlugins = getApplicablePlugins(receiver)

					for (const plugin of applicablePlugins) {
						if (plugin.onGetRaw) {
							plugin.onGetRaw(target, prop, receiver, result)
						}
					}
				}

				// 7. Metadata Propagation (MUST happen before exit)
				if (isObject(result) && result !== receiver && rootProxy) {
					if (!hasRootProxy(result)) {
						const resultTarget = proxyStateMap.get(result)?.[0]

						let parentPath: (string | symbol)[] = []
						if (hasProxyPath(receiver)) {
							parentPath = Reflect.get(receiver, PROXY_PATH_SYMBOL, receiver) as (string | symbol)[]
						}

						const path = [...parentPath, prop]
						const isGlobal = Reflect.get(receiver, GLOBAL_PROXY_SYMBOL, receiver) as
							| boolean
							| undefined

						// Propagate raw hooks count to nested objects
						const meta = {
							rootProxy,
							instanceId,
							path,
							isGlobal,
							rawHooksCount: localRawCount,
						}

						if (result) addMetaData(result, meta)
						if (resultTarget) addMetaData(resultTarget, meta)
					}
				}

				// 8. Slow Path / High-Level Hooks
				if (!isInitializing() && rootProxy && instanceId) {
					if (!applicablePlugins) {
						applicablePlugins = getApplicablePlugins(receiver)
					}

					// Quick check: any high-level hooks?
					let hasHighLevelHooks = false
					for (const p of applicablePlugins) {
						if (p.onGet || p.transformGet) {
							hasHighLevelHooks = true
							break
						}
					}

					if (!hasHighLevelHooks) {
						return result
					}

					let basePath: (string | symbol)[] = []
					if (hasProxyPath(receiver)) {
						basePath = Reflect.get(receiver, PROXY_PATH_SYMBOL, receiver) as (string | symbol)[]
					}
					const fullPath = [...basePath, prop]

					// Call onGet hooks (observation only)
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
								const transformedValue = plugin.transformGet(
									fullPath.map(String),
									result,
									rootProxy,
								)
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

			/** SET TRAP **/
			const originalSet = handler.set
			handler.set = (target, prop, value, receiver) => {
				// Skip metadata symbol handling
				if (
					prop === ROOT_PROXY_SYMBOL ||
					prop === INSTANCE_ID_SYMBOL ||
					prop === PROXY_PATH_SYMBOL ||
					prop === GLOBAL_PROXY_SYMBOL ||
					prop === RAW_HOOKS_COUNT_SYMBOL
				) {
					return Reflect.set(target, prop, value, receiver)
				}

				// Fast path: no plugins
				if (globalPluginRegistry.length === 0 && instanceRegistry.size === 0) {
					return originalSet
						? originalSet(target, prop, value, receiver)
						: Reflect.set(target, prop, value, receiver)
				}

				// Get metadata directly using Reflect
				const rootProxy = Reflect.get(receiver, ROOT_PROXY_SYMBOL, receiver)
				const instanceId = Reflect.get(receiver, INSTANCE_ID_SYMBOL, receiver) as string | undefined
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

				// Transform the value before setting
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

				for (const plugin of applicablePlugins) {
					if (plugin.beforeChange) {
						try {
							const shouldContinue = plugin.beforeChange(
								fullPath.map(String),
								transformedValue,
								prevValue,
								rootProxy,
							)

							if (shouldContinue === false) {
								return true
							}
						} catch (e) {
							console.error(`Error in plugin ${plugin.id} beforeChange:`, e)
						}
					}
				}

				const previousContext = currentInstanceContext

				if (isGlobal) {
					currentInstanceContext = null
				} else {
					currentInstanceContext = instanceId ?? null
				}

				try {
					const result = originalSet
						? originalSet(target, prop, transformedValue, receiver)
						: Reflect.set(target, prop, transformedValue, receiver)

					if (result) {
						for (const plugin of applicablePlugins) {
							if (plugin.afterChange) {
								try {
									plugin.afterChange(fullPath.map(String), transformedValue, rootProxy)
								} catch (e) {
									console.error(`Error in plugin ${plugin.id} afterChange:`, e)
								}
							}
						}
					}
					return result
				} finally {
					currentInstanceContext = previousContext
				}
			}

			/** DELETE TRAP **/
			const originalDeleteProperty = handler.deleteProperty
			handler.deleteProperty = (target, prop) => {
				// Skip metadata symbol handling
				if (
					prop === ROOT_PROXY_SYMBOL ||
					prop === INSTANCE_ID_SYMBOL ||
					prop === PROXY_PATH_SYMBOL ||
					prop === GLOBAL_PROXY_SYMBOL ||
					prop === RAW_HOOKS_COUNT_SYMBOL
				) {
					return Reflect.deleteProperty(target, prop)
				}

				// Fast path: no plugins
				if (globalPluginRegistry.length === 0 && instanceRegistry.size === 0) {
					return originalDeleteProperty
						? originalDeleteProperty(target, prop)
						: Reflect.deleteProperty(target, prop)
				}

				if (isInitializing()) {
					return originalDeleteProperty
						? originalDeleteProperty(target, prop)
						: Reflect.deleteProperty(target, prop)
				}

				const prevValue = Reflect.get(target, prop)

				if (!hasRootProxy(target)) {
					return originalDeleteProperty
						? originalDeleteProperty(target, prop)
						: Reflect.deleteProperty(target, prop)
				}

				const rootProxy = Reflect.get(target, ROOT_PROXY_SYMBOL, target)
				const instanceId = Reflect.get(target, INSTANCE_ID_SYMBOL, target) as string | undefined

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

				for (const plugin of applicablePlugins) {
					if (plugin.beforeChange) {
						try {
							const shouldContinue = plugin.beforeChange(
								fullPath.map(String),
								undefined,
								prevValue,
								rootProxy,
							)
							if (shouldContinue === false) {
								return false
							}
						} catch (e) {
							console.error(
								`Error in plugin: {name: ${plugin.name || "unnamed"}, id: ${plugin.id}}: beforeChange: `,
								e,
							)
						}
					}
				}

				const previousContext = currentInstanceContext
				currentInstanceContext = instanceId

				try {
					const result = originalDeleteProperty
						? originalDeleteProperty(target, prop)
						: Reflect.deleteProperty(target, prop)

					if (result) {
						for (const plugin of applicablePlugins) {
							if (plugin.afterChange) {
								try {
									plugin.afterChange(fullPath.map(String), undefined, rootProxy)
								} catch (e) {
									console.error(`Error in plugin ${plugin.id} afterChange:`, e)
								}
							}
						}
					}
					return result
				} finally {
					currentInstanceContext = previousContext
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

	for (const childId of registry.children) {
		disposeInstanceRecursively(childId)
	}

	if (registry.parentId) {
		const parentRegistry = instanceRegistry.get(registry.parentId)
		if (parentRegistry) {
			parentRegistry.children.delete(instanceId)
		}
	}

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
	registry.children.clear()
	instanceRegistry.delete(instanceId)

	// Invalidate caches
	invalidatePluginCaches()
}

// Track the current instance context during proxy creation
let currentInstanceContext: string | null = null

function createProxyInstance(parentInstanceId?: string): ProxyFactory {
	initializePluginSystem()

	const instanceId = createInstanceId()

	const registry: InstanceRegistry = {
		id: instanceId,
		parentId: parentInstanceId,
		plugins: [],
		isDisposed: false,
		children: new Set(),
		rawHooksCount: 0,
		cachedPluginChain: null,
	}

	instanceRegistry.set(instanceId, registry)

	if (parentInstanceId) {
		const parentRegistry = instanceRegistry.get(parentInstanceId)
		if (parentRegistry) {
			parentRegistry.children.add(instanceId)
		}
	}

	const createProxy = <T extends object>(initialState: T): T => {
		if (registry.isDisposed) {
			throw new Error("This instance has been disposed")
		}

		const previousContext = currentInstanceContext
		currentInstanceContext = instanceId

		try {
			const valtioProxyInstance = valtioProxy(initialState)

			// Calculate total raw hooks count (including inherited)
			const totalRawHooksCount = globalRawHooksCount + getInstanceRawHooksCount(instanceId)

			const meta = {
				rootProxy: valtioProxyInstance,
				instanceId,
				path: [],
				isGlobal: false,
				rawHooksCount: totalRawHooksCount,
			}
			addMetaData(valtioProxyInstance, meta)

			const applicablePlugins = getApplicablePlugins(valtioProxyInstance)
			for (const plugin of applicablePlugins) {
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
			currentInstanceContext = previousContext
		}
	}

	const proxyFn = new Proxy(createProxy, {
		get(target, prop) {
			if (
				prop === "use" ||
				prop === "subscribe" ||
				prop === "snapshot" ||
				prop === "dispose" ||
				prop === "createInstance"
			) {
				return Reflect.get(target, prop)
			}

			if (typeof prop === "string") {
				const applicablePlugins = getApplicablePluginsUncached(instanceId)
				const plugin = applicablePlugins.find((p) => p.id === prop)
				if (plugin) {
					return plugin
				}
			}

			return Reflect.get(target, prop)
		},
	})

	Object.defineProperties(proxyFn, {
		use: {
			value: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => {
				if (registry.isDisposed) {
					throw new Error("This instance has been disposed")
				}

				const pluginsToAdd = Array.isArray(pluginOrPlugins) ? pluginOrPlugins : [pluginOrPlugins]

				for (const plugin of pluginsToAdd) {
					const existingIndex = registry.plugins.findIndex((p) => p.id === plugin.id)
					if (existingIndex >= 0) {
						const oldPlugin = registry.plugins[existingIndex]
						if (oldPlugin.onGetRaw) registry.rawHooksCount--
						registry.plugins[existingIndex] = plugin
					} else {
						registry.plugins.push(plugin)
					}

					if (plugin.onAttach) {
						try {
							plugin.onAttach(proxyFn as ProxyFactory)
						} catch (e) {
							console.error(`Error in plugin ${plugin.id} onAttach:`, e)
						}
					}

					if (plugin.onGetRaw) {
						registry.rawHooksCount++
					}
				}

				// Invalidate caches
				invalidatePluginCaches()

				return proxyFn as ProxyFactory
			},
			enumerable: true,
			configurable: true,
		},

		createInstance: {
			value: (): ProxyFactory => {
				if (registry.isDisposed) {
					throw new Error("This instance has been disposed")
				}

				return createProxyInstance(instanceId)
			},
			enumerable: true,
			configurable: true,
		},

		subscribe: {
			value: <T extends object>(
				proxyObject: T,
				callback: (ops: INTERNAL_Op[]) => void,
				notifyInSync?: boolean,
			): (() => void) => {
				if (registry.isDisposed) {
					throw new Error("This instance has been disposed")
				}

				if (isObject(proxyObject) && hasInstanceId(proxyObject)) {
					const proxyInstanceId = proxyObject[INSTANCE_ID_SYMBOL]

					const isFromThisHierarchy = (checkId: string): boolean => {
						if (checkId === instanceId) return true
						const checkRegistry = instanceRegistry.get(checkId)
						return checkRegistry?.parentId ? isFromThisHierarchy(checkRegistry.parentId) : false
					}

					if (proxyInstanceId && isFromThisHierarchy(proxyInstanceId)) {
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

				return originalSubscribe(proxyObject, callback, notifyInSync)
			},
			enumerable: true,
			configurable: true,
		},

		snapshot: {
			value: <T extends object>(proxyObject: T): Snapshot<T> | Record<string, unknown> => {
				if (registry.isDisposed) {
					throw new Error("This instance has been disposed")
				}

				const snap: Record<string, unknown> = originalSnapshot(proxyObject) as Record<
					string,
					unknown
				>

				if (isObject(proxyObject) && hasInstanceId(proxyObject)) {
					const proxyInstanceId = proxyObject[INSTANCE_ID_SYMBOL]

					const isFromThisHierarchy = (checkId: string): boolean => {
						if (checkId === instanceId) return true
						const checkRegistry = instanceRegistry.get(checkId)
						return checkRegistry?.parentId ? isFromThisHierarchy(checkRegistry.parentId) : false
					}

					if (proxyInstanceId && isFromThisHierarchy(proxyInstanceId)) {
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
				}

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
		},
	})

	return proxyFn as ProxyFactory
}

// Initialize the plugin system when this module is imported
initializePluginSystem()

// Augment the original valtio proxy with plugin methods
const augmentValtioProxy = () => {
	// biome-ignore lint/suspicious/noExplicitAny: flexibility
	const originalProxy = valtioProxy as any

	const originalProxyCall = originalProxy.bind({})

	const globalId = createGlobalId()

	const createGlobalProxy = <T extends object>(initialState: T): T => {
		const previousContext = currentInstanceContext
		currentInstanceContext = null

		try {
			const valtioProxyInstance = originalProxyCall(initialState)

			const meta = {
				rootProxy: valtioProxyInstance,
				instanceId: globalId,
				path: [],
				isGlobal: true,
				rawHooksCount: globalRawHooksCount,
			}
			addMetaData(valtioProxyInstance, meta)

			for (const plugin of globalPluginRegistry) {
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
			currentInstanceContext = previousContext
		}
	}

	Object.defineProperty(originalProxy, "use", {
		value: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => {
			const pluginsToAdd = Array.isArray(pluginOrPlugins) ? pluginOrPlugins : [pluginOrPlugins]

			for (const plugin of pluginsToAdd) {
				const existingIndex = globalPluginRegistry.findIndex((p) => p.id === plugin.id)
				if (existingIndex >= 0) {
					const oldPlugin = globalPluginRegistry[existingIndex]
					if (oldPlugin.onGetRaw) globalRawHooksCount--
					if (plugin.onGetRaw) globalRawHooksCount++
					globalPluginRegistry[existingIndex] = plugin
				} else {
					globalPluginRegistry.push(plugin)
					if (plugin.onGetRaw) globalRawHooksCount++
				}

				if (plugin.onAttach) {
					try {
						plugin.onAttach(originalProxy)
					} catch (e) {
						console.error(`Error in plugin ${plugin.id} onAttach:`, e)
					}
				}
			}

			invalidatePluginCaches()

			return originalProxy
		},
		writable: true,
		configurable: true,
	})

	Object.defineProperty(originalProxy, "subscribe", {
		value: <T extends object>(
			proxyObject: T,
			callback: (ops: INTERNAL_Op[]) => void,
			notifyInSync?: boolean,
		): (() => void) => {
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

			return originalSubscribe(proxyObject, callback, notifyInSync)
		},
		writable: true,
		configurable: true,
	})

	Object.defineProperty(originalProxy, "snapshot", {
		value: <T extends object>(proxyObject: T): Snapshot<T> => {
			const snap = originalSnapshot(proxyObject) as Record<string, unknown>

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
		configurable: true,
	})

	Object.defineProperty(originalProxy, "createInstance", {
		value: () => createProxyInstance(),
		writable: true,
		configurable: true,
	})

	Object.defineProperty(originalProxy, "clearPlugins", {
		value: () => {
			for (const plugin of globalPluginRegistry) {
				if (plugin.onDispose) {
					try {
						plugin.onDispose()
					} catch (e) {
						console.error(`Error disposing global plugin ${plugin.id}:`, e)
					}
				}
			}
			globalRawHooksCount = 0
			globalPluginRegistry.length = 0
			invalidatePluginCaches()
		},
		writable: true,
		configurable: true,
	})

	Object.defineProperty(originalProxy, "getPlugins", {
		value: () => {
			return [...globalPluginRegistry] as readonly ValtioPlugin[]
		},
		writable: true,
		configurable: true,
	})

	Object.defineProperty(originalProxy, "removePlugin", {
		value: (pluginId: string): boolean => {
			const index = globalPluginRegistry.findIndex((p) => p.id === pluginId)
			if (index >= 0) {
				const plugin = globalPluginRegistry[index]
				if (plugin.onDispose) {
					try {
						plugin.onDispose()
					} catch (e) {
						console.error(`Error disposing global plugin ${plugin.id}:`, e)
					}
				}
				if (plugin.onGetRaw) globalRawHooksCount--
				globalPluginRegistry.splice(index, 1)
				invalidatePluginCaches()
				return true
			}
			return false
		},
		writable: true,
		configurable: true,
	})

	const proxyHandler = {
		// biome-ignore lint/suspicious/noExplicitAny: flexibility
		get(target: any, prop: string | symbol) {
			if (typeof prop === "string") {
				const plugin = globalPluginRegistry.find((p) => p.id === prop)
				if (plugin) {
					return plugin
				}
			}

			return Reflect.get(target, prop)
		},
		// biome-ignore lint/suspicious/noExplicitAny: flexibility
		apply(_target: any, _thisArg: any, argArray: any[]) {
			return createGlobalProxy(argArray[0])
		},
	}

	return new Proxy(originalProxy, proxyHandler)
}

const augmentedProxy = augmentValtioProxy()

// biome-ignore lint/suspicious/noExplicitAny: flexibility
let exportedProxy: any = null

const originalUse = augmentedProxy.use
Object.defineProperty(augmentedProxy, "use", {
	// biome-ignore lint/suspicious/noExplicitAny: flexibility
	value: (...args: any[]) => {
		originalUse.apply(augmentedProxy, args)
		return exportedProxy
	},
	writable: true,
	configurable: true,
})

export const proxy: EnhancedGlobalProxy = augmentedProxy as EnhancedGlobalProxy
exportedProxy = proxy

export { proxy as enhancedProxy }
