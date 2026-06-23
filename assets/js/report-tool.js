const categories = [
  {
    id: 'homepage',
    label: 'ホームページ',
    priority: 'まずはホームページの第一印象と予約ボタンを見直しましょう。',
    questions: [
      ['heroClear', 'ファーストビューで何のお店かすぐわかる', 'ファーストビュー内に「何のお店か」「誰向けか」「予約ボタン」を置く'],
      ['serviceClear', 'サービス内容や料金がわかりやすい', 'メニューや料金を見つけやすい場所にまとめる'],
      ['contactButton', '予約・問い合わせボタンが見つけやすい', '予約ボタンをファーストビュー内に置く'],
      ['mobileReadable', 'スマホで見ても読みやすい', 'スマホで文字サイズ、余白、ボタンの押しやすさを確認する'],
      ['shopMood', 'お店の雰囲気や強みが伝わる', '写真や短い文章で、お店の雰囲気と選ばれる理由を伝える']
    ]
  },
  {
    id: 'instagram',
    label: 'Instagram',
    priority: 'まずはInstagramプロフィールと投稿内容の見え方を見直しましょう。',
    questions: [
      ['profileTarget', 'プロフィール文で誰向けのアカウントかわかる', 'Instagramプロフィールに「誰向けか」を入れる'],
      ['postConsistency', '投稿内容に統一感がある', '投稿のテーマ、色味、見出しの型をそろえる'],
      ['instaRoute', '予約や問い合わせへの導線がある', 'プロフィールからLINEや予約ページへ進めるリンクを整える'],
      ['instaMood', 'お店の強みや雰囲気が伝わる', 'お店の強みや雰囲気が伝わる投稿を増やす'],
      ['nextAction', '投稿から次の行動につながりやすい', '投稿の最後に予約、保存、相談など次の行動を添える']
    ]
  },
  {
    id: 'booking',
    label: '予約導線',
    priority: 'まずは予約・問い合わせまでの導線を見直しましょう。',
    questions: [
      ['bookingMethod', '予約方法がすぐわかる', '予約方法をページ上部やプロフィールからすぐ見える場所に置く'],
      ['bookingLink', 'LINE・予約サイト・問い合わせフォームへのリンクがわかりやすい', 'LINEや予約ページへのリンクをわかりやすくする'],
      ['fewSteps', '複数のページを移動しなくても予約に進める', '予約までのクリック数を減らす'],
      ['infoEasy', '営業時間・場所・メニューなど必要情報が見つけやすい', '営業時間、場所、メニューをひとつの案内にまとめる'],
      ['firstVisit', '初めての人でも不安なく問い合わせできる', '初めてのお客さま向けの案内を追加する']
    ]
  }
];

const answerOptions = [
  { label: 'できている', value: 2 },
  { label: '少し不安', value: 1 },
  { label: 'できていない / わからない', value: 0 }
];

const quickActions = [
  '予約ボタンやリンクをスマホの最初の画面で見える位置に置く',
  'お店の名前、業種、対象のお客さまを短い文章で書く',
  'メニュー、料金、営業時間、場所を見つけやすくまとめる',
  'Instagramプロフィールに予約先と対象のお客さまを入れる',
  '初めての方へ向けた来店前の案内を追加する'
];

const storageKey = 'chiisakudx-web-check-report';
const form = document.querySelector('#diagnosis-form');
const questionGroups = document.querySelector('#question-groups');
const resultSection = document.querySelector('#result-section');

const createQuestionGroups = () => {
  if (!questionGroups) return;
  questionGroups.innerHTML = categories.map((category) => `
    <fieldset class="question-group">
      <legend class="question-heading">${category.label}</legend>
      <div class="question-list">
        ${category.questions.map(([id, label]) => `
          <div class="question-item">
            <p class="question-title">${label}</p>
            <div class="answer-options">
              ${answerOptions.map((option) => `
                <label>
                  <input type="radio" name="${id}" value="${option.value}" required>
                  <span>${option.label}</span>
                </label>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </fieldset>
  `).join('');
};

const getFormData = () => {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = value;
  });
  return data;
};

const saveState = (data, result = null) => {
  localStorage.setItem(storageKey, JSON.stringify({ data, result }));
};

const restoreState = () => {
  const saved = localStorage.getItem(storageKey);
  if (!saved || !form) return;
  try {
    const { data, result } = JSON.parse(saved);
    Object.entries(data || {}).forEach(([key, value]) => {
      const field = form.elements[key];
      if (!field) return;
      if (field instanceof RadioNodeList) {
        field.value = value;
      } else {
        field.value = value;
      }
    });
    if (result) renderResult(result, data);
  } catch {
    localStorage.removeItem(storageKey);
  }
};

const calculateResult = (data) => {
  const categoryResults = categories.map((category) => {
    const score = category.questions.reduce((sum, [id]) => sum + Number(data[id] || 0), 0);
    const max = category.questions.length * 2;
    return { id: category.id, label: category.label, score, max, percent: Math.round((score / max) * 100), priority: category.priority };
  });

  const totalScore = categoryResults.reduce((sum, category) => sum + category.score, 0);
  const totalMax = categoryResults.reduce((sum, category) => sum + category.max, 0);
  const overall = Math.round((totalScore / totalMax) * 100);
  const weakest = [...categoryResults].sort((a, b) => a.percent - b.percent)[0];
  const lowAnswers = categories.flatMap((category) => (
    category.questions
      .filter(([id]) => Number(data[id]) < 2)
      .map(([id, label, improvement]) => ({ id, label, improvement, value: Number(data[id] || 0) }))
  )).sort((a, b) => a.value - b.value);

  return {
    overall,
    categories: categoryResults,
    priority: weakest.priority,
    improvements: [...new Set(lowAnswers.map((item) => item.improvement))].slice(0, 5)
  };
};

const getStatusMessage = (score) => {
  if (score >= 80) return 'かなり整っています。さらに伝わりやすくする余地があります。';
  if (score >= 60) return 'あと少しで、もっと伝わる状態です。優先順位を決めて見直しましょう。';
  if (score >= 40) return '伝えたいことが少し届きにくい状態です。まずは導線と見せ方を整えましょう。';
  return 'Webまわりを整理するだけで、印象が大きく変わる可能性があります。';
};

const renderList = (selector, items) => {
  const list = document.querySelector(selector);
  if (!list) return;
  list.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
};

const renderResult = (result, data) => {
  const shopName = data.shopName?.trim() || 'お店';
  document.querySelector('#result-shop-name').textContent = shopName;
  document.querySelector('#overall-score').textContent = result.overall;
  document.querySelector('.result-score').style.setProperty('--score-angle', `${result.overall * 3.6}deg`);
  document.querySelector('#status-message').textContent = getStatusMessage(result.overall);
  document.querySelector('#priority-message').textContent = result.priority;

  document.querySelector('#category-results').innerHTML = result.categories.map((category) => `
    <article class="category-card">
      <p><span>${category.label}</span><b>${category.percent}</b></p>
      <div class="meter" aria-hidden="true"><i style="width:${category.percent}%"></i></div>
    </article>
  `).join('');

  renderList('#improvement-list', result.improvements.length ? result.improvements : ['全体的に整っています。写真や文章を少し見直して、さらに伝わりやすくしましょう。']);
  renderList('#quick-list', quickActions);
  resultSection.hidden = false;
};

createQuestionGroups();
restoreState();

form?.addEventListener('input', () => {
  saveState(getFormData());
});

form?.addEventListener('change', () => {
  saveState(getFormData());
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = getFormData();
  const result = calculateResult(data);
  saveState(data, result);
  renderResult(result, data);
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.querySelector('#reset-tool')?.addEventListener('click', () => {
  form.reset();
  resultSection.hidden = true;
  localStorage.removeItem(storageKey);
});

document.querySelector('#print-report')?.addEventListener('click', () => {
  window.print();
});
