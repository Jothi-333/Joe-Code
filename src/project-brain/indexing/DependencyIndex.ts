import path from "path"
import type { ProjectFile } from "../domain/ProjectFile"
import type { StructuralAnalysis } from "../domain/StructuralAnalysis"
import type { DependencyEdge, DependencyGraphSnapshot } from "../domain/DependencyGraph"

export class DependencyIndex {
 private snapshot: DependencyGraphSnapshot = { edges: [], incoming: {}, outgoing: {} }

 build(files: ProjectFile[], analyses: Map<string, StructuralAnalysis>): DependencyGraphSnapshot {
  const filePaths = new Set(files.map((file) => file.relativePath))
  const edges: DependencyEdge[] = []
  for (const [from, analysis] of analyses) {
   for (const item of analysis.imports) {
    const to = this.resolve(from, item.source, filePaths)
    edges.push({ from, to: to ?? item.source, source: item.source, kind: "import", resolved: to !== undefined })
   }
   for (const item of analysis.exports.filter((entry) => entry.source)) {
    const source = item.source!
    const to = this.resolve(from, source, filePaths)
    edges.push({ from, to: to ?? source, source, kind: "re-export", resolved: to !== undefined })
   }
  }
  const uniqueEdges = this.dedupe(edges)
  const incoming: Record<string, string[]> = {}
  const outgoing: Record<string, string[]> = {}
  for (const edge of uniqueEdges) {
   ;(outgoing[edge.from] ??= []).push(edge.to)
   ;(incoming[edge.to] ??= []).push(edge.from)
  }
  this.snapshot = { edges: uniqueEdges, incoming, outgoing }
  return this.snapshot
 }

 getSnapshot(): DependencyGraphSnapshot { return this.snapshot }
 getDependencies(filePath: string): string[] { return this.snapshot.outgoing[filePath] ?? [] }
 getDependents(filePath: string): string[] { return this.snapshot.incoming[filePath] ?? [] }
 clear(): void { this.snapshot = { edges: [], incoming: {}, outgoing: {} } }

 private resolve(from: string, source: string, filePaths: Set<string>): string | undefined {
  if (!source.startsWith(".")) return undefined
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), source))
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`]
  return candidates.find((candidate) => filePaths.has(candidate))
 }

 private dedupe(edges: DependencyEdge[]): DependencyEdge[] {
  const seen = new Set<string>()
  return edges.filter((edge) => {
   const key = `${edge.from}:${edge.to}:${edge.kind}`
   if (seen.has(key)) return false
   seen.add(key)
   return true
  })
 }
}
