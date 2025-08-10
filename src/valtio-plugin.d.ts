import type { INTERNAL_Op, Snapshot } from 'valtio'
export interface ValtioPlugin {
  id: string
  name?: string
  
  // Lifecycle hooks
  onInit?: () => void
  onAttach?: (proxyFactory: ProxyFactory | EnhancedGlobalProxy) => void
  beforeChange?: (path: string[], value: unknown, prevValue: unknown, state: object) => undefined | boolean
  afterChange?: (path: string[], value: unknown, state: object) => void
  onSubscribe?: (proxy: object, callback: (ops: INTERNAL_Op[]) => void) => void
  onGet?: (path: string[], value: unknown, state: object) => void
  onDispose?: () => void
  
  // Transform hooks
  transformSet?: (path: string[], value: unknown, state: object) => unknown | void
  transformGet?: (path: string[], value: unknown, state: object) => unknown | void
  
  // canProxy hook for controlling what gets proxied
  canProxy?: (value: unknown) => boolean | undefined
  
  // Path-specific handlers
  pathHandlers?: Record<string, (value: unknown, state: object) => void>
  
  // Snapshot observation
  onSnapshot?: (snapshot: Record<string, unknown>) => void

  // Plugin authors should be able to add whatever they want here
  [key: string]: unknown
}

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
  [key: string | symbol]: unknown
}

export interface EnhancedGlobalProxy {
  <T extends object>(initialState?: T): T
  use: (pluginOrPlugins: ValtioPlugin | ValtioPlugin[]) => EnhancedGlobalProxy
  subscribe: <T extends object>(
    proxyObject: T,
    callback: (ops: INTERNAL_Op[]) => void,
    notifyInSync?: boolean
  ) => (() => void)
  snapshot: <T extends object>(proxyObject: T) => Snapshot<T>
  removePlugin: (pluginId: string) => boolean
  getPlugins: () => readonly ValtioPlugin[]
  clearPlugins: () => void
  createInstance: () => ProxyFactory
  [pluginId: string]: unknown // For plugin access
}