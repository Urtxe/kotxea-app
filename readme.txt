🚗 Calculadora "Kotxea" (Control de Viajes)

Esta es una sencilla pero potente aplicación web de una sola página (SPA) diseñada para llevar un control justo y equilibrado de los viajes en coche compartidos entre un grupo de amigos (Nerea, Leire, Naroa y Gorka).

El objetivo de la app es calcular un "balance" para que todos los miembros del grupo contribuyan de forma equitativa, ya sea conduciendo o siendo pasajero.

La interfaz comparte cuatro secciones en móvil y escritorio: Laburpena,
Bidaia, Historiala y Taldea. El resumen muestra saldos con signo, color y
explicación, y contadores desplegables. Las cuatro personas iniciales siguen
siendo Nerea, Leire, Naroa y Gorka.

ℹ️ ¿Cómo Funciona? (La Lógica)

El "Emaitza" (Resultado) es la métrica clave. Se calcula con una fórmula simple:

Emaitza = (Total de Conducciones) - (Suma de cuotas de participación)

Gidaria (Conductor): Cuando una persona conduce, su puntuación de Gidatu (Conducido) suma +1.

Bidaiak (Viajes): cuenta viajes completos, incluido el conductor. Para calcular
el balance cada participante acumula una cuota de 1 / número de ocupantes.
Kotxea BAI cuenta conducciones y Kotxea EZ cuenta viajes sin conducir.

El Balance:

Un Emaitza positivo significa que has conducido más de tu cuota proporcional.

Un Emaitza negativo significa que has conducido menos de tu cuota proporcional.
Ejemplo: en un viaje de cuatro personas el conductor obtiene +0,75 y cada una
de las otras tres personas obtiene -0,25. Es la fórmula original de la app;
se ha corregido la explicación, no el criterio de reparto.

El objetivo del grupo es mantener el Emaitza de todos los miembros lo más cercano a 0 posible.

✨ Características Principales

Cálculo de Balance Justo: Aplica una lógica de reparto proporcional para los pasajeros.

Persistencia de Datos: guarda personas e historial en un único registro local
versionado y calcula los contadores a partir de los viajes. No hay servidor
ni sincronización entre dispositivos. Al borrar los datos del navegador se
pierden los registros, por lo que conviene exportar copias JSON regularmente.

Formulario Simple: Permite añadir nuevos viajes de forma rápida seleccionando al conductor y los pasajeros.

Reinicio: En Taldea, despliega «Bidaiak eta balantzeak berrezarri» para borrar los viajes y balances con confirmación, manteniendo las personas.

Interfaz digital: Paneles oscuros con relieve, fondo espacial y acentos magenta y verde, con la misma navegación en móvil y escritorio.

🚀 Cómo Usar

Añadir un Viaje:

Selecciona quién ha sido el conductor en el menú Nor da gidaria?.

Marca las casillas de todas las personas que viajaron en el coche (incluyendo al conductor).

Pulsa Bidai berria gehitu.

El resumen se actualizará automáticamente con los nuevos cálculos.

Resetear el Conteo:

En Taldea, despliega «Bidaiak eta balantzeak berrezarri» y pulsa «Bidaiak eta balantzeak ezabatu».

Confirma la acción en la ventana emergente.

Todos los balances volverán a 0 y se borrará el historial, manteniendo las personas.

Personas y conductores:

- Usa «Pertsona gehitu» en Taldea. La nueva persona aparece también
  en «Nor da gidaria?» y «Nortzuk joan dira?» del formulario BIDAI BERRIA.
- Quitar una persona sin viajes la elimina. Si tiene viajes o saldo anterior,
  queda inactiva: se conserva su balance e historial y se puede reactivar
  desde Taldea, pero deja de aparecer al registrar viajes nuevos.
- «Hasierako lau pertsonak gehitu / aktibatu» recupera el grupo inicial sin
  borrar viajes ni otras personas.

Historial y copias de seguridad:

- Se pueden editar y eliminar viajes; el resumen se recalcula al guardarlos.
- Se permiten fechas pasadas y futuras al crear y editar viajes. Los viajes
  futuros cuentan en el balance desde que se registran. El filtro inicial
  muestra los últimos 30 días y los viajes futuros; el historial completo
  permite consultar también los anteriores. La fecha inicial es el día local.
- En Taldea → «Segurtasun-kopiak» puedes exportar JSON e importar una copia. Importar
  sustituye los datos tras validarlos y pedir confirmación.
- La actualización conserva las claves antiguas como copia de recuperación.
  Si existen totales anteriores al historial, se conservan como saldo inicial
  de migración; no se inventan viajes para reconstruirlos.
- Ante datos dañados, la app avisa y bloquea cambios para evitar sobrescribirlos.
  Puedes descargar los datos originales antes de importar una copia o reiniciar.

💻 Tecnologías Utilizadas

HTML5 (para la estructura semántica)

CSS3 (con variables CSS para la paleta de colores)

JavaScript (Vanilla JS) (para toda la lógica, el manejo de eventos y la interacción con localStorage)

Comprobaciones (Node.js, sin dependencias):

    node --check script.js
    node --test logic.test.js

Comprobación del flujo de fechas en navegador (sin instalar dependencias en el proyecto):
En una terminal, inicia la vista local:

    python -m http.server 8765 --bind 127.0.0.1

En otra terminal, desde la raíz del proyecto:

    npx --yes --package @playwright/cli playwright-cli -s=kotxea-check open http://127.0.0.1:8765
    npx --yes --package @playwright/cli playwright-cli -s=kotxea-check run-code --filename=checks/trip-flow.js
    npx --yes --package @playwright/cli playwright-cli -s=kotxea-check close

La comprobación fija el día en 25/10/2026 y verifica altas consecutivas,
edición a una fecha posterior, validación, historial y persistencia al recargar.
Restaura los datos locales del navegador de prueba al finalizar.


Este software se distribuye bajo AGPLv3. Para usos comerciales, contactar al autor para obtener licencia.
