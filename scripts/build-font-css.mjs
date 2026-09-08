/**
 * app/fonts.css と public/fonts/ を作り直す。
 *
 * 書体を入れ替えるときだけ使う。ふだんの開発では動かさない。
 *
 *   node scripts/build-font-css.mjs
 *
 * Google Fonts の CSS を取り、参照している woff2 をすべて落として
 * public/ に置き、同じ unicode-range を持つ @font-face を書き出す。
 * 読み込み時に外部へ出ないよう、url は自分のところだけを指す。
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

/*
  2書体を組み合わせる。

  日本語は IBM Plex Sans JP。角が立っていて、業務の画面に合う硬さがある。
  英数字は Inter。この画面は日付・件数・URL が多く、そこだけ別の書体で
  引き締めると全体が締まる。--font-sans で Inter を先に並べるので、
  英数字は Inter、かなと漢字は Inter に無いので IBM Plex Sans JP が拾う。

  太さは 400 と 700 の2種類。500（font-medium）は 400、
  600（font-semibold）は 700 で表示される。
*/
const FAMILIES = [
  { family: "IBM Plex Sans JP", slug: "plex", prefix: "plex" },
  { family: "Inter", slug: "inter", prefix: "inter" },
];
const WEIGHTS = [400, 700];
const FONT_ROOT = "public/fonts";
const OUT_CSS = "app/fonts.css";
// woff2 の URL は、ブラウザの User-Agent で出し分けられる
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const header = `/*
 * 本文書体の読み込み。
 *
 * 日本語は IBM Plex Sans JP、英数字は Inter（どちらも SIL Open Font License 1.1）。
 * --font-sans で Inter を先に並べているので、英数字は Inter が受け持ち、
 * かなと漢字は Inter に無いので IBM Plex Sans JP が拾う。
 *
 * 外部へは読みに行かず、public/fonts に置いたものだけを使う。
 * Google Fonts から読む形も試したが、回線の状態で描画が止まり、
 * 同じ検証が 1分20秒から 6分40秒まで伸びた。毎日開くものに、
 * 外側の都合で止まる要素は置かない。
 *
 * unicode-range で字ごとに分けてあるので、ブラウザは画面に出る字の分
 * だけを読む。全体では数MB あるが、1画面あたりは数十KB で済む。
 *
 * 太さは 400 と 700 の2種類。500（font-medium）は 400、
 * 600（font-semibold）は 700 で表示される。
 *
 * このファイルは scripts/build-font-css.mjs が作る。手で書き換えない。
 */
`;

const rules = [];
let files = 0;

for (const { family, slug, prefix } of FAMILIES) {
  const src =
    `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}` +
    `:wght@${WEIGHTS.join(";")}&display=swap`;

  const css = await (await fetch(src, { headers: { "User-Agent": UA } })).text();
  const faces = [...css.matchAll(/@font-face \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  if (faces.length === 0) throw new Error(`${family} の @font-face を読み取れませんでした`);

  const dir = join(FONT_ROOT, slug);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const seq = new Map();
  for (const face of faces) {
    const weight = /font-weight: (\d+)/.exec(face)?.[1];
    const url = /url\((https[^)]+)\)/.exec(face)?.[1];
    const range = /unicode-range: ([^;]+);/.exec(face)?.[1];
    if (!weight || !url || !range) continue;

    const i = seq.get(weight) ?? 0;
    seq.set(weight, i + 1);
    const name = `${prefix}-${weight}-${String(i).padStart(3, "0")}.woff2`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} を取得できません: ${res.status}`);
    await writeFile(join(dir, name), Buffer.from(await res.arrayBuffer()));
    files += 1;

    rules.push(
      `@font-face {\n` +
      `  font-family: "${family}";\n` +
      `  font-style: normal;\n` +
      `  font-weight: ${weight};\n` +
      `  font-display: swap;\n` +
      `  src: url("/fonts/${slug}/${name}") format("woff2");\n` +
      `  unicode-range: ${range};\n}`,
    );
  }
}

await writeFile(OUT_CSS, header + rules.join("\n") + "\n");
console.log(`✓ ${files} 件を ${FONT_ROOT} に置き、${OUT_CSS} を書き出しました`);
