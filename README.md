# 必ず解けるマインスイーパー（HTML/CSS/JS）

論理的に確定できる手だけで解ける盤面を生成するマインスイーパーです。

## 特徴

- シード値で再現可能な盤面生成
- 生成時に「論理解法 + SAT風の矛盾検査」で可解性チェック
- 推測が必要になる盤面は再生成
- 右クリック旗、数字クリックの自動展開、0連鎖開放
- URLクエリで共有 (`?seed=...&w=...&h=...&m=...`)

## ローカル実行

`index.html` をブラウザで開くだけで動作します。

## special thanks
- [Minesweeper Orion Blog 必ず解けるマインスイーパー開発ブログ](https://minesweeper.kariya.cc/ja)
- [14種類のマインスイーパーバリエーション](https://store.steampowered.com/app/1865060/14/)
