import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ProjectBrain } from "../ProjectBrain"

describe("CallGraphIndex", () => {
	it("resolves local and imported function calls", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-calls-"))
		await mkdir(path.join(root, "src"))
		await writeFile(path.join(root, "src", "helpers.ts"), "export function save() {}\n")
		await writeFile(path.join(root, "src", "service.ts"), "import { save } from './helpers'\nexport function create() { save() }\n")
		await writeFile(path.join(root, "src", "controller.ts"), "import { create } from './service'\nexport function run() { create() }\n")

		const brain = new ProjectBrain(root)
		await brain.initialize()

		const create = brain.findSymbols({ name: "create", filePath: "src/service.ts" })[0]
		const save = brain.findSymbols({ name: "save", filePath: "src/helpers.ts" })[0]
		expect(create).toBeDefined()
		expect(save).toBeDefined()
		expect(brain.getCallees(create!.id)).toContain(save!.id)
	})

	it("resolves this-method calls inside classes", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-calls-"))
		await mkdir(path.join(root, "src"))
		await writeFile(path.join(root, "src", "Service.ts"), "export class Service { save() {} create() { this.save() } }\n")

		const brain = new ProjectBrain(root)
		await brain.initialize()

		const create = brain.findSymbols({ name: "create", filePath: "src/Service.ts" })[0]
		const save = brain.findSymbols({ name: "save", filePath: "src/Service.ts" })[0]
		expect(brain.getCallees(create!.id)).toContain(save!.id)
		expect(brain.getCallers(save!.id)).toContain(create!.id)
	})
})
