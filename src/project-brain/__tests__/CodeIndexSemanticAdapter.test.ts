import { describe, expect, it, vi } from "vitest"
import { CodeIndexSemanticAdapter } from "../indexing/CodeIndexSemanticAdapter"
import type { VectorStoreSearchResult } from "../../services/code-index/interfaces"

describe("CodeIndexSemanticAdapter", () => {
	it("maps code-index payloads to project-brain semantic results", async () => {
		const searchIndex = vi.fn().mockResolvedValue([
			{
				id: "chunk-1",
				score: 0.91,
				payload: {
					filePath: "src/user/UserService.ts",
					codeChunk: "export class UserService {}",
					startLine: 10,
					endLine: 12,
				},
			} satisfies VectorStoreSearchResult,
		])

		const adapter = new CodeIndexSemanticAdapter({ searchIndex })
		const results = await adapter.search("create user", { directory: "src/user", limit: 5 })

		expect(searchIndex).toHaveBeenCalledWith("create user", "src/user")
		expect(results).toEqual([
			{
				id: "chunk-1",
				score: 0.91,
				filePath: "src/user/UserService.ts",
				codeChunk: "export class UserService {}",
				startLine: 10,
				endLine: 12,
			},
		])
	})

	it("applies score and limit filters after the existing code index search", async () => {
		const searchIndex = vi.fn().mockResolvedValue([
			{
				id: "low",
				score: 0.4,
				payload: { filePath: "a.ts", codeChunk: "a", startLine: 1, endLine: 1 },
			},
			{
				id: "high-1",
				score: 0.9,
				payload: { filePath: "b.ts", codeChunk: "b", startLine: 2, endLine: 2 },
			},
			{
				id: "high-2",
				score: 0.8,
				payload: { filePath: "c.ts", codeChunk: "c", startLine: 3, endLine: 3 },
			},
		])

		const adapter = new CodeIndexSemanticAdapter({ searchIndex })
		const results = await adapter.search("query", { minScore: 0.75, limit: 1 })

		expect(results).toHaveLength(1)
		expect(results[0]?.id).toBe("high-1")
	})

	it("rejects malformed results without payloads", async () => {
		const searchIndex = vi.fn().mockResolvedValue([
			{ id: "missing", score: 0.8, payload: null } satisfies VectorStoreSearchResult,
		])
		const adapter = new CodeIndexSemanticAdapter({ searchIndex })

		await expect(adapter.search("query")).rejects.toThrow("has no payload")
	})
})
