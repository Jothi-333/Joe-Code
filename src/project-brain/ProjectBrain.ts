import type { ProjectFile } from "./domain/ProjectFile"
import type { ProjectSnapshot } from "./domain/ProjectSnapshot"
import { ProjectScanner } from "./indexing/ProjectScanner"

export interface ProjectSearchOptions {
	query: string
	language?: string
	kind?: ProjectFile["kind"]
	directory?: string
	limit?: number
}

export class ProjectBrain {
	private readonly rootPath: string
	private readonly scanner: ProjectScanner
	private snapshot: ProjectSnapshot | undefined

	constructor(rootPath: string) {
		this.rootPath = rootPath
		this.scanner = new ProjectScanner(rootPath)
	}

	async initialize(): Promise<ProjectSnapshot> {
		return this.index()
	}

	async index(): Promise<ProjectSnapshot> {
		const now = Date.now()
		const files = await this.scanner.scan()

		const languages: Record<string, number> = {}
		const filesByPath: Record<string, ProjectFile> = {}

		for (const file of files) {
			filesByPath[file.relativePath] = file

			if (file.language) {
				languages[file.language] = (languages[file.language] ?? 0) + 1
			}
		}

		const snapshot: ProjectSnapshot = {
			rootPath: this.rootPath,
			createdAt: this.snapshot?.createdAt ?? now,
			updatedAt: now,
			files: files.length,
			sourceFiles: files.filter((file) => file.kind === "source").length,
			languages,
			packages: [],
			entryPoints: this.detectEntryPoints(files),
			filesByPath,
		}

		this.snapshot = snapshot

		return snapshot
	}

	getSnapshot(): ProjectSnapshot | undefined {
		return this.snapshot
	}

	getFile(relativePath: string): ProjectFile | undefined {
		return this.snapshot?.filesByPath[relativePath]
	}

	search(options: ProjectSearchOptions): ProjectFile[] {
		if (!this.snapshot) {
			return []
		}

		const query = options.query.toLowerCase()
		const limit = options.limit ?? 50

		return Object.values(this.snapshot.filesByPath)
			.filter((file) => {
				if (options.language && file.language !== options.language) {
					return false
				}

				if (options.kind && file.kind !== options.kind) {
					return false
				}

				if (
					options.directory &&
					!file.relativePath.startsWith(options.directory.replace(/\\/g, "/").replace(/\/$/, "") + "/")
				) {
					return false
				}

				return file.relativePath.toLowerCase().includes(query)
			})
			.slice(0, limit)
	}

	getRootPath(): string {
		return this.rootPath
	}

	dispose(): void {
		this.snapshot = undefined
	}

	private detectEntryPoints(files: ProjectFile[]): string[] {
		const entryPointNames = new Set([
			"index.ts",
			"index.tsx",
			"index.js",
			"index.jsx",
			"main.ts",
			"main.tsx",
			"main.js",
			"main.jsx",
			"app.ts",
			"app.tsx",
			"app.js",
			"app.jsx",
		])

		return files
			.filter((file) => entryPointNames.has(file.relativePath.split("/").pop() ?? ""))
			.map((file) => file.relativePath)
	}
}
