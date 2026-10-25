# Cuaderno

Biblioteca estática de estudio para Netlify y GitHub Pages. Diseñada para alojar temarios, apuntes en PDF y cuestionarios de autoevaluación con corrección y explicaciones inmediatas.

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
data-service.js                    # Capa de datos (Netlify / Supabase)
app.js                             # Enrutador y lógica de la aplicación
supabase-schema.sql                # Esquema SQL y seed de datos para Supabase
```

---

## 🚀 Despliegue en Netlify

El proyecto es 100% estático y compatible con Netlify:
1. Conecta tu repositorio de GitHub en [Netlify](https://www.netlify.com/).
2. Deja el **Build command** vacío (no requiere compilación).
3. Establece el **Publish directory** en `.` (directorio raíz).
4. Netlify desplegará automáticamente los PDFs y los archivos JSON estáticos con cada `git push`.

---

## 🗄️ Integración con Supabase (Opcional)

Si en el futuro deseas utilizar una base de datos en PostgreSQL con Supabase en lugar de los archivos JSON estáticos:

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. Entra al **SQL Editor** de Supabase y ejecuta el script [supabase-schema.sql](file:///c:/Users/User/Desktop/adi/cosafri/supabase-schema.sql). Creará automáticamente las tablas (`subjects`, `topics`, `sections`, `questions`, `quiz_scores`, `student_profiles`), configurará las políticas RLS y cargará los datos iniciales.
3. Abre [data-service.js](file:///c:/Users/User/Desktop/adi/cosafri/data-service.js) y edita:
   ```javascript
   export const SUPABASE_CONFIG = {
     url: 'https://tu-proyecto.supabase.co',
     anonKey: 'tu-clave-anon-publica',
     enabled: true // Activa el modo Supabase
   };
   ```
4. ¡Listo! La web pasará a consultar Supabase en tiempo real sin requerir cambios en el diseño ni en la interfaz.

---

## 💻 Desarrollo Local

Para probar la web en tu máquina:

```powershell
python -m http.server 8000
```

Abre [http://localhost:8000](http://localhost:8000) en tu navegador.
