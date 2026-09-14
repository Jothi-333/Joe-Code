import { describe, expect, it } from "vitest"
import { TypeScriptAnalyzer } from "../analyzers/TypeScriptAnalyzer"

describe("TypeScriptAnalyzer", () => {
	const analyzer = new TypeScriptAnalyzer()

	it("supports TypeScript and JavaScript", () => {
		expect(analyzer.supports("typescript")).toBe(true)
		expect(analyzer.supports("javascript")).toBe(true)
		expect(analyzer.supports("python")).toBe(false)
	})

	it("extracts classes, methods, functions, interfaces, types and variables", () => {
		const source = `
export interface User { id: string }
export type UserId = string
export class UserService {
  static createUser(id: UserId) { return { id } }
  getUser(id: UserId) { return { id } }
}
export async function loadUser() { return null }
export const version = "1.0.0"
`

		const result = analyzer.analyze("UserService.ts", source, "typescript")

		expect(result.symbols).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: "User", kind: "interface", exported: true }),
			expect.objectContaining({ name: "UserId", kind: "type", exported: true }),
			expect.objectContaining({ name: "UserService", kind: "class", exported: true }),
			expect.objectContaining({ name: "createUser", kind: "method", parentName: "UserService", static: true }),
			expect.objectContaining({ name: "getUser", kind: "method", parentName: "UserService" }),
			expect.objectContaining({ name: "loadUser", kind: "function", exported: true, async: true }),
			expect.objectContaining({ name: "version", kind: "variable", exported: true }),
		]))
	})

	it("extracts imports and re-exports", () => {
		const source = `
import User, { UserId as Id, type UserRole } from "./models"
export { User, Id as UserId } from "./models"
export * from "./types"
`

		const result = analyzer.analyze("index.ts", source, "typescript")

		expect(result.imports).toHaveLength(1)
		expect(result.imports[0]).toMatchObject({
			source: "./models",
			defaultImport: "User",
			namedImports: [
				{ name: "UserId", alias: "Id", isTypeOnly: false },
				{ name: "UserRole", alias: undefined, isTypeOnly: true },
			],
		})

		expect(result.exports).toEqual(expect.arrayContaining([
			expect.objectContaining({ name: "User", localName: "User", source: "./models" }),
			expect.objectContaining({ name: "UserId", localName: "Id", source: "./models" }),
			expect.objectContaining({ name: "*", source: "./types" }),
		]))
	})

	it("extracts call sites with their enclosing function or method", () => {
		const source = `
function save() {}
function create() { save(); console.log("created") }
class Service { save() {} run() { this.save() } }
`

		const result = analyzer.analyze("service.ts", source, "typescript")

		expect(result.calls).toEqual(expect.arrayContaining([
			expect.objectContaining({ callerName: "create", calleeName: "save", kind: "call" }),
			expect.objectContaining({ callerName: "create", calleeName: "log", receiver: "console", kind: "call" }),
			expect.objectContaining({ callerName: "run", callerParentName: "Service", calleeName: "save", receiver: "this", kind: "call" }),
		]))
	})

	it("records source locations", () => {
		const result = analyzer.analyze("sample.ts", "export function hello() {}\n", "typescript")
		const hello = result.symbols.find((symbol) => symbol.name === "hello")

		expect(hello?.location.startLine).toBe(1)
		expect(hello?.location.startColumn).toBe(1)
		expect(hello?.location.endLine).toBe(1)
	})
})
