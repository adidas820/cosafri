import { catalog } from './study-data.js';

const SCORE_KEY = 'cuaderno.quiz-scores.v1';
const PROFILE_KEY = 'cuaderno.profile.v1';
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
};

let activeQuiz = null;
let toastTimer;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function getSubject(id) { return catalog.find((subject) => subject.id === id); }
function getTopic(subject, id) { return subject?.topics.find((topic) => topic.id === id); }
function getSection(subject, topicId, sectionId) { return getTopic(subject, topicId)?.sections.find((section) => section.id === sectionId); }
function readScores() {
  try { return JSON.parse(localStorage.getItem(SCORE_KEY)) || []; }
  catch { return []; }
}
function saveScore(score) {
  try {
    const scores = readScores();
    scores.unshift(score);
    localStorage.setItem(SCORE_KEY, JSON.stringify(scores.slice(0, 40)));
  } catch { showToast('El navegador no pudo guardar el resultado.'); }
}
function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}
function iconTile(icon = ICONS.folder) { return `<span class="subject-art">${icon}</span>`; }
function totalTopics() { return catalog.reduce((sum, subject) => sum + subject.topics.length, 0); }
function totalTests() { return catalog.reduce((sum, subject) => sum + subject.topics.reduce((topicSum, topic) => topicSum + topic.sections.length, 0), 0); }
function totalQuestions() { return catalog.reduce((sum, subject) => sum + subject.topics.reduce((topicSum, topic) => topicSum + topic.sections.reduce((sectionSum, section) => sectionSum + section.questions.length, 0), 0), 0); }

function setNavigation(section, label) {
  $('#nav-home').classList.toggle('active', section === 'home');
  $('#nav-subjects').classList.toggle('active', section === 'subjects');
  $('#nav-tests').classList.toggle('active', section === 'tests');
  $('#breadcrumb-current').textContent = label || (section === 'home' ? 'Inicio' : section === 'subjects' ? 'Asignaturas' : 'Tests');
}

function renderSidebar() {
  $('#subject-count').textContent = catalog.length;
  $('#subject-list').innerHTML = catalog.map((subject) => `<a class="subject-row" href="#asignatura/${encodeURIComponent(subject.id)}"><span class="subject-dot"></span><span>${escapeHtml(subject.name)}</span></a>`).join('');
}

function subjectCard(subject) {
  const topicCount = subject.topics.length;
  const sectionCount = subject.topics.reduce((sum, topic) => sum + topic.sections.length, 0);
  const questionCount = subject.topics.reduce((sum, topic) => sum + topic.sections.reduce((sectionSum, section) => sectionSum + section.questions.length, 0), 0);
  return `<article class="subject-card"><div class="subject-card-top">${iconTile()}<div><h3>${escapeHtml(subject.name)}</h3><p>${escapeHtml(subject.description)}</p></div></div><div class="subject-card-meta"><span>${topicCount} ${topicCount === 1 ? 'temario' : 'temarios'}</span><span>${sectionCount} tests</span><span>${questionCount} preguntas</span></div><div class="subject-card-actions"><a class="primary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Abrir asignatura ${ICONS.arrow}</a><a class="secondary-button" href="#tests/${encodeURIComponent(subject.id)}">Ver tests</a></div></article>`;
}

function renderHome() {
  activeQuiz = null;
  setNavigation('home');
  const scores = readScores();
  const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length) : 0;
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TU BIBLIOTECA DE ESTUDIO</p><h1>Buenas, estudiante<span>.</span></h1><p>Tus asignaturas, temarios y tests están organizados en un mismo sitio.</p></div><a class="primary-button" href="#asignaturas">Ir a mis asignaturas ${ICONS.arrow}</a></section>
    <section class="stats-grid"><article class="stat-card"><span class="stat-icon purple">${ICONS.folder}</span><div><span class="stat-label">Asignaturas</span><strong class="stat-number">${catalog.length}</strong><span class="stat-context">en tu biblioteca</span></div></article><article class="stat-card"><span class="stat-icon green">${ICONS.file}</span><div><span class="stat-label">Temarios</span><strong class="stat-number">${totalTopics()}</strong><span class="stat-context">listos para leer</span></div></article><article class="stat-card"><span class="stat-icon blue">${ICONS.check}</span><div><span class="stat-label">Media de tus tests</span><strong class="stat-number">${scores.length ? `${average}%` : '—'}</strong><span class="stat-context">${scores.length ? `${scores.length} tests completados` : 'empieza cuando quieras'}</span></div></article></section>
    <section class="panel section-panel"><div class="panel-head"><h2>Mis asignaturas</h2><a class="text-link" href="#asignaturas">Ver biblioteca ${ICONS.arrow}</a></div><div class="subject-grid">${catalog.length ? catalog.map(subjectCard).join('') : '<div class="empty-card"><div><h3>La biblioteca está vacía</h3><p>Añade asignaturas y temarios al catálogo del repositorio.</p></div></div>'}</div></section>
    <section class="welcome-banner"><div class="banner-copy"><strong>Un repaso, un concepto cada vez.</strong><span>Elige una asignatura para abrir el PDF o practicar con un test concreto.</span></div><a class="secondary-button" href="#tests">Explorar tests ${ICONS.arrow}</a></section>`;
}

function topicAccordion(subject, topic, index) {
  return `<details class="subject-accordion"><summary><span class="summary-left"><span class="topic-number">${String(index + 1).padStart(2, '0')}</span><span class="summary-title"><strong>${escapeHtml(topic.name)}</strong><span>${topic.pages} páginas · ${topic.sections.length} tests · ${topic.sections.reduce((sum, section) => sum + section.questions.length, 0)} preguntas</span></span></span><span class="chevron">${ICONS.chevron}</span></summary><div class="topic-list"><a class="topic-row-link" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}"><span class="topic-copy"><span class="topic-file-icon">${ICONS.file}</span><span><strong>Leer el temario</strong><span>Abre el PDF original dentro de la página</span></span></span><span class="row-arrow">${ICONS.arrow}</span></a>${topic.sections.map((section, sectionIndex) => `<div class="topic-row"><span class="topic-copy"><span class="topic-number small-number">${sectionIndex + 1}</span><span><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.description)} · ${section.questions.length} preguntas</span></span></span><span class="topic-actions"><a class="secondary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></span></div>`).join('')}</div></details>`;
}

function renderSubjects() {
  activeQuiz = null;
  setNavigation('subjects');
  $('#page-content').innerHTML = `<section class="page-title"><p class="eyebrow">TODO TU MATERIAL, EN SU SITIO</p><h1>Asignaturas</h1><p>Despliega una asignatura para ver sus temarios y los tests disponibles en cada uno.</p></section><div class="subject-list-accordion">${catalog.map((subject) => `<details class="subject-accordion" open><summary><span class="summary-left">${iconTile()}<span class="summary-title"><strong>${escapeHtml(subject.name)}</strong><span>${subject.topics.length} ${subject.topics.length === 1 ? 'temario' : 'temarios'} · ${subject.description}</span></span></span><span class="chevron">${ICONS.chevron}</span></summary><div class="topic-list">${subject.topics.map((topic, index) => topicAccordion(subject, topic, index)).join('')}</div></details>`)}</div>`;
}

function renderSubject(subjectId) {
  activeQuiz = null;
  const subject = getSubject(subjectId);
  if (!subject) return renderSubjects();
  setNavigation('subjects', subject.name);
  $('#page-content').innerHTML = `<section class="page-title"><p class="eyebrow">ASIGNATURA</p><h1>${escapeHtml(subject.name)}</h1><p>${escapeHtml(subject.description)}</p></section><div class="subject-list-accordion">${subject.topics.map((topic, index) => topicAccordion(subject, topic, index)).join('')}</div>`;
}

function renderTests(subjectId) {
  activeQuiz = null;
  const selectedSubject = getSubject(subjectId);
  setNavigation('tests');
  const groups = catalog.filter((subject) => !selectedSubject || subject.id === selectedSubject.id).flatMap((subject) => subject.topics.flatMap((topic) => topic.sections.map((section) => ({ subject, topic, section }))));
  $('#page-content').innerHTML = `<section class="page-title"><p class="eyebrow">PRACTICA CON PREGUNTAS DEL TEMARIO</p><h1>Tests</h1><p>Cuestionarios redactados a partir de tus apuntes. Cada respuesta incluye una explicación para repasar el concepto.</p></section><div class="page-heading-actions"><label class="subject-filter"><span>Asignatura</span><select id="test-subject-filter"><option value="">Todas las asignaturas</option>${catalog.map((subject) => `<option value="${escapeHtml(subject.id)}" ${selectedSubject?.id === subject.id ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label></div><div class="test-groups">${groups.map(({ subject, topic, section }, index) => `<section class="panel test-group"><div class="test-group-head"><div><h2>${escapeHtml(section.name)}</h2><p>${escapeHtml(subject.name)} · ${escapeHtml(topic.name)} · ${escapeHtml(section.description)}</p></div><span class="test-count">${section.questions.length} preguntas</span></div><div class="test-list"><div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div class="test-row-copy"><strong>Test: ${escapeHtml(section.name)}</strong><span>Selección múltiple · respuesta y explicación al momento</span></div><a class="primary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></div></div></section>`).join('')}</div>`;
  $('#test-subject-filter').addEventListener('change', (event) => {
    const next = event.target.value;
    location.hash = next ? `#tests/${encodeURIComponent(next)}` : '#tests';
    renderTests(next);
  });
}

function renderTopic(subjectId, topicId) {
  activeQuiz = null;
  const subject = getSubject(subjectId);
  const topic = getTopic(subject, topicId);
  if (!subject || !topic) return renderSubjects();
  setNavigation('subjects', topic.name);
  $('#page-content').innerHTML = `<section class="topic-page-head"><div><p class="eyebrow">${escapeHtml(subject.name)}</p><h1>${escapeHtml(topic.name)}</h1><p>${topic.pages} páginas · ${topic.sections.length} cuestionarios relacionados</p></div><div class="test-actions"><a class="secondary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Volver a la asignatura</a><a class="primary-button" href="#tests/${encodeURIComponent(subject.id)}">Ver tests ${ICONS.arrow}</a></div></section><section class="panel pdf-panel"><div class="pdf-toolbar"><strong>${escapeHtml(topic.name)}</strong><a class="text-link" href="${escapeHtml(topic.file)}" target="_blank" rel="noreferrer">Abrir PDF en otra pestaña ${ICONS.arrow}</a></div><iframe class="pdf-frame" src="${escapeHtml(topic.file)}#toolbar=1&navpanes=0" title="${escapeHtml(topic.name)}" loading="lazy"><p class="pdf-fallback">No se pudo mostrar el PDF. <a href="${escapeHtml(topic.file)}">Ábrelo aquí</a>.</p></iframe></section><section class="panel section-panel"><div class="panel-head"><h2>Practicar este temario</h2><span class="test-count">${topic.sections.length} tests · ${topic.sections.reduce((sum, section) => sum + section.questions.length, 0)} preguntas</span></div><div class="test-list">${topic.sections.map((section, index) => `<div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div class="test-row-copy"><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.description)} · ${section.questions.length} preguntas</span></div><a class="primary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></div>`).join('')}</div></section>`;
}

function startQuiz(subjectId, topicId, sectionId) {
  const subject = getSubject(subjectId);
  const topic = getTopic(subject, topicId);
  const section = getSection(subject, topicId, sectionId);
  if (!subject || !topic || !section) return renderTests();
  activeQuiz = { subject, topic, section, order: [...section.questions.keys()].sort(() => Math.random() - 0.5), index: 0, score: 0, selected: null, complete: false };
  renderQuiz();
}

function renderQuiz() {
  if (!activeQuiz) return renderTests();
  if (activeQuiz.complete) return renderQuizResult();
  const { subject, topic, section, order, index } = activeQuiz;
  const question = section.questions[order[index]];
  const answered = activeQuiz.selected !== null;
  const correct = answered && activeQuiz.selected === question.answer;
  setNavigation('tests', section.name);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">${escapeHtml(subject.name)} · ${escapeHtml(topic.name)}</p><h1>${escapeHtml(section.name)}<span>.</span></h1><p>Elige una respuesta. Después verás la explicación de tus apuntes.</p></div><a class="secondary-button" href="#tests/${encodeURIComponent(subject.id)}">Salir del test</a></section><section class="panel quiz-panel"><div class="quiz-meta"><span>Pregunta ${index + 1} de ${order.length}</span><span>${activeQuiz.score} ${activeQuiz.score === 1 ? 'acierto' : 'aciertos'}</span></div><div class="quiz-progress"><span style="width:${Math.round(index / order.length * 100)}%"></span></div><h2 class="quiz-question">${escapeHtml(question.question)}</h2><div class="quiz-options">${question.options.map((option, optionIndex) => {
    let state = '';
    if (answered) state = optionIndex === question.answer ? ' correct' : optionIndex === activeQuiz.selected ? ' incorrect' : ' muted';
    return `<button class="quiz-option${state}" data-option="${optionIndex}" ${answered ? 'disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span>${answered && optionIndex === question.answer ? `<span class="option-check">${ICONS.check}</span>` : ''}</button>`;
  }).join('')}</div>${answered ? `<div class="quiz-feedback ${correct ? 'is-correct' : 'is-incorrect'}"><strong>${correct ? 'Correcto' : 'Repasa esta respuesta'}</strong><span>${escapeHtml(question.explanation)}</span></div>` : ''}<div class="quiz-footer"><span class="quiz-hint">${answered ? 'Cuando quieras, sigue con la siguiente.' : 'Selecciona una respuesta para continuar.'}</span>${answered ? `<button class="primary-button" id="next-question">${index + 1 === order.length ? 'Ver resultado' : 'Siguiente pregunta'} ${ICONS.arrow}</button>` : ''}</div></section>`;
  $('#page-content').querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => {
    const selected = Number(button.dataset.option);
    activeQuiz.selected = selected;
    if (selected === question.answer) activeQuiz.score += 1;
    renderQuiz();
  }));
  $('#next-question')?.addEventListener('click', () => {
    activeQuiz.index += 1;
    activeQuiz.selected = null;
    if (activeQuiz.index >= activeQuiz.order.length) activeQuiz.complete = true;
    renderQuiz();
  });
}

function renderQuizResult() {
  const { subject, topic, section, score, order } = activeQuiz;
  const percentage = Math.round(score / order.length * 100);
  saveScore({ subject: subject.name, section: section.name, score, total: order.length, percentage, date: new Date().toISOString() });
  setNavigation('tests', 'Resultado');
  $('#page-content').innerHTML = `<section class="panel result-card"><span class="result-mark">${ICONS.check}</span><p class="eyebrow">TEST COMPLETADO · ${escapeHtml(section.name)}</p><h2>${score} de ${order.length} correctas</h2><p>${percentage >= 80 ? 'Muy buen dominio de este bloque.' : percentage >= 60 ? 'Buen repaso. Refuerza las preguntas que te han costado.' : 'Puedes volver al temario y repetir el test cuando quieras.'}</p><div class="result-score">${percentage}%</div><div class="result-buttons"><button class="primary-button" id="retry-quiz">Repetir test ${ICONS.arrow}</button><a class="secondary-button" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">Volver al temario</a></div></section>`;
  $('#retry-quiz').addEventListener('click', () => startQuiz(subject.id, topic.id, section.id));
}

function renderRoute() {
  renderSidebar();
  const parts = decodeURI(location.hash.slice(1)).split('/');
  if (!location.hash || parts[0] === 'inicio') return renderHome();
  if (parts[0] === 'asignaturas') return renderSubjects();
  if (parts[0] === 'asignatura') return renderSubject(parts[1]);
  if (parts[0] === 'temario') return renderTopic(parts[1], parts[2]);
  if (parts[0] === 'tests') return renderTests(parts[1]);
  if (parts[0] === 'test') return startQuiz(parts[1], parts[2], parts[3]);
  return renderHome();
}

$('#nav-home').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#inicio'; renderHome(); });
$('#nav-subjects').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#asignaturas'; renderSubjects(); });
$('#nav-tests').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#tests'; renderTests(); });
window.addEventListener('hashchange', renderRoute);
$('#today-label').textContent = formatDate();
function readProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || { name: '' }; }
  catch { return { name: '' }; }
}
function updateProfileLabels() {
  const name = readProfile().name?.trim() || 'Mi espacio';
  $('#sidebar-profile-name').textContent = name;
  document.querySelectorAll('.profile-initial').forEach((node) => { node.textContent = name === 'Mi espacio' ? 'E' : name.charAt(0).toLocaleUpperCase('es'); });
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
  $('#profile-name-input').value = readProfile().name || '';
  const scores = readScores();
  const attempts = scores.length;
  const questions = scores.reduce((sum, score) => sum + (Number(score.total) || 0), 0);
  const correct = scores.reduce((sum, score) => sum + (Number(score.score) || 0), 0);
  const average = attempts ? Math.round(scores.reduce((sum, score) => sum + (Number(score.percentage) || 0), 0) / attempts) : 0;
  $('#profile-stats').innerHTML = `<article><strong>${attempts}</strong><span>tests completados</span></article><article><strong>${attempts ? `${average}%` : '—'}</strong><span>media de aciertos</span></article><article><strong>${questions ? `${correct}/${questions}` : '—'}</strong><span>respuestas correctas</span></article>`;
  modal.hidden = false;
  $('#profile-name-input').focus();
}
function closeProfile() { $('#profile-modal').hidden = true; }
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
$('#open-profile').addEventListener('click', openProfile);
$('#open-profile-top').addEventListener('click', openProfile);
$('#close-profile').addEventListener('click', closeProfile);
$('#profile-modal').addEventListener('click', (event) => { if (event.target.id === 'profile-modal') closeProfile(); });
$('#save-profile').addEventListener('click', () => {
  const name = $('#profile-name-input').value.trim();
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name })); }
  catch { showToast('No se pudo guardar el perfil en este navegador.'); return; }
  updateProfileLabels();
  closeProfile();
  showToast('Perfil guardado.');
});
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#profile-modal').hidden) closeProfile(); });
try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { setTheme('dark'); }
updateProfileLabels();
renderRoute();
