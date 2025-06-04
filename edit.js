<script>
class CalendarManager {
    constructor() {
        this.data = {
            basePrices: {},
            blockedDates: {},
            dateRanges: [],
            excludedDays: new Set(),
            dateDiscounts: {},
            globalSettings: {defaultCost: 8000}
        };
        this.selection = {
            tempStart: null,
            tempStartMonth: null,
            tempStartYear: null,
            isConfirmed: true
        };
        this.blockingMode = false;
        this.monthMap = {
            'January':'01','February':'02','March':'03','April':'04',
            'May':'05','June':'06','July':'07','August':'08',
            'September':'09','October':'10','November':'11','December':'12'
        };
        this.reverseMonthMap = Object.fromEntries(Object.entries(this.monthMap).map(([k,v])=>[v,k]));
        this.serviceId = null;
        this.supabaseClient = null;
        this.isEditMode = false;
        this.initComplete = false;
        this.init();
    }

    async init() {
        console.log('🚀 Initializing Calendar Manager...');
        
        this.addStyles();
        this.setCurrentDate();
        
        // Wait a bit for DOM to be ready
        await this.waitForDOM();
        
        // Initialize Supabase connection
        await this.initializeSupabase();
        
        // Check if we're in edit mode
        await this.checkEditMode();
        
        // Load settings first
        this.loadGlobalSettings();
        
        // Load data based on mode
        if (this.isEditMode && this.serviceId) {
            console.log('📊 Loading data from database for service:', this.serviceId);
            await this.loadServiceDataFromDatabase();
        } else {
            console.log('💾 Using localStorage mode');
        }
        
        // Initialize calendar
        this.updateCalendar();
        this.attachEventHandlers();
        this.updatePrevMonthButtonState();
        
        // Handle weekend discount
        this.initializeWeekendDiscount();
        
        this.initComplete = true;
        console.log('✅ Calendar Manager initialized successfully');
        console.log('Edit Mode:', this.isEditMode, 'Service ID:', this.serviceId);
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

    async initializeSupabase() {
        if (typeof supabase !== "undefined") {
            const SUPABASE_URL = 'https://jymaupdlljtwjxiiistn.supabase.co';
            const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5bWF1cGRsbGp0d2p4aWlpc3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg5MTcxMTgsImV4cCI6MjA1NDQ5MzExOH0.3K22PNYIHh8NCreiG0NBtn6ITFrL3cVmSS5KCG--niY';
            this.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Supabase client initialized');
        } else {
            console.warn('⚠️ Supabase not available');
        }
    }

    async checkEditMode() {
        // Check URL parameters for service ID
        const urlParams = new URLSearchParams(window.location.search);
        const serviceIdFromUrl = urlParams.get('service_id') || urlParams.get('id');
        
        // Check for hidden input with service ID
        const serviceIdInput = document.querySelector('input[name="service_id"]') || 
                              document.querySelector('input[data-name="service_id"]') ||
                              document.querySelector('#service_id');
        
        const serviceIdFromInput = serviceIdInput ? serviceIdInput.value : null;
        
        // Priority: URL parameter > input field
        this.serviceId = serviceIdFromUrl || serviceIdFromInput;
        
        if (this.serviceId) {
            this.isEditMode = true;
            console.log('📝 Edit mode detected, service ID:', this.serviceId);
        } else {
            this.isEditMode = false;
            console.log('🆕 Create mode detected');
        }
    }

    async loadServiceDataFromDatabase() {
        if (!this.supabaseClient || !this.serviceId) {
            console.warn('⚠️ Cannot load service data: missing Supabase client or service ID');
            return;
        }

        try {
            console.log('🔄 Loading service data from database...');
            const { data, error } = await this.supabaseClient
                .from('available_periods')
                .select('*')
                .eq('service_id', this.serviceId)
                .order('date', { ascending: true });

            if (error) {
                console.error('❌ Error loading service data:', error);
                return;
            }

            if (data && data.length > 0) {
                console.log('✅ Loaded service data:', data.length, 'periods');
                this.processServiceData(data);
            } else {
                console.log('ℹ️ No existing data found for service:', this.serviceId);
                // Initialize with default prices for edit mode
                this.initializeDefaultPrices();
            }
        } catch (error) {
            console.error('❌ Error loading service data:', error);
        }
    }

    processServiceData(periods) {
        console.log('🔄 Processing service data...');
        
        // Clear existing data
        this.data.basePrices = {};
        this.data.blockedDates = {};
        
        // Group periods by month
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
                periodsByMonth[monthKey] = {
                    prices: [],
                    defaultCost: this.getDefaultCost()
                };
            }
            
            periodsByMonth[monthKey].prices.push({
                date: dateStr,
                price: period.price
            });
            
            // Track first valid price for default cost
            if (!firstValidPrice && period.price > 0) {
                firstValidPrice = period.price;
            }
            
            // Track blocked dates (price = 0)
            if (period.price === 0) {
                if (!this.data.blockedDates[monthKey]) {
                    this.data.blockedDates[monthKey] = [];
                }
                this.data.blockedDates[monthKey].push({
                    date: dateStr,
                    price: 0
                });
            }
        });
        
        // Set the processed data
        this.data.basePrices = periodsByMonth;
        
        // Update default cost from the first non-zero price found
        if (firstValidPrice) {
            this.data.globalSettings.defaultCost = firstValidPrice;
            const costInput = document.querySelector('input[name="cost_per_show"]');
            if (costInput && !costInput.value) {
                costInput.value = firstValidPrice;
            }
        }
        
        console.log('✅ Service data processed, months:', Object.keys(periodsByMonth).length);
    }

    initializeDefaultPrices() {
        // For edit mode when no data exists, initialize with default prices
        const defaultCost = this.getDefaultCost();
        const monthKey = this.getCurrentMonthKey();
        if (monthKey) {
            this.ensureBasePrices(monthKey);
        }
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .calendar_day-wrapper.is-past {opacity:0.5;cursor:not-allowed;pointer-events:none;background-color:#f0f0f0;}
            .calendar_day-wrapper.is-past [service-price],.calendar_day-wrapper.is-past [price-currency] {color:#999;}
            .calendar_day-wrapper.is-blocked.is-blocked-active {background-color:#ffebee!important;border:1px solid #f44336!important;}
            .calendar_day-wrapper.is-selected {background-color:#f3fcc8;color:#222A37!important;border:1px solid #7A869A!important;}
            .calendar_day-wrapper.is-wait {background-color:#F6F8FC;color:#222A37!important;border:1px solid #7A869A!important;}
            .calendar_day-wrapper.is-active {background-color:#f3fcc8;color:#222A37;}
            .calendar_day-wrapper.is-hover-range {background-color:#F6F8FC;transition:background-color 0.2s ease;}
            .calendar_day-wrapper.is-weekend-discount {background-color:#f0f9ff;border:1px solid #60a5fa!important;}
            .calendar_day-wrapper.is-database-loaded {border:2px solid #4caf50!important;}
        `;
        document.head.appendChild(style);
    }

    getCurrentMonthKey() {
        const element = document.querySelector('[current_month_year]');
        if (!element) return null;
        const [monthName, year] = element.textContent.trim().split(' ');
        return `${year}-${this.monthMap[monthName]}`;
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

    isPastDate(dateStr) {
        const [day, month, year] = dateStr.split('.').map(Number);
        const dateObj = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dateObj.setHours(0, 0, 0, 0);
        return dateObj < today;
    }

    isPastOrCurrentDate(fullDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateToCheck = new Date(fullDate.timestamp);
        dateToCheck.setHours(0, 0, 0, 0);
        return dateToCheck < today;
    }

    isDateInRanges(fullDate) {
        return this.data.dateRanges.some(range => 
            fullDate.timestamp >= range.start.timestamp &&
            fullDate.timestamp <= range.end.timestamp
        );
    }

    isWeekend(dateStr) {
        const [day, month, year] = dateStr.split('.').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        return dayOfWeek === 0 || dayOfWeek === 6;
    }

    getDefaultCost() {
        // First check if we have a saved default cost
        if (this.data.globalSettings.defaultCost && this.data.globalSettings.defaultCost > 0) {
            return this.data.globalSettings.defaultCost;
        }
        
        // Then check input field
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput && costInput.value) {
            const value = parseInt(costInput.value);
            if (!isNaN(value) && value > 0) {
                this.data.globalSettings.defaultCost = value;
                return value;
            }
        }
        
        // Default fallback
        return 8000;
    }

    loadGlobalSettings() {
        if (!this.isEditMode) {
            const stored = localStorage.getItem('calendarGlobalSettings');
            if (stored) {
                this.data.globalSettings = JSON.parse(stored);
            }
        }
        
        // Ensure we have a default cost
        if (!this.data.globalSettings.defaultCost) {
            this.data.globalSettings.defaultCost = 8000;
        }
        
        // Update cost input if it's empty
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput && !costInput.value) {
            costInput.value = this.data.globalSettings.defaultCost;
        }
    }

    saveGlobalSettings() {
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput) {
            this.data.globalSettings.defaultCost = parseInt(costInput.value) || 8000;
            if (!this.isEditMode) {
                localStorage.setItem('calendarGlobalSettings', JSON.stringify(this.data.globalSettings));
            }
            this.updateAllMonthsWithNewPrice();
        }
    }

    loadMonthData(monthKey) {
        if (this.isEditMode) {
            // In edit mode, data is already loaded from database
            this.ensureBasePrices(monthKey);
            return;
        }

        // Original localStorage logic for create mode
        const stored = localStorage.getItem(`monthData-${monthKey}`);
        const blocked = localStorage.getItem('blockedDatesMap');
        
        if (stored) {
            this.data.basePrices[monthKey] = JSON.parse(stored);
        } else {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: this.getDefaultCost()};
        }
        
        if (blocked) this.data.blockedDates = JSON.parse(blocked);
        
        this.ensureBasePrices(monthKey);
        
        // Apply weekend discount if enabled
        this.applyWeekendDiscountIfEnabled(monthKey);
    }

    applyWeekendDiscountIfEnabled(monthKey) {
        const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
        const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
        
        if (weekendDiscountEnabled && discountPercent > 0) {
            const [year, month] = monthKey.split('-');
            const basePrice = this.getDefaultCost();
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

    saveMonthData(monthKey) {
        if (this.isEditMode) {
            // In edit mode, we'll save to database on form submission
            return;
        }

        // Original localStorage logic for create mode
        localStorage.setItem(`monthData-${monthKey}`, JSON.stringify(this.data.basePrices[monthKey]));
        if (Object.keys(this.data.blockedDates).length > 0) {
            localStorage.setItem('blockedDatesMap', JSON.stringify(this.data.blockedDates));
        }
    }

    ensureBasePrices(monthKey) {
        const [year, month] = monthKey.split('-');
        const defaultCost = this.getDefaultCost();
        
        if (!this.data.basePrices[monthKey]) {
            this.data.basePrices[monthKey] = {prices: [], defaultCost: defaultCost};
        }
        
        const existingDates = new Set(this.data.basePrices[monthKey].prices.map(item => item.date));
        
        // Check weekend discount settings
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
            }
        });
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
        this.updateAllDaysDisplay();
    }

    updateCalendar() {
        const monthYearElement = document.querySelector('[current_month_year]');
        if (!monthYearElement) return;
        
        const [monthName, year] = monthYearElement.textContent.trim().split(' ');
        const monthNum = parseInt(this.monthMap[monthName]);
        
        this.generateCalendar(monthNum, parseInt(year));
        
        setTimeout(() => {
            this.loadMonthData(this.getCurrentMonthKey());
            this.loadMonthPrices();
            this.updatePrevMonthButtonState();
            
            // Reapply weekend discount if needed
            const weekendDiscountCheckbox = document.querySelector('input[name="weekend_discount"][type="checkbox"]');
            if (weekendDiscountCheckbox && weekendDiscountCheckbox.checked) {
                const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
                if (discountPercent > 0) {
                    this.applyWeekendDiscount(discountPercent);
                }
            }
        }, 50);
    }

    updateAllDaysDisplay() {
        const monthYearElement = document.querySelector('[current_month_year]');
        if (!monthYearElement) return;
        
        const [monthName, year] = monthYearElement.textContent.trim().split(' ');
        const monthKey = this.getCurrentMonthKey();
        const basePrice = this.getDefaultCost();
        
        const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
        const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
        const discountedPrice = weekendDiscountEnabled && discountPercent > 0 
            ? this.applyDiscount(basePrice, discountPercent) 
            : basePrice;

        document.querySelectorAll('.calendar_day-wrapper').forEach(dayWrapper => {
            const cell = dayWrapper.querySelector('[day]');
            if (!cell) return;
            const dayText = cell.textContent.trim();
            if (!dayText) return;

            const day = parseInt(dayText);
            const fullDate = this.createFullDate(day, monthName, parseInt(year));
            const dateStr = this.formatDate(day, this.monthMap[monthName], year);
            const timestamp = fullDate.timestamp;

            const isInRange = this.isDateInRanges(fullDate);
            const isExcluded = this.data.excludedDays.has(timestamp);
            const isPast = this.isPastOrCurrentDate(fullDate);
            const isBlocked = this.isDateBlocked(dateStr, monthKey);

            // Clear all state classes
            dayWrapper.classList.remove('is-past', 'is-blocked', 'is-blocked-active', 
                                      'is-selected', 'is-wait', 'is-active', 
                                      'is-weekend-discount', 'is-database-loaded');

            // Apply state classes
            if (isPast) dayWrapper.classList.add('is-past');
            if (isBlocked) {
                dayWrapper.classList.add('is-blocked', 'is-blocked-active');
            }
            
            // Add database-loaded styling in edit mode
            if (this.isEditMode && this.hasDateInDatabase(dateStr, monthKey)) {
                dayWrapper.classList.add('is-database-loaded');
            }
            
            if (!isPast && !isBlocked) {
                if (isInRange && !isExcluded) dayWrapper.classList.add('is-selected');
                if (this.data.dateDiscounts[timestamp] !== undefined && !isExcluded) {
                    dayWrapper.classList.add('is-active');
                }
            }

            // Update price display
            const servicePriceElement = dayWrapper.querySelector('[service-price]');
            if (servicePriceElement) {
                let finalPrice;
                
                if (isPast || isBlocked) {
                    finalPrice = 0;
                } else if (isExcluded) {
                    finalPrice = basePrice;
                } else if (this.data.dateDiscounts[timestamp] !== undefined) {
                    finalPrice = this.data.dateDiscounts[timestamp];
                } else if (weekendDiscountEnabled && discountPercent > 0 && this.isWeekend(dateStr)) {
                    finalPrice = discountedPrice;
                    dayWrapper.classList.add('is-weekend-discount');
                } else {
                    finalPrice = basePrice;
                }
                
                servicePriceElement.textContent = finalPrice;
            }

            // Handle wait state
            if (!isPast && this.selection.tempStart === day &&
                this.selection.tempStartMonth === monthName &&
                this.selection.tempStartYear === parseInt(year)) {
                dayWrapper.classList.add('is-wait');
            }
        });
        
        this.saveMonthData(monthKey);
    }

    hasDateInDatabase(dateStr, monthKey) {
        if (!this.isEditMode || !this.data.basePrices[monthKey] || !this.data.basePrices[monthKey].prices) {
            return false;
        }
        return this.data.basePrices[monthKey].prices.some(item => item.date === dateStr);
    }

    loadMonthPrices() {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey) return;
        
        const [year, month] = monthKey.split('-');
        const monthPrices = this.data.basePrices[monthKey]?.prices || [];
        const defaultCost = this.getDefaultCost();
        
        const weekendDiscountEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
        const discountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
        const discountedPrice = weekendDiscountEnabled && discountPercent > 0 
            ? this.applyDiscount(defaultCost, discountPercent) 
            : defaultCost;

        document.querySelectorAll('.calendar_day-wrapper:not(.not_exist)').forEach(dayWrapper => {
            const dayElement = dayWrapper.querySelector('[day]');
            const servicePriceElement = dayWrapper.querySelector('[service-price]');
            if (!dayElement || !servicePriceElement) return;

            const dayText = dayElement.textContent.trim();
            if (!dayText) return;
            
            const day = parseInt(dayText);
            if (isNaN(day)) return;
            
            const date = this.formatDate(day, month, year);
            const priceObj = monthPrices.find(item => item.date === date);
            const isPast = this.isPastDate(date);
            const isBlocked = this.isDateBlocked(date, monthKey);
            
            // Clear existing classes
            dayWrapper.classList.remove('is-past', 'is-blocked', 'is-blocked-active', 
                                      'is-weekend-discount', 'is-database-loaded');
            
            // Apply state classes
            if (isPast) dayWrapper.classList.add('is-past');
            if (isBlocked) dayWrapper.classList.add('is-blocked', 'is-blocked-active');
            
            let finalPrice;
            if (isPast || isBlocked) {
                finalPrice = 0;
            } else if (priceObj) {
                finalPrice = priceObj.price;
                if (this.isEditMode) {
                    dayWrapper.classList.add('is-database-loaded');
                }
            } else if (weekendDiscountEnabled && discountPercent > 0 && this.isWeekend(date)) {
                finalPrice = discountedPrice;
                dayWrapper.classList.add('is-weekend-discount');
            } else {
                finalPrice = defaultCost;
            }
            
            servicePriceElement.textContent = finalPrice;
        });
    }

    initializeWeekendDiscount() {
        const savedWeekendEnabled = localStorage.getItem('weekendDiscountEnabled') === 'true';
        const savedDiscountPercent = parseFloat(localStorage.getItem('weekendDiscountPercent')) || 0;
        const weekendDiscountCheckbox = document.querySelector('#Weekend-Discount, input[name="weekend_discount"][type="checkbox"]');
        const weekendDiscountInput = document.querySelector('#weekend_discount, input[name="weekend_discount"][type="text"]');
        
        if (savedWeekendEnabled && weekendDiscountCheckbox) {
            weekendDiscountCheckbox.checked = true;
            if (weekendDiscountInput) {
                weekendDiscountInput.style.display = 'block';
                if (savedDiscountPercent > 0) {
                    weekendDiscountInput.value = savedDiscountPercent + '%';
                    this.applyWeekendDiscount(savedDiscountPercent);
                }
            }
        }
    }

    isDateBlocked(dateStr, monthKey) {
        if (!this.data.blockedDates[monthKey]) return false;
        return this.data.blockedDates[monthKey].some(item => {
            return (typeof item === 'object' && item.date) ? item.date === dateStr : item === dateStr;
        });
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
            
            // Also update the base prices to reflect blocking
            if (this.data.basePrices[monthKey] && this.data.basePrices[monthKey].prices) {
                const priceIndex = this.data.basePrices[monthKey].prices.findIndex(item => item.date === dateStr);
                if (priceIndex !== -1) {
                    this.data.basePrices[monthKey].prices[priceIndex].price = 0;
                } else {
                    this.data.basePrices[monthKey].prices.push({ date: dateStr, price: 0 });
                }
            }
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
            return (typeof item === 'object' && item.date) ? item.date !== dateStr : item !== dateStr;
        });

        if (this.data.blockedDates[monthKey].length === 0) {
            delete this.data.blockedDates[monthKey];
        }

        // Also update the base prices to reflect unblocking
        if (this.data.basePrices[monthKey] && this.data.basePrices[monthKey].prices) {
            const priceIndex = this.data.basePrices[monthKey].prices.findIndex(item => item.date === dateStr);
            if (priceIndex !== -1) {
                this.data.basePrices[monthKey].prices[priceIndex].price = this.getDefaultCost();
            }
        }

        this.updateAllDaysDisplay();
        this.saveMonthData(monthKey);
    }

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

            const dayText = dayElement.textContent.trim();
            if (!dayText) return;
            const day = parseInt(dayText);
            if (isNaN(day)) return;
            const date = this.formatDate(day, month, year);
            if (this.isPastDate(date) || this.isDateBlocked(date, monthKey)) return;

            if (this.isWeekend(date)) {
                servicePriceElement.textContent = discountedPrice;
                dayWrapper.classList.add('is-weekend-discount');
            }
        });
        this.saveMonthData(monthKey);
    }

    removeWeekendDiscount() {
        const monthKey = this.getCurrentMonthKey();
        if (!monthKey) return;
        const basePrice = this.getDefaultCost();

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

            const dayText = dayElement.textContent.trim();
            if (!dayText) return;
            const day = parseInt(dayText);
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

    // Database methods
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async saveServiceDataToDatabase() {
        if (!this.supabaseClient || !this.serviceId) {
            console.warn('⚠️ Cannot save service data: missing Supabase client or service ID');
            return false;
        }

        try {
            console.log('💾 Saving calendar data to database...');
            
            // First, delete existing periods for this service
            const { error: deleteError } = await this.supabaseClient
                .from('available_periods')
                .delete()
                .eq('service_id', this.serviceId);

            if (deleteError) {
                console.error('❌ Error deleting existing periods:', deleteError);
                return false;
            }

            // Prepare new periods data
            const periodsToInsert = [];
            
            Object.keys(this.data.basePrices).forEach(monthKey => {
                const monthData = this.data.basePrices[monthKey];
                if (monthData && monthData.prices) {
                    monthData.prices.forEach(priceItem => {
                        const [day, month, year] = priceItem.date.split('.');
                        const date = `${year}-${month}-${day}`;
                        
                        periodsToInsert.push({
                            id: this.generateUUID(),
                            service_id: this.serviceId,
                            date: date,
                            price: priceItem.price || 0
                        });
                    });
                }
            });

            if (periodsToInsert.length > 0) {
                console.log('📤 Inserting', periodsToInsert.length, 'periods');
                const { error: insertError } = await this.supabaseClient
                    .from('available_periods')
                    .insert(periodsToInsert);

                if (insertError) {
                    console.error('❌ Error inserting periods:', insertError);
                    return false;
                }
            }

            console.log('✅ Service data saved successfully');
            return true;
        } catch (error) {
            console.error('❌ Error saving service data:', error);
            return false;
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

        // Only clear localStorage in create mode
        if (!this.isEditMode) {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('monthData-') || key === 'blockedDatesMap') {
                    localStorage.removeItem(key);
                }
            });
            
            localStorage.removeItem('weekendDiscountEnabled');
            localStorage.removeItem('weekendDiscountPercent');
        }
        
        const weekendDiscountCheckbox = document.querySelector('input[name="weekend_discount"][type="checkbox"]');
        const weekendDiscountInput = document.querySelector('input[name="Weekend-Discount"][type="text"]');
        if (weekendDiscountCheckbox && weekendDiscountCheckbox.checked) {
            this.removeWeekendDiscount();
            weekendDiscountCheckbox.checked = false;
            weekendDiscountCheckbox.dispatchEvent(new Event('change'));
        }
        if (weekendDiscountInput) {
            weekendDiscountInput.value = '';
            weekendDiscountInput.style.display = 'none';
        }

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

    setCurrentDate() {
        const now = new Date();
        const currentMonth = this.reverseMonthMap[(now.getMonth() + 1).toString().padStart(2, '0')];
        const currentYear = now.getFullYear();
        const monthYearElement = document.querySelector('[current_month_year]');
        if (monthYearElement) monthYearElement.textContent = `${currentMonth} ${currentYear}`;
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

        if (!canGoBack) {
            prevButton.classList.add('disabled');
            prevButton.style.opacity = '0.5';
            prevButton.style.cursor = 'not-allowed';
            prevButton.style.pointerEvents = 'none';
        } else {
            prevButton.classList.remove('disabled');
            prevButton.style.opacity = '1';
            prevButton.style.cursor = 'pointer';
            prevButton.style.pointerEvents = 'auto';
        }
    }

    attachEventHandlers() {
        this.attachNavigationHandlers();
        this.attachDaySelectionHandlers();
        this.attachDiscountHandlers();
        this.attachBlockingHandlers();
        this.attachClearHandlers();
        this.attachPriceChangeHandlers();
        this.attachFormSubmissionHandler();
    }

    attachFormSubmissionHandler() {
        const form = document.querySelector('form');
        if (form && this.isEditMode) {
            form.addEventListener('submit', async (event) => {
                try {
                    await this.saveServiceDataToDatabase();
                } catch (error) {
                    console.error('❌ Error saving calendar data:', error);
                }
            });
        }
    }

    attachNavigationHandlers() {
        const prevButton = document.querySelector('.calendar_prev');
        const nextButton = document.querySelector('.calendar_next');

        if (prevButton) {
            prevButton.addEventListener('click', () => {
                if (prevButton.classList.contains('disabled')) return;
                const monthYearElement = document.querySelector('[current_month_year]');
                if (!monthYearElement) return;

                const [monthName, year] = monthYearElement.textContent.trim().split(' ');
                let monthNum = this.monthMap[monthName];
                let yearNum = parseInt(year);

                if (monthNum === '01') {
                    monthNum = '12';
                    yearNum -= 1;
                } else {
                    monthNum = (parseInt(monthNum) - 1).toString().padStart(2, '0');
                }

                monthYearElement.textContent = `${this.reverseMonthMap[monthNum]} ${yearNum}`;
                setTimeout(() => {
                    this.updateCalendar();
                    this.updatePrevMonthButtonState();
                }, 10);
            });
        }

        if (nextButton) {
            nextButton.addEventListener('click', () => {
                const monthYearElement = document.querySelector('[current_month_year]');
                if (!monthYearElement) return;

                const [monthName, year] = monthYearElement.textContent.trim().split(' ');
                let monthNum = this.monthMap[monthName];
                let yearNum = parseInt(year);

                if (monthNum === '12') {
                    monthNum = '01';
                    yearNum += 1;
                } else {
                    monthNum = (parseInt(monthNum) + 1).toString().padStart(2, '0');
                }

                monthYearElement.textContent = `${this.reverseMonthMap[monthNum]} ${yearNum}`;
                setTimeout(() => {
                    this.updateCalendar();
                    this.updatePrevMonthButtonState();
                }, 10);
            });
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
            
            if (this.isPastOrCurrentDate(fullDate) || !this.selection.isConfirmed || dayWrapper.classList.contains('is-blocked')) return;

            const isInRange = this.isDateInRanges(fullDate);

            if (isInRange && !this.data.excludedDays.has(fullDate.timestamp)) {
                this.data.excludedDays.add(fullDate.timestamp);
                delete this.data.dateDiscounts[fullDate.timestamp];
                
                const servicePriceElement = dayWrapper.querySelector('[service-price]');
                if (servicePriceElement) servicePriceElement.textContent = this.getDefaultCost();

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
                dayWrapper.classList.contains('is-past') || dayWrapper.classList.contains('is-blocked')) return;

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
                    !wrapper.classList.contains('is-past') &&
                    !wrapper.classList.contains('is-blocked')) {
                    wrapper.classList.add('is-hover-range');
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
                
                this.cancelLastRange();
            });
        }

        const weekendDiscountCheckbox = document.querySelector('input[name="weekend_discount"][type="checkbox"]');
        const weekendDiscountInput = document.querySelector('input[name="Weekend-Discount"][type="text"]');
        
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
                if (weekendDiscountCheckbox.checked && discountPercent > 0) {
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

    attachPriceChangeHandlers() {
        const costInput = document.querySelector('input[name="cost_per_show"]');
        if (costInput) {
            costInput.addEventListener('input', (event) => {
                this.saveGlobalSettings();
                this.updateCalendar();
            });
        }
    }

    clearWaitState() {
        document.querySelectorAll('.calendar_day-wrapper.is-wait').forEach(day => {
            day.classList.remove('is-wait');
        });
    }

    clearHoverState() {
        document.querySelectorAll('.calendar_day-wrapper.is-hover-range').forEach(day => {
            day.classList.remove('is-hover-range');
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

    updateAllMonthsWithNewPrice() {
        const newPrice = this.getDefaultCost();
        Object.keys(this.data.basePrices).forEach(monthKey => {
            this.data.basePrices[monthKey].defaultCost = newPrice;
            this.data.basePrices[monthKey].prices = this.data.basePrices[monthKey].prices.map(priceItem => {
                if (this.isPastDate(priceItem.date) || this.isDateBlocked(priceItem.date, monthKey)) {
                    return {...priceItem, price: 0};
                }
                return {...priceItem, price: newPrice};
            });
            this.saveMonthData(monthKey);
        });
        this.loadMonthPrices();
    }

    // Public methods for external access
    async saveToDatabase() {
        return await this.saveServiceDataToDatabase();
    }

    getCalendarData() {
        return {
            basePrices: this.data.basePrices,
            blockedDates: this.data.blockedDates,
            serviceId: this.serviceId,
            isEditMode: this.isEditMode
        };
    }

    // Debug methods
    exportData() {
        return {
            serviceId: this.serviceId,
            isEditMode: this.isEditMode,
            basePrices: this.data.basePrices,
            blockedDates: this.data.blockedDates,
            dateRanges: this.data.dateRanges,
            globalSettings: this.data.globalSettings
        };
    }

    importData(data) {
        if (data.serviceId) this.serviceId = data.serviceId;
        if (data.isEditMode !== undefined) this.isEditMode = data.isEditMode;
        if (data.basePrices) this.data.basePrices = data.basePrices;
        if (data.blockedDates) this.data.blockedDates = data.blockedDates;
        if (data.dateRanges) this.data.dateRanges = data.dateRanges;
        if (data.globalSettings) this.data.globalSettings = data.globalSettings;
        
        this.updateCalendar();
        console.log('✅ Calendar data imported successfully');
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔄 DOM loaded, initializing Calendar Manager...');
    window.calendarManager = new CalendarManager();
    
    // Debug interface
    window.calendarDebug = {
        getManager: () => window.calendarManager,
        exportData: () => window.calendarManager?.exportData(),
        importData: (data) => window.calendarManager?.importData(data),
        saveToDatabase: () => window.calendarManager?.saveToDatabase(),
        getCalendarData: () => window.calendarManager?.getCalendarData(),
        checkMode: () => ({
            isEditMode: window.calendarManager?.isEditMode,
            serviceId: window.calendarManager?.serviceId,
            initComplete: window.calendarManager?.initComplete
        })
    };
    
    console.log('🛠️ Debug methods available at window.calendarDebug');
});
