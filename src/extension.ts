import * as vscode from 'vscode';

// 파일 내용 캐시를 위한 Map
const fileCache = new Map<string, {
	content: string;
	symbols: { [key: string]: vscode.Location[] };
	lastModified: number;
}>();

// 캐시 확인 및 업데이트 함수
async function getFileSymbols(file: vscode.Uri, word: string): Promise<vscode.Location[]> {
	const stat = await vscode.workspace.fs.stat(file);
	const cachedData = fileCache.get(file.fsPath);

	if (cachedData && cachedData.lastModified === stat.mtime) {
		return cachedData.symbols[word] || [];
	}

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
			const position = new vscode.Position(i, match.index);
			symbols[symbolName].push(new vscode.Location(file, position));
		}
	}

	fileCache.set(file.fsPath, {
		content,
		symbols,
		lastModified: stat.mtime
	});

	return symbols[word] || [];
}

async function findDefinitionInFiles(files: vscode.Uri[], word: string): Promise<vscode.Location[]> {
	const maxConcurrent = 5;
	const results: vscode.Location[] = [];

	for (let i = 0; i < files.length; i += maxConcurrent) {
		const batch = files.slice(i, i + maxConcurrent);
		const batchResults = await Promise.all(batch.map(file => getFileSymbols(file, word)));
		results.push(...batchResults.flat());

		// 정의를 찾았다면 나머지 파일은 검색하지 않음
		if (results.length > 0) {
			break;
		}
	}

	return results;
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
						const stat = await vscode.workspace.fs.stat(file);
						const cachedData = fileCache.get(file.fsPath);

						let content: string;
						if (cachedData && cachedData.lastModified === stat.mtime) {
							content = cachedData.content;
						} else {
							const doc = await vscode.workspace.openTextDocument(file);
							content = doc.getText();
							fileCache.set(file.fsPath, {
								content,
								symbols: {},
								lastModified: stat.mtime
							});
						}

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
				{ scheme: 'file', pattern: '**/*.js.*' }
			],
			{
				async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
					if (document.languageId === 'php' && !isInScriptTag(document, position)) {
						return null;
					}

					const word = document.getText(document.getWordRangeAtPosition(position));
					if (!word) return null;

					// 1. 먼저 현재 열린 문서들에서 검색
					const openTextDocuments = vscode.workspace.textDocuments
						.filter(doc => doc.uri.scheme === 'file' &&
							(doc.languageId === 'javascript' || doc.fileName.endsWith('.js')));

					const openDocResults = await findDefinitionInFiles(
						openTextDocuments.map(doc => doc.uri),
						word
					);

					if (openDocResults.length > 0) {
						return openDocResults;
					}

					// 2. 열린 문서에서 찾지 못한 경우 워크스페이스 검색
					const files = await vscode.workspace.findFiles(
						'{**/*.js,**/*.js.*}',
						'{**/node_modules/**,**/dist/**,**/build/**}',
						100 // 검색할 최대 파일 수 제한
					);

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
