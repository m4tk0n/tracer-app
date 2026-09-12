// tracker.js - Samostatná logika pro GPS, offline úložiště a synchronizaci (v9)

class GpsTracer {
    constructor(apiEndpoint = 'https://7x.wz.cz/tracer/api_activity.php') {
        this.apiEndpoint = apiEndpoint;
        this.currentActivity = null; // { id, type, startTime, points, distance, isOffline }
        this.lastLat = null;
        this.lastLng = null;
        this.isPaused = false;

        // Automatická kontrola a synchronizace při startu, pokud je internet
        window.addEventListener('online', () => this.syncOfflineData());
    }

    _calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }

    // Spuštění aktivity (funguje i offline)
    async start(activityType = 'bike') {
        const email = localStorage.getItem('tracer_email') || 'mobilni_uzivatel';
        const startTime = new Date().toISOString();
        
        // Vytvoříme lokální objekt aktivity
        this.currentActivity = {
            localId: 'act_' + Date.now(),
            serverActivityId: null,
            email: email,
            type: activityType,
            startTime: startTime,
            points: [],
            totalDistanceMeters: 0,
            status: 'active'
        };

        this.lastLat = null;
        this.lastLng = null;
        this.isPaused = false;

        // Pokus o okamžité založení na serveru
        try {
            const response = await fetch(this.apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: 'start', email: email, activity_type: activityType })
            });
            const data = await response.json();
            if (data.status === 'success') {
                this.currentActivity.serverActivityId = data.activity_id;
            }
        } catch (err) {
            console.warn("Server nedostupný (start offline):", err);
            this.currentActivity.isOffline = true;
        }

        this._saveToLocalStorage();
        return true;
    }

    // Zpracování bodu z GPS
    async handlePositionUpdate(lat, lng, speed = 0) {
        if (!this.currentActivity || this.isPaused) return;

        if (this.lastLat !== null && this.lastLng !== null) {
            const dist = this._calculateDistance(this.lastLat, this.lastLng, lat, lng);
            this.currentActivity.totalDistanceMeters += dist;
        }
        this.lastLat = lat;
        this.lastLng = lng;

        const pointData = { lat, lng, speed, time: new Date().toISOString() };
        this.currentActivity.points.push(pointData);
        this._saveToLocalStorage();

        // Pokus o odeslání bodu na server
        if (this.currentActivity.serverActivityId) {
            fetch(this.apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: 'point',
                    email: this.currentActivity.email,
                    activity_id: this.currentActivity.serverActivityId,
                    lat: lat,
                    lng: lng,
                    speed: speed
                })
            }).catch(() => { /* Ignorujeme výpadek sítě u bodu */ });
        }
    }

    // Ukončení aktivity
    async stop() {
        if (!this.currentActivity) return null;

        const endTime = new Date();
        const durationSeconds = Math.floor((endTime - new Date(this.currentActivity.startTime)) / 1000);
        const distanceKm = this.currentActivity.totalDistanceMeters / 1000;
        const durationHours = durationSeconds / 3600;
        const avgSpeedKmh = durationHours > 0 ? (distanceKm / durationHours) : 0;

        const summary = {
            distance_meters: Math.round(this.currentActivity.totalDistanceMeters),
            duration_seconds: durationSeconds,
            avg_speed_kmh: parseFloat(avgSpeedKmh.toFixed(2))
        };

        this.currentActivity.status = 'finished';
        this.currentActivity.summary = summary;
        this._saveToLocalStorage();

        // Pokus o finální odeslání na server
        let sentSuccessfully = false;
        if (this.currentActivity.serverActivityId) {
            sentSuccessfully = await this._sendStopToServer(summary);
        } else {
            // Pokud probíhal offline režim od začátku, uložíme do fronty k pozdější synchronizaci
            this._queueForSync();
        }

        const resultSummary = { ...summary };
        this.currentActivity = null;
        localStorage.removeItem('active_tracer_session');
        return resultSummary;
    }

    async _sendStopToServer(summary) {
        try {
            const response = await fetch(this.apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: 'stop',
                    email: this.currentActivity.email,
                    activity_id: this.currentActivity.serverActivityId,
                    ...summary
                })
            });
            const data = await response.json();
            return data.status === 'success';
        } catch (err) {
            this._queueForSync();
            return false;
        }
    }

    _saveToLocalStorage() {
        if (this.currentActivity) {
            localStorage.setItem('active_tracer_session', JSON.stringify(this.currentActivity));
        }
    }

    _queueForSync() {
        let queue = JSON.parse(localStorage.getItem('tracer_offline_queue') || '[]');
        queue.push(this.currentActivity);
        localStorage.setItem('tracer_offline_queue', JSON.stringify(queue));
    }

    // Synchronizace offline dat, jakmile se objeví internet
    async syncOfflineData() {
        let queue = JSON.parse(localStorage.getItem('tracer_offline_queue') || '[]');
        if (queue.length === 0) return;

        console.log("Probíhá synchronizace offline aktivit se serverem...");
        let remainingQueue = [];

        for (const act of queue) {
            try {
                // 1. Založení na serveru
                const startRes = await fetch(this.apiEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: 'start', email: act.email, activity_type: act.type })
                });
                const startData = await startRes.json();
                
                if (startData.status === 'success') {
                    const serverId = startData.activity_id;

                    // 2. Odeslání bodů
                    for (const pt of act.points) {
                        await fetch(this.apiEndpoint, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: 'point', email: act.email, activity_id: serverId, lat: pt.lat, lng: pt.lng, speed: pt.speed })
                        });
                    }

                    // 3. Uzavření
                    await fetch(this.apiEndpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: 'stop', email: act.email, activity_id: serverId, ...act.summary })
                    });
                } else {
                    remainingQueue.push(act);
                }
            } catch (err) {
                remainingQueue.push(act);
            }
        }

        localStorage.setItem('tracer_offline_queue', JSON.stringify(remainingQueue));
    }
}
