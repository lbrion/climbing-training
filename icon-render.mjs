import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const svg = readFileSync('web/icon.svg', 'utf8');
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
});
const page = await browser.newPage();
for (const size of [512, 192]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<style>*{margin:0}</style><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`);
  await page.screenshot({ path: `web/public/icon-${size}.png` });
}
await browser.close();
console.log('rendered');
