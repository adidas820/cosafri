# Cuaderno

Biblioteca de estudio y autoevaluación diseñada para **Netlify** y respaldada por **Supabase** y **Google Gemini API (`gemini-3.8-flash`)**. Permite consultar apuntes en PDF, realizar tests interactivos con corrección explicada al instante, generar nuevos cuestionarios con IA a partir de los PDFs del temario y repasar fallos sincronizados entre todos tus dispositivos.

---

## ✨ Características Principales

- **📚 Biblioteca y Visor de Apuntes**: Organización por asignaturas y temas con lectura directa de los documentos PDF del curso.
- **🤖 Generador de Tests con Gemini AI (`gemini-3.8-flash`)**:
  - Selecciona asignatura, temario, número de preguntas (1–30) y un enfoque opcional.
  - Envía el PDF del tema a la **Interactions API** de Gemini con salida estructurada (`response_format` JSON Schema).
  - Se ejecuta de forma segura a través de una **Netlify Serverless Function** (`netlify/functions/generate-quiz.mjs`) para mantener `GEMINI_API_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ocultas en el servidor.
  - Sube automáticamente el nuevo cuestionario a las tablas `sections` y `questions` de Supabase (y migra automáticamente cualquier test que se hubiera generado antes en `localStorage`).
- **🎯 Modo «Repasar mis fallos» (Multi-dispositivo)**:
  - Registra automáticamente en la tabla `student_mistakes` de Supabase las preguntas que fallas en cualquier test.
  - Permite lanzar un test especial con tus preguntas pendientes (global o filtrado por asignatura).
  - Cuando aciertas una pregunta en el modo de repaso, se elimina automáticamente de tu lista de fallos pendientes.
- **🔐 Cuenta y Sincronización en Varios Dispositivos (Supabase Auth)**:
  - Inicio de sesión con **Email + Contraseña** (para entrar en PC, móvil o tablet tantas veces como quieras) o mediante **enlace único por correo (Magic Link)**.
  - Sincroniza tu nombre de perfil (`student_profiles`), historial de calificaciones (`quiz_scores`) y preguntas falladas (`student_mistakes`) con políticas **Row Level Security (RLS)** por usuario (`auth.uid()`).
- **⚡ Carga Diferida (Lazy Loading) y Respaldo Estático**:
  - Si Supabase no está activo, funciona en modo 100 % estático cargando primero `data/catalog.json` (< 2 KB) y descargando `temas/<asignatura>/<tema>.json` bajo demanda.

---

## 🗂️ Estructura del Proyecto

```text
data/
  catalog.json                     # Catálogo ligero de asignaturas y temas
img/
  icon.jpg                         # Icono / favicon de la aplicación
netlify/
  functions/
    generate-quiz.mjs              # Serverless Function (Gemini API + subida a Supabase)
temas/
  geografia_fisica/
    tema1.pdf                      # PDF original del temario
    tema1.json                     # Batería de preguntas estáticas (carga diferida)
  historia_arte/
    tema1.pdf
    tema1.json
app.js                             # Enrutador SPA, vistas, autenticación y lógica de UI
data-service.js                    # Capa de datos (Supabase REST/Auth, Gemini AI y caché local)
styles.css                         # Estilos Gruvbox (modo oscuro y modo claro)
index.html                         # Estructura principal y modales (Perfil y Generador IA)
build.py                           # Genera config.js y sincroniza el catálogo con Supabase
netlify.toml                       # Configuración de build, funciones y escáner de secretos
supabase-schema.sql                # Esquema SQL completo, políticas RLS y datos iniciales
```

---

## 🚀 Despliegue en Netlify

El archivo [`netlify.toml`](./netlify.toml) ya incluye toda la configuración necesaria (`command = "python3 build.py"`, `publish = "."`, `functions = "netlify/functions"` y `SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL,SUPABASE_ANON_KEY"`).

1. Conecta tu repositorio de GitHub en [Netlify](https://www.netlify.com/).
2. En **Site configuration > Environment variables**, define las siguientes variables:
   - `SUPABASE_URL` → URL de tu proyecto en Supabase (`https://tuproyecto.supabase.co`).
   - `SUPABASE_ANON_KEY` → Clave pública `anon` de Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY` → Clave secreta `service_role` de Supabase (usada únicamente en servidor por `build.py` y la Netlify Function).
   - `GEMINI_API_KEY` → Clave de API de Google Gemini (usada en el servidor por la Netlify Function sin exponerla al navegador).

> **Nota sobre `build.py`**: En cada despliegue, `build.py` asigna UUIDs deterministas (`uuid5`) a las preguntas del catálogo estático para no romper las claves foráneas de `student_mistakes` y limpia automáticamente posibles preguntas duplicadas antiguas.

---

## 🗄️ Configuración de Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. Abre **SQL Editor**, pega el contenido de [`supabase-schema.sql`](./supabase-schema.sql) y pulsa **Run**.
   - Creará las tablas `subjects`, `topics`, `sections`, `questions`, `quiz_scores`, `student_profiles` y `student_mistakes` con sus políticas RLS de forma idempotente (`drop policy if exists`).
3. Para el inicio de sesión por correo, ve a **Authentication > URL Configuration**:
   - En **Site URL**, pon la dirección de tu web en Netlify (ej. `https://tu-sitio.netlify.app`).
   - En **Redirect URLs**, añade `https://tu-sitio.netlify.app/*`.

---

## 💻 Desarrollo Local

Para probar la aplicación en local:

```powershell
python build.py
python -m http.server 8000
```

Abre [http://localhost:8000](http://localhost:8000) en tu navegador.
