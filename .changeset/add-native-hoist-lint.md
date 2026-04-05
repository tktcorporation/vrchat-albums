---
'vrchat-albums': patch
---

feat: ネイティブモジュールの asarUnpack/hoist 整合性チェック lint を追加

napi-rs 系ネイティブモジュールの asarUnpack 入れ忘れや public-hoist-pattern の
設定漏れを CI で自動検知するスクリプトを追加。
