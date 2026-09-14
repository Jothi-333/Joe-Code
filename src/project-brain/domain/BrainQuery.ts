import type { ProjectFile } from "./ProjectFile"
import type { SemanticSearchOptions, SemanticSearchResult } from "./SemanticIndex"
import type { SymbolRecord } from "./SymbolRecord"

export interface BrainQueryOptions {
	query: string
	limit?: number
	language?: string
	directory?: string
	includeSemantic?: boolean
	semantic?: SemanticSearchOptions
}

export interface BrainQueryResult {
	query: string
	files: ProjectFile[]
	symbols: SymbolRecord[]
	semantic: SemanticSearchResult[]
	relatedFiles: string[]
}
