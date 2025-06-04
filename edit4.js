<script>
/**
 * Полноценный Calendar Manager для вашей системы
 * Основан на успешном исправлении и протестированных решениях
 */

class ProductionCalendarManager {
    constructor() {
        this.isInitialized = false;
        this.data = {
            basePrices: {},
            blockedDates: {},
            dateRanges: [],
            excludedDays: new Set(),
            dateDiscounts: {},
            globalSettings: { defaultCost: 8000 }
        };
        this.selection = {
            tempStart: null,
            tempStartMonth: null,
            tempStartYear: null,
            isConfirmed: true
        };
        this.blockingMode = false;
        this.serviceId = null;
        this.supabaseClient = null;
        this.isEditMode = false;
        this.monthMap = {
            'January':'01','February':'02','March':'03','April':'04',
            'May':'05','June':'06','July':'07','August':'08',
            'September':'09','October':'10','November':'11','December':'12'
        };
        this.reverseMonthMap = Object.fromEntries(Object.entries(this.monthMap).map(([k,v])=>[v,k]));
        
        this.init();
    }

    async init() {
        console.log('🚀 Инициализация Production Calendar Manager...');
        
        // Добавляем стили
        this.addStyles();
        
        // Ждем готовности DOM
        await this.waitForDOM();
        
        // Определяем режим работы
        this.detectMode();
        
        // Инициализируем Supabase
        this.initializeSupabase();
        
        // Устанавливаем текущую дату
        this.setCurrentDate();
        
        // Загружаем настройки
        this.loadGlobalSettings();
        
        // Загружаем данные
        await this.loadData();
        
        // Инициализируем календарь
        this.updateCalendar();
        
        // Прикрепляем обработчики событий
        this.attachEventHandlers();
        
        // Обновляем состояние кнопок навигации
        this.updatePrevMonthButtonState();
        
        this.isInitialized = true;
        console.log('✅ Calendar Manager инициализирован успешно');
        console.log(`📊 Режим: ${this.isEditMode ? 'Редактирование' : 'Создание'}, Service ID: ${this.serviceId || 'Не установлен'}`);
    }

    async waitForDOM() {
        return new Promise(resolve => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                setTimeout(resolve, 100);
            }
        });
    }

    detectMode() {
        // Проверяем URL параметры
        const urlParams = new URLSearchParams(window.location.search);
        const serviceIdFromUrl = urlParams.get('service_id') || urlParams.get('id');
        
        // Проверяем скрытые поля
        const serviceIdInput = document.querySelector('input[name="service_id"]') || 
                              document.querySelector('#service_id') ||
                              document.querySelector('[data-name="service_id"]');
        
        const serviceIdFromInput = serviceIdInput ? serviceIdInput.value : null;
        
        // Приоритет: URL > input field
        this.serviceId = serviceIdFromUrl || serviceIdFromInput;
        this.isEditMode = !!this.serviceId;
        
        console.log(`🔍 Обнаружен режим: ${this.isEditMode ? 'Edit' : 'Create'}`);
        if (this.serviceId) console.log(`🆔 Service ID: ${this.serviceId}`);
    }

    initializeSupabase() {
        if (typeof supabase !== "undefined") {
            const SUPABASE_URL = 'https://jymaupdlljtwjxiiistn.supabase.co';
            const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5bWF1cGRsbGp0d2p4aWlpc3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5MTcxMTgsImV4cCI6MjA1NDQ5MzExOH0.3K22PNYIHh8NCreiG0NBtn6ITFrL3cVmSS5KCG--niY';
            this.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Supabase подключен');
        } else {
            console.warn('⚠️ Supabase не найден');
        }
    }

    async loadData() {
        if (this.isEditMode && this.serviceId && this.supabaseClient) {
            await this.loadFromDatabase();
        } else {
            this.loadFromLocalStorage();
        }
    }

    async loadFromDatabase() {
        try {
            console.log('📊 Загрузка данных из базы для service_id:', this.serviceId);
            
            const { data, error } = await this.supabaseClient
                .from('available_periods')
                .select('*')
                .eq('service_id', this.serviceId)
                .order('date', { ascending: true });

            if (error) {
                console.error('❌ Ошибка загрузки из БД:', error);
                return;
            }

            if (data && data.length > 0) {
                console.log(`✅ Загружено ${data.length} периодов из БД`);
                this.processDataFromDatabase(data);
            } else {
                console.log('ℹ️ Нет данных в БД, используем значения по умолчанию');
                this.initializeDefaultPrices();
            }
        } catch (error) {
            console.error('❌ Ошибка при загрузке данных:', error);
        }
    }

    processDataFromDatabase(periods) {
        // Очищаем существующие данные
        this.data.basePrices = {};
        this.data.blockedDates = {};
        
        // Группируем по месяцам
        const periodsByMonth = {};
        let firstValidPrice = null;
        
        periods.forEach(period => {
            const date = new Date(period.date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = date.getDate();
            const monthKey = `${year}-${month}`;
            const dateStr = this.formatDate(day, month, year);
            
            if (!periodsByMonth[monthKey]) {
                periodsByMonth[monthKey] = { prices: [], defaultCost: this.getDefaultCost() };
            }
            
            periodsByMonth[monthKey].prices.push({
                date: dateStr,
                price: period.price
            });
            
            if (!firstValidPrice && period.price > 0) {
                firstValidPrice = period.price;
            }
            
            // Отслеживаем заблокированные даты
            if (period.price === 0) {
                if (!this.data.blockedDates[monthKey]) {
                    this.data.blockedDates[monthKey] = [];
                }
                this.data.blockedDates[monthKey].push({ date: dateStr, price: 0 });
            }
        });
        
        this.data.basePrices = periodsByMonth;
        
        // Обновляем default cost
        if (firstValidPrice) {
            this.data.globalSettings.defaultCost = firstValidPrice;
            const costInput = document.querySelector('input[name="cost_per_show"]');
            if (costInput && !costInput.value) {
                costInput.value = firstValidPrice;
            }
        }
    }

    loadFromLocalStorage() {
        // Загрузка из localStorage для режима создания
        const stored = localStorage.getItem('calendarGlobalSettings');
        if (stored) {
            this.data.globalSettings = JSON.parse(stored);
        }
    }

    initializeDefaultPrices() {
        const defaultCost = this.getDefaultCost();
        const monthKey = this.getCurrentMonthKey();
        if (monthKey) {
            this.ensureBasePrices(monthKey);
        }
    }

    addStyles() {
        if (document.querySelector('#calendar-custom-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'calendar-custom-styles';
        style.textContent = `
            .calendar_day-wrapper.is-past {
                opacity: 0.5;
                cursor: not-allowed;
                pointer-events: none;
                background-color: #f5f5f5;
            }
            .calendar_day-wrapper.is-past [service-price],
            .calendar_day-wrapper.is-past [price-currency] {
                color: #999;
            }
            .calendar_day-wrapper.is-blocked {
                background-color: #ffebee !important;
                border: 2px solid #f44336 !important;
                cursor: not-allowed;
            }
            .calendar_day-wrapper.is-blocked [service-price] {
                color: #f44336;
                font-weight: bold;
            }
            .calendar_day-wrapper.is-database-loaded {
                border: 2px solid #4caf50 !important;
                position: relative;
            }
            .calendar_day-wrapper.is-database-loaded::after {
                content: '';
                position: absolute;
                top: 2px;
                right: 2px;
                width: 8px;
                height: 8px;
                background-color: #4caf50;
                border-radius: 50%;
            }
            .calendar_day-wrapper.is-selected {
                background-color: #e3f2fd !important;
                border: 2px solid #2196f3 !important;
            }
            .calendar_day-wrapper.is-weekend-discount {
                background-color: #f3e5f5 !important;
                border: 2px solid #9c27b0 !important;
            }
            .calendar_day-wrapper.is-hover-range {
                background-color: #f5f5f5;
                transition: background-color 0.2s ease;
            }
            .calendar_day-wrapper:not(.is-past):not(.is-blocked):hover {
                background-color: #f0f0f0;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    // Основные методы календаря
    getCurrentMonthKey() {
        const element = document.querySelector('[current_month_year]');
        if (!element) return null;
        const [monthName, year] = element.textContent.trim().split(' ');
        return `${year}-${this.monthMap[monthName]}`;
    }

    formatDate(day, month, year) {
        return `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`;
    }

    getDefaultCost() {
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput && costInput.value) {
            const value = parseInt(costInput.value);
            if (!isNaN(value) && value > 0) return value;
        }
        return this.data.globalSettings.defaultCost || 8000;
    }

    loadGlobalSettings() {
        if (!this.isEditMode) {
            const stored = localStorage.getItem('calendarGlobalSettings');
            if (stored) {
                this.data.globalSettings = JSON.parse(stored);
            }
        }
        
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput && !costInput.value) {
            costInput.value = this.data.globalSettings.defaultCost;
        }
    }

    setCurrentDate() {
        const now = new Date();
        const currentMonth = this.reverseMonthMap[(now.getMonth() + 1).toString().padStart(2, '0')];
        const currentYear = now.getFullYear();
        const monthYearElement = document.querySelector('[current_month_year]');
        if (monthYearElement) {
            monthYearElement.textContent = `${currentMonth} ${currentYear}`;
        }
    }

    isPastDate(dateStr) {
        const [day, month, year] = dateStr.split('.').map(Number);
        const dateObj = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dateObj.setHours(0, 0, 0, 0);
        return dateObj < today;
    }

    isWeekend(dateStr) {
        const [day, month, year] = dateStr.split('.').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6;
    }

    updateCalendar() {
        const monthYearElement = document.querySelector('[current_month_year]');
        if (!monthYearElement) return;
        
        const [monthName, year] = monthYearElement.textContent.trim().split(' ');
        const monthNum = parseInt(this.monthMap[monthName]);
        
        this.generateCalendar(monthNum, parseInt(year));
        
        setTimeout(() => {
            this.loadMonthData(this.getCurrentMonthKey());
            this.updateAllDaysDisplay();
            this.updatePrevMonthButtonState();
        }, 50);
    }

    generateCalendar(monthNum, year) {
        const firstDay = new Date(year, monthNum - 1, 1);
        const lastDay = new Date(year, monthNum, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
        
        const calendar = [];
        let week = Array(7).fill('');
        let dayCounter = 1;

        for (let i = startingDayOfWeek; i < 7; i++) {
            week[i] = dayCounter++;
        }
        calendar.push(week);

        while (dayCounter <= daysInMonth) {
            week = Array(7).fill('');
            for (let i = 0; i < 7 && dayCounter <= daysInMonth; i++) {
                week[i] = dayCounter++;
            }
            calendar.push(week);
        }

        const flatDays = calendar.flat();
        for (let i = 0; i < 42; i++) {
            const cell = document.querySelector(`[day='${i}']`);
            const dayWrapper = cell?.closest('.calendar_day-wrapper');
            if (!cell || !dayWrapper) continue;

            const day = flatDays[i];
            const servicePrice = dayWrapper.querySelector('[service-price]');
            const priceCurrency = dayWrapper.querySelector('[price-currency]');

            if (day) {
                cell.textContent = day;
                dayWrapper.classList.remove('not_exist');
                if (servicePrice) servicePrice.style.display = '';
                if (priceCurrency) priceCurrency.style.display = '';
            } else {
                cell.textContent = '';
                dayWrapper.classList.add('not_exist');
                if (servicePrice) servicePrice.style.display = 'none';
                if (priceCurrency) priceCurrency.style.display = 'none';
            }
        }
    }

    loadMonthData(monthKey) {
        if (this.isEditMode) {
            this.ensureBasePrices(monthKey);
            return;
        }

        // localStorage логика для режима создания
        const stored = localStorage.getItem(`monthData-${monthKey}`);
        const blocked = localStorage.getItem('blockedDatesMap');
        
        if (stored) {
            this.data.basePrices[monthKey] = JSON.parse(stored);
        } else {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: this.getDefaultCost()};
        }
        
        if (blocked) this.data.blockedDates = JSON.parse(blocked);
        
        this.ensureBasePrices(monthKey);
    }

    ensureBasePrices(monthKey) {
        const [year, month] = monthKey.split('-');
        const defaultCost = this.getDefaultCost();
        
        if (!this.data.basePrices[monthKey]) {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: defaultCost};
        }
        
        const existingDates = new Set(this.data.basePrices[monthKey].prices.map(item => item.date));

        document.querySelectorAll('.calendar_day-wrapper:not(.not_exist)').forEach(dayWrapper => {
            const dayElement = dayWrapper.querySelector('[day]');
            if (!dayElement) return;
            const dayText = dayElement.textContent.trim();
            if (!dayText) return;
            const day = parseInt(dayText);
            if (isNaN(day)) return;
            
            const date = this.formatDate(day, month, year);
            
            if (!existingDates.has(date)) {
                const isPast = this.isPastDate(date);
                const price = isPast ? 0 : defaultCost;
                this.data.basePrices[monthKey].prices.push({date: date, price: price});
            }
        });
    }

    updateAllDaysDisplay() {
        const monthYearElement = document.querySelector('[current_month_year]');
        if (!monthYearElement) return;
        
        const [monthName, year] = monthYearElement.textContent.trim().split(' ');
        const monthKey = this.getCurrentMonthKey();
        const defaultCost = this.getDefaultCost();

        document.querySelectorAll('.calendar_day-wrapper').forEach(dayWrapper => {
            const cell = dayWrapper.querySelector('[day]');
            if (!cell) return;
            const dayText = cell.textContent.trim();
            if (!dayText) return;

            const day = parseInt(dayText);
            const dateStr = this.formatDate(day, this.monthMap[monthName], year);
            const isPast = this.isPastDate(dateStr);
            const isBlocked = this.isDateBlocked(dateStr, monthKey);
            const isFromDB = this.hasDateInDatabase(dateStr, monthKey);

            // Очищаем все классы
            dayWrapper.classList.remove('is-past', 'is-blocked', 'is-database-loaded', 'is-weekend-discount');

            // Применяем состояния
            if (isPast) {
                dayWrapper.classList.add('is-past');
            } else if (isBlocked) {
                dayWrapper.classList.add('is-blocked');
            } else if (isFromDB && this.isEditMode) {
                dayWrapper.classList.add('is-database-loaded');
            }

            // Обновляем цену
            const servicePriceElement = dayWrapper.querySelector('[service-price]');
            if (servicePriceElement) {
                let price = defaultCost;
                
                if (isPast) {
                    price = 0;
                } else if (isBlocked) {
                    price = 0;
                } else {
                    const priceData = this.getPriceForDate(dateStr, monthKey);
                    if (priceData !== null) {
                        price = priceData;
                    }
                }
                
                servicePriceElement.textContent = price;
            }
        });
    }

    getPriceForDate(dateStr, monthKey) {
        if (!this.data.basePrices[monthKey] || !this.data.basePrices[monthKey].prices) {
            return null;
        }
        const priceItem = this.data.basePrices[monthKey].prices.find(item => item.date === dateStr);
        return priceItem ? priceItem.price : null;
    }

    hasDateInDatabase(dateStr, monthKey) {
        return this.getPriceForDate(dateStr, monthKey) !== null;
    }

    isDateBlocked(dateStr, monthKey) {
        if (!this.data.blockedDates[monthKey]) return false;
        return this.data.blockedDates[monthKey].some(item => {
            return (typeof item === 'object' && item.date) ? item.date === dateStr : item === dateStr;
        });
    }

    updatePrevMonthButtonState() {
        const prevButton = document.querySelector('.calendar_prev');
        if (!prevButton) return;
        const monthYearElement = document.querySelector('[current_month_year]');
        if (!monthYearElement) return;

        const [monthName, year] = monthYearElement.textContent.trim().split(' ');
        const monthNum = parseInt(this.monthMap[monthName]);
        const yearNum = parseInt(year);
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();

        let canGoBack = true;
        if (monthNum === 1) {
            if (yearNum - 1 < currentYear || (yearNum - 1 === currentYear && 12 < currentMonth)) {
                canGoBack = false;
            }
        } else {
            if (yearNum < currentYear || (yearNum === currentYear && monthNum - 1 < currentMonth)) {
                canGoBack = false;
            }
        }

        prevButton.style.opacity = canGoBack ? '1' : '0.5';
        prevButton.style.pointerEvents = canGoBack ? 'auto' : 'none';
    }

    // База данных
    async saveToDatabase() {
        if (!this.supabaseClient || !this.serviceId) {
            console.warn('⚠️ Не могу сохранить: отсутствует Supabase client или Service ID');
            return false;
        }

        try {
            console.log('💾 Сохранение в базу данных...');
            
            // Собираем все периоды
            const periods = [];
            
            Object.keys(this.data.basePrices).forEach(monthKey => {
                const monthData = this.data.basePrices[monthKey];
                if (monthData && monthData.prices) {
                    monthData.prices.forEach(priceItem => {
                        const [day, month, year] = priceItem.date.split('.');
                        const date = `${year}-${month}-${day}`;
                        
                        periods.push({
                            id: this.generateUUID(),
                            service_id: this.serviceId,
                            date: date,
                            price: priceItem.price || 0
                        });
                    });
                }
            });

            if (periods.length === 0) {
                console.log('⚠️ Нет данных для сохранения');
                return false;
            }

            // Удаляем старые записи
            const { error: deleteError } = await this.supabaseClient
                .from('available_periods')
                .delete()
                .eq('service_id', this.serviceId);

            if (deleteError) {
                console.error('❌ Ошибка удаления:', deleteError);
                return false;
            }

            // Вставляем новые записи
            const { error: insertError } = await this.supabaseClient
                .from('available_periods')
                .insert(periods);

            if (insertError) {
                console.error('❌ Ошибка вставки:', insertError);
                return false;
            }

            console.log(`✅ Сохранено ${periods.length} записей в БД`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка сохранения:', error);
            return false;
        }
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Обработчики событий
    attachEventHandlers() {
        this.attachNavigationHandlers();
        this.attachDayClickHandlers();
        this.attachFormSubmissionHandler();
        this.attachPriceChangeHandlers();
    }

    attachNavigationHandlers() {
        const prevButton = document.querySelector('.calendar_prev');
        const nextButton = document.querySelector('.calendar_next');

        if (prevButton) {
            prevButton.addEventListener('click', () => {
                if (prevButton.style.pointerEvents === 'none') return;
                this.navigateMonth(-1);
            });
        }

        if (nextButton) {
            nextButton.addEventListener('click', () => {
                this.navigateMonth(1);
            });
        }
    }

    navigateMonth(direction) {
        const monthYearElement = document.querySelector('[current_month_year]');
        if (!monthYearElement) return;

        const [monthName, year] = monthYearElement.textContent.trim().split(' ');
        let monthNum = this.monthMap[monthName];
        let yearNum = parseInt(year);

        if (direction === 1) {
            if (monthNum === '12') {
                monthNum = '01';
                yearNum += 1;
            } else {
                monthNum = (parseInt(monthNum) + 1).toString().padStart(2, '0');
            }
        } else {
            if (monthNum === '01') {
                monthNum = '12';
                yearNum -= 1;
            } else {
                monthNum = (parseInt(monthNum) - 1).toString().padStart(2, '0');
            }
        }

        monthYearElement.textContent = `${this.reverseMonthMap[monthNum]} ${yearNum}`;
        setTimeout(() => {
            this.updateCalendar();
        }, 10);
    }

    attachDayClickHandlers() {
        document.addEventListener('click', (event) => {
            const dayWrapper = event.target.closest('.calendar_day-wrapper');
            if (!dayWrapper || dayWrapper.classList.contains('not_exist') || 
                dayWrapper.classList.contains('is-past') || 
                dayWrapper.classList.contains('is-blocked')) {
                return;
            }

            const cell = dayWrapper.querySelector('[day]');
            if (!cell) return;

            const dayText = cell.textContent.trim();
            if (!dayText) return;

            // Здесь можно добавить логику выбора дат, если нужно
            console.log('День выбран:', dayText);
        });
    }

    attachFormSubmissionHandler() {
        const form = document.querySelector('form');
        if (form && this.isEditMode) {
            form.addEventListener('submit', async (event) => {
                console.log('📝 Автосохранение при отправке формы...');
                try {
                    await this.saveToDatabase();
                } catch (error) {
                    console.error('❌ Ошибка автосохранения:', error);
                }
            });
        }
    }

    attachPriceChangeHandlers() {
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput) {
            costInput.addEventListener('input', () => {
                this.data.globalSettings.defaultCost = parseInt(costInput.value) || 8000;
                if (!this.isEditMode) {
                    localStorage.setItem('calendarGlobalSettings', JSON.stringify(this.data.globalSettings));
                }
                this.updateAllDaysDisplay();
            });
        }
    }

    // Публичные методы для внешнего использования
    getCalendarData() {
        return {
            basePrices: this.data.basePrices,
            blockedDates: this.data.blockedDates,
            serviceId: this.serviceId,
            isEditMode: this.isEditMode,
            isInitialized: this.isInitialized
        };
    }

    async reload() {
        console.log('🔄 Перезагрузка календаря...');
        await this.loadData();
        this.updateCalendar();
    }

    setPrice(day, price) {
        const monthKey = this.getCurrentMonthKey();
        const [year, month] = monthKey.split('-');
        const dateStr = this.formatDate(day, month, year);
        
        if (!this.data.basePrices[monthKey]) {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: this.getDefaultCost()};
        }
        
        const priceIndex = this.data.basePrices[monthKey].prices.findIndex(item => item.date === dateStr);
        if (priceIndex !== -1) {
            this.data.basePrices[monthKey].prices[priceIndex].price = price;
        } else {
            this.data.basePrices[monthKey].prices.push({date: dateStr, price: price});
        }
        
        this.updateAllDaysDisplay();
    }

    blockDate(day) {
        this.setPrice(day, 0);
        
        const monthKey = this.getCurrentMonthKey();
        const [year, month] = monthKey.split('-');
        const dateStr = this.formatDate(day, month, year);
        
        if (!this.data.blockedDates[monthKey]) {
            this.data.blockedDates[monthKey] = [];
        }
        
        if (!this.data.blockedDates[monthKey].some(item => 
            (typeof item === 'object' && item.date) ? item.date === dateStr : item === dateStr)) {
            this.data.blockedDates[monthKey].push({date: dateStr, price: 0});
        }
        
        this.updateAllDaysDisplay();
    }

    unblockDate(day) {
        const monthKey = this.getCurrentMonthKey();
        const [year, month] = monthKey.split('-');
        const dateStr = this.formatDate(day, month, year);
        
        if (this.data.blockedDates[monthKey]) {
            this.data.blockedDates[monthKey] = this.data.blockedDates[monthKey].filter(item => {
                return (typeof item === 'object' && item.date) ? item.date !== dateStr : item !== dateStr;
            });
            
            if (this.data.blockedDates[monthKey].length === 0) {
                delete this.data.blockedDates[monthKey];
            }
        }
        
        this.setPrice(day, this.getDefaultCost());
    }
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Запуск Production Calendar Manager...');
    window.calendarManager = new ProductionCalendarManager();
    
    // Debug интерфейс
    window.calendarAPI = {
        getManager: () => window.calendarManager,
        getStatus: () => window.calendarManager.getCalendarData(),
        reload: () => window.calendarManager.reload(),
        saveToDatabase: () => window.calendarManager.saveToDatabase(),
        setPrice: (day, price) => window.calendarManager.setPrice(day, price),
        blockDate: (day) => window.calendarManager.blockDate(day),
        unblockDate: (day) => window.calendarManager.unblockDate(day),
        setDefaultCost: (cost) => {
            window.calendarManager.data.globalSettings.defaultCost = cost;
            const costInput = document.querySelector('input[name="cost_per_show"]');
            if (costInput) costInput.value = cost;
            window.calendarManager.updateAllDaysDisplay();
        }
    };
    
    console.log('🛠️ API доступен в window.calendarAPI');
});
</script>
