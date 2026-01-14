import { GoogleGenAI } from '@google/genai';

// --- Types & Data ---
type Edition = 'Java' | 'Bedrock' | 'Education' | 'NetEase';
type ActiveView = 'wiki' | 'ids';

const VERSION_MAP: Record<Edition, { label: string; value: string }[]> = {
    Java: [
        { label: '1.21', value: 'pc/1.21' },
        { label: '1.20.1', value: 'pc/1.20.1' },
        { label: '1.19.4', value: 'pc/1.19.4' },
        { label: '1.18.2', value: 'pc/1.18.2' },
        { label: '1.16.5', value: 'pc/1.16.5' },
        { label: '1.12.2', value: 'pc/1.12.2' },
    ],
    Bedrock: [
        { label: '1.21.0', value: 'bedrock/1.21.0' },
        { label: '1.20.0', value: 'bedrock/1.20.0' },
        { label: '1.19.80', value: 'bedrock/1.19.80' },
    ],
    Education: [{ label: '最新', value: 'bedrock/1.21.0' }],
    NetEase: [{ label: '1.12.2', value: 'pc/1.12.2' }],
};

const CATEGORY_FILE_MAP: Record<string, string> = {
    '物品与方块': 'items.json',
    '实体': 'entities.json',
    '状态效果': 'effects.json',
    '生物群系': 'biomes.json',
};

const COMMAND_DATABASE = [
    {
        name: 'help / ?',
        description: '提供指令的使用指南。',
        category: '基础',
        details: {
            Java: { syntax: '/help [指令]', versionRange: "1.0+", permission: 0 },
            Bedrock: { syntax: '/help [页码|指令]', versionRange: "1.0+", permission: 0 },
            Education: { syntax: '/help [指令]', versionRange: "1.0+", permission: 0 }
        }
    },
    {
        name: 'tp / teleport',
        description: '将实体传送至特定坐标或目标。',
        category: '基础',
        details: {
            Java: { syntax: '/tp <目标> <目的地>', versionRange: "1.0+", permission: 2 },
            Bedrock: { syntax: '/tp <目标> <目的地>', versionRange: "1.0+", permission: 1 }
        }
    },
    {
        name: 'give',
        description: '给予玩家指定物品。',
        category: '作弊',
        details: {
            Java: { syntax: '/give <玩家> <物品> [数量]', versionRange: "1.0+", permission: 2 },
            Bedrock: { syntax: '/give <玩家> <物品> [数量] [数据]', versionRange: "1.0+", permission: 1 }
        }
    },
    {
        name: 'gamemode',
        description: '更改玩家的游戏模式。',
        category: '作弊',
        details: {
            Java: { syntax: '/gamemode <模式> [玩家]', versionRange: "1.3.1+", permission: 2 },
            Bedrock: { syntax: '/gamemode <模式> [玩家]', versionRange: "1.0+", permission: 1 }
        }
    },
    {
        name: 'ability',
        description: '赋予或剥夺玩家的能力。',
        category: '教育',
        details: {
            Education: { syntax: '/ability <玩家> <能力> <值>', versionRange: "EDU独有", permission: 1 },
            Bedrock: { syntax: '/ability <玩家> <能力> <值>', note: "仅限教育模式开启时使用。" }
        }
    },
    {
        name: 'wb / worldbuilder',
        description: '切换世界建造者状态。',
        category: '教育',
        details: {
            Education: { syntax: '/wb', note: "允许在受限区域放置方块。", permission: 1 },
            Bedrock: { syntax: '/wb', note: "仅限开启教育模式可用。" }
        }
    },
    {
        name: 'execute',
        description: '在特定条件下执行指令。',
        category: '技术',
        details: {
            Java: { syntax: '/execute ... run <指令>', versionRange: "1.13+", permission: 2, note: "Java 1.13 重构了该指令语法。" },
            Bedrock: { syntax: '/execute ... run <指令>', versionRange: "1.19.70+", permission: 1, note: "现已与 Java 语法对齐。" }
        }
    }
];

// --- Application State ---
let state = {
    activeView: 'wiki' as ActiveView,
    edition: 'Java' as Edition,
    selectedCategory: '全部',
    selectedIDCategory: '物品与方块',
    selectedVersion: VERSION_MAP['Java'][0].value,
    search: '',
    dynamicIDs: [] as any[],
    isLoading: false,
    aiResponse: '',
    isGenerating: false
};

// --- DOM References ---
const mainGrid = document.getElementById('main-grid')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const categoryControls = document.getElementById('category-controls')!;
const loadingSpinner = document.getElementById('loading-spinner')!;
const editionBtns = document.querySelectorAll('.edition-btn');
const navBtns = document.querySelectorAll('.nav-btn');
const aiInput = document.getElementById('ai-input') as HTMLTextAreaElement;
const askAiBtn = document.getElementById('ask-ai-btn')!;
const aiResponseContainer = document.getElementById('ai-response-container')!;
const viewTitle = document.getElementById('view-title')!;
const contentHeader = document.getElementById('content-header')!;
const errorMessage = document.getElementById('error-message')!;

// --- Initialization ---
init();

function init() {
    setupEventListeners();
    renderControls();
    updateUI();
}

function setupEventListeners() {
    searchInput.addEventListener('input', (e) => {
        state.search = (e.target as HTMLInputElement).value;
        updateUI();
    });

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            state.activeView = btn.getAttribute('data-view') as ActiveView;
            navBtns.forEach(b => b.classList.toggle('active', b === btn));
            if (state.activeView === 'ids') fetchIDs();
            renderControls();
            updateUI();
        });
    });

    editionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            state.edition = btn.getAttribute('data-edition') as Edition;
            editionBtns.forEach(b => {
                const isMatch = b.getAttribute('data-edition') === state.edition;
                b.className = `edition-btn text-xs py-2 px-3 rounded border transition-all ${isMatch ? 'bg-green-700 border-green-400 text-white shadow-lg' : 'bg-black/40 border-gray-700 text-gray-500 hover:text-gray-300'}`;
            });
            state.selectedVersion = VERSION_MAP[state.edition][0].value;
            if (state.activeView === 'ids') fetchIDs();
            renderControls();
            updateUI();
        });
    });

    askAiBtn.addEventListener('click', handleAiAsk);
}

// --- Data Fetching ---
async function fetchIDs() {
    state.isLoading = true;
    errorMessage.classList.add('hidden');
    updateUI();

    const fileName = CATEGORY_FILE_MAP[state.selectedIDCategory];
    const url = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/${state.selectedVersion}/${fileName}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: 无法获取该版本数据`);
        const data = await res.json();
        state.dynamicIDs = data.map((item: any) => ({
            id: item.name,
            name: item.displayName || item.name,
            namespace: 'minecraft'
        }));
    } catch (err: any) {
        errorMessage.textContent = `⚠️ ${err.message}`;
        errorMessage.classList.remove('hidden');
        state.dynamicIDs = [];
    } finally {
        state.isLoading = false;
        updateUI();
    }
}

// --- AI Interaction ---
async function handleAiAsk() {
    const input = aiInput.value.trim();
    if (!input || state.isGenerating) return;

    state.isGenerating = true;
    askAiBtn.textContent = '思考中...';
    aiResponseContainer.classList.remove('hidden');
    aiResponseContainer.textContent = '专家正在连接...';

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `你是一位深谙《我的世界》全版本的顶级专家。当前环境：${state.edition}。问题：${input}。请用专业中文回答，并提供具体的指令代码。`
        });
        aiResponseContainer.textContent = response.text || '无法生成回答。';
    } catch (err) {
        aiResponseContainer.textContent = '专家由于网络波动掉线了，请重试。';
    } finally {
        state.isGenerating = false;
        askAiBtn.textContent = '提交问题';
    }
}

// --- Rendering Logic ---
function renderControls() {
    categoryControls.innerHTML = '';

    if (state.activeView === 'wiki') {
        const label = document.createElement('label');
        label.className = 'text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]';
        label.textContent = '指令分类';
        categoryControls.appendChild(label);

        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 gap-2';
        ['全部', '基础', '作弊', '管理', '技术', '教育'].forEach(cat => {
            const btn = document.createElement('button');
            btn.className = `text-xs py-2 rounded border transition-all ${state.selectedCategory === cat ? 'bg-blue-700 border-blue-400 text-white shadow-lg' : 'bg-black/40 border-gray-700 text-gray-500 hover:text-gray-300'}`;
            btn.textContent = cat;
            btn.onclick = () => {
                state.selectedCategory = cat;
                renderControls();
                updateUI();
            };
            grid.appendChild(btn);
        });
        categoryControls.appendChild(grid);
    } else {
        // ID View Controls
        const verLabel = document.createElement('label');
        verLabel.className = 'text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]';
        verLabel.textContent = '数据库版本';
        categoryControls.appendChild(verLabel);

        const select = document.createElement('select');
        select.className = 'w-full bg-black/60 border border-gray-700 p-2 text-white text-xs rounded outline-none mb-4';
        VERSION_MAP[state.edition].forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.value;
            opt.textContent = v.label;
            opt.selected = state.selectedVersion === v.value;
            select.appendChild(opt);
        });
        select.onchange = (e) => {
            state.selectedVersion = (e.target as HTMLSelectElement).value;
            fetchIDs();
        };
        categoryControls.appendChild(select);

        const catLabel = document.createElement('label');
        catLabel.className = 'text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]';
        catLabel.textContent = '库分类';
        categoryControls.appendChild(catLabel);

        const list = document.createElement('div');
        list.className = 'flex flex-col gap-1';
        Object.keys(CATEGORY_FILE_MAP).forEach(cat => {
            const btn = document.createElement('button');
            btn.className = `text-left text-xs py-2 px-3 rounded transition-all ${state.selectedIDCategory === cat ? 'bg-blue-800 text-white border-l-4 border-blue-400' : 'text-gray-500 hover:bg-white/5'}`;
            btn.textContent = cat;
            btn.onclick = () => {
                state.selectedIDCategory = cat;
                fetchIDs();
                renderControls();
            };
            list.appendChild(btn);
        });
        categoryControls.appendChild(list);
    }
}

function updateUI() {
    mainGrid.innerHTML = '';
    loadingSpinner.classList.toggle('hidden', !state.isLoading);
    contentHeader.classList.toggle('hidden', state.activeView === 'wiki' && !state.search);

    if (state.activeView === 'wiki') {
        renderWiki();
    } else {
        renderIDs();
    }
}

function renderWiki() {
    const filtered = COMMAND_DATABASE.filter(cmd => {
        const details = (cmd.details as any)[state.edition];
        if (!details) return false;
        const matchesSearch = cmd.name.toLowerCase().includes(state.search.toLowerCase()) || cmd.description.includes(state.search);
        const matchesCategory = state.selectedCategory === '全部' || cmd.category === state.selectedCategory;
        return matchesSearch && matchesCategory && !details.isDeprecated;
    });

    if (filtered.length === 0) {
        mainGrid.innerHTML = `<div class="mc-panel p-20 text-center opacity-40"><span class="text-6xl block mb-4">📭</span><p class="mc-font text-2xl">未发现相关指令</p></div>`;
        return;
    }

    filtered.forEach(cmd => {
        const det = (cmd.details as any)[state.edition];
        const card = document.createElement('div');
        card.className = 'command-card p-6 rounded-xl flex flex-col gap-4 border-l-8 border-l-green-600 group hover:shadow-2xl transition-all';
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3">
                    <span class="px-2 py-0.5 bg-green-900/40 text-green-400 text-[10px] font-bold rounded uppercase border border-green-800">${cmd.category}</span>
                    <h3 class="text-2xl font-black text-white group-hover:text-green-400 transition-colors">/${cmd.name}</h3>
                </div>
                <button class="copy-btn text-xs text-gray-500 hover:text-white bg-white/5 px-3 py-1.5 rounded-full border border-gray-800 hover:border-green-500">复制语法</button>
            </div>
            <p class="text-gray-300 text-sm">${cmd.description}</p>
            <div class="bg-black/60 p-4 rounded-lg border-2 border-gray-900 font-mono relative overflow-hidden">
                <div class="text-[10px] text-gray-600 mb-2 uppercase tracking-widest font-bold">命令格式</div>
                <code class="text-yellow-500 text-base block overflow-x-auto">${det.syntax}</code>
            </div>
            <div class="flex flex-wrap gap-4 text-[11px] text-gray-500">
                ${det.versionRange ? `<span>适用版本: ${det.versionRange}</span>` : ''}
                ${det.permission !== undefined ? `<span>权限: ${det.permission}级</span>` : ''}
            </div>
        `;
        card.querySelector('.copy-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(det.syntax);
        });
        mainGrid.appendChild(card);
    });
}

function renderIDs() {
    viewTitle.textContent = `${state.selectedIDCategory} 库`;
    
    const filtered = state.dynamicIDs.filter(item => 
        item.id.toLowerCase().includes(state.search.toLowerCase()) || 
        item.name.toLowerCase().includes(state.search.toLowerCase())
    );

    if (filtered.length === 0 && !state.isLoading) {
        mainGrid.innerHTML = `<div class="mc-panel p-20 text-center opacity-30"><p class="mc-font text-xl">暂无匹配数据</p></div>`;
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4';
    
    filtered.slice(0, 300).forEach(item => {
        const card = document.createElement('div');
        card.className = 'command-card p-4 rounded-lg group border-l-4 border-l-blue-600 hover:bg-blue-900/5';
        card.innerHTML = `
            <div class="flex flex-col gap-1">
                <div class="text-[9px] text-gray-600 uppercase font-black tracking-widest">${item.namespace}:</div>
                <h4 class="text-white font-bold text-sm truncate group-hover:text-blue-400">${item.name}</h4>
                <code class="text-[11px] text-yellow-600/80 mt-1">${item.id}</code>
            </div>
            <button class="mt-3 w-full py-1 text-[10px] text-gray-500 border border-gray-800 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10">复制 ID</button>
        `;
        card.querySelector('button')?.addEventListener('click', () => {
            navigator.clipboard.writeText(item.id);
        });
        grid.appendChild(card);
    });

    mainGrid.appendChild(grid);
    if (filtered.length > 300) {
        const more = document.createElement('div');
        more.className = 'py-8 text-center text-gray-600 text-xs border-t border-gray-800';
        more.textContent = `... 已精简展示，请通过搜索寻找特定 ID ...`;
        mainGrid.appendChild(more);
    }
}
