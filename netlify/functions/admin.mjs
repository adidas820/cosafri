/**
 * Netlify Serverless Function: /.netlify/functions/admin
 *
 * Endpoint exclusivo para el Panel de Administración.
 * Verifica el JWT del usuario en Supabase Auth y comprueba que sea administrador
 * antes de consultar datos globales usando SUPABASE_SERVICE_ROLE_KEY.
 */

const STORAGE_BUCKET = 'temarios';

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function ensurePublicBucket(supabaseUrl, supabaseServiceKey) {
  const bucketHeaders = {
    'apikey': supabaseServiceKey,
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  };
  const checkResp = await fetch(`${supabaseUrl}/storage/v1/bucket/${STORAGE_BUCKET}`, {
    headers: bucketHeaders
  });
  if (checkResp.ok) {
    const info = await checkResp.json().catch(() => ({}));
    if (info && info.public === false) {
      await fetch(`${supabaseUrl}/storage/v1/bucket/${STORAGE_BUCKET}`, {
        method: 'PUT',
        headers: bucketHeaders,
        body: JSON.stringify({ id: STORAGE_BUCKET, name: STORAGE_BUCKET, public: true })
      }).catch(() => {});
    }
    return;
  }
  await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: bucketHeaders,
    body: JSON.stringify({ id: STORAGE_BUCKET, name: STORAGE_BUCKET, public: true })
  }).catch(() => {});
}

async function verifyAdminUser(event, supabaseUrl, supabaseServiceKey, anonKey) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!userToken) {
    return { ok: false, status: 401, error: 'Debes iniciar sesión para acceder al panel de administración.' };
  }

  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${userToken}`
    }
  });
  if (!userResp.ok) {
    return { ok: false, status: 401, error: 'Sesión inválida o expirada.' };
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
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`
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
    return { ok: false, status: 403, error: 'Acceso denegado: tu cuenta no tiene permisos de administrador.' };
  }

  return { ok: true, user: authUser };
}

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8'
  };

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supabaseServiceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || supabaseServiceKey).trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Netlify.'
      })
    };
  }

  const authCheck = await verifyAdminUser(event, supabaseUrl, supabaseServiceKey, anonKey);
  if (!authCheck.ok) {
    return {
      statusCode: authCheck.status,
      headers,
      body: JSON.stringify({ error: authCheck.error })
    };
  }

  const sbHeaders = {
    'apikey': supabaseServiceKey,
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  };

  try {
    const action = event.queryStringParameters?.action || 'users';

    if (event.httpMethod === 'GET' && action === 'users') {
      const [authUsersResp, profilesResp, scoresResp, mistakesResp] = await Promise.all([
        fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, { headers: sbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/student_profiles?select=id,name,is_admin,updated_at`, { headers: sbHeaders }).catch(() => null),
        fetch(`${supabaseUrl}/rest/v1/quiz_scores?select=user_id,percentage,created_at`, { headers: sbHeaders }).catch(() => null),
        fetch(`${supabaseUrl}/rest/v1/student_mistakes?select=user_id,fail_count`, { headers: sbHeaders }).catch(() => null)
      ]);

      if (!authUsersResp.ok) {
        const errText = await authUsersResp.text().catch(() => '');
        return {
          statusCode: authUsersResp.status,
          headers,
          body: JSON.stringify({ error: `No se pudo obtener la lista de usuarios (${authUsersResp.status}): ${errText}` })
        };
      }

      const authData = await authUsersResp.json();
      const rawUsers = Array.isArray(authData?.users) ? authData.users : Array.isArray(authData) ? authData : [];
      const profiles = profilesResp && profilesResp.ok ? await profilesResp.json().catch(() => []) : [];
      const scores = scoresResp && scoresResp.ok ? await scoresResp.json().catch(() => []) : [];
      const mistakes = mistakesResp && mistakesResp.ok ? await mistakesResp.json().catch(() => []) : [];

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      const scoresByUser = new Map();
      for (const s of scores || []) {
        if (!s.user_id) continue;
        const entry = scoresByUser.get(s.user_id) || { count: 0, sum: 0 };
        entry.count += 1;
        entry.sum += Number(s.percentage) || 0;
        scoresByUser.set(s.user_id, entry);
      }

      const mistakesByUser = new Map();
      for (const m of mistakes || []) {
        if (!m.user_id) continue;
        mistakesByUser.set(m.user_id, (mistakesByUser.get(m.user_id) || 0) + 1);
      }

      const adminEmailEnv = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

      const users = rawUsers
        .map((u) => {
          const prof = profileMap.get(u.id);
          const sc = scoresByUser.get(u.id) || { count: 0, sum: 0 };
          const email = u.email || '';
          const isAdmin =
            Boolean(prof?.is_admin) ||
            u.app_metadata?.role === 'admin' ||
            u.user_metadata?.role === 'admin' ||
            Boolean(adminEmailEnv && email.toLowerCase() === adminEmailEnv);

          return {
            id: u.id,
            email,
            name: prof?.name || u.user_metadata?.name || '',
            isAdmin,
            createdAt: u.created_at || null,
            lastSignInAt: u.last_sign_in_at || null,
            testsCompleted: sc.count,
            averageScore: sc.count > 0 ? Math.round(sc.sum / sc.count) : null,
            pendingMistakes: mistakesByUser.get(u.id) || 0
          };
        })
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ users })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};

    if (event.httpMethod === 'POST' && action === 'create-subject') {
      const name = String(body.name || '').trim();
      const description = String(body.description || '').trim();
      const color = ['violet', 'amber', 'green', 'blue'].includes(body.color) ? body.color : 'violet';
      const id = slugify(body.id || name);

      if (!name || !id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'El nombre de la asignatura es obligatorio.' })
        };
      }

      const folder = `temas/${id.replace(/-/g, '_')}`;
      const subjectRow = { id, name, folder, description, color };

      const resp = await fetch(`${supabaseUrl}/rest/v1/subjects?on_conflict=id`, {
        method: 'POST',
        headers: {
          ...sbHeaders,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(subjectRow)
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return {
          statusCode: resp.status,
          headers,
          body: JSON.stringify({ error: `No se pudo guardar la asignatura (${resp.status}): ${errText}` })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ subject: subjectRow })
      };
    }

    if (event.httpMethod === 'POST' && action === 'prepare-topic-upload') {
      const subjectId = String(body.subjectId || '').trim();
      const name = String(body.name || '').trim();
      const rawTopicId = slugify(body.topicId || name) || `tema-${Date.now().toString(36)}`;

      if (!subjectId || !name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Selecciona una asignatura e indica el nombre del temario.' })
        };
      }

      await ensurePublicBucket(supabaseUrl, supabaseServiceKey);

      const storagePath = `${subjectId}/${rawTopicId}-${Date.now().toString(36)}.pdf`;
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;

      const signResp = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${storagePath}`, {
        method: 'POST',
        headers: {
          ...sbHeaders,
          'x-upsert': 'true'
        },
        body: JSON.stringify({})
      });

      let signedUploadUrl = null;
      if (signResp.ok) {
        const signData = await signResp.json().catch(() => ({}));
        if (signData?.url) {
          signedUploadUrl = signData.url.startsWith('http')
            ? signData.url
            : `${supabaseUrl}/storage/v1${signData.url.startsWith('/') ? '' : '/'}${signData.url}`;
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          topicId: rawTopicId,
          storagePath,
          publicUrl,
          signedUploadUrl
        })
      };
    }

    if (event.httpMethod === 'POST' && action === 'create-topic') {
      const subjectId = String(body.subjectId || '').trim();
      const name = String(body.name || '').trim();
      const topicId = slugify(body.topicId || name) || `tema-${Date.now().toString(36)}`;
      const pages = Math.max(1, Number(body.pages) || 1);
      const displayOrder = Math.max(1, Number(body.displayOrder) || 1);
      let fileUrl = String(body.fileUrl || '').trim();

      if (!subjectId || !name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Faltan datos obligatorios del temario (asignatura o nombre).' })
        };
      }

      // Si el cliente envió el PDF en base64 como respaldo, lo subimos desde aquí al bucket público
      if (body.pdfBase64) {
        await ensurePublicBucket(supabaseUrl, supabaseServiceKey);
        const storagePath = body.storagePath || `${subjectId}/${topicId}-${Date.now().toString(36)}.pdf`;
        const binary = Buffer.from(body.pdfBase64, 'base64');
        const upResp = await fetch(`${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`, {
          method: 'POST',
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true'
          },
          body: binary
        });
        if (!upResp.ok) {
          const errText = await upResp.text().catch(() => '');
          return {
            statusCode: upResp.status,
            headers,
            body: JSON.stringify({ error: `Error al subir el PDF a Supabase Storage (${upResp.status}): ${errText}` })
          };
        }
        fileUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
      }

      if (!fileUrl) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falta el archivo PDF o su URL pública.' })
        };
      }

      const topicRow = {
        id: topicId,
        subject_id: subjectId,
        name,
        file_url: fileUrl,
        pages,
        display_order: displayOrder
      };

      const resp = await fetch(`${supabaseUrl}/rest/v1/topics?on_conflict=subject_id,id`, {
        method: 'POST',
        headers: {
          ...sbHeaders,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(topicRow)
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return {
          statusCode: resp.status,
          headers,
          body: JSON.stringify({ error: `No se pudo guardar el temario en la base de datos (${resp.status}): ${errText}` })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          topic: {
            id: topicId,
            subjectId,
            name,
            file: fileUrl,
            pages,
            sections: []
          }
        })
      };
    }

    if (event.httpMethod === 'DELETE' && action === 'delete-subject') {
      const subjectId = String(body.subjectId || '').trim();
      if (!subjectId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falta el identificador de la asignatura.' })
        };
      }
      const delResp = await fetch(`${supabaseUrl}/rest/v1/subjects?id=eq.${encodeURIComponent(subjectId)}`, {
        method: 'DELETE',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' }
      });
      if (!delResp.ok) {
        const errText = await delResp.text().catch(() => '');
        return {
          statusCode: delResp.status,
          headers,
          body: JSON.stringify({ error: `No se pudo eliminar la asignatura (${delResp.status}): ${errText}` })
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ deleted: true })
      };
    }

    if (event.httpMethod === 'DELETE' && action === 'delete-topic') {
      const subjectId = String(body.subjectId || '').trim();
      const topicId = String(body.topicId || '').trim();
      if (!subjectId || !topicId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Faltan los identificadores de asignatura o temario.' })
        };
      }
      const delResp = await fetch(
        `${supabaseUrl}/rest/v1/topics?subject_id=eq.${encodeURIComponent(subjectId)}&id=eq.${encodeURIComponent(topicId)}`,
        {
          method: 'DELETE',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' }
        }
      );
      if (!delResp.ok) {
        const errText = await delResp.text().catch(() => '');
        return {
          statusCode: delResp.status,
          headers,
          body: JSON.stringify({ error: `No se pudo eliminar el temario (${delResp.status}): ${errText}` })
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ deleted: true })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Acción no reconocida en el panel de administración.' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Error interno en el panel de administración.' })
    };
  }
};
