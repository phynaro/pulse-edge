const fs = require('fs');
const path = require('path');
const https = require('https');

const FONTS_DIR = path.join(__dirname, '../packages/pulse-ui/src/fonts');
const FONTS_CSS_PATH = path.join(__dirname, '../packages/pulse-ui/src/fonts.css');

if (fs.existsSync(FONTS_DIR)) {
  fs.readdirSync(FONTS_DIR).forEach(f => fs.unlinkSync(path.join(FONTS_DIR, f)));
} else {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    }).on('error', err => {
      fs.unlink(destPath, () => reject(err));
    });
  });
}

async function processFontFamily(familyUrl, prefix) {
  const css = await fetchText(familyUrl);
  const regex = /@font-face\s*\{([^}]+)\}/g;
  let match;
  let count = 0;
  let newCssBlocks = [];

  while ((match = regex.exec(css)) !== null) {
    const blockContent = match[1];
    
    const fontFamilyMatch = blockContent.match(/font-family:\s*([^;]+);/);
    const fontStyleMatch = blockContent.match(/font-style:\s*([^;]+);/);
    const fontWeightMatch = blockContent.match(/font-weight:\s*([^;]+);/);
    const fontDisplayMatch = blockContent.match(/font-display:\s*([^;]+);/);
    const unicodeRangeMatch = blockContent.match(/unicode-range:\s*([^;]+);/);
    const srcMatch = blockContent.match(/src:\s*url\((https:\/\/[^)]+)\)\s*format\(([^)]+)\);/);

    if (srcMatch) {
      count++;
      const fontUrl = srcMatch[1];
      const format = srcMatch[2];
      const style = fontStyleMatch ? fontStyleMatch[1].trim() : 'normal';
      const weight = fontWeightMatch ? fontWeightMatch[1].trim() : '400';
      const family = fontFamilyMatch ? fontFamilyMatch[1].trim() : 'font';
      
      const safeWeight = weight.replace(/\s+/g, '_');
      const fileName = `${prefix}-${safeWeight}${style === 'italic' ? '-italic' : ''}-${count}.woff2`;
      const localFilePath = path.join(FONTS_DIR, fileName);
      
      console.log(`Downloading ${prefix} (${weight} ${style}): ${fileName}`);
      await downloadBinary(fontUrl, localFilePath);

      let newBlock = `@font-face {\n  font-family: ${family};\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: ${fontDisplayMatch ? fontDisplayMatch[1].trim() : 'swap'};\n  src: url('./fonts/${fileName}') format(${format});`;
      if (unicodeRangeMatch) {
        newBlock += `\n  unicode-range: ${unicodeRangeMatch[1].trim()};`;
      }
      newBlock += `\n}`;
      newCssBlocks.push(newBlock);
    }
  }
  return newCssBlocks;
}

async function run() {
  console.log('Downloading static font weights...');
  
  const dmSansCss = await processFontFamily(
    'https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap',
    'dm-sans'
  );
  
  const notoThaiCss = await processFontFamily(
    'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap',
    'noto-sans-thai'
  );

  const spaceMonoCss = await processFontFamily(
    'https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap',
    'space-mono'
  );

  const fullCss = [
    '/* DM Sans (Latin & Extended) */',
    ...dmSansCss,
    '\n/* Noto Sans Thai (Thai & Latin) */',
    ...notoThaiCss,
    '\n/* Space Mono (Monospace) */',
    ...spaceMonoCss,
    ''
  ].join('\n\n');

  fs.writeFileSync(FONTS_CSS_PATH, fullCss, 'utf8');
  console.log(`Updated fonts.css successfully! Total font files: ${fs.readdirSync(FONTS_DIR).length}`);
}

run().catch(err => {
  console.error('Error downloading fonts:', err);
  process.exit(1);
});
