import fs from "fs/promises"
import os from "os"
import path from "path"

import { describe, expect, it } from "vitest"

import { ProjectBrain } from "../ProjectBrain"
import type { SemanticIndex } from "../domain/SemanticIndex"

class FakeSemanticIndex implements SemanticIndex {
	async search() {
		return [{
			id: "semantic-1",
			score: 0.91,
			filePath: "src/UserService.ts",
			codeChunk: "export function createUser() {}",
			startLine: 1,
			endLine: 1,
		}]
	}
}

describe("ProjectBrain unified query", () => {
	it("combines file, symbol, and dependency context", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-brain-query-"))
		try {
			await fs.mkdir(path.join(root, "src"), { recursive: true })
			await fs.writeFile(path.join(root, "src", "UserService.ts"), "export function createUser() { return true }\n")
			await fs.writeFile(path.join(root, "src", "UserController.ts"), "import { createUser } from './UserService'\nexport function createUserController() { return createUser() }\n")

			const brain = new ProjectBrain(root)
			const result = await brain.query({ query: "createUser", limit: 10 })

			expect(result.query).toBe("createUser")
			expect(result.files.map((file) => file.relativePath)).toContain("src/UserService.ts")
			expect(result.symbols.map((symbol) => symbol.name)).toContain("createUser")
			expect(result.relatedFiles).toContain("src/UserService.ts")
			expect(result.relatedFiles).toContain("src/UserController.ts")
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	it("adds semantic results when a semantic index is provided", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-brain-semantic-"))
		try {
			await fs.writeFile(path.join(root, "README.md"), "User creation documentation\n")
			const brain = new ProjectBrain(root, undefined, new FakeSemanticIndex())
			const result = await brain.query({ query: "user creation", includeSemantic: true, limit: 5 })

			expect(result.semantic).toHaveLength(1)
			expect(result.semantic[0].filePath).toBe("src/UserService.ts")
			expect(result.relatedFiles).toContain("src/UserService.ts")
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})
