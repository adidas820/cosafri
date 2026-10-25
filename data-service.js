/**
 * data-service.js
 * Capa de abstracción de datos para Cuaderno.
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
 *    - Cambia SUPABASE_CONFIG.enabled a true y coloca tus credenciales.
 *    - Todas las llamadas se redirigirán a Supabase sin tocar la interfaz ni el enrutador.
 */

import { catalog as fallbackCatalog } from './study-data.js';

// config.js es opcional (está en .gitignore y lo genera build.py en Netlify).
// Se importa dinámicamente para que, si no existe, la app siga funcionando en modo estático
// en lugar de romper toda la carga de módulos.
let CONFIG = { supabase: { url: '', anonKey: '', enabled: false } };
try {
  ({ CONFIG } = await import('./config.js'));
} catch {
  console.info('config.js no encontrado: usando modo estático (sin Supabase).');
}

export const SUPABASE_CONFIG = {
  url: CONFIG?.supabase?.url || '',
  anonKey: CONFIG?.supabase?.anonKey || '',
  enabled: Boolean(CONFIG?.supabase?.enabled)
};

const SCORE_KEY = 'cuaderno.quiz-scores.v1';
const PROFILE_KEY = 'cuaderno.profile.v1';

// Caché en memoria para carga diferida
let catalogCache = null;
const topicDetailsCache = new Map();

/**
 * Cliente básico de Supabase mediante REST API (no requiere instalar paquetes npm)
 */
async function supabaseFetch(table, params = '') {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    throw new Error('Supabase no está configurado. Revisa SUPABASE_CONFIG en data-service.js');
  }
  const endpoint = `${SUPABASE_CONFIG.url.replace(/\/$/, '')}/rest/v1/${table}${params ? `?${params}` : ''}`;
  const response = await fetch(endpoint, {
    headers: {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Error en Supabase (${table}): ${response.statusText}`);
  }
  return response.json();
}

export const dataService = {
  /**
   * Obtiene el catálogo de asignaturas y temas (metadatos ligeros).
   */
  async getCatalog() {
    if (catalogCache) return catalogCache;

    if (SUPABASE_CONFIG.enabled) {
      try {
        const subjects = await supabaseFetch('subjects', 'select=id,name,folder,description,color,topics(id,name,file_url,pages,display_order,sections(id,name,description,display_order,questions(count)))&order=created_at.asc');
        catalogCache = subjects.map((sub) => ({
          id: sub.id,
          name: sub.name,
          folder: sub.folder,
          description: sub.description,
          color: sub.color || 'violet',
          topics: (sub.topics || []).sort((a, b) => a.display_order - b.display_order).map((top) => ({
            id: top.id,
            name: top.name,
            file: top.file_url,
            pages: top.pages,
            sections: (top.sections || []).sort((a, b) => a.display_order - b.display_order).map((sec) => ({
              id: sec.id,
              name: sec.name,
              description: sec.description,
              questionCount: sec.questions?.[0]?.count || 0
            }))
          }))
        }));
        return catalogCache;
      } catch (err) {
        console.warn('Fallo al consultar Supabase, usando catálogo estático:', err);
      }
    }

    // Modo Estático Netlify: Carga diferida de data/catalog.json
    try {
      const response = await fetch('./data/catalog.json');
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      catalogCache = await response.json();
      return catalogCache;
    } catch (err) {
      console.warn('No se pudo cargar data/catalog.json por fetch (posible protocolo file://). Usando fallback local:', err);
      catalogCache = fallbackCatalog.map((sub) => ({
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
      }));
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
  async getTopicDetails(subjectId, topicId) {
    const cacheKey = `${subjectId}/${topicId}`;
    if (topicDetailsCache.has(cacheKey)) {
      return topicDetailsCache.get(cacheKey);
    }

    if (SUPABASE_CONFIG.enabled) {
      try {
        const sectionsData = await supabaseFetch('sections', `subject_id=eq.${encodeURIComponent(subjectId)}&topic_id=eq.${encodeURIComponent(topicId)}&select=id,name,description,display_order,questions(question,options,answer,explanation,display_order)&order=display_order.asc`);
        const topicData = {
          id: topicId,
          subjectId,
          sections: sectionsData.map((sec) => ({
            id: sec.id,
            name: sec.name,
            description: sec.description,
            questions: (sec.questions || []).sort((a, b) => a.display_order - b.display_order)
          }))
        };
        topicDetailsCache.set(cacheKey, topicData);
        return topicData;
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
      const data = await response.json();
      topicDetailsCache.set(cacheKey, data);
      return data;
    } catch (err) {
      console.warn(`No se pudo cargar ${dataPath} por fetch, buscando en fallback:`, err);
      // Fallback a los datos de study-data.js
      const fbSubject = fallbackCatalog.find((s) => s.id === subjectId);
      const fbTopic = fbSubject?.topics.find((t) => t.id === topicId);
      if (fbTopic) {
        const fallbackData = {
          id: fbTopic.id,
          subjectId,
          name: fbTopic.name,
          sections: fbTopic.sections
        };
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
