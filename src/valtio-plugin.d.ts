// valtio-plugin.d.ts - Updated type definitions

export interface ValtioPlugin {
  /**
   * Unique identifier for the plugin
   */
  id: string
  
  /**
   * Optional human-readable name for the plugin
   */
  name?: string
  
  // === Lifecycle Hooks ===
  
  /**
   * Called when the plugin is initialized (when first proxy is created)
   */
  onInit?: () => void
  
  /**
   * Called when the plugin is attached to a proxy factory
   * @param proxy - The proxy factory this plugin was attached to
   */
  onAttach?: (proxy: EnhancedGlobalProxy | ProxyFactory) => void
  
  /**
   * Called when the plugin is being disposed/removed
   */
  onDispose?: () => void
  
  // === Proxy Behavior Hooks ===
  
  /**
   * Determines whether a value should be proxied
   * @param value - The value being considered for proxying
   * @returns true to force proxying, false to prevent proxying, undefined for no opinion
   */
  canProxy?: (value: unknown) => boolean | undefined
  
  // === Property Access Hooks ===
  
  /**
   * Called when a property is accessed (observation only, no return value)
   * @param path - Array of property keys leading to this property
   * @param value - The value being accessed
   * @param state - The root state object
   */
  onGet?: (path: string[], value: unknown, state: object) => void
  
  /**
   * Called when subscribing to a proxy object
   * @param proxyObject - The proxy being subscribed to
   * @param callback - The subscription callback
   */
  onSubscribe?: (proxyObject: object, callback: Function) => void
  
  /**
   * Called when taking a snapshot
   * @param snapshot - The snapshot object (can be modified)
   */
  onSnapshot?: (snapshot: Record<string, unknown>) => void
  
  // === Change Hooks ===
  
  /**
   * Called before a property change occurs
   * @param path - Array of property keys leading to the property being changed
   * @param newValue - The new value being set
   * @param prevValue - The previous value
   * @param state - The root state object
   * @returns false to prevent the change, true or undefined to allow it
   */
  beforeChange?: (path: string[], newValue: unknown, prevValue: unknown, state: object) => boolean | void
  
  /**
   * Called after a property change has occurred
   * @param path - Array of property keys leading to the changed property
   * @param newValue - The new value that was set
   * @param state - The root state object
   */
  afterChange?: (path: string[], newValue: unknown, state: object) => void
  
  // === Transform Hooks ===
  
  /**
   * Transform a value when it's being accessed (read)
   * @param path - Array of property keys leading to this property
   * @param value - The original value
   * @param state - The root state object
   * @returns The transformed value, or undefined to keep original value
   */
  transformGet?: (path: string[], value: unknown, state: object) => unknown
  
  /**
   * Transform a value when it's being set (write)
   * @param path - Array of property keys leading to the property being set
   * @param value - The original value being set
   * @param state - The root state object
   * @returns The transformed value, or undefined to keep original value
   */
  transformSet?: (path: string[], value: unknown, state: object) => unknown
  
  /**
   * Allow plugin authors to add their own methods
   */
  [key: string]: any
}

/**
 * Factory function for creating proxies with attached plugins
 */
export interface ProxyFactory {
  <T extends object>(initialState: T): T
  use(pluginOrPlugins: ValtioPlugin | ValtioPlugin[]): ProxyFactory
  createInstance(): ProxyFactory
  subscribe<T extends object>(
    proxyObject: T,
    callback: (ops: any[]) => void,
    notifyInSync?: boolean
  ): () => void
  snapshot<T extends object>(proxyObject: T): any
  dispose(): void
}

/**
 * Enhanced global proxy with plugin methods
 */
export interface EnhancedGlobalProxy {
  <T extends object>(initialState: T): T
  use(pluginOrPlugins: ValtioPlugin | ValtioPlugin[]): EnhancedGlobalProxy
  createInstance(): ProxyFactory
  subscribe<T extends object>(
    proxyObject: T,
    callback: (ops: any[]) => void,
    notifyInSync?: boolean
  ): () => void
  snapshot<T extends object>(proxyObject: T): any
  removePlugin(pluginId: string): boolean
  getPlugins(): readonly ValtioPlugin[]
  clearPlugins(): void
}