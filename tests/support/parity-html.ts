/**
 * Phase 7 slice 5 — TEST-ONLY. Rebuild the `ParityManifest` from the ACTUAL rendered
 * `.a4-document` HTML (what the browser / PDF-source receives), so AC-P7-4 parity is proven
 * against real output and not the raw snapshot JSON.
 *
 * `extractA4Document(html)` pulls the `<article class="a4-document">…</article>` render root out of
 * a full page (web page has chrome around it; the print page has only `<main class="pdf-shell">`).
 * `manifestFromA4Html(a4Html)` walks it into the same shape `buildOutputParityManifest(vm)` emits.
 */

import { JSDOM } from "jsdom";
import type {
  ParityManifest,
  ParityChapter,
  ParityBlock,
} from "@/lib/publication/output-parity";
import { normText } from "@/lib/publication/output-parity";

/** the shared manual render root, chrome stripped (jsdom-parsed — robust against the nested
 *  `<article>` a `steps` block renders per step) */
export function extractA4Document(html: string): string {
  const el = new JSDOM(html).window.document.querySelector("article.a4-document");
  if (!el) throw new Error('extractA4Document: no <article class="a4-document"> in the HTML');
  // strip Next.js RSC/hydration comment markers so web vs print compare byte-for-byte
  return el.outerHTML.replace(/<!--(?:\$|\/\$|.*?)-->/g, "");
}

const txt = (el: Element | null): string => normText(el?.textContent ?? "");

/** rich-text (RichTextView output): join block-level children with a space — `textContent` alone
 *  concatenates adjacent `<p>` without a separator, which `richTextToPlainText` (newline-joined)
 *  does not. */
const richText = (el: Element | null): string => {
  if (!el) return "";
  const blocks = el.querySelectorAll("p, li, h2, h3, h4, h5, h6");
  return normText(blocks.length ? [...blocks].map((b) => b.textContent ?? "").join(" ") : el.textContent ?? "");
};

/** first image index from a proxy src `/manual/<slug>/<version>/image/<idx>` */
const refFromSrc = (src: string | null): number => {
  const m = /\/image\/(\d+)(?:$|\?)/.exec(src ?? "");
  return m ? Number(m[1]) : -1;
};

function stepsBlock(el: Element): ParityBlock {
  return {
    kind: "steps",
    steps: [...el.querySelectorAll(":scope > article")].map((art, i) => {
      const fig = art.querySelector("figure.manual-step-image");
      const img = fig?.querySelector("img");
      // the instruction <p> is the first <p> that has no <code> child (that one is the menu path)
      const ps = [...art.querySelectorAll(":scope > div > p")];
      const instructionP = ps.find((p) => !p.querySelector("code")) ?? ps[0] ?? null;
      const menuCode = art.querySelector(":scope > div > p > code");
      return {
        index: i,
        title: txt(art.querySelector("h3")),
        instruction: txt(instructionP),
        menuPath: menuCode ? txt(menuCode) : null,
        image: img
          ? { alt: normText(img.getAttribute("alt") ?? ""), caption: txt(fig!.querySelector("figcaption")) }
          : null,
      };
    }),
  };
}

function tableBlock(container: Element): ParityBlock {
  const table = container.querySelector("table.parameter-table")!;
  const firstHeader = txt(table.querySelector("thead th"));
  if (firstHeader === "Symbol") {
    return {
      kind: "supportedSetups",
      rows: [...table.querySelectorAll("tbody > tr")].map((tr) => {
        const td = [...tr.children];
        return {
          symbol: txt(td[0]),
          timeframe: txt(td[1]),
          preset: txt(td[2]),
          testedMinimumLot: txt(td[3]),
          supported: txt(td[4]),
        };
      }),
      note: txt(container.querySelector("aside.manual-callout p")),
    };
  }
  // parameter table — one or more groups, each is a sibling <div> with a heading + a table-wrap
  const groups = [...container.querySelectorAll(":scope > div")].map((g) => {
    const gTable = g.querySelector("table.parameter-table");
    const rows = gTable ? [...gTable.querySelectorAll("tbody > tr")] : [];
    return {
      name: txt(g.querySelector(".parameter-group-heading h3")),
      paramCount: rows.length,
      parameters: rows.map((tr, i) => {
        const td = [...tr.children];
        return {
          index: i,
          displayName: txt(td[0]?.querySelector("strong") ?? null),
          technicalName: txt(td[0]?.querySelector("code") ?? null),
          paramType: txt(td[1]),
          defaultValue: txt(td[2]),
          safeRange: txt(td[3]),
          orderEffect: txt(td[4]),
        };
      }),
    };
  });
  return { kind: "parameterTable", groups };
}

function contentDivBlock(el: Element): ParityBlock {
  if (el.querySelector("table.parameter-table")) return tableBlock(el);
  const children = [...el.children];
  // faq: `<h3>question</h3>` then the RichTextView answer (its <p>s are siblings of the <h3>)
  if (children[0]?.tagName === "H3" && !el.querySelector(".parameter-group-heading")) {
    const clone = el.cloneNode(true) as Element;
    clone.querySelector(":scope > h3")?.remove();
    return { kind: "faq", question: txt(children[0]), answer: richText(clone) };
  }
  return { kind: "text", text: richText(el) };
}

function chapterBlocks(chapterEl: Element): ParityBlock[] {
  const content = chapterEl.querySelector(".manual-content.generic-chapter");
  if (!content) return [];
  const out: ParityBlock[] = [];
  for (const child of [...content.children]) {
    if (child.matches("p.lead")) {
      out.push({ kind: "placeholder", text: txt(child) });
    } else if (child.matches("aside.manual-callout")) {
      const tone =
        [...child.classList].find((c) => c !== "manual-callout") ?? "info";
      out.push({ kind: "callout", tone, text: richText(child.querySelector(":scope > div")) });
    } else if (child.matches("div.step-list")) {
      out.push(stepsBlock(child));
    } else if (child.matches("figure.manual-image-block")) {
      const img = child.querySelector("img");
      out.push({
        kind: "image",
        image: {
          ref: refFromSrc(img?.getAttribute("src") ?? null),
          alt: normText(img?.getAttribute("alt") ?? ""),
          caption: txt(child.querySelector("figcaption")),
        },
      });
    } else if (child.matches("p.manual-image-missing")) {
      out.push({ kind: "image", image: null });
    } else if (child.matches("div.manual-content")) {
      out.push(contentDivBlock(child));
    }
  }
  return out;
}

export function manifestFromA4Html(a4Html: string): ParityManifest {
  const doc = new JSDOM(`<!doctype html><body>${a4Html}</body>`).window.document;
  const cover = doc.querySelector(".manual-cover");
  const dd = (label: string): string => {
    for (const div of cover?.querySelectorAll("dl > div") ?? []) {
      if (txt(div.querySelector("dt")) === label) return txt(div.querySelector("dd"));
    }
    return "";
  };
  const chapters: ParityChapter[] = [...doc.querySelectorAll(".manual-page")].map((ch, index) => {
    const blocks = chapterBlocks(ch);
    return {
      index,
      title: txt(ch.querySelector(".manual-page-body > h2")),
      hasContent: !blocks.some((b) => b.kind === "placeholder"),
      blocks,
    };
  });
  return {
    manual: {
      title: txt(cover?.querySelector(".manual-cover-copy h1") ?? null),
      publicVersion: dd("Manual Version"),
      platform: dd("Platform"),
      eaVersion: dd("EA Version"),
    },
    chapters,
  };
}
