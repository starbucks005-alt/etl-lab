const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, 'etl-mark.svg');
const outPath = path.join(__dirname, 'etl-mark-720.png');

async function main() {
  const markBuffer = await sharp(svgPath, { density: 1200 })
    .resize(460, 460, { fit: 'contain' })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 720,
      height: 720,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: markBuffer, gravity: 'center' }])
    .png({ compressionLevel: 1, palette: false, adaptiveFiltering: true })
    .toFile(outPath);

  console.log('Wrote ' + outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
