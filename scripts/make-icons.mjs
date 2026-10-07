// Generates Windows and Linux packaging icons from src/assets/kupo.svg.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = path.resolve(import.meta.dirname, "..");
const svgPath = path.join(root, "src", "assets", "kupo.svg");
const buildDir = path.join(root, "build");

const svg = await readFile(svgPath);
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

// Render at a given size, centered with a little padding so it doesn't touch the edges
async function renderPng(size) {
  const inner = Math.round(size * 0.92);
  const glyph = await sharp(svg, { density: 300 })
    .resize(inner, inner, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  const pad = Math.floor((size - inner) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: transparent },
  })
    .composite([{ input: glyph, left: pad, top: pad }])
    .png()
    .toBuffer();
}

await mkdir(buildDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = await Promise.all(icoSizes.map(renderPng));
await writeFile(path.join(buildDir, "icon.ico"), await pngToIco(icoPngs));
await writeFile(path.join(buildDir, "icon.png"), await renderPng(512));

console.log("Icons written: build/icon.ico, build/icon.png");
