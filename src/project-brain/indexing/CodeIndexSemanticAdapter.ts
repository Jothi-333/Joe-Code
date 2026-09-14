import type { VectorStoreSearchResult } from "../../services/code-index/interfaces"
import type {
	SemanticIndex,
	SemanticSearchOptions,
	SemanticSearchResult,
} from "../domain/SemanticIndex"

export interface CodeIndexSearchGateway {
	searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
}

export class CodeIndexSemanticAdapter implements SemanticIndex {
	constructor(private readonly gateway: CodeIndexSearchGateway) {}

	async search(query: string, options: SemanticSearchOptions = {}): Promise<SemanticSearchResult[]> {
		const results = await this.gateway.searchIndex(query, options.directory)
		const minScore = options.minScore ?? Number.NEGATIVE_INFINITY
		const limit = options.limit ?? results.length

		return results
			.filter((result) => result.score >= minScore)
			.map((result) => this.toSemanticResult(result))
			.slice(0, Math.max(0, limit))
	}

	private toSemanticResult(result: VectorStoreSearchResult): SemanticSearchResult {
		const payload = result.payload
		if (!payload) {
			throw new Error(`Semantic search result ${String(result.id)} has no payload.`)
		}

		return {
			id: result.id,
			score: result.score,
			filePath: payload.filePath,
			codeChunk: payload.codeChunk,
			startLine: payload.startLine,
			endLine: payload.endLine,
		}
	}
}
