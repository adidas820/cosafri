import { dataService } from './data-service.js';

const THEME_KEY = 'cuaderno.theme.v1';
const $ = (selector) => document.querySelector(selector);
const ICONS = {
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5h13a2 2 0 0 1 2 2V21H6a2 2 0 0 1-2-2V4.5Z"/><path d="M4 17.5h15M8 8h7M8 12h7"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 6.5L20 11l-6.5 1.5L12 19l-1.5-6.5L4 11l6.5-1.5L12 3Z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
};

let activeQuiz = null;
let toastTimer;
let isGeneratingQuiz = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function showToast(message, duration = 3200) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

function iconTile(icon = ICONS.folder, color = '') {
  const colorAttr = color ? ` data-color="${escapeHtml(color)}"` : '';
  return `<span class="subject-art"${colorAttr}>${icon}</span>`;
}

function renderLoading(message = 'Cargando...') {
  $('#page-content').innerHTML = `<div class="loading-state"><div class="loading-spinner" aria-hidden="true"></div><p class="loading-text">${escapeHtml(message)}</p></div>`;
}

function totalTopics(catalog = []) {
  return catalog.reduce((sum, subject) => sum + subject.topics.length, 0);
}

function totalTests(catalog = []) {
  return catalog.reduce((sum, subject) => sum + subject.topics.reduce((topicSum, topic) => topicSum + topic.sections.length, 0), 0);
}

function totalQuestions(catalog = []) {
  return catalog.reduce((sum, subject) => sum + subject.topics.reduce((topicSum, topic) => topicSum + topic.sections.reduce((sectionSum, section) => sectionSum + (section.questionCount || section.questions?.length || 0), 0), 0), 0);
}

function setNavigation(section, label) {
  $('#nav-home').classList.toggle('active', section === 'home');
  $('#nav-subjects').classList.toggle('active', section === 'subjects');
  $('#nav-tests').classList.toggle('active', section === 'tests');
  $('#breadcrumb-current').textContent = label || (section === 'home' ? 'Inicio' : section === 'subjects' ? 'Asignaturas' : 'Tests');
}

async function renderSidebar() {
  const catalog = await dataService.getCatalog();
  $('#subject-count').textContent = catalog.length;
  $('#subject-list').innerHTML = catalog.map((subject) => `<a class="subject-row" href="#asignatura/${encodeURIComponent(subject.id)}"><span class="subject-dot" data-color="${escapeHtml(subject.color || '')}"></span><span>${escapeHtml(subject.name)}</span></a>`).join('');
}

function bindGenerateButtons() {
  $('#page-content').querySelectorAll('[data-open-gen-quiz]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subjectId = btn.dataset.subject || '';
      const topicId = btn.dataset.topic || '';
      openGenerateQuizModal(subjectId, topicId);
    });
  });
  $('#page-content').querySelectorAll('[data-clear-mistakes]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Seguro que quieres vaciar tu lista de preguntas falladas?')) return;
      btn.disabled = true;
      try {
        await dataService.clearMistakes(btn.dataset.subject || '');
        showToast('Lista de fallos vaciada.');
        renderRoute();
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'No se pudo vaciar la lista.', 4500);
      }
    });
  });
}

function subjectCard(subject) {
  const topicCount = subject.topics.length;
  const sectionCount = subject.topics.reduce((sum, topic) => sum + topic.sections.length, 0);
  const questionCount = subject.topics.reduce((sum, topic) => sum + topic.sections.reduce((sectionSum, section) => sectionSum + (section.questionCount || section.questions?.length || 0), 0), 0);
  return `<article class="subject-card" data-color="${escapeHtml(subject.color || '')}"><div class="subject-card-top">${iconTile(ICONS.folder, subject.color)}<div><h3>${escapeHtml(subject.name)}</h3><p>${escapeHtml(subject.description)}</p></div></div><div class="subject-card-meta"><span>${topicCount} ${topicCount === 1 ? 'temario' : 'temarios'}</span><span>${sectionCount} tests</span><span>${questionCount} preguntas</span></div><div class="subject-card-actions"><a class="primary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Abrir asignatura ${ICONS.arrow}</a><a class="secondary-button" href="#tests/${encodeURIComponent(subject.id)}">Ver tests</a><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}">${ICONS.sparkle} Test IA</button></div></article>`;
}

async function renderHome() {
  activeQuiz = null;
  setNavigation('home');
  renderLoading('Cargando tu biblioteca de estudio...');
  const catalog = await dataService.getCatalog();
  const scores = dataService.readScores();
  const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length) : 0;
  const mistakes = await dataService.getMistakes().catch(() => []);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TU BIBLIOTECA DE ESTUDIO</p><h1>Buenas, estudiante<span>.</span></h1><p>Tus asignaturas, temarios y tests están organizados en un mismo sitio.</p></div><div class="test-actions"><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz>${ICONS.sparkle} Generar test con IA</button><a class="primary-button" href="#asignaturas">Ir a mis asignaturas ${ICONS.arrow}</a></div></section>
    <section class="stats-grid"><article class="stat-card"><span class="stat-icon purple">${ICONS.folder}</span><div><span class="stat-label">Asignaturas</span><strong class="stat-number">${catalog.length}</strong><span class="stat-context">en tu biblioteca</span></div></article><article class="stat-card"><span class="stat-icon green">${ICONS.file}</span><div><span class="stat-label">Temarios</span><strong class="stat-number">${totalTopics(catalog)}</strong><span class="stat-context">listos para leer</span></div></article><article class="stat-card"><span class="stat-icon blue">${ICONS.check}</span><div><span class="stat-label">Media de tus tests</span><strong class="stat-number">${scores.length ? `${average}%` : '—'}</strong><span class="stat-context">${scores.length ? `${scores.length} tests completados` : 'empieza cuando quieras'}</span></div></article></section>
    ${reviewBanner(mistakes)}<section class="panel section-panel"><div class="panel-head"><h2>Mis asignaturas</h2><a class="text-link" href="#asignaturas">Ver biblioteca ${ICONS.arrow}</a></div><div class="subject-grid">${catalog.length ? catalog.map(subjectCard).join('') : '<div class="empty-card"><div><h3>La biblioteca está vacía</h3><p>Añade asignaturas y temarios al catálogo del repositorio.</p></div></div>'}</div></section>
    <section class="welcome-banner"><div class="banner-copy"><strong>¿Quieres practicar con preguntas nuevas sobre un tema?</strong><span>Genera un test a medida con Gemini AI eligiendo el número de preguntas y guárdalo en Supabase.</span></div><div class="test-actions"><button class="primary-button" type="button" data-open-gen-quiz>${ICONS.sparkle} Crear test con Gemini</button><a class="secondary-button" href="#tests">Explorar tests ${ICONS.arrow}</a></div></section>`;
  bindGenerateButtons();
}

function topicAccordion(subject, topic, index) {
  const qCount = topic.sections.reduce((sum, section) => sum + (section.questionCount || section.questions?.length || 0), 0);
  return `<details class="subject-accordion"><summary><span class="summary-left"><span class="topic-number">${String(index + 1).padStart(2, '0')}</span><span class="summary-title"><strong>${escapeHtml(topic.name)}</strong><span>${topic.pages} páginas · ${topic.sections.length} tests · ${qCount} preguntas</span></span></span><span class="chevron">${ICONS.chevron}</span></summary><div class="topic-list"><div class="topic-row"><a class="topic-copy" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}"><span class="topic-file-icon">${ICONS.file}</span><span><strong>Leer el temario</strong><span>Abre el PDF original dentro de la página</span></span></a><span class="topic-actions"><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Generar test con IA</button><a class="secondary-button" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">Abrir PDF ${ICONS.arrow}</a></span></div>${topic.sections.map((section, sectionIndex) => `<div class="topic-row"><span class="topic-copy"><span class="topic-number small-number">${sectionIndex + 1}</span><span><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.description)} · ${section.questionCount || section.questions?.length || 0} preguntas</span></span></span><span class="topic-actions"><a class="secondary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></span></div>`).join('')}</div></details>`;
}

async function renderSubjects() {
  activeQuiz = null;
  setNavigation('subjects');
  renderLoading('Cargando asignaturas...');
  const catalog = await dataService.getCatalog();
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TODO TU MATERIAL, EN SU SITIO</p><h1>Asignaturas</h1><p>Despliega una asignatura para ver sus temarios, abrir el PDF o generar nuevos tests con IA.</p></div><button class="primary-button" type="button" data-open-gen-quiz>${ICONS.sparkle} Generar test con IA</button></section><div class="subject-list-accordion">${catalog.map((subject) => `<details class="subject-accordion" open><summary><span class="summary-left">${iconTile(ICONS.folder, subject.color)}<span class="summary-title"><strong>${escapeHtml(subject.name)}</strong><span>${subject.topics.length} ${subject.topics.length === 1 ? 'temario' : 'temarios'} · ${escapeHtml(subject.description)}</span></span></span><span class="chevron">${ICONS.chevron}</span></summary><div class="topic-list">${subject.topics.map((topic, index) => topicAccordion(subject, topic, index)).join('')}</div></details>`).join('')}</div>`;
  bindGenerateButtons();
}

async function renderSubject(subjectId) {
  activeQuiz = null;
  renderLoading('Cargando asignatura...');
  const subject = await dataService.getSubject(subjectId);
  if (!subject) return renderSubjects();
  setNavigation('subjects', subject.name);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">ASIGNATURA</p><h1>${escapeHtml(subject.name)}</h1><p>${escapeHtml(subject.description)}</p></div><button class="primary-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}">${ICONS.sparkle} Generar test con IA</button></section><div class="subject-list-accordion">${subject.topics.map((topic, index) => topicAccordion(subject, topic, index)).join('')}</div>`;
  bindGenerateButtons();
}

async function renderTests(subjectId) {
  activeQuiz = null;
  setNavigation('tests');
  renderLoading('Cargando cuestionarios...');
  const catalog = await dataService.getCatalog();
  const selectedSubject = subjectId ? catalog.find((s) => s.id === subjectId) : null;
  const mistakes = await dataService.getMistakes().catch(() => []);
  const groups = catalog.filter((subject) => !selectedSubject || subject.id === selectedSubject.id).flatMap((subject) => subject.topics.flatMap((topic) => topic.sections.map((section) => ({ subject, topic, section }))));
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">PRACTICA CON PREGUNTAS DEL TEMARIO</p><h1>Tests</h1><p>Cuestionarios redactados a partir de tus apuntes o generados a medida con Gemini AI y sincronizados en Supabase.</p></div><button class="primary-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(selectedSubject?.id || '')}">${ICONS.sparkle} Generar nuevo test con IA</button></section>${reviewBanner(mistakes, selectedSubject?.id || '')}<div class="page-heading-actions"><label class="subject-filter"><span>Asignatura</span><select id="test-subject-filter"><option value="">Todas las asignaturas</option>${catalog.map((subject) => `<option value="${escapeHtml(subject.id)}" ${selectedSubject?.id === subject.id ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label></div><div class="test-groups">${groups.map(({ subject, topic, section }, index) => `<section class="panel test-group"><div class="test-group-head"><div><h2>${escapeHtml(section.name)}</h2><p>${escapeHtml(subject.name)} · ${escapeHtml(topic.name)} · ${escapeHtml(section.description)}</p></div><span class="test-count">${section.questionCount || section.questions?.length || 0} preguntas</span></div><div class="test-list"><div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div class="test-row-copy"><strong>Test: ${escapeHtml(section.name)}</strong><span>Selección múltiple · respuesta y explicación al momento</span></div><a class="primary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></div></div></section>`).join('')}</div>`;
  $('#test-subject-filter')?.addEventListener('change', (event) => {
    const next = event.target.value;
    location.hash = next ? `#tests/${encodeURIComponent(next)}` : '#tests';
  });
  bindGenerateButtons();
}

async function renderTopic(subjectId, topicId) {
  activeQuiz = null;
  renderLoading('Cargando temario...');
  const { subject, topic } = await dataService.getTopic(subjectId, topicId);
  if (!subject || !topic) return renderSubjects();
  setNavigation('subjects', topic.name);
  const qCount = topic.sections.reduce((sum, section) => sum + (section.questionCount || section.questions?.length || 0), 0);
  $('#page-content').innerHTML = `<section class="topic-page-head"><div><p class="eyebrow">${escapeHtml(subject.name)}</p><h1>${escapeHtml(topic.name)}</h1><p>${topic.pages} páginas · ${topic.sections.length} cuestionarios relacionados</p></div><div class="test-actions"><a class="secondary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Volver a la asignatura</a><button class="primary-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Generar test con IA</button></div></section><section class="panel pdf-panel"><div class="pdf-toolbar"><strong>${escapeHtml(topic.name)}</strong><a class="text-link" href="${escapeHtml(topic.file)}" target="_blank" rel="noreferrer">Abrir PDF en otra pestaña ${ICONS.arrow}</a></div><iframe class="pdf-frame" src="${escapeHtml(topic.file)}#toolbar=1&navpanes=0" title="${escapeHtml(topic.name)}" loading="lazy"><p class="pdf-fallback">No se pudo mostrar el PDF. <a href="${escapeHtml(topic.file)}">Ábrelo aquí</a>.</p></iframe></section><section class="panel section-panel"><div class="panel-head"><h2>Practicar este temario</h2><div class="test-actions"><span class="test-count">${topic.sections.length} tests · ${qCount} preguntas</span><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Nuevo test IA</button></div></div><div class="test-list">${topic.sections.map((section, index) => `<div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div class="test-row-copy"><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.description)} · ${section.questionCount || section.questions?.length || 0} preguntas</span></div><a class="primary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></div>`).join('')}</div></section>`;
  bindGenerateButtons();
}

async function startQuiz(subjectId, topicId, sectionId) {
  renderLoading('Cargando preguntas del test...');
  try {
    const result = await dataService.getSection(subjectId, topicId, sectionId);
    if (!result || !result.section?.questions?.length) {
      showToast('No se encontraron preguntas para este test.');
      return renderTests(subjectId);
    }
    const { subject, topic, section } = result;
    activeQuiz = {
      subject,
      topic,
      section,
      order: [...section.questions.keys()].sort(() => Math.random() - 0.5),
      index: 0,
      score: 0,
      selected: null,
      complete: false,
      mode: 'normal',
      missed: []
    };
    renderQuiz();
  } catch (err) {
    console.error('Error cargando cuestionario diferido:', err);
    showToast('No se pudieron cargar las preguntas del test.');
    renderTests(subjectId);
  }
}

function renderQuiz() {
  if (!activeQuiz) return renderTests();
  if (activeQuiz.complete) return renderQuizResult();
  const { subject, topic, section, order, index } = activeQuiz;
  const question = section.questions[order[index]];
  const answered = activeQuiz.selected !== null;
  const correct = answered && activeQuiz.selected === question.answer;
  setNavigation('tests', section.name);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">${escapeHtml(activeQuiz.mode === 'review' ? (question.origin || 'Repaso de fallos') : `${subject.name} · ${topic.name}`)}</p><h1>${escapeHtml(section.name)}<span>.</span></h1><p>Elige una respuesta. Después verás la explicación de tus apuntes.</p></div><a class="secondary-button" href="#tests/${encodeURIComponent(subject.id)}">Salir del test</a></section><section class="panel quiz-panel"><div class="quiz-meta"><span>Pregunta ${index + 1} de ${order.length}</span><span>${activeQuiz.score} ${activeQuiz.score === 1 ? 'acierto' : 'aciertos'}</span></div><div class="quiz-progress"><span style="width:${Math.round(index / order.length * 100)}%"></span></div><h2 class="quiz-question">${escapeHtml(question.question)}</h2><div class="quiz-options">${question.options.map((option, optionIndex) => {
    let state = '';
    if (answered) state = optionIndex === question.answer ? ' correct' : optionIndex === activeQuiz.selected ? ' incorrect' : ' muted';
    return `<button class="quiz-option${state}" data-option="${optionIndex}" ${answered ? 'disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span>${answered && optionIndex === question.answer ? `<span class="option-check">${ICONS.check}</span>` : ''}</button>`;
  }).join('')}</div>${answered ? `<div class="quiz-feedback ${correct ? 'is-correct' : 'is-incorrect'}"><strong>${correct ? 'Correcto' : 'Repasa esta respuesta'}</strong><span>${escapeHtml(question.explanation)}</span></div>` : ''}<div class="quiz-footer"><span class="quiz-hint">${answered ? 'Cuando quieras, sigue con la siguiente.' : 'Selecciona una respuesta para continuar.'}</span>${answered ? `<button class="primary-button" id="next-question">${index + 1 === order.length ? 'Ver resultado' : 'Siguiente pregunta'} ${ICONS.arrow}</button>` : ''}</div></section>`;
  
  $('#page-content').querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => {
    const selected = Number(button.dataset.option);
    activeQuiz.selected = selected;
    if (selected === question.answer) {
      activeQuiz.score += 1;
      // En modo repaso, acertar una pregunta la saca de la lista de fallos
      if (activeQuiz.mode === 'review') {
        dataService.resolveMistake(question.id).catch((err) => console.warn('No se pudo quitar el fallo de la lista:', err));
      }
    } else {
      activeQuiz.missed.push(question);
      dataService.recordMistake(question).catch((err) => console.warn('No se pudo guardar el fallo:', err));
    }
    renderQuiz();
  }));

  $('#next-question')?.addEventListener('click', () => {
    activeQuiz.index += 1;
    activeQuiz.selected = null;
    if (activeQuiz.index >= activeQuiz.order.length) activeQuiz.complete = true;
    renderQuiz();
  });
}

async function renderQuizResult() {
  const { subject, topic, section, score, order, mode, missed = [], reviewSubjectId = '' } = activeQuiz;
  const isReview = mode === 'review';
  const percentage = Math.round(score / order.length * 100);
  if (!isReview) {
    await dataService.saveScore({
      subject: subject.name,
      section: section.name,
      score,
      total: order.length,
      percentage,
      date: new Date().toISOString()
    });
  }
  const loggedIn = dataService.isLoggedIn();
  const missedCount = missed.length;
  setNavigation('tests', 'Resultado');

  const message = isReview
    ? (missedCount ? `Has resuelto ${score} de tus fallos. Te ${missedCount === 1 ? 'queda 1' : `quedan ${missedCount}`} por dominar.` : 'Has resuelto todas las preguntas del repaso. ¡Fuera de tu lista!')
    : (percentage >= 80 ? 'Muy buen dominio de este bloque.' : percentage >= 60 ? 'Buen repaso. Refuerza las preguntas que te han costado.' : 'Puedes volver al temario y repetir el test cuando quieras.');

  let note = '';
  if (missedCount && !loggedIn && dataService.isAuthAvailable()) {
    note = '<p class="result-note">Inicia sesión desde tu perfil para guardar tus fallos y repasarlos en cualquier dispositivo.</p>';
  } else if (missedCount && loggedIn && !isReview) {
    note = '<p class="result-note">Tus fallos se han guardado en tu lista de repaso.</p>';
  }

  const missedButton = missedCount
    ? `<button class="primary-button" type="button" id="review-missed">${ICONS.target} Repasar ${missedCount === 1 ? 'la que he fallado' : `las ${missedCount} que he fallado`}</button>`
    : '';
  const otherButtons = isReview
    ? `<a class="secondary-button" href="#tests">Volver a tests</a>`
    : `<button class="${missedCount ? 'secondary-button' : 'primary-button'}" type="button" id="retry-quiz">Repetir test ${ICONS.arrow}</button><button class="secondary-button ai-accent-button" type="button" id="gen-another-quiz">${ICONS.sparkle} Generar otro test IA</button><a class="secondary-button" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">Volver al temario</a>`;

  $('#page-content').innerHTML = `<section class="panel result-card"><span class="result-mark">${isReview ? ICONS.target : ICONS.check}</span><p class="eyebrow">${isReview ? 'REPASO COMPLETADO' : `TEST COMPLETADO · ${escapeHtml(section.name)}`}</p><h2>${score} de ${order.length} correctas</h2><p>${message}</p><div class="result-score">${percentage}%</div>${note}<div class="result-buttons">${missedButton}${otherButtons}</div></section>`;

  $('#review-missed')?.addEventListener('click', () => {
    const questions = missed.map((q) => ({ ...q, origin: q.origin || `${subject.name} · ${section.name}` }));
    launchReviewQuiz(questions, isReview ? reviewSubjectId : subject.id);
  });
  $('#retry-quiz')?.addEventListener('click', () => startQuiz(subject.id, topic.id, section.id));
  $('#gen-another-quiz')?.addEventListener('click', () => openGenerateQuizModal(subject.id, topic.id));
}

/* ============================================================================
 * REPASO DE FALLOS
 * ============================================================================ */

function reviewBanner(mistakes = [], subjectId = '') {
  if (!dataService.isLoggedIn()) return '';
  const list = subjectId ? mistakes.filter((m) => m.subjectId === subjectId) : mistakes;
  if (!list.length) return '';
  const n = list.length;
  return `<section class="review-banner"><span class="review-icon">${ICONS.target}</span><div class="banner-copy"><strong>Tienes ${n} ${n === 1 ? 'pregunta fallada pendiente' : 'preguntas falladas pendientes'} de repasar</strong><span>Cuando aciertes una en el repaso, desaparece de tu lista. Se sincroniza en todos tus dispositivos.</span></div><div class="test-actions"><button class="secondary-button" type="button" data-clear-mistakes data-subject="${escapeHtml(subjectId)}">Vaciar lista</button><a class="primary-button" href="#repaso${subjectId ? `/${encodeURIComponent(subjectId)}` : ''}">Repasar mis fallos ${ICONS.arrow}</a></div></section>`;
}

function launchReviewQuiz(questions, subjectId = '', title = 'Repaso de fallos') {
  activeQuiz = {
    mode: 'review',
    reviewSubjectId: subjectId,
    subject: { id: subjectId, name: 'Repaso' },
    topic: { id: '', name: title },
    section: { id: 'repaso', name: title, questions },
    order: [...questions.keys()],
    index: 0,
    score: 0,
    selected: null,
    complete: false,
    missed: []
  };
  renderQuiz();
}

async function startReview(subjectId = '') {
  activeQuiz = null;
  setNavigation('tests', 'Repaso de fallos');
  if (!dataService.isLoggedIn()) {
    $('#page-content').innerHTML = `<section class="panel result-card"><span class="result-mark">${ICONS.target}</span><p class="eyebrow">REPASO DE FALLOS</p><h2>Inicia sesión para guardar tus fallos</h2><p>Tus preguntas falladas se guardan en tu cuenta y puedes repasarlas desde cualquier dispositivo.</p><div class="result-buttons"><button class="primary-button" type="button" id="review-login">Iniciar sesión ${ICONS.arrow}</button><a class="secondary-button" href="#tests">Volver a tests</a></div></section>`;
    $('#review-login')?.addEventListener('click', openProfile);
    return;
  }
  renderLoading('Cargando tus preguntas falladas...');
  try {
    const all = await dataService.getMistakes(true);
    const list = subjectId ? all.filter((m) => m.subjectId === subjectId) : all;
    if (!list.length) {
      showToast('No tienes preguntas falladas pendientes.');
      location.hash = subjectId ? `#tests/${encodeURIComponent(subjectId)}` : '#tests';
      return;
    }
    // Ya vienen ordenadas: primero las que más veces has fallado
    launchReviewQuiz(list.slice(0, 30).map((m) => m.question), subjectId);
  } catch (err) {
    console.error('Error cargando el repaso de fallos:', err);
    showToast(err.message || 'No se pudieron cargar tus fallos.', 4500);
    renderTests(subjectId);
  }
}

async function renderRoute() {
  await renderSidebar();
  const parts = decodeURI(location.hash.slice(1)).split('/');
  if (!location.hash || parts[0] === 'inicio') return renderHome();
  if (parts[0] === 'asignaturas') return renderSubjects();
  if (parts[0] === 'asignatura') return renderSubject(parts[1]);
  if (parts[0] === 'temario') return renderTopic(parts[1], parts[2]);
  if (parts[0] === 'tests') return renderTests(parts[1]);
  if (parts[0] === 'test') return startQuiz(parts[1], parts[2], parts[3]);
  if (parts[0] === 'repaso') return startReview(parts[1] || '');
  return renderHome();
}

$('#nav-home').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#inicio'; });
$('#nav-subjects').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#asignaturas'; });
$('#nav-tests').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#tests'; });
window.addEventListener('hashchange', renderRoute);
$('#today-label').textContent = formatDate();

function updateProfileLabels() {
  const name = dataService.readProfile().name?.trim() || 'Mi espacio';
  $('#sidebar-profile-name').textContent = name;
  const user = dataService.getUser();
  $('#sidebar-profile-status').textContent = dataService.isLoggedIn() ? (user?.email || 'Sesión iniciada') : 'Perfil local';
  document.querySelectorAll('.profile-initial').forEach((node) => {
    node.textContent = name === 'Mi espacio' ? 'E' : name.charAt(0).toLocaleUpperCase('es');
  });
}

function renderAccountState() {
  const loggedIn = dataService.isLoggedIn();
  $('#account-box').hidden = !dataService.isAuthAvailable();
  $('#account-signed-out').hidden = loggedIn;
  $('#account-signed-in').hidden = !loggedIn;
  $('#account-email').textContent = loggedIn ? (dataService.getUser()?.email || '') : '';
  $('#profile-storage-note').textContent = loggedIn
    ? 'Tu nombre, tus notas y tus fallos se guardan en tu cuenta y se sincronizan entre dispositivos.'
    : 'Sin sesión, el nombre y el historial se guardan solo en este navegador.';
}

function setTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const toggle = $('#theme-toggle');
  toggle.setAttribute('aria-label', light ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
  toggle.innerHTML = `<span class="theme-toggle-icon" aria-hidden="true">${light ? '☾' : '☀'}</span><span class="theme-toggle-label">Tema ${light ? 'oscuro' : 'claro'}</span>`;
  try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch { /* El tema sigue activo durante esta visita. */ }
}

function openProfile() {
  const modal = $('#profile-modal');
  $('#profile-name-input').value = dataService.readProfile().name || '';
  const scores = dataService.readScores();
  const attempts = scores.length;
  const questions = scores.reduce((sum, score) => sum + (Number(score.total) || 0), 0);
  const correct = scores.reduce((sum, score) => sum + (Number(score.score) || 0), 0);
  const average = attempts ? Math.round(scores.reduce((sum, score) => sum + (Number(score.percentage) || 0), 0) / attempts) : 0;
  $('#profile-stats').innerHTML = `<article><strong>${attempts}</strong><span>tests completados</span></article><article><strong>${attempts ? `${average}%` : '—'}</strong><span>media de aciertos</span></article><article><strong>${questions ? `${correct}/${questions}` : '—'}</strong><span>respuestas correctas</span></article>`;
  renderAccountState();
  modal.hidden = false;
  $('#profile-name-input').focus();
}

function closeProfile() { $('#profile-modal').hidden = true; }

/* ============================================================================
 * MODAL DE GENERACIÓN DE TEST CON GEMINI AI
 * ============================================================================ */

async function populateGeneratorSelectors(selectedSubjectId = '', selectedTopicId = '') {
  const catalog = await dataService.getCatalog();
  const subjectSelect = $('#gen-subject-select');
  const topicSelect = $('#gen-topic-select');

  subjectSelect.innerHTML = catalog
    .map((sub) => `<option value="${escapeHtml(sub.id)}">${escapeHtml(sub.name)}</option>`)
    .join('');

  const initialSub = catalog.find((s) => s.id === selectedSubjectId) || catalog[0];
  if (initialSub) {
    subjectSelect.value = initialSub.id;
  }

  function updateTopicsForSubject(subId, preferredTopicId = '') {
    const sub = catalog.find((s) => s.id === subId) || catalog[0];
    const topics = sub?.topics || [];
    topicSelect.innerHTML = topics
      .map((top) => `<option value="${escapeHtml(top.id)}">${escapeHtml(top.name)}</option>`)
      .join('');
    if (preferredTopicId && topics.some((t) => t.id === preferredTopicId)) {
      topicSelect.value = preferredTopicId;
    } else if (topics[0]) {
      topicSelect.value = topics[0].id;
    }
  }

  updateTopicsForSubject(subjectSelect.value, selectedTopicId);

  subjectSelect.onchange = () => {
    updateTopicsForSubject(subjectSelect.value);
  };
}

function syncPresetPills(countValue) {
  const num = Number(countValue);
  document.querySelectorAll('.preset-pill').forEach((pill) => {
    pill.classList.toggle('active', Number(pill.dataset.count) === num);
  });
}

async function openGenerateQuizModal(subjectId = '', topicId = '') {
  const modal = $('#generate-quiz-modal');
  await populateGeneratorSelectors(subjectId, topicId);

  const apiKeyField = $('#gen-api-key-field');
  const apiKeyInput = $('#gen-api-key-input');
  if (dataService.hasBuildGeminiKey()) {
    apiKeyField.hidden = true;
    apiKeyInput.required = false;
  } else {
    apiKeyField.hidden = false;
    apiKeyInput.value = dataService.getGeminiApiKey();
    apiKeyInput.required = true;
  }

  $('#gen-quiz-status').hidden = true;
  $('#submit-gen-quiz').disabled = false;
  $('#cancel-gen-quiz').disabled = false;
  modal.hidden = false;
  $('#gen-question-count').focus();
}

function closeGenerateQuizModal() {
  if (isGeneratingQuiz) return;
  $('#generate-quiz-modal').hidden = true;
}

document.querySelectorAll('.preset-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const count = Number(pill.dataset.count) || 10;
    $('#gen-question-count').value = count;
    syncPresetPills(count);
  });
});

$('#gen-question-count').addEventListener('input', (event) => {
  syncPresetPills(event.target.value);
});

$('#close-gen-quiz').addEventListener('click', closeGenerateQuizModal);
$('#cancel-gen-quiz').addEventListener('click', closeGenerateQuizModal);
$('#generate-quiz-modal').addEventListener('click', (event) => {
  if (event.target.id === 'generate-quiz-modal') closeGenerateQuizModal();
});

$('#generate-quiz-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isGeneratingQuiz) return;

  const subjectId = $('#gen-subject-select').value;
  const topicId = $('#gen-topic-select').value;
  const questionCount = Number($('#gen-question-count').value) || 10;
  const customTitle = $('#gen-custom-title').value;
  const customFocus = $('#gen-custom-focus').value;
  const apiKey = $('#gen-api-key-input').value;

  const statusBox = $('#gen-quiz-status');
  const statusText = $('#gen-quiz-status-text');
  const submitBtn = $('#submit-gen-quiz');
  const cancelBtn = $('#cancel-gen-quiz');

  isGeneratingQuiz = true;
  statusBox.hidden = false;
  submitBtn.disabled = true;
  cancelBtn.disabled = true;

  try {
    const result = await dataService.generateQuizWithGemini({
      subjectId,
      topicId,
      questionCount,
      customTitle,
      customFocus,
      apiKey,
      onProgress: (msg) => {
        statusText.textContent = msg;
      }
    });

    isGeneratingQuiz = false;
    $('#generate-quiz-modal').hidden = true;
    $('#gen-custom-title').value = '';
    $('#gen-custom-focus').value = '';

    if (result.uploadedToSupabase) {
      showToast(`Test "${result.section.name}" (${result.section.questions.length} preguntas) generado y subido a Supabase.`, 4500);
    } else if (result.supabaseWarning) {
      showToast(`Test generado (${result.section.questions.length} preguntas). Aviso BD: ${result.supabaseWarning}`, 5000);
    } else {
      showToast(`Test "${result.section.name}" creado correctamente.`);
    }

    location.hash = `#test/${encodeURIComponent(result.subject.id)}/${encodeURIComponent(result.topic.id)}/${encodeURIComponent(result.section.id)}`;
  } catch (err) {
    console.error('Error al generar el test con Gemini:', err);
    isGeneratingQuiz = false;
    statusBox.hidden = true;
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    showToast(err.message || 'No se pudo generar el test con Gemini.', 4500);
  }
});

$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
$('#open-profile').addEventListener('click', openProfile);
$('#open-profile-top').addEventListener('click', openProfile);
$('#close-profile').addEventListener('click', closeProfile);
$('#profile-modal').addEventListener('click', (event) => { if (event.target.id === 'profile-modal') closeProfile(); });

$('#save-profile').addEventListener('click', () => {
  const name = $('#profile-name-input').value;
  try {
    dataService.saveProfile(name);
  } catch {
    showToast('No se pudo guardar el perfil en este navegador.');
    return;
  }
  updateProfileLabels();
  closeProfile();
  showToast('Perfil guardado.');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('#profile-modal').hidden) closeProfile();
    if (!$('#generate-quiz-modal').hidden) closeGenerateQuizModal();
  }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email) return;
  if (!password || password.length < 6) {
    showToast('Introduce una contraseña de al menos 6 caracteres, o pulsa "Enviar enlace al correo".', 5000);
    return;
  }
  const button = $('#login-submit');
  button.disabled = true;
  button.textContent = 'Entrando...';
  try {
    const res = await dataService.signInWithPassword(email, password);
    if (res.status === 'confirm_email') {
      showToast(`Te hemos enviado un correo a ${email} para confirmar tu cuenta.`, 7000);
    } else {
      $('#login-password').value = '';
      updateProfileLabels();
      openProfile();
      renderRoute();
      showToast(`Sesión iniciada como ${email}.`, 4000);
    }
  } catch (err) {
    showToast(err.message || 'No se pudo iniciar sesión.', 6000);
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar / Crear cuenta';
  }
});

$('#magic-link-button').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  if (!email) {
    showToast('Escribe tu correo primero para enviarte el enlace.', 4000);
    $('#login-email').focus();
    return;
  }
  const button = $('#magic-link-button');
  button.disabled = true;
  button.textContent = 'Enviando...';
  try {
    await dataService.sendMagicLink(email);
    showToast(`Enlace enviado a ${email}. Nota: cada enlace del correo sirve para un único uso.`, 7000);
  } catch (err) {
    showToast(err.message || 'No se pudo enviar el enlace de acceso.', 5000);
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar enlace al correo';
  }
});

$('#save-password-button').addEventListener('click', async () => {
  const newPass = $('#new-password-input').value;
  if (!newPass || newPass.length < 6) {
    showToast('La contraseña debe tener al menos 6 caracteres.', 4000);
    return;
  }
  const button = $('#save-password-button');
  button.disabled = true;
  button.textContent = 'Guardando...';
  try {
    await dataService.updatePassword(newPass);
    $('#new-password-input').value = '';
    showToast('Contraseña guardada. Ya puedes usarla para entrar desde cualquier dispositivo.', 5000);
  } catch (err) {
    showToast(err.message || 'No se pudo guardar la contraseña.', 5000);
  } finally {
    button.disabled = false;
    button.textContent = 'Guardar clave';
  }
});

$('#logout-button').addEventListener('click', async () => {
  await dataService.signOut();
  closeProfile();
  updateProfileLabels();
  showToast('Sesión cerrada.');
  renderRoute();
});

try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { setTheme('dark'); }

// Recoge la sesión si venimos del enlace mágico del email (antes de enrutar)
const authResult = await dataService.initAuth().catch((err) => {
  console.warn('No se pudo inicializar la sesión:', err);
  return {};
});
if (authResult?.error) {
  showToast(`No se pudo iniciar sesión: ${authResult.error}`, 6000);
} else if (authResult?.signedIn) {
  showToast(`Sesión iniciada como ${dataService.getUser()?.email || ''}.`, 4000);
}

// Sincronizar automáticamente con Supabase cualquier test generado antes que estuviera solo en localStorage
const migratedCount = await dataService.syncLocalGeneratedSectionsToSupabase().catch(() => 0);
if (migratedCount > 0) {
  showToast(
    `${migratedCount} ${migratedCount === 1 ? 'cuestionario local subido' : 'cuestionarios locales subidos'} automáticamente a Supabase.`,
    5000
  );
}

updateProfileLabels();
renderRoute();
