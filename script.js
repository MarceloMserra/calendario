const CONFIG = {
    firstFatherFriday: new Date('2026-01-23T12:00:00'), // Friday before Jan 24th weekend
    year: 2026
};

const OWNER = {
    FATHER: 'father',
    MOTHER: 'mother'
};

const EVENTS = {
    HOLIDAY: 'Feriado (Emenda)',
    WEEKEND: 'Fim de Semana',
    SPECIAL: 'Data Especial',
    VACATION: 'Férias',
    MANUAL: 'Manual (Admin)'
};

// HOLIDAYS 2026 (Balanced by Days Off)
const HOLIDAYS = [
    { name: 'Carnaval (5 dias)', date: '2026-02-17', owner: OWNER.FATHER },
    { name: 'Sexta-feira Santa', date: '2026-04-03', owner: OWNER.MOTHER },
    { name: 'Tiradentes (4 dias)', date: '2026-04-21', owner: OWNER.MOTHER },
    { name: 'Dia do Trabalho (3 dias)', date: '2026-05-01', owner: OWNER.FATHER },
    { name: 'Corpus Christi (4 dias)', date: '2026-06-04', owner: OWNER.MOTHER },
    { name: 'Independência (3 dias)', date: '2026-09-07', owner: OWNER.FATHER },
    { name: 'N. Sra. Aparecida (3 dias)', date: '2026-10-12', owner: OWNER.MOTHER },
    { name: 'Finados (3 dias)', date: '2026-11-02', owner: OWNER.FATHER }
];

const FIXED_SPECIALS = [
    // Hidden Birthdays (labeled as normal weekends)
    { name: 'Fim de Semana', day: 18, month: 6, owner: OWNER.MOTHER }, // July 18
    { name: 'Fim de Semana', day: 7, month: 7, owner: OWNER.FATHER },  // Aug 07
    { name: 'Fim de Semana', day: 27, month: 10, owner: OWNER.MOTHER } // Nov 27 (Month 10 is Nov because 0-indexed)
];

class CalendarApp {
    constructor() {
        this.currentDate = new Date(2026, 0, 15);
        this.schedule = new Map();
        this.stats = { father: 0, mother: 0 };

        // Admin Mode State
        // Check for "admin" parameter in URL (e.g., ?admin=true)
        const urlParams = new URLSearchParams(window.location.search);
        this.isAdminAccess = urlParams.has('admin');
        this.adminMode = false;

        // Data Storage
        this.overrides = {}; // Replaces manualOverrides & serverOverrides

        // Wait for Firebase before Init
        if (window.db) {
            this.init();
        } else {
            window.addEventListener('firebase-ready', () => this.init());
        }

    }

    init() {
        this.setupEventListeners();
        this.initFirebaseSync(); // Start Realtime Listeners
    }

    initFirebaseSync() {
        // Document Reference: collection "calendario", document "visitas"
        const docRef = window.doc(window.db, "calendario", "visitas");

        // Listen for realtime updates
        window.onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                console.log("Dados recebidos do servidor:", docSnap.data());
                this.overrides = docSnap.data();
            } else {
                console.log("Nenhum dado encontrado, criando...");
                this.overrides = {};
            }

            // Regenerate everything whenever data changes
            this.generateSchedule();
            this.renderCalendar();
            this.renderUpcomingEvents();
            this.updateDashboard();
        });
    }

    setDay(dateStr, owner, type, name, priority) {
        if (this.schedule.has(dateStr)) {
            const current = this.schedule.get(dateStr);
            if (current.priority > priority) return;
        }
        this.schedule.set(dateStr, { owner, type, name, priority });
    }

    generateSchedule() {
        this.schedule.clear(); // Reset schedule for fresh generation
        const startYear = new Date(2026, 0, 1);
        const endYear = new Date(2027, 0, 10);

        // 1. PLACE PRIORITY EVENTS (Holidays/Specials)
        this.placePriorityEvents();

        // 2. COLLECT FRIDAYS
        let cursor = new Date(startYear);
        while (cursor.getDay() !== 5) cursor.setDate(cursor.getDate() + 1);

        const fridays = [];
        while (cursor < endYear) {
            fridays.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 7);
        }

        // 3. BUILD STATE
        const weekendState = [];

        fridays.forEach(dFri => {
            const sFri = this.formatDate(dFri);
            // Check Priority overrides
            const dSat = new Date(dFri); dSat.setDate(dSat.getDate() + 1);
            const dSun = new Date(dFri); dSun.setDate(dFri.getDate() + 2);

            const pFri = this.schedule.get(sFri);
            const pSat = this.schedule.get(this.formatDate(dSat));
            const pSun = this.schedule.get(this.formatDate(dSun));

            let forced = null;
            if (pFri && pFri.priority > 1) forced = pFri.owner;
            else if (pSat && pSat.priority > 1) forced = pSat.owner;
            else if (pSun && pSun.priority > 1) forced = pSun.owner;

            weekendState.push({
                date: dFri,
                forced: forced,
                finalOwner: null
            });
        });

        // 4. RESOLVE SEQUENCE (Jan 23 ref)
        const refIndex = weekendState.findIndex(w => this.formatDate(w.date) === '2026-01-23');

        if (refIndex !== -1) {
            weekendState[refIndex].finalOwner = OWNER.FATHER;

            // Forward
            for (let i = refIndex + 1; i < weekendState.length; i++) {
                const prev = weekendState[i - 1].finalOwner;
                const currForced = weekendState[i].forced;
                if (currForced) weekendState[i].finalOwner = currForced;
                else weekendState[i].finalOwner = (prev === OWNER.FATHER) ? OWNER.MOTHER : OWNER.FATHER;
            }

            // Backward
            for (let i = refIndex - 1; i >= 0; i--) {
                const next = weekendState[i + 1].finalOwner;
                const currForced = weekendState[i].forced;
                if (currForced) weekendState[i].finalOwner = currForced;
                else weekendState[i].finalOwner = (next === OWNER.FATHER) ? OWNER.MOTHER : OWNER.FATHER;
            }
        }

        // 5. SMOOTHING (No Double Father)
        for (let i = 0; i < weekendState.length - 1; i++) {
            const curr = weekendState[i];
            const next = weekendState[i + 1];

            if (curr.finalOwner === OWNER.FATHER && next.finalOwner === OWNER.FATHER) {
                if (!curr.forced) curr.finalOwner = OWNER.MOTHER;
            }
        }

        // 6. COMMIT
        weekendState.forEach(w => {
            const dFri = w.date;
            const dSat = new Date(dFri); dSat.setDate(dSat.getDate() + 1);
            const dSun = new Date(dFri); dSun.setDate(dFri.getDate() + 2);

            const owner = w.finalOwner;
            this.ensureDay(this.formatDate(dFri), owner, EVENTS.WEEKEND, 'Fim de Semana', 1);
            this.ensureDay(this.formatDate(dSat), owner, EVENTS.WEEKEND, 'Fim de Semana', 1);
            this.ensureDay(this.formatDate(dSun), owner, EVENTS.WEEKEND, 'Fim de Semana', 1);
        });

        // 7. APPLY FIREBASE OVERRIDES (Highest Priority)
        // This replaces the old "Manual + Server" logic. Now everything comes from `this.overrides` (Firebase)
        Object.keys(this.overrides).forEach(dateStr => {
            const owner = this.overrides[dateStr];

            if (this.schedule.has(dateStr)) {
                // If day exists, just override the OWNER
                const current = this.schedule.get(dateStr);
                current.owner = owner;
            } else {
                // Edge case: Create if doesn't exist
                this.setDay(dateStr, owner, EVENTS.MANUAL, 'Ajuste Manual', 10);
            }
        });

        this.calculateStats();
    }

    fillRange(startStr, endStr, owner, name, priority) {
        let curr = new Date(startStr + 'T12:00:00');
        let end = new Date(endStr + 'T12:00:00');
        while (curr <= end) {
            this.setDay(this.formatDate(curr), owner, EVENTS.SPECIAL, name, priority);
            curr.setDate(curr.getDate() + 1);
        }
    }

    fillRangeDateObj(start, end, owner, name, priority) {
        let curr = new Date(start);
        while (curr <= end) {
            this.setDay(this.formatDate(curr), owner, EVENTS.SPECIAL, name, priority);
            curr.setDate(curr.getDate() + 1);
        }
    }

    ensureDay(dateStr, owner, type, name, priority) {
        if (!this.schedule.has(dateStr)) {
            this.setDay(dateStr, owner, type, name, priority);
        } else {
            const curr = this.schedule.get(dateStr);
            if (curr.priority < priority) {
                this.setDay(dateStr, owner, type, name, priority);
            }
        }
    }

    placePriorityEvents() {
        // Holidays
        HOLIDAYS.forEach(h => {
            const d = new Date(h.date + 'T12:00:00');
            const dayOfWeek = d.getDay();

            let startDate = new Date(d);
            let endDate = new Date(d);

            // Emenda Logic
            if (dayOfWeek === 1) startDate.setDate(d.getDate() - 2);
            if (dayOfWeek === 2) startDate.setDate(d.getDate() - 3);
            if (dayOfWeek === 4) endDate.setDate(d.getDate() + 3);
            if (dayOfWeek === 5) endDate.setDate(d.getDate() + 2);
            if (dayOfWeek === 0) startDate.setDate(d.getDate() - 2);

            // Atomic
            if (startDate.getDay() === 6) startDate.setDate(startDate.getDate() - 1);
            if (startDate.getDay() === 0) startDate.setDate(startDate.getDate() - 2);

            if (endDate.getDay() === 6) endDate.setDate(endDate.getDate() + 1);
            if (endDate.getDay() === 5) endDate.setDate(endDate.getDate() + 2);

            this.fillRangeDateObj(startDate, endDate, h.owner, h.name, 3);
        });

        // Fixed Blocks
        this.fillRange('2026-12-21', '2026-12-27', OWNER.MOTHER, 'Natal (Semana)', 4);
        this.fillRange('2026-12-28', '2027-01-03', OWNER.FATHER, 'Ano Novo (Semana)', 4);

        // Fixed Specials
        FIXED_SPECIALS.forEach(s => {
            const d = new Date(CONFIG.year, s.month, s.day);
            this.setDay(this.formatDate(d), s.owner, EVENTS.SPECIAL, s.name, 4);
        });

        this.setDay('2026-05-10', OWNER.MOTHER, EVENTS.SPECIAL, 'Dia das Mães', 4);
        this.setDay('2026-08-09', OWNER.FATHER, EVENTS.SPECIAL, 'Dia dos Pais', 4);
    }

    calculateStats() {
        this.stats = { father: 0, mother: 0 };
        for (const [dateStr, info] of this.schedule) {
            // Only count 2026
            if (dateStr.startsWith('2026')) {
                if (info.owner === OWNER.FATHER) this.stats.father++;
                if (info.owner === OWNER.MOTHER) this.stats.mother++;
            }
        }
    }

    formatDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    setupEventListeners() {
        document.getElementById('prev-month').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            this.renderCalendar();
        });
        document.getElementById('next-month').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            this.renderCalendar();
        });

        // Admin Toggle
        const toggleBtn = document.getElementById('admin-toggle');

        // Hide by default Logic
        if (toggleBtn) {
            if (!this.isAdminAccess) {
                toggleBtn.style.display = 'none';
            } else {
                toggleBtn.style.display = 'inline-block'; // or block
            }

            toggleBtn.addEventListener('click', () => {
                this.adminMode = !this.adminMode;
                if (this.adminMode) {
                    toggleBtn.classList.add('admin-active');
                    toggleBtn.textContent = '🔓 Edição Ativada (Clique nos dias)';
                    document.body.classList.add('admin-mode');
                } else {
                    toggleBtn.classList.remove('admin-active');
                    toggleBtn.textContent = '🔒 Habilitar Edição Manual';
                    document.body.classList.remove('admin-mode');
                }
                this.renderCalendar();
            });
        }
    }

    async toggleDayOwner(dateStr) {
        if (!this.overrides) this.overrides = {};

        // Current Override
        const currentOverride = this.overrides[dateStr];
        let newOverride = null;

        // Cycle Strategy
        if (!currentOverride) { newOverride = OWNER.FATHER; }
        else if (currentOverride === OWNER.FATHER) { newOverride = OWNER.MOTHER; }
        else if (currentOverride === OWNER.MOTHER) { newOverride = null; } // Clear

        try {
            const docRef = window.doc(window.db, "calendario", "visitas");

            // We read, modify, and write back the full object to ensure clean state
            // In a more complex app, we'd use dot notation or transactions, but 
            // since we are mapping the whole object in memory anyway, let's keep it simple.

            // Construct the update payload
            // Firestore "merge: true" allows us to just update specific keys (dates)
            // But to "delete" a key, we need special syntax or just rewrite the object.

            if (newOverride) {
                // If adding/updating a date override
                await window.setDoc(docRef, { [dateStr]: newOverride }, { merge: true });
            } else {
                // If REMOVING an override (setting to null in our logic)
                // We must use the FieldValue.delete() equivalent, BUT simpler path here:
                // Since this.overrides is the source of truth from the snapshot,
                // let's grab the current full object, delete the key locally, and save the WHOLE thing.
                // It's less efficient but foolproof for this scale.

                const fullCopy = { ...this.overrides };
                delete fullCopy[dateStr];
                await window.setDoc(docRef, fullCopy); // No merge: true means REPLACE the doc.
            }

            console.log("Salvo no Firebase:", dateStr, newOverride);
        } catch (e) {
            console.error("Erro ao salvar no Firebase:", e);
            alert("Erro ao salvar alteração. Verifique a internet.");
        }
    }

    renderCalendar() {
        const grid = document.getElementById('calendar-grid');
        grid.innerHTML = '';

        const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        weekdays.forEach(d => {
            const el = document.createElement('div');
            el.className = 'weekday-header';
            el.textContent = d;
            grid.appendChild(el);
        });

        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        document.getElementById('current-month-label').textContent = `${monthNames[month]} ${year}`;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        for (let i = 0; i < firstDay.getDay(); i++) {
            const empty = document.createElement('div');
            empty.className = 'day empty';
            grid.appendChild(empty);
        }

        for (let i = 1; i <= lastDay.getDate(); i++) {
            const dateStr = this.formatDate(new Date(year, month, i));
            const el = document.createElement('div');
            el.className = 'day';
            el.textContent = i;

            const todayStr = this.formatDate(new Date());
            if (dateStr === todayStr) el.classList.add('today');

            if (this.schedule.has(dateStr)) {
                const info = this.schedule.get(dateStr);
                el.classList.add(info.owner);

                // No visual cues for overrides (per user request)
                // Overrides blend in perfectly as Father/Mother days

                const tooltip = document.createElement('div');
                tooltip.className = 'tooltip';
                tooltip.textContent = info.name;
                el.appendChild(tooltip);

                // Content marker (Star) only for real holidays, not manual overrides
                if (info.priority >= 3 && info.priority !== 10) {
                    const icon = document.createElement('div');
                    icon.className = 'icon-marker';
                    icon.textContent = '★';
                    el.appendChild(icon);
                }
            }

            // Interaction
            if (this.adminMode) {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleDayOwner(dateStr);
                });
            }

            grid.appendChild(el);
        }
    }

    renderUpcomingEvents() {
        const list = document.getElementById('events-list');
        list.innerHTML = '';

        // Combine HOLIDAYS and fixed blocks (Xmas/New Year) for the list
        // We do NOT include the "Specials" (hidden birthdays) here
        const displayEvents = [
            ...HOLIDAYS,
            { name: 'Natal (Semana)', date: '2026-12-25', owner: OWNER.MOTHER }, // Reference date
            { name: 'Ano Novo (Semana)', date: '2027-01-01', owner: OWNER.FATHER }
        ];

        // Sort by date
        displayEvents.sort((a, b) => a.date.localeCompare(b.date));

        displayEvents.forEach(info => {
            const li = document.createElement('li');
            li.className = 'event-item';

            // Format date for display (DD/MM)
            const [y, m, day] = info.date.split('-');

            // Check if passed (optional style)
            const today = new Date().toISOString().split('T')[0];
            if (info.date < today) {
                li.style.opacity = '0.5';
            }

            li.innerHTML = `
                <span class="event-date">${day}/${m}</span>
                <span class="event-name">${info.name}</span>
                <span class="event-owner ${info.owner}">${info.owner === 'father' ? 'Pai' : 'Mãe'}</span>
            `;
            list.appendChild(li);
        });
    }

    updateDashboard() {
        const todayStr = this.formatDate(new Date());
        const info = this.schedule.get(todayStr);
        const statusEl = document.getElementById('today-status');

        if (info) {
            statusEl.textContent = `${info.owner === 'father' ? 'Com Você' : 'Com a Mãe'}`;
            statusEl.className = `status-text ${info.owner}`;
        } else {
            statusEl.textContent = 'Com a Mãe';
            statusEl.className = 'status-text mother';
        }

        // Next Father Weekend
        const future = Array.from(this.schedule.entries())
            .filter(([d, i]) => d >= todayStr && i.owner === 'father' && (i.priority >= 1 || i.priority === 10))
            .sort((a, b) => a[0].localeCompare(b[0]));

        if (future.length > 0) {
            const nextVisitStr = future[0][0];
            const today = new Date();
            const nextD = new Date(nextVisitStr + 'T12:00:00');
            const diffDays = Math.ceil((nextD - today) / (1000 * 60 * 60 * 24));
            const [y, m, d] = nextVisitStr.split('-');

            document.getElementById('next-visit-date').textContent = `${d}/${m}`;
            document.getElementById('next-visit-countdown').textContent = diffDays <= 0 ? 'Hoje' : `Faltam ${diffDays} dias`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CalendarApp();
});
