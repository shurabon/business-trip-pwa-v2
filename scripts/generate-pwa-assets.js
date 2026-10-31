import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

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

function encodePNG(width, height, getPixelRGBA) {
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter 0 (None)
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = getPixelRGBA(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a !== undefined ? a : 255;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8 bits
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = createChunk('IHDR', ihdr);
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate icon with scale
function generateIcon(size, planeScale = 0.9) {
  return encodePNG(size, size, (x, y, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const nx = (x - cx) / (w * 0.4 * planeScale);
    const ny = (y - cy) / (h * 0.4 * planeScale);

    const rx = (nx - ny) / 1.414;
    const ry = (nx + ny) / 1.414;

    let isPlane = false;
    if (rx >= -0.55 && rx <= 0.65 && Math.abs(ry) <= (0.12 * (1.1 - rx))) isPlane = true;
    if (rx >= -0.15 && rx <= 0.25 && Math.abs(ry) <= (0.75 - Math.abs(rx - 0.05) * 1.5)) isPlane = true;
    if (rx >= -0.65 && rx <= -0.4 && Math.abs(ry) <= (0.38 - Math.abs(rx + 0.52) * 1.8)) isPlane = true;
    if (rx >= -0.6 && rx <= -0.35 && ry >= 0 && ry <= (0.28 - (rx + 0.6) * 0.8)) isPlane = true;

    if (isPlane) {
      return [255, 255, 255, 255];
    }
    // #1055CC
    return [16, 85, 204, 255];
  });
}

// Generate screenshots (Mock UI)
function generateScreenshot(width, height, isMobile) {
  return encodePNG(width, height, (x, y, w, h) => {
    // Header bar (#1055CC)
    const headerHeight = isMobile ? Math.floor(h * 0.08) : Math.floor(h * 0.1);
    if (y < headerHeight) {
      return [16, 85, 204, 255];
    }

    // Bottom nav bar on mobile
    if (isMobile && y > h - Math.floor(h * 0.08)) {
      return [255, 255, 255, 255];
    }

    // Background #F8F9FE
    let r = 248, g = 249, b = 254;

    // Card representation
    const cardMarginX = isMobile ? Math.floor(w * 0.06) : Math.floor(w * 0.15);
    const cardWidth = w - cardMarginX * 2;
    
    // Draw 3 simulated cards
    const card1Top = headerHeight + Math.floor(h * 0.04);
    const cardHeight = Math.floor(h * (isMobile ? 0.22 : 0.24));
    const cardGap = Math.floor(h * 0.03);

    for (let i = 0; i < 3; i++) {
      const top = card1Top + i * (cardHeight + cardGap);
      const bottom = top + cardHeight;
      if (x >= cardMarginX && x <= cardMarginX + cardWidth && y >= top && y <= bottom) {
        // Inner card #FFFFFF
        r = 255; g = 255; b = 255;
        // Top accent line of card
        if (y < top + 6) {
          if (i === 0) { r = 46; g = 125; b = 50; } // Green for paid
          else if (i === 1) { r = 245; g = 158; b = 11; } // Amber
          else { r = 16; g = 85; b = 204; } // Blue
        }
        // Simulated text line 1
        if (y >= top + 25 && y <= top + 35 && x >= cardMarginX + 20 && x <= cardMarginX + Math.floor(cardWidth * 0.5)) {
          r = 30; g = 41; b = 59;
        }
        // Simulated text line 2
        if (y >= top + 45 && y <= top + 52 && x >= cardMarginX + 20 && x <= cardMarginX + Math.floor(cardWidth * 0.75)) {
          r = 100; g = 116; b = 139;
        }
        // Simulated badge
        if (y >= top + 22 && y <= top + 38 && x >= cardMarginX + cardWidth - 110 && x <= cardMarginX + cardWidth - 20) {
          if (i === 0) { r = 220; g = 252; b = 231; } // Green badge bg
          else { r = 254; g = 243; b = 199; } // Amber badge bg
        }
      }
    }

    return [r, g, b, 255];
  });
}

const projDir = path.resolve('.');
const publicDir = path.join(projDir, 'public');
fs.mkdirSync(publicDir, { recursive: true });

console.log('🖼️ Генерируем иконки...');
const icon192 = generateIcon(192, 0.9);
const icon512 = generateIcon(512, 0.9);
const iconMaskable192 = generateIcon(192, 0.65); // 65% scale for safe zone
const iconMaskable512 = generateIcon(512, 0.65);

const iconFiles = [
  { name: 'icon-192.png', buf: icon192 },
  { name: 'icon-512.png', buf: icon512 },
  { name: 'icon-maskable-192.png', buf: iconMaskable192 },
  { name: 'icon-maskable-512.png', buf: iconMaskable512 }
];

for (const { name, buf } of iconFiles) {
  fs.writeFileSync(path.join(projDir, name), buf);
  fs.writeFileSync(path.join(publicDir, name), buf);
  console.log(`  + ${name} (${buf.length} bytes)`);
}

console.log('📱 Генерируем скриншоты для манифеста (PWABuilder)...');
const mobileShot = generateScreenshot(1080, 1920, true);
const desktopShot = generateScreenshot(1920, 1080, false);

fs.writeFileSync(path.join(projDir, 'screenshot-mobile.png'), mobileShot);
fs.writeFileSync(path.join(publicDir, 'screenshot-mobile.png'), mobileShot);
fs.writeFileSync(path.join(projDir, 'screenshot-desktop.png'), desktopShot);
fs.writeFileSync(path.join(publicDir, 'screenshot-desktop.png'), desktopShot);

console.log(`  + screenshot-mobile.png (1080x1920, ${mobileShot.length} bytes)`);
console.log(`  + screenshot-desktop.png (1920x1080, ${desktopShot.length} bytes)`);
console.log('✅ Все ассеты успешно созданы!');
