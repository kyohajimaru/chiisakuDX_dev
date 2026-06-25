import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'report-tool/index.html',
  'assets/css/style.css',
  'assets/css/report-tool.css',
  'assets/js/main.js',
  'assets/js/report-tool.js',
  'functions/api/check-site.js',
  'assets/img/logo-transparent.png'
];

await Promise.all(requiredFiles.map((file) => access(new URL(`../${file}`, import.meta.url))));

const reportPage = await readFile(new URL('../report-tool/index.html', import.meta.url), 'utf8');
const topPage = await readFile(new URL('../index.html', import.meta.url), 'utf8');

if (!topPage.includes('report-tool/')) {
  throw new Error('Top page does not link to the report tool.');
}

if (!reportPage.includes('id="diagnosis-form"') || !reportPage.includes('id="result-report"') || !reportPage.includes('無料で診断する')) {
  throw new Error('Report tool page is missing required form or result markup.');
}

if (reportPage.includes('できている') || reportPage.includes('少し不安') || reportPage.includes('できていない')) {
  throw new Error('Self-check answer labels should not remain on the report tool page.');
}

console.log('Static site validation passed.');
