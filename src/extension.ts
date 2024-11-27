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

	// 변수 선언과 객체 선언을 모두 찾는 정규식
	const symbolRegex = /(?:const|let|var)?\s*(\w+)\s*=\s*[{]|(\w+)\s*[=:](?:\s*function)?\s*[({]/g;
	let match;

	while ((match = symbolRegex.exec(content)) !== null) {
		const symbolName = match[1] || match[2];
		if (!symbols[symbolName]) {
			symbols[symbolName] = [];
		}
		symbols[symbolName].push(new vscode.Location(file, doc.positionAt(match.index)));
	}

	fileCache.set(file.fsPath, {
		content,
		symbols,
		lastModified: stat.mtime
	});

	return symbols[word] || [];
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
			{ scheme: 'file', language: 'php' },
			{
				async provideDefinition(document: vscode.TextDocument, position: vscode.Position) {
					if (!isInScriptTag(document, position)) {
						return null;
					}

					const word = document.getText(document.getWordRangeAtPosition(position));
					const files = await vscode.workspace.findFiles('**/*.js', '**/node_modules/**');

					const locations = (await Promise.all(
						files.map(file => getFileSymbols(file, word))
					)).flat();

					return locations;
				}
			}
		)
	);

	// 참조 제공자 등록
	context.subscriptions.push(
		vscode.languages.registerReferenceProvider(
			{ scheme: 'file', pattern: '**/*.{js,php}' },
			{
				async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext) {
					const wordRange = document.getWordRangeAtPosition(position);
					if (!wordRange) {
						return [];
					}

					const word = document.getText(wordRange);
					const references: vscode.Location[] = [];
					const files = await vscode.workspace.findFiles('**/*.php', '**/node_modules/**');
					const processedLocations = new Set<string>();

					const currentLocationKey = `${document.uri.fsPath}:${position.line}:${position.character}`;
					processedLocations.add(currentLocationKey);

					for (const file of files) {
						try {
							const doc = await vscode.workspace.openTextDocument(file);
							const content = doc.getText();
							const scriptTagRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
							let match;

							while ((match = scriptTagRegex.exec(content)) !== null) {
								const scriptContent = match[1];
								const scriptStart = doc.positionAt(match.index + match[0].indexOf(match[1]));
								const scriptEnd = doc.positionAt(match.index + match[0].indexOf(match[1]) + match[1].length);

								const refRegex = new RegExp(`(?<!['"\`])\\b${word}(?=\\.\\w+|\\s*\\()`, 'g');
								let refMatch;

								while ((refMatch = refRegex.exec(scriptContent)) !== null) {
									const pos = doc.positionAt(match.index + match[0].indexOf(match[1]) + refMatch.index);
									const locationKey = `${file.fsPath}:${pos.line}:${pos.character}`;

									if (!processedLocations.has(locationKey) &&
										pos.isAfterOrEqual(scriptStart) &&
										pos.isBeforeOrEqual(scriptEnd)) {
										processedLocations.add(locationKey);
										references.push(new vscode.Location(file, pos));
									}
								}
							}
						} catch (error) {
							console.error(`Failed to process file: ${file}`, error);
						}
					}

					return references;
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
