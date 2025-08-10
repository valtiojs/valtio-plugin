// test/valtio-plugin.test.ts

import { snapshot, subscribe } from "valtio"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// Import the enhanced proxy
import { proxy, type ValtioPlugin } from "../src"

// Define the shape of hook spies for TypeScript
interface HookSpies {
	onInit?: ReturnType<typeof vi.fn>
	onAttach?: ReturnType<typeof vi.fn>
	beforeChange?: ReturnType<typeof vi.fn>
	afterChange?: ReturnType<typeof vi.fn>
	onSubscribe?: ReturnType<typeof vi.fn>
	onSnapshot?: ReturnType<typeof vi.fn>
	onDispose?: ReturnType<typeof vi.fn>
	[key: string]: ReturnType<typeof vi.fn> | undefined
}

// Helper function to get a plugin with proper typing
function getPlugin<T = any>(factory: any, pluginId: string): T {
	return factory[pluginId] as T
}

// Alternative helper for when TypeScript is still confused
function safeGetPlugin(factory: any, pluginId: string): any {
	return (factory as any)[pluginId]
}
function createTestPlugin(id = "test-plugin", hookSpies: HookSpies = {}) {
	// Create spies for all hooks if not provided
	const spies: Required<HookSpies> = {
		onInit: hookSpies.onInit || vi.fn(),
		onAttach: hookSpies.onAttach || vi.fn(),
		beforeChange: hookSpies.beforeChange || vi.fn().mockReturnValue(true),
		afterChange: hookSpies.afterChange || vi.fn(),
		onSubscribe: hookSpies.onSubscribe || vi.fn(),
		onSnapshot: hookSpies.onSnapshot || vi.fn(),
		onDispose: hookSpies.onDispose || vi.fn(),
	}

	const plugin: ValtioPlugin = {
		id,
		name: `Test Plugin (${id})`,

		// Lifecycle hooks
		onInit: spies.onInit,
		onAttach: spies.onAttach,
		beforeChange: spies.beforeChange,
		afterChange: spies.afterChange,
		onSubscribe: spies.onSubscribe,
		onSnapshot: spies.onSnapshot,
		onDispose: spies.onDispose,

		// Plugin API methods directly on plugin object
		getSpy: (name: string) => spies[name],
		testMethod: vi.fn().mockReturnValue("test-result"),
		resetSpies: () => {
			Object.values(spies).forEach((spy) => spy?.mockClear())
		},
	}

	return plugin
}

describe("Valtio Plugin System", () => {
	beforeEach(() => {
		// Reset mocks before each test
		vi.clearAllMocks()
		// Clear all global plugins before each test
		proxy.clearPlugins()
	})

	describe("proxy.createInstance()", () => {
		it("should create a factory function", () => {
			const instance = proxy.createInstance()
			expect(typeof instance).toBe("function")
			expect(typeof instance.use).toBe("function")
			expect(typeof instance.subscribe).toBe("function")
			expect(typeof instance.snapshot).toBe("function")
			expect(typeof instance.dispose).toBe("function")
		})

		it("should create independent instances", () => {
			const instance1 = proxy.createInstance()
			const instance2 = proxy.createInstance()
			const instance3 = proxy.createInstance()
			const instance4 = proxy.createInstance()
			expect(instance1).not.toBe(instance2)

			// Register a plugin with instance1 but not instance2
			const testPlugin = createTestPlugin()
			instance1.use(testPlugin)

			// Create stores
			const store4 = instance4({ count: 0 })
			const store1 = instance1({ count: 0, s: store4 })
			const store2 = instance2({ count: 0 })
			const store3 = instance3({ s: store1 })
			store3.s.count++
			store1.count++

			// Plugin should be initialized for store1 but not store2
			expect((testPlugin as any).getSpy("onInit")).toHaveBeenCalledTimes(1)
			expect((testPlugin as any).getSpy("beforeChange")).toHaveBeenCalledTimes(2)

			// Plugin should be accessible from instance1 but not instance2
			expect((instance1 as any)["test-plugin"]).toBeDefined()
			expect((instance2 as any)["test-plugin"]).toBeUndefined()
		})
	})

	describe("Global proxy.use()", () => {
		it("should register a global plugin", () => {
			const testPlugin = createTestPlugin()

			proxy.use(testPlugin)
			expect((proxy as any)["test-plugin"]).toBeDefined()
			expect((proxy as any)["test-plugin"].testMethod()).toBe("test-result")
		})

		it("should register multiple global plugins", () => {
			const testPlugin1 = createTestPlugin("test-plugin")
			const testPlugin2 = createTestPlugin("another-plugin")

			proxy.use([testPlugin1, testPlugin2])

			expect((proxy as any)["test-plugin"]).toBeDefined()
			expect((proxy as any)["another-plugin"]).toBeDefined()
		})

		it("should apply global plugins to all proxies", () => {
			const testPlugin = createTestPlugin()
			proxy.use(testPlugin)

			// Create proxies after plugin registration
			const store1 = proxy({ count: 0 })
			const store2 = proxy({ value: "test" })

			// Both stores should trigger plugin hooks
			store1.count = 1
			store2.value = "changed"

			expect((testPlugin as any).getSpy("beforeChange")).toHaveBeenCalledTimes(2)
			expect((testPlugin as any).getSpy("afterChange")).toHaveBeenCalledTimes(2)
		})

		it("should support method chaining", () => {
			const testPlugin1 = createTestPlugin("test-plugin")
			const testPlugin2 = createTestPlugin("another-plugin")

			const result = proxy.use(testPlugin1).use(testPlugin2)
			expect(result).toBe(proxy)
		})
	})

	describe("instance.use()", () => {
		it("should register a single plugin", () => {
			const instance = proxy.createInstance()
			const testPlugin = createTestPlugin()

			instance.use(testPlugin)
			expect((instance as any)["test-plugin"]).toBeDefined()
			expect((instance as any)["test-plugin"].testMethod()).toBe("test-result")
		})

		it("should register multiple plugins", () => {
			const instance = proxy.createInstance()
			const testPlugin1 = createTestPlugin("test-plugin")
			const testPlugin2 = createTestPlugin("another-plugin")

			instance.use([testPlugin1, testPlugin2])

			expect((instance as any)["test-plugin"]).toBeDefined()
			expect((instance as any)["another-plugin"]).toBeDefined()
		})

		it("should replace plugins with the same id", () => {
			const instance = proxy.createInstance()

			// For this test, we need to manually create plugins with different implementations
			const testPlugin1: ValtioPlugin = {
				id: "test-plugin",
				name: "Test Plugin",
				testMethod: vi.fn().mockReturnValue("result1"),
			}

			const testPlugin2: ValtioPlugin = {
				id: "test-plugin",
				name: "Test Plugin",
				testMethod: vi.fn().mockReturnValue("result2"),
			}

			instance.use(testPlugin1)
			instance.use(testPlugin2)

			expect((instance as any)["test-plugin"].testMethod()).toBe("result2")
		})

		it("should support method chaining", () => {
			const instance = proxy.createInstance()
			const testPlugin1 = createTestPlugin("test-plugin")
			const testPlugin2 = createTestPlugin("another-plugin")

			const result = instance.use(testPlugin1).use(testPlugin2)
			expect(result).toBe(instance)
		})

		it("should throw if instance is disposed", () => {
			const instance = proxy.createInstance()
			const testPlugin = createTestPlugin()

			instance.dispose()

			expect(() => {
				instance.use(testPlugin)
			}).toThrow("This instance has been disposed")
		})

		it("should call onAttach when plugin is attached", () => {
			const instance = proxy.createInstance()
			const testPlugin = createTestPlugin()

			instance.use(testPlugin)

			expect(testPlugin.onAttach).toHaveBeenCalledTimes(1)
			expect(testPlugin.onAttach).toHaveBeenCalledWith(instance)
		})

		it("should call onAttach for multiple plugins", () => {
			const instance = proxy.createInstance()
			const testPlugin1 = createTestPlugin("plugin1")
			const testPlugin2 = createTestPlugin("plugin2")

			instance.use([testPlugin1, testPlugin2])

			expect(testPlugin1.onAttach).toHaveBeenCalledTimes(1)
			expect(testPlugin1.onAttach).toHaveBeenCalledWith(instance)
			expect(testPlugin2.onAttach).toHaveBeenCalledTimes(1)
			expect(testPlugin2.onAttach).toHaveBeenCalledWith(instance)
		})

		it("should handle errors in onAttach", () => {
			const instance = proxy.createInstance()
			const errorPlugin: ValtioPlugin = {
				id: "error-plugin",
				onAttach: vi.fn().mockImplementation(() => {
					throw new Error("onAttach error")
				}),
			}

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Should not throw
			expect(() => instance.use(errorPlugin)).not.toThrow()

			// Error should be logged
			expect(consoleSpy).toHaveBeenCalledWith(
				"Error in plugin error-plugin onAttach:",
				expect.any(Error),
			)

			// Plugin should still be registered
			expect((instance as any)["error-plugin"]).toBeDefined()

			consoleSpy.mockRestore()
		})

		it("should allow plugin to use factory from onAttach", () => {
			const instance = proxy.createInstance()
			let capturedFactory: any = null

			const plugin: ValtioPlugin = {
				id: "test-plugin",
				onAttach: (factory) => {
					capturedFactory = factory
					// Test that the factory can create proxy instances
					const testState = factory({ value: 42 })
					expect(testState.value).toBe(42)
				},
			}

			instance.use(plugin)

			// Verify the factory was captured
			expect(capturedFactory).toBe(instance)
		})
	})

	describe("plugin lifecycle hooks", () => {
		let instance: any
		let testPlugin: any
		let store: any

		beforeEach(() => {
			instance = proxy.createInstance()
			testPlugin = createTestPlugin()
			instance.use(testPlugin)
			store = instance({ count: 0 })
		})

		it("should call onInit when plugin is registered", () => {
			expect(testPlugin.onInit).toHaveBeenCalledTimes(1)
		})

		it("should call beforeChange before property is changed", () => {
			store.count = 1

			expect(testPlugin.beforeChange).toHaveBeenCalledWith(["count"], 1, 0, expect.any(Object))
		})

		it("should call afterChange after property is changed", () => {
			store.count = 1

			expect(testPlugin.afterChange).toHaveBeenCalledWith(["count"], 1, expect.any(Object))
		})

		it("should prevent property change when beforeChange returns false", () => {
			// Override beforeChange to return false for count > 5
			testPlugin.beforeChange.mockImplementation((path, value) => {
				if (path[0] === "count" && value > 5) {
					return false
				}
				return true
			})

			// This should go through
			store.count = 5
			expect(store.count).toBe(5)

			// This should be prevented
			store.count = 10
			expect(store.count).toBe(5)

			// beforeChange should be called for both attempts
			expect(testPlugin.beforeChange).toHaveBeenCalledTimes(2)

			// afterChange should only be called for the successful change
			expect(testPlugin.afterChange).toHaveBeenCalledTimes(1)
		})

		it("should call onSubscribe when subscribing to a proxy", () => {
			const callback = vi.fn()
			const unsubscribe = instance.subscribe(store, callback)

			expect(testPlugin.onSubscribe).toHaveBeenCalledWith(store, callback)

			// Cleanup
			unsubscribe()
		})

		it("should call onSnapshot when creating a snapshot", () => {
			const snap = instance.snapshot(store)

			expect(testPlugin.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ count: 0 }))
		})
	})

	describe("Global vs Instance plugins", () => {
		it("should apply both global and instance plugins", () => {
			const globalPlugin = createTestPlugin("global-plugin")
			const instancePlugin = createTestPlugin("instance-plugin")

			// Register global plugin
			proxy.use(globalPlugin)

			// Create instance and register instance plugin
			const instance = proxy.createInstance()
			instance.use(instancePlugin)

			const store = instance({ count: 0 })
			store.count = 1

			// Both plugins should be called
		})

		it("should have global plugins run first", () => {
			const callOrder: string[] = []

			const globalPlugin: ValtioPlugin = {
				id: "global-plugin",
				beforeChange: () => {
					callOrder.push("global")
					return true
				},
			}

			const instancePlugin: ValtioPlugin = {
				id: "instance-plugin",
				beforeChange: () => {
					callOrder.push("instance")
					return true
				},
			}

			proxy.use(globalPlugin)
			const instance = proxy.createInstance()
			instance.use(instancePlugin)

			const store = instance({ count: 0 })
			store.count = 1

			expect(callOrder).toEqual(["global", "instance"])
		})
	})

	describe("nested object handling", () => {
		let instance: any
		let testPlugin: any
		let store: any

		beforeEach(() => {
			instance = proxy.createInstance()
			testPlugin = createTestPlugin()
			instance.use(testPlugin)
			store = instance({
				user: {
					profile: {
						name: "John",
						settings: {
							theme: "dark",
						},
					},
				},
			})

			// Reset spies after creating the store
			;(testPlugin as any).resetSpies()
		})

		it("should handle changes to deeply nested properties", () => {
			store.user.profile.settings.theme = "light"

			expect(testPlugin.beforeChange).toHaveBeenCalledWith(
				["user", "profile", "settings", "theme"],
				"light",
				"dark",
				expect.any(Object),
			)

			expect(testPlugin.afterChange).toHaveBeenCalledWith(
				["user", "profile", "settings", "theme"],
				"light",
				expect.any(Object),
			)
		})

		it("should handle adding new properties to nested objects", () => {
			store.user.profile.settings.fontSize = 16

			expect(testPlugin.beforeChange).toHaveBeenCalledWith(
				["user", "profile", "settings", "fontSize"],
				16,
				undefined,
				expect.any(Object),
			)

			expect(testPlugin.afterChange).toHaveBeenCalledWith(
				["user", "profile", "settings", "fontSize"],
				16,
				expect.any(Object),
			)
		})

		it("should handle replacing entire nested objects", () => {
			const newSettings = { theme: "light", fontSize: 16 }
			store.user.profile.settings = newSettings

			expect(testPlugin.beforeChange).toHaveBeenCalledWith(
				["user", "profile", "settings"],
				newSettings,
				expect.objectContaining({ theme: "dark" }),
				expect.any(Object),
			)

			expect(testPlugin.afterChange).toHaveBeenCalledWith(
				["user", "profile", "settings"],
				newSettings,
				expect.any(Object),
			)
		})

		it("should handle deleting properties from nested objects", () => {
			const prevTheme = store.user.profile.settings.theme
			delete store.user.profile.settings.theme

			expect(testPlugin.beforeChange).toHaveBeenCalledWith(
				["user", "profile", "settings", "theme"],
				undefined,
				prevTheme,
				expect.any(Object),
			)

			expect(testPlugin.afterChange).toHaveBeenCalledWith(
				["user", "profile", "settings", "theme"],
				undefined,
				expect.any(Object),
			)
		})
	})

	describe("proxy.subscribe() and instance.subscribe()", () => {
		it("should work with global plugin hooks", async () => {
			const testPlugin = createTestPlugin()
			proxy.use(testPlugin)

			const store = proxy({ count: 0 })
			const callback = vi.fn()

			const unsubscribe = proxy.subscribe(store, callback)

			// Modify the store
			store.count = 1

			// Need to wait for the next tick for subscribers to be notified
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Plugin hooks should be called
			expect(testPlugin.beforeChange).toHaveBeenCalled()
			expect(testPlugin.afterChange).toHaveBeenCalled()

			// Callback should be called
			expect(callback).toHaveBeenCalled()

			// Cleanup
			unsubscribe()
		})

		it("should work with instance plugin hooks", async () => {
			const instance = proxy.createInstance()
			const testPlugin = createTestPlugin()
			instance.use(testPlugin)

			const store = instance({ count: 0 })
			const callback = vi.fn()

			const unsubscribe = instance.subscribe(store, callback)

			// Modify the store
			store.count = 1

			// Need to wait for the next tick for subscribers to be notified
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Plugin hooks should be called
			expect(testPlugin.beforeChange).toHaveBeenCalled()
			expect(testPlugin.afterChange).toHaveBeenCalled()

			// Callback should be called
			expect(callback).toHaveBeenCalled()

			// Cleanup
			unsubscribe()
		})

		it("should handle errors in plugin hooks", () => {
			const instance = proxy.createInstance()

			// Create a plugin with a hook that throws an error
			const errorPlugin = createTestPlugin("error-plugin", {
				onSubscribe: vi.fn().mockImplementation(() => {
					throw new Error("Test error")
				}),
			})

			instance.use(errorPlugin)

			const store = instance({ count: 0 })
			const callback = vi.fn()

			// This should not throw, the error should be caught and logged
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			const unsubscribe = instance.subscribe(store, callback)

			expect(consoleSpy).toHaveBeenCalled()
			expect(unsubscribe).toBeInstanceOf(Function)

			// Cleanup
			unsubscribe()
			consoleSpy.mockRestore()
		})
	})

	describe("proxy.snapshot() and instance.snapshot()", () => {
		it("should work with global plugin hooks", () => {
			// Create a plugin that observes snapshots
			const observerPlugin = createTestPlugin("observer-plugin", {
				onSnapshot: vi.fn(),
			})

			proxy.use(observerPlugin)

			const store = proxy({ count: 0 })
			const snap = proxy.snapshot(store)

			// Plugin hook should be called
			expect(observerPlugin.onSnapshot).toHaveBeenCalled()
			expect(observerPlugin.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ count: 0 }))

			// Snapshot should remain unmodified
			expect(snap).toEqual({
				count: 0,
			})
		})

		it("should work with instance plugin hooks", () => {
			const instance = proxy.createInstance()

			// Create a plugin that observes snapshots
			const observerPlugin = createTestPlugin("observer-plugin", {
				onSnapshot: vi.fn(),
			})

			instance.use(observerPlugin)

			const store = instance({ count: 0 })
			const snap = instance.snapshot(store)

			// Plugin hook should be called
			expect(observerPlugin.onSnapshot).toHaveBeenCalled()
			expect(observerPlugin.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ count: 0 }))

			// Snapshot should remain unmodified
			expect(snap).toEqual({
				count: 0,
			})
		})

		it("should handle errors in plugin hooks", () => {
			const instance = proxy.createInstance()

			// Create a plugin with a hook that throws an error
			const errorPlugin = createTestPlugin("error-plugin", {
				onSnapshot: vi.fn().mockImplementation(() => {
					throw new Error("Test error")
				}),
			})

			instance.use(errorPlugin)

			const store = instance({ count: 0 })

			// This should not throw, the error should be caught and logged
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			const snap = instance.snapshot(store)

			expect(consoleSpy).toHaveBeenCalled()
			expect(snap).toEqual({ count: 0 }) // Should return original snapshot

			// Cleanup
			consoleSpy.mockRestore()
		})
	})

	describe("instance.dispose()", () => {
		it("should clean up resources", () => {
			const instance = proxy.createInstance()
			const testPlugin = createTestPlugin()
			instance.use(testPlugin)

			const store = instance({ count: 0 })

			// Before disposal
			expect((instance as any)["test-plugin"]).toBeDefined()

			instance.dispose()

			// After disposal
			expect((instance as any)["test-plugin"]).toBeUndefined()

			// Methods should throw
			expect(() => instance.use(testPlugin)).toThrow("This instance has been disposed")
			expect(() => instance.subscribe(store, vi.fn())).toThrow("This instance has been disposed")
			expect(() => instance.snapshot(store)).toThrow("This instance has been disposed")

			// Dispose should be idempotent
			expect(() => instance.dispose()).not.toThrow()
		})
	})

	describe("compatibility with standard Valtio", () => {
		it("should work with useSnapshot from valtio/react", () => {
			// Mock React hooks
			const mockUseSnapshot = vi.fn((proxy) => snapshot(proxy))
			vi.mock("valtio/react", () => ({
				useSnapshot: (proxy) => mockUseSnapshot(proxy),
			}))

			const instance = proxy.createInstance()
			const store = instance({ count: 0 })

			// This would be called from a React component
			const snap = mockUseSnapshot(store)

			expect(snap).toEqual({ count: 0 })
			expect(mockUseSnapshot).toHaveBeenCalledWith(store)
		})

		it("should work with original subscribe from valtio", async () => {
			const instance = proxy.createInstance()
			const store = instance({ count: 0 })

			const callback = vi.fn()
			const unsubscribe = subscribe(store, callback)

			// Modify the store
			store.count = 1

			// Need to wait for the next tick for subscribers to be notified
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Callback should be called
			expect(callback).toHaveBeenCalled()

			// Cleanup
			unsubscribe()
		})

		it("should work with original snapshot from valtio", () => {
			const instance = proxy.createInstance()
			const store = instance({ count: 0 })

			const snap = snapshot(store)

			expect(snap).toEqual({ count: 0 })
		})
	})

	describe("error handling", () => {
		it("should catch and log errors in plugin hooks", () => {
			const instance = proxy.createInstance()

			// Create plugins with hooks that throw errors
			const errorPlugin1 = createTestPlugin("error-plugin-1", {
				beforeChange: vi.fn().mockImplementation(() => {
					throw new Error("Error in beforeChange")
				}),
			})

			const errorPlugin2 = createTestPlugin("error-plugin-2", {
				afterChange: vi.fn().mockImplementation(() => {
					throw new Error("Error in afterChange")
				}),
			})

			instance.use([errorPlugin1, errorPlugin2])

			const store = instance({ count: 0 })

			// Mock console.error
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// This should not throw, the errors should be caught and logged
			store.count = 1

			// Both errors should be logged
			expect(consoleSpy).toHaveBeenCalledTimes(2)
			expect(consoleSpy.mock.calls[0][0]).toContain("Error in plugin")
			expect(consoleSpy.mock.calls[1][0]).toContain("Error in plugin")

			// The operation should still complete
			expect(store.count).toBe(1)

			// Cleanup
			consoleSpy.mockRestore()
		})

		it("should continue with remaining plugins if one fails", () => {
			const instance = proxy.createInstance()

			// Create one plugin that throws and one that works
			const errorPlugin = createTestPlugin("error-plugin", {
				beforeChange: vi.fn().mockImplementation(() => {
					throw new Error("Error in beforeChange")
				}),
			})

			const workingPlugin = createTestPlugin("working-plugin")

			instance.use([errorPlugin, workingPlugin])

			const store = instance({ count: 0 })

			// Mock console.error
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// This should not throw
			store.count = 1

			// Error should be logged
			expect(consoleSpy).toHaveBeenCalled()

			// The working plugin's hooks should still be called
			expect(workingPlugin.beforeChange).toHaveBeenCalled()
			expect(workingPlugin.afterChange).toHaveBeenCalled()

			// Cleanup
			consoleSpy.mockRestore()
		})
	})

	describe("Global plugin management", () => {
		it("should manage global plugins", () => {
			const plugin1 = createTestPlugin("plugin1")
			const plugin2 = createTestPlugin("plugin2")

			// Add plugins
			proxy.use([plugin1, plugin2])
			expect(proxy.getPlugins()).toHaveLength(2)

			// Remove plugin
			expect(proxy.removePlugin("plugin1")).toBe(true)
			expect(proxy.getPlugins()).toHaveLength(1)
			expect(proxy.removePlugin("nonexistent")).toBe(false)

			// Clear all plugins
			proxy.clearPlugins()
			expect(proxy.getPlugins()).toHaveLength(0)
		})
	})
})
