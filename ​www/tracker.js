// tracker.js - Samostatný skript pro správu GPS tras a aktivit

class GpsTracer {
    constructor(apiEndpoint = 'https://7x.wz.cz/tracer/api_activity.php') {
        this.apiEndpoint = apiEndpoint;
        this.currentActivityId = null;
        this.activityStartTime = null;
        this.totalDistanceMeters = 0;
        this.lastLat = null;
        this.lastLng = null;
        this.watchId = null;
        this.isPaused = false;
    }

    // Výpočet vzdálenosti mezi dvěma body v metrech (Haversine formula)
    _calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Poloměr Země v metrech
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    // 1. Spuštění nové aktivity (zavolá START na serveru)
    async start(activityType = 'bike') {
        const email = localStorage.getItem('tracer_email') || '';

        try {
            const response = await fetch(this.apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: 'start', email: email, activity_type: activityType })
            });
            const data = await response.json();

            if (data.status === 'success') {
                this.currentActivityId = data.activity_id;
                this.activityStartTime = new Date();
                this.totalDistanceMeters = 0;
                this.lastLat = null;
                this.lastLng = null;
                this.isPaused = false;
                console.log("Aktivita úspěšně odstartována, ID:", this.currentActivityId);
                return true;
            } else {
                console.error("Chyba při startu:", data.message);
                return false;
            }
        } catch (err) {
            console.error("Chyba připojení k serveru:", err);
            return false;
        }
    }

    // 2. Zpracování a odeslání bodu (volá se z pluginu / watchPosition)
    async handlePositionUpdate(lat, lng, speed = 0) {
        if (!this.currentActivityId || this.isPaused) return;

        // Přičtení vzdálenosti, pokud máme předchozí bod
        if (this.lastLat !== null && this.lastLng !== null) {
            const dist = this._calculateDistance(this.lastLat, this.lastLng, lat, lng);
            this.totalDistanceMeters += dist;
        }
        this.lastLat = lat;
        this.lastLng = lng;

        const email = localStorage.getItem('tracer_email') || '';

        // Odeslání bodu na server
        fetch(this.apiEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: 'point',
                email: email,
                activity_id: this.currentActivityId,
                lat: lat,
                lng: lng,
                speed: speed
            })
        }).catch(err => console.error("Chyba při odesílání bodu:", err));
    }

    // Pauza / Pokračování
    togglePause() {
        this.isPaused = !this.isPaused;
        return this.isPaused;
    }

    // 3. Ukončení aktivity (výpočet statistik a STOP na serveru)
    async stop() {
        if (!this.currentActivityId) return null;

        const durationSeconds = Math.floor((new Date() - this.activityStartTime) / 1000);
        const distanceKm = this.totalDistanceMeters / 1000;
        const durationHours = durationSeconds / 3600;
        const avgSpeedKmh = durationHours > 0 ? (distanceKm / durationHours) : 0;

        const email = localStorage.getItem('tracer_email') || '';
        const summary = {
            distance_meters: Math.round(this.totalDistanceMeters),
            duration_seconds: durationSeconds,
            avg_speed_kmh: parseFloat(avgSpeedKmh.toFixed(2))
        };

        try {
            const response = await fetch(this.apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: 'stop',
                    email: email,
                    activity_id: this.currentActivityId,
                    ...summary
                })
            });
            const data = await response.json();

            if (data.status === 'success') {
                console.log("Trasa úspěšně uložena.");
                this.currentActivityId = null;
                return summary;
            } else {
                console.error("Chyba při ukončování:", data.message);
                return null;
            }
        } catch (err) {
            console.error("Chyba připojení při ukončování:", err);
            return null;
        }
    }
}
