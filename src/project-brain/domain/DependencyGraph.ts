export type DependencyKind = "import" | "re-export"

export interface DependencyEdge {
	from: string
	to: string
	source: string
	kind: DependencyKind
	resolved: boolean
}

export interface DependencyGraphSnapshot {
	edges: DependencyEdge[]
	incoming: Record<string, string[]>
	outgoing: Record<string, string[]>
}
