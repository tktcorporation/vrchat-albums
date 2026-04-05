---
'vrchat-albums': patch
---

fix: clip-filepaths のプラットフォーム固有パッケージを pnpm でホイストする

.npmrc の public-hoist-pattern に clip-filepaths のみが指定されており、
プラットフォーム固有パッケージ（clip-filepaths-win32-x64-msvc 等）がホイストされて
いなかった。pnpm の isolated モードではこれらが node_modules/.pnpm/ 内に配置される
ため、electron-builder の asarUnpack パターンに一致せず、asar 内に閉じ込められて
ランタイムで "Cannot find module" エラーが発生していた。
