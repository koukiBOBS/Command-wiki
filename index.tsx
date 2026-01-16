import { GoogleGenAI } from '@google/genai';

// --- 类型与常量数据 ---
type Edition = 'Java' | 'Bedrock' | 'Education' | 'NetEase';
type ActiveView = 'wiki' | 'ids';

const VERSION_MAP: Record<Edition, { label: string; value: string }[]> = {
    Java: [
        { label: '1.21', value: 'pc/1.21' },
        { label: '1.20.1', value: 'pc/1.20.1' },
        { label: '1.19.4', value: 'pc/1.19.4' },
        { label: '1.12.2', value: 'pc/1.12.2' },
    ],
    Bedrock: [
        { label: '1.21.0', value: 'bedrock/1.21.0' },
        { label: '1.20.0', value: 'bedrock/1.20.0' },
    ],
    Education: [{ label: '最新教育版', value: 'bedrock/1.21.0' }],
    NetEase: [{ label: '1.12.2 (中国版)', value: 'pc/1.12.2' }],
};

const CATEGORY_FILE_MAP: Record<string, string> = {
    '物品与方块': 'items.json',
    '实体': 'entities.json',
    '状态效果': 'effects.json',
    '生物群系': 'biomes.json',
};

const COMMAND_DATABASE = [
    { name: 'help / ?', description: '提供指令的使用指南。', category: '基础', details: { Java: { syntax: '/help [指令]' }, Bedrock: { syntax: '/help [页码]' }, Education: { syntax: '/help' } } },
    { name: 'tp / teleport', description: '将实体传送至特定坐标或目标。', category: '基础', details: { Java: { syntax: '/tp <目标> <目的地>' }, Bedrock: { syntax: '/tp <目标> <目的地>' } } },
    { name: 'give', description: '给予玩家指定物品。', category: '作弊', details: { Java: { syntax: '/give <玩家> <物品> [数量]' }, Bedrock: { syntax: '/give <玩家> <物品> [数量] [数据]' } } },
    { name: 'gamemode', description: '更改玩家的游戏模式。', category: '作弊', details: { Java: { syntax: '/gamemode <模式> [玩家]' }, Bedrock: { syntax: '/gamemode <模式> [玩家]' } } },
    { name: 'execute', description: '在特定条件下执行指令。', category: '技术', details: { Java: { syntax: '/execute ... run <指令>' }, Bedrock: { syntax: '/execute ... run <指令>' } } },
    { name: 'ability', description: '赋予或剥夺玩家的能力。', category: '教育', details: { Education: { syntax: '/ability <玩家> <能力> <值>' }, Bedrock: { syntax: '/ability <玩家> <能力> <值>' } } },
    { name: 'wb / worldbuilder', description: '切换世界建造者状态。', category: '教育', details: { Education: { syntax: '/wb' } } }
];

// --- 应用状态 ---
let state = {
    activeView: 'wiki' as ActiveView,
    edition: 'Java' as Edition,
    selectedCategory: '全部',
    selectedIDCategory: '物品与方块',
    selectedVersion: VERSION_MAP['Java'][0].value,
    search: '',
    dynamicIDs: [] as any[],
    isLoading: false,
    isGenerating: false
};

// --- DOM 引用获取函数 ---
const getEl = (id: string) => document.getElementById(id);

// --- 初始化入口：确保在 Module 环境下正确触发 ---
function safeInit() {
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
}

safeInit();

function initApp() {
    bindEvents();
    renderControls();
    updateUI();
}

// --- 事件绑定 (使用委托，确保动态生成的按钮也有效) ---
function bindEvents() {
    getEl('search-input')?.addEventListener('input', (e) => {
        state.search = (e.target as HTMLInputElement).value;
        updateUI();
    });

    getEl('nav-buttons-container')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.nav-btn');
        if (!btn) return;
        state.activeView = btn.getAttribute('data-view') as ActiveView;
        if (state.activeView === 'ids') fetchIDs();
        renderControls();
        updateUI();
    });

    // 平台切换监听：修正为 platform-buttons-container
    getEl('platform-buttons-container')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.platform-btn');
        if (!btn) return;
        state.edition = btn.getAttribute('data-edition') as Edition;
        state.selectedVersion = VERSION_MAP[state.edition][0].value;
        if (state.activeView === 'ids') fetchIDs();
        renderControls();
        updateUI();
    });

    // 分类切换监听：修正类名以防冲突
    getEl('category-controls')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.cat-btn');
        if (!btn) return;
        const cat = btn.getAttribute('data-cat') || '';
        if (state.activeView === 'wiki') {
            state.selectedCategory = cat;
        } else {
            state.selectedIDCategory = cat;
            fetchIDs();
        }
        renderControls();
        updateUI();
    });

    getEl('ask-ai-btn')?.addEventListener('click', handleAiAsk);
}

// --- 渲染控制器 (侧边栏动态按钮) ---
function renderControls() {
    const container = getEl('category-controls');
    if (!container) return;
    container.innerHTML = '';

    // 精确更新导航按钮高亮
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === state.activeView);
    });

    // 精确更新平台按钮高亮：排除掉动态生成的按钮
    document.querySelectorAll('.platform-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-edition') === state.edition);
    });

    if (state.activeView === 'wiki') {
        createLabel(container, '指令分类');
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 gap-2';
        ['全部', '基础', '作弊', '管理', '技术', '教育'].forEach(cat => {
            const btn = document.createElement('button');
            // 此处分类按钮不再使用 platform-btn 类名，避免样式逻辑冲突
            btn.className = `mc-button cat-btn ${state.selectedCategory === cat ? 'active' : ''}`;
            btn.setAttribute('data-cat', cat);
            btn.textContent = cat;
            grid.appendChild(btn);
        });
        container.appendChild(grid);
    } else {
        createLabel(container, '数据库版本');
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
        container.appendChild(select);

        createLabel(container, '库分类');
        const list = document.createElement('div');
        list.className = 'flex flex-col gap-1';
        Object.keys(CATEGORY_FILE_MAP).forEach(cat => {
            const btn = document.createElement('button');
            btn.className = `mc-button cat-btn ${state.selectedIDCategory === cat ? 'active' : ''}`;
            btn.style.textAlign = 'left';
            btn.setAttribute('data-cat', cat);
            btn.textContent = cat;
            list.appendChild(btn);
        });
        container.appendChild(list);
    }
}

function createLabel(parent: HTMLElement, text: string) {
    const l = document.createElement('label');
    l.className = 'text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em] mt-4';
    l.textContent = text;
    parent.appendChild(l);
}

// --- 数据抓取 ---
async function fetchIDs() {
    state.isLoading = true;
    updateUI();

    const fileName = CATEGORY_FILE_MAP[state.selectedIDCategory];
    // 强制使用 HTTPS 和完整的 raw 路径，增加在不同网络环境下的稳定性
    const url = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/${state.selectedVersion}/${fileName}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Data fetch failed');
        const data = await res.json();
        state.dynamicIDs = data.map((item: any) => ({
            id: item.name,
            name: item.displayName || item.name,
            namespace: 'minecraft'
        }));
    } catch {
        state.dynamicIDs = [];
        const err = getEl('error-message');
        if (err) {
            err.textContent = '无法同步最新的 ID 库。请检查网络连接或 GitHub 访问权限。';
            err.classList.remove('hidden');
        }
    } finally {
        state.isLoading = false;
        updateUI();
    }
}

// --- AI 逻辑：增加对 process 环境的安全判断 ---
async function handleAiAsk() {
    const input = (getEl('ai-input') as HTMLTextAreaElement).value.trim();
    if (!input || state.isGenerating) return;

    state.isGenerating = true;
    const btn = getEl('ask-ai-btn')!;
    const resContainer = getEl('ai-response-container')!;
    
    btn.textContent = '正在撰写...';
    resContainer.classList.remove('hidden');
    resContainer.textContent = '正在召唤 Minecraft 指令大师...';

    try {
        // 安全获取 API Key
        let apiKey = '';
        try {
            apiKey = process.env.API_KEY || '';
        } catch (e) {
            console.warn('Process environment not available. Running in static mode.');
        }

        if (!apiKey) {
            throw new Error('API Key missing');
        }

        const ai = new GoogleGenAI({ apiKey: apiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Minecraft 环境：${state.edition} 版。玩家提问：${input}。请作为顶级专家回答，输出可以直接在游戏中运行的指令。`
        });
        resContainer.textContent = response.text || '专家陷入了沉思，请重试。';
    } catch (error) {
        console.error('AI call failed:', error);
        resContainer.textContent = '无法连接到 AI 专家。请确保您在支持的环境中运行或 API Key 配置正确。';
    } finally {
        state.isGenerating = false;
        btn.textContent = '提交问题';
    }
}

// --- 核心渲染更新 ---
function updateUI() {
    const grid = getEl('main-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    getEl('loading-spinner')?.classList.toggle('hidden', !state.isLoading);

    if (state.activeView === 'wiki') {
        renderWikiView(grid);
    } else {
        renderIDView(grid);
    }
}

function renderWikiView(container: HTMLElement) {
    const title = getEl('view-title');
    if (title) title.textContent = `${state.edition} 版指令`;
    getEl('content-header')?.classList.remove('hidden');

    const filtered = COMMAND_DATABASE.filter(cmd => {
        const details = (cmd.details as any)[state.edition];
        if (!details) return false;
        const matchesSearch = cmd.name.toLowerCase().includes(state.search.toLowerCase()) || cmd.description.includes(state.search);
        const matchesCategory = state.selectedCategory === '全部' || cmd.category === state.selectedCategory;
        return matchesSearch && matchesCategory;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="p-20 text-center opacity-40 mc-font text-2xl">未发现匹配的指令</div>`;
        return;
    }

    filtered.forEach(cmd => {
        const det = (cmd.details as any)[state.edition];
        const card = document.createElement('div');
        card.className = 'command-card p-6 rounded-xl border-l-8 border-l-green-600 group hover:border-l-green-400 transition-all';
        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div class="flex items-center gap-3">
                    <span class="px-2 py-0.5 bg-green-900/40 text-green-400 text-[10px] font-bold rounded border border-green-800">${cmd.category}</span>
                    <h3 class="text-2xl font-black text-white group-hover:text-green-400 transition-colors">/${cmd.name}</h3>
                </div>
                <button class="copy-btn text-xs text-gray-500 hover:text-white bg-white/5 px-3 py-1.5 rounded-full border border-gray-800 hover:border-green-500">复制</button>
            </div>
            <p class="text-gray-300 text-sm mb-4">${cmd.description}</p>
            <div class="bg-black/60 p-4 rounded-lg border-2 border-gray-900 font-mono">
                <code class="text-yellow-500 text-sm block overflow-x-auto custom-scrollbar">${det.syntax}</code>
            </div>
        `;
        card.querySelector('.copy-btn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(det.syntax).catch(() => {
                const dummy = document.createElement('textarea');
                document.body.appendChild(dummy);
                dummy.value = det.syntax;
                dummy.select();
                document.execCommand('copy');
                document.body.removeChild(dummy);
            });
        });
        container.appendChild(card);
    });
}

function renderIDView(container: HTMLElement) {
    const title = getEl('view-title');
    if (title) title.textContent = `${state.selectedIDCategory} 库 (${state.edition})`;
    getEl('content-header')?.classList.remove('hidden');

    const filtered = state.dynamicIDs.filter(item => 
        item.id.toLowerCase().includes(state.search.toLowerCase()) || 
        item.name.toLowerCase().includes(state.search.toLowerCase())
    );

    if (state.isLoading) return;
    if (filtered.length === 0) {
        container.innerHTML = `<div class="p-20 text-center opacity-30 mc-font text-xl">请尝试切换版本或分类</div>`;
        return;
    }

    const gridLayout = document.createElement('div');
    gridLayout.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
    
    filtered.slice(0, 200).forEach(item => {
        const card = document.createElement('div');
        card.className = 'command-card p-4 rounded-lg group border-l-4 border-l-blue-600 hover:bg-blue-900/5 cursor-pointer';
        card.innerHTML = `
            <div class="text-[9px] text-gray-600 font-black uppercase tracking-widest">${item.namespace}</div>
            <h4 class="text-white font-bold text-sm truncate group-hover:text-blue-400 transition-colors">${item.name}</h4>
            <code class="text-[11px] text-yellow-600/80 group-hover:text-yellow-500">${item.id}</code>
        `;
        card.onclick = () => {
            navigator.clipboard.writeText(item.id).catch(() => {
                const dummy = document.createElement('textarea');
                document.body.appendChild(dummy);
                dummy.value = item.id;
                dummy.select();
                document.execCommand('copy');
                document.body.removeChild(dummy);
            });
        };
        gridLayout.appendChild(card);
    });

    container.appendChild(gridLayout);
}