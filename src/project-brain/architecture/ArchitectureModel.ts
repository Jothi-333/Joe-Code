export type ArchitectureHotspotKind =
	"incoming-dependencies"
	| "outgoing-dependencies"
	| "connectivity"
	| "size"

export interface ArchitectureModuleMetrics {
	fileCount: number
	sourceFileCount: number
	testFileCount: number
	symbolCount: number
	exportedSymbolCount: number
	incomingDependencyCount: number
	outgoingDependencyCount: number
	dependencyFanIn: number
	dependencyFanOut: number
	totalSize: number
}

export interface ArchitectureModule {
	id: string
	path: string
	files: string[]
	languages: string[]
	metrics: ArchitectureModuleMetrics
}

export interface ArchitectureRelationship {
	from: string
	to: string
	dependencyCount: number
	files: string[]
}

export interface ArchitectureHotspot {
	moduleId: string
	kind: ArchitectureHotspotKind
	score: number
}

export interface ArchitectureModel {
	generatedAt: number
	modules: ArchitectureModule[]
	relationships: ArchitectureRelationship[]
	entryPoints: string[]
	hotspots: ArchitectureHotspot[]
}
