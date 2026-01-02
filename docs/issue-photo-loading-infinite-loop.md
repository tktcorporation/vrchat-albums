# Issue: 写真一覧の無限ロード問題

## タイトル

写真一覧の無限ロード問題: usePhotoGallery の重複呼び出しと再レンダリングループ

## 概要

写真数が多い場合にアプリ起動時に写真一覧が無限ロード状態になる問題。

## 発生条件

- 写真数が多い環境（数千枚以上）
- `fa50318` (ValidWidth型の導入) 以降のバージョン

## 症状

- アプリ起動後、写真一覧がローディング状態のまま表示されない
- UIが固まったように見える

## 原因

### 直接的なトリガー

`fa50318` で導入された `useContainerWidth` の状態マシンパターンにより、`measuring` → `ready` への状態遷移で GalleryContent の再レンダリングが確実に発生するようになった。

### 露呈した既存の設計問題

1. **`usePhotoGallery` が2箇所で呼ばれている**
   - `PhotoGallery.tsx:51` (デバウンス済みクエリ)
   - `GalleryContent.tsx:402` (生のクエリ)

2. **`useGroupPhotos` の `useMemo` に `onGroupingEnd` が依存配列に含まれている**
   ```typescript
   const groupedPhotos = useMemo(() => {
     // ...
     onGroupingEnd?.();  // 副作用
     return result;
   }, [photos, joinLogs, isLoadingLogs, onGroupingEnd]);  // ← onGroupingEnd
   ```
   親の再レンダリングで `onGroupingEnd` の参照が変わり、useMemo が再計算される。

3. **`groupPhotosBySession` が O(n×m) の計算量**
   - 写真n枚 × セッションm個 の線形探索
   - 複数回実行されると問題が深刻化

## 再現データ (Playwrightテスト)

```
usePhotoGallery call count: 8   ← 1回であるべきが8回
useGroupPhotos call count: 4    ← 1回であるべきが4回
```

## 因果関係

```
useContainerWidth: measuring → ready
    │
    ▼
GalleryContent 再レンダリング
    │
    ├─→ usePhotoGallery (GalleryContent内) 再実行
    │       │
    │       ▼
    │   useGroupPhotos の useMemo 再計算
    │   (onGroupingEnd の参照変化)
    │       │
    │       ▼
    │   groupPhotosBySession 再実行 (O(n×m))
    │       │
    │       ▼
    │   onGroupingEnd?.() 呼び出し
    │       │
    │       ▼
    │   再レンダリング → ループ
    │
    └─→ usePhotoGallery (PhotoGallery内) も並行実行
```

## 修正案

### 案1: `usePhotoGallery` の重複呼び出しを解消

`GalleryContent` での呼び出しを削除し、親の `PhotoGallery` から props で渡す。

### 案2: `useMemo` 内の副作用を `useEffect` に移動

```typescript
// Before
const groupedPhotos = useMemo(() => {
  // ...
  onGroupingEnd?.();
  return result;
}, [photos, joinLogs, isLoadingLogs, onGroupingEnd]);

// After
const groupedPhotos = useMemo(() => {
  // ...
  return result;
}, [photos, joinLogs, isLoadingLogs]);

useEffect(() => {
  if (Object.keys(groupedPhotos).length > 0) {
    onGroupingEnd?.();
  }
}, [groupedPhotos, onGroupingEnd]);
```

### 案3: `groupPhotosBySession` のアルゴリズム最適化

セッションを時刻でソートし、二分探索を使用して O(n log m) に改善。

## 関連コミット

- `fa50318` fix: ValidWidth 型で起動時のギャラリー幅 0 問題を根本修正 (#667)
- `be2f7ef` fix: useContainerWidth を Callback Ref パターンに変更 (#668)

## 調査ブランチ

`claude/fix-photo-loading-issue-ty8HZ` にデバッグログとPlaywrightテストを追加済み。

## ラベル

- bug
- performance
