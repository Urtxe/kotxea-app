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

- Es una aplicación web estática/PWA. Firebase Authentication gestiona las cuentas; Cloud Firestore guarda grupos, miembros, personas, viajes, invitaciones, solicitudes y el último pulso de presencia en `userPresence/{uid}`.
- Firebase Hosting sirve la aplicación en `https://kotxea-urtxe.web.app`. GitHub Pages también se actualiza en el workflow como destino de respaldo.
- `firebase-config.js` contiene configuración web pública; no es un lugar para credenciales privadas. Los permisos de acceso los aplican Firebase Auth y `firestore.rules`.
- La fuente versionada de seguridad e índices es `firestore.rules` y `firestore.indexes.json`. No soluciones errores de permisos debilitando reglas sin verificar el flujo y el modelo de acceso.
- El proyecto de producción es `kotxea-urtxe`. No ejecutes pruebas contra ese proyecto: usa siempre el emulador con el ID de demostración `demo-kotxea`.

## Reglas específicas del dominio

- Una cuenta verificada puede crear grupos y queda vinculada como participante y administradora del grupo. La cuenta global `superadmin` solo participa en grupos si su documento `platformRoles/{uid}` tiene `canParticipate: true`; la cuenta inicial de Mikel no debe participar. El superadministrador ve todos los grupos y usuarios; puede conceder ese rol a otras cuentas.
- Los usuarios normales no necesitan un rol de plataforma `creator`: cualquier cuenta con correo verificado puede crear grupos. El único rol especial de plataforma es `superadmin`.
- `functions/listAuthUsers` usa Firebase Admin SDK y debe comprobar el rol global en el servidor antes de devolver cuentas de Authentication. `functions/setPlatformUser` y `functions/deletePlatformUser` también validan el rol en el servidor. No muevas estas operaciones privilegiadas al navegador ni debilites las reglas de Firestore.
- La presencia se registra desde la sesión autenticada con `serverTimestamp` aproximadamente una vez por minuto. Solo el propio usuario puede escribir su documento; solo superadministradores pueden listar la colección. La interfaz considera en línea un pulso de menos de dos minutos y deja de actualizarlo cuando la página está oculta.
- Al borrar una cuenta, conserva grupos, viajes, personas y balances. Transfiere la propiedad de grupos activos a otro miembro cuando sea posible; no borres cuentas que sean el único miembro de un grupo ni dejen incompleta una importación. Desvincula `linkedUid` y elimina membresías y referencias personales.
- `deletedAccounts/{uid}` es un tombstone permanente que invalida tokens antiguos en `firestore.rules` y evita restaurar roles o membresías. Créalo antes de limpiar una cuenta y nunca lo elimines durante reintentos.
- Una cuenta puede pertenecer a varios grupos; los roles `owner` y `admin` gestionan un grupo. La membresía y los roles deben validarse también en las reglas, no solo ocultando controles de interfaz.
- Las solicitudes de acceso y la aceptación de invitaciones requieren correo verificado. Las invitaciones están vinculadas al correo destinatario.
- El alta manual de viajeros y la restauración de las cuatro personas locales no se muestran en la interfaz. Para invitar a un viajero nuevo, nombre y correo crean su ficha y la invitación en una operación atómica; también se puede vincular una ficha importada sin perder su historial o saldo. La cuenta se vincula al aceptar la invitación.
- La creación de un grupo pasa por `initializing` y luego `active`. Si falla una importación parcial, conserva la opción de reanudarla y evita crear un grupo duplicado o descartar la copia local.
- Los nombres de grupo son únicos tras normalizar mayúsculas, Unicode y espacios. `prepareGroupName` reserva el nombre en `groupNames` antes de crear; `renameGroup` valida permisos y actualiza grupo, directorio, membresías e invitaciones. Las reservas sin grupo caducan a los quince minutos; las reglas impiden crear sin reserva o renombrar directamente.
- Quitar una persona revoca su pertenencia y acceso; una ficha con historial se conserva internamente con `removed: true` para mantener viajes y balances, sin ofrecer reactivación en la interfaz. El traspaso de administración se valida en el servidor.
- La migración puede leer las claves locales `kotxeaEstado`, `kotxeaDatos` y `kotxeaHistoriala`. Valida los datos antes de guardarlos y conserva la copia de origen hasta que la importación termine correctamente.
- Cada registro sigue contando como un viaje/día completo; no separes ida y vuelta como viajes distintos. Respeta el cálculo de saldos iniciales y el historial al modificar el modelo.
- Mantén los textos y controles accesibles y sigue el idioma y estilo de la zona que estés modificando (la interfaz combina euskera y español).

## Firebase, secretos y despliegue

- Nunca guardes en Git, `AGENTS.md`, `firebase-config.js` o `.env` una clave privada de cuenta de servicio, token o secreto. `.gitignore` evita subir archivos locales, pero no entrega variables a GitHub Actions.
- El workflow lee el secreto de repositorio `FIREBASE_SERVICE_ACCOUNT_KOTXEA_URTXE`. El JSON de cuenta de servicio debe permanecer en GitHub Secrets; no lo solicites ni lo copies a la conversación.
- La cuenta de despliegue necesita permisos para Hosting, Firebase Rules, índices de Firestore, ver claves de API (`roles/serviceusage.apiKeysViewer`) y usar Service Usage (`roles/serviceusage.serviceUsageConsumer`). La credencial no debe tener más permisos de los necesarios.
- Desplegar Cloud Functions requiere plan Blaze y añadir a la cuenta de despliegue `roles/cloudfunctions.admin` y `roles/iam.serviceAccountUser` sobre la cuenta de ejecución `firebase-adminsdk-fbsvc@kotxea-urtxe.iam.gserviceaccount.com`; valida los permisos con un dry-run antes de publicar.
- Los archivos públicos de Hosting se generan con `node scripts/prepare-hosting.js`; `public/` es salida generada y no se versiona.
- Antes de cualquier despliegue de producción, confirma autorización del usuario y valida el despliegue con Firebase CLI. El workflow de `main` ejecuta `npm test`, `npm run test:rules`, comprueba el código de Functions, prepara Hosting, valida con `firebase deploy --dry-run` y despliega Hosting, reglas, índices y Functions, seguido de GitHub Pages.
- Si un deploy falla, usa el error concreto de GitHub Actions/Firebase para diagnosticar. No concluyas que faltan reglas sin comprobarlo; Firebase puede rechazar por roles IAM, APIs o configuración del proyecto.
- `kotxea-urtxe.web.app` y el dominio de GitHub Pages deben estar autorizados en Firebase Authentication para permitir el inicio de sesión desde cada origen.

## Comprobaciones del proyecto

- `npm test`: pruebas de lógica y del flujo básico de autenticación/interfaz.
- `npm run test:rules`: inicia el emulador de Firestore con `firestore.rules` y comprueba permisos de creación de grupos.
- `npm run test:functions`: inicia los emuladores de Firestore y Authentication para probar edición, permisos y borrado seguro de cuentas.
- Si cambias reglas, autorización o escrituras de Firestore, amplía las pruebas del emulador para cubrir el comportamiento permitido y denegado.
- Si cambias los archivos del shell, actualiza el inventario de `scripts/prepare-hosting.js` y comprueba las referencias de versión/cache en `index.html` y `service-worker.js`.
- El workflow solo corre automáticamente en `main`; antes de integrar a `develop`, ejecuta localmente los checks focalizados necesarios.
