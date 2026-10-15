# 写真グルーピングロジック

VRChat の写真を、撮影したときに居たワールドのセッション単位でまとめる仕組み。判定の実装は `shared/worldSession.ts` が持ち、このドキュメントはデータの出どころと、画面ごとの使い方の対応だけを書く。

## セッションの決め方

セッションは、時刻順に並べたワールド参加ログの隣り合う 2 件で区切る半開区間 `[join_i, join_{i+1})` とする。

- 最後のセッションは終わりを持たない
- 境界ちょうどの時刻は後ろのセッションに属し、許容誤差は持たない
- セッションの終わりは次のワールド参加ログだけで決まる。退出ログやプレイヤーの参加・退出ログは境界に使わない

退出ログを境界に使わないのは、VRChat のログでは退出が常に記録されるとは限らず、記録の有無でグループの切れ目が変わってしまうため。次の参加ログは必ず残るので、それを区切りにすれば欠落の影響を受けない。

型と関数（`WorldSession`、`buildWorldSessions`、`resolveSessionIndex`、`findSessionStartingAt`）の仕様は `shared/worldSession.ts` の JSDoc を参照する。

## 入力になる参加ログ

判定には、2 種類の参加ログを `mergeVRChatWorldJoinLogs`（`electron/module/vrchatWorldJoinLog/service.ts`）でマージしたものを渡す。

| 種類               | 出どころ                                                                                                                                 | 保存先                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 通常の参加ログ     | VRChat のログの `Joining wrld_` 行                                                                                                       | `electron/module/vrchatWorldJoinLog/VRChatWorldJoinLogModel/` |
| 写真由来の参加ログ | 写真のファイル名 `VRChat_YYYY-MM-DD_HH-mm-ss.SSS_wrld_<id>.<ext>`（`electron/module/vrchatLog/fileHandlers/photoLogImporter.ts` が抽出） | `electron/module/vrchatWorldJoinLogFromPhoto/`                |

写真由来の参加ログは、ログファイルが残っていない期間の写真をワールドへ結び付けるために使う。worldId と参加日時がどちらも一致する組は同じ参加とみなし、通常の参加ログの方を残す。

日時はすべてローカルタイムとして扱い、`Date.getTime()` の数値で比較する（`.claude/rules/project/timezone.md`）。

## 画面ごとの使い方

3 つの画面が同じ判定を使うので、同じ時刻の写真が画面によって別のワールドへ振り分けられることはない。

| 画面                     | 実装                                                                     | 判定の使い方                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ギャラリーのグループ分け | `src/v2/components/PhotoGallery/useGroupPhotos.ts`                       | 撮影時刻が属するセッションへ写真を入れる。最初の参加ログより前の写真は、最も古いセッションへ寄せて表示する                                                          |
| グループのプレイヤー一覧 | `getSessionInfoBatch`（`electron/module/logInfo/logInfoCointroller.ts`） | グループの開始日時で始まるセッションを `findSessionStartingAt` で引き、その区間 `[join, nextJoin)` に参加したプレイヤーを返す。開始日時に当たらない日時には空を返す |
| プレイヤー検索           | `searchSessionsByPlayerName`（`electron/module/logInfo/service.ts`）     | プレイヤーの参加時刻が属するセッションの開始日時を返す。最初の参加ログより前の参加は対象外                                                                          |

## テスト

| 対象                                                 | テスト                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| 判定そのもの（境界、同時刻の参加、線形探索との一致） | `shared/worldSession.test.ts`                                            |
| ギャラリーのグループ分け                             | `src/v2/components/PhotoGallery/__tests__/useGroupPhotos.test.ts`        |
| プレイヤー一覧の区間                                 | `electron/module/logInfo/sessionInfoBatch.integration.test.ts`           |
| プレイヤー検索                                       | `electron/module/logInfo/searchSessionsByPlayerName.integration.test.ts` |
| 参加ログのマージと重複除去                           | `electron/module/vrchatWorldJoinLog/mergeLogic.test.ts`                  |
