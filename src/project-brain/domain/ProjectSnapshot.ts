import type { ProjectFile } from "./ProjectFile"

export interface ProjectPackage {
	name: string
	version?: string
	path: string
	type: "npm" | "pnpm" | "yarn" | "bun" | "python" | "unknown"
}

export interface ProjectSnapshot {
	rootPath: string
	createdAt: number
	updatedAt: number
	files: number
	sourceFiles: number
	languages: Record<string, number>
	packages: ProjectPackage[]
	entryPoints: string[]
	filesByPath: Record<string, ProjectFile>
}
