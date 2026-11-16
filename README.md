# Televisión Retro

Una tele de los 90 para los niños: cada serie es un canal. El capítulo sigue por donde se quedó,
se puede pausar y volver a empezar, pero no adelantar ni saltar al siguiente.

- `index.html`, `app.js`, `app.css`, `sw.js`: la app (se instala desde Chrome).
- `drive/Code.gs`: el script de Google Drive que entrega series, carátulas y vídeos solo con la clave.
- Los scripts de conversión (`convertir.ps1`, `procesar_descargas.ps1`) se guardan solo en el PC: llevan rutas privadas del NAS.

Estructura en Drive: `TelevisionRetro/<Serie>/Video/*.mp4`, `TelevisionRetro/<Serie>/Caratulas/NN.jpg`, `TelevisionRetro/<Serie>/serie.jpg`.
