// ===== DOM Elements =====
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const searchInput = document.getElementById('searchInput');
const appsGrid = document.getElementById('appsGrid');
const currentDate = document.getElementById('currentDate');
const filterTabs = document.getElementById('filterTabs');
const emptyState = document.getElementById('emptyState');

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
    setCurrentDate();
    setupEventListeners();
    updateCounts();
});

// ===== Set Current Date =====
function setCurrentDate() {
    const now = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    currentDate.textContent = now.toLocaleDateString('zh-CN', options);
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Sidebar toggle
    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('expanded');
        document.querySelector('.main-layout').classList.toggle('sidebar-expanded');
    });

    // Search
    searchInput.addEventListener('input', (e) => {
        // Reset filter to "all" when searching
        setActiveFilter('all');
        filterApps(e.target.value.toLowerCase(), 'all');
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            searchInput.focus();
        }
        if (e.key === 'Escape') {
            searchInput.blur();
            searchInput.value = '';
            filterApps('', 'all');
        }
    });

    // Filter tabs (top)
    filterTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.filter-tab');
        if (!tab) return;
        const filter = tab.dataset.filter;
        setActiveFilter(filter);
        searchInput.value = '';
        filterApps('', filter);
    });

    // Sidebar category links
    document.querySelectorAll('.sidebar-item[data-filter]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const filter = item.dataset.filter;
            setActiveFilter(filter);
            searchInput.value = '';
            filterApps('', filter);
            // Update sidebar active state
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // View toggle
    document.querySelectorAll('.view-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appsGrid.style.gridTemplateColumns = btn.dataset.view === 'list'
                ? '1fr'
                : 'repeat(auto-fill, minmax(270px, 1fr))';
        });
    });
}

// ===== Set Active Filter Tab =====
function setActiveFilter(filter) {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    const target = document.querySelector(`.filter-tab[data-filter="${filter}"]`);
    if (target) target.classList.add('active');

    // Sync sidebar
    document.querySelectorAll('.sidebar-item[data-filter]').forEach(i => {
        i.classList.toggle('active', i.dataset.filter === filter);
    });
}

// ===== Filter Apps =====
function filterApps(query, category) {
    const cards = appsGrid.querySelectorAll('.app-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const title = card.querySelector('h3').textContent.toLowerCase();
        const desc = card.querySelector('p').textContent.toLowerCase();
        const cat = card.dataset.category || '';
        const matchesSearch = !query || title.includes(query) || desc.includes(query);
        const matchesCategory = category === 'all' || cat === category;

        if (matchesSearch && matchesCategory) {
            card.classList.remove('hidden');
            visibleCount++;
        } else {
            card.classList.add('hidden');
        }
    });

    emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
}

// ===== Update Category Counts =====
function updateCounts() {
    const cards = appsGrid.querySelectorAll('.app-card');
    const counts = { all: 0, ai: 0, azure: 0, tool: 0 };

    cards.forEach(card => {
        const cat = card.dataset.category;
        counts.all++;
        if (counts[cat] !== undefined) counts[cat]++;
    });

    const countAll = document.getElementById('countAll');
    const countAi = document.getElementById('countAi');
    const countAzure = document.getElementById('countAzure');
    const countTool = document.getElementById('countTool');
    const appCount = document.getElementById('appCount');

    if (countAll) countAll.textContent = counts.all;
    if (countAi) countAi.textContent = counts.ai;
    if (countAzure) countAzure.textContent = counts.azure;
    if (countTool) countTool.textContent = counts.tool;
    if (appCount) appCount.textContent = `共 ${counts.all} 个工具`;
}

// ===== Fullscreen Toggle =====
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}
