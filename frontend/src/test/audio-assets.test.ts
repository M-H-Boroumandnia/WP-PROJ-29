import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedTracks } from "../data/seed";

function inspectPcmWav(fileName: string) {
  const buffer = readFileSync(
    join(process.cwd(), "public", "media", "audio", fileName),
  );
  expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataOffset = buffer.indexOf("data", 36, "ascii") + 8;
  const dataBytes = buffer.readUInt32LE(dataOffset - 4);
  let peak = 0;
  let sumSq = 0;
  const samples = dataBytes / 2;
  for (let offset = dataOffset; offset < dataOffset + dataBytes; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sumSq += sample * sample;
  }
  return {
    sampleRate,
    bitsPerSample,
    duration: samples / sampleRate,
    peak,
    rms: Math.sqrt(sumSq / samples),
  };
}

describe("local audio assets", () => {
  it("are audible local PCM WAV files with expected duration and non-trivial amplitude", () => {
    const checkedFiles = new Set<string>();
    seedTracks.forEach((track) => {
      const fileName = track.audioUrl.split("/").pop()!;
      const stats = inspectPcmWav(fileName);
      expect(stats.sampleRate).toBe(22_050);
      expect(stats.bitsPerSample).toBe(16);
      expect(stats.peak).toBeGreaterThan(0.35);
      expect(stats.rms).toBeGreaterThan(0.08);
      // Duration is authoritative for the first track that owns each WAV;
      // later tracks may reuse files via modulo.
      if (!checkedFiles.has(fileName)) {
        checkedFiles.add(fileName);
        expect(stats.duration).toBeCloseTo(track.durationSeconds, 0);
      }
    });
  });
});
