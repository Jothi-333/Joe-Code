import type { ProjectFile } from "../domain/ProjectFile"
import type { StructuralAnalysis } from "../domain/StructuralAnalysis"
import type { SymbolRecord } from "../domain/SymbolRecord"
import type { DependencyGraphSnapshot } from "../domain/DependencyGraph"
import type { CallGraphSnapshot } from "../domain/CallGraph"
import type {
	ArchitectureHotspot,
	ArchitectureModel,
	ArchitectureModule,
	ArchitectureRelationship,
} from "./ArchitectureModel"

export interface ArchitectureAnalyzerInput {
	files: ProjectFile[]
	symbols: SymbolRecord[]
	analyses: Map<string, StructuralAnalysis>
	dependencies: DependencyGraphSnapshot
	callGraph: CallGraphSnapshot
	entryPoints: string[]
}

export class ArchitectureAnalyzer {
	analyze(input: ArchitectureAnalyzerInput): ArchitectureModel {
		const modulePaths = this.discoverModulePaths(input.files)
		const modules = modulePaths.map((modulePath) => this.createModule(modulePath, input.files, input.symbols))
		const relationships = this.buildRelationships(modules, input.dependencies)

		return {
			generatedAt: Date.now(),
			modules,
			relationships,
			entryPoints: [...input.entryPoints],
			hotspots: this.buildHotspots(modules),
		}
	}

	private discoverModulePaths(files: ProjectFile[]): string[] {
		const paths = new Set<string>()
		for (const file of files) {
			paths.add(this.modulePath(file.relativePath))
		}
		return [...paths].sort((a, b) => {
			const depthA = a === "." ? 0 : a.split("/").length
			const depthB = b === "." ? 0 : b.split("/").length
			return depthA - depthB || a.localeCompare(b)
		})
	}

	private createModule(modulePath: string, files: ProjectFile[], symbols: SymbolRecord[]): ArchitectureModule {
		const moduleFiles = files.filter((file) => this.modulePath(file.relativePath) === modulePath)
		const moduleSymbols = symbols.filter((symbol) => this.modulePath(symbol.filePath) === modulePath)
		const languages = [...new Set(moduleFiles.map((file) => file.language).filter((language): language is string => Boolean(language)))].sort()
		return {
			id: modulePath,
			path: modulePath,
			files: moduleFiles.map((file) => file.relativePath).sort(),
			languages,
			metrics: {
				fileCount: moduleFiles.length,
				sourceFileCount: moduleFiles.filter((file) => file.kind === "source").length,
				testFileCount: moduleFiles.filter((file) => file.kind === "test").length,
				symbolCount: moduleSymbols.length,
				exportedSymbolCount: moduleSymbols.filter((symbol) => symbol.exported).length,
				incomingDependencyCount: 0,
				outgoingDependencyCount: 0,
				dependencyFanIn: 0,
				dependencyFanOut: 0,
				totalSize: moduleFiles.reduce((total, file) => total + file.size, 0),
			},
		}
	}

	private modulePath(filePath: string): string {
		const parts = filePath.split("/")
		return parts.length > 1 ? parts.slice(0, -1).join("/") : "."
	}

	private buildRelationships(modules: ArchitectureModule[], dependencies: DependencyGraphSnapshot): ArchitectureRelationship[] {
		const moduleByFile = new Map<string, string>()
		for (const module of modules) {
			for (const file of module.files) {
				moduleByFile.set(file, module.id)
			}
		}

		const relationshipMap = new Map<string, { from: string; to: string; dependencyCount: number; files: Set<string> }>()
		const incomingByModule = new Map<string, Set<string>>()
		const outgoingByModule = new Map<string, Set<string>>()
		const outgoingCountByModule = new Map<string, number>()
		const incomingCountByModule = new Map<string, number>()

		for (const edge of dependencies.edges) {
			if (!edge.resolved) continue
			const fromModule = moduleByFile.get(edge.from)
			const toModule = moduleByFile.get(edge.to)
			if (!fromModule || !toModule || fromModule === toModule) continue

			const key = `${fromModule}\0${toModule}`
			const relationship = relationshipMap.get(key) ?? {
				from: fromModule,
				to: toModule,
				dependencyCount: 0,
				files: new Set<string>(),
			}
			relationship.dependencyCount += 1
			relationship.files.add(edge.from)
			relationshipMap.set(key, relationship)

			const outgoingModules = outgoingByModule.get(fromModule) ?? new Set<string>()
			outgoingModules.add(toModule)
			outgoingByModule.set(fromModule, outgoingModules)
			const incomingModules = incomingByModule.get(toModule) ?? new Set<string>()
			incomingModules.add(fromModule)
			incomingByModule.set(toModule, incomingModules)
			outgoingCountByModule.set(fromModule, (outgoingCountByModule.get(fromModule) ?? 0) + 1)
			incomingCountByModule.set(toModule, (incomingCountByModule.get(toModule) ?? 0) + 1)
		}

		for (const module of modules) {
			module.metrics.outgoingDependencyCount = outgoingCountByModule.get(module.id) ?? 0
			module.metrics.incomingDependencyCount = incomingCountByModule.get(module.id) ?? 0
			module.metrics.dependencyFanOut = outgoingByModule.get(module.id)?.size ?? 0
			module.metrics.dependencyFanIn = incomingByModule.get(module.id)?.size ?? 0
		}

		return [...relationshipMap.values()]
			.map((relationship) => ({
				from: relationship.from,
				to: relationship.to,
				dependencyCount: relationship.dependencyCount,
				files: [...relationship.files].sort(),
			}))
			.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
	}

	private buildHotspots(modules: ArchitectureModule[]): ArchitectureHotspot[] {
		const hotspots: ArchitectureHotspot[] = []
		for (const module of modules) {
			const { metrics } = module
			if (metrics.incomingDependencyCount > 0) {
				hotspots.push({ moduleId: module.id, kind: "incoming-dependencies", score: metrics.incomingDependencyCount })
			}
			if (metrics.outgoingDependencyCount > 0) {
				hotspots.push({ moduleId: module.id, kind: "outgoing-dependencies", score: metrics.outgoingDependencyCount })
			}
			const connectivity = metrics.dependencyFanIn + metrics.dependencyFanOut
			if (connectivity > 0) {
				hotspots.push({ moduleId: module.id, kind: "connectivity", score: connectivity })
			}
			if (metrics.totalSize > 0) {
				hotspots.push({ moduleId: module.id, kind: "size", score: metrics.totalSize })
			}
		}
		return hotspots.sort((a, b) => b.score - a.score || a.moduleId.localeCompare(b.moduleId) || a.kind.localeCompare(b.kind))
	}
}
