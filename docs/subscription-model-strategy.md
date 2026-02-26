# VRChat Albums サブスクリプションモデル戦略

## エグゼクティブサマリー

VRChat Albums を月額課金型のフリーミアムモデルに移行する戦略提案。
現在の完全無料アプリに対し、**コア機能は無料のまま**、プレミアム機能を段階的に追加して収益化を目指す。

**推奨モデル**: フリーミアム + 月額/年額サブスクリプション
**推奨価格帯**: 月額 ¥300〜500 / 年額 ¥3,000〜5,000
**決済基盤**: Polar.sh（最安MoR）or LemonSqueezy（ライセンスキー管理内蔵）

---

## 1. 市場分析

### 1.1 VRChat エコシステムの課金状況

| サービス/商品 | 価格帯 | 備考 |
|-------------|--------|------|
| VRChat Plus (VRC+) | 月額 $9.99 / 年額 $99.99 | アバタースロット、カスタムアイコン等 |
| BOOTH アバター（既製品） | ¥1,500〜¥9,000 | 人気帯は ¥3,000〜¥6,000 |
| BOOTH アバター改変 | ¥5,000〜¥50,000 | カスタム度合いで変動 |
| VRCX | 完全無料（OSS） | 友達管理・ログビューア。課金なし |
| VRChat Creator Economy | アバター最低1,200 Credits〜 | 2025年5月ローンチの公式マーケットプレイス |

**ポイント**: VRChat ユーザーはアバターや関連アセットに年間 ¥50,000+ を支出する層が40%存在。ツール類（VRCX等）は無料が標準だが、**独自価値があれば課金の余地あり**。VRChat 自体もクリエイターエコノミーに注力し始めており、エコシステム全体で課金への抵抗感は低下傾向にある。

### 1.2 VRChat ユーザー層

- **主要年齢層**: 18〜24歳
- **性別比**: 男性 73% / 女性 27%
- **日本市場シェア**: 急成長中（2023年 12.9% → 2025年 27.5%）
- **アクティブ同時接続**: 平均 43,000人、ピーク時 148,000+人
- **課金傾向**: VR ハードウェアに ¥500,000+ 投資するユーザーが40%。コンテンツへの課金抵抗は低い

### 1.3 写真管理アプリの課金事例

| アプリ | モデル | 価格帯 | 特徴 |
|--------|--------|--------|------|
| Adobe Lightroom | サブスク | 月額 $9.99〜$19.99 | AI編集、クラウド同期 |
| Google Photos | フリーミアム | 無料(15GB) / 月額 $1.99〜 | ストレージ課金 |
| Obsidian | フリーミアム | 無料 / Sync $4〜5/月 / Publish $8〜10/月 | コア無料、同期・公開が有料 |
| Notion | フリーミアム | 無料 / Plus $8/月 | ブロック数制限→無制限 |

### 1.4 デスクトップアプリの課金モデル比較

| パターン | 代表例 | メリット | デメリット |
|---------|--------|---------|----------|
| **フリーミアム** | Obsidian, Notion | ユーザー獲得容易、口コミ拡散 | 低い転換率(2〜5%) |
| **買い切り** | Sublime Text | 一回の決済で完結 | 継続収益なし |
| **サブスク強制** | Adobe CC | 安定した収益 | ユーザー抵抗大 |
| **ハイブリッド** | Figma | 柔軟な課金 | 設計が複雑 |

---

## 2. 現在の機能棚卸しと課金ポテンシャル

### 2.1 現在の機能（すべて無料）

| カテゴリ | 機能 | 完成度 |
|---------|------|--------|
| **写真表示** | Justified Layout ギャラリー、仮想スクロール | 90% |
| **ログ解析** | ワールド入退場、プレイヤー参加/退出の自動検出 | 95% |
| **自動分類** | 写真→ワールド自動関連付け | 90% |
| **サムネイル** | sharp による高速サムネイル生成・キャッシュ | 90% |
| **検索** | ワールド名・プレイヤー名検索 | 85% |
| **共有** | ワールド毎の写真共有ダイアログ | 80% |
| **設定** | パス設定、テーマ、言語、自動起動 | 90% |
| **データ管理** | インポート/エクスポート/バックアップ | 85% |

### 2.2 課金化のポテンシャル分析

**原則**: 既存の無料機能を有料化しない（ユーザー離反リスク大）。**新しい価値を追加して課金する**。

---

## 3. 推奨サブスクリプション戦略

### 3.1 プラン構成

```
┌──────────────────────────────────────────────────────────────┐
│                    VRChat Albums Free                         │
│  ・写真ギャラリー表示（無制限）                                │
│  ・ワールド自動分類                                           │
│  ・基本検索（ワールド名）                                     │
│  ・サムネイル生成                                             │
│  ・テーマ切替（Light/Dark）                                   │
│  ・データインポート/エクスポート                               │
├──────────────────────────────────────────────────────────────┤
│                VRChat Albums Pro（月額¥400 / 年額¥4,000）     │
│  ・高度な検索・フィルタリング                                 │
│  ・統計ダッシュボード                                         │
│  ・写真の一括エクスポート                                     │
│  ・カスタムタグ・お気に入り                                   │
│  ・高解像度サムネイル                                         │
│  ・優先サポート                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Free 層（現行機能を維持）

既存ユーザーへの約束として、**現在提供している機能は永続的に無料**。

### 3.3 Pro 層で追加する機能候補（優先度順）

#### Tier A: 実装コスト低・価値高（MVP として優先）

| 機能 | 概要 | 実装見積 | ユーザー価値 |
|------|------|---------|------------|
| **統計ダッシュボード** | 月別写真枚数推移、よく訪れるワールドTOP10、一緒に遊んだフレンドランキング、総プレイ時間 | 中 | 高 |
| **高度な検索・フィルタ** | 日付範囲、プレイヤー名複合検索、ワールドカテゴリ、同時プレイヤー数でフィルタ | 中 | 高 |
| **カスタムタグ** | 写真への手動タグ付け、タグによるフィルタリング | 低〜中 | 中 |
| **お気に入り管理** | 写真のお気に入り登録、お気に入り一覧表示 | 低 | 中 |

#### Tier B: 実装コスト中・独自価値

| 機能 | 概要 | 実装見積 | ユーザー価値 |
|------|------|---------|------------|
| **タイムライン表示** | 時系列での写真＋イベント（ワールド移動、フレンド合流）の統合表示 | 中〜高 | 高 |
| **写真の一括エクスポート** | ワールド/日付/タグ単位で一括ダウンロード。ZIP圧縮、メタデータCSV付き | 中 | 中 |
| **スライドショー** | ワールド毎・日付毎の写真スライドショー。BGM対応 | 中 | 中 |
| **高解像度サムネイル** | Free: 256px / Pro: 512px〜1024px でより高品質なプレビュー | 低 | 中 |

#### Tier C: 実装コスト高・差別化要因

| 機能 | 概要 | 実装見積 | ユーザー価値 |
|------|------|---------|------------|
| **クラウド同期** | 複数PC間での写真メタデータ・タグの同期 | 高 | 高 |
| **共有アルバム** | URL共有でフレンドにアルバムを公開 | 高 | 高 |
| **AI 自動タグ付け** | 写真内容のAI解析によるシーン分類（集合写真、風景、ミラー写真等） | 高 | 高 |
| **VRChat API 連携強化** | フレンドのオンライン状態表示、ワールド詳細情報（訪問者数等） | 中 | 中 |

---

## 4. 推奨ロードマップ

### Phase 1: 基盤構築（1〜2ヶ月）

```
目標: 課金インフラの構築と最小限のPro機能リリース

1. LemonSqueezy アカウント設定・ストア構築
2. ライセンスキー検証モジュールの実装（Electron Main Process）
3. Pro/Free のフィーチャーフラグシステム構築
4. 統計ダッシュボード（MVP）の実装
5. お気に入り機能の実装
```

### Phase 2: コア Pro 機能（2〜3ヶ月）

```
目標: Pro の価値を明確にする機能群のリリース

1. 高度な検索・フィルタリング
2. カスタムタグシステム
3. タイムライン表示
4. 高解像度サムネイルオプション
```

### Phase 3: 差別化機能（3〜6ヶ月）

```
目標: 他ツールとの差別化、高い継続率の実現

1. 写真の一括エクスポート（メタデータ付き）
2. スライドショー機能
3. 共有アルバム（Web公開）
4. クラウド同期（オプション）
```

---

## 5. 技術実装方針

### 5.1 決済プラットフォーム比較

| 観点 | Polar.sh | LemonSqueezy | Paddle | Stripe |
|------|---------|-------------|--------|--------|
| ライセンスキー管理 | 自動配信対応 | ネイティブ対応 | レガシーSDK（非推奨） | なし（別途Keygen等が必要） |
| MoR（税務代行） | 対応 | 対応 | 対応 | 非対応（自身で対応） |
| 手数料 | **4% + $0.40** | 5% + $0.50 | 5% + $0.50 | 2.9% + $0.30（+税務コスト） |
| 個人開発者向け | 最適（OSS向け） | 最適 | 中〜大規模向け | 汎用 |
| ノーコードストア | あり | あり | あり | なし |
| 日本円対応 | 対応 | 対応 | 対応 | 対応 |
| 備考 | OSS開発者向け設計、最安MoR | Stripe が2024年に買収（将来性注意） | デスクトップ実績豊富 | 柔軟だが税務自己管理 |

**推奨**: **Polar.sh**（最安手数料 + MoR + OSS フレンドリー）
**代替**: LemonSqueezy（ライセンスキー管理のドキュメントが充実）

### 5.2 ライセンスキー管理の選択肢

| サービス | 特徴 | Electron対応 | 備考 |
|---------|------|-------------|------|
| **Keygen** | API ベース、オフライン対応、パーペチュアルフォールバック | 公式サンプルあり | Polar/LemonSqueezy と連携可 |
| **Cryptlex** | デバイスフィンガープリント、フローティングライセンス | SDK提供 | エンタープライズ寄り |
| **Keyforge** | Stripe/LemonSqueezy/Polar連携 | ドキュメントあり | 新興サービス |
| **決済PF内蔵** | LemonSqueezy/Polarのネイティブ機能 | API経由 | 追加コストなし |

**推奨**: まずは決済プラットフォーム内蔵のライセンスキー機能で開始し、要件が複雑化したら Keygen に移行。

### 5.3 Electron アプリ内ライセンス検証フロー

```
┌─────────────────────────────────────────────────┐
│ ユーザーが Pro を購入                             │
│ (LemonSqueezy checkout → ライセンスキー発行)     │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│ Electron アプリでライセンスキーを入力             │
│ (Settings Modal → License タブ)                  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│ Main Process: LemonSqueezy API でキー検証         │
│ POST /v1/licenses/validate                       │
│ → 有効: Pro 機能アンロック                        │
│ → 無効/期限切れ: Free にフォールバック            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│ ライセンス状態を settingStore に保存              │
│ → アプリ起動時に再検証（オフライン猶予: 7日）     │
└─────────────────────────────────────────────────┘
```

### 5.3 フィーチャーフラグ設計

```typescript
// electron/module/license/types.ts
type LicenseTier = 'free' | 'pro';

type FeatureFlag = {
  advancedSearch: boolean;
  statistics: boolean;
  customTags: boolean;
  favorites: boolean;
  highResThumbnails: boolean;
  batchExport: boolean;
  slideshow: boolean;
  cloudSync: boolean;
  sharedAlbums: boolean;
};

// tier → features のマッピング
const TIER_FEATURES: Record<LicenseTier, FeatureFlag> = {
  free: {
    advancedSearch: false,
    statistics: false,
    customTags: false,
    favorites: false,
    highResThumbnails: false,
    batchExport: false,
    slideshow: false,
    cloudSync: false,
    sharedAlbums: false,
  },
  pro: {
    advancedSearch: true,
    statistics: true,
    customTags: true,
    favorites: true,
    highResThumbnails: true,
    batchExport: true,
    slideshow: true,
    cloudSync: true,
    sharedAlbums: true,
  },
};
```

### 5.4 tRPC 統合

```typescript
// electron/module/license/router.ts
const licenseRouter = router({
  getLicenseStatus: procedure.query(() => {
    return licenseService.getCurrentLicenseStatus();
  }),
  activateLicense: procedure
    .input(z.object({ key: z.string() }))
    .mutation(({ input }) => {
      return licenseService.activate(input.key);
    }),
  deactivateLicense: procedure.mutation(() => {
    return licenseService.deactivate();
  }),
  getFeatureFlags: procedure.query(() => {
    return licenseService.getFeatureFlags();
  }),
});
```

---

## 6. 価格設定の根拠

### 6.1 VRChat エコシステムでの位置づけ

```
VRC+ ($9.99/月) > VRChat Albums Pro (¥400/月) > 無料ツール群
```

**¥400/月（約$2.70）** は以下の理由から妥当:

1. **VRC+ の半額以下**: VRChat本体の課金よりも安く、心理的ハードルが低い
2. **BOOTH アバター1体分の月割り**: ¥5,000のアバター ≒ Pro 12ヶ月分
3. **Obsidian Sync と同価格帯**: 類似のローカルファースト+同期モデル
4. **日本のデジタルコンテンツ課金感覚**: ¥300〜500/月は「ワンコイン」圏内

### 6.2 収益シミュレーション

| シナリオ | 無料ユーザー | Pro 転換率 | 月額Pro | 月間収益 | 年間収益 |
|---------|------------|-----------|---------|---------|---------|
| 保守的 | 1,000人 | 3% | 30人 | ¥12,000 | ¥144,000 |
| 標準 | 3,000人 | 5% | 150人 | ¥60,000 | ¥720,000 |
| 楽観的 | 10,000人 | 7% | 700人 | ¥280,000 | ¥3,360,000 |

※ LemonSqueezy 手数料（約8%）控除前

---

## 7. リスクと対策

### 7.1 想定リスク

| リスク | 影響 | 対策 |
|--------|------|------|
| **ユーザー離反** | 課金導入でネガティブ反応 | 既存機能は絶対に有料化しない。新機能のみ課金 |
| **VRCX との比較** | 「VRCXは無料なのに」 | VRCXと機能領域が異なること（写真管理 vs 友達管理）を明確化 |
| **OSSコミュニティの反発** | GitHubで批判 | Pro機能部分のみクローズドソース。コア機能はOSS維持 |
| **低い転換率** | 収益目標未達 | まず統計ダッシュボードで「見たい」需要を喚起。段階的に機能追加 |
| **決済トラブル** | サポートコスト | LemonSqueezy のMoR機能で税務・返金を委任 |

### 7.2 コミュニティ対応戦略

1. **透明性**: 課金化の理由（開発の持続可能性）を率直に説明
2. **先行告知**: 実装前にDiscord/X(Twitter)で意見収集
3. **早期支援者特典**: 最初の100名は永続50%オフ（¥200/月）
4. **フィードバックループ**: Pro ユーザーからの機能リクエストを優先実装

---

## 8. 代替案の検討

### 8.1 採用しない案とその理由

| 案 | 不採用理由 |
|----|-----------|
| **広告モデル** | 写真閲覧体験を著しく損なう。デスクトップアプリとの相性も悪い |
| **買い切りモデル** | 継続的な開発資金が確保できない。機能追加のたびに新バージョン販売が必要 |
| **ストレージ課金** | 写真はローカル保存のため、ストレージ提供コストが高い割に差別化しにくい |
| **寄付モデル** | 持続可能な収益にならない（典型的に全ユーザーの1%未満） |
| **全機能サブスク強制** | 既存無料ユーザーの離反リスクが高すぎる |

### 8.2 将来的に検討可能な追加収益源

| モデル | 概要 | タイミング |
|--------|------|----------|
| **スポンサーシップ** | VRChat 関連企業からのスポンサー | ユーザー数 5,000+ |
| **API/SDK 提供** | 写真分類ロジックの外部提供 | 技術的成熟後 |
| **プレミアムテーマ** | 追加テーマパック（単品購入） | Pro導入後の追加収益 |

---

## 9. 成功指標（KPI）

| 指標 | Phase 1 目標 | Phase 2 目標 | Phase 3 目標 |
|------|------------|------------|------------|
| 無料ユーザー数 | 500 | 2,000 | 5,000 |
| Pro 転換率 | 2% | 5% | 7% |
| 月間解約率 (churn) | < 10% | < 8% | < 5% |
| NPS (推奨度) | 30+ | 40+ | 50+ |
| 月間アクティブ率 | 40% | 50% | 60% |

---

## 10. 最初の一歩（推奨アクション）

1. **LemonSqueezy アカウント作成**とテスト環境構築
2. **`electron/module/license/`** モジュールの設計・実装
3. **統計ダッシュボード**のプロトタイプ作成（最も「見たい」需要が高い）
4. **コミュニティへのヒアリング**（Discord / X / VRChat 内）
5. **ベータテスター募集**（Pro機能の先行体験）

---

## 参考リンク

### 決済・ライセンス
- [Polar.sh](https://polar.sh) - OSS開発者向け最安MoRプラットフォーム
- [Polar.sh Pricing](https://polar.sh/resources/pricing) - 4% + $0.40
- [LemonSqueezy - ライセンスキー管理](https://docs.lemonsqueezy.com/help/licensing/generating-license-keys)
- [LemonSqueezy - ライセンスキー検証ガイド](https://docs.lemonsqueezy.com/guides/tutorials/license-keys)
- [Keygen for Electron Apps](https://keygen.sh/for-electron-apps/) - Electron向けライセンス管理
- [Paddle vs LemonSqueezy 比較](https://www.paddle.com/compare/lemon-squeezy)

### VRChat エコシステム
- [VRChat Plus FAQ](https://hello.vrchat.com/vrchat-plus-faq)
- [VRChat Creator Economy](https://creators.vrchat.com/economy/) - 公式クリエイターエコノミー
- [VRChat Avatar Marketplace](https://hello.vrchat.com/avatar-marketplace) - 2025年5月ローンチ
- [VRChat メタバース人口動態レポート 2026](https://vchavcha.com/en/virtual-news/vrchat-metaverse-demographics-report-2026/)
- [日本が VRChat 公式サイト訪問数で世界1位](https://www.moguravr.com/vrchat-japan-visitor-market-share-2025-en/)
- [VRChat: The Metaverse That's Actually Growing](https://vrdb.app/blog/vrchat-metaverse-growing-japan-2026-v2)
- [VRCX (GitHub)](https://github.com/vrcx-team/VRCX) - 無料の競合ツール参考

### 課金モデル参考
- [Obsidian Pricing](https://obsidian.md/pricing)
- [Obsidian Pricing Guide](https://www.eesel.ai/blog/obsidian-pricing) - 詳細分析
- [RevenueCat - State of Subscription Apps 2025](https://www.revenuecat.com/state-of-subscription-apps-2025/)
- [Freemium vs Subscription Model](https://dev.to/paywallpro/freemium-vs-subscription-model-which-is-better-for-app-revenue-4kc0)

### 写真管理アプリ
- [Adobe Photography Pricing Updates 2025](https://blog.adobe.com/en/publish/2024/12/15/all-new-photography-innovations-pricing-updates)
- [Adobe Lightroom Plans](https://www.adobe.com/products/photoshop-lightroom/plans.html)
