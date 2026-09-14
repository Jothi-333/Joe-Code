import ts from "typescript"
import type {
	SourceLocation,
	StructuralAnalysis,
	StructuralCall,
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
		const calls: StructuralCall[] = []

		const addSymbol = (node: ts.Node, name: string, kind: StructuralSymbolKind, parentName?: string) => {
			const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
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

		this.collectCalls(sourceFile, calls)

		return {
			filePath,
			language,
			symbols: this.dedupeSymbols(symbols),
			imports,
			exports: this.dedupeExports(exports),
			calls,
		}
	}

	private visitTopLevel(
		node: ts.Statement,
		sourceFile: ts.SourceFile,
		addSymbol: (node: ts.Node, name: string, kind: StructuralSymbolKind, parentName?: string) => void,
		symbols: StructuralSymbol[],
		imports: StructuralImport[],
		exports: StructuralExport[],
	): void {
		if (ts.isImportDeclaration(node)) {
			this.collectImport(node, sourceFile, imports)
			return
		}
		if (ts.isExportDeclaration(node)) {
			this.collectExportDeclaration(node, sourceFile, exports)
			return
		}
		if (ts.isFunctionDeclaration(node) && node.name) {
			addSymbol(node, node.name.text, "function")
			return
		}
		if (ts.isClassDeclaration(node) && node.name) {
			addSymbol(node, node.name.text, "class")
			for (const member of node.members) {
				if (ts.isMethodDeclaration(member) && member.name) {
					const name = this.propertyName(member.name)
					if (name) addSymbol(member, name, "method", node.name.text)
				} else if (ts.isPropertyDeclaration(member) && member.name) {
					const name = this.propertyName(member.name)
					if (name) addSymbol(member, name, "property", node.name.text)
				}
			}
			return
		}
		if (ts.isInterfaceDeclaration(node)) {
			addSymbol(node, node.name.text, "interface")
			return
		}
		if (ts.isTypeAliasDeclaration(node)) {
			addSymbol(node, node.name.text, "type")
			return
		}
		if (ts.isEnumDeclaration(node)) {
			addSymbol(node, node.name.text, "enum")
			return
		}
		if (ts.isVariableStatement(node)) {
			const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
			const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					symbols.push({
						name: declaration.name.text,
						kind: "variable",
						location: this.location(sourceFile, declaration),
						exported,
					})
				}
			}
		}
	}

	private collectImport(node: ts.ImportDeclaration, sourceFile: ts.SourceFile, imports: StructuralImport[]): void {
		const clause = node.importClause
		const namedImports: StructuralImport["namedImports"] = []
		let defaultImport: string | undefined
		let namespaceImport: string | undefined
		if (clause) {
			defaultImport = clause.name?.text
			if (clause.namedBindings) {
				if (ts.isNamespaceImport(clause.namedBindings)) {
					namespaceImport = clause.namedBindings.name.text
				} else {
					for (const element of clause.namedBindings.elements) {
						namedImports.push({
							name: element.propertyName?.text ?? element.name.text,
							alias: element.propertyName ? element.name.text : undefined,
							isTypeOnly: element.isTypeOnly,
						})
					}
				}
			}
		}
		imports.push({
			source: (node.moduleSpecifier as ts.StringLiteral).text,
			defaultImport,
			namespaceImport,
			namedImports,
			isTypeOnly: clause?.isTypeOnly ?? false,
			location: this.location(sourceFile, node),
		})
	}

	private collectExportDeclaration(node: ts.ExportDeclaration, sourceFile: ts.SourceFile, exports: StructuralExport[]): void {
		if (!node.exportClause) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				exports.push({ name: "*", source: node.moduleSpecifier.text, isTypeOnly: node.isTypeOnly, location: this.location(sourceFile, node) })
			}
			return
		}
		if (ts.isNamedExports(node.exportClause)) {
			for (const element of node.exportClause.elements) {
				exports.push({
					name: element.name.text,
					localName: element.propertyName?.text,
					source: node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined,
					isTypeOnly: node.isTypeOnly || element.isTypeOnly,
					location: this.location(sourceFile, element),
				})
			}
		}
	}

	private collectCalls(sourceFile: ts.SourceFile, calls: StructuralCall[]): void {
		const visit = (node: ts.Node, callerName?: string, callerParentName?: string) => {
			let nextCaller = callerName
			let nextParent = callerParentName
			if (ts.isFunctionDeclaration(node) && node.name) {
				nextCaller = node.name.text
				nextParent = undefined
			} else if (ts.isMethodDeclaration(node) && node.name) {
				nextCaller = this.propertyName(node.name)
				nextParent = this.findClassParent(node)
			}
			if (ts.isCallExpression(node)) {
				calls.push({
					calleeName: this.expressionName(node.expression),
					receiver: this.receiverName(node.expression),
					callerName: nextCaller,
					callerParentName: nextParent,
					kind: "call",
					location: this.location(sourceFile, node),
				})
			} else if (ts.isNewExpression(node)) {
				calls.push({
					calleeName: this.expressionName(node.expression),
					receiver: this.receiverName(node.expression),
					callerName: nextCaller,
					callerParentName: nextParent,
					kind: "construct",
					location: this.location(sourceFile, node),
				})
			}
			ts.forEachChild(node, (child) => visit(child, nextCaller, nextParent))
		}
		visit(sourceFile)
	}

	private findClassParent(node: ts.MethodDeclaration): string | undefined {
		let current: ts.Node | undefined = node.parent
		while (current) {
			if (ts.isClassDeclaration(current) && current.name) return current.name.text
			current = current.parent
		}
		return undefined
	}

	private expressionName(expression: ts.Expression): string {
		if (ts.isIdentifier(expression)) return expression.text
		if (ts.isPropertyAccessExpression(expression)) return expression.name.text
		if (ts.isElementAccessExpression(expression)) return this.expressionName(expression.expression)
		return expression.getText()
	}

	private receiverName(expression: ts.Expression): string | undefined {
		if (ts.isPropertyAccessExpression(expression)) return expression.expression.getText()
		return undefined
	}

	private propertyName(name: ts.PropertyName): string | undefined {
		if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
		return undefined
	}

	private location(sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
		const start = node.getStart(sourceFile)
		const end = node.getEnd()
		const startPos = sourceFile.getLineAndCharacterOfPosition(start)
		const endPos = sourceFile.getLineAndCharacterOfPosition(end)
		return { start, end, startLine: startPos.line + 1, startColumn: startPos.character + 1, endLine: endPos.line + 1, endColumn: endPos.character + 1 }
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

	private dedupeExports(exports: StructuralExport[]): StructuralExport[] {
		const seen = new Set<string>()
		return exports.filter((entry) => {
			const key = `${entry.name}:${entry.localName ?? ""}:${entry.source ?? ""}:${entry.location.start}`
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	}
}
