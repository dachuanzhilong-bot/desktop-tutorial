// Renders public/icons/icon.svg to the PNG sizes needed by the web manifest (uses the Playwright chromium).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const browser = await chromium.launch();
async function render(size, file, { maskable = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const inner = maskable ? `<div style="width:${size}px;height:${size}px;background:#0b3a30;display:grid;place-items:center"><div style="width:${size * 0.72}px;height:${size * 0.72}px">${svg}</div></div>` : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await page.setContent(`<style>html,body{margin:0}svg{width:100%;height:100%;display:block}</style>${inner}`);
  writeFileSync(file, await page.screenshot({ omitBackground: true }));
  await page.close();
}
await render(192, "public/icons/icon-192.png");
await render(512, "public/icons/icon-512.png");
await render(512, "public/icons/icon-maskable-512.png", { maskable: true });
await render(180, "public/icons/apple-touch-icon.png", { maskable: true });
await browser.close();
console.log("icons written");
