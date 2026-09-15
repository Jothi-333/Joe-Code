import type { SourceLocation } from "./StructuralAnalysis"

export interface CallGraphEdge {
	from: string
	to?: string
	calleeName: string
	kind: "call" | "construct"
	filePath: string
	location: SourceLocation
	resolved: boolean
}

export interface CallGraphSnapshot {
	edges: CallGraphEdge[]
	incoming: Record<string, string[]>
	outgoing: Record<string, string[]>
}
