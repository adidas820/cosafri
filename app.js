const STORAGE_KEY = 'cuaderno.study.v1';
const COLORS = [
  { bg: '#edf2eb', color: '#68836a' },
  { bg: '#f7eee5', color: '#ac8051' },
  { bg: '#edf1f5', color: '#718b9e' },
  { bg: '#f4edf3', color: '#9b7e98' },
  { bg: '#eef1e7', color: '#8a946b' },
];
const ICONS = {
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5h13a2 2 0 0 1 2 2V21H6a2 2 0 0 1-2-2V4.5Z"/><path d="M4 17.5h15M8 8h7M8 12h7"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 6.5L20 11l-6.5 1.5L12 19l-1.5-6.5L4 11l6.5-1.5L12 3Z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.3 4.3"/></svg>',
};

const $ = (selector) => document.querySelector(selector);
const state = loadState();
let activeStudy = null;
let activeTest = null;
let toastTimer;
let pdfModulePromise;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.documents)) return { documents: saved.documents, activeId: saved.activeId || null };
  } catch (error) {
    console.warn('No se pudo leer el progreso guardado.', error);
  }
  return { documents: [], activeId: null };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showToast('El navegador se ha quedado sin espacio para guardar.');
    console.warn('No se pudo guardar el progreso.', error);
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function colorFor(index) { return COLORS[index % COLORS.length]; }
function docIndex(document) { return state.documents.findIndex((item) => item.id === document.id); }
function getDocument(id = state.activeId) { return state.documents.find((document) => document.id === id); }
function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2900);
}

function cleanText(text) {
  return text
    .replace(/-\s*\n\s*/g, '')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/([^.!?\n])\n(?!\s*(?:\d+(?:\.\d+)*\.?\s+|[A-ZÁÉÍÓÚÑ][^.!?\n]{0,65}:\s*$))/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function splitSentences(text) {
  const chunks = cleanText(text).match(/[^.!?\n]+(?:[.!?]+|$)/g) || [];
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => {
    const words = chunk.split(/\s+/).filter(Boolean);
    return words.length >= 8 && words.length <= 80 && /[a-záéíóúñ]/i.test(chunk);
  });
}

function normalizeForDuplicate(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function makeQuestions(text) {
  const sentences = splitSentences(text);
  const seen = new Set();
  const questions = [];
  const definition = /^(.{2,90}?)\s+(?:es|son|se define como|se entiende por|consiste en|se caracteriza por|incluye|comprende|permite|designa|representa|corresponde a|significa)\s+(.{15,})$/i;

  for (const sentence of sentences) {
    const normalized = normalizeForDuplicate(sentence);
    if (normalized.length < 48 || seen.has(normalized)) continue;
    seen.add(normalized);

    const match = sentence.match(definition);
    if (match && match[1].split(/\s+/).length <= 11) {
      const concept = match[1].replace(/^[\s\d.()-]+/, '').trim();
      questions.push({ prompt: `¿Cómo define el temario «${concept}»?`, answer: match[2].trim(), type: 'Definición' });
      continue;
    }

    const words = sentence.split(/\s+/);
    const title = words.slice(0, 7).join(' ').replace(/[,:;–-]+$/, '');
    const opening = words.slice(0, 13).join(' ');
    questions.push({
      prompt: `¿Qué explica el temario sobre «${title}${words.length > 7 ? '…' : ''}»?`,
      answer: sentence,
      type: 'Idea clave',
      hint: opening,
    });
  }

  return questions.slice(0, 80);
}

async function getPdfJs() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs')
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';
        return pdfjsLib;
      })
      .catch((error) => {
        pdfModulePromise = null;
        throw new Error('No se pudo cargar el lector de PDF. Comprueba tu conexión a internet y vuelve a intentarlo.', { cause: error });
      });
  }
  return pdfModulePromise;
}

async function extractPdf(file) {
  const pdfjsLib = await getPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let line = '';
    let previousY = null;
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform?.[5] ?? previousY;
      if (previousY !== null && y !== null && Math.abs(y - previousY) > 4 && line.trim()) {
        lines.push(line.trim());
        line = '';
      }
      line += `${item.str}${item.hasEOL ? '\n' : ' '}`;
      previousY = y;
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.join('\n'));
  }
  return { text: cleanText(pages.join('\n\n')), pages: pdf.numPages };
}

function setActive(id) {
  state.activeId = id;
  saveState();
  renderSidebar();
}

function makeSubjectIcon(index, large = false) {
  const color = colorFor(index);
  return `<span class="subject-icon${large ? ' large' : ''}" style="background:${color.bg};color:${color.color}">${ICONS.book}</span>`;
}

function renderSidebar() {
  $('#nav-count').textContent = state.documents.length;
  const list = $('#subject-list');
  list.innerHTML = state.documents.map((document, index) => `
    <button class="subject-row${state.activeId === document.id ? ' selected' : ''}" data-open-document="${escapeHtml(document.id)}" title="${escapeHtml(document.name)}">
      ${makeSubjectIcon(index)}<span class="subject-name">${escapeHtml(document.name)}</span><span class="subject-num">${document.questions.length}</span>
    </button>`).join('');
  list.querySelectorAll('[data-open-document]').forEach((button) => button.addEventListener('click', () => openDocument(button.dataset.openDocument)));
}

function setNavigation(section) {
  $('#nav-home').classList.toggle('active', section === 'home');
  $('#nav-library').classList.toggle('active', section === 'library');
  $('#nav-tests').classList.toggle('active', section === 'tests');
  $('#breadcrumb-current').textContent = section === 'library' ? 'Mis temarios' : section === 'tests' ? 'Tests' : section === 'syllabus' ? 'Temario' : section === 'study' ? 'Sesión de estudio' : 'Inicio';
}

function renderHome() {
  setNavigation('home');
  const totalQuestions = state.documents.reduce((total, document) => total + document.questions.length, 0);
  const sessions = state.documents.reduce((total, document) => total + (document.sessions || 0), 0);
  const cards = state.documents.length ? state.documents.map((document) => {
    const index = docIndex(document);
    const progress = document.questions.length ? Math.round((document.mastered || 0) / document.questions.length * 100) : 0;
    return `<article class="subject-card" data-open-document="${escapeHtml(document.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(document.name)}">
      <div class="card-top">${makeSubjectIcon(index, true)}<button class="more-button" data-remove-document="${escapeHtml(document.id)}" aria-label="Eliminar ${escapeHtml(document.name)}" title="Eliminar temario">···</button></div>
      <h3>${escapeHtml(document.name)}</h3><span class="source-name">${escapeHtml(document.fileName)}</span>
      <div class="subject-card-bottom"><span class="question-count">${document.questions.length} preguntas</span><span class="question-count">${progress}% dominado</span></div>
      <div class="progress-line"><span style="width:${progress}%"></span></div>
      <div class="subject-card-links"><button data-view-syllabus="${escapeHtml(document.id)}">Ver temario</button><button data-view-tests="${escapeHtml(document.id)}">Hacer tests ${ICONS.arrow}</button></div>
    </article>`;
  }).join('') : `<div class="empty-card"><div class="empty-card-content"><div class="empty-art">${ICONS.book}</div><h3>Tu mesa de estudio está lista</h3><p>Añade el primer PDF de la universidad y empezamos a crear tu plan de repaso.</p><button class="secondary-button compact" data-action="upload">${ICONS.arrow} Añadir mi primer PDF</button></div></div>`;

  $('#page-content').innerHTML = `
    <section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TU ESPACIO DE ESTUDIO</p><h1>Hola, estudiante<span>.</span></h1><p>Un tema cada vez. Vas avanzando muy bien.</p></div><button class="primary-button" data-action="upload">${ICONS.book} Añadir temario</button></section>
    <section class="stats-grid" aria-label="Tu actividad"><article class="stat-card"><span class="stat-icon green">${ICONS.book}</span><div class="stat-text"><span class="stat-label">Temarios guardados</span><div><strong class="stat-number">${state.documents.length}</strong><span class="stat-context">${state.documents.length === 1 ? 'materia' : 'materias'}</span></div></div></article><article class="stat-card"><span class="stat-icon amber">${ICONS.sparkle}</span><div class="stat-text"><span class="stat-label">Preguntas preparadas</span><div><strong class="stat-number">${totalQuestions}</strong><span class="stat-context">para repasar</span></div></div></article><article class="stat-card"><span class="stat-icon blue">${ICONS.clock}</span><div class="stat-text"><span class="stat-label">Sesiones completadas</span><div><strong class="stat-number">${sessions}</strong><span class="stat-context">${sessions === 1 ? 'sesión' : 'sesiones'}</span></div></div></article></section>
    <section class="panel"><div class="panel-head"><h2>Mis materias</h2><a class="text-link" href="#temarios" data-go-library>Ver todas ${ICONS.arrow}</a></div><div class="subject-grid">${cards}</div></section>
    ${state.documents.length ? `<section class="study-banner"><div class="banner-left"><span class="banner-symbol">${ICONS.sparkle}</span><div class="banner-copy"><strong>Un repaso corto también cuenta.</strong><span>Empieza con unas preguntas y sigue a tu ritmo.</span></div></div><button class="secondary-button compact" data-action="study-any">Empezar a estudiar ${ICONS.arrow}</button></section>` : ''}`;

  $('#page-content').querySelectorAll('[data-open-document]').forEach((element) => {
    const open = () => openDocument(element.dataset.openDocument);
    element.addEventListener('click', (event) => { if (!event.target.closest('[data-remove-document]')) open(); });
    if (element.matches('[tabindex]')) element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
  bindCommonActions();
}

function renderLibrary(filter = '') {
  setNavigation('library');
  const normalizedFilter = filter.trim().toLocaleLowerCase('es');
  const documents = state.documents.filter((document) => `${document.name} ${document.fileName}`.toLocaleLowerCase('es').includes(normalizedFilter));
  $('#page-content').innerHTML = `<section class="library-title"><p class="eyebrow">TODO TU MATERIAL</p><h1>Mis temarios</h1><p>Un espacio para tener a mano cada asignatura y su progreso.</p></section><section class="panel"><div class="panel-head"><h2>${state.documents.length} ${state.documents.length === 1 ? 'temario' : 'temarios'}</h2><button class="primary-button" data-action="upload">${ICONS.book} Añadir PDF</button></div><div class="library-tools"><label class="search-box">${ICONS.search}<input id="library-search" type="search" placeholder="Buscar un temario…" value="${escapeHtml(filter)}" /></label></div><div class="library-card-list">${documents.length ? documents.map((document) => {
    const index = docIndex(document);
    const progress = document.questions.length ? Math.round((document.mastered || 0) / document.questions.length * 100) : 0;
    return `<article class="library-row"><button class="subject-row" data-open-document="${escapeHtml(document.id)}" style="padding:0;flex:1">${makeSubjectIcon(index)}<span class="library-row-copy"><strong>${escapeHtml(document.name)}</strong><span>${escapeHtml(document.fileName)} · ${document.questions.length} preguntas · ${progress}% dominado</span></span></button><div class="library-row-actions"><button class="secondary-button compact" data-view-syllabus="${escapeHtml(document.id)}">Temario</button><button class="secondary-button compact" data-view-tests="${escapeHtml(document.id)}">Tests</button><button class="secondary-button compact" data-study-document="${escapeHtml(document.id)}">Estudiar ${ICONS.arrow}</button><button class="more-button" data-remove-document="${escapeHtml(document.id)}" aria-label="Eliminar temario">···</button></div></article>`;
  }).join('') : `<div class="empty-card"><div class="empty-card-content"><h3>${state.documents.length ? 'No encontramos ese temario' : 'Aún no hay temarios'}</h3><p>${state.documents.length ? 'Prueba con otro nombre.' : 'Añade un PDF para empezar a preparar preguntas.'}</p>${state.documents.length ? '' : '<button class="secondary-button compact" data-action="upload">Añadir un PDF</button>'}</div></div>`}</div></section>`;
  $('#library-search')?.addEventListener('input', (event) => renderLibrary(event.target.value));
  bindCommonActions();
}

function openDocument(id) {
  const document = getDocument(id);
  if (!document) return;
  setActive(id);
  renderStudy(id, true);
}

function readingParagraphs(text) {
  const sentences = (text.match(/[^.!?]+(?:[.!?]+|$)/g) || []).map((sentence) => sentence.trim()).filter(Boolean);
  const paragraphs = [];
  for (let index = 0; index < sentences.length; index += 4) paragraphs.push(sentences.slice(index, index + 4).join(' '));
  return paragraphs;
}

function renderSyllabus(documentId, filter = '') {
  const document = getDocument(documentId);
  if (!document) return renderHome();
  history.replaceState(null, '', `#temario/${encodeURIComponent(document.id)}`);
  setActive(document.id);
  setNavigation('syllabus');
  const normalizedFilter = filter.trim().toLocaleLowerCase('es');
  const paragraphs = readingParagraphs(document.text || '').filter((paragraph) => paragraph.toLocaleLowerCase('es').includes(normalizedFilter));
  const position = docIndex(document);
  $('#page-content').innerHTML = `<section class="syllabus-header"><div><p class="eyebrow">LECTURA DEL TEMARIO</p><h1>${escapeHtml(document.name)}</h1><p>${escapeHtml(document.fileName)} · ${document.pages || '—'} páginas · Texto extraído en este navegador</p></div><div class="syllabus-actions">${document.sourcePath ? `<a class="secondary-button" href="${escapeHtml(document.sourcePath)}" target="_blank" rel="noreferrer">Abrir PDF original ${ICONS.arrow}</a>` : ''}<button class="secondary-button" data-view-tests="${escapeHtml(document.id)}">Hacer tests ${ICONS.arrow}</button><button class="primary-button" data-study-document="${escapeHtml(document.id)}">Estudiar ${ICONS.sparkle}</button></div></section><section class="syllabus-layout"><aside class="panel syllabus-toc"><p class="eyebrow">EN ESTE TEMA</p><strong>${escapeHtml(document.name)}</strong><span>${paragraphs.length} bloques de lectura</span><button class="text-link" data-view-tests="${escapeHtml(document.id)}">Ir a los tests ${ICONS.arrow}</button></aside><article class="panel syllabus-reader"><div class="reader-toolbar"><h2>Apuntes</h2><label class="search-box">${ICONS.search}<input id="syllabus-search" type="search" placeholder="Buscar en el temario…" value="${escapeHtml(filter)}" /></label></div><div class="syllabus-text">${paragraphs.length ? paragraphs.map((paragraph, index) => `<section class="reading-block"><span class="reading-number">${String(index + 1).padStart(2, '0')}</span><p>${escapeHtml(paragraph)}</p></section>`).join('') : '<p class="no-results">No hay fragmentos que coincidan con esa búsqueda.</p>'}</div></article></section>`;
  $('#syllabus-search')?.addEventListener('input', (event) => {
    const input = event.target;
    const cursor = input.selectionStart;
    renderSyllabus(document.id, input.value);
    const nextInput = $('#syllabus-search');
    nextInput?.focus();
    nextInput?.setSelectionRange(cursor, cursor);
  });
}

function renderTests(documentId) {
  const document = getDocument(documentId || state.activeId) || state.documents[0];
  history.replaceState(null, '', document ? `#tests/${encodeURIComponent(document.id)}` : '#tests');
  setNavigation('tests');
  if (document) setActive(document.id);
  else renderSidebar();
  if (!document) {
    $('#page-content').innerHTML = `<section class="library-title"><p class="eyebrow">PRACTICA Y COMPRUEBA</p><h1>Tests</h1><p>Añade un PDF para generar pruebas a partir de tus apuntes.</p><button class="primary-button" data-action="upload">${ICONS.book} Añadir temario</button></section>`;
    bindCommonActions();
    return;
  }
  const count = document.questions.length;
  const tests = [
    { size: Math.min(5, count), title: 'Test rápido', description: 'Un repaso breve para empezar.', tag: `${Math.min(5, count)} preguntas` },
    { size: Math.min(10, count), title: 'Repaso del tema', description: 'Comprueba las ideas principales.', tag: `${Math.min(10, count)} preguntas` },
    { size: count, title: 'Simulacro completo', description: 'Recorre todas las preguntas disponibles.', tag: `${count} preguntas` },
  ];
  const uniqueTests = tests.filter((test, index) => test.size > 0 && tests.findIndex((item) => item.size === test.size) === index);
  const docPosition = docIndex(document);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">PRACTICA Y COMPRUEBA</p><h1>Tests de <span>${escapeHtml(document.name)}.</span></h1><p>Elige una prueba. Las preguntas y opciones se basan en el texto de tus apuntes.</p></div><button class="secondary-button" data-view-syllabus="${escapeHtml(document.id)}">${ICONS.book} Ver temario</button></section><div class="test-subject-bar">${makeSubjectIcon(docPosition)}<span>Temario activo: <strong>${escapeHtml(document.name)}</strong></span>${state.documents.length > 1 ? `<select id="test-document-select" aria-label="Seleccionar temario">${state.documents.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === document.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>` : ''}</div><section class="test-grid">${uniqueTests.map((test, index) => `<article class="panel test-card"><div class="test-card-top"><span class="test-icon test-icon-${index}">${index === 0 ? ICONS.clock : index === 1 ? ICONS.book : ICONS.sparkle}</span><span class="test-count">${test.tag}</span></div><h2>${test.title}</h2><p>${test.description}</p><button class="primary-button" data-start-test="${test.size}">Empezar test ${ICONS.arrow}</button></article>`).join('')}</section><section class="test-note">${ICONS.sparkle}<span>Al responder, verás al momento si has acertado y una breve explicación tomada de los apuntes.</span></section>`;
  bindCommonActions();
  $('#test-document-select')?.addEventListener('change', (event) => renderTests(event.target.value));
  $('#page-content').querySelectorAll('[data-start-test]').forEach((button) => button.addEventListener('click', () => startTest(document.id, Number(button.dataset.startTest))));
}

function shuffle(items) { return [...items].sort(() => Math.random() - 0.5); }

function startTest(documentId, size) {
  const document = getDocument(documentId);
  if (!document) return;
  const questions = shuffle(document.questions).slice(0, size);
  activeTest = { documentId, questions, index: 0, score: 0, selected: null, currentOptions: [] };
  renderActiveTest();
}

function renderActiveTest() {
  const document = getDocument(activeTest?.documentId);
  if (!document || !activeTest) return renderTests();
  if (activeTest.index >= activeTest.questions.length) return renderTestResult(document);
  const question = activeTest.questions[activeTest.index];
  const quizPrompt = question.type === 'Definición' ? question.prompt : '¿Cuál de estas afirmaciones aparece en los apuntes?';
  if (!activeTest.currentOptions.length) {
    const distractors = [...new Set(shuffle(document.questions.filter((item) => item !== question && item.answer !== question.answer)).map((item) => item.answer))].slice(0, 3);
    activeTest.currentOptions = shuffle([question.answer, ...distractors]);
  }
  const selectedOption = activeTest.selected;
  const answered = selectedOption !== null;
  const correct = answered && activeTest.currentOptions[selectedOption] === question.answer;
  setNavigation('tests');
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TEST · ${escapeHtml(document.name)}</p><h1>Pregunta <span>${activeTest.index + 1}.</span></h1><p>Elige la respuesta que mejor recoge lo explicado en los apuntes.</p></div><button class="secondary-button" data-action="tests-back">Salir del test</button></section><section class="panel quiz-panel"><div class="quiz-meta"><span>${escapeHtml(question.type)}</span><span>${activeTest.index + 1} / ${activeTest.questions.length}</span></div><div class="progress-track"><span style="width:${Math.round(activeTest.index / activeTest.questions.length * 100)}%"></span></div><h2 class="quiz-question">${escapeHtml(quizPrompt)}</h2><div class="quiz-options">${activeTest.currentOptions.map((option, index) => {
    const isCorrect = option === question.answer;
    const classes = answered ? isCorrect ? ' correct' : selectedOption === index ? ' incorrect' : ' muted' : '';
    return `<button class="quiz-option${classes}" data-quiz-option="${index}" ${answered ? 'disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + index)}</span><span>${escapeHtml(option)}</span>${answered && isCorrect ? `<span class="option-check">${ICONS.check}</span>` : ''}</button>`;
  }).join('')}</div>${answered ? `<div class="quiz-feedback ${correct ? 'is-correct' : 'is-incorrect'}"><strong>${correct ? '¡Correcto!' : 'No era esa.'}</strong><span>${escapeHtml(question.answer)}</span></div>` : ''}<div class="quiz-footer"><span class="quiz-score">${activeTest.score} ${activeTest.score === 1 ? 'acierto' : 'aciertos'}</span>${answered ? `<button class="primary-button" data-action="quiz-next">${activeTest.index + 1 === activeTest.questions.length ? 'Ver resultado' : 'Siguiente pregunta'} ${ICONS.arrow}</button>` : '<span class="quiz-hint">Selecciona una respuesta para continuar</span>'}</div></section>`;
  $('#page-content').querySelectorAll('[data-quiz-option]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.quizOption);
    activeTest.selected = index;
    if (activeTest.currentOptions[index] === question.answer) activeTest.score += 1;
    renderActiveTest();
  }));
  $('[data-action="quiz-next"]')?.addEventListener('click', () => {
    activeTest.index += 1;
    activeTest.selected = null;
    activeTest.currentOptions = [];
    renderActiveTest();
  });
  $('[data-action="tests-back"]')?.addEventListener('click', () => renderTests(document.id));
}

function renderTestResult(document) {
  const total = activeTest.questions.length;
  const percentage = Math.round(activeTest.score / total * 100);
  document.testScores ||= [];
  document.testScores.push({ score: activeTest.score, total, percentage, date: new Date().toISOString() });
  saveState();
  $('#page-content').innerHTML = `<section class="panel study-main"><div class="session-end"><span class="stat-icon ${percentage >= 60 ? 'green' : 'amber'}">${percentage >= 60 ? ICONS.check : ICONS.clock}</span><p class="eyebrow">RESULTADO DEL TEST</p><h2>${activeTest.score} de ${total} correctas</h2><p>${percentage >= 80 ? '¡Muy buen dominio del tema!' : percentage >= 60 ? 'Buen repaso. Un poco más y lo tienes.' : 'Vuelve a repasar el temario y prueba de nuevo.'}</p><div class="result-score">${percentage}%</div><button class="primary-button" data-action="test-retry">${ICONS.sparkle} Repetir test</button> <button class="secondary-button" data-action="tests-back">Ver otros tests</button></div></section>`;
  $('[data-action="test-retry"]')?.addEventListener('click', () => startTest(document.id, total));
  $('[data-action="tests-back"]')?.addEventListener('click', () => renderTests(document.id));
}

function renderStudy(documentId, showIntro = false) {
  const document = getDocument(documentId);
  if (!document) return renderHome();
  setActive(document.id);
  setNavigation('study');
  const pending = document.questions.filter((question, index) => !document.masteredIds?.includes(index));
  const source = pending.length ? pending : document.questions;
  if (!activeStudy || activeStudy.documentId !== document.id || showIntro) {
    activeStudy = { documentId: document.id, questions: [...source].sort(() => Math.random() - 0.5), index: 0, revealed: false, sessionSize: Math.min(source.length, 10), completed: false };
  }
  if (!activeStudy.questions.length) return renderStudyEmpty(document);
  if (activeStudy.index >= activeStudy.sessionSize) return renderStudyComplete(document);
  const question = activeStudy.questions[activeStudy.index];
  const position = activeStudy.index + 1;
  const progress = Math.round(activeStudy.index / activeStudy.sessionSize * 100);
  const documentPosition = docIndex(document);

  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">MODO ESTUDIO</p><h1>Vamos con <span>${escapeHtml(document.name)}.</span></h1><p>Lee con calma y trata de recordar antes de ver la respuesta.</p></div><button class="secondary-button" data-action="home">Volver al inicio</button></section>
    <div class="study-layout"><section class="panel study-main"><div class="study-heading"><div class="study-topic">${makeSubjectIcon(documentPosition)}<span>${escapeHtml(document.name)}</span></div><span class="study-progress">Pregunta ${position} de ${activeStudy.sessionSize}</span></div><div class="progress-track"><span style="width:${progress}%"></span></div><div class="question-type">${escapeHtml(question.type)}</div><h2 class="question-text">${escapeHtml(question.prompt)}</h2>${activeStudy.revealed ? `<div class="answer-box"><span class="answer-label">Respuesta del temario</span>${escapeHtml(question.answer)}</div>` : ''}<div class="study-actions">${activeStudy.revealed ? `<button class="secondary-button" data-answer="again">${ICONS.clock} Repasar otra vez</button><button class="primary-button" data-answer="known">${ICONS.check} La sabía</button>` : `<button class="primary-button" data-action="reveal">Ver respuesta ${ICONS.arrow}</button>`}</div></section><aside class="panel study-aside"><h3>Un pequeño consejo</h3><div class="tip-item"><span class="tip-icon">✳</span><span><span class="tip-label">Intenta recordar</span>Piensa tu respuesta antes de mostrar la solución. El esfuerzo de recordarla ayuda a fijarla.</span></div><div class="tip-item"><span class="tip-icon">↻</span><span><span class="tip-label">A tu ritmo</span>Las preguntas que quieras reforzar volverán a aparecer en tu siguiente repaso.</span></div></aside></div>`;
  bindCommonActions();
  $('[data-action="reveal"]')?.addEventListener('click', () => { activeStudy.revealed = true; renderStudy(documentId); });
  $('[data-answer="known"]')?.addEventListener('click', () => answerQuestion(document, question, true));
  $('[data-answer="again"]')?.addEventListener('click', () => answerQuestion(document, question, false));
}

function renderStudyEmpty(document) {
  $('#page-content').innerHTML = `<section class="panel study-main"><div class="session-end"><span class="stat-icon green">${ICONS.check}</span><h2>Este PDF no tiene texto seleccionable</h2><p>Puede ser un escaneo. Este cuaderno extrae texto, pero no lee imágenes de páginas.</p><button class="secondary-button" data-action="home">Volver al inicio</button></div></section>`;
  bindCommonActions();
}

function renderStudyComplete(document) {
  $('#page-content').innerHTML = `<section class="panel study-main"><div class="session-end"><span class="stat-icon green">${ICONS.check}</span><h2>Buen trabajo con ${escapeHtml(document.name)}.</h2><p>Has terminado ${activeStudy.sessionSize} preguntas. Cada repaso suma.</p><button class="primary-button" data-action="study-again">${ICONS.sparkle} Hacer otro repaso</button> <button class="secondary-button" data-action="home">Volver al inicio</button></div></section>`;
  bindCommonActions();
  $('[data-action="study-again"]')?.addEventListener('click', () => renderStudy(document.id, true));
}

function answerQuestion(document, question, known) {
  if (known) {
    const questionIndex = document.questions.indexOf(question);
    document.masteredIds ||= [];
    if (!document.masteredIds.includes(questionIndex)) document.masteredIds.push(questionIndex);
    document.mastered = document.masteredIds.length;
  }
  activeStudy.index += 1;
  activeStudy.revealed = false;
  if (activeStudy.index >= activeStudy.sessionSize) {
    document.sessions = (document.sessions || 0) + 1;
    saveState();
  }
  saveState();
  renderStudy(document.id);
}

function renderDocument() {
  renderSidebar();
  const hash = location.hash;
  if (hash === '#temarios') return renderLibrary();
  if (hash === '#tests') return renderTests();
  if (hash.startsWith('#tests/')) return renderTests(decodeURIComponent(hash.slice('#tests/'.length)));
  if (hash.startsWith('#temario/')) return renderSyllabus(decodeURIComponent(hash.slice('#temario/'.length)));
  if (hash.startsWith('#estudiar/')) return renderStudy(decodeURIComponent(hash.slice('#estudiar/'.length)), true);
  if (hash.startsWith('#tema/')) return openDocument(decodeURIComponent(hash.slice('#tema/'.length)));
  return renderHome();
}

function bindCommonActions() {
  $('#page-content').querySelectorAll('[data-action="upload"]').forEach((button) => button.addEventListener('click', openUpload));
  $('#page-content').querySelectorAll('[data-go-library]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); location.hash = '#temarios'; renderLibrary(); }));
  $('#page-content').querySelectorAll('[data-action="home"]').forEach((button) => button.addEventListener('click', () => { activeStudy = null; location.hash = '#inicio'; renderHome(); }));
  $('#page-content').querySelectorAll('[data-action="study-any"]').forEach((button) => button.addEventListener('click', () => {
    const document = getDocument();
    if (document) renderStudy(document.id, true);
  }));
  $('#page-content').querySelectorAll('[data-remove-document]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    const document = getDocument(button.dataset.removeDocument);
    if (!document || !window.confirm(`¿Eliminar «${document.name}» y su progreso de este navegador?`)) return;
    state.documents = state.documents.filter((item) => item.id !== document.id);
    if (state.activeId === document.id) state.activeId = state.documents[0]?.id || null;
    activeStudy = null;
    saveState();
    showToast('Temario eliminado.');
    renderDocument();
  }));
  $('#page-content').querySelectorAll('[data-study-document]').forEach((button) => button.addEventListener('click', () => renderStudy(button.dataset.studyDocument, true)));
  $('#page-content').querySelectorAll('[data-view-syllabus]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); renderSyllabus(button.dataset.viewSyllabus); }));
  $('#page-content').querySelectorAll('[data-view-tests]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); renderTests(button.dataset.viewTests); }));
}

function openUpload() {
  $('#modal-backdrop').hidden = false;
  $('#modal-file-input').focus({ preventScroll: true });
}

function closeUpload() { $('#modal-backdrop').hidden = true; }

function cleanFileName(name) { return name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Nuevo temario'; }

async function autoLoadThemePdfs() {
  try {
    const directoryUrl = new URL('./temas/', location.href);
    let pdfUrls = [];
    const directoryResponse = await fetch(directoryUrl);
    if (directoryResponse.ok) {
      const listing = await directoryResponse.text();
      const links = [...listing.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)].map((match) => match[1]);
      pdfUrls = links.map((href) => new URL(href, directoryUrl)).filter((url) => url.origin === directoryUrl.origin && url.pathname.startsWith(directoryUrl.pathname));
    }
    if (!pdfUrls.length) pdfUrls = [new URL('tema1.pdf', directoryUrl)];

    let added = 0;
    let linkedExisting = false;
    for (const url of pdfUrls) {
      const fileName = decodeURIComponent(url.pathname.split('/').pop());
      const existing = state.documents.find((document) => document.fileName.toLocaleLowerCase() === fileName.toLocaleLowerCase());
      if (existing) {
        if (!existing.sourcePath) { existing.sourcePath = url.pathname; linkedExisting = true; }
        continue;
      }
      const response = await fetch(url);
      if (!response.ok) continue;
      const file = new File([await response.blob()], fileName, { type: 'application/pdf' });
      const { text, pages } = await extractPdf(file);
      const questions = makeQuestions(text);
      if (!questions.length) continue;
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      state.documents.push({ id, name: cleanFileName(fileName), fileName, sourcePath: url.pathname, pages, text, questions, mastered: 0, masteredIds: [], sessions: 0, testScores: [], addedAt: new Date().toISOString() });
      if (!state.activeId) state.activeId = id;
      added += 1;
    }
    if (added || linkedExisting) {
      saveState();
      renderDocument();
      if (added) showToast(`${added === 1 ? 'El temario del tema 1 está listo' : `${added} temarios están listos`} con tests y lectura.`);
    }
  } catch (error) {
    console.warn('No se pudieron cargar automáticamente los PDFs de temas/.', error);
  }
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  closeUpload();
  for (const file of files) {
    if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      showToast(`${file.name} no es un PDF.`);
      continue;
    }
    showToast(`Leyendo ${file.name} en este dispositivo…`);
    try {
      const { text, pages } = await extractPdf(file);
      if (text.length < 80) {
        showToast(`No encontramos texto en ${file.name}. Puede ser un PDF escaneado.`);
        continue;
      }
      const questions = makeQuestions(text);
      if (!questions.length) {
        showToast(`No encontramos suficiente texto para crear preguntas en ${file.name}.`);
        continue;
      }
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const name = cleanFileName(file.name);
      state.documents.unshift({ id, name, fileName: file.name, pages, text, questions, mastered: 0, masteredIds: [], sessions: 0, addedAt: new Date().toISOString() });
      state.activeId = id;
      saveState();
      showToast(`Listo: ${questions.length} preguntas de ${pages} páginas.`);
      renderSidebar();
      renderDocument();
    } catch (error) {
      console.error('Error al leer el PDF.', error);
      showToast(error.message || `No se pudo leer ${file.name}.`);
    }
  }
}

$('#add-subject').addEventListener('click', openUpload);
$('#modal-close').addEventListener('click', closeUpload);
$('#modal-backdrop').addEventListener('click', (event) => { if (event.target === $('#modal-backdrop')) closeUpload(); });
$('#modal-file-input').addEventListener('change', (event) => handleFiles(event.target.files));
$('#file-input').addEventListener('change', (event) => handleFiles(event.target.files));
$('#dropzone').addEventListener('dragover', (event) => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragging'));
$('#dropzone').addEventListener('drop', (event) => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); handleFiles(event.dataTransfer.files); });
$('#nav-home').addEventListener('click', (event) => { event.preventDefault(); activeStudy = null; location.hash = '#inicio'; renderHome(); });
$('#nav-library').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#temarios'; renderLibrary(); });
$('#nav-tests').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#tests'; renderTests(); });
window.addEventListener('hashchange', renderDocument);
$('#today-label').textContent = formatDate();
renderDocument();
autoLoadThemePdfs();
