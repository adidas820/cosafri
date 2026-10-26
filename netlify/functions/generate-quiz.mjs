/**
 * Netlify Serverless Function: /.netlify/functions/generate-quiz
 *
 * Usa las variables de entorno de Netlify en el servidor (sin exponerlas al navegador):
 * - GEMINI_API_KEY
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY como fallback)
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

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'DELETE') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { subjectId, topicId, sectionId } = body;
      if (!subjectId || !topicId || !sectionId || !String(sectionId).startsWith('ia-')) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Solo se pueden eliminar tests generados con IA (ia-...).' })
        };
      }
      const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
      const supabaseKey = (
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        ''
      ).trim();
      const anonKey = (process.env.SUPABASE_ANON_KEY || supabaseKey).trim();
      if (!supabaseUrl || !supabaseKey) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Supabase no está configurado en el servidor.' })
        };
      }

      // Verificar identidad y permisos de administrador del usuario autenticado
      const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
      const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!userToken) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Debes iniciar sesión como administrador para eliminar tests.' })
        };
      }

      const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${userToken}`
        }
      });
      if (!userResp.ok) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Sesión inválida o expirada.' })
        };
      }
      const authUser = await userResp.json();
      const adminEmailEnv = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      const userEmail = String(authUser?.email || '').trim().toLowerCase();

      let isAdmin =
        (adminEmailEnv && userEmail && adminEmailEnv === userEmail) ||
        authUser?.app_metadata?.role === 'admin' ||
        authUser?.user_metadata?.role === 'admin';

      if (!isAdmin && authUser?.id) {
        const profResp = await fetch(
          `${supabaseUrl}/rest/v1/student_profiles?id=eq.${encodeURIComponent(authUser.id)}&select=is_admin`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          }
        );
        if (profResp.ok) {
          const profRows = await profResp.json().catch(() => []);
          if (Array.isArray(profRows) && profRows[0]?.is_admin === true) {
            isAdmin = true;
          }
        }
      }

      if (!isAdmin) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Acceso denegado: solo el administrador puede eliminar tests.' })
        };
      }

      const delUrl = `${supabaseUrl}/rest/v1/sections?subject_id=eq.${encodeURIComponent(subjectId)}&topic_id=eq.${encodeURIComponent(topicId)}&id=eq.${encodeURIComponent(sectionId)}`;
      const delResp = await fetch(delUrl, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        }
      });
      if (!delResp.ok) {
        const errText = await delResp.text().catch(() => '');
        return {
          statusCode: delResp.status,
          headers,
          body: JSON.stringify({ error: `Error al borrar de Supabase (${delResp.status}): ${errText}` })
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ deleted: true })
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message || 'Error al eliminar el test.' })
      };
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método no permitido. Usa POST o DELETE.' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      subject,
      topic,
      questionCount = 10,
      customTitle = '',
      customFocus = '',
      existingContext = '',
      existingSectionCount = 0,
      pdfBase64 = null,
      clientApiKey = ''
    } = body;

    const geminiApiKey = (process.env.GEMINI_API_KEY || clientApiKey || '').trim();
    if (!geminiApiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Falta la variable de entorno GEMINI_API_KEY en Netlify (o introducirla en el formulario).'
        })
      };
    }

    if (!subject?.id || !topic?.id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Faltan datos de la asignatura o del temario.' })
      };
    }

    const count = Math.max(1, Math.min(30, Number(questionCount) || 10));

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
      existingContext || ''
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

    const geminiResp = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey
      },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        input: inputParts,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: quizSchema
        }
      })
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text().catch(() => '');
      let errMsg = `Error en Gemini API (${geminiResp.status})`;
      try {
        const parsedErr = JSON.parse(errText);
        if (parsedErr?.error?.message) errMsg = parsedErr.error.message;
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 180)}`;
      }
      return {
        statusCode: geminiResp.status,
        headers,
        body: JSON.stringify({ error: errMsg })
      };
    }

    const interactionData = await geminiResp.json();
    const rawJsonText = extractInteractionText(interactionData);
    const generated = JSON.parse(rawJsonText);

    if (!Array.isArray(generated?.questions) || generated.questions.length === 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Gemini no devolvió preguntas válidas.' })
      };
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

    // Subir a Supabase usando SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY)
    const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    const supabaseKey = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ''
    ).trim();

    let uploadedToSupabase = false;
    let supabaseWarning = null;

    if (supabaseUrl && supabaseKey) {
      try {
        const sbHeaders = {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        };

        // 1. Insertar sección
        const secResp = await fetch(`${supabaseUrl}/rest/v1/sections?on_conflict=subject_id,topic_id,id`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify({
            id: newSection.id,
            subject_id: subject.id,
            topic_id: topic.id,
            name: newSection.name,
            description: newSection.description,
            display_order: Number(existingSectionCount) + 1
          })
        });

        if (!secResp.ok) {
          const secErr = await secResp.text().catch(() => '');
          throw new Error(`sections (${secResp.status}): ${secErr}`);
        }

        // 2. Insertar preguntas
        const questionRows = newSection.questions.map((q, idx) => ({
          subject_id: subject.id,
          topic_id: topic.id,
          section_id: newSection.id,
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation || '',
          display_order: idx + 1
        }));

        const qResp = await fetch(`${supabaseUrl}/rest/v1/questions`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(questionRows)
        });

        if (!qResp.ok) {
          const qErr = await qResp.text().catch(() => '');
          throw new Error(`questions (${qResp.status}): ${qErr}`);
        }

        uploadedToSupabase = true;
      } catch (err) {
        supabaseWarning = err.message;
      }
    } else {
      supabaseWarning = 'Variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configuradas en el servidor.';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        section: newSection,
        uploadedToSupabase,
        supabaseWarning
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Error interno al generar el test.' })
    };
  }
};
