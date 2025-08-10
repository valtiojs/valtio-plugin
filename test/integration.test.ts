import { useSnapshot } from "valtio/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
// Import the enhanced proxy
import { proxy, type ValtioPlugin } from "../src"

// Mock React for testing
vi.mock("react", () => ({
	useState: vi.fn(),
	useEffect: vi.fn(),
	useLayoutEffect: vi.fn((cb) => cb()),
	useRef: vi.fn(() => ({ current: undefined })),
	useMemo: vi.fn((fn) => fn()),
	useCallback: vi.fn((fn) => fn),
	useSyncExternalStore: vi.fn((subscribe, getSnapshot) => getSnapshot()),
}))

// Mock Valtio React hooks
vi.mock("valtio/react", () => ({
	useSnapshot: vi.fn((proxy) => ({ ...proxy })),
}))

describe("Integration Tests", () => {
	beforeEach(() => {
		// Clear all global plugins before each test
		proxy.clearPlugins()
	})

	describe("Real-world plugin usage", () => {
		it("should work with a persistence plugin", () => {
			// Mock localStorage
			const mockStorage = {
				setItem: vi.fn(),
				getItem: vi.fn(),
				removeItem: vi.fn(),
			}

			// Create a persistence plugin with methods directly on plugin object
			const createPersistPlugin = (options = { name: "default-store" }) => ({
				id: "persist",
				name: "Persistence Plugin",

				// Plugin API methods directly on plugin
				pause: vi.fn(),
				resume: vi.fn(),
				clear: vi.fn(),

				onInit: () => {
					// Would normally load from storage here
					mockStorage.getItem(options.name)
				},

				afterChange: (path, value, state) => {
					// Save to storage
					mockStorage.setItem(options.name, JSON.stringify(state))
				},

				// Auto-format data when saving
				transformSet: (path, value) => {
					// Add metadata to all objects being persisted
					if (
						value &&
						typeof value === "object" &&
						!Array.isArray(value) &&
						!("_persisted" in value)
					) {
						return { ...value, _persisted: true, _savedAt: Date.now() }
					}
					return undefined
				},
			})

			// Use the plugin
			const instance = proxy.createInstance()
			const persistPlugin = createPersistPlugin({ name: "my-store" })
			instance.use(persistPlugin)

			const store = instance({ count: 0 })

			// Initial state should trigger localStorage.getItem
			expect(mockStorage.getItem).toHaveBeenCalledWith("my-store")

			// Modifying the state should trigger localStorage.setItem
			store.count = 1
			expect(mockStorage.setItem).toHaveBeenCalledWith("my-store", expect.any(String))

			// Add an object - should get persistence metadata
			;(store as any).user = { name: "John" }
			expect((store as any).user._persisted).toBe(true)
			expect((store as any).user._savedAt).toBeDefined()

			// We should be able to access the plugin API
			;(instance as any).persist.pause()
			expect((instance as any).persist.pause).toHaveBeenCalled()
		})

		it("should work with a global logging plugin", () => {
			// Mock logger
			const mockLogger = {
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}

			// Create a logging plugin with methods directly on plugin object
			const createLoggerPlugin = (options = { level: "info" }) => ({
				id: "logger",
				name: "Logger Plugin",

				// Plugin API methods directly on plugin
				...mockLogger,
				setLevel: vi.fn(),

				// Transform sensitive data before logging
				transformSet: (path, value) => {
					// Mask sensitive fields in logs
					if (typeof value === "string") {
						const fieldName = path[path.length - 1]?.toString()
						if (["password", "secret", "token"].includes(fieldName || "")) {
							// Log the attempt but mask the value
							mockLogger.info(`Setting sensitive field: ${fieldName}`)
							return value // Keep original value
						}
					}
					return undefined
				},

				beforeChange: (path, value, prevValue, state) => {
					mockLogger.debug(`Will change ${path.join(".")} from ${prevValue} to ${value}`)
					return true
				},

				afterChange: (path, value, state) => {
					mockLogger.info(`Changed ${path.join(".")} to ${value}`)
				},
			})

			// Use the plugin globally
			const loggerPlugin = createLoggerPlugin({ level: "debug" })
			proxy.use(loggerPlugin)

			const store = proxy({ count: 0, password: "" })

			// Log methods should be accessible
			;(proxy as any).logger.debug("Custom debug message")
			expect((proxy as any).logger.debug).toHaveBeenCalledWith("Custom debug message")

			// Changing state should trigger log messages
			store.count = 1
			expect((proxy as any).logger.debug).toHaveBeenCalledWith(
				expect.stringContaining("Will change count"),
			)
			expect((proxy as any).logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Changed count"),
			)

			// Setting sensitive field should be logged specially
			store.password = "secret123"
			expect((proxy as any).logger.info).toHaveBeenCalledWith("Setting sensitive field: password")
		})

		it("should work with a validation plugin", () => {
			const createValidationPlugin = () => ({
				id: "validation",
				name: "Validation Plugin",

				// Plugin API methods directly on plugin
				validate: vi.fn(),
				addSchema: vi.fn(),

				// Transform valid values, leave invalid ones untransformed
				transformSet: (path, value) => {
					const fieldName = path[path.length - 1]?.toString()

					// Email normalization (only if it looks like a valid email)
					if (fieldName === "email" && typeof value === "string" && value.includes("@")) {
						return value.trim().toLowerCase()
					}

					// Age normalization (only if positive)
					if (fieldName === "age" && typeof value === "number" && value >= 0) {
						return Math.floor(value)
					}

					return undefined // No transformation for other cases
				},

				// Validate values after any transformation
				beforeChange: (path, value, prevValue, state) => {
					const fieldName = path[path.length - 1]?.toString()

					// Count validation
					if (fieldName === "count" && typeof value === "number" && value < 0) {
						console.error("Validation failed: count must be >= 0")
						return false
					}

					// Email validation (after any transformation from transformSet)
					if (fieldName === "email" && typeof value === "string" && !value.includes("@")) {
						console.error("Validation failed: invalid email format")
						return false
					}

					// Age validation (after any transformation from transformSet)
					if (fieldName === "age" && typeof value === "number" && value < 0) {
						console.error("Validation failed: age must be >= 0")
						return false
					}

					return true
				},
			})

			// Use the plugin
			const instance = proxy.createInstance()
			const validationPlugin = createValidationPlugin()
			instance.use(validationPlugin)

			const store = instance({ count: 0, email: "", age: 0 })

			// Valid changes should work
			store.count = 5
			expect(store.count).toBe(5)

			store.email = "  USER@EXAMPLE.COM  "
			expect(store.email).toBe("user@example.com") // Transformed

			store.age = 25.7
			expect(store.age).toBe(25) // Rounded down

			// Mock console.error
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Invalid changes should be rejected
			store.count = -1
			expect(store.count).toBe(5) // Still 5, not -1

			store.email = "invalid-email" // No @ symbol, should be rejected
			expect(store.email).toBe("user@example.com") // Unchanged

			store.age = -5 // Negative age, should be rejected
			expect(store.age).toBe(25) // Unchanged

			expect(consoleSpy).toHaveBeenCalledWith("Validation failed: count must be >= 0")
			expect(consoleSpy).toHaveBeenCalledWith("Validation failed: invalid email format")
			expect(consoleSpy).toHaveBeenCalledWith("Validation failed: age must be >= 0")

			// Cleanup
			consoleSpy.mockRestore()
		})
	})

	describe("React integration", () => {
		it("should work with useSnapshot", () => {
			// Create a plugin
			const testPlugin = {
				id: "test-plugin",
				name: "Test Plugin",
				onSnapshot: vi.fn((snapshot) => snapshot),
			}

			const instance = proxy.createInstance()
			instance.use(testPlugin)

			const store = instance({ count: 0 })

			// Mock useSnapshot
			const mockSnap = useSnapshot(store)

			// useSnapshot should work with our proxied store
			expect(useSnapshot).toHaveBeenCalledWith(store)
		})
	})

	describe("Multiple plugins working together", () => {
		it("should handle multiple plugins modifying the same operations", () => {
			// Create plugins that all modify the same operations
			const validationPlugin = {
				id: "validation",
				name: "Validation Plugin",
				beforeChange: vi.fn((path, value) => {
					// Only allow even numbers for count
					if (path[0] === "count" && typeof value === "number") {
						return value % 2 === 0
					}
					return true
				}),
			}

			const loggingPlugin = {
				id: "logging",
				name: "Logging Plugin",
				beforeChange: vi.fn(() => true),
				afterChange: vi.fn(),
			}

			const transformPlugin = {
				id: "transform",
				name: "Transform Plugin",
				transformSet: vi.fn((path, value) => {
					// Square any number values for count
					if (path[0] === "count" && typeof value === "number") {
						return value * value
					}
					return undefined
				}),
			}

			// Register all plugins
			const instance = proxy.createInstance()
			instance.use([transformPlugin, validationPlugin, loggingPlugin])

			const store = instance({ count: 0 })

			// Valid change (even number, will be squared: 2*2=4)
			store.count = 2
			expect(store.count).toBe(4) // Transformed by square
			expect(transformPlugin.transformSet).toHaveBeenCalled()
			expect(validationPlugin.beforeChange).toHaveBeenCalledWith(["count"], 4, 0, store) // Called with transformed value
			expect(loggingPlugin.beforeChange).toHaveBeenCalled()
			expect(loggingPlugin.afterChange).toHaveBeenCalled()

			// Reset mocks
			vi.clearAllMocks()

			// Invalid change (odd number after transformation: 3*3=9)
			store.count = 3
			expect(store.count).toBe(4) // Still 4, not 9
			expect(transformPlugin.transformSet).toHaveBeenCalled()
			expect(validationPlugin.beforeChange).toHaveBeenCalledWith(["count"], 9, 4, store) // Called with transformed value (9)
			expect(loggingPlugin.beforeChange).not.toHaveBeenCalled() // Shouldn't be called if validation fails
			expect(loggingPlugin.afterChange).not.toHaveBeenCalled() // Shouldn't be called if validation fails
		})
	})

	describe("Global vs Instance plugins", () => {
		it("should demonstrate global plugins affecting all stores", () => {
			const globalPlugin = {
				id: "global-logger",
				afterChange: vi.fn(),
			}

			// Register global plugin
			proxy.use(globalPlugin)

			// Create multiple stores - both should be affected
			const store1 = proxy({ count: 0 })
			const store2 = proxy({ value: "test" })

			store1.count = 1
			store2.value = "changed"

			// Global plugin should be called for both stores
			expect(globalPlugin.afterChange).toHaveBeenCalledTimes(2)
		})

		it("should demonstrate instance plugins only affecting instance stores", () => {
			const globalPlugin = {
				id: "global-logger",
				afterChange: vi.fn(),
			}

			const instancePlugin = {
				id: "instance-logger",
				afterChange: vi.fn(),
			}

			// Register global plugin
			proxy.use(globalPlugin)

			// Create instance with its own plugin
			const instance = proxy.createInstance()
			instance.use(instancePlugin)

			// Create stores
			const globalStore = proxy({ count: 0 })
			const instanceStore = instance({ count: 0 })

			globalStore.count = 1
			instanceStore.count = 1

			// Global plugin should be called for both
			expect(globalPlugin.afterChange).toHaveBeenCalledTimes(2)

			// Instance plugin should only be called for instance store
			expect(instancePlugin.afterChange).toHaveBeenCalledTimes(1)
		})
	})

	describe("Real-world transform usage patterns", () => {
		it("should implement a lazy loading system with transformGet", () => {
			const mockApi = {
				fetchUser: vi
					.fn()
					.mockResolvedValue({ id: 1, name: "John Doe", email: "john@example.com" }),
				fetchPosts: vi.fn().mockResolvedValue([
					{ id: 1, title: "First Post" },
					{ id: 2, title: "Second Post" },
				]),
			}

			const lazyLoadPlugin: ValtioPlugin = {
				id: "lazy-load",
				name: "Lazy Load Plugin",

				// Internal cache
				_cache: new Map<string, any>(),
				_loading: new Set<string>(),

				transformGet: function (path, value, state) {
					const pathKey = path.join(".")

					// Only handle properties starting with 'lazy_'
					if (!path[path.length - 1]?.toString().startsWith("lazy_")) {
						return undefined
					}

					// Check cache first
					if (this._cache.has(pathKey)) {
						return this._cache.get(pathKey)
					}

					// If already loading, return loading state
					if (this._loading.has(pathKey)) {
						return { loading: true }
					}

					// Start loading
					this._loading.add(pathKey)

					// Determine what to load based on path
					if (pathKey === "lazy_user") {
						mockApi.fetchUser().then((data) => {
							this._cache.set(pathKey, data)
							this._loading.delete(pathKey)
							// In real app, would trigger re-render here
						})
					} else if (pathKey === "lazy_posts") {
						mockApi.fetchPosts().then((data) => {
							this._cache.set(pathKey, data)
							this._loading.delete(pathKey)
						})
					}

					return { loading: true }
				},
			}

			const instance = proxy.createInstance()
			instance.use(lazyLoadPlugin)

			const store = instance({
				title: "My App",
			})

			// First access should return loading state
			expect((store as any).lazy_user).toEqual({ loading: true })
			expect((store as any).lazy_posts).toEqual({ loading: true })

			// API should have been called
			expect(mockApi.fetchUser).toHaveBeenCalledTimes(1)
			expect(mockApi.fetchPosts).toHaveBeenCalledTimes(1)
		})

		it("should implement computed properties with dependency tracking", () => {
			// Simulated dependency tracking
			const dependencies = new Map<string, Set<string>>()
			const cache = new Map<string, any>()

			const computedPlugin: ValtioPlugin = {
				id: "computed",
				name: "Computed Properties Plugin",

				transformGet: (path, value, state) => {
					const pathStr = path.join(".")

					// Handle computed properties (properties ending with _computed)
					if (pathStr.endsWith("_computed")) {
						// Check cache
						const cacheKey = pathStr

						if (cache.has(cacheKey)) {
							return cache.get(cacheKey)
						}

						// Compute new value based on property name
						let computedValue: any

						if (pathStr === "subtotal_computed") {
							const s = state as any
							computedValue = s.items.reduce(
								(sum: number, item: any) => sum + item.price * item.quantity,
								0,
							)
						} else if (pathStr === "total_computed") {
							const s = state as any
							// First compute subtotal
							const subtotal = s.items.reduce(
								(sum: number, item: any) => sum + item.price * item.quantity,
								0,
							)
							computedValue = subtotal * (1 + s.taxRate)
						}

						cache.set(cacheKey, computedValue)
						return computedValue
					}

					return undefined
				},
			}

			const instance = proxy.createInstance()
			instance.use(computedPlugin)

			const store = instance({
				items: [
					{ name: "Apple", price: 1.0, quantity: 5 },
					{ name: "Banana", price: 0.5, quantity: 10 },
					{ name: "Orange", price: 0.75, quantity: 3 },
				],
				taxRate: 0.08,
			})

			// First access computes values
			expect((store as any).subtotal_computed).toBe(12.25)
			expect((store as any).total_computed).toBeCloseTo(13.23)

			// Subsequent accesses should use cache (in real implementation)
			const subtotal2 = (store as any).subtotal_computed
			expect(subtotal2).toBe(12.25)
		})

		it("should implement a permissions system with transformGet", () => {
			interface User {
				id: string
				role: "admin" | "user" | "guest"
				department?: string
			}

			let currentUser: User = { id: "1", role: "guest" }

			const permissionsPlugin: ValtioPlugin = {
				id: "permissions",
				name: "Permissions Plugin",

				// Method to update current user
				setCurrentUser(user: User) {
					currentUser = user
				},

				transformGet: (path, value, state) => {
					const pathStr = path.join(".")

					// Admin panel - admins only
					if (pathStr.startsWith("adminPanel") && currentUser.role !== "admin") {
						return { error: "Unauthorized", message: "Admin access required" }
					}

					// Sensitive data - hide from guests
					if (pathStr.includes("sensitive") && currentUser.role === "guest") {
						return { hidden: true, message: "Login required" }
					}

					// Department-specific data
					if (pathStr.startsWith("departments.") && currentUser.role === "user") {
						const dept = path[1]
						if (dept !== currentUser.department) {
							return { error: "Access denied", message: "Wrong department" }
						}
					}

					// Mask personal data for non-admins
					if (pathStr.includes("email") && currentUser.role !== "admin") {
						if (typeof value === "string") {
							const [local, domain] = value.split("@")
							return `${local.substring(0, 2)}***@${domain}`
						}
					}

					return undefined
				},
			}

			const instance = proxy.createInstance()
			instance.use(permissionsPlugin)

			const store = instance({
				publicData: "Everyone can see this",
				adminPanel: {
					users: ["user1", "user2"],
					logs: ["log1", "log2"],
				},
				sensitiveInfo: {
					apiKey: "sk-12345",
					database: "prod-db",
				},
				departments: {
					sales: { revenue: 100000 },
					engineering: { budget: 500000 },
				},
				users: [
					{ name: "John", email: "john@example.com" },
					{ name: "Jane", email: "jane@example.com" },
				],
			})

			// As guest
			expect(store.publicData).toBe("Everyone can see this")
			expect(store.adminPanel).toEqual({ error: "Unauthorized", message: "Admin access required" })
			expect(store.sensitiveInfo).toEqual({ hidden: true, message: "Login required" })

			// As user
			;(instance as any).permissions.setCurrentUser({ id: "2", role: "user", department: "sales" })
			expect(store.departments.sales).toEqual({ revenue: 100000 })
			expect(store.departments.engineering).toEqual({
				error: "Access denied",
				message: "Wrong department",
			})
			expect(store.users[0].email).toBe("jo***@example.com")

			// As admin
			;(instance as any).permissions.setCurrentUser({ id: "3", role: "admin" })
			expect(store.adminPanel).toEqual({ users: ["user1", "user2"], logs: ["log1", "log2"] })
			expect(store.users[0].email).toBe("john@example.com") // Full email visible
		})

		it("should implement i18n with transformGet", () => {
			const translations = {
				en: {
					greeting: "Hello",
					farewell: "Goodbye",
					items: {
						apple: "Apple",
						banana: "Banana",
					},
				},
				es: {
					greeting: "Hola",
					farewell: "Adiós",
					items: {
						apple: "Manzana",
						banana: "Plátano",
					},
				},
			}

			let currentLocale = "en"

			const i18nPlugin: ValtioPlugin = {
				id: "i18n",
				name: "Internationalization Plugin",

				setLocale(locale: string) {
					currentLocale = locale
				},

				transformGet: (path, value) => {
					// Only transform strings starting with 't.'
					if (typeof value === "string" && value.startsWith("t.")) {
						const key = value.substring(2)
						const keys = key.split(".")
						let translation: any = translations[currentLocale as keyof typeof translations]

						for (const k of keys) {
							translation = translation?.[k]
						}

						return translation || value // Return original if not found
					}

					return undefined
				},
			}

			const instance = proxy.createInstance()
			instance.use(i18nPlugin)

			const store = instance({
				title: "t.greeting",
				subtitle: "t.farewell",
				menu: {
					fruit1: "t.items.apple",
					fruit2: "t.items.banana",
				},
				untranslated: "Regular text",
			})

			// English (default)
			expect(store.title).toBe("Hello")
			expect(store.subtitle).toBe("Goodbye")
			expect(store.menu.fruit1).toBe("Apple")
			expect(store.menu.fruit2).toBe("Banana")
			expect(store.untranslated).toBe("Regular text")

			// Switch to Spanish
			;(instance as any).i18n.setLocale("es")
			expect(store.title).toBe("Hola")
			expect(store.subtitle).toBe("Adiós")
			expect(store.menu.fruit1).toBe("Manzana")
			expect(store.menu.fruit2).toBe("Plátano")
		})

		it("should implement data normalization with transformSet", () => {
			const normalizationPlugin: ValtioPlugin = {
				id: "normalization",
				name: "Data Normalization Plugin",

				transformSet: (path, value) => {
					// Normalize user objects
					if (typeof value === "object" && value && "name" in value && "email" in value) {
						const normalized = { ...value } as any

						// Normalize name
						if (typeof normalized.name === "string") {
							normalized.name = normalized.name.trim().replace(/\s+/g, " ")
						}

						// Normalize email
						if (typeof normalized.email === "string") {
							normalized.email = normalized.email.toLowerCase().trim()
						}

						// Auto-generate slug from name
						if (normalized.name && !normalized.slug) {
							normalized.slug = normalized.name.toLowerCase().replace(/\s+/g, "-")
						}

						// Add timestamps
						normalized.updatedAt = new Date().toISOString()
						if (!normalized.createdAt) {
							normalized.createdAt = normalized.updatedAt
						}

						return normalized
					}

					// Normalize phone numbers
					if (path[path.length - 1] === "phone" && typeof value === "string") {
						const digits = value.replace(/\D/g, "")
						if (digits.length === 10) {
							return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
						}
						return digits
					}

					return undefined
				},
			}

			const instance = proxy.createInstance()
			instance.use(normalizationPlugin)

			const store = instance({
				users: [] as any[],
				contacts: { phone: "" },
			})

			// Add a user - should be normalized
			store.users.push({
				name: "  John   Doe  ",
				email: "  JOHN.DOE@EXAMPLE.COM  ",
			})

			const user = store.users[0]
			expect(user.name).toBe("John Doe")
			expect(user.email).toBe("john.doe@example.com")
			expect(user.slug).toBe("john-doe")
			expect(user.createdAt).toBeDefined()
			expect(user.updatedAt).toBeDefined()

			// Update phone number
			store.contacts.phone = "123-456-7890"
			expect(store.contacts.phone).toBe("(123) 456-7890")
		})

		it("should combine observational onGet with transformative hooks", () => {
			const accessLog: string[] = []
			const changeLog: string[] = []

			const analyticsPlugin: ValtioPlugin = {
				id: "analytics",
				name: "Analytics Plugin",

				// Observe all property access (no transformation)
				onGet: (path, value) => {
					accessLog.push(`GET: ${path.join(".")} = ${JSON.stringify(value)}`)
				},

				// Transform sensitive data when reading
				transformGet: (path, value) => {
					if (path.includes("password") && typeof value === "string") {
						return "***HIDDEN***"
					}
					return undefined
				},

				// Log and normalize data when setting
				transformSet: (path, value) => {
					changeLog.push(`SET: ${path.join(".")} = ${JSON.stringify(value)}`)

					// Auto-trim strings
					if (typeof value === "string") {
						return value.trim()
					}

					return undefined
				},

				afterChange: (path, value) => {
					changeLog.push(`CHANGED: ${path.join(".")} = ${JSON.stringify(value)}`)
				},
			}

			const instance = proxy.createInstance()
			instance.use(analyticsPlugin)

			const store = instance({
				username: "",
				password: "",
				data: { sensitive: false },
			})

			// Clear initial logs
			accessLog.length = 0
			changeLog.length = 0

			// Set values - should be logged and transformed
			store.username = "  john_doe  "
			store.password = "secret123"

			// Access values - should be logged and potentially transformed
			const username = store.username
			const password = store.password
			const sensitiveData = store.data.sensitive

			// Check transformations
			expect(username).toBe("john_doe") // Trimmed
			expect(password).toBe("***HIDDEN***") // Hidden on read

			// Check logs
			expect(changeLog).toContain('SET: username = "  john_doe  "') // Original value logged
			expect(changeLog).toContain('CHANGED: username = "john_doe"') // Final value logged
			expect(changeLog).toContain('SET: password = "secret123"')

			expect(accessLog).toContain('GET: username = "john_doe"')
			expect(accessLog).toContain('GET: password = "secret123"') // Original value observed
			expect(accessLog).toContain("GET: data.sensitive = false")
		})
	})
})
