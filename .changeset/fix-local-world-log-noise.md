---
'vrchat-albums': patch
---

ローカルワールドのログエラーノイズを修正

- ローカルワールド参加時（wrld_xxx:wrld_xxx 形式）の INVALID_INSTANCE_ID を Sentry エラーから warn に降格
- [Behaviour] OnPlayerJoinComplete と [Behaviour] RPC を既知ノイズパターンに追加し、未知パターン検出の誤報を抑制
