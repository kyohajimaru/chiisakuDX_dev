import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'service/index.html',
  'report/index.html',
  'report-tool/index.html',
  'price/index.html',
  'flow/index.html',
  'contact/index.html',
  'sitemap.xml',
  'robots.txt',
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
const sitemap = await readFile(new URL('../sitemap.xml', import.meta.url), 'utf8');
const pages = ['index.html', 'service/index.html', 'report/index.html', 'report-tool/index.html', 'price/index.html', 'flow/index.html', 'contact/index.html'];

if (!topPage.includes('report-tool/')) {
  throw new Error('Top page does not link to the report tool.');
}

for (const page of pages) {
  const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
  if (!/<title>.+<\/title>/.test(html)) throw new Error(`${page} is missing title.`);
  if (!/<meta name="description" content="[^"]+">/.test(html)) throw new Error(`${page} is missing meta description.`);
  if (!/<link rel="canonical" href="https:\/\/chiisakudx\.pages\.dev\/[^"]*">/.test(html)) throw new Error(`${page} is missing canonical.`);
  const h1Count = (html.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) throw new Error(`${page} should have exactly one h1, found ${h1Count}.`);
}

for (const loc of ['/', '/service/', '/report/', '/report-tool/', '/price/', '/flow/', '/contact/']) {
  if (!sitemap.includes(`https://chiisakudx.pages.dev${loc}`)) throw new Error(`sitemap.xml is missing ${loc}.`);
}

if (!reportPage.includes('id="diagnosis-form"') || !reportPage.includes('id="result-report"') || !reportPage.includes('無料で診断する')) {
  throw new Error('Report tool page is missing required form or result markup.');
}

if (reportPage.includes('できている') || reportPage.includes('少し不安') || reportPage.includes('できていない')) {
  throw new Error('Self-check answer labels should not remain on the report tool page.');
}

console.log('Static site validation passed.');
