# IBM Plex Sans JP

かなと漢字の本文書体として同梱している。SIL Open Font License 1.1
（同ディレクトリの `OFL.txt`）。

英数字は同じ並びの先頭にある Inter が受け持つ（`public/fonts/inter/`）。
この書体にも英数字はあるが、`--font-sans` で Inter を先に置いているので
そちらが使われる。

## 中身

`plex-<太さ>-<通し番号>.woff2`。太さは 400 と 700 の2種類で、
分け方は `app/fonts.css` の `unicode-range` に書いてある。
ブラウザは画面に実際に出る字の分だけを読む。

500（Tailwind の `font-medium`）と 600（`font-semibold`）は同梱していない。
それぞれ 400 と 700 で表示される。

## 入れ替えるとき

手で置き換えず、生成し直す。

    node scripts/build-font-css.mjs

`public/fonts/` と `app/fonts.css` の両方が作り直される。
