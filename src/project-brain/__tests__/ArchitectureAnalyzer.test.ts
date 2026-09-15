import { describe, expect, it } from "vitest"
import type { ProjectFile } from "../domain/ProjectFile"
import type { StructuralAnalysis } from "../domain/StructuralAnalysis"
import type { SymbolRecord } from "../domain/SymbolRecord"
import type { DependencyGraphSnapshot } from "../domain/DependencyGraph"
import type { CallGraphSnapshot } from "../domain/CallGraph"
import { ArchitectureAnalyzer } from "../architecture/ArchitectureAnalyzer"

const location = {
	start: 0,
	end: 10,
	startLine: 1,
	startColumn: 1,
	endLine: 1,
	endColumn: 11,
}

function file(relativePath: string, kind: ProjectFile["kind"] = "source"): ProjectFile {
	return {
		id: relativePath,
		absolutePath: `/project/${relativePath}`,
		relativePath,
		extension: ".ts",
		language: "typescript",
		kind,
		size: 100,
		hash: "hash",
		mtimeMs: 1,
	}
}

function symbol(filePath: string, name: string, exported = false): SymbolRecord {
	return {
		id: `${filePath}:${name}`,
		filePath,
		name,
		kind: "function",
		location,
		exported,
	}
}

function emptyCallGraph(): CallGraphSnapshot {
	return { edges: [], incoming: {}, outgoing: {} }
}

function emptyAnalysisMap(): Map<string, StructuralAnalysis> {
	return new Map<string, StructuralAnalysis>()
}

describe("ArchitectureAnalyzer", () => {
	it("discovers modules and calculates basic metrics", () => {
		const files = [
			file("src/api/User.ts"),
			file("src/api/UserService.ts"),
			file("src/api/UserService.test.ts", "test"),
			file("src/ui/App.ts"),
		]
		const symbols = [
			symbol("src/api/User.ts", "User", true),
			symbol("src/api/UserService.ts", "UserService", true),
			symbol("src/ui/App.ts", "App", true),
		]

		const model = new ArchitectureAnalyzer().analyze({
			files,
			symbols,
			analyses: emptyAnalysisMap(),
			dependencies: { edges: [], incoming: {}, outgoing: {} },
			callGraph: emptyCallGraph(),
			entryPoints: ["src/ui/App.ts"],
		})

		expect(model.modules.map((module) => module.path)).toEqual(["src/api", "src/ui"])

		const api = model.modules.find((module) => module.path === "src/api")
		expect(api?.metrics.fileCount).toBe(3)
		expect(api?.metrics.sourceFileCount).toBe(2)
		expect(api?.metrics.testFileCount).toBe(1)
		expect(api?.metrics.symbolCount).toBe(2)
		expect(api?.metrics.exportedSymbolCount).toBe(2)
		expect(api?.metrics.totalSize).toBe(300)
		expect(api?.languages).toEqual(["typescript"])
		expect(model.entryPoints).toEqual(["src/ui/App.ts"])
	})

	it("aggregates resolved cross-module dependencies and calculates hotspots", () => {
		const files = [file("src/api/User.ts"), file("src/api/UserService.ts"), file("src/ui/App.ts")]
		const dependencies: DependencyGraphSnapshot = {
			edges: [
				{ from: "src/ui/App.ts", to: "src/api/User.ts", source: "../api/User", kind: "import", resolved: true },
				{ from: "src/ui/App.ts", to: "src/api/UserService.ts", source: "../api/UserService", kind: "import", resolved: true },
				{ from: "src/api/UserService.ts", to: "src/api/User.ts", source: "./User", kind: "import", resolved: true },
				{ from: "src/ui/App.ts", to: "external-package", source: "external-package", kind: "import", resolved: false },
			],
			incoming: {},
			outgoing: {},
		}

		const model = new ArchitectureAnalyzer().analyze({
			files,
			symbols: [],
			analyses: emptyAnalysisMap(),
			dependencies,
			callGraph: emptyCallGraph(),
			entryPoints: ["src/ui/App.ts"],
		})

		expect(model.relationships).toEqual([
			{
				from: "src/ui",
				to: "src/api",
				dependencyCount: 2,
				files: ["src/ui/App.ts"],
			},
		])

		const api = model.modules.find((module) => module.path === "src/api")
		const ui = model.modules.find((module) => module.path === "src/ui")
		expect(api?.metrics.incomingDependencyCount).toBe(2)
		expect(api?.metrics.dependencyFanIn).toBe(1)
		expect(ui?.metrics.outgoingDependencyCount).toBe(2)
		expect(ui?.metrics.dependencyFanOut).toBe(1)
		expect(model.hotspots).toEqual(expect.arrayContaining([
			{ moduleId: "src/api", kind: "incoming-dependencies", score: 2 },
			{ moduleId: "src/ui", kind: "outgoing-dependencies", score: 2 },
			{ moduleId: "src/api", kind: "connectivity", score: 1 },
			{ moduleId: "src/ui", kind: "connectivity", score: 1 },
		]))
	})
})
