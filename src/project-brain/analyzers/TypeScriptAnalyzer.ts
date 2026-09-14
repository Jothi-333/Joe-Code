import ts from "typescript"
import type {
	StructuralAnalysis,
	StructuralCall,
	StructuralExport,
	StructuralImport,
	StructuralSymbol,
	StructuralSymbolKind,
	SourceLocation,
} from "../domain/StructuralAnalysis"

const SCRIPT_KIND_BY_EXTENSION: Record<string, ts.ScriptKind> = {
	".ts": ts.ScriptKind.TS,
	".tsx": ts.ScriptKind.TSX,
	".js": ts.ScriptKind.JS,
	".jsx": ts.ScriptKind.JSX,
	".mjs": ts.ScriptKind.JS,
	".cjs": ts.ScriptKind.JS,
}

export class TypeScriptAnalyzer {
	analyze(filePath: string, source: string, language: "typescript" | "javascript"): StructuralAnalysis {
		const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
		const scriptKind = SCRIPT_KIND_BY_EXTENSION[extension] ?? (language === "typescript" ? ts.ScriptKind.TS : ts.ScriptKind.JS)
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

		const visit = (node: ts.Node) => {
			if (ts.isFunctionDeclaration(node) && node.name) addSymbol(node, node.name.text, "function")
			else if (ts.isClassDeclaration(node) && node.name) {
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
			} else if (ts.isInterfaceDeclaration(node)) addSymbol(node, node.name.text, "interface")
			else if (ts.isTypeAliasDeclaration(node)) addSymbol(node, node.name.text, "type")
			else if (ts.isEnumDeclaration(node)) addSymbol(node, node.name.text, "enum")
			else if (ts.isVariableStatement(node)) {
				const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
				const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
				for (const declaration of node.declarationList.declarations) {
					if (ts.isIdentifier(declaration.name)) symbols.push({ name: declaration.name.text, kind: "variable", location: this.location(sourceFile, declaration), exported })
				}
			}
			ts.forEachChild(node, visit)
		}

		const visitImportsExports = (node: ts.Node) => {
			if (ts.isImportDeclaration(node)) this.collectImport(node, sourceFile, imports)
			else if (ts.isExportDeclaration(node)) this.collectExportDeclaration(node, sourceFile, exports)
			ts.forEachChild(node, visitImportsExports)
		}

		visit(sourceFile)
		visitImportsExports(sourceFile)
		this.collectCalls(sourceFile, calls)
		return { filePath, language, symbols, imports, exports, calls }
	}

	private collectImport(node: ts.ImportDeclaration, sourceFile: ts.SourceFile, imports: StructuralImport[]): void {
		const clause = node.importClause
		const namedImports: StructuralImport["namedImports"] = []
		let defaultImport: string | undefined
		let namespaceImport: string | undefined
		if (clause) {
			defaultImport = clause.name?.text
			if (clause.namedBindings) {
				if (ts.isNamespaceImport(clause.namedBindings)) namespaceImport = clause.namedBindings.name.text
				else for (const element of clause.namedBindings.elements) namedImports.push({ name: element.propertyName?.text ?? element.name.text, alias: element.propertyName ? element.name.text : undefined, isTypeOnly: element.isTypeOnly })
			}
		}
		imports.push({ source: (node.moduleSpecifier as ts.StringLiteral).text, defaultImport, namespaceImport, namedImports, isTypeOnly: clause?.isTypeOnly ?? false, location: this.location(sourceFile, node) })
	}

	private collectExportDeclaration(node: ts.ExportDeclaration, sourceFile: ts.SourceFile, exports: StructuralExport[]): void {
		if (!node.exportClause) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) exports.push({ name: "*", source: node.moduleSpecifier.text, isTypeOnly: node.isTypeOnly, location: this.location(sourceFile, node) })
			return
		}
		if (ts.isNamedExports(node.exportClause)) {
			for (const element of node.exportClause.elements) {
				exports.push({ name: element.name.text, localName: element.propertyName?.text ?? element.name.text, source: node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined, isTypeOnly: node.isTypeOnly || element.isTypeOnly, location: this.location(sourceFile, element) })
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
			if (ts.isCallExpression(node)) calls.push({ calleeName: this.expressionName(node.expression), receiver: this.receiverName(node.expression), callerName: nextCaller, callerParentName: nextParent, kind: "call", location: this.location(sourceFile, node) })
			else if (ts.isNewExpression(node)) calls.push({ calleeName: this.expressionName(node.expression), receiver: this.receiverName(node.expression), callerName: nextCaller, callerParentName: nextParent, kind: "construct", location: this.location(sourceFile, node) })
			ts.forEachChild(node, (child) => visit(child, nextCaller, nextParent))
		}
		visit(sourceFile)
	}

	private expressionName(expression: ts.Expression): string {
		if (ts.isIdentifier(expression)) return expression.text
		if (ts.isPropertyAccessExpression(expression)) return expression.name.text
		if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) return expression.argumentExpression.text
		return expression.getText(sourceFileForText(expression))
	}

	private receiverName(expression: ts.Expression): string | undefined {
		return ts.isPropertyAccessExpression(expression) ? expression.expression.getText() : undefined
	}

	private propertyName(name: ts.PropertyName): string | undefined {
		if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
		return undefined
	}

	private findClassParent(node: ts.Node): string | undefined {
		let current = node.parent
		while (current) {
			if (ts.isClassDeclaration(current) && current.name) return current.name.text
			current = current.parent
		}
		return undefined
	}

	private location(sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
		const start = node.getStart(sourceFile)
		const end = node.getEnd()
		const startPos = sourceFile.getLineAndCharacterOfPosition(start)
		const endPos = sourceFile.getLineAndCharacterOfPosition(end)
		return { start, end, startLine: startPos.line + 1, startColumn: startPos.character, endLine: endPos.line + 1, endColumn: endPos.character }
	}
}

function sourceFileForText(node: ts.Node): ts.SourceFile {
	return node.getSourceFile()
}