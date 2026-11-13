# Elitsano Horror Addon (Minecraft Bedrock 1.21.60 / 1.26.x)

## Cómo compilar en GitHub Actions
1. Sube todo el contenido de este ZIP (`.github`, `behavior_pack`, `resource_pack`) a la raíz de tu repositorio en GitHub.
2. Ve a la pestaña **Actions** en GitHub y ejecuta **Compilar Elitsano Addon (.mcaddon)** (o se ejecutará solo al hacer push).
3. Descarga el artefacto `Elitsano-Addon-Bedrock` y abre el archivo `.mcaddon` en Minecraft.
4. **Importante:** Al crear o editar tu mundo, activa las **API Beta (Beta APIs)** en la pestaña *Experimentos* para que funcione el motor de eventos del addon.

## Comandos de prueba rápida (Opcional)
Si quieres probar cada fase al instante sin esperar los días del juego, escribe en el chat (con trucos activados):
- `/scriptevent elitsano:next` -> Avanza inmediatamente a la siguiente fase del evento (Unión -> Golpes en puerta -> Acecho -> Ceguera/Persecución).
- `/scriptevent elitsano:reset` -> Reinicia la historia desde el inicio.
