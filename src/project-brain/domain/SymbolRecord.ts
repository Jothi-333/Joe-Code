import type { StructuralSymbol } from "./StructuralAnalysis"

export interface SymbolRecord extends StructuralSymbol {
	id: string
	filePath: string
}
