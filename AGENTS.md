# Kotxea — instrucciones de trabajo

## Principios generales

- Entiende el flujo existente y localiza la causa raíz antes de cambiar código. Inspecciona primero el archivo, ruta o llamador más cercano; amplía la búsqueda solo cuando haga falta.
- Elige la solución correcta más pequeña. Conserva patrones y helpers existentes; evita dependencias, abstracciones, limpiezas y cambios de comportamiento que no sean necesarios.
- Prioriza corrección sobre ingenio. Ten especial cuidado con autenticación, autorización, secretos, datos personales, migraciones, escrituras en Firestore, concurrencia y operaciones destructivas.
- Cambia solo los archivos necesarios. No reviertas cambios del usuario ni incluyas modificaciones ajenas al encargo.
- Para cambios normales, ejecuta el check focalizado que corresponda. No añadas suites ni ejecutes baterías amplias sin necesidad; las comprobaciones requeridas por el workflow de despliegue sí son obligatorias.
- Antes de terminar, revisa el diff, el estado de Git y los resultados de verificación. Explica qué cambió y qué quedó pendiente.
- No uses subagentes salvo que el usuario lo pida o que dividir el trabajo mejore claramente el resultado.

## Ramas y publicación

- `develop` es la rama de integración y desarrollo. `main` es producción.
- Crea cada rama de trabajo desde `origin/develop`: `feature/<tema>`, `fix/<tema>`, `docs/<tema>` o `chore/<tema>`.
- Integra las ramas de trabajo en `develop` después de las comprobaciones focalizadas. Pide aprobación antes de cada merge.
- Publica a producción solo cuando el usuario lo solicite y apruebe la integración de `develop` en `main`. Después de ese merge, sube `main`.
- El workflow de GitHub Actions se activa con `push` a `main` (y se puede iniciar manualmente). **No despliega al subir cambios a `develop`**.
- No publiques cambios directamente desde una rama de trabajo ni desde `develop` a Firebase de producción.

## Arquitectura de Kotxea

- Es una aplicación web estática/PWA. Firebase Authentication gestiona las cuentas; Cloud Firestore guarda grupos, miembros, personas, viajes, invitaciones y solicitudes.
- Firebase Hosting sirve la aplicación en `https://kotxea-urtxe.web.app`. GitHub Pages también se actualiza en el workflow como destino de respaldo.
- `firebase-config.js` contiene configuración web pública; no es un lugar para credenciales privadas. Los permisos de acceso los aplican Firebase Auth y `firestore.rules`.
- La fuente versionada de seguridad e índices es `firestore.rules` y `firestore.indexes.json`. No soluciones errores de permisos debilitando reglas sin verificar el flujo y el modelo de acceso.
- El proyecto de producción es `kotxea-urtxe`. No ejecutes pruebas contra ese proyecto: usa siempre el emulador con el ID de demostración `demo-kotxea`.

## Reglas específicas del dominio

- Una cuenta puede pertenecer a varios grupos. El rol de plataforma `superadmin` o `creator` permite crear grupos; los roles `owner` y `admin` gestionan un grupo. La membresía y los roles deben validarse también en las reglas, no solo ocultando controles de interfaz.
- Las solicitudes de acceso y la aceptación de invitaciones requieren correo verificado. Las invitaciones están vinculadas al correo destinatario.
- La creación de un grupo pasa por `initializing` y luego `active`. Si falla una importación parcial, conserva la opción de reanudarla y evita crear un grupo duplicado o descartar la copia local.
- La migración puede leer las claves locales `kotxeaEstado`, `kotxeaDatos` y `kotxeaHistoriala`. Valida los datos antes de guardarlos y conserva la copia de origen hasta que la importación termine correctamente.
- Cada registro sigue contando como un viaje/día completo; no separes ida y vuelta como viajes distintos. Respeta el cálculo de saldos iniciales y el historial al modificar el modelo.
- Mantén los textos y controles accesibles y sigue el idioma y estilo de la zona que estés modificando (la interfaz combina euskera y español).

## Firebase, secretos y despliegue

- Nunca guardes en Git, `AGENTS.md`, `firebase-config.js` o `.env` una clave privada de cuenta de servicio, token o secreto. `.gitignore` evita subir archivos locales, pero no entrega variables a GitHub Actions.
- El workflow lee el secreto de repositorio `FIREBASE_SERVICE_ACCOUNT_KOTXEA_URTXE`. El JSON de cuenta de servicio debe permanecer en GitHub Secrets; no lo solicites ni lo copies a la conversación.
- La cuenta de despliegue necesita permisos para Hosting, Firebase Rules, índices de Firestore, ver claves de API (`roles/serviceusage.apiKeysViewer`) y usar Service Usage (`roles/serviceusage.serviceUsageConsumer`). La credencial no debe tener más permisos de los necesarios.
- Los archivos públicos de Hosting se generan con `node scripts/prepare-hosting.js`; `public/` es salida generada y no se versiona.
- Antes de cualquier despliegue de producción, confirma autorización del usuario y valida el despliegue con Firebase CLI. El workflow de `main` ejecuta `npm test`, `npm run test:rules`, `firebase deploy --dry-run` y luego despliega Hosting, reglas e índices, seguido de GitHub Pages.
- Si un deploy falla, usa el error concreto de GitHub Actions/Firebase para diagnosticar. No concluyas que faltan reglas sin comprobarlo; Firebase puede rechazar por roles IAM, APIs o configuración del proyecto.
- `kotxea-urtxe.web.app` y el dominio de GitHub Pages deben estar autorizados en Firebase Authentication para permitir el inicio de sesión desde cada origen.

## Comprobaciones del proyecto

- `npm test`: pruebas de lógica y del flujo básico de autenticación/interfaz.
- `npm run test:rules`: inicia el emulador de Firestore con `firestore.rules` y comprueba permisos de creación de grupos.
- Si cambias reglas, autorización o escrituras de Firestore, amplía las pruebas del emulador para cubrir el comportamiento permitido y denegado.
- Si cambias los archivos del shell, actualiza el inventario de `scripts/prepare-hosting.js` y comprueba las referencias de versión/cache en `index.html` y `service-worker.js`.
- El workflow solo corre automáticamente en `main`; antes de integrar a `develop`, ejecuta localmente los checks focalizados necesarios.

\n