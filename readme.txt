🚗 Calculadora "Kotxea" (Control de Viajes)

Esta es una sencilla pero potente aplicación web de una sola página (SPA) diseñada para llevar un control justo y equilibrado de los viajes en coche compartidos entre un grupo de amigos (Nerea, Leire, Naroa y Gorka).

El objetivo de la app es calcular un "balance" para que todos los miembros del grupo contribuyan de forma equitativa, ya sea conduciendo o siendo pasajero.

La pantalla conserva la tabla y el formulario originales. Las cuatro personas
iniciales siguen siendo Nerea, Leire, Naroa y Gorka.

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

Botón de Reseteo: Incluye una función para borrar todos los datos (con confirmación) y empezar el conteo de cero.

Interfaz Limpia: Utiliza una paleta de colores corporativa (basada en Laboral Kutxa) para una visualización clara de los datos.

🚀 Cómo Usar

Añadir un Viaje:

Selecciona quién ha sido el conductor en el menú Nor da gidaria?.

Marca las casillas de todas las personas que viajaron en el coche (incluyendo al conductor).

Pulsa Bidai berria gehitu.

La tabla se actualizará automáticamente con los nuevos cálculos.

Resetear el Conteo:

Pulsa el botón Reset.

Confirma la acción en la ventana emergente.

Toda la tabla volverá a 0 y se borrará el historial, manteniendo las personas.

Personas y conductores:

- Usa «Pertsona gehitu» debajo de la tabla. La nueva persona aparece también
  en «Nor da gidaria?» y «Nortzuk joan dira?» del formulario BIDAI BERRIA.
- Quitar una persona sin viajes la elimina. Si tiene viajes o saldo anterior,
  queda inactiva: se conserva su balance e historial y se puede reactivar
  desde su fila, pero deja de aparecer al registrar viajes nuevos.
- «Hasierako lau pertsonak gehitu / aktibatu» recupera el grupo inicial sin
  borrar viajes ni otras personas.

Historial y copias de seguridad:

- Se pueden editar y eliminar viajes; el resumen se recalcula al guardarlos.
- El filtro de 30 días excluye fechas futuras. Los viajes nuevos no permiten
  fechas futuras; las fechas se inicializan con el día local del dispositivo.
- En «Segurtasun-kopiak» puedes exportar JSON e importar una copia. Importar
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


Este software se distribuye bajo AGPLv3. Para usos comerciales, contactar al autor para obtener licencia.
