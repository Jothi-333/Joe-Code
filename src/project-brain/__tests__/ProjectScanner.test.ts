import crypto from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"

import { ProjectScanner } from "../indexing/ProjectScanner"

describe("ProjectScanner", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "joe-project-brain-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("discovers files and detects their languages and kinds", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "tests"), { recursive: true })

		await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const answer = 42\n")

		await fs.writeFile(path.join(tempDir, "src", "app.test.ts"), "describe('app', () => {})\n")

		await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-project" }))

		await fs.writeFile(path.join(tempDir, "README.md"), "# Test Project\n")

		const scanner = new ProjectScanner(tempDir)
		const files = await scanner.scan()

		const indexFile = files.find((file) => file.relativePath === "src/index.ts")
		const testFile = files.find((file) => file.relativePath === "src/app.test.ts")
		const packageFile = files.find((file) => file.relativePath === "package.json")
		const readmeFile = files.find((file) => file.relativePath === "README.md")

		expect(indexFile?.language).toBe("typescript")
		expect(indexFile?.kind).toBe("source")

		expect(testFile?.language).toBe("typescript")
		expect(testFile?.kind).toBe("test")

		expect(packageFile?.kind).toBe("config")
		expect(readmeFile?.kind).toBe("documentation")
	})

	it("respects .gitignore", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "ignored"), { recursive: true })

		await fs.writeFile(path.join(tempDir, ".gitignore"), "ignored/\n*.log\n")

		await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const value = 1\n")

		await fs.writeFile(path.join(tempDir, "ignored", "secret.ts"), "export const secret = true\n")

		await fs.writeFile(path.join(tempDir, "debug.log"), "debug\n")

		const scanner = new ProjectScanner(tempDir)
		const files = await scanner.scan()

		const paths = files.map((file) => file.relativePath)

		expect(paths).toContain("src/index.ts")
		expect(paths).not.toContain("ignored/secret.ts")
		expect(paths).not.toContain("debug.log")
		expect(paths).not.toContain(".gitignore")
	})

	it("respects .rooignore", async () => {
		await fs.mkdir(path.join(tempDir, "secrets"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })

		await fs.writeFile(path.join(tempDir, ".rooignore"), "secrets/\nprivate.json\n")

		await fs.writeFile(path.join(tempDir, "secrets", "api-key.txt"), "secret\n")

		await fs.writeFile(path.join(tempDir, "private.json"), JSON.stringify({ token: "secret" }))

		await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const safe = true\n")

		const scanner = new ProjectScanner(tempDir)
		const files = await scanner.scan()

		const paths = files.map((file) => file.relativePath)

		expect(paths).toContain("src/index.ts")
		expect(paths).not.toContain("secrets/api-key.txt")
		expect(paths).not.toContain("private.json")
		expect(paths).not.toContain(".rooignore")
	})

	it("ignores built-in large dependency directories", async () => {
		await fs.mkdir(path.join(tempDir, "node_modules", "example"), {
			recursive: true,
		})
		await fs.mkdir(path.join(tempDir, "dist"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })

		await fs.writeFile(path.join(tempDir, "node_modules", "example", "index.js"), "module.exports = {}\n")

		await fs.writeFile(path.join(tempDir, "dist", "bundle.js"), "console.log('generated')\n")

		await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const value = 1\n")

		const scanner = new ProjectScanner(tempDir)
		const files = await scanner.scan()

		const paths = files.map((file) => file.relativePath)

		expect(paths).toContain("src/index.ts")
		expect(paths).not.toContain("node_modules/example/index.js")
		expect(paths).not.toContain("dist/bundle.js")
	})

	it("produces stable ids and content hashes", async () => {
		const relativePath = "src/index.ts"
		const content = "export const value = 42\n"

		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.writeFile(path.join(tempDir, relativePath), content)

		const scanner = new ProjectScanner(tempDir)
		const files = await scanner.scan()
		const file = files[0]

		const expectedId = crypto.createHash("sha1").update(relativePath).digest("hex")

		const expectedHash = crypto.createHash("sha256").update(content).digest("hex")

		expect(file.id).toBe(expectedId)
		expect(file.hash).toBe(expectedHash)
		expect(file.size).toBe(Buffer.byteLength(content))
		expect(file.mtimeMs).toBeGreaterThan(0)
		expect(file.indexedAt).toBeGreaterThan(0)
	})

	it("does not scan symbolic links", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "outside"), { recursive: true })

		await fs.writeFile(path.join(tempDir, "outside", "secret.ts"), "export const secret = true\n")

		await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export const safe = true\n")

		try {
			await fs.symlink(path.join(tempDir, "outside"), path.join(tempDir, "linked-outside"), "junction")
		} catch {
			// Symlink creation may be unavailable on some Windows configurations.
			return
		}

		const scanner = new ProjectScanner(tempDir)
		const files = await scanner.scan()

		const paths = files.map((file) => file.relativePath)

		expect(paths).toContain("src/index.ts")
		expect(paths).not.toContain("linked-outside/secret.ts")
	})
})

it("respects nested .gitignore files", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "joe-code-nested-ignore-"))

	await fs.mkdir(path.join(root, "src"), { recursive: true })
	await fs.mkdir(path.join(root, "src", "generated"), { recursive: true })

	await fs.writeFile(path.join(root, "src", ".gitignore"), "generated/\n")

	await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1\n")

	await fs.writeFile(path.join(root, "src", "generated", "generated.ts"), "export const generated = true\n")

	const scanner = new ProjectScanner(root)
	const files = await scanner.scan()

	const paths = files.map((file) => file.relativePath)

	expect(paths).toContain("src/index.ts")
	expect(paths).not.toContain("src/generated/generated.ts")
})
