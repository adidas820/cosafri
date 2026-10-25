/**
 * data-service.js
 * Capa de abstracción de datos para Cuaderno + Generación de tests con Gemini API.
 *
 * Soporta dos modos:
 * 1. ESTÁTICO (por defecto en Netlify / GitHub):
 *    - Carga diferida (lazy loading) desde archivos JSON estáticos:
 *      * 'data/catalog.json' para el catálogo y metadatos iniciales (ultraligero).
 *      * 'temas/<asignatura>/<tema>.json' para los cuestionarios detallados bajo demanda.
 *    - Caché en memoria para evitar peticiones repetidas.
 *    - Fallback resiliente a 'study-data.js' si se abre directamente por protocolo file://.
 *
 * 2. SUPABASE (cuando actives tu base de datos):
 *    - Todas las llamadas se redirigirán a Supabase sin tocar la interfaz ni el enrutador.
 *    - Los nuevos tests generados con Gemini API se suben automáticamente a las tablas
 *      `sections` y `questions` de Supabase (vía Netlify Function con SUPABASE_SERVICE_ROLE_KEY
 *      en producción, o directamente vía REST en entorno local).
 */

import { catalog as fallbackCatalog } from './study-data.js';

// config.js es opcional (está en .gitignore y lo genera build.py en Netlify).
// Se importa dinámicamente para que, si no existe, la app siga funcionando en modo estático
// en lugar de romper toda la carga de módulos.
let CONFIG = {
  supabase: { url: '', anonKey: '', enabled: false },
  gemini: { apiKey: '', hasServerKey: false, model: 'gemini-3.8-flash' }
};
try {
  ({ CONFIG } = await import('./config.js'));
} catch {
  console.info('config.js no encontrado: usando modo estático (sin Supabase).');
}

export const SUPABASE_CONFIG = {
  url: CONFIG?.supabase?.url || '',
  anonKey: CONFIG?.supabase?.anonKey || '',
  enabled: Boolean(CONFIG?.supabase?.enabled || (CONFIG?.supabase?.url && CONFIG?.supabase?.anonKey))
};

export const GEMINI_CONFIG = {
  apiKey: CONFIG?.gemini?.apiKey || '',
  hasServerKey: Boolean(CONFIG?.gemini?.hasServerKey),
  model: CONFIG?.gemini?.model || 'gemini-3.8-flash'
};

const SCORE_KEY = 'cuaderno.quiz-scores.v1';
const PROFILE_KEY = 'cuaderno.profile.v1';
const GEMINI_KEY_STORAGE = 'cuaderno.gemini-key.v1';
const GENERATED_SECTIONS_KEY = 'cuaderno.generated-sections.v1';

// Caché en memoria para carga diferida
let catalogCache = null;
const topicDetailsCache = new Map();

/**
 * Convierte un ArrayBuffer a Base64 en bloques para evitar desbordamiento de pila en PDFs grandes.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Extrae el texto generado de la respuesta de la Interactions API de Gemini.
 */
function extractInteractionText(responseJson) {
  if (typeof responseJson?.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  if (Array.isArray(responseJson?.steps)) {
    const textParts = [];
    for (const step of responseJson.steps) {
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        for (const part of step.content) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            textParts.push(part.text);
          }
        }
      }
    }
    if (textParts.length > 0) {
      return textParts.join('').trim();
    }
  }
  throw new Error('La respuesta de Gemini no devolvió contenido de texto válido.');
}

/**
 * Lee los tests generados guardados localmente como respaldo.
 */
function readLocalGeneratedSections() {
  try {
    return JSON.parse(localStorage.getItem(GENERATED_SECTIONS_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * Guarda un test generado en localStorage como respaldo y sincronización inmediata.
 */
function saveLocalGeneratedSection(subjectId, topicId, section) {
  try {
    const store = readLocalGeneratedSections();
    const key = `${subjectId}/${topicId}`;
    const list = Array.isArray(store[key]) ? store[key] : [];
    const existingIdx = list.findIndex((s) => s.id === section.id);
    if (existingIdx >= 0) {
      list[existingIdx] = section;
    } else {
      list.push(section);
    }
    store[key] = list;
    localStorage.setItem(GENERATED_SECTIONS_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('No se pudo guardar respaldo local del test generado:', err);
  }
}

/**
 * Fusiona las secciones generadas localmente en un catálogo para que no desaparezcan en modo estático.
 */
function mergeLocalSectionsIntoCatalog(catalog) {
  const store = readLocalGeneratedSections();
  for (const subject of catalog) {
    for (const topic of subject.topics || []) {
      const localList = store[`${subject.id}/${topic.id}`] || [];
      for (const localSec of localList) {
        if (!topic.sections.some((s) => s.id === localSec.id)) {
          topic.sections.push({
            id: localSec.id,
            name: localSec.name,
            description: localSec.description,
            questionCount: localSec.questions?.length || localSec.questionCount || 0
          });
        }
      }
    }
  }
  return catalog;
}

/**
 * Fusiona las secciones generadas localmente en el detalle de un tema.
 */
function mergeLocalSectionsIntoTopicDetails(subjectId, topicId, topicData) {
  const store = readLocalGeneratedSections();
  const localList = store[`${subjectId}/${topicId}`] || [];
  if (!Array.isArray(topicData.sections)) {
    topicData.sections = [];
  }
  for (const localSec of localList) {
    if (!topicData.sections.some((s) => s.id === localSec.id)) {
      topicData.sections.push(localSec);
    }
  }
  return topicData;
}

/**
 * Actualiza las cachés en memoria y el respaldo local con una nueva sección generada.
 */
function registerNewSectionInCaches(subjectId, topicId, newSection) {
  saveLocalGeneratedSection(subjectId, topicId, newSection);

  if (catalogCache) {
    const cachedSub = catalogCache.find((s) => s.id === subjectId);
    const cachedTop = cachedSub?.topics.find((t) => t.id === topicId);
    if (cachedTop && !cachedTop.sections.some((s) => s.id === newSection.id)) {
      cachedTop.sections.push({
        id: newSection.id,
        name: newSection.name,
        description: newSection.description,
        questionCount: newSection.questionCount
      });
    }
  }

  const cacheKey = `${subjectId}/${topicId}`;
  if (topicDetailsCache.has(cacheKey)) {
    const cachedDetails = topicDetailsCache.get(cacheKey);
    if (cachedDetails && Array.isArray(cachedDetails.sections) && !cachedDetails.sections.some((s) => s.id === newSection.id)) {
      cachedDetails.sections.push(newSection);
    }
  }
}

/**
 * Cliente básico de Supabase mediante REST API (no requiere instalar paquetes npm)
 */
async function supabaseFetch(table, params = '', options = {}) {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    throw new Error('Supabase no está configurado. Revisa SUPABASE_CONFIG en config.js o data-service.js');
  }
  const endpoint = `${SUPABASE_CONFIG.url.replace(/\/$/, '')}/rest/v1/${table}${params ? `?${params}` : ''}`;
  const headers = {
    'apikey': SUPABASE_CONFIG.anonKey,
    'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(endpoint, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Error en Supabase (${table} - ${response.status}): ${errorBody || response.statusText}`);
  }
  if (response.status === 204 || options.headers?.Prefer?.includes('return=minimal')) {
    return null;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export const dataService = {
  /**
   * Obtiene el catálogo de asignaturas y temas (metadatos ligeros).
   */
  async getCatalog(forceRefresh = false) {
    if (catalogCache && !forceRefresh) return catalogCache;

    if (SUPABASE_CONFIG.enabled) {
      try {
        const subjects = await supabaseFetch(
          'subjects',
          'select=id,name,folder,description,color,topics(id,name,file_url,pages,display_order,sections(id,name,description,display_order,questions(count)))&order=created_at.asc'
        );
        if (Array.isArray(subjects) && subjects.length > 0) {
          catalogCache = mergeLocalSectionsIntoCatalog(
            subjects.map((sub) => ({
              id: sub.id,
              name: sub.name,
              folder: sub.folder,
              description: sub.description,
              color: sub.color || 'violet',
              topics: (sub.topics || [])
                .sort((a, b) => a.display_order - b.display_order)
                .map((top) => ({
                  id: top.id,
                  name: top.name,
                  file: top.file_url,
                  pages: top.pages,
                  sections: (top.sections || [])
                    .sort((a, b) => a.display_order - b.display_order)
                    .map((sec) => ({
                      id: sec.id,
                      name: sec.name,
                      description: sec.description,
                      questionCount: sec.questions?.[0]?.count || 0
                    }))
                }))
            }))
          );
          return catalogCache;
        }
      } catch (err) {
        console.warn('Fallo al consultar Supabase, usando catálogo estático:', err);
      }
    }

    // Modo Estático Netlify: Carga diferida de data/catalog.json
    try {
      const response = await fetch('./data/catalog.json');
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const rawCatalog = await response.json();
      catalogCache = mergeLocalSectionsIntoCatalog(rawCatalog);
      return catalogCache;
    } catch (err) {
      console.warn('No se pudo cargar data/catalog.json por fetch (posible protocolo file://). Usando fallback local:', err);
      catalogCache = mergeLocalSectionsIntoCatalog(
        fallbackCatalog.map((sub) => ({
          ...sub,
          topics: sub.topics.map((top) => ({
            ...top,
            sections: top.sections.map((sec) => ({
              id: sec.id,
              name: sec.name,
              description: sec.description,
              questionCount: sec.questions?.length || 0
            }))
          }))
        }))
      );
      return catalogCache;
    }
  },

  /**
   * Obtiene una asignatura específica por su ID.
   */
  async getSubject(subjectId) {
    const catalog = await this.getCatalog();
    return catalog.find((s) => s.id === subjectId) || null;
  },

  /**
   * Obtiene el resumen de un tema.
   */
  async getTopic(subjectId, topicId) {
    const subject = await this.getSubject(subjectId);
    if (!subject) return { subject: null, topic: null };
    const topic = subject.topics.find((t) => t.id === topicId) || null;
    return { subject, topic };
  },

  /**
   * Carga diferida (Lazy Load): Obtiene los datos detallados de un tema con sus preguntas.
   */
  async getTopicDetails(subjectId, topicId, forceRefresh = false) {
    const cacheKey = `${subjectId}/${topicId}`;
    if (topicDetailsCache.has(cacheKey) && !forceRefresh) {
      return topicDetailsCache.get(cacheKey);
    }

    if (SUPABASE_CONFIG.enabled) {
      try {
        const sectionsData = await supabaseFetch(
          'sections',
          `subject_id=eq.${encodeURIComponent(subjectId)}&topic_id=eq.${encodeURIComponent(topicId)}&select=id,name,description,display_order,questions(question,options,answer,explanation,display_order)&order=display_order.asc`
        );
        if (Array.isArray(sectionsData) && sectionsData.length > 0) {
          const topicData = mergeLocalSectionsIntoTopicDetails(subjectId, topicId, {
            id: topicId,
            subjectId,
            sections: sectionsData.map((sec) => ({
              id: sec.id,
              name: sec.name,
              description: sec.description,
              questions: (sec.questions || []).sort((a, b) => a.display_order - b.display_order)
            }))
          });
          topicDetailsCache.set(cacheKey, topicData);
          return topicData;
        }
      } catch (err) {
        console.warn('Fallo al obtener tema desde Supabase, intentando archivo local:', err);
      }
    }

    // Modo Estático Netlify: Carga bajo demanda del archivo JSON específico del tema
    const { subject, topic } = await this.getTopic(subjectId, topicId);
    const dataPath = topic?.dataPath || `${subject?.folder || 'temas/' + subjectId}/${topicId}.json`;

    try {
      const response = await fetch(dataPath.startsWith('./') ? dataPath : `./${dataPath}`);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const data = mergeLocalSectionsIntoTopicDetails(subjectId, topicId, await response.json());
      topicDetailsCache.set(cacheKey, data);
      return data;
    } catch (err) {
      console.warn(`No se pudo cargar ${dataPath} por fetch, buscando en fallback:`, err);
      const fbSubject = fallbackCatalog.find((s) => s.id === subjectId);
      const fbTopic = fbSubject?.topics.find((t) => t.id === topicId);
      if (fbTopic) {
        const fallbackData = mergeLocalSectionsIntoTopicDetails(subjectId, topicId, {
          id: fbTopic.id,
          subjectId,
          name: fbTopic.name,
          sections: fbTopic.sections.map((sec) => ({ ...sec }))
        });
        topicDetailsCache.set(cacheKey, fallbackData);
        return fallbackData;
      }
      throw err;
    }
  },

  /**
   * Carga diferida de una sección y su batería de preguntas para un test.
   */
  async getSection(subjectId, topicId, sectionId) {
    const subject = await this.getSubject(subjectId);
    const topic = subject?.topics.find((t) => t.id === topicId);
    if (!subject || !topic) return null;

    const topicDetails = await this.getTopicDetails(subjectId, topicId);
    const section = topicDetails?.sections.find((s) => s.id === sectionId);
    if (!section) return null;

    return { subject, topic, section };
  },

  /**
   * Gestión de API Key de Gemini
   */
  getGeminiApiKey() {
    if (GEMINI_CONFIG.apiKey && GEMINI_CONFIG.apiKey.trim()) {
      return GEMINI_CONFIG.apiKey.trim();
    }
    try {
      return (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
    } catch {
      return '';
    }
  },

  hasBuildGeminiKey() {
    return Boolean(
      GEMINI_CONFIG.hasServerKey || (GEMINI_CONFIG.apiKey && GEMINI_CONFIG.apiKey.trim())
    );
  },

  saveGeminiApiKey(apiKey) {
    try {
      const clean = (apiKey || '').trim();
      if (clean) {
        localStorage.setItem(GEMINI_KEY_STORAGE, clean);
      } else {
        localStorage.removeItem(GEMINI_KEY_STORAGE);
      }
    } catch (err) {
      console.warn('No se pudo guardar la clave de Gemini en localStorage:', err);
    }
  },

  /**
   * Sube una nueva sección de test y sus preguntas directamente a Supabase desde el cliente.
   */
  async uploadSectionToSupabase(subject, topic, section, displayOrder = 99) {
    if (!SUPABASE_CONFIG.enabled || !SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
      return { uploaded: false, reason: 'Supabase no está activado en config.js.' };
    }

    const upsertHeaders = { Prefer: 'resolution=merge-duplicates,return=minimal' };

    // 1. Insertar la sección en `sections`
    await supabaseFetch('sections', 'on_conflict=subject_id,topic_id,id', {
      method: 'POST',
      headers: upsertHeaders,
      body: {
        id: section.id,
        subject_id: subject.id,
        topic_id: topic.id,
        name: section.name,
        description: section.description,
        display_order: displayOrder
      }
    });

    // 2. Insertar todas las preguntas en `questions`
    const questionRows = section.questions.map((q, index) => ({
      subject_id: subject.id,
      topic_id: topic.id,
      section_id: section.id,
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation || '',
      display_order: index + 1
    }));

    await supabaseFetch('questions', '', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: questionRows
    });

    return { uploaded: true };
  },

  /**
   * Genera un nuevo test sobre el tema seleccionado usando Gemini API (`gemini-3.8-flash`)
   * y lo sube a la base de datos en Supabase.
   */
  async generateQuizWithGemini({
    subjectId,
    topicId,
    questionCount = 10,
    customTitle = '',
    customFocus = '',
    apiKey = '',
    onProgress = () => {}
  }) {
    const count = Math.max(1, Math.min(30, Number(questionCount) || 10));
    if (apiKey && apiKey.trim()) {
      this.saveGeminiApiKey(apiKey.trim());
    }
    const effectiveKey = (apiKey || this.getGeminiApiKey()).trim();

    onProgress('Leyendo el temario y preparando los apuntes...');
    const { subject, topic } = await this.getTopic(subjectId, topicId);
    if (!subject || !topic) {
      throw new Error('No se encontró la asignatura o el temario seleccionado.');
    }

    // Intentar cargar el PDF del tema para enviarlo como documento multimodal a Gemini
    let pdfBase64 = null;
    if (topic.file) {
      try {
        const pdfUrl = topic.file.startsWith('./') || topic.file.startsWith('http') ? topic.file : `./${topic.file}`;
        const pdfResp = await fetch(pdfUrl);
        if (pdfResp.ok) {
          const buffer = await pdfResp.arrayBuffer();
          pdfBase64 = arrayBufferToBase64(buffer);
        }
      } catch (err) {
        console.warn('No se pudo adjuntar el PDF binario (usando contexto textual del tema):', err);
      }
    }

    // Obtener también las secciones existentes para evitar duplicar preguntas y dar contexto adicional
    let existingContext = '';
    let existingSectionCount = topic.sections?.length || 0;
    try {
      const details = await this.getTopicDetails(subjectId, topicId);
      existingSectionCount = details?.sections?.length || existingSectionCount;
      const sampleQuestions = (details?.sections || [])
        .flatMap((s) => s.questions || [])
        .slice(0, 25)
        .map((q) => `- ${q.question} (Resp: ${q.options?.[q.answer] || ''})`)
        .join('\n');
      if (sampleQuestions) {
        existingContext = `\n\nPreguntas ya existentes en este tema (crea preguntas nuevas o con distinto enfoque sin copiar literalmente estas):\n${sampleQuestions}`;
      }
    } catch {
      // Continuar si no hay detalles previos
    }

    onProgress(`Generando ${count} ${count === 1 ? 'pregunta' : 'preguntas'} con Gemini AI y subiendo a Supabase...`);

    // 1. Intentar primero mediante la Netlify Function (/.netlify/functions/generate-quiz),
    // que utiliza GEMINI_API_KEY y SUPABASE_SERVICE_ROLE_KEY en el servidor de forma 100% segura.
    try {
      const fnResp = await fetch('/.netlify/functions/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: { id: subject.id, name: subject.name, description: subject.description },
          topic: { id: topic.id, name: topic.name },
          questionCount: count,
          customTitle,
          customFocus,
          existingContext,
          existingSectionCount,
          pdfBase64,
          clientApiKey: effectiveKey
        })
      });

      const contentType = fnResp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const fnData = await fnResp.json();
        if (fnResp.ok && fnData?.section) {
          registerNewSectionInCaches(subjectId, topicId, fnData.section);
          return {
            subject,
            topic,
            section: fnData.section,
            uploadedToSupabase: Boolean(fnData.uploadedToSupabase),
            supabaseWarning: fnData.supabaseWarning || null
          };
        }
        if (fnData?.error && fnResp.status !== 404 && fnResp.status !== 405 && fnResp.status !== 501) {
          throw new Error(fnData.error);
        }
      }
    } catch (fnErr) {
      // Si el error viene directamente de Gemini o de validación en la Netlify Function, propagarlo
      if (fnErr.message && !fnErr.message.includes('Failed to fetch') && !fnErr.message.includes('NetworkError')) {
        throw fnErr;
      }
      console.info('Netlify Function no disponible en servidor local, usando llamada directa:', fnErr);
    }

    // 2. Fallback directo desde el navegador (para desarrollo local con python -m http.server)
    if (!effectiveKey) {
      throw new Error('Introduce una clave de API de Gemini (GEMINI_API_KEY) para poder generar el test.');
    }

    const promptText = [
      `Eres un profesor universitario experto en la asignatura "${subject.name}" (${subject.description || ''}).`,
      `Genera un nuevo test de autoevaluación en español sobre el tema "${topic.name}".`,
      customFocus.trim()
        ? `Enfoque específico solicitado por el estudiante: "${customFocus.trim()}".`
        : 'Abarca los conceptos clave, datos, relaciones y definiciones más importantes del tema.',
      customTitle.trim()
        ? `Utiliza como título del test: "${customTitle.trim()}".`
        : 'Crea un título breve y descriptivo para el test (por ejemplo: "Repaso IA · [Concepto clave]").',
      `Requisitos estrictos:`,
      `1. Genera EXACTAMENTE ${count} preguntas de selección múltiple.`,
      `2. Cada pregunta debe incluir un array "options" con exactamente 4 opciones plausibles y bien redactadas.`,
      `3. El campo "answer" debe ser el índice entero (0, 1, 2 o 3) de la opción correcta. Distribuye la posición de la respuesta correcta de forma variada entre 0, 1, 2 y 3.`,
      `4. El campo "explanation" debe explicar con claridad por qué la respuesta es correcta según los apuntes del tema.`,
      existingContext
    ].join('\n');

    const inputParts = [];
    if (pdfBase64) {
      inputParts.push({
        type: 'document',
        data: pdfBase64,
        mime_type: 'application/pdf'
      });
    }
    inputParts.push({
      type: 'text',
      text: promptText
    });

    const quizSchema = {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Título breve del cuestionario generado.'
        },
        description: {
          type: 'string',
          description: 'Descripción concisa de los contenidos que evalúa este test.'
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'Enunciado claro de la pregunta.'
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exactamente 4 opciones de respuesta.'
              },
              answer: {
                type: 'integer',
                description: 'Índice de la opción correcta (0, 1, 2 o 3).'
              },
              explanation: {
                type: 'string',
                description: 'Explicación didáctica basada en los apuntes.'
              }
            },
            required: ['question', 'options', 'answer', 'explanation']
          }
        }
      },
      required: ['name', 'description', 'questions']
    };

    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': effectiveKey
      },
      body: JSON.stringify({
        model: GEMINI_CONFIG.model || 'gemini-3.8-flash',
        input: inputParts,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: quizSchema
        }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text().catch(() => '');
      let errMsg = `Error en Gemini API (${geminiResponse.status})`;
      try {
        const parsedErr = JSON.parse(errText);
        if (parsedErr?.error?.message) errMsg = parsedErr.error.message;
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 180)}`;
      }
      throw new Error(errMsg);
    }

    const interactionData = await geminiResponse.json();
    const rawJsonText = extractInteractionText(interactionData);
    const generated = JSON.parse(rawJsonText);

    if (!Array.isArray(generated?.questions) || generated.questions.length === 0) {
      throw new Error('Gemini no devolvió preguntas válidas. Inténtalo de nuevo.');
    }

    const normalizedQuestions = generated.questions.slice(0, count).map((q) => {
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : [];
      while (options.length < 4) {
        options.push(`Opción ${options.length + 1}`);
      }
      const rawAns = Number(q.answer);
      const answer = Number.isInteger(rawAns) && rawAns >= 0 && rawAns <= 3 ? rawAns : 0;
      return {
        question: String(q.question || '').trim(),
        options,
        answer,
        explanation: String(q.explanation || '').trim()
      };
    });

    const sectionId = `ia-${Date.now().toString(36)}`;
    const newSection = {
      id: sectionId,
      name: (customTitle.trim() || generated.name || `Test IA · ${topic.name}`).trim(),
      description: (generated.description || `Cuestionario de ${normalizedQuestions.length} preguntas generado con Gemini IA.`).trim(),
      questionCount: normalizedQuestions.length,
      questions: normalizedQuestions
    };

    registerNewSectionInCaches(subjectId, topicId, newSection);

    // Subir a Supabase
    onProgress('Subiendo el nuevo test a la base de datos en Supabase...');
    let uploadedToSupabase = false;
    let supabaseWarning = null;

    if (SUPABASE_CONFIG.enabled) {
      try {
        const res = await this.uploadSectionToSupabase(subject, topic, newSection, existingSectionCount + 1);
        uploadedToSupabase = res.uploaded;
      } catch (err) {
        console.warn('Error al subir el test generado a Supabase:', err);
        supabaseWarning = err.message;
      }
    } else {
      supabaseWarning = 'Modo estático activo (configura SUPABASE_URL y SUPABASE_ANON_KEY para sincronizar en la nube).';
    }

    return {
      subject,
      topic,
      section: newSection,
      uploadedToSupabase,
      supabaseWarning
    };
  },

  /**
   * Métricas y Puntuaciones
   */
  readScores() {
    try {
      return JSON.parse(localStorage.getItem(SCORE_KEY)) || [];
    } catch {
      return [];
    }
  },

  async saveScore(score) {
    try {
      const scores = this.readScores();
      scores.unshift(score);
      localStorage.setItem(SCORE_KEY, JSON.stringify(scores.slice(0, 40)));
    } catch (err) {
      console.error('Error guardando en localStorage:', err);
    }

    // Si Supabase está activado, sincroniza la puntuación remotamente
    if (SUPABASE_CONFIG.enabled && SUPABASE_CONFIG.url) {
      try {
        await fetch(`${SUPABASE_CONFIG.url.replace(/\/$/, '')}/rest/v1/quiz_scores`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            subject: score.subject,
            section: score.section,
            score: score.score,
            total: score.total,
            percentage: score.percentage
          })
        });
      } catch (err) {
        console.warn('No se pudo guardar la puntuación en Supabase:', err);
      }
    }
  },

  /**
   * Perfil de estudiante
   */
  readProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || { name: '' };
    } catch {
      return { name: '' };
    }
  },

  saveProfile(name) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: name.trim() }));
  }
};
