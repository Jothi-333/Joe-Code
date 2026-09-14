export interface SemanticSearchOptions {
	limit?: number
	directory?: string
	minScore?: number
}

export interface SemanticSearchResult {
	id: string | number
	score: number
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
}

export interface SemanticIndex {
	search(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult[]>
}
