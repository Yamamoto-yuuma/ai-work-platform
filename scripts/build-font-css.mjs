/**
 * app/fonts.css と public/fonts/mplus-rounded/ を作り直す。
 *
 * 同梱している M PLUS Rounded 1c（SIL Open Font License 1.1）を
 * 別のバージョンに入れ替えるときだけ使う。ふだんの開発では動かさない。
 *
 *   node scripts/build-font-css.mjs
 *
 * Google Fonts の CSS を取り、参照している woff2 をすべて落として
 * public/ に置き、同じ unicode-range を持つ @font-face を書き出す。
 * 読み込み時に外部へ出ないよう、url は自分のところだけを指す。
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const FAMILY = "M PLUS Rounded 1c";
/** 400 と 700 だけ持つ。500 は 400 で表示される */
const WEIGHTS = [400, 700];
const OUT_DIR = "public/fonts/mplus-rounded";
const OUT_CSS = "app/fonts.css";
// woff2 の URL は、ブラウザの User-Agent で出し分けられる
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const src =
  `https://fonts.googleapis.com/css2?family=${FAMILY.replaceAll(" ", "+")}` +
  `:wght@${WEIGHTS.join(";")}&display=swap`;

const css = await (await fetch(src, { headers: { "User-Agent": UA } })).text();
const faces = [...css.matchAll(/@font-face \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
if (faces.length === 0) throw new Error("@font-face を読み取れませんでした");

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const header = `/*
 * M PLUS Rounded 1c（SIL Open Font License 1.1）の読み込み。
 *
 * 外部へは読みに行かず、public/fonts に置いたものだけを使う（Phase 13）。
 * Google Fonts から読む形も試したが、回線の状態で描画が止まり、
 * 同じ検証が 1分20秒から 6分40秒まで伸びた。毎日開くものに、
 * 外側の都合で止まる要素は置かない。
 *
 * unicode-range で字ごとに分けてあるので、ブラウザは画面に出る字の分
 * だけを読む。全体では 3.8MB あるが、1画面あたりは数十KB で済む。
 *
 * 太さは 400 と 700 の2種類。500（font-medium）は 400 で表示される。
 *
 * このファイルは scripts/build-font-css.mjs が作る。手で書き換えない。
 */
`;

const seq = new Map();
const rules = [];
for (const face of faces) {
  const weight = /font-weight: (\d+)/.exec(face)?.[1];
  const url = /url\((https[^)]+)\)/.exec(face)?.[1];
  const range = /unicode-range: ([^;]+);/.exec(face)?.[1];
  if (!weight || !url || !range) continue;

  const i = seq.get(weight) ?? 0;
  seq.set(weight, i + 1);
  const name = `mplus-${weight}-${String(i).padStart(3, "0")}.woff2`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} を取得できません: ${res.status}`);
  await writeFile(join(OUT_DIR, name), Buffer.from(await res.arrayBuffer()));

  rules.push(
    `@font-face {\n` +
    `  font-family: "${FAMILY}";\n` +
    `  font-style: normal;\n` +
    `  font-weight: ${weight};\n` +
    `  font-display: swap;\n` +
    `  src: url("/fonts/mplus-rounded/${name}") format("woff2");\n` +
    `  unicode-range: ${range};\n}`,
  );
}

await writeFile(OUT_CSS, header + rules.join("\n") + "\n");
console.log(`✓ ${rules.length} 件を ${OUT_DIR} に置き、${OUT_CSS} を書き出しました`);
