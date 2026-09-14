export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "unknown"

export interface GitStatusEntry {
	path: string
	status: GitFileStatus
	indexStatus: string
	worktreeStatus: string
	originalPath?: string
}

export interface GitRepositoryStatus {
	rootPath: string
	branch: string
	upstream?: string
	ahead: number
	behind: number
	entries: GitStatusEntry[]
	isDirty: boolean
}

export interface GitCommit {
	hash: string
	shortHash: string
	authorName: string
	authorEmail: string
	date: string
	subject: string
	body?: string
}

export interface GitFileHistoryEntry extends GitCommit {
	path: string
	status: GitFileStatus
}

export interface GitBlameLine {
	line: number
	commit: string
	authorName: string
	authorEmail: string
	date: string
	text: string
}

export interface GitDiffFile {
	path: string
	status: GitFileStatus
	additions: number
	deletions: number
}

export interface GitDiffSummary {
	base?: string
	head?: string
	files: GitDiffFile[]
	additions: number
	deletions: number
}
