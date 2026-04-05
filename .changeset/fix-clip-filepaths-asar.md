---
'vrchat-albums': patch
---

fix: clip-filepaths のプラットフォーム固有バイナリを asarUnpack に含める

electron-builder の asarUnpack パターンで clip-filepaths のプラットフォーム固有パッケージ
（clip-filepaths-win32-x64-msvc 等）が含まれていなかったため、Windows でアプリ起動時に
「Cannot find module 'clip-filepaths-win32-x64-msvc'」エラーが発生していた問題を修正。
