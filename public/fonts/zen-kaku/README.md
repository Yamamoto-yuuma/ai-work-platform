# Zen Kaku Gothic New

本文書体として同梱している。SIL Open Font License 1.1（同ディレクトリの `OFL.txt`）。

## 中身

`zen-<太さ>-<通し番号>.woff2`。太さは 400 と 700 の2種類で、
分け方は `app/fonts.css` の `unicode-range` に書いてある。
ブラウザは画面に実際に出る字の分だけを読む。

500（Tailwind の `font-medium`）は同梱していない。400 で表示される。

## 入れ替えるとき

手で置き換えず、生成し直す。

    node scripts/build-font-css.mjs

このディレクトリと `app/fonts.css` の両方が作り直される。
