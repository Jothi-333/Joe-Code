import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"

import { ProjectBrain } from "../ProjectBrain"

describe("SymbolIndex", () => {
	it("indexes TypeScript symbols and supports structural queries", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-symbols-"))
		await mkdir(path.join(root, "src"))
		await writeFile(
			path.join(root, "src", "UserService.ts"),
			`export class UserService {\n  getUser() {}\n}\nexport function createUser() {}\n`,
		)

		const brain = new ProjectBrain(root)
		await brain.initialize()

		expect(brain.findSymbols({ name: "UserService" })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "UserService",
					kind: "class",
					filePath: "src/UserService.ts",
					exported: true,
				}),
			]),
		)

		expect(brain.findSymbols({ name: "getUser", parentName: "UserService" })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "method", filePath: "src/UserService.ts" }),
			]),
		)

		expect(brain.findSymbols({ kind: "function", exported: true })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "createUser" }),
			]),
		)
	})
})
