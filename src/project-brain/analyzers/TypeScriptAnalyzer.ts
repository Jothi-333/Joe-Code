import ts from "typescript"
import type {
	SourceLocation,
	StructuralAnalysis,
	StructuralExport,
	StructuralImport,
	StructuralSymbol,
	StructuralSymbolKind,
} from "../domain/StructuralAnalysis"

export interface LanguageAnalyzer {
	supports(language: string): boolean
	analyze(filePath: string, source: string, language: "typescript" | "javascript"): StructuralAnalysis
}

const SCRIPT_KIND_BY_EXTENSION: Record<string, ts.ScriptKind> = {
	".ts": ts.ScriptKind.TS,
	".tsx": ts.ScriptKind.TSX,
	".js": ts.ScriptKind.JS,
	".jsx": ts.ScriptKind.JSX,
}

export class TypeScriptAnalyzer implements LanguageAnalyzer {
	supports(language: string): boolean {
		return language === "typescript" || language === "javascript"
	}

	analyze(filePath: string, source: string, language: "typescript" | "javascript"): StructuralAnalysis {
		const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
		const scriptKind = SCRIPT_KIND_BY_EXTENSION[extension] ??
			(language === "typescript" ? ts.ScriptKind.TS : ts.ScriptKind.JS)
		const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind)
		const symbols: StructuralSymbol[] = []
		const imports: StructuralImport[] = []
		const exports: StructuralExport[] = []

		const addSymbol = (node: ts.Node, name: string, kind: StructuralSymbolKind, parentName?: string) => {
			const modifiers = ts.getModifiers(node)
			symbols.push({
				name,
				kind,
				location: this.location(sourceFile, node),
				parentName,
				exported: modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false,
				async: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
				static: modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword),
			})
		}

		for (const node of sourceFile.statements) {
			this.visitTopLevel(node, sourceFile, addSymbol, symbols, imports, exports)
		}

		return {
			filePath,
			language,
			symbols: this.dedupeSymbols(symbols),
			imports,
			exports: this.dedupeExports(exports),
		}
	}

	private visitTopLevel(
		node: ts.Node,
		sourceFile: ts.SourceFile,
		addSymbol: (node: ts.Node, name: string, kind: StructuralSymbolKind, parentName?: string) => void,
		symbols: StructuralSymbol[],
		imports: StructuralImport[],
		exports: StructuralExport[],
	): void {
		if (ts.isClassDeclaration(node) && node.name) {
			addSymbol(node, node.name.text, "class")
			for (const member of node.members) {
				if (ts.isMethodDeclaration(member) && member.name) {
					addSymbol(member, this.propertyName(member.name), "method", node.name.text)
				} else if (ts.isPropertyDeclaration(member) && member.name) {
					addSymbol(member, this.propertyName(member.name), "property", node.name.text)
				}
			}
		} else if (ts.isFunctionDeclaration(node) && node.name) {
			addSymbol(node, node.name.text, "function")
		} else if (ts.isInterfaceDeclaration(node)) {
			addSymbol(node, node.name.text, "interface")
		} else if (ts.isTypeAliasDeclaration(node)) {
			addSymbol(node, node.name.text, "type")
		} else if (ts.isEnumDeclaration(node)) {
			addSymbol(node, node.name.text, "enum")
		} else if (ts.isVariableStatement(node)) {
			for (const declaration of node.declarationList.declarations) {
				for (const name of this.bindingNames(declaration.name)) {
					const initializer = declaration.initializer
					const kind = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
						? "function" : "variable"
					addSymbol(node, name, kind)
				}
			}
		}

		if (ts.isImportDeclaration(node)) imports.push(this.parseImport(sourceFile, node))
		if (ts.isExportDeclaration(node)) this.parseExportDeclaration(sourceFile, node, exports)
		if (ts.isExportAssignment(node)) {
			exports.push({
				name: "default",
				localName: node.expression.getText(sourceFile),
				isTypeOnly: false,
				location: this.location(sourceFile, node),
			})
		}
	}

	private parseImport(sourceFile: ts.SourceFile, node: ts.ImportDeclaration): StructuralImport {
		const clause = node.importClause
		const namedImports: StructuralImport["namedImports"] = []
		let defaultImport: string | undefined
		let namespaceImport: string | undefined
		if (clause) {
			defaultImport = clause.name?.text
			const bindings = clause.namedBindings
			if (bindings && ts.isNamespaceImport(bindings)) namespaceImport = bindings.name.text
			if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					namedImports.push({
						name: element.propertyName?.text ?? element.name.text,
						alias: element.propertyName ? element.name.text : undefined,
						isTypeOnly: clause.isTypeOnly || element.isTypeOnly,
					})
				}
			}
		}
		return {
			source: this.moduleSpecifierText(node.moduleSpecifier),
			defaultImport,
			namespaceImport,
			namedImports,
			isTypeOnly: clause?.isTypeOnly ?? false,
			location: this.location(sourceFile, node),
		}
	}

	private parseExportDeclaration(sourceFile: ts.SourceFile, node: ts.ExportDeclaration, exports: StructuralExport[]): void {
		const source = node.moduleSpecifier ? this.moduleSpecifierText(node.moduleSpecifier) : undefined
		const clause = node.exportClause
		if (!clause) {
			if (source) exports.push({ name: "*", source, isTypeOnly: node.isTypeOnly, location: this.location(sourceFile, node) })
			return
		}
		if (ts.isNamespaceExport(clause)) {
			exports.push({ name: clause.name.text, source, isTypeOnly: node.isTypeOnly, location: this.location(sourceFile, node) })
			return
		}
		for (const element of clause.elements) {
			exports.push({
				name: element.name.text,
				localName: element.propertyName?.text ?? element.name.text,
				source,
				isTypeOnly: node.isTypeOnly || element.isTypeOnly,
				location: this.location(sourceFile, element),
			})
		}
	}

	private bindingNames(name: ts.BindingName): string[] {
		if (ts.isIdentifier(name)) return [name.text]
		return name.elements.flatMap((element) => ts.isBindingElement(element) ? this.bindingNames(element.name) : [])
	}

	private propertyName(name: ts.PropertyName): string {
		if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
		return name.getText()
	}

	private moduleSpecifierText(node: ts.Expression): string {
		return ts.isStringLiteral(node) ? node.text : node.getText()
	}

	private location(sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
		const start = node.getStart(sourceFile)
		const end = node.getEnd()
		const startPosition = sourceFile.getLineAndCharacterOfPosition(start)
		const endPosition = sourceFile.getLineAndCharacterOfPosition(end)
		return { start, end, startLine: startPosition.line + 1, startColumn: startPosition.character + 1, endLine: endPosition.line + 1, endColumn: endPosition.character + 1 }
	}

	private dedupeSymbols(symbols: StructuralSymbol[]): StructuralSymbol[] {
		const seen = new Set<string>()
		return symbols.filter((symbol) => {
			const key = `${symbol.kind}:${symbol.parentName ?? ""}:${symbol.name}:${symbol.location.start}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	}

	private dedupeExports(entries: StructuralExport[]): StructuralExport[] {
		const seen = new Set<string>()
		return entries.filter((entry) => {
			const key = `${entry.name}:${entry.localName ?? ""}:${entry.source ?? ""}:${entry.location.start}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	}
}
