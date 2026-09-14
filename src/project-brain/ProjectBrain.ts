import type { ProjectFile } from "./domain/ProjectFile"
import type { ProjectSnapshot } from "./domain/ProjectSnapshot"
import type { StructuralSymbol } from "./domain/StructuralAnalysis"
import type { SymbolRecord } from "./domain/SymbolRecord"
import type { DependencyGraphSnapshot } from "./domain/DependencyGraph"
import type { CallGraphSnapshot } from "./domain/CallGraph"
import type { GitCommit, GitBlameLine, GitDiffSummary, GitFileHistoryEntry, GitRepositoryStatus, GitCommandRunner } from "./domain/GitSnapshot"
import type { BrainQueryOptions, BrainQueryResult } from "./domain/BrainQuery"
import type { SemanticIndex } from "./domain/SemanticIndex"
import type { ArchitectureModel } from "./architecture/ArchitectureModel"
import { ArchitectureAnalyzer } from "./architecture/ArchitectureAnalyzer"
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
	private readonly architectureAnalyzer: ArchitectureAnalyzer
	private readonly gitIntelligence?: GitIntelligence
	private readonly semanticIndex?: SemanticIndex
	private snapshot: ProjectSnapshot | undefined
	private architecture: ArchitectureModel | undefined

	constructor(rootPath: string, gitRunner?: GitCommandRunner, semanticIndex?: SemanticIndex) {
		this.rootPath = rootPath
		this.scanner = new ProjectScanner(rootPath)
		this.symbolIndex = new SymbolIndex()
		this.dependencyIndex = new DependencyIndex()
		this.callGraphIndex = new CallGraphIndex()
		this.architectureAnalyzer = new ArchitectureAnalyzer()
		this.gitIntelligence = gitRunner ? new GitIntelligence(rootPath, gitRunner) : undefined
		this.semanticIndex = semanticIndex
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
		const entryPoints = this.detectEntryPoints(files)
		this.architecture = this.architectureAnalyzer.analyze({
			files,
			symbols: this.symbolIndex.getAll(),
			analyses,
			dependencies: this.dependencyIndex.getSnapshot(),
			callGraph: this.callGraphIndex.getSnapshot(),
			entryPoints,
		})
		const snapshot: ProjectSnapshot = {
			rootPath: this.rootPath,
			createdAt: this.snapshot?.createdAt ?? now,
			updatedAt: now,
			files: files.length,
			sourceFiles: files.filter((file) => file.kind === "source").length,
			languages,
			packages: [],
			entryPoints,
			filesByPath,
		}
		this.snapshot = snapshot
		return snapshot
	}

	async query(options: BrainQueryOptions): Promise<BrainQueryResult> {
		if (!this.snapshot) await this.index()
		const limit = Math.max(1, options.limit ?? 20)
		const filesByPath = this.snapshot?.filesByPath ?? {}
		const files = this.search({ query: options.query, language: options.language, directory: options.directory, limit })
		const symbols = this.findSymbols({ name: options.query, limit: Math.max(limit * 2, 20) })
			.filter((symbol) => this.matchesDirectory(symbol.filePath, options.directory))
			.slice(0, limit)
		const resultFiles = new Map(files.map((file) => [file.relativePath, file]))
		for (const symbol of symbols) {
			const file = filesByPath[symbol.filePath]
			if (file) resultFiles.set(file.relativePath, file)
		}
		const semantic = options.includeSemantic === false || !this.semanticIndex
			? []
			: await this.semanticIndex.search(options.query, {
					...options.semantic,
					limit: options.semantic?.limit ?? limit,
					directory: options.semantic?.directory ?? options.directory,
				})
		const related = new Set<string>()
		for (const file of resultFiles.values()) this.addRelatedFile(related, file.relativePath)
		for (const symbol of symbols) {
			related.add(symbol.filePath)
			for (const dependency of this.getDependencies(symbol.filePath)) related.add(dependency)
			for (const dependent of this.getDependents(symbol.filePath)) related.add(dependent)
			for (const caller of this.getCallers(symbol.id)) {
				const callerSymbol = this.findSymbols({ limit: Number.MAX_SAFE_INTEGER }).find((candidate) => candidate.id === caller)
				if (callerSymbol) related.add(callerSymbol.filePath)
			}
			for (const callee of this.getCallees(symbol.id)) {
				const calleeSymbol = this.findSymbols({ limit: Number.MAX_SAFE_INTEGER }).find((candidate) => candidate.id === callee)
				if (calleeSymbol) related.add(calleeSymbol.filePath)
			}
		}
		for (const result of semantic) related.add(result.filePath)
		return {
			query: options.query,
			files: [...resultFiles.values()].slice(0, limit),
			symbols,
			semantic,
			relatedFiles: [...related].filter((filePath) => this.matchesDirectory(filePath, options.directory)).slice(0, limit * 4),
		}
	}

	getSnapshot(): ProjectSnapshot | undefined { return this.snapshot }
	getArchitecture(): ArchitectureModel | undefined { return this.architecture }
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
		this.architecture = undefined
	}

	private requireGit(): GitIntelligence {
		if (!this.gitIntelligence) throw new Error("Git intelligence requires a GitCommandRunner")
		return this.gitIntelligence
	}

	private matchesDirectory(filePath: string, directory?: string): boolean {
		if (!directory) return true
		const normalized = directory.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
		return filePath === normalized || filePath.startsWith(`${normalized}/`)
	}

	private addRelatedFile(related: Set<string>, filePath: string): void {
		related.add(filePath)
		for (const dependency of this.getDependencies(filePath)) related.add(dependency)
		for (const dependent of this.getDependents(filePath)) related.add(dependent)
	}

	private detectEntryPoints(files: ProjectFile[]): string[] {
		const entryPointNames = new Set(["index.ts", "index.tsx", "index.js", "index.jsx", "main.ts", "main.tsx", "main.js", "main.jsx", "app.ts", "app.tsx", "app.js", "app.jsx"])
		return files.filter((file) => entryPointNames.has(file.relativePath.split("/").pop() ?? "")).map((file) => file.relativePath)
	}
}

export type { StructuralSymbol }
