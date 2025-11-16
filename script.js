document.addEventListener("DOMContentLoaded", function() {
    // Cargar datos guardados al inicio
    function cargarDatos() {
        let datos = localStorage.getItem('kotxeaDatos');
        if (datos) {
            datos = JSON.parse(datos);
            ['nerea', 'leire', 'naroa', 'gorka'].forEach(function(pertsona) {
                document.getElementById('bidaiak-' + pertsona).textContent = datos[pertsona].bidaiak.toFixed(2);
                document.getElementById('gidatu-' + pertsona).textContent = datos[pertsona].gidatu.toFixed(2);
                document.getElementById('emaitza-' + pertsona).textContent = datos[pertsona].emaitza.toFixed(2);
            });
        }
    }

    // Guardar datos en localStorage
    function guardarDatos() {
        let datos = {};
        ['nerea', 'leire', 'naroa', 'gorka'].forEach(function(pertsona) {
            datos[pertsona] = {
                bidaiak: parseFloat(document.getElementById('bidaiak-' + pertsona).textContent),
                gidatu: parseFloat(document.getElementById('gidatu-' + pertsona).textContent),
                emaitza: parseFloat(document.getElementById('emaitza-' + pertsona).textContent)
            };
        });
        localStorage.setItem('kotxeaDatos', JSON.stringify(datos));
    }

    // Cargar datos al inicio
    cargarDatos();

    document.getElementById('bidaiForm').addEventListener('submit', function(e) {
        e.preventDefault();

        let gidaria = document.getElementById('nor').value;
        let checkboxes = document.querySelectorAll('input[name="bidaiariak"]:checked');
        let bidaiariak = [];
        checkboxes.forEach(function(checkbox) {
            bidaiariak.push(checkbox.value);
        });

        let numBidaiariak = bidaiariak.length;
        if (numBidaiariak === 0) {
            alert("Debes seleccionar al menos un pasajero");
            return;
        }

        let porcentajePorPersona = 1 / numBidaiariak;

        let gidatuCell = document.getElementById('gidatu-' + gidaria);
        gidatuCell.textContent = (parseFloat(gidatuCell.textContent) + 1).toFixed(2);

        bidaiariak.forEach(function(bidaiaria) {
            let bidaiakCell = document.getElementById('bidaiak-' + bidaiaria);
            let valorActual = parseFloat(bidaiakCell.textContent);
            bidaiakCell.textContent = (valorActual + porcentajePorPersona).toFixed(2);
        });

        ['nerea', 'leire', 'naroa', 'gorka'].forEach(function(pertsona) {
            let bidaiak = parseFloat(document.getElementById('bidaiak-' + pertsona).textContent);
            let gidatu = parseFloat(document.getElementById('gidatu-' + pertsona).textContent);
            let emaitza = bidaiak - gidatu;
            document.getElementById('emaitza-' + pertsona).textContent = emaitza.toFixed(2);
        });

        guardarDatos();
        document.getElementById('bidaiForm').reset();
    });

    document.getElementById('resetBtn').addEventListener('click', function() {
        if (confirm('¿Seguro que quieres borrar todos los datos?')) {
            localStorage.removeItem('kotxeaDatos');
            ['nerea', 'leire', 'naroa', 'gorka'].forEach(function(pertsona) {
                document.getElementById('bidaiak-' + pertsona).textContent = '0';
                document.getElementById('gidatu-' + pertsona).textContent = '0';
                document.getElementById('emaitza-' + pertsona).textContent = '0';
            });
        }
    });
});
