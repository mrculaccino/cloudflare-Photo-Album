/* ============================================================================
 * app.js — TikTok 带货相册展示网站（纯静态 SPA）
 * ----------------------------------------------------------------------------
 * 架构：7 大模块
 *   1. CONFIG     配置模块
 *   2. Cache      数据缓存模块（fetch + localStorage，5 分钟过期）
 *   3. AppState   状态管理模块
 *   4. Router     hash 路由模块（#home / #category/:id / #product/:id）
 *   5. Renderer   渲染引擎模块（纯函数：输入数据，返回 HTML 字符串）
 *   6. EventBus   事件总线模块（事件委托，data-action 属性驱动）
 *   7. App        启动模块（加载数据、初始化路由、注入渲染结果）
 * ----------------------------------------------------------------------------
 * 扩展点（PRD §12，均以 // TODO: 标注）：
 *   - 搜索功能：CONFIG.enableSearch
 *   - 分页功能：CONFIG.itemsPerPage
 *   - 多语言：CONFIG.lang
 *   - 标签筛选：products[].tags
 *   - 数据埋点：data-action="track"
 * ========================================================================== */

'use strict';

/* ================= 1. CONFIG 配置模块 ================= */
const CONFIG = {
  waNumber: '',                    // WhatsApp 手机号（不带 + 号），从 data.json 加载
  siteName: '',                    // 网站名称，从 data.json 加载
  placeholderImage: 'https://placehold.co/600x600/f0f0f0/999?text=👛', // 图片加载失败占位图
  cacheKey: 'tiktok_album_cache',  // localStorage 缓存键
  cacheTTL: 5 * 60 * 1000,         // 缓存时间：5 分钟
  itemsPerPage: 20,                // 每页产品数量（为分页预留）
  enableSearch: false,             // 搜索功能开关（为扩展预留）
  // TODO: 多语言支持，将页面所有文案抽离到配置对象
  lang: 'en'
};

/* ---------- 共享工具函数 ---------- */
const Utils = {
  // HTML 转义，防止数据中的特殊字符破坏页面结构
  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // 生成 WhatsApp 询价链接
  waLink(number, text) {
    return 'https://wa.me/' + number + '?text=' + encodeURIComponent(text);
  },

  // 排序权重比较器（sort 数字越小越靠前）
  bySort(a, b) {
    return (Number(a.sort) || 0) - (Number(b.sort) || 0);
  },

  // 只返回上架产品（isActive !== false 时显示）
  activeProducts(products) {
    return products.filter(p => p.isActive !== false);
  }
};

/* ================= 2. Cache 数据缓存模块 ================= */
const Cache = {
  // 加载数据：
  // 1) 生产环境优先请求 Pages Function /api/data（WhatsApp 号码由环境变量注入）
  // 2) 无函数时降级到内嵌 data.js / localStorage 缓存 / data.json（本地开发）
  loadData() {
    return fetch('/api/data', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error('API 请求失败 (HTTP ' + response.status + ')');
        return response.json();
      })
      .then(data => {
        this._writeCache(data);
        return data;
      })
      .catch(() => {
        // 降级：内嵌数据（data.js）→ localStorage 缓存 → data.json（仅本地）
        if (window.__APP_DATA__) return window.__APP_DATA__;
        const cached = this._readCache();
        if (cached) return cached;
        return fetch('data.json', { cache: 'no-store' })
          .then(response => {
            if (!response.ok) throw new Error('请求失败 (HTTP ' + response.status + ')');
            return response.json();
          })
          .then(data => {
            this._writeCache(data);
            return data;
          });
      });
  },

  // 读取缓存：校验记录结构并检查 5 分钟过期时间
  _readCache() {
    try {
      const raw = localStorage.getItem(CONFIG.cacheKey);
      if (!raw) return null;
      const record = JSON.parse(raw);
      if (!record || !record.data || !record.timestamp) return null;
      if (Date.now() - record.timestamp > CONFIG.cacheTTL) {
        this.clearCache();
        return null;
      }
      return record.data;
    } catch (err) {
      this.clearCache();
      return null;
    }
  },

  // 写入缓存
  _writeCache(data) {
    try {
      localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (err) {
      // 隐私模式 / 存储已满等场景静默失败，不影响正常浏览
    }
  },

  // 清除缓存（调试用：控制台执行 Cache.clearCache()）
  clearCache() {
    try {
      localStorage.removeItem(CONFIG.cacheKey);
    } catch (err) {
      /* 忽略 */
    }
  }
};

/* ================= 3. AppState 状态管理模块 ================= */
const AppState = {
  currentPage: 'home',        // 'home' | 'products' | 'detail'
  currentCategoryId: null,    // 当前分类 ID
  currentProductId: null,     // 当前产品 ID
  currentImageIndex: 0,       // 详情页轮播图当前索引
  allData: null,              // 从 data.json 加载的完整数据
  isLoading: false,           // 是否正在加载
  error: null,                // 加载错误信息

  // 局部更新状态
  setState(newState) {
    Object.assign(this, newState);
  },

  // 读取状态（不传 key 返回全部状态的浅拷贝）
  getState(key) {
    return key ? this[key] : Object.assign({}, this);
  }
};

/* ================= 4. Router 路由模块 ================= */
const Router = {
  routes: [],         // 路由历史栈（供返回按钮使用）
  _popping: false,    // 标记本次 hash 变化是否由 goBack 触发（避免重复入栈）
  _initialized: false,

  // 初始化：监听 hashchange，首次进入按当前 hash 渲染
  init() {
    if (this._initialized) return;
    this._initialized = true;
    window.addEventListener('hashchange', () => this._onHashChange());
    // 无 hash 时默认 #home（replaceState 不触发 hashchange，避免重复入栈）
    if (!location.hash) {
      history.replaceState(null, '', '#home');
    }
    const path = this._parseHash(location.hash);
    this.routes.push(path);
    this._handle(path);
  },

  // 解析 hash → 路由对象 { page, categoryId?, productId? }
  _parseHash(hash) {
    const raw = (hash || location.hash).replace(/^#\/?/, '').replace(/\/+$/, '');
    if (!raw || raw === 'home') return { page: 'home' };
    const parts = raw.split('/');
    if (parts[0] === 'category' && parts[1]) {
      return { page: 'products', categoryId: decodeURIComponent(parts[1]) };
    }
    if (parts[0] === 'product' && parts[1]) {
      return { page: 'detail', productId: decodeURIComponent(parts[1]) };
    }
    return { page: 'home' };
  },

  // hash 变化回调：支持浏览器前进 / 后退
  _onHashChange() {
    const path = this._parseHash(location.hash);
    if (this._popping) {
      // goBack 已处理历史栈，无需重复入栈
      this._popping = false;
    } else {
      this.routes.push(path);
    }
    this._handle(path);
  },

  // 更新 AppState 并触发渲染
  _handle(path) {
    AppState.setState({
      currentPage: path.page,
      currentCategoryId: path.categoryId || null,
      currentProductId: path.productId || null,
      currentImageIndex: 0
    });
    App.render();
  },

  // 编程式跳转
  navigateTo(page, params) {
    let hash = '#home';
    if (page === 'products' && params && params.categoryId) {
      hash = '#category/' + encodeURIComponent(params.categoryId);
    } else if (page === 'detail' && params && params.productId) {
      hash = '#product/' + encodeURIComponent(params.productId);
    }
    if (location.hash === hash) {
      this._handle(this._parseHash(hash));
    } else {
      location.hash = hash;
    }
  },

  // 返回上一级页面（导航栏返回按钮）
  goBack() {
    if (this.routes.length > 1) {
      this.routes.pop(); // 移除当前路由
      const prev = this.routes[this.routes.length - 1];
      const hash = this._toHash(prev);
      if (location.hash === hash) {
        this._handle(prev);
      } else {
        this._popping = true;
        location.hash = hash;
      }
    } else {
      // 没有可回退的历史时回到首页
      this.navigateTo('home');
    }
  },

  // 路由对象 → hash
  _toHash(path) {
    if (path.page === 'products') return '#category/' + encodeURIComponent(path.categoryId);
    if (path.page === 'detail') return '#product/' + encodeURIComponent(path.productId);
    return '#home';
  }
};

/* ================= 5. Renderer 渲染引擎模块 ================= */
const Renderer = {
  /* ---------- 首页：分类卡片网格 + 买家秀横滑（PRD §7） ---------- */
  renderHome(categories, products, testimonials) {
    // 分类下方引导文案：点击 WhatsApp 跳转询价（与导航栏通用问候语一致）
    const chatHref = CONFIG.waNumber
      ? Utils.waLink(CONFIG.waNumber, "Hi! I'd like to know more about your products.")
      : '#';

    const cards = categories
      .map(cat => {
        const count = Utils.activeProducts(products.filter(p => p.categoryId === cat.id)).length;
        // 分类图标：icon 为图片链接时渲染 <img>，否则按原样渲染 emoji
        const iconHtml = /^https?:\/\//i.test(cat.icon || '')
          ? `<img class="category-icon-img" src="${Utils.esc(cat.icon)}" alt="${Utils.esc(cat.name)}" loading="lazy"
                 onerror="this.onerror=null;this.src='${CONFIG.placeholderImage}'">`
          : `<span class="category-icon">${cat.icon || '👜'}</span>`;
        return `
          <div class="category-card card" data-action="category" data-category-id="${Utils.esc(cat.id)}">
            ${iconHtml}
            <span class="category-name">${Utils.esc(cat.name)}</span>
            <span class="category-count">${count} items</span>
          </div>`;
      })
      .join('');

    const shots = (testimonials || [])
      .map(t => `
        <figure class="testimonial-card">
          <img class="testimonial-img zoomable" src="${Utils.esc(t.image)}" alt="${Utils.esc(t.label)}" loading="lazy"
               data-action="zoom" data-zoom="image"
               onerror="this.onerror=null;this.src='${CONFIG.placeholderImage}'">
          <figcaption>${Utils.esc(t.label)}</figcaption>
        </figure>`)
      .join('');

    return `
      <div class="app-page home-page">
        <section class="hero">
          <h1 class="hero-title">Find Your Style ✨</h1>
          <p class="hero-sub">Browse our collection &amp; inquire via WhatsApp</p>
        </section>
        <section class="section">
          <div class="category-grid">${cards}</div>
        </section>
        <section class="more-styles">
          <p class="more-styles-text">Looking for more styles? Please contact us via
            <a class="more-styles-link" href="${chatHref}" target="_blank" rel="noopener">WhatsApp</a>.
          </p>
        </section>
        ${shots ? `
        <section class="section">
          <h2 class="section-title">📸 Customer Reviews &amp; Receipts</h2>
          <div class="testimonial-scroll">${shots}</div>
        </section>` : ''}
      </div>`;
  },

  /* ---------- 产品列表页：缩略图网格（PRD §8） ---------- */
  renderProducts(categoryId, products, categoryName) {
    // TODO: 搜索功能（CONFIG.enableSearch）：开启后显示搜索框，前端过滤产品
    // TODO: 分页功能（CONFIG.itemsPerPage）：产品数量超过设定值时自动分页
    // TODO: 标签筛选（products[].tags）：在列表页添加标签过滤按钮
    if (!products.length) {
      return `<div class="app-page">${this.renderEmptyState('No products in this collection yet')}</div>`;
    }

    const cards = products
      .map(p => {
        const cover = (p.images && p.images[0]) || CONFIG.placeholderImage;
        return `
          <div class="product-card card" data-action="product" data-product-id="${Utils.esc(p.id)}">
            <div class="product-thumb">
              <img src="${Utils.esc(cover)}" alt="${Utils.esc(p.name)}" loading="lazy"
                   onerror="this.onerror=null;this.src='${CONFIG.placeholderImage}'">
            </div>
            <span class="product-name">${Utils.esc(p.name)}</span>
          </div>`;
      })
      .join('');

    return `
      <div class="app-page products-page">
        <header class="page-header">
          <h1 class="page-title">${Utils.esc(categoryName)}</h1>
          <p class="page-count">${products.length} items</p>
        </header>
        <div class="product-grid">${cards}</div>
      </div>`;
  },

  /* ---------- 产品详情页：轮播图 + 规格 + WhatsApp 按钮（PRD §6） ---------- */
  renderDetail(product) {
    const images = (product.images && product.images.length) ? product.images : [CONFIG.placeholderImage];
    const multi = images.length > 1;

    // 左右半透明箭头 + 底部圆点指示器：仅多图时显示
    const arrows = multi ? `
      <button class="carousel-arrow prev" data-action="switch-image" data-index="-1" aria-label="Previous image">‹</button>
      <button class="carousel-arrow next" data-action="switch-image" data-index="1" aria-label="Next image">›</button>` : '';

    const dots = multi ? `
      <div class="carousel-dots">
        ${images.map((_, i) =>
          `<span class="carousel-dot${i === 0 ? ' active' : ''}" data-action="switch-image" data-index="${i}"></span>`
        ).join('')}
      </div>` : '';

    const skuHtml = product.sku
      ? `<span class="detail-sku">SKU: #${Utils.esc(product.sku)}</span>`
      : '';

    const descHtml = product.description
      ? `<p class="detail-desc">${Utils.esc(product.description)}</p>`
      : '';

    const specsHtml = (product.details && product.details.length) ? `
      <div class="detail-specs">
        ${product.details.map(d => `
          <div class="spec-row">
            <span class="spec-label">${Utils.esc(d.label)}</span>
            <span class="spec-value">${Utils.esc(d.value)}</span>
          </div>`).join('')}
      </div>` : '';

    const skuForMsg = product.sku ? ` (SKU: ${product.sku})` : '';
    const waText = `Hi! I'm interested in "${product.name}"${skuForMsg}. Could you please send me more details?`;
    const waHref = CONFIG.waNumber ? Utils.waLink(CONFIG.waNumber, waText) : '#';

    return `
      <div class="app-page detail-page">
        <div class="carousel">
          <div class="carousel-viewport">
            <img id="carouselMainImg" class="carousel-main zoomable" src="${Utils.esc(images[0])}" alt="${Utils.esc(product.name)}"
                 data-action="zoom" data-zoom="carousel"
                 onerror="this.onerror=null;this.src='${CONFIG.placeholderImage}'">
            ${arrows}
          </div>
          ${dots}
        </div>
        <div class="detail-body">
          <h1 class="detail-name">${Utils.esc(product.name)}</h1>
          <div class="detail-meta">
            ${skuHtml}
            <button type="button" class="detail-inquire" data-action="wa-inquire" data-product-id="${Utils.esc(product.id)}">Inquire</button>
          </div>
          ${descHtml}
          ${specsHtml}
          <a class="wa-btn" data-action="wa-inquire" data-product-id="${Utils.esc(product.id)}"
             href="${waHref}" target="_blank" rel="noopener">
            💬 Inquire via WhatsApp
          </a>
        </div>
      </div>`;
  },

  /* ---------- 加载中：骨架屏（6 个灰色方块脉冲动画） ---------- */
  renderSkeleton() {
    const blocks = Array.from({ length: 6 }, () => '<div class="skeleton-card"></div>').join('');
    return `
      <div class="app-page skeleton-page">
        <div class="skeleton-grid">${blocks}</div>
      </div>`;
  },

  /* ---------- 加载失败：错误信息 + 重试按钮 ---------- */
  renderError(message) {
    return `
      <div class="app-page error-page">
        <div class="state-icon">😵</div>
        <p class="state-title">Oops, something went wrong</p>
        <p class="state-message">${Utils.esc(message)}</p>
        <button type="button" class="state-btn" data-action="retry">Retry</button>
      </div>`;
  },

  /* ---------- 空状态 ---------- */
  renderEmptyState(message) {
    return `
      <div class="app-page empty-page">
        <div class="state-icon">✨</div>
        <p class="state-title">${Utils.esc(message)}</p>
      </div>`;
  }
};

/* ================= 6. EventBus 事件总线模块 ================= */
const EventBus = {
  // 初始化：在 #app 容器上做事件委托，按 data-action 属性路由行为
  init() {
    document.getElementById('app').addEventListener('click', event => {
      const el = event.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      const handler = this._handlers[action];
      if (handler) handler.call(this, el, event);
      // TODO: 数据埋点扩展 —— 新增 data-action="track" 分支，统一上报事件
    });
  },

  _handlers: {
    // 通用跳转：从 data-href 读取目标 hash
    navigate(el, e) {
      e.preventDefault();
      const href = el.dataset.href;
      if (href) location.hash = href;
    },

    // 跳转到分类产品列表
    category(el) {
      Router.navigateTo('products', { categoryId: el.dataset.categoryId });
    },

    // 跳转到产品详情
    product(el) {
      Router.navigateTo('detail', { productId: el.dataset.productId });
    },

    // 切换详情页轮播图：箭头传相对偏移（±1），圆点传绝对索引
    'switch-image'(el) {
      const product = App.getProductById(AppState.currentProductId);
      if (!product || !product.images || !product.images.length) return;
      const len = product.images.length;
      const index = Number(el.dataset.index);
      const next = el.classList.contains('carousel-dot')
        ? index
        : (AppState.currentImageIndex + index + len) % len;
      App.renderCarousel(product, next);
    },

    // 返回上一级页面
    back() {
      Router.goBack();
    },

    // 点击放大图片：详情页轮播图支持前后切换，买家秀截图单张查看
    'zoom'(el) {
      if (el.dataset.zoom === 'carousel') {
        const product = App.getProductById(AppState.currentProductId);
        if (!product || !product.images || !product.images.length) return;
        Lightbox.open(product.images, AppState.currentImageIndex || 0, product.name);
      } else {
        Lightbox.open([el.src], 0, el.alt || '');
      }
    },

    // WhatsApp 询价跳转（携带产品名称与 SKU）
    'wa-inquire'(el, e) {
      if (e && e.preventDefault) e.preventDefault();
      const product = App.getProductById(el.dataset.productId || AppState.currentProductId);
      if (!product || !CONFIG.waNumber) return;
      const sku = product.sku ? ` (SKU: ${product.sku})` : '';
      const text = `Hi! I'm interested in "${product.name}"${sku}. Could you please send me more details?`;
      const url = Utils.waLink(CONFIG.waNumber, text);
      if (el.href) el.href = url; // 同步真实链接（支持中键 / 长按等原生行为）
      window.open(url, '_blank', 'noopener');
    },

    // 重新加载数据
    retry() {
      Cache.clearCache();
      App.init();
    }
  }
};

/* ================= 6.5 Lightbox 图片放大模块 ================= */
const Lightbox = {
  images: [],
  index: 0,

  // 初始化：绑定关闭 / 前后切换 / 键盘操作
  init() {
    this.overlay = document.getElementById('lightbox');
    this.img = document.getElementById('lightboxImg');
    this.caption = document.getElementById('lightboxCaption');
    this.prevBtn = document.getElementById('lightboxPrev');
    this.nextBtn = document.getElementById('lightboxNext');
    this.closeBtn = document.getElementById('lightboxClose');
    if (!this.overlay) return;

    this.closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.close();
    });
    this.prevBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.prev();
    });
    this.nextBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.next();
    });
    // 点击黑色背景区域关闭
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.close();
    });
    // 键盘：Esc 关闭，← → 切换
    document.addEventListener('keydown', e => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'ArrowLeft') this.prev();
      if (e.key === 'ArrowRight') this.next();
    });
  },

  isOpen() {
    return this.overlay && !this.overlay.classList.contains('hidden');
  },

  // 打开放大层：传入图片数组、起始索引与标题
  open(images, index, caption) {
    if (!this.overlay || !images || !images.length) return;
    this.images = images;
    this.index = Math.min(Math.max(index || 0, 0), images.length - 1);
    this.caption.textContent = caption || '';
    const multi = images.length > 1;
    this.prevBtn.classList.toggle('hidden', !multi);
    this.nextBtn.classList.toggle('hidden', !multi);
    this._show();
    document.body.style.overflow = 'hidden'; // 锁定背景滚动
  },

  prev() {
    if (this.images.length < 2) return;
    this.index = (this.index - 1 + this.images.length) % this.images.length;
    this._show();
  },

  next() {
    if (this.images.length < 2) return;
    this.index = (this.index + 1) % this.images.length;
    this._show();
  },

  _show() {
    this.img.classList.remove('carousel-fade');
    void this.img.offsetWidth; // 重放淡入动画
    this.img.src = this.images[this.index];
    this.img.classList.add('carousel-fade');
    this.overlay.classList.remove('hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
  },

  close() {
    this.overlay.classList.add('hidden');
    this.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
};

/* ================= 7. App 启动模块 ================= */
const App = {
  // 应用启动：加载数据 → 写入导航栏 → 初始化路由并渲染
  async init() {
    AppState.setState({ isLoading: true, error: null, allData: null });
    App.render(); // 先展示骨架屏

    try {
      const data = await Cache.loadData();
      CONFIG.waNumber = String(data.waNumber || '').replace(/\D/g, '');
      CONFIG.siteName = data.siteName || '';
      AppState.setState({ allData: data, isLoading: false });
      App.applyNavbar(data);
      Router.init(); // 首次进入按当前 hash 渲染；重试时已有初始化则跳过
      App.render();  // 确保数据就绪后渲染当前路由
    } catch (err) {
      AppState.setState({
        isLoading: false,
        error: (err && err.message) ? err.message : '数据加载失败'
      });
      App.render();
    }
  },

  // 将站点信息写入硬编码导航栏：Logo / WhatsApp 快捷入口 / 页面标题
  applyNavbar(data) {
    const logo = document.getElementById('siteLogo');
    const chat = document.getElementById('chatLink');
    if (logo) logo.textContent = data.siteName || 'TheDupe';
    if (chat && CONFIG.waNumber) {
      chat.href = Utils.waLink(CONFIG.waNumber, "Hi! I'd like to know more about your products.");
    }
    document.title = data.siteName || 'TheDupe';
  },

  // 根据当前路由渲染页面到 #app 容器
  render() {
    const container = document.getElementById('app');

    if (AppState.isLoading) {
      container.innerHTML = Renderer.renderSkeleton();
      this._syncBackBtn();
      return;
    }
    if (AppState.error) {
      container.innerHTML = Renderer.renderError(AppState.error);
      this._syncBackBtn();
      return;
    }
    if (!AppState.allData) return;

    const data = AppState.allData;
    const categories = (data.categories || []).slice().sort(Utils.bySort);
    const activeProducts = Utils.activeProducts(data.products || []);

    let html = '';
    if (AppState.currentPage === 'products') {
      const category = categories.find(c => c.id === AppState.currentCategoryId);
      const list = activeProducts
        .filter(p => p.categoryId === AppState.currentCategoryId)
        .sort(Utils.bySort);
      html = Renderer.renderProducts(AppState.currentCategoryId, list, category ? category.name : 'Products');
    } else if (AppState.currentPage === 'detail') {
      const product = this.getProductById(AppState.currentProductId);
      html = product
        ? Renderer.renderDetail(product)
        : Renderer.renderEmptyState('Product not found');
    } else {
      html = Renderer.renderHome(categories, activeProducts, data.testimonials || []);
    }

    container.innerHTML = html;
    this._syncBackBtn();
  },

  // 按 ID 获取产品（仅上架）
  getProductById(id) {
    if (!AppState.allData || !id) return null;
    return Utils.activeProducts(AppState.allData.products || []).find(p => p.id === id) || null;
  },

  // 更新详情页轮播图（局部更新，不整页刷新，带淡入过渡）
  renderCarousel(product, index) {
    const img = document.getElementById('carouselMainImg');
    if (!img || !product.images || !product.images[index]) return;
    AppState.currentImageIndex = index;
    img.classList.remove('carousel-fade');
    void img.offsetWidth; // 强制 reflow，重放淡入动画
    img.src = product.images[index];
    img.classList.add('carousel-fade');
    document.querySelectorAll('.carousel-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
  },

  // 首页隐藏返回按钮；列表页 / 详情页显示（PRD §9）
  _syncBackBtn() {
    const back = document.getElementById('backBtn');
    if (back) {
      back.classList.toggle('hidden', AppState.currentPage === 'home');
    }
  }
};

/* ---------- 启动 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.addEventListener('click', () => Router.goBack());
  EventBus.init();
  Lightbox.init();
  App.init();
});
