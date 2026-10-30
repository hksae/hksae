#!/usr/bin/env node
/**
 * Generates the "most used languages" card as a standalone SVG.
 *
 * Data comes from the GitHub REST API: every owned, non-fork repository is
 * asked for its language byte counts, the bytes are summed per language and
 * turned into percentages. Nothing but languages is rendered.
 *
 * Output: assets/languages-dark.svg and assets/languages-light.svg
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const LOGIN = process.env.GH_LOGIN || "hksae";
const TOKEN = process.env.GITHUB_TOKEN || "";
const EXCLUDE = (process.env.EXCLUDE_REPOS || "hksae,test24")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const TOP = Number(process.env.TOP_LANGS || 6);

const WIDTH = 440;
const ROW_H = 22;
const LEGEND_TOP = 47;
const GAP = 2;
const TOP_PAD = 4;

const THEMES = {
  dark: {
    kicker: "#8b949e",
    label: "#c9d1d9",
    value: "#7d8590",
    track: "#1b2130",
    palette: ["#f1f5f9", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155"],
  },
  light: {
    kicker: "#59636e",
    label: "#1f2328",
    value: "#6e7781",
    track: "#eaeef2",
    palette: ["#24292f", "#424a53", "#5c6670", "#78828c", "#98a1aa", "#b6bec6"],
  },
};

function api(path) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "languages-card",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  }).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
    return res.json();
  });
}

async function collect() {
  const repos = await api(`/users/${LOGIN}/repos?per_page=100&type=owner`);
  const usable = repos.filter(
    (repo) => !repo.fork && !EXCLUDE.includes(repo.name.toLowerCase()),
  );

  const totals = new Map();
  for (const repo of usable) {
    const langs = await api(`/repos/${LOGIN}/${repo.name}/languages`);
    for (const [name, bytes] of Object.entries(langs)) {
      totals.set(name, (totals.get(name) || 0) + bytes);
    }
  }

  const all = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const totalBytes = all.reduce((sum, [, bytes]) => sum + bytes, 0);
  if (!totalBytes) throw new Error("no language data returned");

  return all.slice(0, TOP).map(([name, bytes]) => ({
    name,
    pct: (bytes / totalBytes) * 100,
  }));
}

// Rough advance widths. Slightly generous so text never bumps into the next
// item when the viewer's font is a little wider than expected.
const nameWidth = (s) => s.length * 6.55;
const valueWidth = (s) => s.length * 6.05;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const pct = (v) => `${v.toFixed(1)}%`;

function layout(langs) {
  const rows = [];
  let row = [];
  let x = 0;

  langs.forEach((lang, i) => {
    const label = pct(lang.pct);
    const width = 7 + 6 + nameWidth(lang.name) + 4 + valueWidth(label);
    if (row.length && x + width > WIDTH) {
      rows.push(row);
      row = [];
      x = 0;
    }
    row.push({ ...lang, i, label, width });
    x += width + 14;
  });
  if (row.length) rows.push(row);

  // Avoid a lonely last item: pull one entry down from the previous row.
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if (last.length === 1 && prev.length > 2) {
      last.unshift(prev.pop());
    }
  }

  return rows.map((items) => {
    let x = 0;
    return items.map((item) => {
      const placed = { ...item, x };
      x += item.width + 14;
      return placed;
    });
  });
}

function render(langs, theme) {
  const t = THEMES[theme];
  const rows = layout(langs);
  const height = LEGEND_TOP + (rows.length - 1) * ROW_H + 9 + TOP_PAD;
  const usable = WIDTH - GAP * (langs.length - 1);

  let x = 0;
  const segments = langs
    .map((lang, i) => {
      const w = (lang.pct / 100) * usable;
      const seg = `<rect x="${x.toFixed(2)}" y="${24 + TOP_PAD}" width="${w.toFixed(2)}" height="3" rx="1.5" fill="${t.palette[i % t.palette.length]}"/>`;
      x += w + GAP;
      return seg;
    })
    .join("");

  const legend = rows
    .map((row, r) =>
      row
        .map((lang) => {
          const y = LEGEND_TOP + TOP_PAD + r * ROW_H;
          const color = t.palette[lang.i % t.palette.length];
          return (
            `<circle cx="${(lang.x + 2.5).toFixed(1)}" cy="${y - 4}" r="2.5" fill="${color}"/>` +
            `<text x="${(lang.x + 13).toFixed(1)}" y="${y}" font-size="11.5" fill="${t.label}">${esc(lang.name)}</text>` +
            `<text x="${(lang.x + 13 + nameWidth(lang.name) + 4).toFixed(1)}" y="${y}" font-size="10.5" fill="${t.value}">${lang.label}</text>`
          );
        })
        .join(""),
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" fill="none" role="img" aria-label="Most used languages">
  <title>Most used languages</title>
  <text x="0" y="${12 + TOP_PAD}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" font-weight="600" letter-spacing="1.1" fill="${t.kicker}">MOST USED LANGUAGES</text>
  <rect x="0" y="${24 + TOP_PAD}" width="${WIDTH}" height="3" rx="1.5" fill="${t.track}"/>
  ${segments}
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">${legend}</g>
</svg>
`;
}

const langs = await collect();
await mkdir(join(ROOT, "assets"), { recursive: true });
await writeFile(join(ROOT, "assets/languages-dark.svg"), render(langs, "dark"));
await writeFile(join(ROOT, "assets/languages-light.svg"), render(langs, "light"));

console.log(
  langs.map((l) => `${l.name} ${pct(l.pct)}`).join(" · "),
);
