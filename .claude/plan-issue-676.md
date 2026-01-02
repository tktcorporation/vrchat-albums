# Issue #676 修正計画: usePhotoGallery の過剰呼び出し問題

## 問題の概要
`usePhotoGallery` フックが26回呼び出されている（期待値: 1回）

## 根本原因の分析

### 原因1: `useLoadingState` が毎回新しいオブジェクトを返す

```typescript
// src/v2/hooks/useLoadingState.ts
export const useLoadingState = (): UseLoadingStateResult => {
  // ...
  return {
    isLoadingStartupSync,
    isLoadingGrouping,
    // ... 毎回新しいオブジェクトを生成
  };
};
```

### 原因2: `App.tsx` の useEffect の依存配列に `loadingState` オブジェクト全体が含まれる

```typescript
// src/v2/App.tsx:311-317
useEffect(() => {
  if (stage === 'syncing') {
    loadingState.startLoadingStartupSync();
  } else {
    loadingState.finishLoadingStartupSync();
  }
}, [stage, loadingState]); // ← loadingState が毎回新しいため無限ループに近い状態
```

### 原因3: `PhotoGallery` へのスプレッド渡し

```typescript
// src/v2/App.tsx:544
return <PhotoGallery {...loadingState} />;
```

`loadingState` が毎回新しいオブジェクトなので、`memo` でラップされた `PhotoGallery` が再レンダリングされる。

## 再レンダリングの連鎖

1. `useLoadingState` が新しいオブジェクトを返す
2. `useEffect` の依存配列に含まれる `loadingState` が変わる
3. `useEffect` が実行され、状態更新関数が呼ばれる
4. 状態更新により `Contents` が再レンダリングされる
5. 新しい `loadingState` オブジェクトが `PhotoGallery` に渡される
6. `PhotoGallery` が再レンダリングされる
7. `usePhotoGallery` が呼び出される
8. 1-7 が繰り返される

## 修正計画

### Step 1: `useLoadingState` の最適化
- 返り値オブジェクトを `useMemo` でメモ化
- 依存配列に必要な値のみを含める

### Step 2: `App.tsx` の `useEffect` 依存配列を修正
- `loadingState` オブジェクト全体ではなく、必要な関数のみを依存配列に含める

### Step 3: (オプション) `PhotoGallery` への渡し方を最適化
- 個別のプロップスとして渡すか、メモ化されたオブジェクトを使用

## 期待される効果
- `usePhotoGallery` の呼び出し回数が1-2回程度に削減
- 不要な再レンダリングの防止
- パフォーマンスの大幅な改善
