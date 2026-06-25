const storageKey = 'chiisakudx-auto-web-check-report';
const form = document.querySelector('#diagnosis-form');
const resultSection = document.querySelector('#result-section');
const loadingCard = document.querySelector('#loading-card');
const formError = document.querySelector('#form-error');

const statusLabels = {
  ok: 'OK',
  caution: '要確認',
  improve: '要改善',
  unavailable: '取得できませんでした'
};

const getFormData = () => ({
  url: form?.elements.homepageUrl.value.trim() || '',
  shopName: form?.elements.shopName.value.trim() || '',
  industry: form?.elements.industry.value.trim() || ''
});

const normalizeUrl = (value) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
};

const showError = (message) => {
  if (!formError) return;
  formError.textContent = message;
  formError.hidden = false;
};

const clearError = () => {
  if (!formError) return;
  formError.textContent = '';
  formError.hidden = true;
};

const setLoading = (isLoading) => {
  loadingCard.hidden = !isLoading;
  form?.querySelectorAll('button, input').forEach((element) => {
    element.disabled = isLoading;
  });
};

const getStatusMessage = (score) => {
  if (score >= 80) return '基本のWeb設定はかなり整っています。さらに伝わり方や予約したくなる見せ方を整えると、より良くなります。';
  if (score >= 60) return '基本は整いつつありますが、いくつか見直すともっと伝わりやすくなります。';
  if (score >= 40) return '基本設定や導線に見直しポイントがあります。まずは予約・問い合わせまでの流れを整えましょう。';
  return 'Webまわりを整理するだけで、印象が大きく変わる可能性があります。基本設定から見直すのがおすすめです。';
};

const escapeHtml = (value = '') => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const renderList = (selector, items, emptyText) => {
  const list = document.querySelector(selector);
  if (!list) return;
  const values = items.length ? items : [emptyText];
  list.innerHTML = values.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
};

const renderScoreCards = (checks) => {
  const container = document.querySelector('#category-results');
  if (!container) return;
  container.innerHTML = checks.map((check) => `
    <article class="category-card status-${check.status}">
      <p><span>${escapeHtml(check.label)}</span><b>${check.score === null ? '-' : check.score}</b></p>
      <div class="status-row"><em>${statusLabels[check.status]}</em><small>${escapeHtml(check.summary)}</small></div>
      <div class="meter" aria-hidden="true"><i style="width:${check.score || 0}%"></i></div>
    </article>
  `).join('');
};

const renderDetails = (checks) => {
  const container = document.querySelector('#check-detail-list');
  if (!container) return;
  container.innerHTML = checks.map((check) => `
    <article class="check-detail status-${check.status}">
      <div>
        <h3>${escapeHtml(check.label)}</h3>
        <span>${statusLabels[check.status]}</span>
      </div>
      <p>${escapeHtml(check.summary)}</p>
      ${check.details?.length ? `<ul>${check.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : ''}
    </article>
  `).join('');
};

const renderResult = (payload) => {
  const { input, result } = payload;
  const shopName = input.shopName || '診断サイト';
  const score = result.overallScore;

  document.querySelector('#result-shop-name').textContent = shopName;
  document.querySelector('#result-url').textContent = result.finalUrl || input.url;
  document.querySelector('#overall-score').textContent = score;
  document.querySelector('.result-score').style.setProperty('--score-angle', `${score * 3.6}deg`);
  document.querySelector('#status-message').textContent = getStatusMessage(score);

  renderScoreCards(result.checks);
  renderDetails(result.checks);
  renderList('#improvement-list', result.improvements, '大きな改善候補は見つかりませんでした。伝わり方や予約したくなる見せ方は有料レポートで詳しく確認できます。');
  renderList('#ok-list', result.summary.ok, '今回はOK項目が見つかりませんでした。');
  renderList('#caution-list', result.summary.caution, '要確認項目はありません。');
  renderList('#improve-list', result.summary.improve, '要改善項目はありません。');

  resultSection.hidden = false;
};

const saveState = (input, result) => {
  localStorage.setItem(storageKey, JSON.stringify({ input, result }));
};

const restoreState = () => {
  const saved = localStorage.getItem(storageKey);
  if (!saved || !form) return;
  try {
    const payload = JSON.parse(saved);
    form.elements.homepageUrl.value = payload.input?.url || '';
    form.elements.shopName.value = payload.input?.shopName || '';
    form.elements.industry.value = payload.input?.industry || '';
    if (payload.result) renderResult(payload);
  } catch {
    localStorage.removeItem(storageKey);
  }
};

const runDiagnosis = async (input) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('/api/check-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || 'サイト情報を取得できませんでした。URLが正しいか、もう一度確認してください。');
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('診断に時間がかかっています。少し時間をおいて、もう一度お試しください。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const input = getFormData();
  if (!input.url) {
    showError('ホームページURLを入力してください。');
    return;
  }

  const normalizedUrl = normalizeUrl(input.url);
  if (!normalizedUrl) {
    showError('URL形式が正しくありません。https:// から始まるURLを入力してください。');
    return;
  }

  const requestInput = { ...input, url: normalizedUrl };
  setLoading(true);
  resultSection.hidden = true;

  try {
    const result = await runDiagnosis(requestInput);
    const payload = { input: requestInput, result };
    saveState(requestInput, result);
    renderResult(payload);
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showError(error.message || '診断中にエラーが発生しました。時間をおいてもう一度お試しください。');
  } finally {
    setLoading(false);
  }
});

document.querySelector('#reset-tool')?.addEventListener('click', () => {
  form.reset();
  clearError();
  resultSection.hidden = true;
  localStorage.removeItem(storageKey);
});

document.querySelector('#print-report')?.addEventListener('click', () => {
  window.print();
});

restoreState();
