---
'vrchat-albums': patch
---

セキュリティ強化: Dependabot で報告された脆弱性を解消する依存関係アップデート

- vite: `^8.0.3` → `^8.0.5` (root) / `^7.1.11` → `^7.3.2` (pages)
  - GHSA-v2wj-q39q-566r (server.fs.deny bypass)
  - GHSA-p9ff-h696-f583 (WebSocket arbitrary file read)
  - GHSA-4w7w-66w2-5vf9 (Optimized Deps `.map` path traversal)
- postcss: `8.5.6` → `8.5.10` (GHSA-qx2v-qp2m-jg93 XSS)
- pnpm.overrides 追加:
  - `@xmldom/xmldom: ">=0.8.13"` (GHSA-2v35-w6hq-6mfw / GHSA-f6ww-3ggp-fr8h / GHSA-x6wf-f3px-wcqx / GHSA-j759-j44w-7fr8)
  - `@tootallnate/once: ">=3.0.1"` (GHSA-vpq2-c234-7xj6)
