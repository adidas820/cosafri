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
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5.5v6c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5v-6L12 2Z"/><path d="m9.5 12 2 2 3.5-3.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};

let activeQuiz = null;
let toastTimer;
let isGeneratingQuiz = false;
let examTimerInterval = null;

function stopExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
}

function formatTimerClock(msRemaining) {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

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
  $('#nav-community')?.classList.toggle('active', section === 'community');
  $('#nav-profile')?.classList.toggle('active', section === 'profile');
  $('#nav-admin')?.classList.toggle('active', section === 'admin');
  const defaultLabel =
    section === 'home'
      ? 'Inicio'
      : section === 'subjects'
      ? 'Asignaturas'
      : section === 'community'
      ? 'Comunidad'
      : section === 'profile'
      ? 'Perfil'
      : section === 'admin'
      ? 'Panel Admin'
      : 'Tests';
  $('#breadcrumb-current').textContent = label || defaultLabel;
}

async function renderSidebar() {
  const catalog = await dataService.getCatalog();
  $('#subject-count').textContent = catalog.length;
  $('#subject-list').innerHTML = catalog.map((subject) => `<a class="subject-row" href="#asignatura/${encodeURIComponent(subject.id)}"><span class="subject-dot" data-color="${escapeHtml(subject.color || '')}"></span><span>${escapeHtml(subject.name)}</span></a>`).join('');
  if ($('#nav-admin')) {
    $('#nav-admin').hidden = !dataService.isAdmin();
  }
}

function bindGenerateButtons() {
  $('#page-content').querySelectorAll('[data-open-gen-quiz]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subjectId = btn.dataset.subject || '';
      const topicId = btn.dataset.topic || '';
      openGenerateQuizModal(subjectId, topicId);
    });
  });
  $('#page-content').querySelectorAll('[data-open-exam]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subjectId = btn.dataset.subject || '';
      openExamModal(subjectId);
    });
  });
  $('#page-content').querySelectorAll('[data-open-profile]').forEach((btn) => {
    btn.addEventListener('click', openProfile);
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
  $('#page-content').querySelectorAll('[data-delete-section]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sectionId = btn.dataset.deleteSection;
      const subjectId = btn.dataset.subject;
      const topicId = btn.dataset.topic;
      const name = btn.dataset.name || sectionId;
      if (!confirm(`¿Seguro que quieres eliminar el test "${name}" de Supabase? Esta acción no se puede deshacer.`)) {
        return;
      }
      btn.disabled = true;
      try {
        await dataService.deleteSection(subjectId, topicId, sectionId);
        showToast(`Test "${name}" eliminado.`);
        renderRoute();
      } catch (err) {
        btn.disabled = false;
        showToast(err.message || 'No se pudo eliminar el test.', 5000);
      }
    });
  });
}

function sectionScoreBadge(subjectName, sectionName, scores = dataService.readScores()) {
  const matches = scores.filter(
    (s) => s.section === sectionName && (!s.subject || s.subject === subjectName)
  );
  if (!matches.length) {
    return '<span class="score-badge is-pending" title="Aún no has completado este test">Pendiente</span>';
  }
  const best = Math.max(...matches.map((m) => Number(m.percentage) || 0));
  const last = Number(matches[0].percentage) || 0;
  const tier = best >= 80 ? 'is-high' : best >= 60 ? 'is-mid' : 'is-low';
  const label = best === last ? `Mejor: ${best}%` : `Mejor: ${best}% · Últ.: ${last}%`;
  const title = `Mejor nota: ${best}% · Última nota: ${last}% (${matches.length} ${matches.length === 1 ? 'intento' : 'intentos'})`;
  return `<span class="score-badge ${tier}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function deleteAiTestButton(subjectId, topicId, section) {
  if (!dataService.isAdmin() || !String(section?.id || '').startsWith('ia-')) return '';
  return `<button class="icon-danger-button" type="button" data-delete-section="${escapeHtml(section.id)}" data-subject="${escapeHtml(subjectId)}" data-topic="${escapeHtml(topicId)}" data-name="${escapeHtml(section.name)}" title="Eliminar este test generado con IA (Solo Administrador)" aria-label="Eliminar test ${escapeHtml(section.name)}">${ICONS.trash}</button>`;
}

function subjectCard(subject) {
  const topicCount = subject.topics.length;
  const sectionCount = subject.topics.reduce((sum, topic) => sum + topic.sections.length, 0);
  const questionCount = subject.topics.reduce((sum, topic) => sum + topic.sections.reduce((sectionSum, section) => sectionSum + (section.questionCount || section.questions?.length || 0), 0), 0);
  return `<article class="subject-card" data-color="${escapeHtml(subject.color || '')}"><div class="subject-card-top">${iconTile(ICONS.folder, subject.color)}<div><h3>${escapeHtml(subject.name)}</h3><p>${escapeHtml(subject.description)}</p></div></div><div class="subject-card-meta"><span>${topicCount} ${topicCount === 1 ? 'temario' : 'temarios'}</span><span>${sectionCount} tests</span><span>${questionCount} preguntas</span></div><div class="subject-card-actions"><a class="primary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Abrir asignatura ${ICONS.arrow}</a><button class="secondary-button" type="button" data-open-exam data-subject="${escapeHtml(subject.id)}">${ICONS.clock} Simulacro</button><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}">${ICONS.sparkle} Test IA</button></div></article>`;
}

function formatAttemptDateTime(iso) {
  if (!iso) return 'Reciente';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Reciente';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

function recentActivityPanel(scores = []) {
  const recent = scores.slice(0, 6);
  if (!recent.length) {
    return `<section class="panel section-panel"><div class="panel-head"><h2>Actividad reciente</h2><button class="text-link" type="button" data-open-profile>Ver perfil ${ICONS.arrow}</button></div><div class="admin-empty-state"><p>Todavía no has completado ningún test. Empieza uno o lanza un simulacro de examen para ver aquí tu evolución.</p></div></section>`;
  }
  return `<section class="panel section-panel">
    <div class="panel-head">
      <h2>Actividad reciente</h2>
      <button class="text-link" type="button" data-open-profile>Ver historial completo (${scores.length}) ${ICONS.arrow}</button>
    </div>
    <div class="test-list activity-list">
      ${recent
        .map((item) => {
          const pct = Number(item.percentage) || 0;
          const tier = pct >= 80 ? 'is-high' : pct >= 60 ? 'is-mid' : 'is-low';
          const isSim = String(item.section || '').toLowerCase().startsWith('simulacro');
          return `<div class="test-row activity-row">
            <span class="test-index">${isSim ? ICONS.clock : ICONS.check}</span>
            <div class="test-row-copy">
              <strong>${escapeHtml(item.section || 'Test')}</strong>
              <span>${escapeHtml(item.subject || 'Asignatura')} · ${escapeHtml(formatAttemptDateTime(item.date))}</span>
            </div>
            <div class="test-actions">
              <span class="test-count">${escapeHtml(String(item.score ?? 0))}/${escapeHtml(String(item.total ?? 0))}</span>
              <span class="score-badge ${tier}">${pct}%</span>
            </div>
          </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

async function renderHome() {
  stopExamTimer();
  activeQuiz = null;
  setNavigation('home');
  renderLoading('Cargando tu biblioteca de estudio...');
  const catalog = await dataService.getCatalog();
  const scores = dataService.readScores();
  const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.percentage, 0) / scores.length) : 0;
  const mistakes = await dataService.getMistakes().catch(() => []);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TU BIBLIOTECA DE ESTUDIO</p><h1>Buenas, estudiante<span>.</span></h1><p>Tus asignaturas, temarios y tests están organizados en un mismo sitio.</p></div><div class="test-actions"><button class="secondary-button" type="button" data-open-exam>${ICONS.clock} Simulacro de examen</button><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz>${ICONS.sparkle} Generar test con IA</button><a class="primary-button" href="#asignaturas">Ir a mis asignaturas ${ICONS.arrow}</a></div></section>
    <section class="stats-grid"><article class="stat-card"><span class="stat-icon purple">${ICONS.folder}</span><div><span class="stat-label">Asignaturas</span><strong class="stat-number">${catalog.length}</strong><span class="stat-context">en tu biblioteca</span></div></article><article class="stat-card"><span class="stat-icon green">${ICONS.file}</span><div><span class="stat-label">Temarios</span><strong class="stat-number">${totalTopics(catalog)}</strong><span class="stat-context">listos para leer</span></div></article><article class="stat-card"><span class="stat-icon blue">${ICONS.check}</span><div><span class="stat-label">Media de tus tests</span><strong class="stat-number">${scores.length ? `${average}%` : '—'}</strong><span class="stat-context">${scores.length ? `${scores.length} tests completados` : 'empieza cuando quieras'}</span></div></article></section>
    ${reviewBanner(mistakes)}<section class="panel section-panel"><div class="panel-head"><h2>Mis asignaturas</h2><a class="text-link" href="#asignaturas">Ver biblioteca ${ICONS.arrow}</a></div><div class="subject-grid">${catalog.length ? catalog.map(subjectCard).join('') : '<div class="empty-card"><div><h3>La biblioteca está vacía</h3><p>Añade asignaturas y temarios al catálogo del repositorio.</p></div></div>'}</div></section>
    ${recentActivityPanel(scores)}
    <section class="welcome-banner"><div class="banner-copy"><strong>¿Quieres practicar con preguntas nuevas sobre un tema?</strong><span>Genera un test a medida con Gemini AI eligiendo el número de preguntas y guárdalo en Supabase.</span></div><div class="test-actions"><button class="primary-button" type="button" data-open-gen-quiz>${ICONS.sparkle} Crear test con Gemini</button><a class="secondary-button" href="#tests">Explorar tests ${ICONS.arrow}</a></div></section>`;
  bindGenerateButtons();
}

function topicAccordion(subject, topic, index, scores = dataService.readScores()) {
  const qCount = topic.sections.reduce((sum, section) => sum + (section.questionCount || section.questions?.length || 0), 0);
  return `<details class="subject-accordion"><summary><span class="summary-left"><span class="topic-number">${String(index + 1).padStart(2, '0')}</span><span class="summary-title"><strong>${escapeHtml(topic.name)}</strong><span>${topic.pages} páginas · ${topic.sections.length} tests · ${qCount} preguntas</span></span></span><span class="chevron">${ICONS.chevron}</span></summary><div class="topic-list"><div class="topic-row"><a class="topic-copy" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}"><span class="topic-file-icon">${ICONS.file}</span><span><strong>Leer el temario</strong><span>Abre el PDF original dentro de la página</span></span></a><span class="topic-actions"><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Generar test con IA</button><a class="secondary-button" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">Abrir PDF ${ICONS.arrow}</a></span></div>${topic.sections.map((section, sectionIndex) => `<div class="topic-row"><span class="topic-copy"><span class="topic-number small-number">${sectionIndex + 1}</span><span><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.description)} · ${section.questionCount || section.questions?.length || 0} preguntas</span></span></span><span class="topic-actions">${sectionScoreBadge(subject.name, section.name, scores)}${deleteAiTestButton(subject.id, topic.id, section)}<a class="secondary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></span></div>`).join('')}</div></details>`;
}

async function renderSubjects() {
  stopExamTimer();
  activeQuiz = null;
  setNavigation('subjects');
  renderLoading('Cargando asignaturas...');
  const catalog = await dataService.getCatalog();
  const scores = dataService.readScores();
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">TODO TU MATERIAL, EN SU SITIO</p><h1>Asignaturas</h1><p>Despliega una asignatura para ver sus temarios, abrir el PDF o generar nuevos tests con IA.</p></div><div class="test-actions"><button class="secondary-button" type="button" data-open-exam>${ICONS.clock} Simulacro de examen</button><button class="primary-button" type="button" data-open-gen-quiz>${ICONS.sparkle} Generar test con IA</button></div></section><div class="subject-list-accordion">${catalog.map((subject) => `<details class="subject-accordion" open><summary><span class="summary-left">${iconTile(ICONS.folder, subject.color)}<span class="summary-title"><strong>${escapeHtml(subject.name)}</strong><span>${subject.topics.length} ${subject.topics.length === 1 ? 'temario' : 'temarios'} · ${escapeHtml(subject.description)}</span></span></span><span class="chevron">${ICONS.chevron}</span></summary><div class="topic-list">${subject.topics.map((topic, index) => topicAccordion(subject, topic, index, scores)).join('')}</div></details>`).join('')}</div>`;
  bindGenerateButtons();
}

async function renderSubject(subjectId) {
  stopExamTimer();
  activeQuiz = null;
  renderLoading('Cargando asignatura...');
  const subject = await dataService.getSubject(subjectId);
  if (!subject) return renderSubjects();
  const scores = dataService.readScores();
  setNavigation('subjects', subject.name);
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">ASIGNATURA</p><h1>${escapeHtml(subject.name)}</h1><p>${escapeHtml(subject.description)}</p></div><div class="test-actions"><button class="secondary-button" type="button" data-open-exam data-subject="${escapeHtml(subject.id)}">${ICONS.clock} Simulacro de examen</button><button class="primary-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}">${ICONS.sparkle} Generar test con IA</button></div></section><div class="subject-list-accordion">${subject.topics.map((topic, index) => topicAccordion(subject, topic, index, scores)).join('')}</div>`;
  bindGenerateButtons();
}

async function renderTests(subjectId) {
  stopExamTimer();
  activeQuiz = null;
  setNavigation('tests');
  renderLoading('Cargando cuestionarios...');
  const catalog = await dataService.getCatalog();
  const scores = dataService.readScores();
  const selectedSubject = subjectId ? catalog.find((s) => s.id === subjectId) : null;
  const mistakes = await dataService.getMistakes().catch(() => []);
  const groups = catalog.filter((subject) => !selectedSubject || subject.id === selectedSubject.id).flatMap((subject) => subject.topics.flatMap((topic) => topic.sections.map((section) => ({ subject, topic, section }))));
  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">PRACTICA CON PREGUNTAS DEL TEMARIO</p><h1>Tests</h1><p>Cuestionarios redactados a partir de tus apuntes, generados con Gemini AI o simulacros de examen personalizados.</p></div><div class="test-actions"><button class="secondary-button" type="button" data-open-exam data-subject="${escapeHtml(selectedSubject?.id || '')}">${ICONS.clock} Simulacro de examen</button><button class="primary-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(selectedSubject?.id || '')}">${ICONS.sparkle} Generar nuevo test con IA</button></div></section>${reviewBanner(mistakes, selectedSubject?.id || '')}<div class="page-heading-actions"><label class="subject-filter"><span>Asignatura</span><select id="test-subject-filter"><option value="">Todas las asignaturas</option>${catalog.map((subject) => `<option value="${escapeHtml(subject.id)}" ${selectedSubject?.id === subject.id ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label></div><div class="test-groups">${groups.map(({ subject, topic, section }, index) => `<section class="panel test-group"><div class="test-group-head"><div><h2>${escapeHtml(section.name)}</h2><p>${escapeHtml(subject.name)} · ${escapeHtml(topic.name)} · ${escapeHtml(section.description)}</p></div><div class="test-head-meta">${sectionScoreBadge(subject.name, section.name, scores)}<span class="test-count">${section.questionCount || section.questions?.length || 0} preguntas</span></div></div><div class="test-list"><div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div class="test-row-copy"><strong>Test: ${escapeHtml(section.name)}</strong><span>Selección múltiple · respuesta y explicación al momento</span></div><div class="test-actions">${deleteAiTestButton(subject.id, topic.id, section)}<a class="primary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></div></div></div></section>`).join('')}</div>`;
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
  const scores = dataService.readScores();
  setNavigation('subjects', topic.name);
  const qCount = topic.sections.reduce((sum, section) => sum + (section.questionCount || section.questions?.length || 0), 0);
  $('#page-content').innerHTML = `<section class="topic-page-head"><div><p class="eyebrow">${escapeHtml(subject.name)}</p><h1>${escapeHtml(topic.name)}</h1><p>${topic.pages} páginas · ${topic.sections.length} cuestionarios relacionados</p></div><div class="test-actions"><a class="secondary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Volver a la asignatura</a><button class="primary-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Generar test con IA</button></div></section><section class="panel pdf-panel"><div class="pdf-toolbar"><strong>${escapeHtml(topic.name)}</strong><a class="text-link" href="${escapeHtml(topic.file)}" target="_blank" rel="noreferrer">Abrir PDF en otra pestaña ${ICONS.arrow}</a></div><iframe class="pdf-frame" src="${escapeHtml(topic.file)}#toolbar=1&navpanes=0" title="${escapeHtml(topic.name)}" loading="lazy"><p class="pdf-fallback">No se pudo mostrar el PDF. <a href="${escapeHtml(topic.file)}">Ábrelo aquí</a>.</p></iframe></section><section class="panel section-panel"><div class="panel-head"><h2>Practicar este temario</h2><div class="test-actions"><span class="test-count">${topic.sections.length} tests · ${qCount} preguntas</span><button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Nuevo test IA</button></div></div><div class="test-list">${topic.sections.map((section, index) => `<div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div class="test-row-copy"><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.description)} · ${section.questionCount || section.questions?.length || 0} preguntas</span></div><div class="test-actions">${sectionScoreBadge(subject.name, section.name, scores)}${deleteAiTestButton(subject.id, topic.id, section)}<a class="primary-button" href="#test/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}/${encodeURIComponent(section.id)}">Empezar test ${ICONS.arrow}</a></div></div>`).join('')}</div></section>`;
  bindGenerateButtons();
}

function shuffleArray(items = []) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleQuestionOptions(question) {
  if (!question || !Array.isArray(question.options) || question.options.length <= 1) {
    return { ...question };
  }
  const correctIndex = Number(question.answer) || 0;
  const indexed = shuffleArray(
    question.options.map((text, idx) => ({
      text,
      isCorrect: idx === correctIndex
    }))
  );
  return {
    ...question,
    options: indexed.map((item) => item.text),
    answer: Math.max(0, indexed.findIndex((item) => item.isCorrect))
  };
}

async function startQuiz(subjectId, topicId, sectionId) {
  stopExamTimer();
  renderLoading('Cargando preguntas del test...');
  try {
    const result = await dataService.getSection(subjectId, topicId, sectionId);
    if (!result || !result.section?.questions?.length) {
      showToast('No se encontraron preguntas para este test.');
      return renderTests(subjectId);
    }
    const { subject, topic, section } = result;
    const shuffledQuestions = section.questions.map(shuffleQuestionOptions);
    activeQuiz = {
      subject,
      topic,
      section: {
        ...section,
        questions: shuffledQuestions
      },
      order: shuffleArray([...shuffledQuestions.keys()]),
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
  const { subject, topic, section, order, index, mode } = activeQuiz;
  const isExam = mode === 'exam';
  const question = section.questions[order[index]];
  const answered = activeQuiz.selected !== null;
  const isBlank = activeQuiz.selected === 'blank';
  const correct = answered && !isBlank && activeQuiz.selected === question.answer;
  setNavigation('tests', section.name);

  const eyebrowText =
    mode === 'review'
      ? question.origin || 'Repaso de fallos'
      : isExam
      ? question.origin || `${subject.name} · ${topic.name}`
      : `${subject.name} · ${topic.name}`;

  let examMetaPills = '';
  if (isExam) {
    const pen = Number(activeQuiz.penaltyPerWrong) || 0;
    const penText = pen > 0 ? `Fallo: -${pen.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} aciertos` : 'Sin penalización';
    let timerPill = '';
    if (activeQuiz.endsAt) {
      const rem = Math.max(0, activeQuiz.endsAt - Date.now());
      const urgent = rem < 60000 ? ' is-low' : ' is-mid';
      timerPill = `<span class="score-badge${urgent}" id="quiz-timer-badge">${ICONS.clock} ${formatTimerClock(rem)}</span>`;
    }
    examMetaPills = `<div class="exam-quiz-pills"><span class="score-badge is-pending">${escapeHtml(penText)}</span>${timerPill}</div>`;
  }

  const rightScoreInfo = isExam
    ? `${activeQuiz.score} ✓ · ${activeQuiz.wrongCount || 0} ✕ · ${activeQuiz.blankCount || 0} en blanco`
    : `${activeQuiz.score} ${activeQuiz.score === 1 ? 'acierto' : 'aciertos'}`;

  let feedbackHtml = '';
  if (answered) {
    if (isBlank) {
      feedbackHtml = `<div class="quiz-feedback is-blank"><strong>Pregunta dejada en blanco (no suma ni resta)</strong><span>${escapeHtml(question.explanation)}</span></div>`;
    } else {
      feedbackHtml = `<div class="quiz-feedback ${correct ? 'is-correct' : 'is-incorrect'}"><strong>${correct ? 'Correcto' : 'Repasa esta respuesta'}</strong><span>${escapeHtml(question.explanation)}</span></div>`;
    }
  }

  const footerActions = answered
    ? `<button class="primary-button" id="next-question">${index + 1 === order.length ? (isExam ? 'Finalizar examen' : 'Ver resultado') : 'Siguiente pregunta'} ${ICONS.arrow}</button>`
    : isExam
    ? `<button class="secondary-button" type="button" id="skip-question">Dejar en blanco</button>`
    : '';

  $('#page-content').innerHTML = `<section class="welcome-row"><div class="welcome-copy"><p class="eyebrow">${escapeHtml(eyebrowText)}</p><h1>${escapeHtml(section.name)}<span>.</span></h1><p>${isExam ? 'Simulacro de examen: puedes responder o dejar la pregunta en blanco si dudas.' : 'Elige una respuesta. Después verás la explicación de tus apuntes.'}</p></div><div class="test-actions">${examMetaPills}<a class="secondary-button" href="#tests/${encodeURIComponent(subject.id)}">Salir del test</a></div></section><section class="panel quiz-panel"><div class="quiz-meta"><span>Pregunta ${index + 1} de ${order.length}</span><span>${escapeHtml(rightScoreInfo)}</span></div><div class="quiz-progress"><span style="width:${Math.round(index / order.length * 100)}%"></span></div><h2 class="quiz-question">${escapeHtml(question.question)}</h2><div class="quiz-options">${question.options.map((option, optionIndex) => {
    let state = '';
    if (answered) state = optionIndex === question.answer ? ' correct' : optionIndex === activeQuiz.selected ? ' incorrect' : ' muted';
    return `<button class="quiz-option${state}" data-option="${optionIndex}" ${answered ? 'disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span><span>${escapeHtml(option)}</span>${answered && optionIndex === question.answer ? `<span class="option-check">${ICONS.check}</span>` : ''}</button>`;
  }).join('')}</div>${feedbackHtml}<div class="quiz-footer"><span class="quiz-hint">${answered ? 'Cuando quieras, sigue con la siguiente.' : isExam ? 'Selecciona una opción o déjala en blanco para no penalizar.' : 'Selecciona una respuesta para continuar.'}</span><div class="test-actions">${footerActions}</div></div></section>`;
  
  $('#page-content').querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => {
    const selected = Number(button.dataset.option);
    activeQuiz.selected = selected;
    if (selected === question.answer) {
      activeQuiz.score += 1;
      if (activeQuiz.mode === 'review') {
        dataService.resolveMistake(question.id).catch((err) => console.warn('No se pudo quitar el fallo de la lista:', err));
      }
    } else {
      activeQuiz.wrongCount = (activeQuiz.wrongCount || 0) + 1;
      activeQuiz.missed.push(question);
      dataService.recordMistake(question).catch((err) => console.warn('No se pudo guardar el fallo:', err));
    }
    renderQuiz();
  }));

  $('#skip-question')?.addEventListener('click', () => {
    activeQuiz.selected = 'blank';
    activeQuiz.blankCount = (activeQuiz.blankCount || 0) + 1;
    renderQuiz();
  });

  $('#next-question')?.addEventListener('click', () => {
    activeQuiz.index += 1;
    activeQuiz.selected = null;
    if (activeQuiz.index >= activeQuiz.order.length) {
      activeQuiz.complete = true;
      activeQuiz.finishedAt = Date.now();
      stopExamTimer();
    }
    renderQuiz();
  });
}

async function renderQuizResult() {
  stopExamTimer();
  const { subject, topic, section, score, order, mode, missed = [], reviewSubjectId = '' } = activeQuiz;
  const isReview = mode === 'review';
  const isExam = mode === 'exam';
  const total = order.length;
  const wrongCount = activeQuiz.wrongCount || 0;
  const blankCount = activeQuiz.blankCount || 0;
  const penaltyPerWrong = Number(activeQuiz.penaltyPerWrong) || 0;
  const penaltySubtracted = isExam ? wrongCount * penaltyPerWrong : 0;
  const netScore = isExam ? Math.max(0, score - penaltySubtracted) : score;
  const grade10 = (netScore / total) * 10;
  const percentage = Math.round((netScore / total) * 100);

  if (!isReview) {
    await dataService.saveScore({
      subject: subject.name,
      section: section.name,
      score: Math.round(netScore * 100) / 100,
      total,
      percentage,
      date: new Date().toISOString()
    });
  }
  const loggedIn = dataService.isLoggedIn();
  const missedCount = missed.length;
  setNavigation('tests', 'Resultado');

  const message = isReview
    ? (missedCount ? `Has resuelto ${score} de tus fallos. Te ${missedCount === 1 ? 'queda 1' : `quedan ${missedCount}`} por dominar.` : 'Has resuelto todas las preguntas del repaso. ¡Fuera de tu lista!')
    : isExam
    ? (activeQuiz.timedOut ? '⏰ Se agotó el tiempo del examen. ' : '') +
      (grade10 >= 9 ? '¡Sobresaliente! Dominas la asignatura con solvencia.' : grade10 >= 7 ? '¡Notable! Muy buen resultado en el simulacro.' : grade10 >= 5 ? 'Examen aprobado. Repasa los fallos para subir nota.' : 'No has alcanzado el 5,00. Repasa las preguntas falladas e inténtalo de nuevo.')
    : (percentage >= 80 ? 'Muy buen dominio de este bloque.' : percentage >= 60 ? 'Buen repaso. Refuerza las preguntas que te han costado.' : 'Puedes volver al temario y repetir el test cuando quieras.');

  let note = '';
  if (missedCount && !loggedIn && dataService.isAuthAvailable()) {
    note = '<p class="result-note">Inicia sesión desde tu perfil para guardar tus fallos y repasarlos en cualquier dispositivo.</p>';
  } else if (missedCount && loggedIn && !isReview) {
    note = '<p class="result-note">Tus fallos se han guardado en tu lista de repaso.</p>';
  }

  let examBreakdownHtml = '';
  if (isExam) {
    const elapsedMs = Math.max(1000, (activeQuiz.finishedAt || Date.now()) - (activeQuiz.startedAt || Date.now()));
    const penSubStr = penaltyPerWrong > 0 ? ` (-${penaltySubtracted.toFixed(2).replace('.', ',')} pts)` : '';
    examBreakdownHtml = `
      <div class="exam-result-breakdown">
        <article><strong>${score}</strong><span>Aciertos</span></article>
        <article><strong>${wrongCount}${escapeHtml(penSubStr)}</strong><span>Fallos</span></article>
        <article><strong>${blankCount}</strong><span>En blanco</span></article>
        <article><strong>${formatTimerClock(elapsedMs)}</strong><span>Tiempo</span></article>
      </div>
    `;
  }

  const missedButton = missedCount
    ? `<button class="primary-button" type="button" id="review-missed">${ICONS.target} Repasar ${missedCount === 1 ? 'la que he fallado' : `las ${missedCount} que he fallado`}</button>`
    : '';
  const otherButtons = isReview
    ? `<a class="secondary-button" href="#tests">Volver a tests</a>`
    : isExam
    ? `<button class="${missedCount ? 'secondary-button' : 'primary-button'}" type="button" id="retry-exam">Repetir simulacro ${ICONS.arrow}</button><button class="secondary-button" type="button" id="config-new-exam">${ICONS.clock} Configurar otro examen</button><a class="secondary-button" href="#asignatura/${encodeURIComponent(subject.id)}">Ir a la asignatura</a>`
    : `<button class="${missedCount ? 'secondary-button' : 'primary-button'}" type="button" id="retry-quiz">Repetir test ${ICONS.arrow}</button><button class="secondary-button ai-accent-button" type="button" id="gen-another-quiz">${ICONS.sparkle} Generar otro test IA</button><a class="secondary-button" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">Volver al temario</a>`;

  const mainScoreDisplay = isExam
    ? `${grade10.toFixed(2).replace('.', ',')} <span class="exam-grade-of">/ 10</span>`
    : `${percentage}%`;

  const headlineText = isExam
    ? `${grade10 >= 5 ? 'APROBADO' : 'NO SUPERADO'} · ${percentage}% neto`
    : `${score} de ${total} correctas`;

  $('#page-content').innerHTML = `<section class="panel result-card"><span class="result-mark">${isReview ? ICONS.target : isExam ? ICONS.clock : ICONS.check}</span><p class="eyebrow">${isReview ? 'REPASO COMPLETADO' : isExam ? `SIMULACRO FINALIZADO · ${escapeHtml(subject.name)}` : `TEST COMPLETADO · ${escapeHtml(section.name)}`}</p><h2>${escapeHtml(headlineText)}</h2><p>${escapeHtml(message)}</p><div class="result-score">${mainScoreDisplay}</div>${examBreakdownHtml}${note}<div class="result-buttons">${missedButton}${otherButtons}</div></section>`;

  $('#review-missed')?.addEventListener('click', () => {
    const questions = missed.map((q) => ({ ...q, origin: q.origin || `${subject.name} · ${section.name}` }));
    launchReviewQuiz(questions, isReview ? reviewSubjectId : subject.id);
  });
  $('#retry-quiz')?.addEventListener('click', () => startQuiz(subject.id, topic.id, section.id));
  $('#gen-another-quiz')?.addEventListener('click', () => openGenerateQuizModal(subject.id, topic.id));
  $('#retry-exam')?.addEventListener('click', () => {
    if (activeQuiz?.examConfig) {
      startExamSimulation(activeQuiz.examConfig);
    } else {
      openExamModal(subject.id);
    }
  });
  $('#config-new-exam')?.addEventListener('click', () => openExamModal(subject.id));
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
  stopExamTimer();
  const shuffledQuestions = questions.map(shuffleQuestionOptions);
  activeQuiz = {
    mode: 'review',
    reviewSubjectId: subjectId,
    subject: { id: subjectId, name: 'Repaso' },
    topic: { id: '', name: title },
    section: { id: 'repaso', name: title, questions: shuffledQuestions },
    order: [...shuffledQuestions.keys()],
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

function formatShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(d);
}

async function estimatePdfPages(file) {
  try {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('latin1').decode(buffer);
    const matches = text.match(/\/Type\s*\/Page\b(?!s)/g);
    if (matches && matches.length > 0) {
      return matches.length;
    }
  } catch {
    // ignore estimation error
  }
  return 1;
}

async function renderAdmin(activeTab = 'usuarios') {
  activeQuiz = null;
  const tab = activeTab === 'contenido' ? 'contenido' : 'usuarios';
  setNavigation('admin', 'Panel Admin');

  if (!dataService.isAdmin()) {
    $('#page-content').innerHTML = `<section class="panel result-card"><span class="result-mark">${ICONS.shield}</span><p class="eyebrow">ZONA RESTRINGIDA</p><h2>Acceso exclusivo para el administrador</h2><p>Inicia sesión con tu cuenta de administrador desde tu perfil para abrir el panel de control.</p><div class="result-buttons"><button class="primary-button" type="button" id="admin-login-btn">Ir a mi cuenta ${ICONS.arrow}</button><a class="secondary-button" href="#inicio">Volver al inicio</a></div></section>`;
    $('#admin-login-btn')?.addEventListener('click', () => {
      location.hash = '#perfil/cuenta';
    });
    return;
  }

  renderLoading(tab === 'contenido' ? 'Cargando catálogo de asignaturas y temarios...' : 'Cargando usuarios registrados...');
  const catalog = await dataService.getCatalog();

  if (tab === 'contenido') {
    const topicTotal = totalTopics(catalog);
    $('#page-content').innerHTML = `
      <section class="welcome-row">
        <div class="welcome-copy">
          <p class="eyebrow">ESPACIO DE ADMINISTRACIÓN</p>
          <h1>Panel de control<span>.</span></h1>
          <p>Crea nuevas asignaturas y sube temarios en PDF directamente a Supabase Storage sin tocar Git.</p>
        </div>
        <div class="test-actions">
          <button class="secondary-button" type="button" id="refresh-admin-btn">Actualizar datos</button>
        </div>
      </section>

      <nav class="admin-tabs" aria-label="Secciones de administración">
        <button class="admin-tab" type="button" data-admin-tab="usuarios">
          ${ICONS.users}
          <span>Usuarios registrados</span>
        </button>
        <button class="admin-tab active" type="button" data-admin-tab="contenido">
          ${ICONS.folder}
          <span>Asignaturas y Temarios</span>
          <span class="admin-tab-count">${catalog.length} · ${topicTotal}</span>
        </button>
      </nav>

      <div class="admin-forms-grid">
        <section class="panel admin-form-card">
          <p class="eyebrow">NUEVA ASIGNATURA</p>
          <h2>Crear asignatura</h2>
          <p class="admin-panel-sub">Se guardará directamente en la tabla <code>subjects</code> de Supabase.</p>
          <form id="admin-create-subject-form" class="gen-quiz-form">
            <label class="profile-name-field">
              <span>Nombre de la asignatura</span>
              <input id="admin-subj-name" type="text" maxlength="80" required placeholder="Ej.: Historia Contemporánea" />
            </label>
            <label class="profile-name-field">
              <span>Descripción breve</span>
              <input id="admin-subj-desc" type="text" maxlength="180" required placeholder="Ej.: Procesos políticos, sociales y económicos de los siglos XIX y XX." />
            </label>
            <label class="profile-name-field">
              <span>Color identificativo</span>
              <select id="admin-subj-color">
                <option value="violet">Violeta / Rosa</option>
                <option value="amber">Ámbar / Dorado</option>
                <option value="green">Verde</option>
                <option value="blue">Azul</option>
              </select>
            </label>
            <div class="gen-modal-actions">
              <button class="primary-button" id="admin-subj-submit" type="submit">${ICONS.folder} Crear asignatura</button>
            </div>
          </form>
        </section>

        <section class="panel admin-form-card">
          <p class="eyebrow">SUBIR TEMARIO PDF A SUPABASE STORAGE</p>
          <h2>Añadir temario en PDF</h2>
          <p class="admin-panel-sub">Sube el archivo PDF al bucket público <code>temarios</code> y regístralo en la asignatura.</p>
          <form id="admin-create-topic-form" class="gen-quiz-form">
            <label class="profile-name-field">
              <span>Asignatura de destino</span>
              <select id="admin-topic-subject" required>
                ${
                  catalog.length
                    ? catalog.map((sub) => `<option value="${escapeHtml(sub.id)}">${escapeHtml(sub.name)}</option>`).join('')
                    : '<option value="">Crea primero una asignatura</option>'
                }
              </select>
            </label>
            <label class="profile-name-field">
              <span>Título del temario</span>
              <input id="admin-topic-name" type="text" maxlength="120" required placeholder="Ej.: Tema 2 · La atmósfera y el clima" />
            </label>
            <div class="gen-form-row">
              <label class="profile-name-field">
                <span>Archivo PDF</span>
                <input id="admin-topic-file" class="admin-file-input" type="file" accept="application/pdf,.pdf" required />
              </label>
              <label class="profile-name-field">
                <span>Páginas (auto)</span>
                <input id="admin-topic-pages" type="number" min="1" max="999" value="1" required />
              </label>
            </div>
            <label class="admin-checkbox-row">
              <input id="admin-topic-gen-ai" type="checkbox" checked />
              <span>Abrir el generador de test con IA al terminar de subir el PDF</span>
            </label>
            <div class="gen-quiz-status" id="admin-topic-status" hidden>
              <div class="loading-spinner small-spinner" aria-hidden="true"></div>
              <span id="admin-topic-status-text">Subiendo PDF a Supabase Storage...</span>
            </div>
            <div class="gen-modal-actions">
              <button class="primary-button" id="admin-topic-submit" type="submit" ${catalog.length ? '' : 'disabled'}>${ICONS.file} Subir PDF y crear temario</button>
            </div>
          </form>
        </section>
      </div>

      <section class="panel section-panel">
        <div class="panel-head admin-panel-head">
          <div>
            <h2>Asignaturas y temarios actuales (${catalog.length})</h2>
            <p class="admin-panel-sub">Gestiona el catálogo activo en Supabase, abre sus PDFs o genera nuevos tests.</p>
          </div>
        </div>
        <div class="subject-list-accordion admin-catalog-list">
          ${
            catalog.length === 0
              ? '<div class="admin-empty-state"><p>No hay asignaturas registradas todavía.</p></div>'
              : catalog
                  .map(
                    (subject) => `<details class="subject-accordion" open>
                      <summary>
                        <span class="summary-left">
                          ${iconTile(ICONS.folder, subject.color)}
                          <span class="summary-title">
                            <strong>${escapeHtml(subject.name)}</strong>
                            <span>ID: ${escapeHtml(subject.id)} · ${subject.topics.length} ${subject.topics.length === 1 ? 'temario' : 'temarios'} · ${escapeHtml(subject.description)}</span>
                          </span>
                        </span>
                        <span class="topic-actions">
                          <button class="icon-danger-button" type="button" data-delete-subject="${escapeHtml(subject.id)}" data-name="${escapeHtml(subject.name)}" title="Eliminar asignatura completa">${ICONS.trash}</button>
                          <span class="chevron">${ICONS.chevron}</span>
                        </span>
                      </summary>
                      <div class="topic-list">
                        ${
                          subject.topics.length === 0
                            ? '<div class="topic-row"><span class="topic-copy"><span>Sin temarios todavía. Sube un PDF desde el formulario superior.</span></span></div>'
                            : subject.topics
                                .map(
                                  (topic, idx) => `<div class="topic-row">
                                    <a class="topic-copy" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">
                                      <span class="topic-number small-number">${idx + 1}</span>
                                      <span>
                                        <strong>${escapeHtml(topic.name)}</strong>
                                        <span>${topic.pages} ${topic.pages === 1 ? 'página' : 'páginas'} · ${topic.sections.length} tests · ${escapeHtml(topic.file.startsWith('http') ? 'Supabase Storage' : topic.file)}</span>
                                      </span>
                                    </a>
                                    <span class="topic-actions">
                                      <button class="secondary-button ai-accent-button" type="button" data-open-gen-quiz data-subject="${escapeHtml(subject.id)}" data-topic="${escapeHtml(topic.id)}">${ICONS.sparkle} Test IA</button>
                                      <a class="secondary-button" href="#temario/${encodeURIComponent(subject.id)}/${encodeURIComponent(topic.id)}">Ver PDF ${ICONS.arrow}</a>
                                      <button class="icon-danger-button" type="button" data-delete-topic="${escapeHtml(topic.id)}" data-subject="${escapeHtml(subject.id)}" data-name="${escapeHtml(topic.name)}" title="Eliminar este temario">${ICONS.trash}</button>
                                    </span>
                                  </div>`
                                )
                                .join('')
                        }
                      </div>
                    </details>`
                  )
                  .join('')
          }
        </div>
      </section>
    `;

    bindGenerateButtons();

    $('#page-content').querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.dataset.adminTab;
        location.hash = nextTab === 'contenido' ? '#admin/contenido' : '#admin';
      });
    });

    $('#refresh-admin-btn')?.addEventListener('click', async () => {
      await dataService.getCatalog(true);
      renderAdmin('contenido');
    });

    $('#admin-topic-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const pages = await estimatePdfPages(file);
      $('#admin-topic-pages').value = pages;
      const nameInput = $('#admin-topic-name');
      if (!nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
      }
    });

    $('#admin-create-subject-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('#admin-subj-name').value.trim();
      const description = $('#admin-subj-desc').value.trim();
      const color = $('#admin-subj-color').value;
      if (!name) return;

      const btn = $('#admin-subj-submit');
      btn.disabled = true;
      btn.textContent = 'Creando asignatura...';
      try {
        const created = await dataService.createSubject({ name, description, color });
        await renderSidebar();
        showToast(`Asignatura "${created?.name || name}" creada en Supabase.`, 4500);
        renderAdmin('contenido');
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = `${ICONS.folder} Crear asignatura`;
        showToast(err.message || 'No se pudo crear la asignatura.', 5000);
      }
    });

    $('#admin-create-topic-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const subjectId = $('#admin-topic-subject').value;
      const name = $('#admin-topic-name').value.trim();
      const pages = Number($('#admin-topic-pages').value) || 1;
      const file = $('#admin-topic-file').files?.[0];
      const openAiAfter = $('#admin-topic-gen-ai').checked;

      if (!subjectId || !name || !file) {
        showToast('Completa la asignatura, el título y selecciona un archivo PDF.');
        return;
      }

      const submitBtn = $('#admin-topic-submit');
      const statusBox = $('#admin-topic-status');
      const statusText = $('#admin-topic-status-text');
      submitBtn.disabled = true;
      statusBox.hidden = false;

      try {
        const topic = await dataService.createTopicWithPdf({
          subjectId,
          name,
          pages,
          file,
          onProgress: (msg) => {
            statusText.textContent = msg;
          }
        });
        await renderSidebar();
        showToast(`Temario "${topic?.name || name}" subido a Supabase Storage.`, 4500);
        await renderAdmin('contenido');
        if (openAiAfter && topic?.id) {
          openGenerateQuizModal(subjectId, topic.id);
        }
      } catch (err) {
        submitBtn.disabled = false;
        statusBox.hidden = true;
        showToast(err.message || 'No se pudo subir el PDF del temario.', 5500);
      }
    });

    $('#page-content').querySelectorAll('[data-delete-subject]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const subjectId = btn.dataset.deleteSubject;
        const name = btn.dataset.name || subjectId;
        if (!confirm(`¿Seguro que quieres eliminar la asignatura "${name}" y todos sus temarios y tests asociados?`)) {
          return;
        }
        btn.disabled = true;
        try {
          await dataService.deleteSubject(subjectId);
          await renderSidebar();
          showToast(`Asignatura "${name}" eliminada.`);
          renderAdmin('contenido');
        } catch (err) {
          btn.disabled = false;
          showToast(err.message || 'No se pudo eliminar la asignatura.', 5000);
        }
      });
    });

    $('#page-content').querySelectorAll('[data-delete-topic]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const topicId = btn.dataset.deleteTopic;
        const subjectId = btn.dataset.subject;
        const name = btn.dataset.name || topicId;
        if (!confirm(`¿Seguro que quieres eliminar el temario "${name}" y sus tests asociados?`)) {
          return;
        }
        btn.disabled = true;
        try {
          await dataService.deleteTopic(subjectId, topicId);
          showToast(`Temario "${name}" eliminado.`);
          renderAdmin('contenido');
        } catch (err) {
          btn.disabled = false;
          showToast(err.message || 'No se pudo eliminar el temario.', 5000);
        }
      });
    });

    return;
  }

  let users = [];
  let loadError = null;
  try {
    users = await dataService.getAdminUsers();
  } catch (err) {
    loadError = err.message || 'No se pudo cargar la lista de usuarios.';
  }

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.testsCompleted > 0).length;
  const totalCompletedTests = users.reduce((sum, u) => sum + (Number(u.testsCompleted) || 0), 0);

  function renderUserRow(u) {
    const displayName = u.name?.trim() || 'Sin nombre definido';
    const initial = (u.name?.trim() || u.email || 'U').charAt(0).toLocaleUpperCase('es');
    const avatarHtml = u.avatar
      ? `<img class="avatar-img" src="${escapeHtml(u.avatar)}" alt="${escapeHtml(displayName)}" />`
      : escapeHtml(initial);
    const scoreBadge =
      u.averageScore === null
        ? '<span class="score-badge is-pending">Sin intentos</span>'
        : `<span class="score-badge ${u.averageScore >= 80 ? 'is-high' : u.averageScore >= 60 ? 'is-mid' : 'is-low'}">Media: ${u.averageScore}%</span>`;

    return `<div class="admin-user-row" data-search="${escapeHtml(`${displayName} ${u.email}`.toLowerCase())}">
      <a class="admin-user-main" href="#usuario/${encodeURIComponent(u.id)}" title="Ver perfil público de ${escapeHtml(displayName)}">
        <span class="avatar admin-user-avatar">${avatarHtml}</span>
        <div class="admin-user-copy">
          <div class="admin-user-title">
            <strong>${escapeHtml(displayName)}</strong>
            ${u.isAdmin ? '<span class="admin-role-badge">Admin</span>' : ''}
          </div>
          <span>${escapeHtml(u.email || 'Sin correo')}</span>
        </div>
      </a>
      <div class="admin-user-dates">
        <span>Registro: <strong>${escapeHtml(formatShortDate(u.createdAt))}</strong></span>
        <span>Último acceso: <strong>${escapeHtml(formatShortDate(u.lastSignInAt))}</strong></span>
      </div>
      <div class="admin-user-metrics">
        <span class="test-count">${u.testsCompleted} ${u.testsCompleted === 1 ? 'test' : 'tests'}</span>
        ${scoreBadge}
        ${u.pendingMistakes > 0 ? `<span class="score-badge is-low" title="Preguntas pendientes en Repasar fallos">${u.pendingMistakes} ${u.pendingMistakes === 1 ? 'fallo' : 'fallos'}</span>` : ''}
        <a class="secondary-button" href="#usuario/${encodeURIComponent(u.id)}">Ver perfil ${ICONS.arrow}</a>
      </div>
    </div>`;
  }

  $('#page-content').innerHTML = `
    <section class="welcome-row">
      <div class="welcome-copy">
        <p class="eyebrow">ESPACIO DE ADMINISTRACIÓN</p>
        <h1>Panel de control<span>.</span></h1>
        <p>Supervisa los estudiantes registrados y gestiona el contenido de la biblioteca.</p>
      </div>
      <div class="test-actions">
        <button class="secondary-button" type="button" id="refresh-admin-btn">Actualizar datos</button>
      </div>
    </section>

    <nav class="admin-tabs" aria-label="Secciones de administración">
      <button class="admin-tab active" type="button" data-admin-tab="usuarios">
        ${ICONS.users}
        <span>Usuarios registrados</span>
        <span class="admin-tab-count">${totalUsers}</span>
      </button>
      <button class="admin-tab" type="button" data-admin-tab="contenido">
        ${ICONS.folder}
        <span>Asignaturas y Temarios</span>
        <span class="admin-tab-count">${catalog.length} · ${totalTopics(catalog)}</span>
      </button>
    </nav>

    <section class="stats-grid">
      <article class="stat-card">
        <span class="stat-icon purple">${ICONS.users}</span>
        <div>
          <span class="stat-label">Usuarios registrados</span>
          <strong class="stat-number">${totalUsers}</strong>
          <span class="stat-context">en Supabase Auth</span>
        </div>
      </article>
      <article class="stat-card">
        <span class="stat-icon green">${ICONS.check}</span>
        <div>
          <span class="stat-label">Estudiantes activos</span>
          <strong class="stat-number">${activeUsers}</strong>
          <span class="stat-context">con al menos 1 test</span>
        </div>
      </article>
      <article class="stat-card">
        <span class="stat-icon blue">${ICONS.book}</span>
        <div>
          <span class="stat-label">Tests realizados</span>
          <strong class="stat-number">${totalCompletedTests}</strong>
          <span class="stat-context">en total</span>
        </div>
      </article>
    </section>

    <section class="panel section-panel">
      <div class="panel-head admin-panel-head">
        <div>
          <h2>Directorio de usuarios (${totalUsers})</h2>
          <p class="admin-panel-sub">Cuentas registradas, última conexión y resumen de actividad.</p>
        </div>
        <input id="admin-user-search" class="admin-search-input" type="search" placeholder="Buscar por nombre o correo..." />
      </div>
      ${
        loadError
          ? `<div class="admin-empty-state"><p>${escapeHtml(loadError)}</p></div>`
          : users.length === 0
          ? `<div class="admin-empty-state"><p>Todavía no hay usuarios registrados.</p></div>`
          : `<div class="admin-user-list" id="admin-user-list">${users.map(renderUserRow).join('')}</div>`
      }
    </section>
  `;

  $('#page-content').querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTab = btn.dataset.adminTab;
      location.hash = nextTab === 'contenido' ? '#admin/contenido' : '#admin';
    });
  });

  $('#refresh-admin-btn')?.addEventListener('click', () => renderAdmin('usuarios'));
  $('#admin-user-search')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    document.querySelectorAll('#admin-user-list .admin-user-row').forEach((row) => {
      const hay = row.dataset.search || '';
      row.hidden = Boolean(q && !hay.includes(q));
    });
  });
}

async function renderProfile(tab = 'actividad') {
  stopExamTimer();
  setNavigation('profile', 'Perfil');

  const profile = dataService.readProfile();
  const loggedIn = dataService.isLoggedIn();
  const isAdmin = dataService.isAdmin();
  const user = dataService.getUser();
  const displayName = profile.name?.trim() || 'Mi espacio';
  const email = user?.email || '';
  const handle = email
    ? `@${email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').toLowerCase()}`
    : `@${displayName.toLowerCase().replace(/\s+/g, '') || 'estudiante'}`;
  const bio =
    profile.bio?.trim() ||
    'Estudiante en Cuaderno · Practicando con tests interactivos y simulacros de examen.';
  const bannerColor = profile.banner || 'gold';

  const [catalog, mistakes] = await Promise.all([
    dataService.getCatalog(),
    loggedIn ? dataService.getMistakes().catch(() => []) : Promise.resolve([])
  ]);

  const scores = dataService.readScores();
  const attempts = scores.length;
  const questions = scores.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const correct = Math.round(scores.reduce((sum, s) => sum + (Number(s.score) || 0), 0) * 10) / 10;
  const average = attempts
    ? Math.round(scores.reduce((sum, s) => sum + (Number(s.percentage) || 0), 0) / attempts)
    : null;

  const initial = !displayName || displayName === 'Mi espacio' ? 'E' : displayName.charAt(0).toLocaleUpperCase('es');
  const avatarInnerHtml = profile.avatar
    ? `<img class="avatar-img" src="${escapeHtml(profile.avatar)}" alt="${escapeHtml(displayName)}" />`
    : escapeHtml(initial);

  let tabContentHtml = '';

  if (tab === 'asignaturas') {
    const bySubject = new Map();
    for (const s of scores) {
      const subName = s.subject || 'General';
      const cur = bySubject.get(subName) || { count: 0, sum: 0, best: 0 };
      const pct = Number(s.percentage) || 0;
      cur.count += 1;
      cur.sum += pct;
      if (pct > cur.best) cur.best = pct;
      bySubject.set(subName, cur);
    }

    const cardsHtml = catalog
      .map((sub) => {
        const stat = bySubject.get(sub.name) || { count: 0, sum: 0, best: 0 };
        const avg = stat.count ? Math.round(stat.sum / stat.count) : 0;
        const tier = !stat.count ? 'is-pending' : avg >= 80 ? 'is-high' : avg >= 60 ? 'is-mid' : 'is-low';
        return `<div class="x-feed-item">
          <div class="x-feed-avatar">${iconTile(ICONS.folder, sub.color)}</div>
          <div class="x-feed-body">
            <div class="x-feed-header">
              <div>
                <strong>${escapeHtml(sub.name)}</strong>
                <span class="x-feed-meta"> · ${sub.topics.length} ${sub.topics.length === 1 ? 'temario' : 'temarios'}</span>
              </div>
              <span class="score-badge ${tier}">${stat.count ? `Media: ${avg}% · Mejor: ${stat.best}%` : 'Sin intentos'}</span>
            </div>
            <p class="x-feed-text">${escapeHtml(sub.description)}</p>
            <div class="subject-progress-bar x-progress-bar"><span style="width:${stat.count ? Math.max(4, Math.min(100, avg)) : 0}%"></span></div>
            <div class="x-feed-footer">
              <span>${stat.count} ${stat.count === 1 ? 'test completado' : 'tests completados'}</span>
              <div class="topic-actions">
                <button class="secondary-button" type="button" data-open-exam data-subject="${escapeHtml(sub.id)}">${ICONS.clock} Simulacro</button>
                <a class="primary-button" href="#asignatura/${encodeURIComponent(sub.id)}">Ver temario ${ICONS.arrow}</a>
              </div>
            </div>
          </div>
        </div>`;
      })
      .join('');

    tabContentHtml = cardsHtml || '<div class="admin-empty-state"><p>Todavía no hay asignaturas disponibles.</p></div>';
  } else if (tab === 'cuenta') {
    if (!dataService.isAuthAvailable()) {
      tabContentHtml = `<div class="x-account-section"><p class="account-text">El modo en la nube (Supabase Auth) no está configurado en este entorno. Tus datos se guardan localmente en este navegador.</p></div>`;
    } else if (!loggedIn) {
      tabContentHtml = `
        <div class="x-account-section">
          <div class="x-account-card">
            <p class="eyebrow">SINCRONIZACIÓN EN LA NUBE</p>
            <h3>Inicia sesión o crea tu cuenta</h3>
            <p class="account-text">Accede con tu correo y contraseña para sincronizar tu foto de perfil, tu historial de notas y tu banco de fallos en todos tus dispositivos.</p>
            <form class="account-form account-form-stack" id="page-login-form">
              <label class="profile-name-field">
                <span>Correo electrónico</span>
                <input id="page-login-email" type="email" required autocomplete="email" placeholder="tu@email.com" />
              </label>
              <label class="profile-name-field">
                <span>Contraseña</span>
                <input id="page-login-password" type="password" minlength="6" autocomplete="current-password" placeholder="Contraseña (mín. 6 caracteres)" />
              </label>
              <div class="account-actions">
                <button class="primary-button" id="page-login-submit" type="submit">Entrar / Crear cuenta</button>
                <button class="secondary-button" id="page-magic-link-btn" type="button">Enviar enlace mágico al correo</button>
              </div>
            </form>
          </div>
        </div>
      `;
    } else {
      tabContentHtml = `
        <div class="x-account-section">
          <div class="x-account-card">
            <p class="eyebrow">SESIÓN ACTIVA</p>
            <h3>Conectado como ${escapeHtml(email)}</h3>
            <p class="account-text">Tu foto de perfil, tu nombre, tu historial de notas y tus preguntas falladas se sincronizan automáticamente con Supabase.</p>
            <div class="x-password-box">
              <label class="profile-name-field">
                <span>Cambiar o definir contraseña de acceso</span>
                <div class="account-password-row">
                  <input id="page-new-password" type="password" minlength="6" autocomplete="new-password" placeholder="Nueva contraseña (mín. 6 caracteres)" />
                  <button class="secondary-button" id="page-save-password-btn" type="button">Guardar clave</button>
                </div>
              </label>
            </div>
            <div class="x-account-danger-row">
              <span>¿Quieres salir de tu cuenta en este dispositivo?</span>
              <button class="secondary-button" id="page-logout-btn" type="button">Cerrar sesión</button>
            </div>
          </div>
        </div>
      `;
    }
  } else {
    // Tab por defecto: 'actividad' (Timeline estilo Twitter/X)
    if (!scores.length) {
      tabContentHtml = `
        <div class="admin-empty-state x-empty-feed">
          <h3>Tu timeline de estudio está vacío</h3>
          <p>Completa cualquier test o lanza un simulacro de examen para que tus resultados aparezcan publicados aquí.</p>
          <div class="result-buttons" style="margin-top:14px">
            <a class="primary-button" href="#tests">Explorar tests ${ICONS.arrow}</a>
            <button class="secondary-button" type="button" data-open-exam>${ICONS.clock} Hacer simulacro</button>
          </div>
        </div>
      `;
    } else {
      const feedRows = scores
        .slice(0, 40)
        .map((item) => {
          const pct = Number(item.percentage) || 0;
          const tier = pct >= 80 ? 'is-high' : pct >= 60 ? 'is-mid' : 'is-low';
          const isSim = String(item.section || '').toLowerCase().includes('simulacro');
          const subObj = catalog.find((s) => s.name === item.subject);
          return `<article class="x-feed-item">
            <div class="x-feed-avatar">
              <span class="avatar x-feed-user-avatar">${avatarInnerHtml}</span>
            </div>
            <div class="x-feed-body">
              <div class="x-feed-header">
                <div class="x-feed-author">
                  <strong>${escapeHtml(displayName)}</strong>
                  <span class="x-feed-handle">${escapeHtml(handle)}</span>
                  <span class="x-feed-dot">·</span>
                  <span class="x-feed-time">${escapeHtml(formatAttemptDateTime(item.date))}</span>
                </div>
                <span class="score-badge ${tier}">${pct}%</span>
              </div>
              <p class="x-feed-action-line">
                Ha completado ${isSim ? 'un <strong>simulacro de examen</strong>' : 'el cuestionario'} en <strong>${escapeHtml(item.subject || 'Cuaderno')}</strong>
              </p>
              <div class="x-feed-card">
                <div class="x-feed-card-left">
                  <span class="test-index">${isSim ? ICONS.clock : ICONS.check}</span>
                  <div>
                    <strong>${escapeHtml(item.section || 'Cuestionario')}</strong>
                    <span>${escapeHtml(String(item.score ?? 0))} de ${escapeHtml(String(item.total ?? 0))} aciertos netos · ${escapeHtml(item.subject || '')}</span>
                  </div>
                </div>
                ${subObj ? `<a class="secondary-button" href="#asignatura/${encodeURIComponent(subObj.id)}">Ir al tema ${ICONS.arrow}</a>` : ''}
              </div>
            </div>
          </article>`;
        })
        .join('');

      tabContentHtml = `
        <div class="x-feed-toolbar">
          <span>Mostrando tus últimos ${Math.min(scores.length, 40)} intentos</span>
          <button type="button" class="back-link danger-link" id="clear-scores-page-btn">${ICONS.trash} Vaciar historial</button>
        </div>
        <div class="x-feed-list">${feedRows}</div>
      `;
    }
  }

  $('#page-content').innerHTML = `
    <section class="panel x-profile-shell">
      <header class="x-profile-StickyHead">
        <a class="x-back-circle" href="#inicio" title="Volver al inicio" aria-label="Volver al inicio">←</a>
        <div>
          <div class="x-head-title-row">
            <h2>${escapeHtml(displayName)}</h2>
            ${isAdmin ? '<span class="admin-role-badge">Admin</span>' : ''}
          </div>
          <span>${attempts} ${attempts === 1 ? 'test completado' : 'tests completados'} · ${questions} preguntas respondidas</span>
        </div>
      </header>

      <div class="x-banner" data-banner="${escapeHtml(bannerColor)}"></div>

      <div class="x-profile-main">
        <div class="x-avatar-bar">
          <button class="avatar x-profile-avatar" id="x-trigger-avatar-edit" type="button" title="Editar foto y perfil">
            ${avatarInnerHtml}
          </button>
          <div class="x-profile-actions">
            <a class="secondary-button x-edit-btn" href="#comunidad">${ICONS.users} Comunidad</a>
            ${
              mistakes.length > 0
                ? `<a class="secondary-button x-edit-btn" href="#repaso">${ICONS.target} Fallos (${mistakes.length})</a>`
                : ''
            }
            <button class="secondary-button x-edit-btn" id="x-open-edit-modal" type="button">Editar perfil</button>
          </div>
        </div>

        <div class="x-identity-block">
          <div class="x-name-line">
            <h1>${escapeHtml(displayName)}</h1>
            ${isAdmin ? `<span class="x-verified-badge" title="Administrador verificado">${ICONS.shield} Admin</span>` : ''}
          </div>
          <p class="x-handle">${escapeHtml(handle)}${email ? ` · ${escapeHtml(email)}` : ''}</p>
          <p class="x-bio">${escapeHtml(bio)}</p>

          <div class="x-meta-items">
            <span>
              <span class="online-dot" style="display:inline-block;margin-right:4px"></span>
              ${loggedIn ? 'Sincronizado en la nube' : 'Guardado en este navegador'}
            </span>
            <span>·</span>
            <span>${catalog.length} asignaturas activas</span>
          </div>

          <div class="x-follow-stats">
            <a href="#perfil" class="x-stat-pill"><strong>${attempts}</strong> <span>Tests</span></a>
            <a href="#perfil" class="x-stat-pill"><strong>${average !== null ? `${average}%` : '—'}</strong> <span>Nota media</span></a>
            <a href="#perfil" class="x-stat-pill"><strong>${questions ? `${correct}/${questions}` : '0'}</strong> <span>Aciertos</span></a>
            <a href="${mistakes.length ? '#repaso' : '#perfil'}" class="x-stat-pill"><strong>${mistakes.length}</strong> <span>Fallos pendientes</span></a>
          </div>
        </div>
      </div>

      <nav class="x-tabs" aria-label="Secciones del perfil">
        <button type="button" class="x-tab ${tab === 'actividad' ? 'active' : ''}" data-profile-tab="actividad">
          <span>Actividad</span>
        </button>
        <button type="button" class="x-tab ${tab === 'asignaturas' ? 'active' : ''}" data-profile-tab="asignaturas">
          <span>Asignaturas</span>
        </button>
        <button type="button" class="x-tab ${tab === 'cuenta' ? 'active' : ''}" data-profile-tab="cuenta">
          <span>Cuenta ${loggedIn ? '✓' : ''}</span>
        </button>
      </nav>

      <div class="x-tab-panel">
        ${tabContentHtml}
      </div>
    </section>
  `;

  bindGenerateButtons();

  $('#x-open-edit-modal')?.addEventListener('click', openEditProfileModal);
  $('#x-trigger-avatar-edit')?.addEventListener('click', openEditProfileModal);

  $('#page-content').querySelectorAll('[data-profile-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.profileTab;
      location.hash = next === 'actividad' ? '#perfil' : `#perfil/${next}`;
    });
  });

  $('#clear-scores-page-btn')?.addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres borrar todo tu historial de notas y estadísticas?')) return;
    const btn = $('#clear-scores-page-btn');
    btn.disabled = true;
    btn.textContent = 'Borrando...';
    try {
      await dataService.clearScores();
      showToast('Historial de notas vaciado.');
      renderProfile('actividad');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Vaciar historial';
      showToast(err.message || 'No se pudo borrar el historial.', 4500);
    }
  });

  $('#page-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const loginEmail = $('#page-login-email').value.trim();
    const password = $('#page-login-password').value;
    if (!loginEmail) return;
    if (!password || password.length < 6) {
      showToast('Introduce una contraseña de al menos 6 caracteres, o pulsa "Enviar enlace mágico".', 5000);
      return;
    }
    const button = $('#page-login-submit');
    button.disabled = true;
    button.textContent = 'Entrando...';
    try {
      const res = await dataService.signInWithPassword(loginEmail, password);
      if (res.status === 'confirm_email') {
        showToast(`Te hemos enviado un correo a ${loginEmail} para confirmar tu cuenta.`, 7000);
        button.disabled = false;
        button.textContent = 'Entrar / Crear cuenta';
      } else {
        updateProfileLabels();
        await renderSidebar();
        renderProfile('actividad');
        showToast(`Sesión iniciada como ${loginEmail}.`, 4000);
      }
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Entrar / Crear cuenta';
      showToast(err.message || 'No se pudo iniciar sesión.', 6000);
    }
  });

  $('#page-magic-link-btn')?.addEventListener('click', async () => {
    const loginEmail = $('#page-login-email')?.value?.trim();
    if (!loginEmail) {
      showToast('Escribe tu correo primero para enviarte el enlace.', 4000);
      $('#page-login-email')?.focus();
      return;
    }
    const button = $('#page-magic-link-btn');
    button.disabled = true;
    button.textContent = 'Enviando...';
    try {
      await dataService.sendMagicLink(loginEmail);
      showToast(`Enlace enviado a ${loginEmail}. Nota: cada enlace del correo sirve para un único uso.`, 7000);
    } catch (err) {
      showToast(err.message || 'No se pudo enviar el enlace de acceso.', 5000);
    } finally {
      button.disabled = false;
      button.textContent = 'Enviar enlace mágico al correo';
    }
  });

  $('#page-save-password-btn')?.addEventListener('click', async () => {
    const newPass = $('#page-new-password')?.value || '';
    if (newPass.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres.', 4000);
      return;
    }
    const button = $('#page-save-password-btn');
    button.disabled = true;
    button.textContent = 'Guardando...';
    try {
      await dataService.updatePassword(newPass);
      $('#page-new-password').value = '';
      showToast('Contraseña guardada. Ya puedes usarla en cualquier dispositivo.', 5000);
    } catch (err) {
      showToast(err.message || 'No se pudo guardar la contraseña.', 5000);
    } finally {
      button.disabled = false;
      button.textContent = 'Guardar clave';
    }
  });

  $('#page-logout-btn')?.addEventListener('click', async () => {
    await dataService.signOut();
    updateProfileLabels();
    await renderSidebar();
    showToast('Sesión cerrada.');
    renderProfile('cuenta');
  });
}

async function renderCommunity(activeTab = 'estudiantes') {
  stopExamTimer();
  const tab = activeTab === 'actividad' ? 'actividad' : 'estudiantes';
  setNavigation('community', 'Comunidad');
  renderLoading('Cargando comunidad de estudiantes...');

  let users = [];
  let feed = [];
  let loadError = null;
  try {
    const res = await dataService.getCommunityData();
    users = res.users;
    feed = res.feed;
  } catch (err) {
    loadError = err.message || 'No se pudo cargar la comunidad.';
  }

  const myUserId = dataService.getUser()?.id || '';

  const userCardsHtml = users
    .map((u) => {
      const initial = (u.name || 'E').charAt(0).toLocaleUpperCase('es');
      const avatarHtml = u.avatar
        ? `<img class="avatar-img" src="${escapeHtml(u.avatar)}" alt="${escapeHtml(u.name)}" />`
        : escapeHtml(initial);
      const scoreBadge =
        u.averageScore === null
          ? '<span class="score-badge is-pending">Sin intentos</span>'
          : `<span class="score-badge ${u.averageScore >= 80 ? 'is-high' : u.averageScore >= 60 ? 'is-mid' : 'is-low'}">Media: ${u.averageScore}%</span>`;
      const isMe = myUserId && u.id === myUserId;
      const targetHref = isMe ? '#perfil' : `#usuario/${encodeURIComponent(u.id)}`;

      return `<a class="x-user-card" href="${targetHref}" data-search="${escapeHtml(`${u.name} ${u.handle} ${u.bio || ''}`.toLowerCase())}">
        <div class="x-user-card-banner" data-banner="${escapeHtml(u.banner || 'gold')}"></div>
        <div class="x-user-card-body">
          <div class="x-user-card-top">
            <span class="avatar x-user-card-avatar">${avatarHtml}</span>
            <span class="secondary-button x-pill-btn">${isMe ? 'Tu perfil' : 'Ver perfil'}</span>
          </div>
          <div class="x-user-card-name">
            <strong>${escapeHtml(u.name)}</strong>
            ${u.isAdmin ? '<span class="admin-role-badge">Admin</span>' : ''}
          </div>
          <span class="x-handle">${escapeHtml(u.handle)}</span>
          <p class="x-user-card-bio">${escapeHtml(u.bio || 'Estudiante en Cuaderno.')}</p>
          <div class="x-user-card-stats">
            <span><strong>${u.testsCompleted}</strong> ${u.testsCompleted === 1 ? 'test' : 'tests'}</span>
            ${scoreBadge}
          </div>
        </div>
      </a>`;
    })
    .join('');

  const feedHtml = feed
    .map((item) => {
      const initial = (item.userName || 'E').charAt(0).toLocaleUpperCase('es');
      const avatarHtml = item.userAvatar
        ? `<img class="avatar-img" src="${escapeHtml(item.userAvatar)}" alt="${escapeHtml(item.userName)}" />`
        : escapeHtml(initial);
      const pct = Number(item.percentage) || 0;
      const tier = pct >= 80 ? 'is-high' : pct >= 60 ? 'is-mid' : 'is-low';
      const isSim = String(item.section || '').toLowerCase().includes('simulacro');
      const profileHref = myUserId && item.userId === myUserId ? '#perfil' : `#usuario/${encodeURIComponent(item.userId)}`;

      return `<article class="x-feed-item">
        <a class="x-feed-avatar" href="${profileHref}" title="Ver perfil de ${escapeHtml(item.userName)}">
          <span class="avatar x-feed-user-avatar">${avatarHtml}</span>
        </a>
        <div class="x-feed-body">
          <div class="x-feed-header">
            <div class="x-feed-author">
              <a class="x-author-link" href="${profileHref}"><strong>${escapeHtml(item.userName)}</strong></a>
              ${item.isAdmin ? '<span class="admin-role-badge">Admin</span>' : ''}
              <span class="x-feed-handle">${escapeHtml(item.userHandle)}</span>
              <span class="x-feed-dot">·</span>
              <span class="x-feed-time">${escapeHtml(formatAttemptDateTime(item.date))}</span>
            </div>
            <span class="score-badge ${tier}">${pct}%</span>
          </div>
          <p class="x-feed-action-line">
            Ha completado ${isSim ? 'un <strong>simulacro de examen</strong>' : 'el cuestionario'} en <strong>${escapeHtml(item.subject || 'Cuaderno')}</strong>
          </p>
          <div class="x-feed-card">
            <div class="x-feed-card-left">
              <span class="test-index">${isSim ? ICONS.clock : ICONS.check}</span>
              <div>
                <strong>${escapeHtml(item.section || 'Cuestionario')}</strong>
                <span>${escapeHtml(String(item.score ?? 0))} de ${escapeHtml(String(item.total ?? 0))} aciertos · ${escapeHtml(item.subject || '')}</span>
              </div>
            </div>
            <a class="secondary-button" href="${profileHref}">Ver perfil ${ICONS.arrow}</a>
          </div>
        </div>
      </article>`;
    })
    .join('');

  $('#page-content').innerHTML = `
    <section class="welcome-row">
      <div class="welcome-copy">
        <p class="eyebrow">COMUNIDAD DE ESTUDIANTES</p>
        <h1>Explorar perfiles<span>.</span></h1>
        <p>Descubre a tus compañeros de curso, consulta sus estadísticas y entra a ver su perfil completo.</p>
      </div>
      <div class="test-actions">
        <a class="secondary-button" href="#perfil">Ir a mi perfil ${ICONS.arrow}</a>
      </div>
    </section>

    <nav class="admin-tabs" aria-label="Vistas de comunidad">
      <button class="admin-tab ${tab === 'estudiantes' ? 'active' : ''}" type="button" data-comm-tab="estudiantes">
        ${ICONS.users}
        <span>Estudiantes</span>
        <span class="admin-tab-count">${users.length}</span>
      </button>
      <button class="admin-tab ${tab === 'actividad' ? 'active' : ''}" type="button" data-comm-tab="actividad">
        ${ICONS.clock}
        <span>Actividad en vivo</span>
        <span class="admin-tab-count">${feed.length}</span>
      </button>
    </nav>

    ${
      loadError
        ? `<section class="panel section-panel"><div class="admin-empty-state"><p>${escapeHtml(loadError)}</p></div></section>`
        : tab === 'actividad'
        ? `<section class="panel x-profile-shell">
            ${
              feed.length === 0
                ? '<div class="admin-empty-state"><p>Todavía no hay actividad reciente registrada en la comunidad.</p></div>'
                : `<div class="x-feed-list">${feedHtml}</div>`
            }
          </section>`
        : `<section class="panel section-panel">
            <div class="panel-head admin-panel-head">
              <div>
                <h2>Compañeros registrados (${users.length})</h2>
                <p class="admin-panel-sub">Pulsa sobre cualquier tarjeta para abrir su perfil completo al estilo Twitter / X.</p>
              </div>
              <input id="comm-user-search" class="admin-search-input" type="search" placeholder="Buscar por nombre o @usuario..." />
            </div>
            ${
              users.length === 0
                ? '<div class="admin-empty-state"><p>Todavía no hay estudiantes registrados.</p></div>'
                : `<div class="x-user-cards-grid" id="comm-users-grid">${userCardsHtml}</div>`
            }
          </section>`
    }
  `;

  $('#page-content').querySelectorAll('[data-comm-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.commTab;
      location.hash = next === 'actividad' ? '#comunidad/actividad' : '#comunidad';
    });
  });

  $('#comm-user-search')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    document.querySelectorAll('#comm-users-grid .x-user-card').forEach((card) => {
      const hay = card.dataset.search || '';
      card.hidden = Boolean(q && !hay.includes(q));
    });
  });
}

async function renderPublicProfile(userId, activeTab = 'actividad') {
  stopExamTimer();
  if (!userId) return renderCommunity();

  const myUserId = dataService.getUser()?.id || '';
  if (myUserId && userId === myUserId) {
    location.hash = '#perfil';
    return;
  }

  const tab = activeTab === 'asignaturas' ? 'asignaturas' : 'actividad';
  setNavigation('community', 'Perfil de estudiante');
  renderLoading('Cargando perfil del estudiante...');

  try {
    const [{ profile, scores }, catalog] = await Promise.all([
      dataService.getPublicUserProfile(userId),
      dataService.getCatalog()
    ]);

    const displayName = profile.name || 'Estudiante';
    setNavigation('community', displayName);
    const initial = displayName.charAt(0).toLocaleUpperCase('es');
    const avatarInnerHtml = profile.avatar
      ? `<img class="avatar-img" src="${escapeHtml(profile.avatar)}" alt="${escapeHtml(displayName)}" />`
      : escapeHtml(initial);
    const bio =
      profile.bio?.trim() ||
      'Estudiante en Cuaderno · Practicando con tests interactivos y simulacros de examen.';
    const bannerColor = profile.banner || 'gold';

    let tabContentHtml = '';
    if (tab === 'asignaturas') {
      const bySubject = new Map();
      for (const s of scores || []) {
        const subName = s.subject || 'General';
        const cur = bySubject.get(subName) || { count: 0, sum: 0, best: 0 };
        const pct = Number(s.percentage) || 0;
        cur.count += 1;
        cur.sum += pct;
        if (pct > cur.best) cur.best = pct;
        bySubject.set(subName, cur);
      }

      tabContentHtml = catalog
        .map((sub) => {
          const stat = bySubject.get(sub.name) || { count: 0, sum: 0, best: 0 };
          const avg = stat.count ? Math.round(stat.sum / stat.count) : 0;
          const tier = !stat.count ? 'is-pending' : avg >= 80 ? 'is-high' : avg >= 60 ? 'is-mid' : 'is-low';
          return `<div class="x-feed-item">
            <div class="x-feed-avatar">${iconTile(ICONS.folder, sub.color)}</div>
            <div class="x-feed-body">
              <div class="x-feed-header">
                <div>
                  <strong>${escapeHtml(sub.name)}</strong>
                  <span class="x-feed-meta"> · ${stat.count} ${stat.count === 1 ? 'test completado' : 'tests completados'}</span>
                </div>
                <span class="score-badge ${tier}">${stat.count ? `Media: ${avg}% · Mejor: ${stat.best}%` : 'Sin intentos'}</span>
              </div>
              <div class="subject-progress-bar x-progress-bar"><span style="width:${stat.count ? Math.max(4, Math.min(100, avg)) : 0}%"></span></div>
            </div>
          </div>`;
        })
        .join('');
    } else {
      if (!scores || !scores.length) {
        tabContentHtml = `<div class="admin-empty-state"><p>${escapeHtml(displayName)} todavía no ha completado ningún cuestionario.</p></div>`;
      } else {
        tabContentHtml = `<div class="x-feed-list">${scores
          .map((item) => {
            const pct = Number(item.percentage) || 0;
            const tier = pct >= 80 ? 'is-high' : pct >= 60 ? 'is-mid' : 'is-low';
            const isSim = String(item.section || '').toLowerCase().includes('simulacro');
            const subObj = catalog.find((s) => s.name === item.subject);
            return `<article class="x-feed-item">
              <div class="x-feed-avatar">
                <span class="avatar x-feed-user-avatar">${avatarInnerHtml}</span>
              </div>
              <div class="x-feed-body">
                <div class="x-feed-header">
                  <div class="x-feed-author">
                    <strong>${escapeHtml(displayName)}</strong>
                    <span class="x-feed-handle">${escapeHtml(profile.handle)}</span>
                    <span class="x-feed-dot">·</span>
                    <span class="x-feed-time">${escapeHtml(formatAttemptDateTime(item.date))}</span>
                  </div>
                  <span class="score-badge ${tier}">${pct}%</span>
                </div>
                <p class="x-feed-action-line">
                  Ha completado ${isSim ? 'un <strong>simulacro de examen</strong>' : 'el cuestionario'} en <strong>${escapeHtml(item.subject || 'Cuaderno')}</strong>
                </p>
                <div class="x-feed-card">
                  <div class="x-feed-card-left">
                    <span class="test-index">${isSim ? ICONS.clock : ICONS.check}</span>
                    <div>
                      <strong>${escapeHtml(item.section || 'Cuestionario')}</strong>
                      <span>${escapeHtml(String(item.score ?? 0))} de ${escapeHtml(String(item.total ?? 0))} aciertos · ${escapeHtml(item.subject || '')}</span>
                    </div>
                  </div>
                  ${subObj ? `<a class="secondary-button" href="#asignatura/${encodeURIComponent(subObj.id)}">Ir al tema ${ICONS.arrow}</a>` : ''}
                </div>
              </div>
            </article>`;
          })
          .join('')}</div>`;
      }
    }

    $('#page-content').innerHTML = `
      <section class="panel x-profile-shell">
        <header class="x-profile-StickyHead">
          <a class="x-back-circle" href="#comunidad" title="Volver a Comunidad" aria-label="Volver a Comunidad">←</a>
          <div>
            <div class="x-head-title-row">
              <h2>${escapeHtml(displayName)}</h2>
              ${profile.isAdmin ? '<span class="admin-role-badge">Admin</span>' : ''}
            </div>
            <span>${profile.testsCompleted} ${profile.testsCompleted === 1 ? 'test completado' : 'tests completados'} · ${profile.totalQuestions} preguntas respondidas</span>
          </div>
        </header>

        <div class="x-banner" data-banner="${escapeHtml(bannerColor)}"></div>

        <div class="x-profile-main">
          <div class="x-avatar-bar">
            <span class="avatar x-profile-avatar" style="cursor:default">
              ${avatarInnerHtml}
            </span>
            <div class="x-profile-actions">
              <a class="secondary-button x-edit-btn" href="#comunidad">${ICONS.users} Ver todos</a>
            </div>
          </div>

          <div class="x-identity-block">
            <div class="x-name-line">
              <h1>${escapeHtml(displayName)}</h1>
              ${profile.isAdmin ? `<span class="x-verified-badge" title="Administrador verificado">${ICONS.shield} Admin</span>` : ''}
            </div>
            <p class="x-handle">${escapeHtml(profile.handle)}</p>
            <p class="x-bio">${escapeHtml(bio)}</p>

            <div class="x-meta-items">
              <span>Miembro desde ${escapeHtml(formatShortDate(profile.createdAt))}</span>
            </div>

            <div class="x-follow-stats">
              <span class="x-stat-pill"><strong>${profile.testsCompleted}</strong> <span>Tests</span></span>
              <span class="x-stat-pill"><strong>${profile.averageScore !== null ? `${profile.averageScore}%` : '—'}</strong> <span>Nota media</span></span>
              <span class="x-stat-pill"><strong>${profile.totalQuestions ? `${profile.totalCorrect}/${profile.totalQuestions}` : '0'}</strong> <span>Aciertos</span></span>
            </div>
          </div>
        </div>

        <nav class="x-tabs x-tabs-2" aria-label="Secciones del perfil de ${escapeHtml(displayName)}">
          <button type="button" class="x-tab ${tab === 'actividad' ? 'active' : ''}" data-pub-tab="actividad">
            <span>Actividad</span>
          </button>
          <button type="button" class="x-tab ${tab === 'asignaturas' ? 'active' : ''}" data-pub-tab="asignaturas">
            <span>Asignaturas</span>
          </button>
        </nav>

        <div class="x-tab-panel">
          ${tabContentHtml}
        </div>
      </section>
    `;

    $('#page-content').querySelectorAll('[data-pub-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.pubTab;
        location.hash = next === 'asignaturas' ? `#usuario/${encodeURIComponent(userId)}/asignaturas` : `#usuario/${encodeURIComponent(userId)}`;
      });
    });
  } catch (err) {
    $('#page-content').innerHTML = `<section class="panel result-card"><h2>No se pudo cargar este perfil</h2><p>${escapeHtml(err.message || 'El estudiante no existe o no está disponible.')}</p><div class="result-buttons"><a class="primary-button" href="#comunidad">Volver a Comunidad</a></div></section>`;
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
  if (parts[0] === 'comunidad') return renderCommunity(parts[1] || 'estudiantes');
  if (parts[0] === 'usuario') return renderPublicProfile(parts[1], parts[2] || 'actividad');
  if (parts[0] === 'perfil') return renderProfile(parts[1] || 'actividad');
  if (parts[0] === 'admin') return renderAdmin(parts[1] || 'usuarios');
  return renderHome();
}

$('#nav-home').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#inicio'; });
$('#nav-subjects').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#asignaturas'; });
$('#nav-tests').addEventListener('click', (event) => { event.preventDefault(); location.hash = '#tests'; });
$('#nav-community')?.addEventListener('click', (event) => { event.preventDefault(); location.hash = '#comunidad'; });
$('#nav-profile')?.addEventListener('click', (event) => { event.preventDefault(); location.hash = '#perfil'; });
$('#nav-admin')?.addEventListener('click', (event) => { event.preventDefault(); location.hash = '#admin'; });
window.addEventListener('hashchange', renderRoute);
$('#today-label').textContent = formatDate();

let pendingAvatarDataUrl = '';
let pendingBannerColor = 'gold';

function renderAvatarContent(node, name, avatarUrl) {
  if (!node) return;
  if (avatarUrl) {
    node.innerHTML = `<img class="avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name || 'Perfil')}" />`;
  } else {
    const clean = (name || '').trim();
    node.textContent = !clean || clean === 'Mi espacio' ? 'E' : clean.charAt(0).toLocaleUpperCase('es');
  }
}

function updateProfileLabels() {
  const profile = dataService.readProfile();
  const name = profile.name?.trim() || 'Mi espacio';
  const avatar = profile.avatar || '';
  $('#sidebar-profile-name').textContent = name;
  const user = dataService.getUser();
  $('#sidebar-profile-status').textContent = dataService.isLoggedIn() ? (user?.email || 'Sesión iniciada') : 'Perfil local';
  document.querySelectorAll('.profile-initial').forEach((node) => {
    renderAvatarContent(node, name, avatar);
  });
  if ($('#nav-admin')) {
    $('#nav-admin').hidden = !dataService.isAdmin();
  }
}

function resizeImageToAvatarDataUrl(file, size = 160) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Selecciona un archivo de imagen válido.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const toggle = $('#theme-toggle');
  toggle.setAttribute('aria-label', light ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
  toggle.innerHTML = `<span class="theme-toggle-icon" aria-hidden="true">${light ? '☾' : '☀'}</span><span class="theme-toggle-label">Tema ${light ? 'oscuro' : 'claro'}</span>`;
  try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch { /* El tema sigue activo durante esta visita. */ }
}

function updateModalAvatarPreview() {
  const name = $('#profile-name-input')?.value?.trim() || dataService.readProfile().name || 'Mi espacio';
  renderAvatarContent($('#profile-modal-avatar'), name, pendingAvatarDataUrl);
  const removeBtn = $('#remove-avatar-btn');
  if (removeBtn) {
    removeBtn.hidden = !pendingAvatarDataUrl;
  }
  const bannerBox = $('#edit-profile-banner');
  if (bannerBox) {
    bannerBox.dataset.banner = pendingBannerColor || 'gold';
  }
  document.querySelectorAll('#edit-profile-banner [data-banner-color]').forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.bannerColor === pendingBannerColor);
  });
}

function openProfile() {
  location.hash = '#perfil';
}

function openEditProfileModal() {
  const modal = $('#profile-modal');
  const currentProfile = dataService.readProfile();
  $('#profile-name-input').value = currentProfile.name || '';
  if ($('#profile-bio-input')) {
    $('#profile-bio-input').value = currentProfile.bio || '';
  }
  pendingAvatarDataUrl = currentProfile.avatar || '';
  pendingBannerColor = currentProfile.banner || 'gold';
  updateModalAvatarPreview();
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
  document.querySelectorAll('#generate-quiz-modal [data-count]').forEach((pill) => {
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

document.querySelectorAll('#generate-quiz-modal [data-count]').forEach((pill) => {
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

$('#upload-avatar-btn')?.addEventListener('click', () => {
  $('#profile-avatar-input')?.click();
});

$('#upload-avatar-text-btn')?.addEventListener('click', () => {
  $('#profile-avatar-input')?.click();
});

$('#profile-modal-avatar')?.addEventListener('click', () => {
  $('#profile-avatar-input')?.click();
});

document.querySelectorAll('#edit-profile-banner [data-banner-color]').forEach((sw) => {
  sw.addEventListener('click', () => {
    pendingBannerColor = sw.dataset.bannerColor || 'gold';
    updateModalAvatarPreview();
  });
});

$('#profile-avatar-input')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    pendingAvatarDataUrl = await resizeImageToAvatarDataUrl(file, 160);
    updateModalAvatarPreview();
    showToast('Foto lista. Pulsa «Guardar» para aplicar los cambios.');
  } catch (err) {
    showToast(err.message || 'No se pudo procesar la imagen.', 4500);
  }
});

$('#remove-avatar-btn')?.addEventListener('click', () => {
  pendingAvatarDataUrl = '';
  updateModalAvatarPreview();
});

$('#profile-name-input')?.addEventListener('input', () => {
  if (!pendingAvatarDataUrl) {
    updateModalAvatarPreview();
  }
});

$('#save-profile').addEventListener('click', () => {
  const name = $('#profile-name-input').value;
  const bio = $('#profile-bio-input')?.value || '';
  try {
    dataService.saveProfile(name, pendingAvatarDataUrl, {
      bio,
      banner: pendingBannerColor
    });
  } catch {
    showToast('No se pudo guardar el perfil en este navegador.');
    return;
  }
  updateProfileLabels();
  closeProfile();
  renderRoute();
  showToast('Perfil actualizado.');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!$('#profile-modal').hidden) closeProfile();
    if (!$('#generate-quiz-modal').hidden) closeGenerateQuizModal();
    if (!$('#exam-modal').hidden) closeExamModal();
  }
});

/* ============================================================================
 * MODAL Y LÓGICA DE SIMULACRO DE EXAMEN PERSONALIZADO
 * ============================================================================ */

let examAvailableCount = 0;

function updateExamAvailableQuestions(subject) {
  const checkedBoxes = Array.from(document.querySelectorAll('#exam-topics-list input[type="checkbox"]:checked'));
  const selectedTopicIds = new Set(checkedBoxes.map((cb) => cb.value));
  const topics = (subject?.topics || []).filter((t) => selectedTopicIds.has(t.id));
  examAvailableCount = topics.reduce(
    (sum, t) => sum + t.sections.reduce((sSum, s) => sSum + (s.questionCount || s.questions?.length || 0), 0),
    0
  );
  $('#exam-available-note').textContent = `${examAvailableCount} ${examAvailableCount === 1 ? 'pregunta disponible' : 'preguntas disponibles'} en los ${topics.length} ${topics.length === 1 ? 'tema seleccionado' : 'temas seleccionados'}`;
  $('#submit-exam-modal').disabled = examAvailableCount === 0;
}

function syncExamPresetPills(val) {
  document.querySelectorAll('#exam-count-presets [data-exam-count]').forEach((pill) => {
    const pVal = pill.dataset.examCount;
    if (pVal === 'all') {
      pill.classList.toggle('active', examAvailableCount > 0 && Number(val) === examAvailableCount);
    } else {
      pill.classList.toggle('active', Number(pVal) === Number(val));
    }
  });
}

async function openExamModal(preferredSubjectId = '') {
  const modal = $('#exam-modal');
  const catalog = await dataService.getCatalog();
  const subjectSelect = $('#exam-subject-select');
  const topicsList = $('#exam-topics-list');

  subjectSelect.innerHTML = catalog
    .map((sub) => `<option value="${escapeHtml(sub.id)}">${escapeHtml(sub.name)}</option>`)
    .join('');

  const initialSub = catalog.find((s) => s.id === preferredSubjectId) || catalog[0];
  if (initialSub) {
    subjectSelect.value = initialSub.id;
  }

  function renderTopicCheckboxes(subId) {
    const sub = catalog.find((s) => s.id === subId) || catalog[0];
    const topics = sub?.topics || [];
    if (!topics.length) {
      topicsList.innerHTML = '<p class="exam-available-note">Esta asignatura no tiene temarios todavía.</p>';
      updateExamAvailableQuestions(sub);
      return;
    }
    topicsList.innerHTML = topics
      .map((top) => {
        const qCount = top.sections.reduce((sSum, s) => sSum + (s.questionCount || s.questions?.length || 0), 0);
        return `<label class="exam-topic-item">
          <input type="checkbox" value="${escapeHtml(top.id)}" checked />
          <span class="exam-topic-name">${escapeHtml(top.name)}</span>
          <span class="test-count">${qCount} preg.</span>
        </label>`;
      })
      .join('');

    topicsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => updateExamAvailableQuestions(sub));
    });

    updateExamAvailableQuestions(sub);
    const currentWanted = Number($('#exam-question-count').value) || 20;
    if (examAvailableCount > 0 && currentWanted > examAvailableCount) {
      $('#exam-question-count').value = examAvailableCount;
    }
    syncExamPresetPills($('#exam-question-count').value);
  }

  renderTopicCheckboxes(subjectSelect.value);

  subjectSelect.onchange = () => {
    renderTopicCheckboxes(subjectSelect.value);
  };

  $('#exam-select-all-topics').onclick = () => {
    const sub = catalog.find((s) => s.id === subjectSelect.value) || catalog[0];
    topicsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
    });
    updateExamAvailableQuestions(sub);
  };

  $('#exam-deselect-all-topics').onclick = () => {
    const sub = catalog.find((s) => s.id === subjectSelect.value) || catalog[0];
    topicsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    updateExamAvailableQuestions(sub);
  };

  modal.hidden = false;
}

function closeExamModal() {
  $('#exam-modal').hidden = true;
}

$('#close-exam-modal').addEventListener('click', closeExamModal);
$('#cancel-exam-modal').addEventListener('click', closeExamModal);
$('#exam-modal').addEventListener('click', (event) => {
  if (event.target.id === 'exam-modal') closeExamModal();
});

document.querySelectorAll('#exam-count-presets [data-exam-count]').forEach((pill) => {
  pill.addEventListener('click', () => {
    const raw = pill.dataset.examCount;
    const count = raw === 'all' ? Math.max(1, examAvailableCount) : Number(raw) || 20;
    $('#exam-question-count').value = count;
    syncExamPresetPills(count);
  });
});

$('#exam-question-count').addEventListener('input', (event) => {
  syncExamPresetPills(event.target.value);
});

$('#exam-penalty-select').addEventListener('change', (event) => {
  const isCustom = event.target.value === 'custom';
  $('#exam-custom-penalty-field').hidden = !isCustom;
  if (isCustom) {
    $('#exam-penalty-custom').focus();
  }
});

async function startExamSimulation({
  subjectId,
  topicIds = [],
  questionCount = 20,
  penaltyPerWrong = 0.3333333,
  timerMinutes = 20
}) {
  stopExamTimer();
  renderLoading('Preparando simulacro de examen y mezclando preguntas...');

  try {
    const subject = await dataService.getSubject(subjectId);
    if (!subject) {
      showToast('No se encontró la asignatura seleccionada.');
      return renderTests();
    }

    const selectedTopics = subject.topics.filter((t) => topicIds.includes(t.id));
    if (!selectedTopics.length) {
      showToast('Selecciona al menos un temario para el examen.');
      return renderSubject(subjectId);
    }

    const detailsList = await Promise.all(
      selectedTopics.map((t) => dataService.getTopicDetails(subjectId, t.id))
    );

    const byQuestionText = new Map();
    detailsList.forEach((details, idx) => {
      const top = selectedTopics[idx];
      for (const sec of details?.sections || []) {
        for (const q of sec.questions || []) {
          const key = String(q.question || '').trim().toLowerCase();
          if (!key) continue;
          byQuestionText.set(key, {
            ...q,
            origin: `${subject.name} · ${top.name} · ${sec.name}`
          });
        }
      }
    });

    const pool = Array.from(byQuestionText.values());
    if (!pool.length) {
      showToast('No hay preguntas disponibles en los temarios seleccionados.');
      return renderSubject(subjectId);
    }

    // Mezcla aleatoria Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const finalQuestions = pool
      .slice(0, Math.max(1, Math.min(pool.length, Number(questionCount) || 20)))
      .map(shuffleQuestionOptions);
    const mins = Math.max(0, Number(timerMinutes) || 0);
    const now = Date.now();

    activeQuiz = {
      mode: 'exam',
      subject,
      topic: {
        id: 'simulacro',
        name:
          selectedTopics.length === subject.topics.length
            ? 'Todos los temas'
            : `${selectedTopics.length} ${selectedTopics.length === 1 ? 'tema' : 'temas'}`
      },
      section: {
        id: 'simulacro',
        name: `Simulacro · ${subject.name}`,
        questions: finalQuestions
      },
      order: [...finalQuestions.keys()],
      index: 0,
      score: 0,
      wrongCount: 0,
      blankCount: 0,
      penaltyPerWrong: Math.max(0, Number(penaltyPerWrong) || 0),
      timerMinutes: mins,
      startedAt: now,
      endsAt: mins > 0 ? now + mins * 60 * 1000 : null,
      timedOut: false,
      examConfig: { subjectId, topicIds, questionCount, penaltyPerWrong, timerMinutes },
      selected: null,
      complete: false,
      missed: []
    };

    if (activeQuiz.endsAt) {
      examTimerInterval = setInterval(() => {
        if (!activeQuiz || activeQuiz.mode !== 'exam' || activeQuiz.complete) {
          stopExamTimer();
          return;
        }
        const rem = activeQuiz.endsAt - Date.now();
        if (rem <= 0) {
          stopExamTimer();
          const unanswered = Math.max(
            0,
            activeQuiz.order.length - (activeQuiz.score + (activeQuiz.wrongCount || 0) + (activeQuiz.blankCount || 0))
          );
          activeQuiz.blankCount = (activeQuiz.blankCount || 0) + unanswered;
          activeQuiz.timedOut = true;
          activeQuiz.complete = true;
          activeQuiz.finishedAt = Date.now();
          showToast('⏰ ¡Tiempo agotado! Se ha cerrado el examen automáticamente.', 5000);
          renderQuizResult();
          return;
        }
        const badge = $('#quiz-timer-badge');
        if (badge) {
          badge.innerHTML = `${ICONS.clock} ${formatTimerClock(rem)}`;
          if (rem < 60000) {
            badge.classList.remove('is-mid');
            badge.classList.add('is-low');
          }
        }
      }, 1000);
    }

    renderQuiz();
  } catch (err) {
    console.error('Error al iniciar el simulacro de examen:', err);
    showToast(err.message || 'No se pudo iniciar el simulacro de examen.', 5000);
  }
}

$('#exam-config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const subjectId = $('#exam-subject-select').value;
  const topicIds = Array.from(
    document.querySelectorAll('#exam-topics-list input[type="checkbox"]:checked')
  ).map((cb) => cb.value);

  if (!topicIds.length) {
    showToast('Marca al menos un temario para el examen.');
    return;
  }

  const questionCount = Math.max(1, Number($('#exam-question-count').value) || 20);
  const penSelect = $('#exam-penalty-select').value;
  const penaltyPerWrong =
    penSelect === 'custom'
      ? Math.max(0, Number($('#exam-penalty-custom').value) || 0)
      : Math.max(0, Number(penSelect) || 0);
  const timerMinutes = Math.max(0, Number($('#exam-timer-select').value) || 0);

  closeExamModal();
  await startExamSimulation({
    subjectId,
    topicIds,
    questionCount,
    penaltyPerWrong,
    timerMinutes
  });
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
