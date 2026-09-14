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

	it("builds and exposes the architecture model during indexing", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-architecture-"))
		await mkdir(path.join(root, "src", "api"), { recursive: true })
		await mkdir(path.join(root, "src", "ui"), { recursive: true })

		await writeFile(path.join(root, "src", "api", "User.ts"), "export interface User { id: string }\n")
		await writeFile(path.join(root, "src", "api", "UserService.ts"), "import { User } from './User'\nexport class UserService {}\n")
		await writeFile(path.join(root, "src", "ui", "App.ts"), "import { UserService } from '../api/UserService'\nexport class App { service = new UserService() }\n")

		const brain = new ProjectBrain(root)
		await brain.initialize()

		const architecture = brain.getArchitecture()
		expect(architecture).toBeDefined()
		expect(architecture?.entryPoints).toContain("src/ui/App.ts")
		expect(architecture?.modules.map((module) => module.path)).toEqual(["src/api", "src/ui"])
		expect(architecture?.relationships).toEqual([
			{
				from: "src/ui",
				to: "src/api",
				dependencyCount: 1,
				files: ["src/ui/App.ts"],
			},
		])
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
