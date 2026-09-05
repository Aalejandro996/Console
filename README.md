# Control de Alquiler de Consolas

App de una sola página (HTML/JS, sin backend) para gestionar el alquiler de consolas por hora.
Los datos (estaciones, tarifas, historial de pagos) se guardan en el navegador de cada
dispositivo mediante localStorage — no hay base de datos compartida entre dispositivos.

## Publicar en Render (sitio estático, gratis)

Render despliega sitios estáticos desde un repositorio de GitHub. Pasos:

1. Crea un repositorio nuevo en GitHub (puede ser privado o público).
2. Desde esta carpeta, en tu computadora, ejecuta:

   ```bash
   git init
   git add .
   git commit -m "Primera versión: control de alquiler de consolas"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```

3. Entra a https://dashboard.render.com → **New** → **Static Site**.
4. Conecta tu cuenta de GitHub y selecciona el repositorio que acabas de crear.
5. Configura:
   - **Build Command:** (déjalo vacío)
   - **Publish directory:** `.`
6. Haz clic en **Create Static Site**. Render te dará una URL tipo
   `https://tu-app.onrender.com` en un par de minutos.

Cada vez que hagas `git push` a `main`, Render vuelve a publicar automáticamente.
