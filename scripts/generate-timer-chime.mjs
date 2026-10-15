import { writeFileSync } from "node:fs";

// Original two-note chime: soft attacks and decays avoid sharp clicks.
const sampleRate = 44_100;
const duration = 1.15;
const samples = Math.ceil(sampleRate * duration);
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let index = 0; index < samples; index++) {
  const time = index / sampleRate;
  let value = 0;
  for (const [start, frequency] of [[0, 523.25], [0.30, 659.25]]) {
    const t = time - start;
    if (t < 0 || t > 0.8) continue;
    const envelope = Math.min(1, t / 0.025) * Math.exp(-t * 5) * Math.min(1, (0.8 - t) / 0.1);
    value += 0.23 * envelope * (Math.sin(2 * Math.PI * frequency * t) + 0.15 * Math.sin(4 * Math.PI * frequency * t));
  }
  wav.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
}
writeFileSync(new URL("../src/assets/timer-chime.wav", import.meta.url), wav);
