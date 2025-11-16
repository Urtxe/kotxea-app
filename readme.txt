🚗 Calculadora "Kotxea" (Control de Viajes)

Esta es una sencilla pero potente aplicación web de una sola página (SPA) diseñada para llevar un control justo y equilibrado de los viajes en coche compartidos entre un grupo de amigos (Nerea, Leire, Naroa y Gorka).

El objetivo de la app es calcular un "balance" para que todos los miembros del grupo contribuyan de forma equitativa, ya sea conduciendo o siendo pasajero.

(Reemplaza este enlace con la captura de pantalla que subas a tu repositorio)

ℹ️ ¿Cómo Funciona? (La Lógica)

El "Emaitza" (Resultado) es la métrica clave. Se calcula con una fórmula simple:

Emaitza = (Total de Viajes) - (Total de Conducciones)

Gidaria (Conductor): Cuando una persona conduce, su puntuación de Gidatu (Conducido) suma +1.

Bidaiariak (Pasajeros): Cuando una persona viaja como pasajera, su puntuación de Bidaiak (Viajes) suma un porcentaje del viaje (1 / número total de pasajeros).

El Balance:

Un Emaitza positivo significa que has sido pasajero más veces de las que has conducido (te "toca" conducir).

Un Emaitza negativo significa que has conducido más veces de las que has sido pasajero (te "toca" ser pasajero).

El objetivo del grupo es mantener el Emaitza de todos los miembros lo más cercano a 0 posible.

✨ Características Principales

Cálculo de Balance Justo: Aplica una lógica de reparto proporcional para los pasajeros.

Persistencia de Datos: Utiliza localStorage para guardar el estado del contador. Aunque cierres el navegador, los datos no se pierden.

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

Toda la tabla volverá a 0 y se borrarán los datos guardados.

💻 Tecnologías Utilizadas

HTML5 (para la estructura semántica)

CSS3 (con variables CSS para la paleta de colores)

JavaScript (Vanilla JS) (para toda la lógica, el manejo de eventos y la interacción con localStorage)


Este software se distribuye bajo AGPLv3. Para usos comerciales, contactar al autor para obtener licencia.