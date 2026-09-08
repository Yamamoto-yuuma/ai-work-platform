# Inter

英数字の本文書体として同梱している。SIL Open Font License 1.1
（同ディレクトリの `OFL.txt`）。

かなと漢字はこの書体に無いので、次に並ぶ IBM Plex Sans JP が拾う
（`public/fonts/plex/`）。この画面は日付・件数・URL が多く、
そこだけ字面の締まった書体にすると全体が引き締まる。

## 中身

`inter-<太さ>-<通し番号>.woff2`。太さは 400 と 700 の2種類で、
分け方は `app/fonts.css` の `unicode-range` に書いてある。

## 入れ替えるとき

手で置き換えず、生成し直す。

    node scripts/build-font-css.mjs
