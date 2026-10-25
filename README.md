# Cuaderno

Biblioteca estática de estudio para Netlify y GitHub Pages. Diseñada para alojar temarios, apuntes en PDF y cuestionarios de autoevaluación con corrección y explicaciones inmediatas, además de generación de nuevos tests con **Gemini API** y sincronización en **Supabase**.

---

## ⚡ Carga Diferida (Lazy Loading)

Para mantener una carga inicial ultra rápida (< 2 KB), el contenido se divide en:
- **`data/catalog.json`**: Metadatos ligeros de asignaturas, temarios y recuentos de preguntas. Es lo único que se descarga al abrir la web.
- **`temas/<asignatura>/<tema>.json`**: Cuestionarios detallados (preguntas, opciones y explicaciones). Se cargan bajo demanda (*lazy loading*) solo cuando el estudiante entra a resolver ese test en particular, guardándose en caché en memoria.

```text
data/
  catalog.json                     # Catálogo global y resúmenes de asignaturas
temas/
  geografia_fisica/
    tema1.pdf                      # PDF original del temario
    tema1.json                     # Batería de preguntas y explicaciones (carga diferida)
data-service.js                    # Capa de datos (Netlify / Supabase / Gemini AI)
app.js                             # Enrutador y lógica de la aplicación
build.py                           # Generador de config.js y sincronizador con Supabase
supabase-schema.sql                # Esquema SQL, políticas RLS y seed de datos para Supabase
```

---

## ✨ Generación de Tests con Gemini API + Supabase

Desde cualquier vista (**Inicio**, **Asignaturas**, **Temario** o **Tests**), puedes pulsar **"Generar test con IA"**:
1. Elige la **asignatura** y el **temario** sobre el que quieres practicar.
2. Elige **cuántas preguntas** quieres que tenga el test (de 1 a 30, con botones rápidos de 5, 10, 15 o 20 preguntas).
3. Opcionalmente indica un título o enfoque específico (por ejemplo, *"Preguntas difíciles sobre fechas y autores"*).
4. La aplicación envía el PDF del temario a **Gemini (`gemini-3.8-flash`)** mediante la **Interactions API** con salida estructurada JSON (`response_format`), crea el cuestionario y **lo sube automáticamente a las tablas `sections` y `questions` de Supabase**.

---

## 🚀 Despliegue en Netlify

1. Conecta tu repositorio de GitHub en [Netlify](https://www.netlify.com/).
2. Establece el **Build command** en `python3 build.py` y el **Publish directory** en `.` (directorio raíz).
3. Configura en **Site configuration > Environment variables**:
   - `SUPABASE_URL` → URL de tu proyecto en Supabase
   - `SUPABASE_ANON_KEY` → Clave pública `anon` de Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` → Clave `service_role` (solo usada en el build para sincronizar el catálogo estático sin exponerla al navegador)
   - `GEMINI_API_KEY` → Clave de API de Google Gemini (opcional; si no se define en variables de entorno, el usuario puede introducirla en el modal de la web)

---

## 🗄️ Configuración de Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. Entra al **SQL Editor** de Supabase y ejecuta el script [`supabase-schema.sql`](./supabase-schema.sql). Creará automáticamente las tablas (`subjects`, `topics`, `sections`, `questions`, `quiz_scores`, `student_profiles`), configurará las políticas RLS (incluyendo inserción para tests generados con IA) y cargará los datos iniciales.

---

## 💻 Desarrollo Local

Para probar la web en tu máquina:

```powershell
python -m http.server 8000
```

Abre [http://localhost:8000](http://localhost:8000) en tu navegador.
