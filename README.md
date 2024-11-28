# Script Tag Is Javascript

VSCode extension that enables JavaScript/TypeScript features inside PHP script tags.
PHP script 태그 내의 JavaScript/TypeScript 기능을 활성화하는 VSCode 확장 프로그램입니다.

## Features (기능)

- PHP 파일의 `<script>` 태그 내 JavaScript/TypeScript 코드 자동 인식
  Automatically recognizes JavaScript/TypeScript code inside `<script>` tags in PHP files
- JavaScript/TypeScript 코드의 구문 강조 지원
  Provides syntax highlighting for JavaScript/TypeScript code
- 인라인 및 외부 스크립트 태그 지원
  Supports both inline and external script tags
- 실시간 편집 업데이트 지원
  Updates in real-time as you edit your PHP files

### Go to Definition in Referenced JavaScript Files (참조된 JavaScript 파일에서 정의로 이동)

This extension allows you to navigate to JavaScript definitions across files by using the `@reffile` directive in your script tag comments.
이 확장 프로그램은 script 태그 주석에 `@reffile` 지시어를 사용하여 파일 간 JavaScript 정의를 탐색할 수 있게 해줍니다.

#### How to Use (사용 방법)

1. In your PHP file, add `@reffile` comments in your script tags to specify which JavaScript files to search for definitions:
1. PHP 파일의 script 태그 안에 `@reffile` 주석을 추가하여 정의를 검색할 JavaScript 파일을 지정합니다:

```html
<script>
/* @reffile /js/utils.js */
// Your JavaScript code here
utils.someFunction();
</script>
```

You can reference multiple files in several ways:
여러 파일을 다음과 같은 방식으로 참조할 수 있습니다:

```html
<script>
/* @reffile /js/utils.js
   @reffile /js/helpers.js
   @reffile ../common/shared.js */

// Or use separate comments
// 또는 개별 주석 사용
// @reffile /js/another.js
</script>
```

#### Path Resolution (경로 해석)

- Paths starting with `/` are resolved from your project root
- `/`로 시작하는 경로는 프로젝트 루트에서 해석됩니다
- Relative paths (e.g., `../js/utils.js`) are resolved relative to the current file
- 상대 경로(예: `../js/utils.js`)는 현재 파일을 기준으로 해석됩니다
- Multiple `@reffile` declarations are supported within the same script tag
- 동일한 script 태그 내에서 여러 `@reffile` 선언이 지원됩니다

#### Usage Example (사용 예시)

1. Add `@reffile` comments in your script tags:
1. script 태그에 `@reffile` 주석을 추가합니다:
```html
<script>
/* @reffile /js/utils.js */
myFunction(); // This function is defined in utils.js
</script>
```

2. Hold Ctrl (Cmd on macOS) and click on any function or variable name
2. Ctrl (macOS의 경우 Cmd)을 누른 상태에서 함수나 변수 이름을 클릭합니다
3. If the definition exists in the referenced JavaScript files, you'll be taken directly to it
3. 참조된 JavaScript 파일에 정의가 있으면 해당 위치로 바로 이동합니다

## Basic Usage (기본 사용법)

1. Install the extension (확장 프로그램 설치)
2. Open a PHP file containing `<script>` tags (script 태그가 포함된 PHP 파일 열기)
3. JavaScript/TypeScript code inside script tags will be automatically recognized (script 태그 내의 JavaScript/TypeScript 코드가 자동으로 인식됨)

To manually trigger JavaScript recognition (수동으로 JavaScript 인식을 실행하려면):
- Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
- Type "Recognize JavaScript in PHP Script Tags"
- Press Enter

## Requirements (요구 사항)

- VSCode version 1.93.1 or higher
- VSCode 버전 1.93.1 이상

## Release Notes (릴리스 노트)

### 0.0.7
- Added support for multiple `@reffile` declarations (여러 `@reffile` 선언 지원 추가)
- Improved path resolution for both absolute and relative paths (절대 경로와 상대 경로에 대한 경로 해석 개선)
- Enhanced definition search in referenced JavaScript files (참조된 JavaScript 파일에서의 정의 검색 기능 향상)

## License (라이선스)

This extension is licensed under the MIT License.
이 확장 프로그램은 MIT 라이선스를 따릅니다.
