# M PLUS Rounded 1c

本文書体として同梱している。SIL Open Font License 1.1（同ディレクトリの `OFL.txt`）。
Copyright 2021 The M+ FONTS Project Authors — https://github.com/coz-m/MPLUS_FONTS

## 中身

`mplus-<太さ>-<通し番号>.woff2` が 252 件。太さは 400 と 700 の2種類で、
それぞれ 126 個に分かれている。分け方は `app/fonts.css` の `unicode-range` に
書いてあり、ブラウザは画面に実際に出る字の分だけを読む。全部で 3.8MB あるが、
1画面あたりの読み込みは数十KB で済む。

500（Tailwind の `font-medium`）は同梱していない。400 で表示される。

## 入れ替えるとき

手で置き換えず、生成し直す。

    node scripts/build-font-css.mjs

このディレクトリと `app/fonts.css` の両方が作り直される。
