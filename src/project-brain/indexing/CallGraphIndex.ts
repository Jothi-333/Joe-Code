import path from "path"

import type { ProjectFile } from "../domain/ProjectFile"
import type { StructuralAnalysis, StructuralCall } from "../domain/StructuralAnalysis"
import type { SymbolRecord } from "../domain/SymbolRecord"
import type { CallGraphEdge, CallGraphSnapshot } from "../domain/CallGraph"

export class CallGraphIndex {
	private snapshot: CallGraphSnapshot = { edges: [], incoming: {}, outgoing: {} }

	build(files: ProjectFile[], symbols: SymbolRecord[], analyses: Map<string, StructuralAnalysis>): CallGraphSnapshot {
		const filePaths = new Set(files.map((file) => file.relativePath))
		const byFile = new Map<string, SymbolRecord[]>()
		for (const symbol of symbols) {
			const list = byFile.get(symbol.filePath) ?? []
			list.push(symbol)
			byFile.set(symbol.filePath, list)
		}

		const edges: CallGraphEdge[] = []
		for (const [filePath, analysis] of analyses) {
			const fileSymbols = byFile.get(filePath) ?? []
			for (const call of analysis.calls) {
				const from = this.resolveCaller(fileSymbols, call)
				if (!from) continue
				const to = this.resolveCallee(filePath, call, fileSymbols, analysis.imports, byFile, filePaths)
				edges.push({
					from: from.id,
					to: to?.id,
					calleeName: call.calleeName,
					kind: call.kind,
					filePath,
					location: call.location,
					resolved: to !== undefined,
				})
			}
		}

		const uniqueEdges = this.dedupe(edges)
		const incoming: Record<string, string[]> = {}
		const outgoing: Record<string, string[]> = {}
		for (const edge of uniqueEdges) {
			if (!edge.to) continue
			;(outgoing[edge.from] ??= []).push(edge.to)
			;(incoming[edge.to] ??= []).push(edge.from)
		}
		this.snapshot = { edges: uniqueEdges, incoming, outgoing }
		return this.snapshot
	}

	getSnapshot(): CallGraphSnapshot { return this.snapshot }
	getCallees(symbolId: string): string[] { return this.snapshot.outgoing[symbolId] ?? [] }
	getCallers(symbolId: string): string[] { return this.snapshot.incoming[symbolId] ?? [] }
	clear(): void { this.snapshot = { edges: [], incoming: {}, outgoing: {} } }

	private resolveCaller(symbols: SymbolRecord[], call: StructuralCall): SymbolRecord | undefined {
		if (!call.callerName) return undefined
		return symbols.find((symbol) =>
			symbol.name === call.callerName && symbol.parentName === call.callerParentName &&
			(symbol.kind === "function" || symbol.kind === "method")
		)
	}

	private resolveCallee(
		from: string,
		call: StructuralCall,
		fileSymbols: SymbolRecord[],
		imports: StructuralAnalysis["imports"],
		byFile: Map<string, SymbolRecord[]>,
		filePaths: Set<string>,
	): SymbolRecord | undefined {
		if (call.receiver === "this" && call.callerParentName) {
			return fileSymbols.find((symbol) => symbol.kind === "method" && symbol.name === call.calleeName && symbol.parentName === call.callerParentName)
		}

		if (!call.receiver) {
			const local = fileSymbols.find((symbol) => symbol.name === call.calleeName && (symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class"))
			if (local) return local
		}

		const importBinding = this.findImportBinding(call, imports)
		if (!importBinding) return undefined
		const targetFile = this.resolveModule(from, importBinding.source, filePaths)
		if (!targetFile) return undefined
		const targetSymbols = byFile.get(targetFile) ?? []
		if (importBinding.namespace) {
			return targetSymbols.find((symbol) => symbol.name === call.calleeName && (symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class"))
		}
		return targetSymbols.find((symbol) => symbol.name === importBinding.name && (symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class"))
	}

	private findImportBinding(call: StructuralCall, imports: StructuralAnalysis["imports"]): { source: string; name: string; namespace?: boolean } | undefined {
		for (const item of imports) {
			if (item.namespaceImport === call.receiver) return { source: item.source, name: call.calleeName, namespace: true }
			if (!call.receiver && item.defaultImport === call.calleeName) return { source: item.source, name: "default" }
			if (!call.receiver) {
				const named = item.namedImports.find((entry) => (entry.alias ?? entry.name) === call.calleeName && !entry.isTypeOnly)
				if (named) return { source: item.source, name: named.name }
			}
		}
		return undefined
	}

	private resolveModule(from: string, source: string, filePaths: Set<string>): string | undefined {
		if (!source.startsWith(".")) return undefined
		const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), source))
		const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`]
		return candidates.find((candidate) => filePaths.has(candidate))
	}

	private dedupe(edges: CallGraphEdge[]): CallGraphEdge[] {
		const seen = new Set<string>()
		return edges.filter((edge) => {
			const key = `${edge.from}:${edge.to ?? ""}:${edge.kind}:${edge.location.start}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	}
}
