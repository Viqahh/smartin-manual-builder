/**
 * Dependency-free intrinsic-dimension extraction for the formats the product accepts
 * (docs/DATA_MODEL.md `image_assets`, config.toml bucket): PNG, JPEG, GIF, WebP.
 * Used by uploadManualImage so `image_assets.width/height` are never left null (AC-P2-19).
 */

export type Dimensions = { width: number; height: number };

export function imageDimensions(bytes: Uint8Array, mime: string): Dimensions | null {
  try {
    switch (mime) {
      case "image/png":
        return png(bytes);
      case "image/gif":
        return gif(bytes);
      case "image/jpeg":
        return jpeg(bytes);
      case "image/webp":
        return webp(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}
function u32be(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function u16le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u24le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

function png(b: Uint8Array): Dimensions | null {
  // 8-byte signature, then IHDR: width @16 (u32be), height @20 (u32be)
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gif(b: Uint8Array): Dimensions | null {
  // "GIF87a"/"GIF89a", then logical screen width @6 (u16le), height @8 (u16le)
  if (b.length < 10 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function jpeg(b: Uint8Array): Dimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry frame dimensions
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webp(b: Uint8Array): Dimensions | null {
  // RIFF....WEBP then a chunk: 'VP8 ' (lossy), 'VP8L' (lossless), 'VP8X' (extended)
  if (
    b.length < 30 ||
    b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46 ||
    b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50
  ) {
    return null;
  }
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8 ") {
    // frame tag at 20; dimensions at 26/28 as 14-bit little-endian
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (fourcc === "VP8L") {
    // 1 signature byte (0x2f) at 20, then 14 bits width, 14 bits height
    const bits = u32be(b, 21); // read 4 bytes big-endian starting at 21, then bit-twiddle
    // Easier: little-endian 32-bit from offset 21
    const le = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    void bits;
    const width = (le & 0x3fff) + 1;
    const height = ((le >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (fourcc === "VP8X") {
    // canvas width-1 @24 (u24le), height-1 @27 (u24le)
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}
