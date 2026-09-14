import type {
	GitBlameLine,
	GitCommit,
	GitDiffFile,
	GitDiffSummary,
	GitFileHistoryEntry,
	GitFileStatus,
	GitRepositoryStatus,
	GitStatusEntry,
	GitCommandRunner,
} from "../domain/GitSnapshot"

const FIELD_FORMAT = "%x1f"
const FIELD_SEPARATOR = "\x1f"

export class GitIntelligence {
	constructor(private readonly rootPath: string, private readonly runner: GitCommandRunner) {}

	async getStatus(): Promise<GitRepositoryStatus> {
		const branch = (await this.runner.run(["branch", "--show-current"])).trim()
		let upstream: string | undefined
		try {
			upstream = (await this.runner.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).trim() || undefined
		} catch {}
		let ahead = 0
		let behind = 0
		if (upstream) {
			const counts = (await this.runner.run(["rev-list", "--left-right", "--count", upstream + "...HEAD"])).trim().split(/\s+/)
			behind = Number(counts[0]) || 0
			ahead = Number(counts[1]) || 0
		}
		const entries = this.parseStatus(await this.runner.run(["status", "--porcelain=v1"]))
		return { rootPath: this.rootPath, branch, upstream, ahead, behind, entries, isDirty: entries.length > 0 }
	}

	async getRecentCommits(limit = 20): Promise<GitCommit[]> {
		const count = Math.max(1, Math.min(limit, 200))
		const format = ["%H", "%h", "%an", "%ae", "%aI", "%s"].join(FIELD_FORMAT)
		const output = await this.runner.run(["log", "-" + count, "--date=iso-strict", "--format=" + format])
		return this.parseCommits(output)
	}

	async getFileHistory(filePath: string, limit = 20): Promise<GitFileHistoryEntry[]> {
		const count = Math.max(1, Math.min(limit, 200))
		const format = ["%H", "%h", "%an", "%ae", "%aI", "%s"].join(FIELD_FORMAT)
		const safePath = this.safePath(filePath)
		const output = await this.runner.run(["log", "-" + count, "--date=iso-strict", "--name-status", "--format=" + format, "--", safePath])
		const commits = this.parseCommits(output)
		const statuses = output.split("\n").filter((line) => /^[AMDRC][0-9]?\t/.test(line.trim())).map((line) => this.parseNameStatus(line))
		return commits.map((commit, index) => ({ ...commit, path: statuses[index]?.path ?? safePath, status: statuses[index]?.status ?? "unknown" }))
	}

	async getBlame(filePath: string): Promise<GitBlameLine[]> {
		return this.parseBlame(await this.runner.run(["blame", "--line-porcelain", "--", this.safePath(filePath)]))
	}

	async getDiff(base?: string, head = "HEAD", filePath?: string): Promise<GitDiffSummary> {
		const args = ["diff", "--numstat", "--find-renames"]
		if (base) args.push(head === "HEAD" ? base + "..HEAD" : base + "..." + head)
		if (filePath) args.push("--", this.safePath(filePath))
		const files = this.parseNumstat(await this.runner.run(args))
		return { base, head, files, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) }
	}

	private safePath(filePath: string): string {
		const value = filePath.replace(/\\/g, "/").replace(/^\.\//, "")
		if (!value || value.startsWith("/") || value.split("/").includes("..")) throw new Error("Git path must be relative to project root: " + filePath)
		return value
	}

	private parseStatus(output: string): GitStatusEntry[] {
		return output.split("\n").filter(Boolean).map((line) => {
			const indexStatus = line[0] ?? " "
			const worktreeStatus = line[1] ?? " "
			const parts = line.slice(3).split(" -> ")
			return { path: parts.at(-1) ?? "", status: this.status(indexStatus, worktreeStatus), indexStatus, worktreeStatus, originalPath: parts.length > 1 ? parts[0] : undefined }
		})
	}

	private status(index: string, worktree: string): GitFileStatus {
		if (index === "?" && worktree === "?") return "untracked"
		if (index === "R" || worktree === "R") return "renamed"
		if (index === "C" || worktree === "C") return "copied"
		if (index === "A") return "added"
		if (index === "D" || worktree === "D") return "deleted"
		if (index === "M" || worktree === "M") return "modified"
		return "unknown"
	}

	private parseCommits(output: string): GitCommit[] {
		const result: GitCommit[] = []
		const seen = new Set<string>()
		for (const line of output.split("\n")) {
			if (!line.includes(FIELD_SEPARATOR)) continue
			const [hash, shortHash, authorName, authorEmail, date, subject] = line.split(FIELD_SEPARATOR)
			if (!hash || seen.has(hash)) continue
			seen.add(hash)
			result.push({ hash, shortHash, authorName, authorEmail, date, subject })
		}
		return result
	}

	private parseNameStatus(line: string): { path: string; status: GitFileStatus } {
		const parts = line.trim().split("\t")
		const code = parts[0] ?? ""
		return { path: parts.at(-1) ?? "", status: code.startsWith("R") ? "renamed" : code.startsWith("C") ? "copied" : this.status(code[0] ?? " ", " ") }
	}

	private parseNumstat(output: string): GitDiffFile[] {
		return output.split("\n").filter(Boolean).map((line) => {
			const [add, del, ...path] = line.split("\t")
			const value = path.join("\t")
			return { path: value, status: "modified", additions: add === "-" ? 0 : Number(add) || 0, deletions: del === "-" ? 0 : Number(del) || 0 }
		})
	}

	private parseBlame(output: string): GitBlameLine[] {
		const result: GitBlameLine[] = []
		let commit = ""
		let line = 0
		let authorName = ""
		let authorEmail = ""
		let date = ""
		for (const value of output.split("\n")) {
			if (/^[0-9a-f]{40} \d+ \d+ \d+/.test(value)) {
				const parts = value.split(" ")
				commit = parts[0]
				line = Number(parts[2])
			} else if (value.startsWith("author ")) authorName = value.slice(7)
			else if (value.startsWith("author-mail ")) authorEmail = value.slice(12).replace(/^</, "").replace(/>$/, "")
			else if (value.startsWith("author-time ")) date = new Date(Number(value.slice(12)) * 1000).toISOString()
			else if (value.startsWith("\t")) result.push({ line, commit, authorName, authorEmail, date, text: value.slice(1) })
		}
		return result
	}
}