// app.js - Propojení UI s tracker.js a Capacitor Background Geolocation

const tracer = new GpsTracer();
let watchWatcherId = null;

async function startTracking() {
    const activityType = document.getElementById('activityType').value;

    // Spuštění v trackeru (založí aktivitu v telefonu / na serveru)
    const success = await tracer.start(activityType);

    if (success) {
        document.getElementById('activityType').disabled = true;
        document.getElementById('status').innerText = "Sledování aktivní (běží na pozadí)...";
        document.getElementById('btnStart').style.display = "none";
        document.getElementById('btnStop').style.display = "block";

        // Spuštění nativního GPS sledování přes Capacitor
        if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
            const { BackgroundGeolocation } = window.Capacitor.Plugins;

            try {
                watchWatcherId = await BackgroundGeolocation.addWatcher({
                    backgroundMessage: "Zaznamenávám trasu na pozadí...",
                    backgroundTitle: "GPS Tracker v9",
                    requestPermissions: true,
                    stale: false,
                    distanceFilter: 15 // uložení bodu každých 15 metrů
                }, (location, error) => {
                    if (error) {
                        console.error("GPS chyba:", error);
                        return;
                    }
                    if (location) {
                        tracer.handlePositionUpdate(location.latitude, location.longitude, location.speed);
                        
                        document.getElementById('dist').innerText = (tracer.currentActivity.totalDistanceMeters / 1000).toFixed(2);
                        const speedKmh = location.speed ? (location.speed * 3.6) : 0;
                        document.getElementById('speed').innerText = speedKmh.toFixed(1);
                    }
                });
            } catch (err) {
                console.error("Chyba Background Geolocation:", err);
            }
        } else {
            console.log("Běží v klasickém prohlížeči bez Capacitor pluginu.");
        }
    }
}

async function stopTracking() {
    if (watchWatcherId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
        await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: watchWatcherId });
        watchWatcherId = null;
    }

    const stats = await tracer.stop();

    if (stats) {
        alert(`Aktivita úspěšně uložena!\nCelková délka: ${(stats.distance_meters / 1000).toFixed(2)} km\nČas: ${Math.floor(stats.duration_seconds / 60)} min`);
    } else {
        alert("Aktivita ukončena.");
    }

    // Reset UI
    document.getElementById('activityType').disabled = false;
    document.getElementById('status').innerText = "Připraven";
    document.getElementById('btnStart').style.display = "block";
    document.getElementById('btnStop').style.display = "none";
    document.getElementById('dist').innerText = "0";
    document.getElementById('speed').innerText = "0";
}
