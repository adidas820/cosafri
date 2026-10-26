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

/* ============================================================================
 * SESIÓN DE USUARIO (Supabase Auth vía REST, sin dependencias)
 * ============================================================================ */
const AUTH_KEY = 'cuaderno.auth.v1';
let session = loadSession();
let refreshPromise = null;
let remoteScores = null;   // notas del usuario cargadas desde Supabase
let remoteProfile = null;  // perfil del usuario cargado desde Supabase
let mistakesCache = null;  // fallos del usuario cargados desde Supabase

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || null;
  } catch {
    return null;
  }
}

function storeSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(AUTH_KEY, JSON.stringify(next));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    // La sesión sigue activa en memoria durante esta visita
  }
}

function sessionFromTokens(data, fallbackUser = null) {
  const expiresAt = data.expires_at
    ? Number(data.expires_at)
    : Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email,
          role: data.user.app_metadata?.role || data.user.user_metadata?.role || fallbackUser?.role || null,
          avatar: data.user.user_metadata?.avatar_url || fallbackUser?.avatar || ''
        }
      : fallbackUser
  };
}

async function authFetch(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${SUPABASE_CONFIG.url.replace(/\/$/, '')}/auth/v1/${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.msg || data?.error_description || data?.message || `Error de autenticación (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * Sube un avatar en Base64 al bucket público de Supabase Storage vía Netlify Function
 * para obtener una URL corta (~90 bytes) y no inflar jamás el JWT de Supabase Auth.
 */
async function uploadAvatarToStorage(token, name, avatarDataUrl) {
  const sendInHeader = token && token.length < 3500;
  const resp = await fetch('/.netlify/functions/admin?action=upload-avatar', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(sendInHeader ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      name,
      avatarDataUrl,
      ...(sendInHeader ? {} : { userToken: token })
    })
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(data?.error || `Error al subir avatar (${resp.status})`);
  }
  return data?.avatarUrl || '';
}

/**
 * Devuelve un access token válido (renovándolo si está a punto de caducar o si se fuerza)
 * y repara automáticamente cualquier JWT que se haya inflado por tener un avatar Base64 en user_metadata.
 */
async function getValidAccessToken(forceRefresh = false) {
  if (!session?.access_token) return null;

  const isTokenBloated = session.access_token.length > 3500;
  const now = Math.floor(Date.now() / 1000);
  if (!forceRefresh && !isTokenBloated && session.expires_at && session.expires_at - 60 > now) {
    return session.access_token;
  }

  if (!session.refresh_token) {
    storeSession(null);
    return null;
  }

  // Una sola renovación a la vez: Supabase rota el refresh token en cada uso
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        let pendingBase64Avatar = '';
        if (isTokenBloated) {
          if (session?.user?.avatar?.startsWith('data:image/')) {
            pendingBase64Avatar = session.user.avatar;
          }
          // Limpiar primero el Base64 de user_metadata para que el nuevo JWT sea ligero (~1 KB)
          await authFetch('user', {
            method: 'PUT',
            token: session.access_token,
            body: { data: { avatar_url: '' } }
          }).catch(() => {});
        }

        const data = await authFetch('token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: session.refresh_token }
        });
        storeSession(sessionFromTokens(data, session?.user || null));

        if (pendingBase64Avatar && session?.access_token) {
          uploadAvatarToStorage(session.access_token, undefined, pendingBase64Avatar)
            .then((shortUrl) => {
              if (shortUrl && session?.user) {
                storeSession({ ...session, user: { ...session.user, avatar: shortUrl } });
                if (remoteProfile) remoteProfile.avatar = shortUrl;
              }
            })
            .catch(() => {});
        }

        return session.access_token;
      } catch (err) {
        console.warn('No se pudo renovar la sesión:', err);
        // Solo cerramos la sesión si Supabase la rechaza (no por fallos de red)
        if ([400, 401, 403].includes(err.status)) storeSession(null);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

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
 * Actualiza las cachés en memoria con una nueva sección generada.
 * Si se subió a Supabase, se invalida el detalle del tema para recargarlo desde la BD
 * (así las preguntas llegan con su `id` y se pueden guardar como fallos).
 * Si no, se guarda una copia local como respaldo.
 */
function registerNewSectionInCaches(subjectId, topicId, newSection, uploadedToSupabase = false) {
  if (!uploadedToSupabase) {
    saveLocalGeneratedSection(subjectId, topicId, newSection);
  }

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
  if (uploadedToSupabase) {
    topicDetailsCache.delete(cacheKey);
  } else if (topicDetailsCache.has(cacheKey)) {
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
  const token = await getValidAccessToken();
  const headers = {
    'apikey': SUPABASE_CONFIG.anonKey,
    'Authorization': `Bearer ${token || SUPABASE_CONFIG.anonKey}`,
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
          `subject_id=eq.${encodeURIComponent(subjectId)}&topic_id=eq.${encodeURIComponent(topicId)}&select=id,name,description,display_order,questions(id,question,options,answer,explanation,display_order)&order=display_order.asc`
        );
        if (Array.isArray(sectionsData) && sectionsData.length > 0) {
          const topicData = mergeLocalSectionsIntoTopicDetails(subjectId, topicId, {
            id: topicId,
            subjectId,
            sections: sectionsData.map((sec) => {
              const sorted = (sec.questions || []).sort((a, b) => a.display_order - b.display_order);
              const byQuestionText = new Map();
              for (const q of sorted) {
                const key = String(q.question || '').trim().toLowerCase();
                byQuestionText.set(key || q.id, q);
              }
              return {
                id: sec.id,
                name: sec.name,
                description: sec.description,
                questions: Array.from(byQuestionText.values())
              };
            })
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
   * Sube automáticamente a Supabase cualquier test generado con IA que hubiera quedado guardado
   * solo en localStorage (por ejemplo, antes de activar los permisos de inserción en la BD).
   */
  async syncLocalGeneratedSectionsToSupabase() {
    if (!SUPABASE_CONFIG.enabled || !SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
      return 0;
    }
    const store = readLocalGeneratedSections();
    const entries = Object.entries(store);
    if (entries.length === 0) return 0;

    let uploadedCount = 0;
    const remainingStore = {};

    for (const [key, sectionsList] of entries) {
      if (!Array.isArray(sectionsList) || sectionsList.length === 0) continue;
      const [subjectId, topicId] = key.split('/');
      if (!subjectId || !topicId) continue;

      let remoteSections = [];
      try {
        remoteSections =
          (await supabaseFetch(
            'sections',
            `subject_id=eq.${encodeURIComponent(subjectId)}&topic_id=eq.${encodeURIComponent(topicId)}&select=id,questions(count)`
          )) || [];
      } catch (err) {
        console.warn('No se pudo comprobar secciones remotas para migrar tests locales:', err);
        remainingStore[key] = sectionsList;
        continue;
      }

      const remoteMap = new Map(
        remoteSections.map((s) => [s.id, s.questions?.[0]?.count || 0])
      );

      const pendingForTopic = [];
      for (const localSec of sectionsList) {
        if (!localSec?.id || !Array.isArray(localSec.questions) || localSec.questions.length === 0) {
          continue;
        }
        const remoteQCount = remoteMap.get(localSec.id) || 0;
        if (remoteQCount > 0) {
          // Ya existe en Supabase con sus preguntas; lo retiramos de localStorage
          continue;
        }
        try {
          await this.uploadSectionToSupabase(
            { id: subjectId },
            { id: topicId },
            localSec,
            remoteSections.length + uploadedCount + 10
          );
          uploadedCount += 1;
          topicDetailsCache.delete(key);
        } catch (err) {
          console.warn(`No se pudo migrar el test local "${localSec.name}" a Supabase:`, err);
          pendingForTopic.push(localSec);
        }
      }

      if (pendingForTopic.length > 0) {
        remainingStore[key] = pendingForTopic;
      }
    }

    try {
      if (Object.keys(remainingStore).length === 0) {
        localStorage.removeItem(GENERATED_SECTIONS_KEY);
      } else {
        localStorage.setItem(GENERATED_SECTIONS_KEY, JSON.stringify(remainingStore));
      }
    } catch {
      // ignore storage errors
    }

    if (uploadedCount > 0) {
      catalogCache = null;
    }
    return uploadedCount;
  },

  /**
   * Elimina un cuestionario generado con IA (`ia-...`) de Supabase y de la caché local.
   * Restringido exclusivamente al administrador.
   */
  async deleteSection(subjectId, topicId, sectionId) {
    if (!this.isAdmin()) {
      throw new Error('Solo el administrador puede eliminar tests.');
    }
    if (!subjectId || !topicId || !sectionId || !String(sectionId).startsWith('ia-')) {
      throw new Error('Solo se pueden eliminar los tests generados con IA.');
    }

    // 1. Eliminar del almacenamiento local de respaldo si existiera
    try {
      const store = readLocalGeneratedSections();
      const key = `${subjectId}/${topicId}`;
      if (Array.isArray(store[key])) {
        store[key] = store[key].filter((s) => s.id !== sectionId);
        if (store[key].length === 0) {
          delete store[key];
        }
        if (Object.keys(store).length === 0) {
          localStorage.removeItem(GENERATED_SECTIONS_KEY);
        } else {
          localStorage.setItem(GENERATED_SECTIONS_KEY, JSON.stringify(store));
        }
      }
    } catch {
      // ignore storage errors
    }

    // 2. Eliminar de Supabase vía Netlify Function autenticada con el JWT del administrador
    const token = await getValidAccessToken();
    const fnResp = await fetch('/.netlify/functions/generate-quiz', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ subjectId, topicId, sectionId })
    });
    if (!fnResp.ok) {
      const errData = await fnResp.json().catch(() => ({}));
      throw new Error(errData?.error || `No se pudo eliminar el test (${fnResp.status}).`);
    }

    // 3. Limpiar cachés en memoria
    const cacheKey = `${subjectId}/${topicId}`;
    if (catalogCache) {
      const sub = catalogCache.find((s) => s.id === subjectId);
      const top = sub?.topics?.find((t) => t.id === topicId);
      if (top && Array.isArray(top.sections)) {
        top.sections = top.sections.filter((sec) => sec.id !== sectionId);
      }
    }
    if (topicDetailsCache.has(cacheKey)) {
      const details = topicDetailsCache.get(cacheKey);
      if (details && Array.isArray(details.sections)) {
        details.sections = details.sections.filter((sec) => sec.id !== sectionId);
      }
    }
    if (mistakesCache) {
      mistakesCache = mistakesCache.filter(
        (m) => !(m.subjectId === subjectId && m.topicId === topicId && m.sectionId === sectionId)
      );
    }
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
          registerNewSectionInCaches(subjectId, topicId, fnData.section, Boolean(fnData.uploadedToSupabase));
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

    registerNewSectionInCaches(subjectId, topicId, newSection, uploadedToSupabase);

    return {
      subject,
      topic,
      section: newSection,
      uploadedToSupabase,
      supabaseWarning
    };
  },

  /**
   * Autenticación y sesión multi-dispositivo (Supabase Auth)
   */
  isAuthAvailable() {
    return Boolean(SUPABASE_CONFIG.enabled && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
  },

  isLoggedIn() {
    return Boolean(session?.access_token && session?.user?.id);
  },

  isAdmin() {
    if (!this.isLoggedIn()) return false;
    if (remoteProfile?.is_admin === true) return true;
    if (session?.user?.role === 'admin') return true;
    const configuredAdmin = String(CONFIG?.adminEmail || '').trim().toLowerCase();
    const userEmail = String(session?.user?.email || '').trim().toLowerCase();
    return Boolean(configuredAdmin && userEmail && configuredAdmin === userEmail);
  },

  getUser() {
    return session?.user || null;
  },

  /**
   * Llamada genérica autenticada al endpoint de administración (/.netlify/functions/admin).
   */
  async adminRequest(action, method = 'GET', body = null) {
    if (!this.isAdmin()) {
      throw new Error('Acceso restringido al administrador.');
    }

    const executeCall = async (token) => {
      if (!token) {
        throw new Error('Tu sesión ha caducado en este dispositivo. Abre tu perfil y vuelve a iniciar sesión.');
      }
      const tokenFitsHeader = token.length < 3500;
      const effectiveMethod = !tokenFitsHeader && method === 'GET' ? 'POST' : method;
      const effectiveBody = tokenFitsHeader
        ? body
        : { ...(body || {}), userToken: token };

      return fetch(`/.netlify/functions/admin?action=${encodeURIComponent(action)}`, {
        method: effectiveMethod,
        headers: {
          'Accept': 'application/json',
          ...(effectiveBody ? { 'Content-Type': 'application/json' } : {}),
          ...(tokenFitsHeader ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: effectiveBody ? JSON.stringify(effectiveBody) : undefined
      });
    };

    let token = await getValidAccessToken();
    let resp = await executeCall(token);

    if (resp.status === 401) {
      token = await getValidAccessToken(true);
      if (token) {
        resp = await executeCall(token);
      }
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `No se pudo conectar con la función de administración (HTTP ${resp.status}). Recarga la página o vuelve a iniciar sesión.`
      );
    }
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data?.error || `Error en operación de administrador (${resp.status}).`);
    }
    return data;
  },

  /**
   * Obtiene la lista de usuarios registrados desde el endpoint de administración.
   */
  async getAdminUsers() {
    const data = await this.adminRequest('users', 'GET');
    return Array.isArray(data?.users) ? data.users : [];
  },

  /**
   * Crea una nueva asignatura en Supabase desde el panel de administración.
   */
  async createSubject({ id = '', name, description = '', color = 'violet' }) {
    const data = await this.adminRequest('create-subject', 'POST', {
      id,
      name,
      description,
      color
    });
    catalogCache = null;
    await this.getCatalog(true);
    return data?.subject;
  },

  /**
   * Sube un nuevo PDF de temario al bucket público `temarios` de Supabase Storage
   * y registra el temario en la tabla `topics`.
   */
  async createTopicWithPdf({
    subjectId,
    name,
    topicId = '',
    pages = 1,
    file,
    onProgress = () => {}
  }) {
    if (!file) {
      throw new Error('Selecciona un archivo PDF para el temario.');
    }
    onProgress('Preparando el bucket de almacenamiento en Supabase...');
    const prep = await this.adminRequest('prepare-topic-upload', 'POST', {
      subjectId,
      name,
      topicId
    });

    const subject = await this.getSubject(subjectId);
    const displayOrder = (subject?.topics?.length || 0) + 1;

    let uploadedDirect = false;
    if (prep?.signedUploadUrl) {
      try {
        onProgress('Subiendo el archivo PDF a Supabase Storage...');
        const upResp = await fetch(prep.signedUploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/pdf',
            'x-upsert': 'true'
          },
          body: file
        });
        if (upResp.ok) {
          uploadedDirect = true;
        }
      } catch (err) {
        console.warn('Fallo en subida firmada directa, usando subida vía función:', err);
      }
    }

    let pdfBase64 = null;
    if (!uploadedDirect) {
      onProgress('Subiendo PDF a través del servidor...');
      const buffer = await file.arrayBuffer();
      pdfBase64 = arrayBufferToBase64(buffer);
    }

    onProgress('Registrando el nuevo temario en la base de datos...');
    const data = await this.adminRequest('create-topic', 'POST', {
      subjectId,
      topicId: prep?.topicId || topicId,
      name,
      pages,
      displayOrder,
      fileUrl: prep?.publicUrl || '',
      storagePath: prep?.storagePath || '',
      pdfBase64
    });

    catalogCache = null;
    await this.getCatalog(true);
    return data?.topic;
  },

  /**
   * Elimina una asignatura completa desde el panel de administración.
   */
  async deleteSubject(subjectId) {
    await this.adminRequest('delete-subject', 'DELETE', { subjectId });
    catalogCache = null;
    await this.getCatalog(true);
  },

  /**
   * Elimina un temario desde el panel de administración.
   */
  async deleteTopic(subjectId, topicId) {
    await this.adminRequest('delete-topic', 'DELETE', { subjectId, topicId });
    catalogCache = null;
    topicDetailsCache.delete(`${subjectId}/${topicId}`);
    await this.getCatalog(true);
  },

  async initAuth() {
    if (!this.isAuthAvailable()) return { signedIn: false };

    let signedInFromLink = false;
    let linkError = null;

    // Comprobar si la URL trae tokens del enlace mágico (#access_token=... o ?token_hash=...)
    const hashStr = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    if (hashStr.includes('access_token=') || hashStr.includes('error_description=')) {
      const params = new URLSearchParams(hashStr);
      const errDesc = params.get('error_description');
      if (errDesc) {
        linkError = 'Ese enlace del correo ya fue utilizado (cada enlace es de un solo uso).';
        history.replaceState(null, '', location.pathname + location.search + '#inicio');
      } else {
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          const user = await authFetch('user', { token: accessToken });
          storeSession(
            sessionFromTokens(
              {
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in: params.get('expires_in') || 3600,
                expires_at: params.get('expires_at'),
                user
              },
              user
            )
          );
          signedInFromLink = true;
          history.replaceState(null, '', location.pathname + location.search + '#inicio');
        }
      }
    }

    const urlParams = new URLSearchParams(location.search);
    const tokenHash = urlParams.get('token_hash');
    const verifyType = urlParams.get('type') || 'magiclink';
    if (tokenHash) {
      try {
        const data = await authFetch('verify', {
          method: 'POST',
          body: { token_hash: tokenHash, type: verifyType }
        });
        if (data?.access_token) {
          storeSession(sessionFromTokens(data, data.user));
          signedInFromLink = true;
        }
        history.replaceState(null, '', location.pathname + (location.hash || '#inicio'));
      } catch {
        linkError = 'Ese enlace del correo ya fue utilizado (cada enlace es de un solo uso).';
        history.replaceState(null, '', location.pathname + (location.hash || '#inicio'));
      }
    }

    const validToken = await getValidAccessToken();
    if (!validToken) {
      remoteScores = null;
      remoteProfile = null;
      mistakesCache = null;
      return { signedIn: false, error: linkError };
    }

    if (!session?.user?.id) {
      try {
        const user = await authFetch('user', { token: validToken });
        storeSession({ ...session, user: { id: user.id, email: user.email } });
      } catch {
        // continuar con la sesión actual
      }
    }

    await this.syncUserData();
    // Si ya había sesión activa en este navegador, ignoramos el error de haber pulsado dos veces el mismo enlace
    return { signedIn: signedInFromLink };
  },

  async syncUserData() {
    if (!this.isLoggedIn()) return;
    const userId = session.user.id;
    try {
      const token = await getValidAccessToken();
      const [scoresRows, profileRows, authUser] = await Promise.all([
        supabaseFetch(
          'quiz_scores',
          `user_id=eq.${encodeURIComponent(userId)}&select=subject,section,score,total,percentage,created_at&order=created_at.desc&limit=40`
        ).catch(() => null),
        supabaseFetch(
          'student_profiles',
          `id=eq.${encodeURIComponent(userId)}&select=name,is_admin`
        ).catch(() =>
          supabaseFetch(
            'student_profiles',
            `id=eq.${encodeURIComponent(userId)}&select=name`
          ).catch(() => null)
        ),
        token ? authFetch('user', { token }).catch(() => null) : Promise.resolve(null)
      ]);
      if (Array.isArray(scoresRows)) {
        remoteScores = scoresRows.map((r) => ({
          subject: r.subject,
          section: r.section,
          score: r.score,
          total: r.total,
          percentage: r.percentage,
          date: r.created_at
        }));
      }
      let metaAvatar = authUser?.user_metadata?.avatar_url ?? session?.user?.avatar ?? '';
      const metaName = authUser?.user_metadata?.name || '';
      const row = Array.isArray(profileRows) ? profileRows[0] : null;
      const finalName = row?.name || metaName || '';

      if (metaAvatar.startsWith('data:image/') && token) {
        try {
          const shortUrl = await uploadAvatarToStorage(token, finalName, metaAvatar);
          if (shortUrl) {
            metaAvatar = shortUrl;
            await getValidAccessToken(true);
          }
        } catch {
          // conservar el avatar en memoria si falla la migración a Storage
        }
      }

      if (authUser && session?.user) {
        storeSession({
          ...session,
          user: {
            ...session.user,
            avatar: metaAvatar
          }
        });
      }
      remoteProfile = {
        name: finalName,
        avatar: metaAvatar || '',
        is_admin: Boolean(row?.is_admin)
      };
    } catch (err) {
      console.warn('No se pudieron sincronizar los datos del usuario:', err);
    }
  },

  async sendMagicLink(email) {
    if (!this.isAuthAvailable()) {
      throw new Error('Supabase no está configurado.');
    }
    const redirectTo = `${location.origin}${location.pathname}`;
    await authFetch(`otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      body: {
        email: email.trim(),
        create_user: true,
        options: { emailRedirectTo: redirectTo }
      }
    });
  },

  async signInWithPassword(email, password) {
    if (!this.isAuthAvailable()) {
      throw new Error('Supabase no está configurado.');
    }
    const cleanEmail = email.trim();
    try {
      const data = await authFetch('token?grant_type=password', {
        method: 'POST',
        body: { email: cleanEmail, password }
      });
      storeSession(sessionFromTokens(data, data.user));
      await this.syncUserData();
      return { status: 'signed_in' };
    } catch (loginErr) {
      // Si el usuario aún no existe, intentamos registrarlo con esa contraseña
      try {
        const signUpData = await authFetch('signup', {
          method: 'POST',
          body: { email: cleanEmail, password }
        });
        if (signUpData?.access_token) {
          storeSession(sessionFromTokens(signUpData, signUpData.user));
          await this.syncUserData();
          return { status: 'signed_up' };
        }
        if (signUpData?.id || signUpData?.user?.id) {
          return { status: 'confirm_email' };
        }
      } catch {
        // Si ya existía (p. ej. creado por enlace mágico), devolvemos un mensaje claro
      }
      throw new Error('Credenciales incorrectas o cuenta sin contraseña definida. Usa "Enviar enlace al correo" o revisa tu contraseña.');
    }
  },

  async updatePassword(newPassword) {
    const token = await getValidAccessToken();
    if (!token) throw new Error('Inicia sesión primero.');
    await authFetch('user', {
      method: 'PUT',
      token,
      body: { password: newPassword }
    });
  },

  async signOut() {
    const token = session?.access_token;
    storeSession(null);
    remoteScores = null;
    remoteProfile = null;
    mistakesCache = null;
    if (token && this.isAuthAvailable()) {
      await authFetch('logout', { method: 'POST', token }).catch(() => {});
    }
  },

  /**
   * Banco de preguntas falladas en Supabase (`student_mistakes`)
   */
  async getMistakes(forceRefresh = false) {
    if (!this.isLoggedIn() || !this.isAuthAvailable()) {
      return [];
    }
    if (mistakesCache && !forceRefresh) {
      return mistakesCache;
    }

    const userId = session.user.id;
    const [rows, catalog] = await Promise.all([
      supabaseFetch(
        'student_mistakes',
        `user_id=eq.${encodeURIComponent(userId)}&select=question_id,fail_count,last_failed_at,questions(id,subject_id,topic_id,section_id,question,options,answer,explanation)&order=fail_count.desc,last_failed_at.desc`
      ),
      this.getCatalog()
    ]);

    const subjectMap = new Map(catalog.map((s) => [s.id, s]));

    mistakesCache = (rows || [])
      .filter((r) => r.questions && r.questions.id)
      .map((r) => {
        const q = r.questions;
        const sub = subjectMap.get(q.subject_id);
        const top = sub?.topics?.find((t) => t.id === q.topic_id);
        const sec = top?.sections?.find((s) => s.id === q.section_id);
        const origin = [sub?.name || q.subject_id, sec?.name || top?.name || q.topic_id]
          .filter(Boolean)
          .join(' · ');
        return {
          questionId: r.question_id,
          subjectId: q.subject_id,
          topicId: q.topic_id,
          sectionId: q.section_id,
          failCount: r.fail_count || 1,
          lastFailedAt: r.last_failed_at,
          question: {
            id: q.id,
            question: q.question,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation || '',
            origin
          }
        };
      });

    return mistakesCache;
  },

  async recordMistake(question) {
    if (!this.isLoggedIn() || !this.isAuthAvailable() || !question?.id) {
      return;
    }
    const userId = session.user.id;
    const existing = mistakesCache?.find((m) => m.questionId === question.id);
    const nextCount = (existing?.failCount || 0) + 1;
    const nowIso = new Date().toISOString();

    await supabaseFetch('student_mistakes', 'on_conflict=user_id,question_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        user_id: userId,
        question_id: question.id,
        fail_count: nextCount,
        last_failed_at: nowIso
      }
    });

    mistakesCache = null;
  },

  async resolveMistake(questionId) {
    if (!this.isLoggedIn() || !this.isAuthAvailable() || !questionId) {
      return;
    }
    const userId = session.user.id;
    await supabaseFetch(
      'student_mistakes',
      `user_id=eq.${encodeURIComponent(userId)}&question_id=eq.${encodeURIComponent(questionId)}`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      }
    );
    if (mistakesCache) {
      mistakesCache = mistakesCache.filter((m) => m.questionId !== questionId);
    }
  },

  async clearMistakes(subjectId = '') {
    if (!this.isLoggedIn() || !this.isAuthAvailable()) {
      return;
    }
    const userId = session.user.id;
    if (!subjectId) {
      await supabaseFetch('student_mistakes', `user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      mistakesCache = [];
      return;
    }

    const current = await this.getMistakes();
    const idsToDelete = current.filter((m) => m.subjectId === subjectId).map((m) => m.questionId);
    if (!idsToDelete.length) return;

    const filterList = idsToDelete.map((id) => encodeURIComponent(id)).join(',');
    await supabaseFetch(
      'student_mistakes',
      `user_id=eq.${encodeURIComponent(userId)}&question_id=in.(${filterList})`,
      {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      }
    );
    if (mistakesCache) {
      mistakesCache = mistakesCache.filter((m) => m.subjectId !== subjectId);
    }
  },

  /**
   * Métricas y Puntuaciones
   */
  readScores() {
    if (this.isLoggedIn() && Array.isArray(remoteScores)) {
      return remoteScores;
    }
    try {
      return JSON.parse(localStorage.getItem(SCORE_KEY)) || [];
    } catch {
      return [];
    }
  },

  async saveScore(score) {
    if (this.isLoggedIn() && Array.isArray(remoteScores)) {
      remoteScores.unshift(score);
    }
    try {
      const scores = JSON.parse(localStorage.getItem(SCORE_KEY)) || [];
      scores.unshift(score);
      localStorage.setItem(SCORE_KEY, JSON.stringify(scores.slice(0, 40)));
    } catch (err) {
      console.error('Error guardando en localStorage:', err);
    }

    // Si Supabase está activado, sincroniza la puntuación remotamente (asociada al user_id si hay sesión)
    if (SUPABASE_CONFIG.enabled && SUPABASE_CONFIG.url) {
      try {
        await supabaseFetch('quiz_scores', '', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: {
            user_id: session?.user?.id || null,
            subject: score.subject,
            section: score.section,
            score: score.score,
            total: score.total,
            percentage: score.percentage
          }
        });
      } catch (err) {
        console.warn('No se pudo guardar la puntuación en Supabase:', err);
      }
    }
  },

  async clearScores() {
    try {
      localStorage.removeItem(SCORE_KEY);
    } catch {
      // ignore storage errors
    }
    if (this.isLoggedIn() && this.isAuthAvailable()) {
      const userId = session.user.id;
      await supabaseFetch('quiz_scores', `user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' }
      });
      remoteScores = [];
    } else {
      remoteScores = null;
    }
  },

  /**
   * Perfil de estudiante (nombre + foto de perfil sincronizados en localStorage y Supabase)
   */
  readProfile() {
    let local = { name: '', avatar: '' };
    try {
      local = JSON.parse(localStorage.getItem(PROFILE_KEY)) || { name: '', avatar: '' };
    } catch {
      local = { name: '', avatar: '' };
    }
    if (this.isLoggedIn() && remoteProfile) {
      return {
        name: remoteProfile.name || local.name || '',
        avatar: remoteProfile.avatar ?? session?.user?.avatar ?? local.avatar ?? '',
        is_admin: Boolean(remoteProfile.is_admin)
      };
    }
    return {
      name: local.name || '',
      avatar: local.avatar || ''
    };
  },

  saveProfile(name, avatar = undefined) {
    const current = this.readProfile();
    const clean = String(name ?? current.name ?? '').trim();
    const nextAvatar = avatar !== undefined ? String(avatar || '') : String(current.avatar || '');

    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: clean, avatar: nextAvatar }));

    if (this.isLoggedIn() && this.isAuthAvailable()) {
      remoteProfile = { ...(remoteProfile || {}), name: clean, avatar: nextAvatar };
      if (session?.user) {
        storeSession({
          ...session,
          user: { ...session.user, avatar: nextAvatar }
        });
      }
      supabaseFetch('student_profiles', 'on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: {
          id: session.user.id,
          name: clean,
          updated_at: new Date().toISOString()
        }
      }).catch((err) => console.warn('No se pudo sincronizar el perfil en Supabase:', err));

      getValidAccessToken()
        .then(async (token) => {
          if (!token) return;
          if (nextAvatar.startsWith('data:image/')) {
            const shortUrl = await uploadAvatarToStorage(token, clean, nextAvatar);
            if (shortUrl) {
              remoteProfile = { ...(remoteProfile || {}), name: clean, avatar: shortUrl };
              localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: clean, avatar: shortUrl }));
              if (session?.user) {
                storeSession({
                  ...session,
                  user: { ...session.user, avatar: shortUrl }
                });
              }
            }
            return;
          }
          await authFetch('user', {
            method: 'PUT',
            token,
            body: {
              data: {
                name: clean,
                avatar_url: nextAvatar
              }
            }
          });
        })
        .catch((err) => console.warn('No se pudo sincronizar el avatar en Supabase:', err));
    }
  }
};
