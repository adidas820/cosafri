#!/usr/bin/env python3
"""
build.py — Script de build y sincronización con Supabase para Netlify.

1. Genera `config.js` con las credenciales públicas de cliente (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
   y un indicador booleano `hasServerKey` si `GEMINI_API_KEY` existe en Netlify.
   (Ni `SUPABASE_SERVICE_ROLE_KEY` ni `GEMINI_API_KEY` se escriben jamás en config.js).
2. Si existe `SUPABASE_SERVICE_ROLE_KEY`, sincroniza automáticamente
   todo el catálogo (`data/catalog.json` y `temas/*/*.json`) hacia las tablas de Supabase.

Configuración en Netlify:
  Build command:  python3 build.py
  Publish dir:    .

Variables de entorno en Netlify > Site configuration > Environment variables:
  SUPABASE_URL               →  https://tuproyecto.supabase.co
  SUPABASE_ANON_KEY          →  tu-clave-anon-publica
  SUPABASE_SERVICE_ROLE_KEY  →  tu-clave-service-role-secreta
  GEMINI_API_KEY             →  tu-clave-de-gemini-api
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid

supabase_url = os.environ.get('SUPABASE_URL', '').strip().rstrip('/')
supabase_anon_key = os.environ.get('SUPABASE_ANON_KEY', '').strip()
supabase_service_key = (
    os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    or os.environ.get('SUPABASE_SERVICE_KEY', '').strip()
)
gemini_api_key = os.environ.get('GEMINI_API_KEY', '').strip()

enabled = 'true' if supabase_url and supabase_anon_key else 'false'
has_server_gemini = 'true' if gemini_api_key else 'false'

# 1. Generar config.js (NUNCA escribe GEMINI_API_KEY ni SUPABASE_SERVICE_ROLE_KEY en texto plano)
config_content = f"""/**
 * config.js — Generado automáticamente por build.py
 * NO editar a mano en producción.
 */
export const CONFIG = {{
  supabase: {{
    url: '{supabase_url}',
    anonKey: '{supabase_anon_key}',
    enabled: {enabled}
  }},
  gemini: {{
    apiKey: '',
    hasServerKey: {has_server_gemini},
    model: 'gemini-3.8-flash'
  }}
}};
"""

with open('config.js', 'w', encoding='utf-8') as f:
    f.write(config_content)

status = 'ACTIVADO' if enabled == 'true' else 'DESACTIVADO (modo estático)'
gemini_status = 'ACTIVO EN SERVIDOR (Netlify Function)' if gemini_api_key else 'PENDIENTE (configurable en web o Netlify)'
print(f'✓ config.js generado — Supabase: {status} · Gemini: {gemini_status}')


def supabase_request(method, path, api_key, payload=None, extra_headers=None):
    url = f"{supabase_url}/rest/v1/{path}"
    headers = {
        'apikey': api_key,
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status


def sync_catalog_to_supabase():
    if not supabase_url or not supabase_service_key:
        print('ℹ Sin SUPABASE_SERVICE_ROLE_KEY: se omite la sincronización automática de la BD.')
        return

    if not os.path.exists('data/catalog.json'):
        print('⚠ No se encontró data/catalog.json para sincronizar.')
        return

    print('↻ Sincronizando catálogo y preguntas con Supabase...')
    with open('data/catalog.json', 'r', encoding='utf-8') as f:
        catalog = json.load(f)

    upsert_headers = {'Prefer': 'resolution=merge-duplicates,return=minimal'}

    subjects_payload = []
    topics_payload = []
    sections_payload = []
    topics_questions = []  # lista de tuplas (subject_id, topic_id, sec_ids, questions_rows)

    for subject in catalog:
        sub_id = subject['id']
        subjects_payload.append({
            'id': sub_id,
            'name': subject['name'],
            'folder': subject.get('folder', f'temas/{sub_id}'),
            'description': subject.get('description', ''),
            'color': subject.get('color', 'violet')
        })

        for t_idx, topic in enumerate(subject.get('topics', []), start=1):
            top_id = topic['id']
            topics_payload.append({
                'id': top_id,
                'subject_id': sub_id,
                'name': topic['name'],
                'file_url': topic['file'],
                'pages': topic.get('pages', 1),
                'display_order': t_idx
            })

            data_path = topic.get('dataPath') or f"{subject.get('folder', 'temas/' + sub_id)}/{top_id}.json"
            topic_detail = None
            if os.path.exists(data_path):
                with open(data_path, 'r', encoding='utf-8') as tf:
                    topic_detail = json.load(tf)

            sections_source = (
                topic_detail.get('sections', [])
                if topic_detail and 'sections' in topic_detail
                else topic.get('sections', [])
            )

            q_rows = []
            sec_ids = []
            q_order = 1
            for s_idx, sec in enumerate(sections_source, start=1):
                sec_id = sec['id']
                sec_ids.append(sec_id)
                sections_payload.append({
                    'id': sec_id,
                    'subject_id': sub_id,
                    'topic_id': top_id,
                    'name': sec['name'],
                    'description': sec.get('description', ''),
                    'display_order': s_idx
                })

                for s_q_idx, q in enumerate(sec.get('questions', []), start=1):
                    # UUID determinista para no romper claves foráneas en student_mistakes al redesplegar
                    deterministic_id = str(
                        uuid.uuid5(uuid.NAMESPACE_DNS, f"cuaderno:{sub_id}:{top_id}:{sec_id}:{s_q_idx}")
                    )
                    q_rows.append({
                        'id': deterministic_id,
                        'subject_id': sub_id,
                        'topic_id': top_id,
                        'section_id': sec_id,
                        'question': q['question'],
                        'options': q['options'],
                        'answer': q['answer'],
                        'explanation': q.get('explanation', ''),
                        'display_order': q_order
                    })
                    q_order += 1

            topics_questions.append((sub_id, top_id, sec_ids, q_rows))

    try:
        if subjects_payload:
            supabase_request('POST', 'subjects?on_conflict=id', supabase_service_key, subjects_payload, upsert_headers)
        if topics_payload:
            supabase_request('POST', 'topics?on_conflict=subject_id,id', supabase_service_key, topics_payload, upsert_headers)
        if sections_payload:
            supabase_request('POST', 'sections?on_conflict=subject_id,topic_id,id', supabase_service_key, sections_payload, upsert_headers)

        total_q = 0
        for sub_id, top_id, sec_ids, q_rows in topics_questions:
            if q_rows:
                supabase_request('POST', 'questions?on_conflict=id', supabase_service_key, q_rows, upsert_headers)
                total_q += len(q_rows)
            if sec_ids and q_rows:
                # Limpiar preguntas duplicadas antiguas (con UUID aleatorio previo) manteniendo las deterministas y las de IA
                sec_filter = ','.join(urllib.parse.quote(s, safe='') for s in sec_ids)
                ids_filter = ','.join(urllib.parse.quote(r['id'], safe='') for r in q_rows)
                del_path = (
                    f"questions?subject_id=eq.{urllib.parse.quote(sub_id, safe='')}"
                    f"&topic_id=eq.{urllib.parse.quote(top_id, safe='')}"
                    f"&section_id=in.({sec_filter})"
                    f"&id=not.in.({ids_filter})"
                )
                supabase_request('DELETE', del_path, supabase_service_key)

        print(
            f"✓ Sincronización completada: {len(subjects_payload)} asignaturas, "
            f"{len(topics_payload)} temas, {len(sections_payload)} secciones y {total_q} preguntas."
        )
    except urllib.error.HTTPError as err:
        body = err.read().decode('utf-8', errors='replace')
        print(f"⚠ Error HTTP al sincronizar con Supabase ({err.code}): {body}")
        print("  Asegúrate de haber creado las tablas ejecutando supabase-schema.sql una primera vez en Supabase.")
    except Exception as err:
        print(f"⚠ No se pudo sincronizar con Supabase: {err}")


if __name__ == '__main__':
    sync_catalog_to_supabase()
