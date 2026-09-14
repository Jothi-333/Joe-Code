import type { ProjectFile } from "./domain/ProjectFile"
import type { ProjectSnapshot } from "./domain/ProjectSnapshot"
import type { StructuralSymbol } from "./domain/StructuralAnalysis"
import type { SymbolRecord } from "./domain/SymbolRecord"
import type { DependencyGraphSnapshot } from "./domain/DependencyGraph"
import type { CallGraphSnapshot } from "./domain/CallGraph"
import type { GitBlameLine, GitCommit, GitDiffSummary, GitFileHistoryEntry, GitRepositoryStatus, GitCommandRunner } from "./domain/GitSnapshot"
import { SymbolIndex, type SymbolQuery } from "./indexing/SymbolIndex"
import { DependencyIndex } from "./indexing/DependencyIndex"
import { CallGraphIndex } from "./indexing/CallGraphIndex"
import { GitIntelligence } from "./indexing/GitIntelligence"
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
	private readonly symbolIndex: SymbolIndex
	private readonly dependencyIndex: DependencyIndex
	private readonly callGraphIndex: CallGraphIndex
	private readonly gitIntelligence?: GitIntelligence
	private snapshot: ProjectSnapshot | undefined

	constructor(rootPath: string, gitRunner?: GitCommandRunner) {
		this.rootPath = rootPath
		this.scanner = new ProjectScanner(rootPath)
		this.symbolIndex = new SymbolIndex()
		this.dependencyIndex = new DependencyIndex()
		this.callGraphIndex = new CallGraphIndex()
		this.gitIntelligence = gitRunner ? new GitIntelligence(rootPath, gitRunner) : undefined
	}

	async initialize(): Promise<ProjectSnapshot> { return this.index() }

	async index(): Promise<ProjectSnapshot> {
		const now = Date.now()
		const files = await this.scanner.scan()
		const languages: Record<string, number> = {}
		const filesByPath: Record<string, ProjectFile> = {}
		for (const file of files) {
			filesByPath[file.relativePath] = file
			if (file.language) languages[file.language] = (languages[file.language] ?? 0) + 1
		}
		await this.symbolIndex.indexFiles(files)
		const analyses = this.symbolIndex.getAnalyses()
		this.dependencyIndex.build(files, analyses)
		this.callGraphIndex.build(files, this.symbolIndex.getAll(), analyses)
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

	getSnapshot(): ProjectSnapshot | undefined { return this.snapshot }
	getFile(relativePath: string): ProjectFile | undefined { return this.snapshot?.filesByPath[relativePath] }
	search(options: ProjectSearchOptions): ProjectFile[] {
		if (!this.snapshot) return []
		const query = options.query.toLowerCase()
		const limit = options.limit ?? 50
		return Object.values(this.snapshot.filesByPath).filter((file) => {
			if (options.language && file.language !== options.language) return false
			if (options.kind && file.kind !== options.kind) return false
			if (options.directory && !file.relativePath.startsWith(options.directory.replace(/\\/g, "/").replace(/\/$/, "") + "/")) return false
			return file.relativePath.toLowerCase().includes(query)
		}).slice(0, limit)
	}

	findSymbols(query: SymbolQuery): SymbolRecord[] { return this.symbolIndex.find(query) }
	getSymbolsInFile(filePath: string): SymbolRecord[] { return this.symbolIndex.getByFile(filePath) }
	getSymbolAnalysis(filePath: string) { return this.symbolIndex.getAnalysis(filePath) }
	getDependencies(filePath: string): string[] { return this.dependencyIndex.getDependencies(filePath) }
	getDependents(filePath: string): string[] { return this.dependencyIndex.getDependents(filePath) }
	getDependencyGraph(): DependencyGraphSnapshot { return this.dependencyIndex.getSnapshot() }
	getCallees(symbolId: string): string[] { return this.callGraphIndex.getCallees(symbolId) }
	getCallers(symbolId: string): string[] { return this.callGraphIndex.getCallers(symbolId) }
	getCallGraph(): CallGraphSnapshot { return this.callGraphIndex.getSnapshot() }

	async getGitStatus(): Promise<GitRepositoryStatus> { return this.requireGit().getStatus() }
	async getRecentCommits(limit = 20): Promise<GitCommit[]> { return this.requireGit().getRecentCommits(limit) }
	async getFileHistory(filePath: string, limit = 20): Promise<GitFileHistoryEntry[]> { return this.requireGit().getFileHistory(filePath, limit) }
	async getBlame(filePath: string): Promise<GitBlameLine[]> { return this.requireGit().getBlame(filePath) }
	async getGitDiff(base?: string, head = "HEAD", filePath?: string): Promise<GitDiffSummary> { return this.requireGit().getDiff(base, head, filePath) }

	getRootPath(): string { return this.rootPath }
	 dispose(): void {
		this.symbolIndex.clear()
		this.dependencyIndex.clear()
		this.callGraphIndex.clear()
		this.snapshot = undefined
	}

	private requireGit(): GitIntelligence {
		if (!this.gitIntelligence) throw new Error("Git intelligence requires a GitCommandRunner")
		return this.gitIntelligence
	}

	private detectEntryPoints(files: ProjectFile[]): string[] {
		const entryPointNames = new Set(["index.ts", "index.tsx", "index.js", "index.jsx", "main.ts", "main.tsx", "main.js", "main.jsx", "app.ts", "app.tsx", "app.js", "app.jsx"])
		return files.filter((file) => entryPointNames.has(file.relativePath.split("/").pop() ?? "")).map((file) => file.relativePath)
	}
}

export type { StructuralSymbol }
