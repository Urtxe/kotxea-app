# Kotxea

Aplicación web móvil para coordinar viajes compartidos al trabajo, repartir turnos de conducción y gestionar varios grupos con cuentas de Firebase. Cada registro sigue contando como un viaje/día completo, sin separar ida y vuelta.

## Arquitectura

- Firebase Hosting sirve la web estática. GitHub Pages permanece como destino de respaldo mientras se valida el cambio.
- Firebase Authentication gestiona las cuentas con Google o correo y contraseña.
- Cloud Firestore guarda cada grupo, sus personas, miembros, viajes, invitaciones y solicitudes.
- `firestore.rules` limita el acceso en Firebase; la interfaz por sí sola no concede permisos.
- Una Cloud Function protegida con Firebase Authentication permite al superadministrador consultar el listado completo de cuentas de Firebase Authentication.
- `manifest.json` y `service-worker.js` permiten instalar la web como PWA. Hace falta conexión para iniciar sesión y sincronizar los cambios.
- Las invitaciones generan un enlace para copiar y enviar manualmente. El proyecto no envía correos de invitación automáticamente.

El proyecto Firebase asociado es `kotxea-urtxe`. `.firebaserc` lo selecciona por defecto; los comandos de despliegue también indican el ID de forma explícita.

## Publicar la aplicación y las reglas de Firebase

El workflow de GitHub Actions publica juntos Firebase Hosting, las reglas e índices de Firestore y Cloud Functions cuando se actualiza `main`. Antes de desplegar, ejecuta las pruebas de la aplicación y una validación de Firebase CLI. También se puede iniciar manualmente desde la pestaña Actions.

Para habilitar el despliegue automático, crea una cuenta de servicio dedicada al despliegue en el proyecto `kotxea-urtxe` y guarda su JSON completo en GitHub → Settings → Secrets and variables → Actions, con el nombre `FIREBASE_SERVICE_ACCOUNT_KOTXEA_URTXE`. Además de Hosting, reglas e índices, la cuenta necesita `Cloud Functions Admin` (`roles/cloudfunctions.admin`) y `Service Account User` (`roles/iam.serviceAccountUser`) sobre la cuenta de ejecución `firebase-adminsdk-fbsvc@kotxea-urtxe.iam.gserviceaccount.com`. No pongas ese JSON en Git, en `firebase-config.js` ni en el código de la web.

Cloud Functions requiere que el proyecto Firebase use el plan Blaze con una cuenta de facturación vinculada. Las funciones `listAuthUsers`, `setPlatformUser` y `deletePlatformUser` verifican en el servidor el rol global. El borrado conserva grupos, viajes y balances, transfiere la propiedad de grupos activos cuando hay otro miembro y usa `deletedAccounts/{uid}` para invalidar sesiones antiguas. La limpieza de esa cuenta se puede reintentar sin quitar el tombstone. Configura alertas de presupuesto en Google Cloud antes de usar servicios de pago.

El primer despliegue manual también puede hacerse desde esta carpeta, con Firebase CLI instalado y una cuenta con acceso al proyecto:

```sh
firebase login
node scripts/prepare-hosting.js
firebase deploy --dry-run --only "hosting,firestore:rules,firestore:indexes,functions" --project kotxea-urtxe
firebase deploy --only "hosting,firestore:rules,firestore:indexes,functions" --project kotxea-urtxe
```

El sitio de Firebase Hosting `kotxea-urtxe` ya existe y está disponible en `https://kotxea-urtxe.web.app`. Comprueba que ese dominio figure en Firebase Authentication → Configuración → Dominios autorizados para permitir el inicio de sesión. El workflow conserva también la publicación en GitHub Pages mientras se valida Hosting; ambas URLs recibirán el mismo frontend y Firestore usará las mismas reglas.

Las reglas de Firestore no son credenciales secretas y pueden estar en el repositorio. Firebase las evalúa en el servidor para autorizar cada lectura y escritura. La cuenta de servicio del workflow sí es secreta: permite publicar cambios y debe quedarse en GitHub Secrets.

No subas claves de cuenta de servicio ni credenciales privadas al repositorio. `firebase-config.js` contiene la configuración web pública; los permisos los aplican Authentication y las reglas de Firestore.

## Alta inicial del superadministrador

El primer superadministrador se asigna manualmente para impedir que una cuenta nueva pueda concederse privilegios:

1. Abre Kotxea y registra/inicia sesión con la cuenta de Mikel.
2. En Firebase Console, abre el proyecto `kotxea-urtxe` → Firestore Database → Datos.
3. Crea la colección `platformRoles` y un documento cuyo ID sea el UID de Mikel. La app muestra el UID en la pantalla de grupos.
4. Añade el campo `role`, tipo `string`, valor `superadmin`.
5. Vuelve a Kotxea y pulsa **Actualizar permisos**.

La consola Firebase permite esta primera operación aunque las reglas de cliente solo permitan al superadministrador conceder el rol `creator`.

## Crear el grupo inicial y añadir a la familia

1. Registra la cuenta de Mikel y asigna su documento `platformRoles/{uid}` con `role: superadmin` en Firebase Console. Deja `canParticipate` sin marcar; así tendrá acceso global sin figurar como viajero.
2. Desde la cuenta de tu mujer, crea el grupo de la ruta Donostia–Mondragón. Ella quedará vinculada como participante y administradora del grupo. Marca **importar los datos de este dispositivo** solo si ese navegador contiene el historial que quieres conservar.
3. Puede crear una invitación para cada participante al configurar el grupo o desde su administración. Copia y comparte los enlaces; la otra persona debe registrarse con el correo destinatario y verificarlo antes de aceptar.
4. En **Admin**, Mikel puede conceder a una persona de confianza el rol de administrador global. Para que también participe en grupos, marca **Administratzaile global honek taldeetan parte har dezake**.
5. Cualquier cuenta con correo verificado puede crear un grupo. Los viajeros también pueden buscar un grupo público y pedir acceso; un administrador del grupo o el superadministrador acepta la solicitud y la vincula a una persona existente o crea una nueva.

Una misma cuenta puede ser miembro de varios grupos. El superadministrador puede ver y administrar todos los grupos desde la sección **Admin**.

## Permisos dentro de un grupo

- Cualquier miembro puede registrar viajes y modificar o borrar los que ha creado.
- Un administrador del grupo puede editar cualquier viaje, gestionar miembros, solicitudes, invitaciones, personas y saldos; también puede importar o reiniciar el grupo.
- El superadministrador puede entrar en cualquier grupo y realizar sus operaciones de administración.
- Las solicitudes requieren correo verificado. Las invitaciones están vinculadas al correo indicado y caducan a los siete días.
- Los datos de la primera instalación se copian a Firestore; el historial local original permanece en el navegador de origen.

## Instalación en móvil

En Android/Chrome, usa el botón **Instalar** cuando aparezca. En iPhone/iPad, abre el menú **Compartir** de Safari y pulsa **Añadir a pantalla de inicio**. Para iniciar sesión por primera vez o guardar viajes se necesita conexión.
