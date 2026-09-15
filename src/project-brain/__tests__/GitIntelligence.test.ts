import { describe, expect, it } from "vitest"
import { GitIntelligence } from "../indexing/GitIntelligence"
import type { GitCommandRunner } from "../domain/GitSnapshot"

class FakeGitRunner implements GitCommandRunner {
	constructor(private readonly responses: Record<string, string>) {}
	async run(args: readonly string[]): Promise<string> {
		const key = args.join(" ")
		const value = this.responses[key]
		if (value === undefined) throw new Error(`Unexpected git command: ${key}`)
		return value
	}
}

describe("GitIntelligence", () => {
	it("reads branch, upstream tracking and working tree status", async () => {
		const runner = new FakeGitRunner({
			"branch --show-current": "feature/project-brain\n",
			"rev-parse --abbrev-ref --symbolic-full-name @{upstream}": "origin/feature/project-brain\n",
			"rev-list --left-right --count origin/feature/project-brain...HEAD": "2 3\n",
			"status --porcelain=v1": " M src/a.ts\n?? src/new.ts\n",
		})
		const status = await new GitIntelligence("/repo", runner).getStatus()
		expect(status.branch).toBe("feature/project-brain")
		expect(status.ahead).toBe(3)
		expect(status.behind).toBe(2)
		expect(status.entries.map((entry) => entry.status)).toEqual(["modified", "untracked"])
		expect(status.isDirty).toBe(true)
	})

	it("parses commit history and rejects unsafe paths", async () => {
		const runner = new FakeGitRunner({
			"log -5 --date=iso-strict --format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s": "abc\x1fabc\x1fJoe\x1fjoe@example.com\x1f2026-09-14T12:00:00Z\x1ffix brain\n",
		})
		const git = new GitIntelligence("/repo", runner)
		expect((await git.getRecentCommits(5))[0].subject).toBe("fix brain")
		await expect(git.getFileHistory("../secret.ts")).rejects.toThrow()
	})

	it("parses line porcelain blame", async () => {
		const runner = new FakeGitRunner({
			"blame --line-porcelain -- src/a.ts": "0123456789012345678901234567890123456789 1 1 1\nauthor Joe\nauthor-mail <joe@example.com>\nauthor-time 1789387200\n\tconst value = 1\n",
		})
		const lines = await new GitIntelligence("/repo", runner).getBlame("src/a.ts")
		expect(lines).toHaveLength(1)
		expect(lines[0].line).toBe(1)
		expect(lines[0].text).toBe("const value = 1")
	})
})
