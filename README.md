# Cuaderno

Biblioteca estática de estudio para Netlify. La web no permite subir PDFs: asignaturas, temarios y cuestionarios se publican como archivos del repositorio.

## Estructura del contenido

```text
temas/
  geografia_fisica/
    tema1.pdf
study-data.js
```

- `temas/` guarda los PDFs originales y mantiene la separación por asignatura.
- `study-data.js` define las asignaturas, los temarios que se muestran y los cuestionarios. Las preguntas, respuestas y explicaciones están escritas a partir de los apuntes.
- `app.js` presenta la biblioteca, abre los PDFs y permite resolver los tests.

Para añadir otra asignatura, crea su carpeta dentro de `temas/`, añade los PDF al repositorio e incorpora sus metadatos y preguntas a `study-data.js`.

## Desarrollo local

Desde la carpeta del proyecto, ejecuta:

```powershell
python -m http.server 8000
```

Abre [http://localhost:8000](http://localhost:8000). El mismo contenido funciona como sitio estático en Netlify.
