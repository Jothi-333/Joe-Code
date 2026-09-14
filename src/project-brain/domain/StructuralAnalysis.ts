export type StructuralSymbolKind =
	| "class"
	| "function"
	| "method"
	| "interface"
	| "type"
	| "enum"
	| "variable"
	| "property"

export interface SourceLocation {
	start: number
	end: number
	startLine: number
	startColumn: number
	endLine: number
	endColumn: number
}

export interface StructuralSymbol {
	name: string
	kind: StructuralSymbolKind
	location: SourceLocation
	parentName?: string
	exported: boolean
	async?: boolean
	static?: boolean
}

export interface StructuralImport {
	source: string
	defaultImport?: string
	namespaceImport?: string
	namedImports: Array<{
		name: string
		alias?: string
		isTypeOnly: boolean
	}>
	isTypeOnly: boolean
	location: SourceLocation
}

export interface StructuralExport {
	name: string
	localName?: string
	source?: string
	isTypeOnly: boolean
	location: SourceLocation
}

export interface StructuralCall {
	callerName?: string
	callerParentName?: string
	calleeName: string
	receiver?: string
	kind: "call" | "construct"
	location: SourceLocation
}

export interface StructuralAnalysis {
	filePath: string
	language: "typescript" | "javascript"
	symbols: StructuralSymbol[]
	imports: StructuralImport[]
	exports: StructuralExport[]
	calls: StructuralCall[]
}
