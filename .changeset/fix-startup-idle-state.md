---
'vrchat-albums': patch
---

fix: 初期化前にPhotoGalleryが表示される問題を修正

- Contents コンポーネントが idle 状態で PhotoGallery をレンダリングし、
  DB未作成の段階でクエリが発火する問題を修正
- tRPC subscription 未接続時に初期化が永久に開始されない問題を
  3秒タイムアウトフォールバックで修正
