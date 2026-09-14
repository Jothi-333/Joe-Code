import crypto from "crypto"
import fs from "fs/promises"

import { TypeScriptAnalyzer } from "../analyzers/TypeScriptAnalyzer"
import type { ProjectFile } from "../domain/ProjectFile"
import type { StructuralAnalysis, StructuralSymbol } from "../domain/StructuralAnalysis"
import type { SymbolRecord } from "../domain/SymbolRecord"

export interface SymbolQuery {
	name?: string
	kind?: StructuralSymbol["kind"]
	filePath?: string
	parentName?: string
	exported?: boolean
	limit?: number
}

export class SymbolIndex {
	private readonly analyzer = new TypeScriptAnalyzer()
	private readonly symbolsById = new Map<string, SymbolRecord>()
	private readonly analysesByFile = new Map<string, StructuralAnalysis>()

	async indexFiles(files: ProjectFile[]): Promise<void> {
		this.symbolsById.clear()
		this.analysesByFile.clear()

		for (const file of files) {
			if (!file.language || !this.analyzer.supports(file.language)) {
				continue
			}

			let source: string
			try {
				source = await fs.readFile(file.absolutePath, "utf8")
			} catch {
				continue
			}

			const analysis = this.analyzer.analyze(file.relativePath, source, file.language)
			this.analysesByFile.set(file.relativePath, analysis)

			for (const symbol of analysis.symbols) {
				const id = this.symbolId(file.relativePath, symbol)
				this.symbolsById.set(id, {
					...symbol,
					id,
					filePath: file.relativePath,
				})
			}
		}
	}

	getAll(): SymbolRecord[] {
		return [...this.symbolsById.values()]
	}

	find(query: SymbolQuery): SymbolRecord[] {
		const normalizedName = query.name?.toLowerCase()
		const limit = query.limit ?? 100

		return this.getAll()
			.filter((symbol) => {
				if (normalizedName && !symbol.name.toLowerCase().includes(normalizedName)) return false
				if (query.kind && symbol.kind !== query.kind) return false
				if (query.filePath && symbol.filePath !== query.filePath) return false
				if (query.parentName && symbol.parentName !== query.parentName) return false
				if (query.exported !== undefined && symbol.exported !== query.exported) return false
				return true
			})
			.slice(0, limit)
	}

	getByFile(filePath: string): SymbolRecord[] {
		return this.find({ filePath, limit: Number.MAX_SAFE_INTEGER })
	}

	getAnalysis(filePath: string): StructuralAnalysis | undefined {
		return this.analysesByFile.get(filePath)
	}

	clear(): void {
		this.symbolsById.clear()
		this.analysesByFile.clear()
	}

	private symbolId(filePath: string, symbol: StructuralSymbol): string {
		return crypto
			.createHash("sha1")
			.update(`${filePath}:${symbol.kind}:${symbol.parentName ?? ""}:${symbol.name}:${symbol.location.start}`)
			.digest("hex")
	}
}
