import { beforeEach, describe, expect, it, vi } from "vitest"
import { proxy, type ValtioPlugin } from "../src"

// Helper function to create test plugins (reusing from main test file)
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

function createTestPlugin(id = "test-plugin", hookSpies: HookSpies = {}) {
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

		// Plugin API methods
		getSpy: (name: string) => spies[name],
		testMethod: vi.fn().mockReturnValue(`${id}-result`),
		resetSpies: () => {
			Object.values(spies).forEach((spy) => spy?.mockClear())
		},
	}

	return plugin
}

describe("Nested Instance System", () => {
	beforeEach(() => {
		// Clear all global plugins before each test
		proxy.clearPlugins()
		vi.clearAllMocks()
	})

	describe("Basic nested instance creation", () => {
		it("should create child instances from parent instances", () => {
			const parentInstance = proxy.createInstance()
			const childInstance = parentInstance.createInstance()

			expect(typeof childInstance).toBe("function")
			expect(typeof childInstance.use).toBe("function")
			expect(typeof childInstance.createInstance).toBe("function")
			expect(typeof childInstance.dispose).toBe("function")

			// Child and parent should be different instances
			expect(childInstance).not.toBe(parentInstance)
		})

		it("should create multiple levels of nesting", () => {
			const rootInstance = proxy.createInstance()
			const childInstance = rootInstance.createInstance()
			const grandchildInstance = childInstance.createInstance()

			// All should be different instances
			expect(rootInstance).not.toBe(childInstance)
			expect(childInstance).not.toBe(grandchildInstance)
			expect(rootInstance).not.toBe(grandchildInstance)

			// All should be functional
			const rootStore = rootInstance({ level: "root" })
			const childStore = childInstance({ level: "child" })
			const grandchildStore = grandchildInstance({ level: "grandchild" })

			expect(rootStore.level).toBe("root")
			expect(childStore.level).toBe("child")
			expect(grandchildStore.level).toBe("grandchild")
		})

		it("should throw when trying to create child from disposed parent", () => {
			const parentInstance = proxy.createInstance()
			parentInstance.dispose()

			expect(() => {
				parentInstance.createInstance()
			}).toThrow("This instance has been disposed")
		})
	})

	describe("Plugin inheritance", () => {
		it("should inherit plugins from parent to child", () => {
			const parentPlugin = createTestPlugin("parent-plugin")
			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			const childStore = childInstance({ count: 0 })

			// Child store should trigger parent plugin
			childStore.count = 1

			expect(parentPlugin.beforeChange).toHaveBeenCalledWith(["count"], 1, 0, expect.any(Object))
			expect(parentPlugin.afterChange).toHaveBeenCalledWith(["count"], 1, expect.any(Object))
		})

		it("should inherit plugins from multiple ancestor levels", () => {
			const rootPlugin = createTestPlugin("root-plugin")
			const parentPlugin = createTestPlugin("parent-plugin")
			const childPlugin = createTestPlugin("child-plugin")

			const rootInstance = proxy.createInstance()
			rootInstance.use(rootPlugin)

			const parentInstance = rootInstance.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const childStore = childInstance({ count: 0 })
			childStore.count = 1

			// All three plugins should be triggered
			expect(rootPlugin.beforeChange).toHaveBeenCalled()
			expect(parentPlugin.beforeChange).toHaveBeenCalled()
			expect(childPlugin.beforeChange).toHaveBeenCalled()

			expect(rootPlugin.afterChange).toHaveBeenCalled()
			expect(parentPlugin.afterChange).toHaveBeenCalled()
			expect(childPlugin.afterChange).toHaveBeenCalled()
		})

		it("should include global plugins in inheritance chain", () => {
			const globalPlugin = createTestPlugin("global-plugin")
			const parentPlugin = createTestPlugin("parent-plugin")
			const childPlugin = createTestPlugin("child-plugin")

			// Register global plugin
			proxy.use(globalPlugin)

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const childStore = childInstance({ count: 0 })
			childStore.count = 1

			// All plugins should be triggered: global → parent → child
			expect(globalPlugin.beforeChange).toHaveBeenCalled()
			expect(parentPlugin.beforeChange).toHaveBeenCalled()
			expect(childPlugin.beforeChange).toHaveBeenCalled()
		})
	})

	describe("Plugin execution order", () => {
		it("should execute plugins in correct order: global → parent → child", () => {
			const executionOrder: string[] = []

			const globalPlugin: ValtioPlugin = {
				id: "global-plugin",
				beforeChange: () => {
					executionOrder.push("global")
					return true
				},
			}

			const parentPlugin: ValtioPlugin = {
				id: "parent-plugin",
				beforeChange: () => {
					executionOrder.push("parent")
					return true
				},
			}

			const childPlugin: ValtioPlugin = {
				id: "child-plugin",
				beforeChange: () => {
					executionOrder.push("child")
					return true
				},
			}

			proxy.use(globalPlugin)

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const childStore = childInstance({ count: 0 })
			childStore.count = 1

			expect(executionOrder).toEqual(["global", "parent", "child"])
		})

		it("should stop execution chain if parent plugin prevents change", () => {
			const executionOrder: string[] = []

			const parentPlugin: ValtioPlugin = {
				id: "parent-plugin",
				beforeChange: (path, value) => {
					executionOrder.push("parent")
					return value !== 999 // Prevent setting to 999
				},
			}

			const childPlugin: ValtioPlugin = {
				id: "child-plugin",
				beforeChange: () => {
					executionOrder.push("child")
					return true
				},
			}

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const childStore = childInstance({ count: 0 })

			// This should be prevented by parent plugin
			childStore.count = 999

			expect(executionOrder).toEqual(["parent"]) // Child plugin shouldn't run
			expect(childStore.count).toBe(0) // Value shouldn't change
		})
	})

	describe("Plugin access across hierarchy", () => {
		it("should allow child instance to access parent plugins", () => {
			const parentPlugin = createTestPlugin("parent-plugin")
			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()

			// Child should be able to access parent plugin
			expect((childInstance as any)["parent-plugin"]).toBeDefined()
			expect((childInstance as any)["parent-plugin"].testMethod()).toBe("parent-plugin-result")
		})

		it("should allow access to plugins from multiple ancestor levels", () => {
			const rootPlugin = createTestPlugin("root-plugin")
			const parentPlugin = createTestPlugin("parent-plugin")
			const childPlugin = createTestPlugin("child-plugin")

			const rootInstance = proxy.createInstance()
			rootInstance.use(rootPlugin)

			const parentInstance = rootInstance.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			// Child should access all plugins in hierarchy
			expect((childInstance as any)["root-plugin"]).toBeDefined()
			expect((childInstance as any)["parent-plugin"]).toBeDefined()
			expect((childInstance as any)["child-plugin"]).toBeDefined()

			expect((childInstance as any)["root-plugin"].testMethod()).toBe("root-plugin-result")
			expect((childInstance as any)["parent-plugin"].testMethod()).toBe("parent-plugin-result")
			expect((childInstance as any)["child-plugin"].testMethod()).toBe("child-plugin-result")
		})

		it("should give priority to child plugins over parent plugins with same id", () => {
			const parentPlugin = createTestPlugin("same-id")
			const childPlugin = createTestPlugin("same-id") // Same ID

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			// Child plugin should override parent plugin
			expect((childInstance as any)["same-id"].testMethod()).toBe("same-id-result")

			// But parent instance should still have its own plugin
			expect((parentInstance as any)["same-id"].testMethod()).toBe("same-id-result")
		})
	})

	describe("Cascading disposal", () => {
		it("should dispose all children when parent is disposed", () => {
			const parentPlugin = createTestPlugin("parent-plugin")
			const childPlugin = createTestPlugin("child-plugin")

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const grandchildInstance = childInstance.createInstance()

			// All should be functional before disposal
			expect(() => parentInstance({ test: 1 })).not.toThrow()
			expect(() => childInstance({ test: 1 })).not.toThrow()
			expect(() => grandchildInstance({ test: 1 })).not.toThrow()

			// Dispose parent
			parentInstance.dispose()

			// Parent, child, and grandchild should all be disposed
			expect(() => parentInstance({ test: 1 })).toThrow("This instance has been disposed")
			expect(() => childInstance({ test: 1 })).toThrow("This instance has been disposed")
			expect(() => grandchildInstance({ test: 1 })).toThrow("This instance has been disposed")

			// Plugin onDispose should be called
			expect(parentPlugin.onDispose).toHaveBeenCalled()
			expect(childPlugin.onDispose).toHaveBeenCalled()
		})

		it("should not affect parent when child is disposed", () => {
			const parentInstance = proxy.createInstance()
			const childInstance = parentInstance.createInstance()

			// Both should be functional
			expect(() => parentInstance({ test: 1 })).not.toThrow()
			expect(() => childInstance({ test: 1 })).not.toThrow()

			// Dispose only child
			childInstance.dispose()

			// Parent should still work, child should be disposed
			expect(() => parentInstance({ test: 1 })).not.toThrow()
			expect(() => childInstance({ test: 1 })).toThrow("This instance has been disposed")
		})
	})

	describe("Instance isolation", () => {
		it("should isolate plugins between different instance hierarchies", () => {
			const plugin1 = createTestPlugin("shared-plugin")
			const plugin2 = createTestPlugin("shared-plugin") // Same ID, different plugin

			const hierarchy1Parent = proxy.createInstance()
			hierarchy1Parent.use(plugin1)
			const hierarchy1Child = hierarchy1Parent.createInstance()

			const hierarchy2Parent = proxy.createInstance()
			hierarchy2Parent.use(plugin2)
			const hierarchy2Child = hierarchy2Parent.createInstance()

			const store1 = hierarchy1Child({ count: 0 })
			const store2 = hierarchy2Child({ count: 0 })

			store1.count = 1
			store2.count = 2

			// plugin1 should only be called for hierarchy1
			expect(plugin1.beforeChange).toHaveBeenCalledTimes(1)
			expect(plugin1.beforeChange).toHaveBeenCalledWith(["count"], 1, 0, expect.any(Object))

			// plugin2 should only be called for hierarchy2
			expect(plugin2.beforeChange).toHaveBeenCalledTimes(1)
			expect(plugin2.beforeChange).toHaveBeenCalledWith(["count"], 2, 0, expect.any(Object))
		})

		it("should handle complex nested hierarchies independently", () => {
			// Create two complex hierarchies
			const root1 = proxy.createInstance()
			const branch1a = root1.createInstance()
			const branch1b = root1.createInstance()
			const leaf1a1 = branch1a.createInstance()
			const leaf1a2 = branch1a.createInstance()

			const root2 = proxy.createInstance()
			const branch2a = root2.createInstance()
			const leaf2a1 = branch2a.createInstance()

			// Add plugins to different levels
			root1.use(createTestPlugin("root1-plugin"))
			branch1a.use(createTestPlugin("branch1a-plugin"))
			root2.use(createTestPlugin("root2-plugin"))

			// Create stores
			const store1a1 = leaf1a1({ value: "hierarchy1" })
			const store1a2 = leaf1a2({ value: "hierarchy1" })
			const store2a1 = leaf2a1({ value: "hierarchy2" })

			// All stores should work independently
			store1a1.value = "changed1a1"
			store1a2.value = "changed1a2"
			store2a1.value = "changed2a1"

			// Plugins should be isolated to their hierarchies
			expect((leaf1a1 as any)["root1-plugin"]).toBeDefined()
			expect((leaf1a1 as any)["branch1a-plugin"]).toBeDefined()
			expect((leaf1a1 as any)["root2-plugin"]).toBeUndefined()

			expect((leaf2a1 as any)["root2-plugin"]).toBeDefined()
			expect((leaf2a1 as any)["root1-plugin"]).toBeUndefined()
			expect((leaf2a1 as any)["branch1a-plugin"]).toBeUndefined()
		})
	})

	describe("Subscribe and snapshot with nested instances", () => {
		it("should handle subscription with inherited plugins", async () => {
			const parentPlugin = createTestPlugin("parent-plugin")
			const childPlugin = createTestPlugin("child-plugin")

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const store = childInstance({ count: 0 })
			const callback = vi.fn()

			const unsubscribe = childInstance.subscribe(store, callback)

			store.count = 1

			// Wait for subscription callback
			await new Promise((resolve) => setTimeout(resolve, 0))

			// Both plugins should have onSubscribe called
			expect(parentPlugin.onSubscribe).toHaveBeenCalledWith(store, callback)
			expect(childPlugin.onSubscribe).toHaveBeenCalledWith(store, callback)

			expect(callback).toHaveBeenCalled()

			unsubscribe()
		})

		it("should handle snapshot with inherited plugins", () => {
			const parentPlugin = createTestPlugin("parent-plugin")
			const childPlugin = createTestPlugin("child-plugin")

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const store = childInstance({ count: 42 })
			const snap = childInstance.snapshot(store)

			// Both plugins should have onSnapshot called
			expect(parentPlugin.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ count: 42 }))
			expect(childPlugin.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ count: 42 }))

			expect(snap).toEqual({ count: 42 })
		})
	})

	describe("Real-world nested usage patterns", () => {
		it("should support endpoint hierarchy pattern", () => {
			interface EndpointState {
				id: string
				data: unknown
				loading: boolean
				error: string | null
			}

			// Base endpoint instance with common plugins
			const endpointRoot = proxy.createInstance()

			// Add base endpoint validation
			endpointRoot.use({
				id: "endpoint-validation",
				beforeChange: (path, value) => {
					if (path[0] === "loading" && typeof value !== "boolean") {
						return false // Prevent invalid loading states
					}
					return true
				},
			})

			// Add base endpoint logging
			endpointRoot.use({
				id: "endpoint-logging",
				afterChange: (path, value) => {
					console.log(`Endpoint changed: ${path.join(".")} = ${value}`)
				},
			})

			// Factory for creating specific endpoints
			const createEndpointProxy = <T = unknown>(endpointId: string, initialData: T) => {
				const endpointInstance = endpointRoot.createInstance()

				// Add endpoint-specific plugins
				endpointInstance.use({
					id: `endpoint-${endpointId}`,
					name: `${endpointId} Endpoint Plugin`,
					afterChange: (path, value) => {
						if (path[0] === "error" && value) {
							console.error(`Error in ${endpointId} endpoint:`, value)
						}
					},
				})

				return endpointInstance({
					id: endpointId,
					data: initialData,
					loading: false,
					error: null,
				})
			}

			// Create different endpoints
			const usersEndpoint = createEndpointProxy("users", [])
			const ordersEndpoint = createEndpointProxy("orders", {})

			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Test validation inheritance
			usersEndpoint.loading = true // Should work
			expect(usersEndpoint.loading).toBe(true)

			// Test that both endpoints inherit base validation
			// @ts-ignore - testing runtime validation
			ordersEndpoint.loading = "invalid" // Should be prevented
			expect(ordersEndpoint.loading).toBe(false) // Should stay false

			// Test logging inheritance
			usersEndpoint.data = [{ id: 1, name: "John" }]
			expect(consoleSpy).toHaveBeenCalledWith("Endpoint changed: data = [object Object]")

			// Test endpoint-specific error handling
			ordersEndpoint.error = "Failed to load orders"
			expect(errorSpy).toHaveBeenCalledWith("Error in orders endpoint:", "Failed to load orders")

			consoleSpy.mockRestore()
			errorSpy.mockRestore()
		})

		it("should support feature module hierarchy", () => {
			// App root with global concerns
			const appRoot = proxy.createInstance()

			appRoot.use({
				id: "app-analytics",
				afterChange: (path, value, state) => {
					// Track all state changes for analytics
				},
			})

			// Feature module instances
			const userModule = appRoot.createInstance()
			const orderModule = appRoot.createInstance()

			// User module specific plugins
			userModule.use({
				id: "user-persistence",
				afterChange: (path, value, state) => {
					if (path[0] === "currentUser") {
						localStorage.setItem("currentUser", JSON.stringify(value))
					}
				},
			})

			// Order module specific plugins
			orderModule.use({
				id: "order-sync",
				afterChange: (path, value, state) => {
					if (path[0] === "orders") {
						// Sync orders to server
					}
				},
			})

			// Create stores for each module
			const userStore = userModule({
				currentUser: null,
				preferences: {},
			})

			const orderStore = orderModule({
				orders: [],
				cart: [],
			})

			// Both should inherit app-level analytics
			expect((userModule as any)["app-analytics"]).toBeDefined()
			expect((orderModule as any)["app-analytics"]).toBeDefined()

			// But module-specific plugins should be isolated
			expect((userModule as any)["user-persistence"]).toBeDefined()
			expect((userModule as any)["order-sync"]).toBeUndefined()

			expect((orderModule as any)["order-sync"]).toBeDefined()
			expect((orderModule as any)["user-persistence"]).toBeUndefined()
		})
	})

	describe("Error handling in nested instances", () => {
		it("should handle errors in inherited plugin hooks", () => {
			const errorParentPlugin = createTestPlugin("error-parent", {
				beforeChange: vi.fn().mockImplementation(() => {
					throw new Error("Parent plugin error")
				}),
			})

			const workingChildPlugin = createTestPlugin("working-child")

			const parentInstance = proxy.createInstance()
			parentInstance.use(errorParentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(workingChildPlugin)

			const store = childInstance({ count: 0 })

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// This should not throw, error should be caught
			store.count = 1

			// Error should be logged
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error in plugin"),
				expect.any(Error),
			)

			// Child plugin should still work
			expect(workingChildPlugin.beforeChange).toHaveBeenCalled()
			expect(workingChildPlugin.afterChange).toHaveBeenCalled()

			// Operation should complete
			expect(store.count).toBe(1)

			consoleSpy.mockRestore()
		})

		it("should handle disposal errors gracefully", () => {
			const errorPlugin = createTestPlugin("error-plugin", {
				onDispose: vi.fn().mockImplementation(() => {
					throw new Error("Disposal error")
				}),
			})

			const parentInstance = proxy.createInstance()
			parentInstance.use(errorPlugin)

			const childInstance = parentInstance.createInstance()

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Should not throw despite plugin error
			expect(() => parentInstance.dispose()).not.toThrow()

			// Error should be logged
			expect(consoleSpy).toHaveBeenCalledWith(
				"Error disposing plugin error-plugin:",
				expect.any(Error),
			)

			// Both instances should still be disposed
			expect(() => parentInstance({ test: 1 })).toThrow("This instance has been disposed")
			expect(() => childInstance({ test: 1 })).toThrow("This instance has been disposed")

			consoleSpy.mockRestore()
		})
	})

	describe("transformGet with nested instances", () => {
		it("should inherit transformGet behavior from parent instances", () => {
			const parentPlugin: ValtioPlugin = {
				id: "parent-transform",
				transformGet: (path, value) => {
					if (typeof value === "string") {
						return `[PARENT] ${value}`
					}
					return undefined
				},
			}

			const childPlugin: ValtioPlugin = {
				id: "child-transform",
				transformGet: (path, value) => {
					if (typeof value === "number") {
						return value * 2
					}
					return undefined
				},
			}

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const store = childInstance({
				text: "hello",
				number: 5,
				untransformed: true,
			})

			// Parent plugin should transform strings
			expect(store.text).toBe("[PARENT] hello")

			// Child plugin should transform numbers
			expect(store.number).toBe(10)

			// Untransformed values should remain unchanged
			expect(store.untransformed).toBe(true)
		})

		it("should allow child transformGet to override parent transformGet", () => {
			const parentPlugin: ValtioPlugin = {
				id: "parent-override",
				transformGet: (path, value) => {
					if (path[0] === "shared") {
						return "from parent"
					}
					return undefined
				},
			}

			const childPlugin: ValtioPlugin = {
				id: "child-override",
				transformGet: (path, value) => {
					if (path[0] === "shared") {
						return "from child"
					}
					return undefined
				},
			}

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const parentStore = parentInstance({ shared: "original" })
			const childStore = childInstance({ shared: "original" })

			expect(parentStore.shared).toBe("from parent")
			expect(childStore.shared).toBe("from child") // Child overrides parent
		})

		it("should handle transformGet in complex nested hierarchies", () => {
			const rootPlugin: ValtioPlugin = {
				id: "root",
				transformGet: (path, value) => {
					if (path[0] === "root") return "root value"
					return undefined
				},
			}

			const middlePlugin: ValtioPlugin = {
				id: "middle",
				transformGet: (path, value) => {
					if (path[0] === "middle") return "middle value"
					return undefined
				},
			}

			const leafPlugin: ValtioPlugin = {
				id: "leaf",
				transformGet: (path, value) => {
					if (path[0] === "leaf") return "leaf value"
					return undefined
				},
			}

			const rootInstance = proxy.createInstance()
			rootInstance.use(rootPlugin)

			const middleInstance = rootInstance.createInstance()
			middleInstance.use(middlePlugin)

			const leafInstance = middleInstance.createInstance()
			leafInstance.use(leafPlugin)

			const store = leafInstance({
				root: "ignored",
				middle: "ignored",
				leaf: "ignored",
				normal: "unchanged",
			})

			const root = store.root
			const middle = store.middle
			const leaf = store.leaf
			const normal = store.normal

			expect(root).toBe("root value")
			expect(middle).toBe("middle value")
			expect(leaf).toBe("leaf value")
			expect(normal).toBe("unchanged")
		})

		it("should handle transformGet with global and nested instance plugins", () => {
			const globalPlugin: ValtioPlugin = {
				id: "global-transform",
				transformGet: (path, value) => {
					if (path[0] === "prefix" && typeof value === "string") {
						return `[GLOBAL] ${value}`
					}
					return undefined
				},
			}

			const instancePlugin: ValtioPlugin = {
				id: "instance-transform",
				transformGet: (path, value) => {
					if (path[0] === "prefix" && typeof value === "string") {
						// Transform the already-transformed value from global plugin
						return `${value} [INSTANCE]`
					}
					return undefined
				},
			}

			// Register global plugin
			proxy.use(globalPlugin)

			const instance = proxy.createInstance()
			instance.use(instancePlugin)

			const store = instance({
				prefix: "test",
				normal: "unchanged",
			})

			// Both plugins should transform in order (global first, then instance)
			expect(store.prefix).toBe("[GLOBAL] test [INSTANCE]")
			expect(store.normal).toBe("unchanged")
		})

		it("should handle errors in inherited transformGet plugins", () => {
			const parentPlugin: ValtioPlugin = {
				id: "parent-error",
				transformGet: (path, value) => {
					if (path[0] === "error") {
						throw new Error("Parent transformGet error")
					}
					return undefined
				},
			}

			const childPlugin: ValtioPlugin = {
				id: "child-working",
				transformGet: (path, value) => {
					if (path[0] === "transformed") {
						return "child transformed"
					}
					return undefined
				},
			}

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const store = childInstance({
				error: "original",
				transformed: "original",
				normal: "normal",
			})

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Access error property - should return original value due to error
			const errorValue = store.error
			expect(errorValue).toBe("original")

			// Despite parent error, child plugin should still work
			expect(store.transformed).toBe("child transformed")
			expect(store.normal).toBe("normal")

			// Error should be logged
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error in plugin"),
				expect.any(Error),
			)

			consoleSpy.mockRestore()
		})

		it("should properly dispose transformGet plugins with nested instances", () => {
			const parentPlugin: ValtioPlugin = {
				id: "parent-disposable",
				transformGet: (path, value) => {
					if (path[0] === "parent") return "parent active"
					return undefined
				},
				onDispose: vi.fn(),
			}

			const childPlugin: ValtioPlugin = {
				id: "child-disposable",
				transformGet: (path, value) => {
					if (path[0] === "child") return "child active"
					return undefined
				},
				onDispose: vi.fn(),
			}

			const parentInstance = proxy.createInstance()
			parentInstance.use(parentPlugin)

			const childInstance = parentInstance.createInstance()
			childInstance.use(childPlugin)

			const store = childInstance({
				parent: "original",
				child: "original",
			})

			// Before disposal
			expect(store.parent).toBe("parent active")
			expect(store.child).toBe("child active")

			// Dispose child instance
			childInstance.dispose()

			// Child plugin should be disposed
			expect(childPlugin.onDispose).toHaveBeenCalled()

			// Create new store with parent instance - should still work
			const parentStore = parentInstance({
				parent: "original",
				child: "original",
			})

			expect(parentStore.parent).toBe("parent active") // Parent still works
			expect(parentStore.child).toBe("original") // Child plugin disposed

			// Dispose parent instance
			parentInstance.dispose()

			// Parent plugin should be disposed
			expect(parentPlugin.onDispose).toHaveBeenCalled()
		})
	})
})
