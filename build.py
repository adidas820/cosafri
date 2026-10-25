#!/usr/bin/env python3
"""
build.py — Script de build para Netlify.

Lee las variables de entorno de Netlify y genera config.js
con las credenciales de Supabase. Si no existen las variables,
genera un config.js con Supabase desactivado (modo estático puro).

Configuración en Netlify:
  Build command:  python build.py
  Publish dir:    .

Variables de entorno a configurar en Netlify > Site settings > Environment variables:
  SUPABASE_URL       →  https://tuproyecto.supabase.co
  SUPABASE_ANON_KEY  →  tu-clave-anon-publica
"""

import os

supabase_url = os.environ.get('SUPABASE_URL', '')
supabase_anon_key = os.environ.get('SUPABASE_ANON_KEY', '')
enabled = 'true' if supabase_url and supabase_anon_key else 'false'

config_content = f"""/**
 * config.js — Generado automáticamente por build.py
 * NO editar a mano en producción.
 */
export const CONFIG = {{
  supabase: {{
    url: '{supabase_url}',
    anonKey: '{supabase_anon_key}',
    enabled: {enabled}
  }}
}};
"""

with open('config.js', 'w', encoding='utf-8') as f:
    f.write(config_content)

status = 'ACTIVADO' if enabled == 'true' else 'DESACTIVADO (modo estático)'
print(f'✓ config.js generado — Supabase: {status}')
