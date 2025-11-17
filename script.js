document.addEventListener("DOMContentLoaded", function() {
    
    // --- LABURPEN-TAULAREN FUNTZIOAK ---

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

    // --- HISTORIALAREN FUNTZIOAK ---

    // (MODIFIKATUA: ID bakarra gehitzen dio bidaia bakoitzari)
    function guardarBidaiaHistorialean(data, gidaria, bidaiariak) {
        let historiala = JSON.parse(localStorage.getItem('kotxeaHistoriala')) || [];
        
        let bidaiaBerria = {
            id: new Date().getTime(), // ID bakarra sortzeko
            data: data, 
            gidaria: gidaria,
            bidaiariak: bidaiariak
        };
        
        historiala.push(bidaiaBerria);
        localStorage.setItem('kotxeaHistoriala', JSON.stringify(historiala));
    }

    // (MODIFIKATUA: Ezabatzeko botoia sortzen du)
    function kargatuHistoriala() {
        let historiala = JSON.parse(localStorage.getItem('kotxeaHistoriala')) || [];
        let taulaBody = document.getElementById('historialaBody');
        let epea = document.getElementById('historialEpea').value;

        taulaBody.innerHTML = ''; 

        let historialaFiltratua = historiala;
        if (epea === '30') {
            let mugaData = new Date();
            mugaData.setDate(mugaData.getDate() - 30);
            mugaData.setHours(0, 0, 0, 0);
            
            historialaFiltratua = historiala.filter(function(bidaia) {
                let bidaiaDataObj = new Date(bidaia.data + "T00:00:00"); 
                return bidaiaDataObj >= mugaData;
            });
        }

        historialaFiltratua.reverse().forEach(function(bidaia) {
            let row = taulaBody.insertRow();
            
            let dataCell = row.insertCell(0);
            let dataObj = new Date(bidaia.data + "T00:00:00"); 
            dataCell.textContent = dataObj.toLocaleString('es-ES', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit'
            });

            let gidariaCell = row.insertCell(1);
            gidariaCell.textContent = bidaia.gidaria.charAt(0).toUpperCase() + bidaia.gidaria.slice(1);

            let bidaiariakCell = row.insertCell(2);
            
            // --- ALDAKETA HEMEN: Bidaiarien izenak maiuskulaz jarri ---
            let bidaiariakMayuscula = bidaia.bidaiariak.map(function(izena) {
                return izena.charAt(0).toUpperCase() + izena.slice(1);
            });
            bidaiariakCell.textContent = bidaiariakMayuscula.join(', ');
            // ---------------------------------------------------------

            // --- Ezabatzeko botoia gehitu ---
            let ezabatuCell = row.insertCell(3);
            let ezabatuBtn = document.createElement('button');
            ezabatuBtn.textContent = 'Ezabatu';
            ezabatuBtn.dataset.id = bidaia.id; // ID-a botoiari lotu
            ezabatuBtn.addEventListener('click', ezabatuBidaia); // Listener-a gehitu
            ezabatuCell.appendChild(ezabatuBtn);
            // ------------------------------------------------
        });
    }

    // --- FUNTZIO BERRIA: Bidaia bat ezabatzeko ---
    function ezabatuBidaia(event) {
        let bidaiaId = Number(event.target.dataset.id); // Botoian gordetako ID-a lortu

        if (!confirm('Ziur zaude bidaia hau ezabatu nahi duzula? Ekintza honek emaitzak birkalkulatuko ditu.')) {
            return; 
        }

        // 1. Historiala eta bidaia lortu
        let historiala = JSON.parse(localStorage.getItem('kotxeaHistoriala')) || [];
        let bidaiaEzabatzeko = historiala.find(b => b.id === bidaiaId);

        if (!bidaiaEzabatzeko) {
            console.error('Ezin izan da bidaia aurkitu ezabatzeko.');
            return;
        }

        // 2. Kalkuluak desegin (DOM-ean zuzenean)
        let gidaria = bidaiaEzabatzeko.gidaria;
        let bidaiariak = bidaiaEzabatzeko.bidaiariak;
        let porcentajePorPersona = 1 / bidaiariak.length;

        // 2a. Gidariari 'gidatu' bat kendu
        let gidatuCell = document.getElementById('gidatu-' + gidaria);
        gidatuCell.textContent = (parseFloat(gidatuCell.textContent) - 1).toFixed(2);

        // 2b. Bidaiari bakoitzari bere portzentaia kendu
        bidaiariak.forEach(function(bidaiaria) {
            let bidaiakCell = document.getElementById('bidaiak-' + bidaiaria);
            bidaiakCell.textContent = (parseFloat(bidaiakCell.textContent) - porcentajePorPersona).toFixed(2);
        });

        // 3. Emaitzak birkalkulatu (DOM-ean)
        ['nerea', 'leire', 'naroa', 'gorka'].forEach(function(pertsona) {
            let bidaiak = parseFloat(document.getElementById('bidaiak-' + pertsona).textContent);
            let gidatu = parseFloat(document.getElementById('gidatu-' + pertsona).textContent);
            
            // --- ALDAKETA HEMEN: Kalkulua alderantziz ---
            let emaitza = gidatu - bidaiak;
            // ------------------------------------------
            
            document.getElementById('emaitza-' + pertsona).textContent = emaitza.toFixed(2);
        });

        // 4. Laburpen eguneratua gorde (DOM-etik irakurriz)
        guardarDatos();

        // 5. Bidaia historialetik kendu eta gorde
        let historialaBerria = historiala.filter(b => b.id !== bidaiaId);
        localStorage.setItem('kotxeaHistoriala', JSON.stringify(historialaBerria));

        // 6. Historialaren taula berritu (pantailan)
        kargatuHistoriala();
    }


    // --- FUNTZIO LAGUNGARRIAK ---

    // --- ALDAKETA HEMEN: Gidaria desgaituta uzteko ---
    function markatuHasierakoGidaria() {
        // Lehenik, denak gaitu eta desmarkatu
        document.querySelectorAll('input[name="bidaiariak"]').forEach(function(checkbox) {
            checkbox.disabled = false;
            // checkbox.checked = false; // Beharrezkoa bada, baina reset-ak egiten du
        });

        let hasierakoGidaria = document.getElementById('nor').value;
        if(hasierakoGidaria) {
            let checkbox = document.getElementById(hasierakoGidaria);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.disabled = true; // Gidaria desgaituta utzi
            }
        }
    }
    // ------------------------------------------------

    function dataHasieratu() {
        document.getElementById('bidaiaData').valueAsDate = new Date();
    }

    // --- ORRIA KARGATZEAN EGIN BEHARREKOAK ---

    cargarDatos();
    kargatuHistoriala();
    markatuHasierakoGidaria(); 
    dataHasieratu();           


    // --- LISTENER-AK (EVENTOS) ---

    // --- ALDAKETA HEMEN: Gidaria aldatzean desgaitzeko ---
    document.getElementById('nor').addEventListener('change', function() {
        let allCheckboxes = document.querySelectorAll('input[name="bidaiariak"]');
        allCheckboxes.forEach(function(checkbox) {
            checkbox.checked = false;
            checkbox.disabled = false; // Gaitu guztiak lehenik
        });

        let gidariaId = this.value; 
        let checkboxGidaria = document.getElementById(gidariaId);
        if (checkboxGidaria) {
            checkboxGidaria.checked = true;
            checkboxGidaria.disabled = true; // Desgaitu gidari berria
        }
    });
    // ----------------------------------------------------

    // Historialaren filtroa
    document.getElementById('historialEpea').addEventListener('change', kargatuHistoriala);


    // Formularioa bidaltzekoa
    document.getElementById('bidaiForm').addEventListener('submit', function(e) {
        e.preventDefault();

        let bidaiaData = document.getElementById('bidaiaData').value;
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
        
        if (!bidaiaData) {
            alert("Bidaiaren eguna hautatu behar duzu");
            return;
        }

        // --- Laburpena eguneratu ---
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
            
            // --- ALDAKETA HEMEN: Kalkulua alderantziz ---
            let emaitza = gidatu - bidaiak;
            // ------------------------------------------

            document.getElementById('emaitza-' + pertsona).textContent = emaitza.toFixed(2);
        });

        guardarDatos(); 

        // Historiala gorde
        guardarBidaiaHistorialean(bidaiaData, gidaria, bidaiariak);
        
        kargatuHistoriala();

        // Formularioa garbitu
        document.getElementById('bidaiForm').reset();
        dataHasieratu();
        markatuHasierakoGidaria(); // Honek gidaria berriro blokeatuko du
    });

    // Reset botoia
    document.getElementById('resetBtn').addEventListener('click', function() {
        if (confirm('¿Seguro que quieres borrar TODOS los datos (resumen e historial)?')) {
            localStorage.removeItem('kotxeaDatos');
            ['nerea', 'leire', 'naroa', 'gorka'].forEach(function(pertsona) {
                document.getElementById('bidaiak-' + pertsona).textContent = '0';
                document.getElementById('gidatu-' + pertsona).textContent = '0';
                document.getElementById('emaitza-' + pertsona).textContent = '0';
            });

            localStorage.removeItem('kotxeaHistoriala');
            kargatuHistoriala(); 
            markatuHasierakoGidaria(); // Berrezarri ondoren gidaria blokeatu
        }
    });
});
