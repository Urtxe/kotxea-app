document.addEventListener("DOMContentLoaded", function() {
    
    // Datuak gordetzeko objektu nagusia
    let datuak = {};
    const PERTSONAK = ['nerea', 'leire', 'naroa', 'gorka'];

    // --- DATU NAGUSIAK KUDEATZEKO FUNTZIOAK ---

    // Datuen objektua hasieratzen du, dena 0-ra jarriz
    function initDatuak() {
        datuak = {};
        PERTSONAK.forEach(function(p) {
            datuak[p] = {
                gidatu: 0,                // Kotxea Eraman (Zenbaki osoa)
                bidaiak_guztira: 0,       // Bidaiak Guztira (Zenbaki osoa)
                bidaiak_portzentaia: 0,   // Balantzea kalkulatzeko (Hamartarrak)
                emaitza: 0                // Balantzea (Hamartarrak)
            };
        });
    }

    // Taula nagusia (DOM) eguneratzen du 'datuak' objektuan oinarrituta
    function eguneratuTaulaNagusia() {
        PERTSONAK.forEach(function(p) {
            let passengerCount = datuak[p].bidaiak_guztira - datuak[p].gidatu;

            // HAMARTARREN ZUZENKETA: .toFixed(2) bakarrik emaitzan.
            // Besteak zenbaki osoak dira.
// --- ALDAKETA: Emaitza hamartar gabe erakutsi, osoa bada ---
            
            // 1. Lehenik, biribildu 2 hamartarretara (float erroreak kentzeko, adib: 1.999... -> "2.00")
            let emaitzaStr = datuak[p].emaitza.toFixed(2);
            
            // 2. Bihurtu berriro zenbaki (float) batera ("2.00" -> 2, "1.50" -> 1.5, "1.33" -> 1.33)
            let emaitzaFloat = parseFloat(emaitzaStr);
            
            // 3. Ezarri testua. toString() automatikoki kudeatuko du: 
            //    2 -> "2"
            //    1.5 -> "1.5"
            document.getElementById('emaitza-' + p).textContent = emaitzaFloat.toString();
            // --------------------------------------------------------------------


            document.getElementById('bidaiak-guztira-' + p).textContent = datuak[p].bidaiak_guztira;
            document.getElementById('gidatu-' + p).textContent = datuak[p].gidatu;
            document.getElementById('passenger-' + p).textContent = passengerCount;
        });
    }

    // Datuak LocalStorage-tik kargatzen ditu 'datuak' objektura
    function cargarDatos() {
        let gordetakoDatuak = localStorage.getItem('kotxeaDatos');
        if (gordetakoDatuak) {
            datuak = JSON.parse(gordetakoDatuak);
            // Ziurtatu datu zaharrek egitura berria dutela
            let beharrezkoGakoak = ['gidatu', 'bidaiak_guztira', 'bidaiak_portzentaia', 'emaitza'];
            let datuakOsatuta = false;
            PERTSONAK.forEach(p => {
                beharrezkoGakoak.forEach(key => {
                    if (datuak[p][key] === undefined) {
                        datuak[p][key] = 0; // Gakoa falta bada, gehitu
                        datuakOsatuta = true;
                    }
                });
            });
            if (datuakOsatuta) {
                console.warn("Datu-egitura eguneratu da. Datuak berridatzi egingo dira.");
                guardarDatos(); // Gorde egitura zuzendua
            }
        } else {
            initDatuak();
        }
        eguneratuTaulaNagusia();
    }

    // 'datuak' objektua LocalStorage-n gordetzen du
    function guardarDatos() {
        localStorage.setItem('kotxeaDatos', JSON.stringify(datuak));
    }

    // Pertsona guztien emaitza (balantzea) birkalkulatzen du
    function birkalkulatuEmaitzak() {
        PERTSONAK.forEach(function(p) {
            // Hau da zure jatorrizko logika balantzea kalkulatzeko
            datuak[p].emaitza = datuak[p].gidatu - datuak[p].bidaiak_portzentaia;
        });
    }

    // --- HISTORIALAREN FUNTZIOAK ---

    function guardarBidaiaHistorialean(data, gidaria, bidaiariak) {
        let historiala = JSON.parse(localStorage.getItem('kotxeaHistoriala')) || [];
        let bidaiaBerria = {
            id: new Date().getTime(),
            data: data, 
            gidaria: gidaria,
            bidaiariak: bidaiariak
        };
        historiala.push(bidaiaBerria);
        localStorage.setItem('kotxeaHistoriala', JSON.stringify(historiala));
    }

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
                year: 'numeric', month: '2-digit', day: '2-digit'
            });

            let gidariaCell = row.insertCell(1);
            gidariaCell.textContent = bidaia.gidaria.charAt(0).toUpperCase() + bidaia.gidaria.slice(1);

            let bidaiariakCell = row.insertCell(2);
            let bidaiariakMayuscula = bidaia.bidaiariak.map(function(izena) {
                return izena.charAt(0).toUpperCase() + izena.slice(1);
            });
            bidaiariakCell.textContent = bidaiariakMayuscula.join(', ');

            let ezabatuCell = row.insertCell(3);
            let ezabatuBtn = document.createElement('button');
            ezabatuBtn.textContent = 'Ezabatu';
            ezabatuBtn.dataset.id = bidaia.id;
            ezabatuBtn.addEventListener('click', ezabatuBidaia);
            ezabatuCell.appendChild(ezabatuBtn);
        });
    }

    function ezabatuBidaia(event) {
        let bidaiaId = Number(event.target.dataset.id);

        if (!confirm('Ziur zaude bidaia hau ezabatu nahi duzula? Ekintza honek emaitzak birkalkulatuko ditu.')) {
            return; 
        }

        let historiala = JSON.parse(localStorage.getItem('kotxeaHistoriala')) || [];
        let bidaiaEzabatzeko = historiala.find(b => b.id === bidaiaId);

        if (!bidaiaEzabatzeko) {
            console.error('Ezin izan da bidaia aurkitu ezabatzeko.');
            return;
        }

        // 1. Kalkuluak desegin 'datuak' objektuan
        let gidaria = bidaiaEzabatzeko.gidaria;
        let bidaiariak = bidaiaEzabatzeko.bidaiariak;
        let porcentajePorPersona = 1 / bidaiariak.length;

        // 1a. Gidariari 'gidatu' bat kendu
        datuak[gidaria].gidatu -= 1;

        // 1b. Bidaiari bakoitzari bere datuak kendu
        bidaiariak.forEach(function(bidaiaria) {
            datuak[bidaiaria].bidaiak_guztira -= 1;
            datuak[bidaiaria].bidaiak_portzentaia -= porcentajePorPersona;
        });

        // 2. Emaitzak birkalkulatu
        birkalkulatuEmaitzak();

        // 3. Laburpen eguneratua gorde (LocalStorage)
        guardarDatos();

        // 4. Taula nagusia berritu (DOM)
        eguneratuTaulaNagusia();

        // 5. Bidaia historialetik kendu eta gorde
        let historialaBerria = historiala.filter(b => b.id !== bidaiaId);
        localStorage.setItem('kotxeaHistoriala', JSON.stringify(historialaBerria));

        // 6. Historialaren taula berritu (pantailan)
        kargatuHistoriala();
    }


    // --- FUNTZIO LAGUNGARRIAK ---

    function markatuHasierakoGidaria() {
        document.querySelectorAll('input[name="bidaiariak"]').forEach(function(checkbox) {
            checkbox.disabled = false;
        });
        let hasierakoGidaria = document.getElementById('nor').value;
        if(hasierakoGidaria) {
            let checkbox = document.getElementById(hasierakoGidaria);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.disabled = true;
            }
        }
    }

    function dataHasieratu() {
        document.getElementById('bidaiaData').valueAsDate = new Date();
    }

    // --- ORRIA KARGATZEAN EGIN BEHARREKOAK ---

    cargarDatos(); // Honek 'datuak' bete eta 'eguneratuTaulaNagusia' deitzen du
    kargatuHistoriala();
    markatuHasierakoGidaria(); 
    dataHasieratu();           

    // --- LISTENER-AK (EVENTOS) ---

    document.getElementById('nor').addEventListener('change', function() {
        let allCheckboxes = document.querySelectorAll('input[name="bidaiariak"]');
        allCheckboxes.forEach(function(checkbox) {
            checkbox.checked = false;
            checkbox.disabled = false;
        });
        let gidariaId = this.value; 
        let checkboxGidaria = document.getElementById(gidariaId);
        if (checkboxGidaria) {
            checkboxGidaria.checked = true;
            checkboxGidaria.disabled = true;
        }
    });

    document.getElementById('historialEpea').addEventListener('change', kargatuHistoriala);

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

        // --- 1. Datuak eguneratu 'datuak' objektuan ---
        let porcentajePorPersona = 1 / numBidaiariak;

        // Gidariaren datuak
        datuak[gidaria].gidatu += 1;

        // Bidaiari guztien datuak (gidaria barne)
        bidaiariak.forEach(function(bidaiaria) {
            datuak[bidaiaria].bidaiak_guztira += 1;
            datuak[bidaiaria].bidaiak_portzentaia += porcentajePorPersona;
        });

        // --- 2. Emaitzak birkalkulatu ---
        birkalkulatuEmaitzak();

        // --- 3. Datuak gorde (LocalStorage) ---
        guardarDatos(); 

        // --- 4. Taula nagusia berritu (DOM) ---
        eguneratuTaulaNagusia();

        // --- 5. Historiala gorde eta berritu ---
        guardarBidaiaHistorialean(bidaiaData, gidaria, bidaiariak);
        kargatuHistoriala();

        // --- 6. Formularioa garbitu ---
        document.getElementById('bidaiForm').reset();
        dataHasieratu();
        markatuHasierakoGidaria();
    });

    document.getElementById('resetBtn').addEventListener('click', function() {
        if (confirm('¿Seguro que quieres borrar TODOS los datos (resumen e historial)?')) {
            // 1. Datuen objektua hasieratu
            initDatuak();
            
            // 2. Datuak gorde (hutsik)
            guardarDatos();
            
            // 3. Taula nagusia berritu
            eguneratuTaulaNagusia();
            
            // 4. Historiala ezabatu
            localStorage.removeItem('kotxeaHistoriala');
            kargatuHistoriala(); 
            
            // 5. Formularioa prest utzi
            markatuHasierakoGidaria();
        }
    });
});