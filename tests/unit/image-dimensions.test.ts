import { describe, it, expect } from "vitest";
import { imageDimensions } from "@/lib/domain/image-dimensions";

function bytes(...parts: (number | number[])[]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

describe("imageDimensions — header parsing (AC-P2-19)", () => {
  it("reads PNG IHDR width/height (big-endian)", () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // signature
      [0x00, 0x00, 0x00, 0x0d], // IHDR length
      [0x49, 0x48, 0x44, 0x52], // "IHDR"
      [0x00, 0x00, 0x00, 0x20], // width = 32
      [0x00, 0x00, 0x00, 0x18], // height = 24
      [0, 0, 0, 0, 0], // bit depth etc.
    );
    expect(imageDimensions(png, "image/png")).toEqual({ width: 32, height: 24 });
  });

  it("reads GIF logical screen width/height (little-endian)", () => {
    const gif = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], [0x40, 0x00], [0x30, 0x00], [0, 0]);
    expect(imageDimensions(gif, "image/gif")).toEqual({ width: 64, height: 48 });
  });

  it("reads JPEG SOF0 frame dimensions (big-endian)", () => {
    const jpeg = bytes(
      [0xff, 0xd8], // SOI
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], // small APP0 (length 4)
      [0xff, 0xc0, 0x00, 0x11, 0x08], // SOF0, length 17, precision 8
      [0x00, 0x64], // height = 100
      [0x00, 0xc8], // width = 200
      [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
    );
    expect(imageDimensions(jpeg, "image/jpeg")).toEqual({ width: 200, height: 100 });
  });

  it("reads WebP VP8X canvas dimensions", () => {
    const webp = bytes(
      [0x52, 0x49, 0x46, 0x46], // RIFF
      [0x00, 0x00, 0x00, 0x00], // file size (ignored)
      [0x57, 0x45, 0x42, 0x50], // WEBP
      [0x56, 0x50, 0x38, 0x58], // "VP8X"
      [0x0a, 0x00, 0x00, 0x00], // chunk size
      [0x00], // flags
      [0x00, 0x00, 0x00], // reserved
      [0x0f, 0x00, 0x00], // width-1 = 15 -> 16
      [0x08, 0x00, 0x00], // height-1 = 8 -> 9
    );
    expect(imageDimensions(webp, "image/webp")).toEqual({ width: 16, height: 9 });
  });

  it("returns null for an unsupported type or a corrupt header", () => {
    expect(imageDimensions(bytes([1, 2, 3, 4]), "image/svg+xml")).toBeNull();
    expect(imageDimensions(bytes([0x00, 0x00]), "image/png")).toBeNull();
  });
});
