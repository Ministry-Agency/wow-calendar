class FixedCalendarManager {Add commentMore actions
    constructor() {
        this.isInitialized = false;
        this.data = {
            basePrices: {},
            blockedDates: {},
            dateRanges: [],
            excludedDays: new Set(),
            dateDiscounts: {},
            globalSettings: { defaultCost: null }
        };
        this.selection = {
            tempStart: null,
            tempStartMonth: null,
            tempStartYear: null,
            isConfirmed: true
        };
        this.serviceId = null;
        this.supabaseClient = null;
        this.isEditMode = false;
        this.blockingMode = false;
        this.unblockingMode = false; // Новый режим для разблокировки
        this.monthMap = {
            'January':'01','February':'02','March':'03','April':'04',
            'May':'05','June':'06','July':'07','August':'08',
            'September':'09','October':'10','November':'11','December':'12'
        };
        this.reverseMonthMap = Object.fromEntries(Object.entries(this.monthMap).map(([k,v])=>[v,k]));
        
        this.init();
    }

    async init() {
        try {
            console.log('🚀 Инициализация Enhanced Calendar Manager...');
            
            // Ждем готовности DOM
            await this.waitForDOM();
            
            // Добавляем стили
            this.addStyles();
            
            // Определяем режим работы
            this.detectMode();
            
            // Инициализируем Supabase
            this.initializeSupabase();
            
            // Устанавливаем текущую дату
            this.setCurrentDate();
            
            // Загружаем настройки цен
            this.loadGlobalSettings();
            
            // Загружаем данные
            await this.loadData();
            
            // Инициализируем календарь
            this.updateCalendar();
            
            // Прикрепляем обработчики событий
            this.attachEventHandlers();
            
            // Обновляем состояние кнопок навигации
            this.updatePrevMonthButtonState();
            
            // Инициализируем weekend discount если сохранен
            this.initializeWeekendDiscount();
            
            this.isInitialized = true;
            console.log('✅ Calendar Manager инициализирован успешно');
            console.log(`📊 Режим: ${this.isEditMode ? 'Редактирование' : 'Создание'}, Service ID: ${this.serviceId || 'Не установлен'}`);
            
        } catch (error) {
            console.error('❌ Ошибка инициализации календаря:', error);
            this.createFallbackCalendar();
        }
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
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const serviceIdFromUrl = urlParams.get('service_id') || urlParams.get('id');
            
            const serviceIdInput = document.querySelector('input[name="service_id"]') || 
                                  document.querySelector('#service_id') ||
                                  document.querySelector('[data-name="service_id"]');
            
            const serviceIdFromInput = serviceIdInput ? serviceIdInput.value : null;
            
            this.serviceId = serviceIdFromUrl || serviceIdFromInput;
            this.isEditMode = !!this.serviceId;
            
            console.log(`🔍 Обнаружен режим: ${this.isEditMode ? 'Edit' : 'Create'}`);
            if (this.serviceId) console.log(`🆔 Service ID: ${this.serviceId}`);
        } catch (error) {
            console.error('❌ Ошибка определения режима:', error);
            this.isEditMode = false;
        }
    }

    initializeSupabase() {
        try {
            if (typeof supabase !== "undefined") {
                const SUPABASE_URL = 'https://jymaupdlljtwjxiiistn.supabase.co';
                const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5bWF1cGRsbGp0d2p4aWlpc3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5MTcxMTgsImV4cCI6MjA1NDQ5MzExOH0.3K22PNYIHh8NCreiG0NBtn6ITFrL3cVmSS5KCG--niY';
                this.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                console.log('✅ Supabase подключен');
            } else {
                console.warn('⚠️ Supabase не найден');
            }
        } catch (error) {
            console.error('❌ Ошибка подключения Supabase:', error);
        }
    }

    async loadData() {
        try {
            if (this.isEditMode && this.serviceId && this.supabaseClient) {
                await this.loadFromDatabase();
            } else {
                this.loadFromLocalStorage();
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
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
            console.error('❌ Ошибка при загрузке данных из БД:', error);
        }
    }

    processDataFromDatabase(periods) {
        try {
            this.data.basePrices = {};
            this.data.blockedDates = {};
            
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
                
                if (period.price === 0) {
                    if (!this.data.blockedDates[monthKey]) {
                        this.data.blockedDates[monthKey] = [];
                    }
                    this.data.blockedDates[monthKey].push({ date: dateStr, price: 0 });
                }
            });
            
            this.data.basePrices = periodsByMonth;
            
            if (firstValidPrice) {
                this.data.globalSettings.defaultCost = firstValidPrice;
                const costInput = this.getCostInput();
                if (costInput && !costInput.value) {
                    costInput.value = firstValidPrice;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка обработки данных из БД:', error);
        }
    }

    loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem('calendarGlobalSettings');
            if (stored) {
                const settings = JSON.parse(stored);
                if (settings.defaultCost) {
                    this.data.globalSettings = settings;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки из localStorage:', error);
        }
    }

    initializeDefaultPrices() {
        try {
            const defaultCost = this.getDefaultCost();
            const monthKey = this.getCurrentMonthKey();
            if (monthKey && defaultCost) {
                this.ensureBasePrices(monthKey);
            }
        } catch (error) {
            console.error('❌ Ошибка инициализации цен по умолчанию:', error);
        }
    }

    getCostInput() {
        return document.querySelector('input[name="cost_per_show"]') || 
               document.querySelector('#cost_per_show') ||
               document.querySelector('[data-name="cost_per_show"]');
    }

    getDefaultCost() {
        try {
            const costInput = this.getCostInput();
            
            if (costInput && costInput.value) {
                const value = parseInt(costInput.value);
                if (!isNaN(value) && value > 0) {
                    this.data.globalSettings.defaultCost = value;
                    return value;
                }
            }
            
            // Возвращаем сохраненное значение или null
            return this.data.globalSettings.defaultCost || null;
        } catch (error) {
            console.error('❌ Ошибка получения цены по умолчанию:', error);
            return null;
        }
    }

    loadGlobalSettings() {
        try {
            const costInput = this.getCostInput();
            
            // НЕ устанавливаем значение по умолчанию
            if (costInput && costInput.value) {
                const inputValue = parseInt(costInput.value);
                if (!isNaN(inputValue) && inputValue > 0) {
                    this.data.globalSettings.defaultCost = inputValue;
                    console.log(`💰 Цена установлена из input поля: ${inputValue}`);
                    return;
                }
            }
            
            if (!this.isEditMode) {
                const stored = localStorage.getItem('calendarGlobalSettings');
                if (stored) {
                    const settings = JSON.parse(stored);
                    if (settings.defaultCost) {
                        this.data.globalSettings = settings;
                        console.log(`📦 Настройки загружены из localStorage: ${settings.defaultCost}`);
                        
                        // НЕ устанавливаем значение в input поле автоматически
                    }
                }
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки глобальных настроек:', error);
        }
    }

    addStyles() {
        try {
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
                .calendar_day-wrapper.is-blocked {
                    background-color: #ffebee !important;
                    border: 2px solid #f44336 !important;
                    cursor: pointer;
                }
                .calendar_day-wrapper.is-blocked.is-hover-unblock {
                    background-color: #c8e6c9 !important;
                    border: 2px solid #4caf50 !important;
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
                .calendar_day-wrapper:not(.is-past):not(.is-blocked):hover {
                    background-color: #f0f0f0;
                    cursor: pointer;
                }
                .calendar_day-wrapper.is-selected {
                    background-color: #f3fcc8;
                    color: #222A37 !important;
                    border: 1px solid #7A869A !important;
                }
                .calendar_day-wrapper.is-wait {
                    background-color: #F6F8FC;
                    color: #222A37 !important;
                    border: 1px solid #7A869A !important;
                }
                .calendar_day-wrapper.is-active {
                    background-color: #f3fcc8;
                    color: #222A37;
                }
                .calendar_day-wrapper.is-hover-range {
                    background-color: #F6F8FC;
                    transition: background-color 0.2s ease;
                }
                .calendar_day-wrapper.is-weekend-discount {
                    background-color: #f0f9ff;
                    border: 1px solid #60a5fa !important;
                }
            `;
            document.head.appendChild(style);
        } catch (error) {
            console.error('❌ Ошибка добавления стилей:', error);
        }
    }

    getCurrentMonthKey() {
        try {
            const element = document.querySelector('[current_month_year]');
            if (!element) return null;
            const [monthName, year] = element.textContent.trim().split(' ');
            return `${year}-${this.monthMap[monthName]}`;
        } catch (error) {
            console.error('❌ Ошибка получения ключа месяца:', error);
            return null;
        }
    }

    formatDate(day, month, year) {
        return `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`;
    }

    createFullDate(day, monthName, year) {
        const monthNum = this.monthMap[monthName];
        return {
            day: day,
            month: monthNum,
            year: year,
            timestamp: new Date(year, parseInt(monthNum) - 1, day).getTime()
        };
    }

    setCurrentDate() {
        try {
            const now = new Date();
            const currentMonth = this.reverseMonthMap[(now.getMonth() + 1).toString().padStart(2, '0')];
            const currentYear = now.getFullYear();
            const monthYearElement = document.querySelector('[current_month_year]');
            if (monthYearElement) {
                monthYearElement.textContent = `${currentMonth} ${currentYear}`;
            }
        } catch (error) {
            console.error('❌ Ошибка установки текущей даты:', error);
        }
    }

    isPastDate(dateStr) {
        try {
            const [day, month, year] = dateStr.split('.').map(Number);
            const dateObj = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            dateObj.setHours(0, 0, 0, 0);
            return dateObj < today;
        } catch (error) {
            console.error('❌ Ошибка проверки прошедшей даты:', error);
            return false;
        }
    }

    isPastOrCurrentDate(fullDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateToCheck = new Date(fullDate.timestamp);
        dateToCheck.setHours(0, 0, 0, 0);
        return dateToCheck < today;
    }

    isWeekend(dateStr) {
        const [day, month, year] = dateStr.split('.').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6; // 0 = Sunday, 6 = Saturday
    }

    isDateInRanges(fullDate) {
        return this.data.dateRanges.some(range => 
            fullDate.timestamp >= range.start.timestamp &&
            fullDate.timestamp <= range.end.timestamp
        );
    }

    updateCalendar() {
        try {
            const monthYearElement = document.querySelector('[current_month_year]');
            if (!monthYearElement) return;
            
            const [monthName, year] = monthYearElement.textContent.trim().split(' ');
            const monthNum = parseInt(this.monthMap[monthName]);
            
            this.generateCalendar(monthNum, parseInt(year));
            
            setTimeout(() => {
                this.loadMonthData(this.getCurrentMonthKey());
                this.updateAllDaysDisplay();
                this.updatePrevMonthButtonState();
                
                // Применяем скидку выходного дня после обновления календаря
                const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
                const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
                if (weekendDiscountEnabled && discountPercent > 0) {
                    this.applyWeekendDiscount(discountPercent);
                }
            }, 50);
        } catch (error) {
            console.error('❌ Ошибка обновления календаря:', error);
        }
    }

    generateCalendar(monthNum, year) {
        try {
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
        } catch (error) {
            console.error('❌ Ошибка генерации календаря:', error);
        }
    }

    loadMonthData(monthKey) {
        try {
            if (!monthKey) return;
            
            if (this.isEditMode) {
                this.ensureBasePrices(monthKey);
                return;
            }

            const stored = localStorage.getItem(`monthData-${monthKey}`);
            const blocked = localStorage.getItem('blockedDatesMap');
            
            if (stored) {
                this.data.basePrices[monthKey] = JSON.parse(stored);
            } else {
                const defaultCost = this.getDefaultCost();
                this.data.basePrices[monthKey] = {prices: [], defaultCost: defaultCost};
            }
            
            if (blocked) this.data.blockedDates = JSON.parse(blocked);
            
            this.ensureBasePrices(monthKey);
            
            // Apply weekend discount if enabled
            const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
            const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
            
            if (weekendDiscountEnabled && discountPercent > 0) {
                const [year, month] = monthKey.split('-');
                const basePrice = this.getDefaultCost();
                if (basePrice) {
                    const discountedPrice = this.applyDiscount(basePrice, discountPercent);
                    
                    this.data.basePrices[monthKey].prices = this.data.basePrices[monthKey].prices.map(item => {
                        if (this.isPastDate(item.date) || this.isDateBlocked(item.date, monthKey)) {
                            return {...item, price: 0};
                        }
                        if (this.isWeekend(item.date)) {
                            return {...item, price: discountedPrice};
                        }
                        return item;
                    });
                }
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки данных месяца:', error);
        }
    }

    ensureBasePrices(monthKey) {
        try {
            if (!monthKey) return;
            
            const [year, month] = monthKey.split('-');
            const defaultCost = this.getDefaultCost();
            
            if (!defaultCost) {
                console.log('⚠️ Цена по умолчанию не установлена');
                return;
            }
            
            console.log(`📅 Обработка месяца ${monthKey}, базовая цена: ${defaultCost}`);
            
            if (!this.data.basePrices[monthKey]) {
                this.data.basePrices[monthKey] = {prices: [], defaultCost: defaultCost};
                console.log(`🆕 Создан новый месяц ${monthKey} с ценой ${defaultCost}`);
            }
            
            const existingDates = new Set(this.data.basePrices[monthKey].prices.map(item => item.date));
            
            // Check if weekend discount is enabled
            const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
            const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
            const discountedPrice = weekendDiscountEnabled && discountPercent > 0 
                ? this.applyDiscount(defaultCost, discountPercent) 
                : defaultCost;

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
                    let price = isPast ? 0 : defaultCost;
                    
                    // Apply weekend discount if enabled and not past date
                    if (!isPast && weekendDiscountEnabled && discountPercent > 0 && this.isWeekend(date)) {
                        price = discountedPrice;
                    }
                    
                    this.data.basePrices[monthKey].prices.push({date: date, price: price});
                    
                    if (!isPast) {
                        console.log(`➕ Добавлена новая дата ${date} с ценой ${price}`);
                    }
                }
            });
        } catch (error) {
            console.error('❌ Ошибка обеспечения базовых цен:', error);
        }
    }

    updateAllDaysDisplay() {
        try {
            const monthYearElement = document.querySelector('[current_month_year]');
            if (!monthYearElement) return;
            
            const [monthName, year] = monthYearElement.textContent.trim().split(' ');
            const monthKey = this.getCurrentMonthKey();
            const defaultCost = this.getDefaultCost();
            
            // Check if weekend discount is enabled
            const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
            const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
            const discountedPrice = weekendDiscountEnabled && discountPercent > 0 && defaultCost
                ? this.applyDiscount(defaultCost, discountPercent) 
                : defaultCost;

            document.querySelectorAll('.calendar_day-wrapper').forEach(dayWrapper => {
                const cell = dayWrapper.querySelector('[day]');
                if (!cell) return;
                const dayText = cell.textContent.trim();
                if (!dayText) return;

                const day = parseInt(dayText);
                const dateStr = this.formatDate(day, this.monthMap[monthName], year);
                const fullDate = this.createFullDate(day, monthName, parseInt(year));
                const timestamp = fullDate.timestamp;
                
                const isPast = this.isPastDate(dateStr);
                const isBlocked = this.isDateBlocked(dateStr, monthKey);
                const isFromDB = this.hasDateInDatabase(dateStr, monthKey);
                const isInRange = this.isDateInRanges(fullDate);
                const isExcluded = this.data.excludedDays.has(timestamp);

                // Clear all classes
                dayWrapper.classList.remove('is-past', 'is-blocked', 'is-database-loaded', 'is-selected', 'is-wait', 'is-active', 'is-weekend-discount');

                // Apply states
                if (isPast) {
                    dayWrapper.classList.add('is-past');
                } else if (isBlocked) {
                    dayWrapper.classList.add('is-blocked');
                } else if (isFromDB && this.isEditMode) {
                    dayWrapper.classList.add('is-database-loaded');
                }
                
                // Apply selection states
                if (!isPast && !isBlocked) {
                    dayWrapper.classList.toggle('is-selected', isInRange && !isExcluded);
                    dayWrapper.classList.toggle('is-active', this.data.dateDiscounts[timestamp] !== undefined && !isExcluded);
                }

                // Update price
                const servicePriceElement = dayWrapper.querySelector('[service-price]');
                if (servicePriceElement) {
                    let price = defaultCost || 0;
                    
                    if (isPast || isBlocked) {
                        price = 0;
                    } else if (isExcluded) {
                        price = defaultCost || 0;
                        dayWrapper.classList.remove('is-weekend-discount');
                    } else if (this.data.dateDiscounts[timestamp] !== undefined) {
                        price = this.data.dateDiscounts[timestamp];
                    } else if (weekendDiscountEnabled && discountPercent > 0 && this.isWeekend(dateStr) && defaultCost) {
                        price = discountedPrice;
                        dayWrapper.classList.add('is-weekend-discount');
                    } else {
                        const priceData = this.getPriceForDate(dateStr, monthKey);
                        if (priceData !== null) {
                            price = priceData;
                            // Проверяем, применена ли скидка выходного дня к этой цене
                            if (weekendDiscountEnabled && this.isWeekend(dateStr) && price === discountedPrice) {
                                dayWrapper.classList.add('is-weekend-discount');
                            }
                        } else {
                            price = defaultCost || 0;
                        }
                        if (!this.isWeekend(dateStr)) {
                            dayWrapper.classList.remove('is-weekend-discount');
                        }
                    }
                    
                    servicePriceElement.textContent = price;
                }
                
                // Apply wait state for temp selection
                if (!isPast && this.selection.tempStart === day &&
                    this.selection.tempStartMonth === monthName &&
                    this.selection.tempStartYear === parseInt(year)) {
                    dayWrapper.classList.add('is-wait');
                }
            });
            
            // Save data only in create mode
            if (!this.isEditMode && monthKey) {
                this.saveMonthData(monthKey);
            }
        } catch (error) {
            console.error('❌ Ошибка обновления отображения дней:', error);
        }
    }

    getPriceForDate(dateStr, monthKey) {
        try {
            if (!this.data.basePrices[monthKey] || !this.data.basePrices[monthKey].prices) {
                return null;
            }
            const priceItem = this.data.basePrices[monthKey].prices.find(item => item.date === dateStr);
            return priceItem ? priceItem.price : null;
        } catch (error) {
            console.error('❌ Ошибка получения цены для даты:', error);
            return null;
        }
    }

    hasDateInDatabase(dateStr, monthKey) {
        return this.getPriceForDate(dateStr, monthKey) !== null;
    }

    isDateBlocked(dateStr, monthKey) {
        try {
            if (!this.data.blockedDates[monthKey]) return false;
            return this.data.blockedDates[monthKey].some(item => {
                return (typeof item === 'object' && item.date) ? item.date === dateStr : item === dateStr;
            });
        } catch (error) {
            console.error('❌ Ошибка проверки блокировки даты:', error);
            return false;
        }
    }

    saveMonthData(monthKey) {
        try {
            if (this.isEditMode || !monthKey) return;

            localStorage.setItem(`monthData-${monthKey}`, JSON.stringify(this.data.basePrices[monthKey]));
            if (Object.keys(this.data.blockedDates).length > 0) {
                localStorage.setItem('blockedDatesMap', JSON.stringify(this.data.blockedDates));
            }
            
            console.log(`💾 Данные месяца ${monthKey} сохранены в localStorage`);
        } catch (error) {
            console.error('❌ Ошибка сохранения данных месяца:', error);
        }
    }

    updatePrevMonthButtonState() {
        try {
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
        } catch (error) {
            console.error('❌ Ошибка обновления состояния кнопки:', error);
        }
    }

    // Discount methods
    applyDiscount(basePrice, discountPercent) {
        if (discountPercent > 100) return Math.round(basePrice * discountPercent / 100);
        const limitedDiscount = Math.min(Math.max(discountPercent, 0), 100);
        return Math.round(basePrice * (100 - limitedDiscount) / 100);
    }

    applyDiscountToRange() {
        if (this.data.dateRanges.length === 0) return;
        const selectedDiscountInput = document.querySelector('#selected_discount');
        if (!selectedDiscountInput) return;

        const discountPercent = parseFloat(selectedDiscountInput.value.replace(/[^\d.]/g, '')) || 0;
        const basePrice = this.getDefaultCost();
        if (!basePrice) return;
        
        const discountedPrice = this.applyDiscount(basePrice, discountPercent);
        const lastRange = this.data.dateRanges[this.data.dateRanges.length - 1];

        for (let currentDate = new Date(lastRange.start.timestamp); 
             currentDate <= new Date(lastRange.end.timestamp); 
             currentDate.setDate(currentDate.getDate() + 1)) {
            const date = new Date(currentDate);
            const timestamp = date.getTime();
            if (this.isPastOrCurrentDate({timestamp}) || this.data.excludedDays.has(timestamp)) continue;
            this.data.dateDiscounts[timestamp] = discountedPrice;
        }

        this.updateAllDaysDisplay();
        this.toggleSettingsVisibility(false);
        this.selection.isConfirmed = true;
    }

    applyWeekendDiscount(discountPercent) {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey) return;
        const basePrice = this.getDefaultCost();
        if (!basePrice) {
            console.warn('⚠️ Не могу применить скидку выходного дня: базовая цена не установлена');
            return;
        }
        
        const discountedPrice = this.applyDiscount(basePrice, discountPercent);
        
        if (!this.data.basePrices[monthKey]) {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: basePrice};
        }

        this.data.basePrices[monthKey].prices = this.data.basePrices[monthKey].prices.map(item => {
            if (this.isPastDate(item.date) || this.isDateBlocked(item.date, monthKey)) return {...item, price: 0};
            if (this.isWeekend(item.date)) return {...item, price: discountedPrice};
            return item;
        });

        const [year, month] = monthKey.split('-');
        document.querySelectorAll('.calendar_day-wrapper:not(.not_exist)').forEach(dayWrapper => {
            const dayElement = dayWrapper.querySelector('[day]');
            const servicePriceElement = dayWrapper.querySelector('[service-price]');
            if (!dayElement || !servicePriceElement) return;

            const day = parseInt(dayElement.textContent.trim());
            if (isNaN(day)) return;
            const date = this.formatDate(day, month, year);
            if (this.isPastDate(date) || this.isDateBlocked(date, monthKey)) return;

            if (this.isWeekend(date)) {
                servicePriceElement.textContent = discountedPrice;
                dayWrapper.classList.add('is-weekend-discount');
            }
        });
        
        console.log(`✅ Скидка выходного дня ${discountPercent}% применена`);
        this.saveMonthData(monthKey);
    }

    removeWeekendDiscount() {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey) return;
        const basePrice = this.getDefaultCost();
        if (!basePrice) return;

        if (!this.data.basePrices[monthKey]) {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: basePrice};
        }

        this.data.basePrices[monthKey].prices = this.data.basePrices[monthKey].prices.map(item => {
            if (this.isPastDate(item.date) || this.isDateBlocked(item.date, monthKey)) return {...item, price: 0};
            if (this.isWeekend(item.date)) return {...item, price: basePrice};
            return item;
        });

        const [year, month] = monthKey.split('-');
        document.querySelectorAll('.calendar_day-wrapper:not(.not_exist)').forEach(dayWrapper => {
            const dayElement = dayWrapper.querySelector('[day]');
            const servicePriceElement = dayWrapper.querySelector('[service-price]');
            if (!dayElement || !servicePriceElement) return;

            const day = parseInt(dayElement.textContent.trim());
            if (isNaN(day)) return;
            const date = this.formatDate(day, month, year);
            if (this.isPastDate(date) || this.isDateBlocked(date, monthKey)) return;

            if (this.isWeekend(date)) {
                servicePriceElement.textContent = basePrice;
                dayWrapper.classList.remove('is-weekend-discount');
            }
        });
        this.saveMonthData(monthKey);
    }

    initializeWeekendDiscount() {
        const savedWeekendEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
        const savedDiscountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
        const weekendDiscountCheckbox = document.querySelector('#Weekend-Discount, input[name="weekend_discount"][type="checkbox"]');
        const weekendDiscountInput = document.querySelector('#weekend_discount, input[name="weekend_discount"][type="text"], input[name="Weekend-Discount"][type="text"]');
        
        if (savedWeekendEnabled && weekendDiscountCheckbox) {
            weekendDiscountCheckbox.checked = true;
            if (weekendDiscountInput) {
                weekendDiscountInput.style.display = 'block';
                if (savedDiscountPercent > 0) {
                    weekendDiscountInput.value = savedDiscountPercent + '%';
                    // Не применяем скидку сразу, дождемся загрузки календаря
                }
            }
        }
    }

    // Selection state methods
    clearWaitState() {
        document.querySelectorAll('.calendar_day-wrapper.is-wait').forEach(day => {
            day.classList.remove('is-wait');
        });
    }

    clearHoverState() {
        document.querySelectorAll('.calendar_day-wrapper.is-hover-range').forEach(day => {
            day.classList.remove('is-hover-range');
        });
        document.querySelectorAll('.calendar_day-wrapper.is-hover-unblock').forEach(day => {
            day.classList.remove('is-hover-unblock');
        });
    }

    cancelLastRange() {
        if (this.data.dateRanges.length > 0) {
            const lastRange = this.data.dateRanges.pop();
            for (let timestamp = lastRange.start.timestamp; 
                 timestamp <= lastRange.end.timestamp; 
                 timestamp += 86400000) {
                delete this.data.dateDiscounts[timestamp];
            }

            this.updateAllDaysDisplay();
            this.toggleSettingsVisibility(false);
            this.selection.isConfirmed = true;
            this.clearHoverState();

            const button_open = document.querySelector('[button_open]');
            if (button_open && this.data.dateRanges.length === 0 && this.data.excludedDays.size === 0) {
                button_open.classList.remove('is--add-service');
            }
        }
    }

    clearAllData() {
        this.data.dateRanges = [];
        this.data.excludedDays.clear();
        this.data.dateDiscounts = {};
        this.data.blockedDates = {};
        this.selection.tempStart = null;
        this.selection.tempStartMonth = null;
        this.selection.tempStartYear = null;
        this.selection.isConfirmed = true;

        this.clearWaitState();
        this.clearHoverState();

        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('monthData-') || key === 'blockedDatesMap') {
                localStorage.removeItem(key);
            }
        });
        
        // Clear and reset weekend discount
        const weekendDiscountCheckbox = document.querySelector('#Weekend-Discount, input[name="weekend_discount"][type="checkbox"]');
        const weekendDiscountInput = document.querySelector('#weekend_discount, input[name="weekend_discount"][type="text"], input[name="Weekend-Discount"][type="text"]');
        if (weekendDiscountCheckbox && weekendDiscountCheckbox.checked) {
            this.removeWeekendDiscount();
            weekendDiscountCheckbox.checked = false;
            weekendDiscountCheckbox.dispatchEvent(new Event('change'));
        }
        if (weekendDiscountInput) {
            weekendDiscountInput.value = '';
            weekendDiscountInput.style.display = 'none';
        }
        
        // Remove weekend discount settings from localStorage
        localStorage.removeItem('weekendDiscountEnabled');
        localStorage.removeItem('weekendDiscountPercent');

        this.updateCalendar();
        this.toggleSettingsVisibility(false);

        const button_open = document.querySelector('[button_open]');
        if (button_open) button_open.classList.remove('is--add-service');
    }

    toggleSettingsVisibility(showChoosen) {
        const settingsElement = document.querySelector('[calendar-settings]');
        const choosenElement = document.querySelector('[calendar-choosen]');
        if (settingsElement) settingsElement.style.display = showChoosen ? 'none' : 'block';
        if (choosenElement) choosenElement.style.display = showChoosen ? 'flex' : 'none';
    }

    updateChosenDates() {
        const chosenDatesElement = document.querySelector('[chosen-dates]');
        if (!chosenDatesElement || this.data.dateRanges.length === 0) return;
        const lastRange = this.data.dateRanges[this.data.dateRanges.length - 1];
        chosenDatesElement.textContent = this.formatDateRange(lastRange);
    }

    formatDateRange(range) {
        const startDay = range.start.day.toString().padStart(2, '0');
        const endDay = range.end.day.toString().padStart(2, '0');
        if (range.start.month === range.end.month && range.start.year === range.end.year) {
            const month = this.reverseMonthMap[range.start.month];
            return `${startDay} - ${endDay} ${month}`;
        } else {
            const startMonth = this.reverseMonthMap[range.start.month];
            const endMonth = this.reverseMonthMap[range.end.month];
            return `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
        }
    }

    blockDateRange(startDay, endDay) {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey) return;
        const [year, month] = monthKey.split('-');
        if (!this.data.blockedDates[monthKey]) this.data.blockedDates[monthKey] = [];

        for (let day = startDay; day <= endDay; day++) {
            const dateStr = this.formatDate(day, month, year);
            const existingIndex = this.data.blockedDates[monthKey].findIndex(item => {
                return (typeof item === 'object' && item.date) ? item.date === dateStr : item === dateStr;
            });
            if (existingIndex === -1) {
                this.data.blockedDates[monthKey].push({ date: dateStr, price: 0 });
            }
        }
        this.updateAllDaysDisplay();
        this.saveMonthData(monthKey);
    }

    unblockDateRange(startDay, endDay) {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey || !this.data.blockedDates[monthKey]) return;
        const [year, month] = monthKey.split('-');

        for (let day = startDay; day <= endDay; day++) {
            const dateStr = this.formatDate(day, month, year);
            this.data.blockedDates[monthKey] = this.data.blockedDates[monthKey].filter(item => {
                return (typeof item === 'object' && item.date) ? item.date !== dateStr : item !== dateStr;
            });
        }

        if (this.data.blockedDates[monthKey].length === 0) {
            delete this.data.blockedDates[monthKey];
        }
        
        this.updateAllDaysDisplay();
        this.saveMonthData(monthKey);
    }

    clearBlockedDate(day) {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey || !this.data.blockedDates[monthKey]) return;
        const [year, month] = monthKey.split('-');
        const dateStr = this.formatDate(day, month, year);

        this.data.blockedDates[monthKey] = this.data.blockedDates[monthKey].filter(item => {
            return (typeof item === 'object' && item.date) ? item.date !== dateStr : item === dateStr;
        });

        if (this.data.blockedDates[monthKey].length === 0) {
            delete this.data.blockedDates[monthKey];
        }
        this.updateAllDaysDisplay();
        this.saveMonthData(monthKey);
    }

    // Database
    async saveToDatabase() {
        if (!this.supabaseClient || !this.serviceId) {
            console.warn('⚠️ Не могу сохранить: отсутствует Supabase client или Service ID');
            return false;
        }

        try {
            console.log('💾 Сохранение в базу данных...');
            
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

            const { error: deleteError } = await this.supabaseClient
                .from('available_periods')
                .delete()
                .eq('service_id', this.serviceId);

            if (deleteError) {
                console.error('❌ Ошибка удаления:', deleteError);
                return false;
            }

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

    // Event handlers
    attachEventHandlers() {
        try {
            this.attachNavigationHandlers();
            this.attachFormSubmissionHandler();
            this.attachPriceChangeHandlers();
            this.attachDaySelectionHandlers();
            this.attachDiscountHandlers();
            this.attachBlockingHandlers();
            this.attachClearHandlers();
        } catch (error) {
            console.error('❌ Ошибка прикрепления обработчиков:', error);
        }
    }

    attachNavigationHandlers() {
        try {
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
        } catch (error) {
            console.error('❌ Ошибка навигационных обработчиков:', error);
        }
    }

    navigateMonth(direction) {
        try {
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
        } catch (error) {
            console.error('❌ Ошибка навигации по месяцам:', error);
        }
    }

    attachFormSubmissionHandler() {
        try {
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
        } catch (error) {
            console.error('❌ Ошибка обработчика отправки формы:', error);
        }
    }

    attachPriceChangeHandlers() {
        try {
            const costInput = this.getCostInput();
            
            if (costInput) {
                costInput.addEventListener('input', () => {
                    const newCost = parseInt(costInput.value);
                    if (!isNaN(newCost) && newCost > 0) {
                        console.log(`💰 Цена изменена в input поле: ${newCost}`);
                        
                        this.data.globalSettings.defaultCost = newCost;
                        
                        if (!this.isEditMode) {
                            localStorage.setItem('calendarGlobalSettings', JSON.stringify(this.data.globalSettings));
                        }
                        
                        // Применяем скидку выходного дня если включена
                        const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
                        const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
                        if (weekendDiscountEnabled && discountPercent > 0) {
                            this.applyWeekendDiscount(discountPercent);
                        }
                        
                        this.updateAllDaysDisplay();
                        
                        console.log(`✅ Календарь обновлен с новой ценой: ${newCost}`);
                    }
                });
                
                costInput.addEventListener('change', () => {
                    this.updateAllDaysDisplay();
                });
            }
        } catch (error) {
            console.error('❌ Ошибка обработчиков изменения цены:', error);
        }
    }

    attachDaySelectionHandlers() {
        document.addEventListener('click', (event) => {
            const dayWrapper = event.target.closest('.calendar_day-wrapper');
            if (!dayWrapper || dayWrapper.classList.contains('not_exist')) return;

            const cell = dayWrapper.querySelector('[day]');
            if (!cell) return;

            const dayText = cell.textContent.trim();
            if (!dayText) return;

            const currentDate = parseInt(dayText);
            const monthYearElement = document.querySelector('[current_month_year]');
            if (!monthYearElement) return;

            const [currentMonthName, currentYear] = monthYearElement.textContent.trim().split(' ');
            const fullDate = this.createFullDate(currentDate, currentMonthName, parseInt(currentYear));
            
            // Специальная обработка для режима разблокировки
            if (this.unblockingMode && dayWrapper.classList.contains('is-blocked')) {
                if (!this.selection.tempStart) {
                    this.clearWaitState();
                    this.selection.tempStart = currentDate;
                    this.selection.tempStartMonth = currentMonthName;
                    this.selection.tempStartYear = parseInt(currentYear);
                    dayWrapper.classList.add('is-wait');
                } else {
                    let startDate = this.selection.tempStart;
                    let endDate = currentDate;
                    
                    if (startDate > endDate) {
                        [startDate, endDate] = [endDate, startDate];
                    }
                    
                    this.unblockDateRange(startDate, endDate);
                    
                    this.clearWaitState();
                    this.selection.tempStart = null;
                    this.selection.tempStartMonth = null;
                    this.selection.tempStartYear = null;
                    
                    // Выходим из режима разблокировки
                    this.unblockingMode = false;
                    this.toggleSettingsVisibility(false);
                    this.selection.isConfirmed = true;
                }
                return;
            }
            
            // Обычная обработка для незаблокированных дат
            if (this.isPastOrCurrentDate(fullDate) || !this.selection.isConfirmed || 
                (dayWrapper.classList.contains('is-blocked') && !this.unblockingMode)) return;

            const isInRange = this.isDateInRanges(fullDate);

            if (isInRange && !this.data.excludedDays.has(fullDate.timestamp)) {
                this.data.excludedDays.add(fullDate.timestamp);
                delete this.data.dateDiscounts[fullDate.timestamp];
                
                const servicePriceElement = dayWrapper.querySelector('[service-price]');
                if (servicePriceElement) servicePriceElement.textContent = this.getDefaultCost() || 0;

                this.clearWaitState();
                this.selection.tempStart = null;
                this.selection.tempStartMonth = null;
                this.selection.tempStartYear = null;
            } else {
                if (!this.selection.tempStart) {
                    this.clearWaitState();
                    if (this.data.excludedDays.has(fullDate.timestamp)) {
                        this.data.excludedDays.delete(fullDate.timestamp);
                    }

                    this.selection.tempStart = currentDate;
                    this.selection.tempStartMonth = currentMonthName;
                    this.selection.tempStartYear = parseInt(currentYear);
                    dayWrapper.classList.add('is-wait');
                    dayWrapper.classList.add('is-selected');
                } else {
                    let startDate = this.createFullDate(
                        this.selection.tempStart, 
                        this.selection.tempStartMonth, 
                        this.selection.tempStartYear
                    );
                    let endDate = fullDate;

                    if (startDate.timestamp > endDate.timestamp) {
                        [startDate, endDate] = [endDate, startDate];
                    }

                    this.data.dateRanges.push({ start: startDate, end: endDate });
                    this.selection.isConfirmed = false;
                    this.toggleSettingsVisibility(true);
                    this.updateChosenDates();

                    const selectedDiscountInput = document.querySelector('#selected_discount');
                    if (selectedDiscountInput) selectedDiscountInput.value = '';

                    this.clearWaitState();
                    this.selection.tempStart = null;
                    this.selection.tempStartMonth = null;
                    this.selection.tempStartYear = null;
                }
            }

            this.updateAllDaysDisplay();

            const button_open = document.querySelector('[button_open]');
            if (button_open && (this.data.dateRanges.length > 0 || this.data.excludedDays.size > 0)) {
                button_open.classList.add('is--add-service');
            }
        });

        document.addEventListener('mouseover', (event) => {
            const dayWrapper = event.target.closest('.calendar_day-wrapper');
            if (!dayWrapper || !this.selection.tempStart || dayWrapper.classList.contains('not_exist') || 
                dayWrapper.classList.contains('is-past')) return;

            const cell = dayWrapper.querySelector('[day]');
            if (!cell) return;

            const dayText = cell.textContent.trim();
            if (!dayText) return;

            const hoveredDate = parseInt(dayText);
            const monthYearElement = document.querySelector('[current_month_year]');
            if (!monthYearElement) return;

            const [monthName, year] = monthYearElement.textContent.trim().split(' ');
            const startDate = this.createFullDate(this.selection.tempStart, this.selection.tempStartMonth, this.selection.tempStartYear);
            const hoveredFullDate = this.createFullDate(hoveredDate, monthName, parseInt(year));

            let rangeStart = startDate;
            let rangeEnd = hoveredFullDate;

            if (startDate.timestamp > hoveredFullDate.timestamp) {
                [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
            }

            this.clearHoverState();

            document.querySelectorAll('.calendar_day-wrapper').forEach(wrapper => {
                const dayEl = wrapper.querySelector('[day]');
                if (!dayEl || wrapper.classList.contains('not_exist')) return;

                const day = parseInt(dayEl.textContent.trim());
                const currentFullDate = this.createFullDate(day, monthName, parseInt(year));

                if (currentFullDate.timestamp >= rangeStart.timestamp && 
                    currentFullDate.timestamp <= rangeEnd.timestamp &&
                    !wrapper.classList.contains('is-past')) {
                    
                    if (this.unblockingMode && wrapper.classList.contains('is-blocked')) {
                        wrapper.classList.add('is-hover-unblock');
                    } else if (!wrapper.classList.contains('is-blocked')) {
                        wrapper.classList.add('is-hover-range');
                    }
                }
            });
        });

        document.addEventListener('mouseleave', (event) => {
            if (!event.target.closest('.calendar_wrap')) return;
            this.clearHoverState();
        });
    }

    attachDiscountHandlers() {
        const applyButton = document.querySelector('[calendar-apply-button]');
        if (applyButton) {
            applyButton.addEventListener('click', (event) => {
                event.preventDefault();
                
                if (this.blockingMode) {
                    const chosenDatesElement = document.querySelector('[chosen-dates]');
                    if (chosenDatesElement) {
                        const dateRangeText = chosenDatesElement.textContent.trim();
                        const dateMatch = dateRangeText.match(/(\d+)\s*-\s*(\d+)\s*(\w+)/);

                        if (dateMatch) {
                          const startDay = parseInt(dateMatch[1]);
                         const endDay = parseInt(dateMatch[2]);
                         this.blockDateRange(startDay, endDay);
                     }
                 }
                 
                 this.blockingMode = false;
                 
                 const button_open = document.querySelector('[button_open]');
                 const blockButton = document.querySelector('[button_block]');
                 if (button_open) button_open.classList.add('is--add-service');
                 if (blockButton) blockButton.classList.remove('is--add-service');
                 
                 const discountWrapper = document.querySelector('.input-wrap:has(#selected_discount)');
                 if (discountWrapper) discountWrapper.style.display = '';
                 
                 const selectedDiscountInput = document.querySelector('#selected_discount');
                 if (selectedDiscountInput) {
                     selectedDiscountInput.placeholder = '';
                     selectedDiscountInput.disabled = false;
                 }
                 
                 this.cancelLastRange();
             } else {
                 this.applyDiscountToRange();
             }
         });
     }

     const cancelButton = document.querySelector('[calendar-choosen-cancel]');
     if (cancelButton) {
         cancelButton.addEventListener('click', (event) => {
             event.preventDefault();
             
             if (this.blockingMode) {
                 this.blockingMode = false;
                 const blockButton = document.querySelector('[button_block]');
                 if (blockButton) blockButton.classList.remove('is--add-service');
                 
                 const discountWrapper = document.querySelector('.input-wrap:has(#selected_discount)');
                 if (discountWrapper) discountWrapper.style.display = '';
                 
                 const selectedDiscountInput = document.querySelector('#selected_discount');
                 if (selectedDiscountInput) {
                     selectedDiscountInput.placeholder = '';
                     selectedDiscountInput.disabled = false;
                 }
             }
             
             if (this.unblockingMode) {
                 this.unblockingMode = false;
                 this.clearWaitState();
                 this.selection.tempStart = null;
                 this.selection.tempStartMonth = null;
                 this.selection.tempStartYear = null;
             }
             
             this.cancelLastRange();
         });
     }

     // Weekend discount checkbox handling
     const weekendDiscountCheckbox = document.querySelector('#Weekend-Discount, input[name="weekend_discount"][type="checkbox"]');
     const weekendDiscountInput = document.querySelector('#weekend_discount, input[name="weekend_discount"][type="text"], input[name="Weekend-Discount"][type="text"]');
     
     if (weekendDiscountCheckbox && weekendDiscountInput) {
         const toggleWeekendInput = (show) => {
             weekendDiscountInput.style.display = show ? 'block' : 'none';
         };

         weekendDiscountCheckbox.addEventListener('change', (event) => {
             const isChecked = event.target.checked;
             toggleWeekendInput(isChecked);
             localStorage.setItem('weekendDiscountEnabled', isChecked);
             
             if (isChecked) {
                 const discountPercent = parseFloat(weekendDiscountInput.value.replace(/[^\d.]/g, '')) || 0;
                 if (discountPercent > 0) {
                     localStorage.setItem('weekendDiscountPercent', discountPercent);
                     this.applyWeekendDiscount(discountPercent);
                 }
             } else {
                 localStorage.removeItem('weekendDiscountPercent');
                 this.removeWeekendDiscount();
             }
         });

         weekendDiscountInput.addEventListener('input', (event) => {
             let value = event.target.value;
             let numericValue = value.replace(/[^\d.]/g, '');
             let discountPercent = parseFloat(numericValue) || 0;
             
             if (value !== numericValue) {
                 event.target.value = numericValue;
             }
             
             if (discountPercent > 0) {
                 localStorage.setItem('weekendDiscountPercent', discountPercent);
             }
             if (weekendDiscountCheckbox.checked && discountPercent > 0 && this.getDefaultCost()) {
                 this.applyWeekendDiscount(discountPercent);
             }
             event.target.style.display = 'block';
         });

         weekendDiscountInput.addEventListener('blur', (event) => {
             let value = event.target.value;
             let numericValue = parseFloat(value);
             
             if (!isNaN(numericValue) && numericValue > 0 && !value.includes('%')) {
                 event.target.value = numericValue + '%';
             }
             
             if (weekendDiscountCheckbox.checked) {
                 event.target.style.display = 'block';
             }
         });
         
         weekendDiscountInput.addEventListener('focus', (event) => {
             let value = event.target.value;
             if (value.includes('%')) {
                 event.target.value = value.replace('%', '');
             }
             event.stopPropagation();
         });

         const savedWeekendEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
         const savedDiscountPercent = localStorage.getItem('weekendDiscountPercent');
         
         if (savedWeekendEnabled) {
             weekendDiscountCheckbox.checked = true;
             toggleWeekendInput(true);
             if (savedDiscountPercent) {
                 weekendDiscountInput.value = savedDiscountPercent + '%';
             }
         } else {
             toggleWeekendInput(false);
         }
     }

     const selectedDiscountInput = document.querySelector('#selected_discount');
     if (selectedDiscountInput) {
         selectedDiscountInput.addEventListener('input', (event) => {
             let value = event.target.value;
             let numericValue = value.replace(/[^\d.]/g, '');
             
             if (value !== numericValue) {
                 event.target.value = numericValue;
             }
         });
         
         selectedDiscountInput.addEventListener('blur', (event) => {
             let value = event.target.value;
             let numericValue = parseFloat(value);
             
             if (!isNaN(numericValue) && numericValue > 0 && !value.includes('%')) {
                 event.target.value = numericValue + '%';
             }
         });
         
         selectedDiscountInput.addEventListener('focus', (event) => {
             let value = event.target.value;
             if (value.includes('%')) {
                 event.target.value = value.replace('%', '');
             }
         });
     }
 }

 attachBlockingHandlers() {
     const blockButton = document.querySelector('[button_block]');
     const chosenDatesElement = document.querySelector('[chosen-dates]');

     if (blockButton && chosenDatesElement) {
         blockButton.addEventListener('click', (event) => {
             event.preventDefault();
             this.blockingMode = true;
             
             const button_open = document.querySelector('[button_open]');
             if (button_open) button_open.classList.remove('is--add-service');
             blockButton.classList.add('is--add-service');
             
             const discountWrapper = document.querySelector('.input-wrap:has(#selected_discount)');
             if (discountWrapper) discountWrapper.style.display = 'none';
             
             const selectedDiscountInput = document.querySelector('#selected_discount');
             if (selectedDiscountInput) {
                 selectedDiscountInput.placeholder = 'Block';
                 selectedDiscountInput.disabled = true;
             }
         });
     }

     const openButton = document.querySelector('[button_open]');
     if (openButton) {
         openButton.addEventListener('click', (event) => {
             event.preventDefault();
             if (this.blockingMode) {
                 this.blockingMode = false;
                 
                 openButton.classList.add('is--add-service');
                 const blockButton = document.querySelector('[button_block]');
                 if (blockButton) blockButton.classList.remove('is--add-service');
                 
                 const discountWrapper = document.querySelector('.input-wrap:has(#selected_discount)');
                 if (discountWrapper) discountWrapper.style.display = '';
                 
                 const selectedDiscountInput = document.querySelector('#selected_discount');
                 if (selectedDiscountInput) {
                     selectedDiscountInput.placeholder = '';
                     selectedDiscountInput.disabled = false;
                 }
             }
         });
     }

     // Добавляем кнопку для разблокировки
     const unblockButton = document.querySelector('[button_unblock]');
     if (unblockButton) {
         unblockButton.addEventListener('click', (event) => {
             event.preventDefault();
             this.unblockingMode = true;
             this.selection.isConfirmed = true;
             
             // Показываем интерфейс выбора
             this.toggleSettingsVisibility(true);
             const chosenDatesElement = document.querySelector('[chosen-dates]');
             if (chosenDatesElement) {
                 chosenDatesElement.textContent = 'Select blocked dates to unblock';
             }
             
             console.log('🔓 Режим разблокировки активирован');
         });
     }
 }

 attachClearHandlers() {
     const clearButton = document.querySelector('[clear-dates]');
     if (clearButton) {
         clearButton.addEventListener('click', (event) => {
             event.preventDefault();
             this.clearAllData();
         });
     }
 }

 // Fallback calendar for emergency cases
 createFallbackCalendar() {
     console.log('🚨 Создание резервного календаря...');
     
     const defaultPrice = this.getDefaultCost() || 0;
     
     document.querySelectorAll('[service-price]').forEach(priceEl => {
         const dayWrapper = priceEl.closest('.calendar_day-wrapper');
         if (dayWrapper && !dayWrapper.classList.contains('is-past') && !dayWrapper.classList.contains('not_exist')) {
             priceEl.textContent = defaultPrice;
         }
     });
     
     console.log('✅ Резервный календарь создан');
 }

 // Public methods for external use
 getCalendarData() {
     return {
         basePrices: this.data.basePrices,
         blockedDates: this.data.blockedDates,
         dateRanges: this.data.dateRanges,
         excludedDays: this.data.excludedDays,
         dateDiscounts: this.data.dateDiscounts,
         serviceId: this.serviceId,
         isEditMode: this.isEditMode,
         isInitialized: this.isInitialized
     };
 }

 async reload() {
     console.log('🔄 Перезагрузка календаря...');
     try {
         await this.loadData();
         this.updateCalendar();
     } catch (error) {
         console.error('❌ Ошибка перезагрузки:', error);
     }
 }

 setPrice(day, price) {
     try {
         const monthKey = this.getCurrentMonthKey();
         if (!monthKey) return;
         
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
     } catch (error) {
         console.error('❌ Ошибка установки цены:', error);
     }
 }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
 console.log('🚀 Запуск Enhanced Calendar Manager...');
 
 try {
     window.calendarManager = new FixedCalendarManager();
     
     // API interface
     window.calendarAPI = {
         getManager: () => window.calendarManager,
         getStatus: () => window.calendarManager.getCalendarData(),
         reload: () => window.calendarManager.reload(),
         saveToDatabase: () => window.calendarManager.saveToDatabase(),
         setPrice: (day, price) => window.calendarManager.setPrice(day, price),
         setDefaultCost: (cost) => {
             window.calendarManager.data.globalSettings.defaultCost = cost;
             const costInput = window.calendarManager.getCostInput();
             if (costInput) costInput.value = cost;
             window.calendarManager.updateAllDaysDisplay();
         },
         clearAllData: () => window.calendarManager.clearAllData(),
         fixPrices: () => {
             const defaultPrice = window.calendarManager.getDefaultCost();
             if (!defaultPrice) {
                 console.warn('⚠️ Не могу исправить цены: базовая цена не установлена');
                 return;
             }
             document.querySelectorAll('[service-price]').forEach(priceEl => {
                 const dayWrapper = priceEl.closest('.calendar_day-wrapper');
                 if (dayWrapper && !dayWrapper.classList.contains('is-past') && !dayWrapper.classList.contains('not_exist')) {
                     priceEl.textContent = defaultPrice;
                 }
             });
             console.log(`✅ Цены исправлены на ${defaultPrice}`);
         },
         applyWeekendDiscount: (percent) => {
             if (!window.calendarManager.getDefaultCost()) {
                 console.warn('⚠️ Установите базовую цену перед применением скидки');
                 return;
             }
             localStorage.setItem('weekendDiscountEnabled', 'true');
             localStorage.setItem('weekendDiscountPercent', percent);
             window.calendarManager.applyWeekendDiscount(percent);
         },
         removeWeekendDiscount: () => {
             localStorage.removeItem('weekendDiscountEnabled');
             localStorage.removeItem('weekendDiscountPercent');
             window.calendarManager.removeWeekendDiscount();
         }
     };
     
     console.log('🛠️ API доступен в window.calendarAPI');
     console.log('📋 Доступные методы:');
     console.log('- calendarAPI.getStatus() - получить текущее состояние');
     console.log('- calendarAPI.reload() - перезагрузить календарь');
     console.log('- calendarAPI.saveToDatabase() - сохранить в БД');
     console.log('- calendarAPI.setPrice(day, price) - установить цену для дня');
     console.log('- calendarAPI.setDefaultCost(cost) - установить базовую цену');
     console.log('- calendarAPI.clearAllData() - очистить все выбранные даты');
     console.log('- calendarAPI.fixPrices() - исправить все цены на базовую');
     console.log('- calendarAPI.applyWeekendDiscount(percent) - применить скидку выходного дня');
     console.log('- calendarAPI.removeWeekendDiscount() - удалить скидку выходного дня');
     
 } catch (error) {
     console.error('❌ Критическая ошибка инициализации:', error);
     
     // Create minimal fallback
     window.calendarAPI = {
         fixPrices: () => {
             const costInput = document.querySelector('#cost_per_show');
             const defaultPrice = costInput && costInput.value ? parseInt(costInput.value) : 0;
             
             if (!defaultPrice) {
                 console.warn('⚠️ Установите цену в поле cost_per_show');
                 return;
             }
             
             document.querySelectorAll('[service-price]').forEach(priceEl => {
                 const dayWrapper = priceEl.closest('.calendar_day-wrapper');
                 if (dayWrapper && !dayWrapper.classList.contains('is-past') && !dayWrapper.classList.contains('not_exist')) {
                     priceEl.textContent = defaultPrice;
                 }
             });
             console.log(`✅ Экстренное исправление цен: ${defaultPrice}`);
         },
         clearAllData: () => {
             console.log('⚠️ Функция очистки недоступна в режиме fallback');
         }
     };
 }
});
