import fs from 'fs';
import zlib from 'zlib';

function createAirplanePNGBuffer(size) {
  const width = size;
  const height = size;
  const rowSize = 1 + width * 4; // RGBA
  const rawData = Buffer.alloc(height * rowSize);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.44; // Rounded corner radius

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // Base background: #1055CC (Blue gradient)
      let r = 16;
      let g = 85;
      let b = 204;
      let a = 255;

      // Normalize coordinates -1 to +1
      const nx = (x - cx) / (width * 0.4);
      const ny = (y - cy) / (height * 0.4);

      // Airplane vector geometry (taking off at 45deg: nx + ny direction)
      // Rotated coordinates for 45 deg airplane
      const rx = (nx - ny) / 1.414; // Along plane axis (tail to nose)
      const ry = (nx + ny) / 1.414; // Perpendicular axis (wing to wing)

      let isPlane = false;

      // Fuselage / Body (ellipse along rx)
      if (rx >= -0.55 && rx <= 0.65 && Math.abs(ry) <= (0.12 * (1.1 - rx))) {
        isPlane = true;
      }
      // Wings (main wings spanning ry)
      if (rx >= -0.15 && rx <= 0.25 && Math.abs(ry) <= (0.75 - Math.abs(rx - 0.05) * 1.5)) {
        isPlane = true;
      }
      // Tail wings
      if (rx >= -0.65 && rx <= -0.4 && Math.abs(ry) <= (0.38 - Math.abs(rx + 0.52) * 1.8)) {
        isPlane = true;
      }
      // Vertical tail fin accent
      if (rx >= -0.6 && rx <= -0.35 && ry >= 0 && ry <= (0.28 - (rx + 0.6) * 0.8)) {
        isPlane = true;
      }

      if (isPlane) {
        // Crisp White Airplane Icon
        r = 255;
        g = 255;
        b = 255;
      }

      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  // PNG Encapsulation
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit depth
  ihdr[9] = 6;  // Color type: RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = createChunk('IHDR', ihdr);
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const buffer = Buffer.alloc(8 + length + 4);
  buffer.writeUInt32BE(length, 0);
  buffer.write(type, 4, 4, 'ascii');
  data.copy(buffer, 8);
  const crc = crc32(buffer.subarray(4, 8 + length));
  buffer.writeUInt32BE(crc, 8 + length);
  return buffer;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    crc = crc ^ byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xEDB88320);
    }
  }
  return (crc ^ -1) >>> 0;
}

const icon192 = createAirplanePNGBuffer(192);
const icon512 = createAirplanePNGBuffer(512);

fs.writeFileSync('/home/shu/Projects/business-trip-pwa/icon-192.png', icon192);
fs.writeFileSync('/home/shu/Projects/business-trip-pwa/icon-512.png', icon512);
fs.mkdirSync('/home/shu/Projects/business-trip-pwa/public', { recursive: true });
fs.writeFileSync('/home/shu/Projects/business-trip-pwa/public/icon-192.png', icon192);
fs.writeFileSync('/home/shu/Projects/business-trip-pwa/public/icon-512.png', icon512);

console.log("Beautiful Airplane PNG Icons (192x192 & 512x512) generated!");
