# Cuaderno

Una pequeña aplicación de estudio en español que prepara preguntas a partir de los PDFs de clase. Los PDF colocados en `temas/` se detectan al abrir la aplicación; por ejemplo, `temas/tema1.pdf`.

## Cómo abrirla

La aplicación no necesita instalar dependencias ni configurar un servidor de datos. Para que el navegador pueda cargar el lector de PDF, abre una terminal en esta carpeta y ejecuta:

```powershell
python -m http.server 8000
```

Después visita [http://localhost:8000](http://localhost:8000). También puedes usar cualquier servidor estático local.

## Uso

1. Coloca los PDF de clase en la carpeta `temas/` o pulsa **Añadir temario** para seleccionarlos.
2. En **Tests**, elige un test rápido, un repaso de diez preguntas o el simulacro completo.
3. Abre **Ver temario** para leer el texto extraído y buscar dentro de los apuntes.
4. También puedes abrir una materia para repasar con tarjetas. Marca **La sabía** para registrar progreso o **Repasar otra vez** para volver a ella en otra sesión.

Las preguntas se construyen con las definiciones y frases extraídas directamente del texto del documento. No se envían los apuntes a un servidor. El texto extraído y el progreso se guardan en el almacenamiento local de este navegador. Si limpias sus datos, se borrará la biblioteca.

## Límites

- El navegador necesita conexión a internet para cargar PDF.js desde jsDelivr la primera vez.
- Solo se pueden procesar PDFs con texto seleccionable. Los escaneos requieren OCR, que todavía no está incluido.
- La generación de preguntas usa reglas locales; puede funcionar mejor con temarios con texto limpio y definiciones explícitas.
