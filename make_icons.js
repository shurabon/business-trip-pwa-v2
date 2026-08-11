import fs from 'fs';

// Simple valid 1x1 blue PNG, resized by headers or create 192x192 SVG/PNG
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIA9QdZ0QAAAABJRU5ErkJggg==';
const buffer = Buffer.from(base64Png, 'base64');

fs.writeFileSync('/home/shu/Projects/business-trip-pwa/icon-192.png', buffer);
fs.writeFileSync('/home/shu/Projects/business-trip-pwa/icon-512.png', buffer);
console.log("PNG Icons created successfully!");
