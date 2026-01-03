const sharp = require('sharp');
const fs = require('fs');

const input = 'media/icon.svg';
const output = 'media/icon.png';

if (!fs.existsSync(input)) {
  console.error(`Input SVG not found: ${input}`);
  process.exit(1);
}

sharp(input)
  .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(output)
  .then(() => {
    console.log(`Wrote ${output}`);
  })
  .catch(err => {
    console.error('Conversion failed:', err);
    process.exit(1);
  });
