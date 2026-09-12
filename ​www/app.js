// app.js - Propojení UI, tlačtek a GpsTraceru

const tracer = new GpsTracer(); // Využívá váš již vytvořený tracker.js
let watchWatcherId = null;

// Funkce volaná po kliknutí na Start
async function startTracking() {
    const activityTypeSelect = document.getElementById('activityType');
    const type = activityTypeSelect ? activityTypeSelect.value : 'bike';

    // 1. Spuštění aktivity na serveru přes tracker.js
    const success = await tracer.start(type);

    if (success) {
        document.getElementById('status').innerText = "Sledování aktivní (běží na pozadí)...";
        document.getElementById('btnStart').style.display = "none";
        document.getElementById('btnStop').style.display = "block";

        // 2. Spuštění nativního sledování přes Capacitor Background Geolocation
        if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
            const { BackgroundGeolocation } = window.Capacitor.Plugins;

            try {
                watchWatcherId = await BackgroundGeolocation.addWatcher({
                    backgroundMessage: "Aplikace zaznamenává vaši trasu na pozadí.",
                    backgroundTitle: "GPS Tracker je aktivní",
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: 15 // uložení bodu každých 15 metrů
                }, (location, error) => {
                    if (error) {
                        console.error("Chyba GPS:", error);
                        return;
                    }

                    if (location) {
                        // Předání bodu do našeho tracker.js (který ho pošle na PHP server)
                        tracer.handlePositionUpdate(location.latitude, location.longitude, location.speed);
                        
                        // Aktualizace obrazovky
                        document.getElementById('dist').innerText = (tracer.totalDistanceMeters / 1000).toFixed(2);
                        const speedKmh = location.speed ? (location.speed * 3.6) : 0;
                        document.getElementById('speed').innerText = speedKmh.toFixed(1);
                    }
                });
            } catch (err) {
                console.error("Nepodařilo se spustit Background Geolocation:", err);
                alert("Chyba při spouštění GPS na pozadí: " + err.message);
            }
        } else {
            alert("Capacitor Background Geolocation plugin není dostupný (testujete v prohlížeči?).");
        }
    } else {
        alert("Nepodařilo se založit aktivitu na serveru.");
    }
}

// Funkce volaná po kliknutí na Stop
async function stopTracking() {
    // Zastavení GPS watcheru v Capacitoru
    if (watchWatcherId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
        await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: watchWatcherId });
        watchWatcherId = null;
    }

    // Ukončení aktivity přes tracker.js (odešle finální data na server)
    const stats = await tracer.stop();
    
    if (stats) {
        alert(`Aktivita uložena!\nCelková délka: ${(stats.distance_meters / 1000).toFixed(2)} km\nČas: ${Math.floor(stats.duration_seconds / 60)} min`);
    } else {
        alert("Trasa byla ukončena, ale nepodařilo se ji uložit na server.");
    }

    // Vrácení UI do původního stavu
    document.getElementById('status').innerText = "Připraven";
    document.getElementById('btnStart').style.display = "block";
    document.getElementById('btnStop').style.display = "none";
    document.getElementById('dist').innerText = "0";
    document.getElementById('speed').innerText = "0";
}
