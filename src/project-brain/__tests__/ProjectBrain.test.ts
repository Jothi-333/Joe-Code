import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ProjectBrain } from "../ProjectBrain"

describe("ProjectBrain", () => {
	it("initializes and creates a project snapshot", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-brain-"))

		await mkdir(path.join(root, "src"))
		await writeFile(path.join(root, "src", "index.ts"), "export const hello = 'world'\n")
		await writeFile(path.join(root, "README.md"), "# Test Project\n")

		const brain = new ProjectBrain(root)
		const snapshot = await brain.initialize()

		expect(snapshot.rootPath).toBe(root)
		expect(snapshot.files).toBe(2)
		expect(snapshot.sourceFiles).toBe(1)
		expect(snapshot.languages.typescript).toBe(1)
		expect(snapshot.entryPoints).toContain("src/index.ts")
		expect(brain.getFile("src/index.ts")).toBeDefined()
	})

	it("searches files by path", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-brain-"))

		await mkdir(path.join(root, "src"))
		await mkdir(path.join(root, "tests"))

		await writeFile(path.join(root, "src", "UserService.ts"), "export class UserService {}")
		await writeFile(path.join(root, "tests", "UserService.test.ts"), "test('user', () => {})")

		const brain = new ProjectBrain(root)
		await brain.initialize()

		const results = brain.search({
			query: "userservice",
		})

		expect(results.map((file) => file.relativePath)).toEqual(["src/UserService.ts", "tests/UserService.test.ts"])
	})
})
