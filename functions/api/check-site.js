const MAX_HTML_BYTES = 1_200_000;
const MAX_LINK_CHECKS = 20;
const FETCH_TIMEOUT_MS = 12000;
const PAGESPEED_TIMEOUT_MS = 30000;
const PAGESPEED_ERROR_MESSAGE = 'PageSpeedの取得に失敗しました。サイト自体の問題ではなく、一時的なAPIエラーやタイムアウトの可能性があります。';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  }
});

const timeoutSignal = (ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

const isPrivateHostname = (hostname) => {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
};

const validateTargetUrl = (value) => {
  let url;
  try {
    const rawValue = String(value || '').trim();
    const withProtocol = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    url = new URL(withProtocol);
  } catch {
    return { error: 'URL形式が正しくありません。https:// から始まるURLを入力してください。' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { error: '診断できるのは http / https のURLのみです。' };
  if (isPrivateHostname(url.hostname)) return { error: 'localhost や private IP は診断対象外です。公開されているサイトURLを入力してください。' };
  if (url.protocol === 'http:') url.protocol = 'https:';
  return { url };
};

const fetchWithTimeout = async (url, options = {}, timeout = FETCH_TIMEOUT_MS) => {
  const { signal, clear } = timeoutSignal(timeout);
  try {
    return await fetch(url, { ...options, signal });
  } finally {
    clear();
  }
};

const decodeHtml = async (response) => {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) break;
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder('utf-8').decode(merged);
};

const stripTags = (value = '') => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const decodeEntities = (value = '') => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;|&#39;/g, "'");

const attr = (tag, name) => {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return match ? decodeEntities(match[2] || match[3] || match[4] || '') : null;
};

const statusFromScore = (score) => {
  if (score === null || score === undefined || Number.isNaN(score)) return 'unavailable';
  if (score >= 80) return 'ok';
  if (score >= 50) return 'caution';
  return 'improve';
};

const makeCheck = (id, label, score, status, summary, details = [], weight = 0) => ({
  id,
  label,
  score,
  status,
  summary,
  details,
  weight
});

const parseHtml = (html, baseUrl) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : '';
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const descriptionTag = metaTags.find((tag) => (attr(tag, 'name') || '').toLowerCase() === 'description');
  const description = descriptionTag ? (attr(descriptionTag, 'content') || '').trim() : '';
  const h1Texts = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => decodeEntities(stripTags(match[1]))).filter(Boolean);
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const imgTotal = imgTags.length;
  const imgWithAlt = imgTags.filter((tag) => {
    const value = attr(tag, 'alt');
    return value !== null && value.trim() !== '';
  }).length;
  const imgMissingAlt = imgTotal - imgWithAlt;
  const altRate = imgTotal ? Math.round((imgWithAlt / imgTotal) * 100) : 100;
  const anchorTags = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({ tag: match[0], text: decodeEntities(stripTags(match[1])) }));
  const buttonTexts = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((match) => decodeEntities(stripTags(match[1])));
  const links = anchorTags.map(({ tag, text }) => {
    const href = attr(tag, 'href');
    let absolute = null;
    try {
      if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) absolute = new URL(href, baseUrl).href;
    } catch {
      absolute = null;
    }
    return { href, absolute, text };
  });
  return { title, description, h1Texts, imgTotal, imgWithAlt, imgMissingAlt, altRate, links, buttonTexts };
};

const checkLinks = async (links) => {
  const suspicious = links.filter((link) => {
    const href = (link.href || '').trim().toLowerCase();
    return !href || href === '#' || href === '#!' || href.startsWith('javascript:void') || href === 'javascript:;';
  }).map((link) => ({ url: link.href || '(空のリンク)', text: link.text || 'テキストなし', reason: 'リンク先が空、または仮置きの可能性があります' }));

  const external = links.filter((link) => link.absolute && /^https?:\/\//.test(link.absolute)).slice(0, MAX_LINK_CHECKS);
  const checked = await Promise.all(external.map(async (link) => {
    try {
      let response = await fetchWithTimeout(link.absolute, { method: 'HEAD', redirect: 'follow' }, 5000);
      if (response.status === 405 || response.status === 403) response = await fetchWithTimeout(link.absolute, { method: 'GET', redirect: 'follow' }, 5000);
      if (response.status >= 400) return { url: link.absolute, text: link.text || link.absolute, reason: `HTTP ${response.status}` };
      return null;
    } catch {
      return { url: link.absolute, text: link.text || link.absolute, reason: '確認できませんでした' };
    }
  }));

  const candidates = [...suspicious, ...checked.filter(Boolean)];
  return { checkedCount: external.length, candidateCount: candidates.length, candidates: candidates.slice(0, 5) };
};

const checkContactRoute = (parsed, bodyText) => {
  const keywords = ['予約', 'ご予約', '問い合わせ', 'お問い合わせ', '相談', '無料相談', 'LINE', '公式LINE', 'ホットペッパー', '電話', 'TEL', 'メール', 'contact', 'reserve', 'reservation', 'booking', 'line', 'tel', 'mail'];
  const keywordPattern = new RegExp(keywords.join('|'), 'i');
  const linkMatches = parsed.links.filter((link) => keywordPattern.test(`${link.text} ${link.href || ''}`));
  const buttonMatches = parsed.buttonTexts.filter((text) => keywordPattern.test(text));
  const textOnly = keywordPattern.test(bodyText);
  if (linkMatches.length || buttonMatches.length) {
    return { status: 'ok', score: 100, summary: '予約・問い合わせ系のリンクまたはボタンが見つかりました。', details: [...linkMatches.slice(0, 3).map((link) => link.text || link.href), ...buttonMatches.slice(0, 2)] };
  }
  if (textOnly) {
    return { status: 'caution', score: 60, summary: '予約・問い合わせに近い言葉はありますが、リンクやボタンでは確認できませんでした。', details: ['この判定は「有無っぽい判定」です。実際の使いやすさは有料レポートで詳しく確認できます。'] };
  }
  return { status: 'improve', score: 0, summary: '予約・問い合わせ系の導線を確認できませんでした。', details: ['この判定は「有無っぽい判定」です。見た目や配置の良さまでは自動では判断できません。'] };
};

const sanitizePageSpeedUrl = (url) => {
  const safeUrl = new URL(url);
  if (safeUrl.searchParams.has('key')) safeUrl.searchParams.set('key', '[hidden]');
  return safeUrl.href;
};

const getPageSpeedUrl = (url, env) => {
  const normalizedUrl = new URL(url);
  normalizedUrl.protocol = 'https:';

  const apiUrl = new URL('https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed');
  apiUrl.searchParams.set('url', normalizedUrl.href);
  apiUrl.searchParams.set('strategy', 'mobile');
  ['performance', 'seo', 'accessibility', 'best-practices'].forEach((category) => apiUrl.searchParams.append('category', category));
  if (env.PAGESPEED_API_KEY) apiUrl.searchParams.set('key', env.PAGESPEED_API_KEY);
  return apiUrl;
};

const getDebugInfo = (context) => {
  const requestUrl = new URL(context.request.url);
  const env = context.env || {};
  return {
    enabled: env.PAGESPEED_DEBUG === 'true' || requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1',
    env
  };
};

const logPageSpeedError = (error) => {
  console.error('PageSpeed API request failed', {
    status: error.status ?? null,
    statusText: error.statusText ?? '',
    body: error.body ?? '',
    apiUrl: error.apiUrl ? sanitizePageSpeedUrl(error.apiUrl) : '',
    message: error.message ?? ''
  });
};

const fetchPageSpeed = async (url, env) => {
  const apiUrl = getPageSpeedUrl(url, env);

  try {
    const response = await fetchWithTimeout(apiUrl.href, {}, PAGESPEED_TIMEOUT_MS);
    if (!response.ok) {
      throw {
        status: response.status,
        statusText: response.statusText,
        body: await response.text().catch(() => ''),
        apiUrl: apiUrl.href,
        message: `PageSpeed API ${response.status}`
      };
    }
    const data = await response.json();
    const lighthouse = data.lighthouseResult || {};
    const categories = lighthouse.categories || {};
    const audits = lighthouse.audits || {};
    const score = (category) => {
      const value = categories[category]?.score;
      return typeof value === 'number' ? Math.round(value * 100) : null;
    };
    return {
      available: true,
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
      metrics: {
        fcp: audits['first-contentful-paint']?.displayValue || '取得できませんでした',
        lcp: audits['largest-contentful-paint']?.displayValue || '取得できませんでした',
        cls: audits['cumulative-layout-shift']?.displayValue || '取得できませんでした',
        speedIndex: audits['speed-index']?.displayValue || '取得できませんでした'
      }
    };
  } catch (error) {
    const normalizedError = {
      status: error.status ?? null,
      statusText: error.statusText ?? '',
      body: error.body ?? '',
      apiUrl: error.apiUrl ?? apiUrl.href,
      message: error.name === 'AbortError' ? 'PageSpeed API timeout' : (error.message || 'PageSpeed API request failed')
    };
    logPageSpeedError(normalizedError);
    return {
      available: false,
      performance: null,
      accessibility: null,
      bestPractices: null,
      seo: null,
      metrics: null,
      error: {
        message: PAGESPEED_ERROR_MESSAGE,
        status: normalizedError.status,
        statusText: normalizedError.statusText,
        body: normalizedError.body,
        apiUrl: sanitizePageSpeedUrl(normalizedError.apiUrl),
        debugMessage: normalizedError.message
      }
    };
  }
};

const buildImprovements = ({ checks, parsed, pageSpeed, contact }) => {
  const items = [];
  if (!parsed.title) items.push('ページの内容が分かるtitleタグを設定しましょう。');
  else if (parsed.title.length < 10) items.push('titleタグを少し具体的にして、ページ内容が伝わるようにしましょう。');
  if (!parsed.description) items.push('検索結果で内容が伝わるように、meta descriptionを設定しましょう。');
  else if (parsed.description.length < 50) items.push('meta descriptionに、お店の特徴やサービス内容をもう少し入れましょう。');
  if (!parsed.h1Texts.length) items.push('ページの見出しとしてh1を1つ設定しましょう。');
  if (parsed.altRate < 80) items.push('画像には内容が分かるaltテキストを設定しましょう。');
  if (contact.status === 'improve') items.push('ファーストビューやヘッダー付近に予約・問い合わせボタンを設置しましょう。');
  if (pageSpeed.performance !== null && pageSpeed.performance < 60) items.push('画像サイズや不要なスクリプトを見直し、表示速度を改善しましょう。');
  if (checks.find((check) => check.id === 'links')?.status !== 'ok') items.push('空リンクや確認できないリンクがないか見直しましょう。');
  return [...new Set(items)].slice(0, 5);
};

const buildResult = async ({ input, finalUrl, html, env, debug }) => {
  const parsed = parseHtml(html, finalUrl);
  const bodyText = decodeEntities(stripTags(html));
  const [linkResult, pageSpeed] = await Promise.all([checkLinks(parsed.links), fetchPageSpeed(finalUrl, env)]);
  const contact = checkContactRoute(parsed, bodyText);

  const titleScore = parsed.title ? (parsed.title.length < 10 ? 60 : 100) : 0;
  const descriptionScore = parsed.description ? (parsed.description.length < 50 ? 60 : 100) : 0;
  const h1Score = parsed.h1Texts.length === 0 ? 0 : parsed.h1Texts.length > 3 ? 60 : 100;
  const altScore = parsed.altRate;
  const linkScore = linkResult.candidateCount === 0 ? 100 : linkResult.candidateCount <= 2 ? 60 : 20;
  const mobileValues = [pageSpeed.accessibility, pageSpeed.bestPractices].filter((value) => value !== null);
  const mobileScore = mobileValues.length ? Math.round(mobileValues.reduce((sum, value) => sum + value, 0) / mobileValues.length) : null;

  const checks = [
    makeCheck('performance', '表示速度', pageSpeed.performance, statusFromScore(pageSpeed.performance), pageSpeed.available ? `Performance ${pageSpeed.performance}点` : PAGESPEED_ERROR_MESSAGE, pageSpeed.metrics ? [`FCP: ${pageSpeed.metrics.fcp}`, `LCP: ${pageSpeed.metrics.lcp}`, `CLS: ${pageSpeed.metrics.cls}`, `Speed Index: ${pageSpeed.metrics.speedIndex}`] : ['HTML解析結果は表示しています。'], 20),
    makeCheck('mobile', 'モバイル表示', mobileScore, statusFromScore(mobileScore), mobileScore === null ? PAGESPEED_ERROR_MESSAGE : `Accessibility / Best Practices をもとに ${mobileScore}点`, pageSpeed.available ? [`Accessibility: ${pageSpeed.accessibility ?? '取得できませんでした'}`, `Best Practices: ${pageSpeed.bestPractices ?? '取得できませんでした'}`] : [], 15),
    makeCheck('seo', 'SEO基本スコア', pageSpeed.seo, statusFromScore(pageSpeed.seo), pageSpeed.seo === null ? PAGESPEED_ERROR_MESSAGE : `SEO ${pageSpeed.seo}点`, [], 15),
    makeCheck('titleDescription', 'title / description', Math.round((titleScore + descriptionScore) / 2), titleScore === 0 || descriptionScore === 0 ? 'improve' : titleScore < 100 || descriptionScore < 100 ? 'caution' : 'ok', `title ${parsed.title.length}文字 / description ${parsed.description.length}文字`, [`title: ${parsed.title || 'なし'}`, `description: ${parsed.description || 'なし'}`], 15),
    makeCheck('h1', 'h1', h1Score, h1Score === 100 ? 'ok' : h1Score === 60 ? 'caution' : 'improve', `h1は${parsed.h1Texts.length}個です。`, parsed.h1Texts.slice(0, 3).map((text) => `h1: ${text}`), 10),
    makeCheck('imageAlt', '画像alt', altScore, altScore >= 80 ? 'ok' : altScore >= 50 ? 'caution' : 'improve', `画像${parsed.imgTotal}件中、alt設定あり${parsed.imgWithAlt}件 / 未設定${parsed.imgMissingAlt}件`, [`alt設定率 ${altScore}%`], 10),
    makeCheck('links', 'リンク切れ候補', linkScore, linkScore === 100 ? 'ok' : linkScore >= 60 ? 'caution' : 'improve', `チェック対象${linkResult.checkedCount}件 / 問題あり候補${linkResult.candidateCount}件`, linkResult.candidates.map((item) => `${item.text}: ${item.url}（${item.reason}）`), 5),
    makeCheck('contactRoute', '予約・問い合わせ導線', contact.score, contact.status, contact.summary, contact.details, 10)
  ];

  const availableChecks = checks.filter((check) => check.score !== null);
  const totalWeight = availableChecks.reduce((sum, check) => sum + check.weight, 0);
  const overallScore = totalWeight ? Math.round(availableChecks.reduce((sum, check) => sum + (check.score * check.weight), 0) / totalWeight) : 0;

  const result = {
    input,
    finalUrl,
    overallScore,
    checks,
    improvements: buildImprovements({ checks, parsed, pageSpeed, contact }),
    summary: {
      ok: checks.filter((check) => check.status === 'ok').map((check) => check.label),
      caution: checks.filter((check) => check.status === 'caution' || check.status === 'unavailable').map((check) => check.status === 'unavailable' ? `${check.label}（取得できませんでした）` : check.label),
      improve: checks.filter((check) => check.status === 'improve').map((check) => check.label)
    }
  };

  if (debug.enabled && pageSpeed.error) {
    result.debug = { pageSpeed: pageSpeed.error };
  }

  return result;
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ message: '入力内容を確認できませんでした。もう一度お試しください。' }, 400);
  }

  const debug = getDebugInfo(context);
  const validation = validateTargetUrl(body.url);
  if (validation.error) return json({ message: validation.error }, 400);
  const targetUrl = validation.url;

  try {
    const response = await fetchWithTimeout(targetUrl.href, {
      redirect: 'follow',
      headers: {
        'user-agent': 'chiisakuDX-web-check/1.0',
        accept: 'text/html,application/xhtml+xml'
      }
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      return json({ message: 'サイト情報を取得できませんでした。URLが正しいか、もう一度確認してください。' }, 422);
    }
    const html = await decodeHtml(response);
    const result = await buildResult({
      input: {
        url: targetUrl.href,
        shopName: String(body.shopName || '').trim(),
        industry: String(body.industry || '').trim()
      },
      finalUrl: response.url || targetUrl.href,
      html,
      env: debug.env,
      debug
    });
    return json(result);
  } catch (error) {
    if (error.name === 'AbortError') {
      return json({ message: '診断中にタイムアウトしました。少し時間をおいて、もう一度お試しください。' }, 504);
    }
    return json({ message: 'サイト情報を取得できませんでした。URLが正しいか、もう一度確認してください。' }, 422);
  }
}
