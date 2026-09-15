import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import ignore from "ignore"

import { DIRS_TO_IGNORE } from "../../services/glob/constants"
import type { ProjectFile, ProjectFileKind } from "../domain/ProjectFile"

const MAX_INDEXABLE_FILE_SIZE = 10 * 1024 * 1024

type IgnoreRuleSet = {
	basePath: string
	matcher: ReturnType<typeof ignore>
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".java": "java",
	".go": "go",
	".rs": "rust",
	".cpp": "cpp",
	".cc": "cpp",
	".c": "c",
	".h": "c",
	".hpp": "cpp",
	".cs": "csharp",
	".php": "php",
	".rb": "ruby",
	".swift": "swift",
	".kt": "kotlin",
	".kts": "kotlin",
	".sql": "sql",
	".sh": "shell",
	".bash": "shell",
	".zsh": "shell",
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".xml": "xml",
	".html": "html",
	".css": "css",
	".scss": "scss",
	".md": "markdown",
}

const CONFIG_FILE_NAMES = new Set([
	"package.json",
	"tsconfig.json",
	"jsconfig.json",
	"vite.config.ts",
	"vite.config.js",
	"webpack.config.js",
	"webpack.config.ts",
	"eslint.config.js",
	"eslint.config.mjs",
	".eslintrc",
	".prettierrc",
	"dockerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
])

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst"])

const ASSET_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".svg",
	".webp",
	".ico",
	".pdf",
	".mp3",
	".mp4",
	".mov",
	".avi",
	".zip",
	".tar",
	".gz",
])

export interface ProjectScanOptions {
	maxFileSize?: number
}

export class ProjectScanner {
	private readonly rootPath: string
	private readonly maxFileSize: number
	private rooIgnoreInstance = ignore()

	constructor(rootPath: string, options: ProjectScanOptions = {}) {
		this.rootPath = path.resolve(rootPath)
		this.maxFileSize = options.maxFileSize ?? MAX_INDEXABLE_FILE_SIZE
	}

	async scan(): Promise<ProjectFile[]> {
		await this.loadIgnoreFiles()

		const files: ProjectFile[] = []

		await this.scanDirectory(this.rootPath, files, [])

		return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
	}

	private async loadIgnoreFiles(): Promise<void> {
		this.rooIgnoreInstance = ignore()

		await this.loadRooignoreFile()

		this.rooIgnoreInstance.add(".gitignore")
		this.rooIgnoreInstance.add(".rooignore")
	}

	private async loadRooignoreFile(): Promise<void> {
		const rooignorePath = path.join(this.rootPath, ".rooignore")

		try {
			const content = await fs.readFile(rooignorePath, "utf8")
			this.rooIgnoreInstance.add(content)
		} catch {
			// .rooignore is optional.
		}
	}

	private async loadLocalGitignore(directoryPath: string): Promise<IgnoreRuleSet | undefined> {
		const gitignorePath = path.join(directoryPath, ".gitignore")

		try {
			const content = await fs.readFile(gitignorePath, "utf8")
			const matcher = ignore()

			matcher.add(content)

			return {
				basePath: directoryPath,
				matcher,
			}
		} catch {
			return undefined
		}
	}

	private async scanDirectory(
		directoryPath: string,
		files: ProjectFile[],
		inheritedRules: IgnoreRuleSet[],
	): Promise<void> {
		const localRule = await this.loadLocalGitignore(directoryPath)

		const rules = localRule ? [...inheritedRules, localRule] : inheritedRules

		let entries

		try {
			entries = await fs.readdir(directoryPath, {
				withFileTypes: true,
			})
		} catch {
			return
		}

		for (const entry of entries) {
			const absolutePath = path.join(directoryPath, entry.name)

			const relativePath = path.relative(this.rootPath, absolutePath).replace(/\\/g, "/")

			if (entry.isSymbolicLink()) {
				continue
			}

			if (entry.isDirectory()) {
				if (this.shouldIgnoreDirectory(entry.name, absolutePath, relativePath, rules)) {
					continue
				}

				await this.scanDirectory(absolutePath, files, rules)

				continue
			}

			if (!entry.isFile()) {
				continue
			}

			if (this.shouldIgnoreFile(absolutePath, relativePath, rules)) {
				continue
			}

			const projectFile = await this.createProjectFile(absolutePath, relativePath)

			if (projectFile) {
				files.push(projectFile)
			}
		}
	}

	private shouldIgnoreDirectory(
		name: string,
		absolutePath: string,
		relativePath: string,
		rules: IgnoreRuleSet[],
	): boolean {
		if (DIRS_TO_IGNORE.includes(name)) {
			return true
		}

		return this.isIgnoredByRules(absolutePath, relativePath, true, rules)
	}

	private shouldIgnoreFile(absolutePath: string, relativePath: string, rules: IgnoreRuleSet[]): boolean {
		return this.isIgnoredByRules(absolutePath, relativePath, false, rules)
	}

	private isIgnoredByRules(
		absolutePath: string,
		relativePath: string,
		isDirectory: boolean,
		rules: IgnoreRuleSet[],
	): boolean {
		let ignored = false

		for (const rule of rules) {
			const localPath = path.relative(rule.basePath, absolutePath).replace(/\\/g, "/")

			if (!localPath || localPath.startsWith("../")) {
				continue
			}

			const pathToTest = isDirectory ? `${localPath}/` : localPath

			const result = rule.matcher.test(pathToTest)

			if (result.ignored) {
				ignored = true
			} else if (result.unignored) {
				ignored = false
			}
		}

		if (this.rooIgnoreInstance.ignores(relativePath)) {
			return true
		}

		return ignored
	}

	private async createProjectFile(absolutePath: string, relativePath: string): Promise<ProjectFile | undefined> {
		let stats

		try {
			stats = await fs.stat(absolutePath)
		} catch {
			return undefined
		}

		if (stats.size > this.maxFileSize) {
			return undefined
		}

		const extension = path.extname(relativePath).toLowerCase()
		const language = LANGUAGE_BY_EXTENSION[extension]
		const kind = this.detectKind(relativePath, extension, language)

		let hash: string

		try {
			const content = await fs.readFile(absolutePath)

			hash = crypto.createHash("sha256").update(content).digest("hex")
		} catch {
			return undefined
		}

		return {
			id: crypto.createHash("sha1").update(relativePath).digest("hex"),
			absolutePath,
			relativePath,
			extension,
			language,
			kind,
			size: stats.size,
			hash,
			mtimeMs: stats.mtimeMs,
			indexedAt: Date.now(),
		}
	}

	private detectKind(relativePath: string, extension: string, language?: string): ProjectFileKind {
		const normalizedPath = relativePath.toLowerCase()
		const fileName = path.basename(normalizedPath)

		if (
			fileName.includes(".test.") ||
			fileName.includes(".spec.") ||
			normalizedPath.includes("/__tests__/") ||
			normalizedPath.startsWith("__tests__/")
		) {
			return "test"
		}

		if (CONFIG_FILE_NAMES.has(fileName)) {
			return "config"
		}

		if (DOCUMENTATION_EXTENSIONS.has(extension)) {
			return "documentation"
		}

		if (ASSET_EXTENSIONS.has(extension)) {
			return "asset"
		}

		if (
			normalizedPath.includes("/generated/") ||
			normalizedPath.startsWith("generated/") ||
			fileName.includes(".generated.")
		) {
			return "generated"
		}

		if (language) {
			return "source"
		}

		return "unknown"
	}
}
