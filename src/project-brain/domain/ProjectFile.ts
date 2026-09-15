export type ProjectFileKind = "source" | "test" | "config" | "documentation" | "asset" | "generated" | "unknown"

export interface ProjectFile {
	id: string
	absolutePath: string
	relativePath: string
	extension: string
	language?: string
	kind: ProjectFileKind
	size: number
	hash: string
	mtimeMs: number
	indexedAt?: number
}
