import * as vscode from 'vscode';
import * as path from 'path';

// 캐시 확인 및 업데이트 함수
async function getFileSymbols(file: vscode.Uri, word: string): Promise<vscode.Location[]> {
	const doc = await vscode.workspace.openTextDocument(file);
	const content = doc.getText();
	const symbols: { [key: string]: vscode.Location[] } = {};

	// 변수 선언과 객체 선언을 모두 찾는 정규식 개선
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const symbolRegex = /(?:const|let|var|window\.)?(?:\s*)(\w+)(?:\s*=\s*[{]|\s*[=:](?:\s*function)?\s*[({])/g;
		let match;

		while ((match = symbolRegex.exec(line)) !== null) {
			const symbolName = match[1];
			if (!symbols[symbolName]) {
				symbols[symbolName] = [];
			}
			if (!Array.isArray(symbols[symbolName])) {
				symbols[symbolName] = [];
			}
			const position = new vscode.Position(i, match.index);
			symbols[symbolName].push(new vscode.Location(file, position));
		}
	}

	return Array.isArray(symbols[word]) ? symbols[word] : [];
}

async function findDefinitionInFiles(files: vscode.Uri[], word: string): Promise<vscode.Location[]> {
	const maxConcurrent = 5;
	const results: vscode.Location[] = [];

	for (let i = 0; i < files.length; i += maxConcurrent) {
		const batch = files.slice(i, i + maxConcurrent);
		const batchResults = await Promise.all(batch.map(file => getFileSymbols(file, word)));
		results.push(...batchResults.flat());
	}

	return results;
}

// Get project root directory
function getProjectRoot(document: vscode.TextDocument): string | undefined {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) return undefined;

	// Find the workspace folder that contains this document
	const documentWorkspace = workspaceFolders.find(folder =>
		document.uri.fsPath.startsWith(folder.uri.fsPath)
	);

	return documentWorkspace?.uri.fsPath;
}

// Extract referenced files from script tag comments
async function getReferencedFiles(document: vscode.TextDocument): Promise<string[]> {
	const text = document.getText();
	const referencedFiles: string[] = [];
	const projectRoot = getProjectRoot(document);

	// Find all script tags
	const scriptTagRegex = /<script\b[^>]*>[\s\S]*?<\/script>/g;
	let scriptMatch;

	while ((scriptMatch = scriptTagRegex.exec(text)) !== null) {
		const scriptContent = scriptMatch[0];
		// Look for @reffile comments - now matches multiple occurrences in both block and line comments
		const refFileRegex = /(?:\/\*[\s\S]*?@reffile\s+([^\s\*\n]+)[\s\S]*?\*\/|\/\/\s*@reffile\s+([^\s\n]+))/g;
		let refMatch;

		while ((refMatch = refFileRegex.exec(scriptContent)) !== null) {
			const filePath = refMatch[1] || refMatch[2];
			if (filePath) {
				let absolutePath: string;

				if (filePath.startsWith('/')) {
					// If path starts with /, resolve from project root
					if (projectRoot) {
						absolutePath = path.resolve(projectRoot, filePath.slice(1));
					} else {
						console.warn('Project root not found, skipping absolute path:', filePath);
						continue;
					}
				} else {
					// Relative path - resolve from document location
					const documentDir = path.dirname(document.uri.fsPath);
					absolutePath = path.resolve(documentDir, filePath);
				}

				// Add file if not already included
				if (!referencedFiles.includes(absolutePath)) {
					referencedFiles.push(absolutePath);
					console.log('Added reference file:', absolutePath);
				}
			}
		}

		// Also look for multiple @reffile declarations in multiline block comments
		const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
		let blockMatch;
		
		while ((blockMatch = blockCommentRegex.exec(scriptContent)) !== null) {
			const commentContent = blockMatch[0];
			const multiRefRegex = /@reffile\s+([^\s\*\n]+)/g;
			let multiMatch;

			while ((multiMatch = multiRefRegex.exec(commentContent)) !== null) {
				const filePath = multiMatch[1];
				if (filePath) {
					let absolutePath: string;

					if (filePath.startsWith('/')) {
						// If path starts with /, resolve from project root
						if (projectRoot) {
							absolutePath = path.resolve(projectRoot, filePath.slice(1));
						} else {
							console.warn('Project root not found, skipping absolute path:', filePath);
							continue;
						}
					} else {
						// Relative path - resolve from document location
						const documentDir = path.dirname(document.uri.fsPath);
						absolutePath = path.resolve(documentDir, filePath);
					}

					// Add file if not already included
					if (!referencedFiles.includes(absolutePath)) {
						referencedFiles.push(absolutePath);
						console.log('Added reference file:', absolutePath);
					}
				}
			}
		}
	}

	return referencedFiles;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "script-tag-is-javascript" is now active!');

	const jsLanguageConfig: vscode.LanguageConfiguration = {
		wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
		comments: {
			lineComment: '//',
			blockComment: ['/*', '*/'] as [string, string]
		},
		brackets: [
			['{', '}'],
			['[', ']'],
			['(', ')']
		] as [string, string][],
		onEnterRules: [
			{
				beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
				afterText: /^\s*\*\/$/,
				action: { indentAction: vscode.IndentAction.IndentOutdent, appendText: ' * ' }
			}
		]
	};

	vscode.languages.setLanguageConfiguration('javascript', jsLanguageConfig);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ scheme: 'file', language: 'php' },
			{
				async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
					if (!isInScriptTag(document, position)) {
						return undefined;
					}

					const linePrefix = document.lineAt(position).text.substr(0, position.character);
					const wordMatch = linePrefix.match(/(\w+)\.$/);

					if (!wordMatch) {
						return undefined;
					}

					const objectName = wordMatch[1];
					const completionItems: vscode.CompletionItem[] = [];
					const files = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**');

					for (const file of files) {
						const doc = await vscode.workspace.openTextDocument(file);
						const content = doc.getText();

						// 객체의 메소드를 찾기 위한 정규식 패턴 개선
						const methodRegex = new RegExp(`${objectName}\\.(\\w+)\\s*=\\s*function|${objectName}\\.(\\w+)\\s*:\\s*function|${objectName}\\.(\\w+)\\s*=\\s*\\(`, 'g');
						let match;

						while ((match = methodRegex.exec(content)) !== null) {
							const methodName = match[1] || match[2] || match[3];
							const item = new vscode.CompletionItem(methodName, vscode.CompletionItemKind.Method);
							item.detail = `${objectName}.${methodName}()`;
							item.insertText = new vscode.SnippetString(`${methodName}()`);
							completionItems.push(item);
						}
					}

					return completionItems;
				}
			}
		)
	);

	const jsConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('javascript');
	jsConfig.update('referencesCodeLens.enabled', true);

	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			[
				{ scheme: 'file', language: 'php' },
				{ scheme: 'file', pattern: '**/*.js' },
				{ scheme: 'file', pattern: '**/*.js.php' }
			],
			{
				async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
					console.log('provideDefinition test #1');
					if (document.languageId === 'php' && !isInScriptTag(document, position)) {
						return null;
					}
					console.log('provideDefinition test #2');

					const word = document.getText(document.getWordRangeAtPosition(position));
					if (!word) return null;
					console.log('provideDefinition test #3');

					// Get referenced files from script tag comments
					const referencedFiles = await getReferencedFiles(document);
					if (referencedFiles.length === 0) return null;
					console.log('provideDefinition test #4');

					// Convert file paths to vscode.Uri
					const files = referencedFiles.map(file => vscode.Uri.file(file));
					console.log('files', files);


					return findDefinitionInFiles(files, word);
				}
			}
		)
	);
}

function isInScriptTag(document: vscode.TextDocument, position: vscode.Position): boolean {
	const text = document.getText();
	const offset = document.offsetAt(position);

	const scriptTagRegex = /<script\b[^>]*>[\s\S]*?<\/script>/g;
	let match;

	while ((match = scriptTagRegex.exec(text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;

		if (offset >= start && offset <= end) {
			return true;
		}
	}

	return false;
}

export function deactivate() {}
