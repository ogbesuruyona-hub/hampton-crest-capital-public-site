const routes = ["/", "/academia", "/academia/libros", "/mi-progreso", "/analisis", "/watchlists", "/contacto", "/auth", "/admin", "/admin/cursos", "/admin/lecciones", "/admin/libros", "/admin/usuarios"];
const protectedRoutes = new Set(["/analisis", "/watchlists", "/mi-progreso", "/admin"]);
const adminRoutes = new Set(["/admin", "/admin/cursos", "/admin/lecciones", "/admin/libros", "/admin/usuarios"]);
const bookCategories = ["Investing", "Personal Finance", "Economics", "Stock Market", "Risk Management", "Beginner Guides"];
const APP_BASE = "/centro-del-inversor";
const root = document.getElementById("root");

async function loadRuntimeEnv() {
  const existing = window.HCC_ENV || {};
  if (existing.SUPABASE_URL && existing.SUPABASE_ANON_KEY) return existing;

  try {
    const response = await fetch("/api/public-config", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Public config unavailable");
    const runtimeEnv = await response.json();
    window.HCC_ENV = {
      ...existing,
      ...runtimeEnv,
      PUBLIC_APP_URL: runtimeEnv.PUBLIC_APP_URL || existing.PUBLIC_APP_URL || ""
    };
    return window.HCC_ENV;
  } catch (error) {
    console.warn("Public configuration could not be loaded.");
    return existing;
  }
}

const DataStore = {
  async createContactRequest(payload) {
    if (!AuthProvider.client) throw new Error("El acceso privado no está disponible en este momento.");
    const { error } = await AuthProvider.client.from("contact_requests").insert({ ...payload, status: "new" });
    if (error) throw error;
  },

  async getAcademyCourses({ admin = false } = {}) {
    if (!AuthProvider.client) return [];
    let query = AuthProvider.client
      .from("academy_courses")
      .select("id,title,slug,description,thumbnail_url,is_published,created_at,updated_at,academy_lessons(id,is_published)")
      .order("created_at", { ascending: false });
    if (!admin) query = query.eq("is_published", true);
    const { data, error } = await query;
    if (error) {
      console.error(error);
      throw new Error("No se pudieron cargar los cursos.");
    }
    return (data || []).map(course => ({
      ...course,
      academy_lessons: course.academy_lessons || [],
      lesson_count: (course.academy_lessons || []).filter(lesson => admin || lesson.is_published).length
    }));
  },

  async getAcademyCourseBySlug(slug) {
    if (!AuthProvider.client) return null;
    const { data, error } = await AuthProvider.client
      .from("academy_courses")
      .select("id,title,slug,description,thumbnail_url,is_published,created_at,academy_lessons(id,title,content,video_url,lesson_order,is_published,created_at)")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error("No se pudo cargar el curso.");
    }
    if (!data) return null;
    data.academy_lessons = (data.academy_lessons || [])
      .filter(lesson => lesson.is_published)
      .sort((a, b) => Number(a.lesson_order || 0) - Number(b.lesson_order || 0));
    return data;
  },

  async getAcademyLesson(lessonId) {
    if (!AuthProvider.client) return null;
    const { data, error } = await AuthProvider.client
      .from("academy_lessons")
      .select("id,course_id,title,content,video_url,lesson_order,is_published,academy_courses(id,title,slug,description,is_published)")
      .eq("id", lessonId)
      .eq("is_published", true)
      .maybeSingle();
    if (error) {
      console.error(error);
      throw new Error("No se pudo cargar la lección.");
    }
    if (!data?.academy_courses?.is_published) return null;
    return data;
  },

  async getAcademyBooks({ admin = false } = {}) {
    if (!AuthProvider.client) return [];
    let query = AuthProvider.client
      .from("academy_books")
      .select("id,title,author,description,category,cover_image_url,file_url,is_published,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (!admin) query = query.eq("is_published", true);
    const { data, error } = await query;
    if (error) {
      console.error(error);
      throw new Error("No se pudieron cargar los libros.");
    }
    return data || [];
  },

  async getLessonProgress() {
    if (!AuthProvider.client || !AuthProvider.user) return new Map();
    const { data, error } = await AuthProvider.client
      .from("lesson_progress")
      .select("lesson_id,completed,completed_at")
      .eq("user_id", AuthProvider.user.id);
    if (error) {
      console.error(error);
      return new Map();
    }
    return new Map((data || []).map(item => [String(item.lesson_id), item]));
  },

  async saveLessonProgress(lessonId, progressPercent = 100) {
    if (!AuthProvider.client || !AuthProvider.user) return;
    const completed = progressPercent >= 100;
    const { error } = await AuthProvider.client.from("lesson_progress").upsert({
      user_id: AuthProvider.user.id,
      lesson_id: lessonId,
      completed,
      completed_at: completed ? new Date().toISOString() : null
    }, { onConflict: "user_id,lesson_id" });
    if (error) throw error;
  },

  async getProgressSummary() {
    const [courses, progress] = await Promise.all([
      this.getAcademyCourses(),
      this.getLessonProgress()
    ]);
    const totalLessons = courses.reduce((sum, course) => sum + course.lesson_count, 0);
    const completedLessons = [...progress.values()].filter(item => item.completed).length;
    return {
      courses,
      progress,
      coursesStarted: courses.filter(course => (course.academy_lessons || []).some(lesson => progress.has(String(lesson.id)))).length,
      coursesCompleted: courses.filter(course => (course.academy_lessons || []).length && course.academy_lessons.every(lesson => progress.get(String(lesson.id))?.completed)).length,
      completedLessons,
      totalLessons,
      progressPercent: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0
    };
  },

  async saveTickerSearch(ticker, notes = "", companyName = "") {
    if (!AuthProvider.client || !AuthProvider.user) throw new Error("Debe iniciar sesión para guardar búsquedas.");
    const { error } = await AuthProvider.client.from("stock_searches").insert({
      user_id: AuthProvider.user.id,
      ticker,
      company_name: companyName || ticker,
      search_notes: notes
    });
    if (error) throw error;
  },

  async searchTicker(query) {
    const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No pudimos cargar los datos del mercado en este momento.");
    return payload.results || [];
  },

  async getStockAnalysis(ticker) {
    const response = await fetch(`/api/stocks/${encodeURIComponent(ticker)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No pudimos cargar los datos del mercado en este momento.");
    return payload.stock;
  },

  async getSearchHistory({ all = false } = {}) {
    if (!AuthProvider.client || !AuthProvider.user) return [];
    let query = AuthProvider.client
      .from("stock_searches")
      .select("id,user_id,ticker,company_name,search_notes,created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (!all) query = query.eq("user_id", AuthProvider.user.id);
    const { data, error } = await query;
    if (error) {
      console.error(error);
      return [];
    }
    return data || [];
  },

  async getWatchlists({ all = false } = {}) {
    if (!AuthProvider.client || !AuthProvider.user) return [];
    let query = AuthProvider.client
      .from("watchlists")
      .select("id,user_id,name,created_at,updated_at,watchlist_items(id,ticker,company_name,created_at)")
      .order("created_at", { ascending: true });
    if (!all) query = query.eq("user_id", AuthProvider.user.id);
    const { data, error } = await query;
    if (error) {
      console.error(error);
      throw new Error("No se pudieron cargar sus watchlists.");
    }
    return (data || []).map(item => ({
      ...item,
      watchlist_items: item.watchlist_items || []
    }));
  },

  async getWatchlistDashboard() {
    const [watchlists, searches] = await Promise.all([
      this.getWatchlists(),
      this.getSearchHistory()
    ]);
    const savedStocks = watchlists.reduce((total, item) => total + (item.watchlist_items?.length || 0), 0);
    return {
      watchlists,
      searches: searches.slice(0, 5),
      savedStocks
    };
  },

  async createWatchlist(name) {
    if (!AuthProvider.client || !AuthProvider.user) throw new Error("Debe iniciar sesión para crear watchlists.");
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Ingrese un nombre para la watchlist.");
    const { data, error } = await AuthProvider.client
      .from("watchlists")
      .insert({ user_id: AuthProvider.user.id, name: cleanName })
      .select("id,user_id,name,created_at,updated_at")
      .single();
    if (error) throw error;
    return data;
  },

  async renameWatchlist(id, name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Ingrese un nombre válido.");
    const { error } = await AuthProvider.client
      .from("watchlists")
      .update({ name: cleanName })
      .eq("id", id);
    if (error) throw error;
  },

  async deleteWatchlist(id) {
    const { error } = await AuthProvider.client
      .from("watchlists")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  async addWatchlistItem(watchlistId, stock) {
    if (!AuthProvider.client || !AuthProvider.user) throw new Error("Debe iniciar sesión para guardar acciones.");
    const ticker = String(stock?.ticker || "").trim().toUpperCase();
    if (!ticker) throw new Error("Ingrese un símbolo válido.");
    const { error } = await AuthProvider.client
      .from("watchlist_items")
      .insert({
        watchlist_id: watchlistId,
        ticker,
        company_name: stock.companyName || ticker
      });
    if (error?.code === "23505") throw new Error("Ese símbolo ya existe en esta watchlist.");
    if (error) throw error;
  },

  async removeWatchlistItem(itemId) {
    const { error } = await AuthProvider.client
      .from("watchlist_items")
      .delete()
      .eq("id", itemId);
    if (error) throw error;
  },

  async uploadAcademyFile(bucket, file) {
    if (!AuthProvider.client || !file?.name) return "";
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    const path = `${AuthProvider.user.id}/${Date.now()}-${safeName}`;
    const { error } = await AuthProvider.client.storage.from(bucket).upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = AuthProvider.client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  async saveCourse(payload, id = "") {
    const row = {
      title: payload.title,
      slug: payload.slug || slugify(payload.title),
      description: payload.description || null,
      thumbnail_url: payload.thumbnail_url || null,
      is_published: Boolean(payload.is_published)
    };
    const query = id
      ? AuthProvider.client.from("academy_courses").update(row).eq("id", id)
      : AuthProvider.client.from("academy_courses").insert(row);
    const { error } = await query;
    if (error) throw error;
  },

  async deleteCourse(id) {
    const { error } = await AuthProvider.client.from("academy_courses").delete().eq("id", id);
    if (error) throw error;
  },

  async getAdminLessons() {
    const { data, error } = await AuthProvider.client
      .from("academy_lessons")
      .select("id,course_id,title,content,video_url,lesson_order,is_published,created_at,academy_courses(title,slug)")
      .order("lesson_order", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async saveLesson(payload, id = "") {
    const row = {
      course_id: payload.course_id || null,
      title: payload.title,
      content: payload.content || null,
      video_url: payload.video_url || null,
      lesson_order: Number(payload.lesson_order || 0),
      is_published: Boolean(payload.is_published)
    };
    const query = id
      ? AuthProvider.client.from("academy_lessons").update(row).eq("id", id)
      : AuthProvider.client.from("academy_lessons").insert(row);
    const { error } = await query;
    if (error) throw error;
  },

  async deleteLesson(id) {
    const { error } = await AuthProvider.client.from("academy_lessons").delete().eq("id", id);
    if (error) throw error;
  },

  async saveBook(payload, id = "") {
    const row = {
      title: payload.title,
      author: payload.author || null,
      description: payload.description || null,
      category: payload.category || null,
      cover_image_url: payload.cover_image_url || null,
      file_url: payload.file_url || null,
      is_published: Boolean(payload.is_published)
    };
    const query = id
      ? AuthProvider.client.from("academy_books").update(row).eq("id", id)
      : AuthProvider.client.from("academy_books").insert(row);
    const { error } = await query;
    if (error) throw error;
  },

  async deleteBook(id) {
    const { error } = await AuthProvider.client.from("academy_books").delete().eq("id", id);
    if (error) throw error;
  },

  async getAdminUsers() {
    const { data, error } = await AuthProvider.client
      .from("profiles")
      .select("id,full_name,email,role,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  },

  async getAdminStats() {
    if (!AuthProvider.client) return { users: "—", contacts: "—", searches: "—", courses: "—", lessons: "—", books: "—" };
    const countQuery = (table, filter) => {
      let query = AuthProvider.client.from(table).select("*", { count: "exact", head: true });
      if (filter) query = filter(query);
      return query;
    };
    const [users, contacts, searches, courses, lessons, books] = await Promise.all([
      countQuery("profiles"),
      countQuery("contact_requests"),
      countQuery("stock_searches"),
      countQuery("academy_courses", query => query.eq("is_published", true)),
      countQuery("academy_lessons", query => query.eq("is_published", true)),
      countQuery("academy_books", query => query.eq("is_published", true))
    ]);
    return {
      users: users.count ?? "—",
      contacts: contacts.count ?? "—",
      searches: searches.count ?? "—",
      courses: courses.count ?? "—",
      lessons: lessons.count ?? "—",
      books: books.count ?? "—"
    };
  },

  async getMostSearchedSymbols() {
    if (!AuthProvider.client) return [];
    const { data, error } = await AuthProvider.client
      .from("stock_searches")
      .select("ticker")
      .limit(500);
    if (error) {
      console.error(error);
      return [];
    }
    const counts = new Map();
    (data || []).forEach(item => {
      const ticker = String(item.ticker || "").toUpperCase();
      if (ticker) counts.set(ticker, (counts.get(ticker) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ticker, count]) => ({ ticker, count }));
  },

  async getContactRequests() {
    if (!AuthProvider.client) return [];
    const { data, error } = await AuthProvider.client
      .from("contact_requests")
      .select("id,name,email,phone,subject,message,status,created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      console.error(error);
      throw new Error("No se pudieron cargar las solicitudes de contacto.");
    }
    return data || [];
  },

  async updateContactStatus(id, status) {
    if (!AuthProvider.client) throw new Error("El acceso privado no está disponible en este momento.");
    const { error } = await AuthProvider.client
      .from("contact_requests")
      .update({ status })
      .eq("id", id);
    if (error) throw error;
  }
};

const AuthProvider = {
  client: null,
  user: null,
  profile: null,
  ready: true,
  initializing: false,
  configured: false,
  error: "",

  async init() {
    if (this.initializing) {
      while (this.initializing) await new Promise(resolve => setTimeout(resolve, 50));
      return;
    }
    if (this.client || this.error) return;
    this.initializing = true;
    const env = await loadRuntimeEnv();
    this.configured = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
    if (!this.configured) {
      this.ready = true;
      this.error = "El acceso privado del Centro del Inversor está temporalmente en configuración. Para asistencia, contacte a Hampton Crest Capital.";
      this.initializing = false;
      return;
    }

    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      this.client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage
        }
      });
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      await this.setSession(data.session);
      this.client.auth.onAuthStateChange(async (_event, session) => {
        await this.setSession(session);
        SessionTimeoutHandler.sync();
        renderRoute();
      });
    } catch (error) {
      this.error = "No pudimos iniciar el acceso privado en este momento. Intente nuevamente más tarde o contacte a Hampton Crest Capital.";
      console.error(error);
    } finally {
      this.ready = true;
      this.initializing = false;
    }
  },

  async setSession(session) {
    this.user = session?.user || null;
    this.profile = null;
    if (this.user) await this.loadProfile();
  },

  async loadProfile() {
    const { data, error } = await this.client
      .from("profiles")
      .select("id, full_name, email, role, created_at, updated_at")
      .eq("id", this.user.id)
      .maybeSingle();

    if (error) {
      this.profile = {
        id: this.user.id,
        full_name: this.user.user_metadata?.full_name || "",
        email: this.user.email,
        role: "viewer"
      };
      return;
    }
    this.profile = data || {
      id: this.user.id,
      full_name: this.user.user_metadata?.full_name || "",
      email: this.user.email,
      role: "viewer"
    };
  },

  async register({ fullName, email, password }) {
    if (!this.client) await this.init();
    if (!this.client) throw new Error(this.error);
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    });
    if (error) throw error;
    if (data.session) await this.setSession(data.session);
    return data;
  },

  async login({ email, password }) {
    if (!this.client) await this.init();
    if (!this.client) throw new Error(this.error);
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await this.setSession(data.session);
    return data;
  },

  async resetPassword(email) {
    if (!this.client) await this.init();
    if (!this.client) throw new Error(this.error);
    const env = window.HCC_ENV || {};
    const appUrl = String(env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
    const authPath = `${APP_BASE}/index.html#/auth`;
    const redirectTo = appUrl ? `${appUrl}${authPath}` : location.origin === "null" ? undefined : `${location.origin}${authPath}`;
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },

  async logout({ reason } = {}) {
    if (this.client) await this.client.auth.signOut();
    this.user = null;
    this.profile = null;
    SessionTimeoutHandler.stop();
    if (reason) showToast(reason);
    navigate("/");
  }
};

const SessionTimeoutHandler = {
  timeoutMs: 30 * 60 * 1000,
  timer: null,
  events: ["click", "keydown", "mousemove", "scroll", "touchstart"],

  sync() {
    this.stop();
    if (!AuthProvider.user) return;
    this.events.forEach(eventName => window.addEventListener(eventName, this.reset, { passive: true }));
    this.reset();
  },

  reset: () => {
    clearTimeout(SessionTimeoutHandler.timer);
    SessionTimeoutHandler.timer = setTimeout(() => {
      AuthProvider.logout({ reason: "Sesión cerrada por inactividad." });
    }, SessionTimeoutHandler.timeoutMs);
  },

  stop() {
    clearTimeout(this.timer);
    this.events.forEach(eventName => window.removeEventListener(eventName, this.reset));
  }
};

const Components = {
  Logo: ({ className = "" } = {}) => `
    <span class="brand-logo ${className}">
      <img class="logo-full" src="./assets/hampton-crest-capital-logo-transparent.png" alt="Hampton Crest Capital">
      <img class="logo-icon" src="./assets/hampton-crest-capital-icon-transparent.png" alt="Hampton Crest Capital">
    </span>`,

  BrandEmblem: ({ className = "" } = {}) => Components.Logo({ className: `capital-emblem ${className}` }),

  Header: ({ academy = false } = {}) => `
    <header class="site-header ${academy ? "academy-site-header" : ""}">
      <a class="brand ${academy ? "academy-header-brand" : ""}" href="/" data-link aria-label="Hampton Crest Capital, inicio">${Components.Logo()}</a>
      <button class="menu-button" id="menuButton" aria-label="Abrir menú" aria-expanded="false"><span></span><span></span></button>
      <nav class="site-nav" id="siteNav" aria-label="Navegación principal">
        <a href="/" data-link>Inicio</a>
        <a href="/academia" data-link>Academia Gratuita</a>
        <a href="/analisis" data-link>Análisis</a>
        <a href="/academia/libros" data-link>Libros</a>
        <a href="/contacto" data-link>Contacto</a>
        ${AuthProvider.user ? `<a href="/watchlists" data-link>Watchlists</a>` : ""}
        ${AuthProvider.user ? `<a href="/mi-progreso" data-link>Mi progreso</a>` : ""}
        ${AuthProvider.profile?.role === "admin" ? `<a href="/admin" data-link>Admin</a>` : ""}
        ${Components.UserMenu()}
      </nav>
    </header>`,

  Footer: ({ academy = false } = {}) => `
    <footer class="site-footer ${academy ? "academy-site-footer" : ""}">
      <div class="footer-top">
        <a class="brand footer-brand ${academy ? "academy-footer-brand" : ""}" href="/" data-link>${Components.Logo()}</a>
        <div class="footer-social">
          <span>Síguenos</span>
          <div class="footer-social-icons" aria-label="Redes sociales oficiales">
            <a href="https://www.facebook.com/share/18f43eLCCe/?mibextid=wwXIfr" target="_blank" rel="noopener noreferrer" aria-label="Facebook de Hampton Crest Capital">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4h-3c-3.3 0-5 1.9-5 5v2H6v4h3v5h4v-5h3.2l.8-4h-4V9c0-.7.3-1 1-1z"/></svg>
            </a>
            <a href="https://www.instagram.com/hamptoncapitacrest?igsh=aG8waGo3N3dldWN0&utm_source=qr" target="_blank" rel="noopener noreferrer" aria-label="Instagram de Hampton Crest Capital">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.5"/><circle cx="16.8" cy="7.2" r="1"/></svg>
            </a>
            <a href="https://www.tiktok.com/@hamptoncapital?_r=1&_t=ZT-976xQQ5ZetZ" target="_blank" rel="noopener noreferrer" aria-label="TikTok de Hampton Crest Capital">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v10.2a4.2 4.2 0 1 1-4.2-4.2c.4 0 .8.1 1.2.2v3.2a1.6 1.6 0 1 0 1 1.5V4h2z"/><path d="M14 4c.5 2.8 2.1 4.3 5 4.7v3.1c-2.1-.1-3.7-.8-5-2v-3z"/></svg>
            </a>
            <a href="https://youtube.com/@isaacfernandez-d4l?si=S2s_fNsJR2eH34OB" target="_blank" rel="noopener noreferrer" aria-label="YouTube de Hampton Crest Capital">
              <svg class="youtube-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="youtube-frame" d="M21 8.4a3 3 0 0 0-2.1-2.1C17 5.8 12 5.8 12 5.8s-5 0-6.9.5A3 3 0 0 0 3 8.4 29.6 29.6 0 0 0 2.5 12a29.6 29.6 0 0 0 .5 3.6 3 3 0 0 0 2.1 2.1c1.9.5 6.9.5 6.9.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.1 29.6 29.6 0 0 0 .5-3.6 29.6 29.6 0 0 0-.5-3.6z"/><path class="youtube-play" d="M10.2 8.9v6.2l5.4-3.1-5.4-3.1z"/></svg>
            </a>
          </div>
        </div>
        <div class="footer-contact-mini">
          <span>Correo electrónico</span>
          <a href="mailto:hamptoncrestcapital@gmail.com">hamptoncrestcapital@gmail.com</a>
        </div>
      </div>
      <div class="footer-disclaimer">
        <p><strong>Aviso importante:</strong> Todo el contenido tiene fines exclusivamente educativos e informativos. No constituye asesoramiento financiero, recomendación de inversión, oferta ni solicitud para comprar o vender valores. Toda inversión implica riesgo, incluida la posible pérdida del capital.</p>
        <span>© 2026 Hampton Crest Capital. Todos los derechos reservados.</span>
      </div>
    </footer>`,

  UserMenu: () => {
    if (!AuthProvider.user) return `<a class="nav-session" href="/auth" data-link>Acceder</a>`;
    const display = AuthProvider.profile?.full_name || AuthProvider.user.email;
    return `
      <div class="user-menu">
        <button class="user-menu-button" id="userMenuButton" aria-expanded="false">
          <span class="user-avatar">${initials(display)}</span><span>${escapeHtml(display)}</span>
        </button>
        <div class="user-menu-panel" id="userMenuPanel">
          <strong>${escapeHtml(display)}</strong>
          <small>${escapeHtml(AuthProvider.user.email || "")}</small>
          <small>Rol: ${escapeHtml(AuthProvider.profile?.role || "viewer")}</small>
          <a href="/analisis" data-link>Centro de Análisis</a>
          <a href="/watchlists" data-link>Mis Watchlists</a>
          <a href="/mi-progreso" data-link>Mi progreso</a>
          ${AuthProvider.profile?.role === "admin" ? `<a href="/admin" data-link>Administración</a>` : ""}
          <button id="logoutButton">Cerrar sesión</button>
        </div>
      </div>`;
  },

  Button: ({ label, href, variant = "primary" }) => `<a class="button button-${variant}" href="${href}" data-link>${label}</a>`,
  Section: ({ content, tone = "cream", className = "" }) => `<section class="section section-${tone} ${className}"><div class="container">${content}</div></section>`,
  Card: ({ number, title, text }) => {
    const icons = {
      "01": `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 8.5h8.5c2.4 0 4 1.6 4 4v13H11c-2.4 0-4-1.6-4-4v-13Z"/><path d="M19.5 12.5h5.5v13h-5.5"/><path d="M11 14h4.5M11 18h4.5"/></svg>`,
      "02": `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 24h20"/><path d="M9 21v-5M15 21v-9M21 21v-12"/><path d="M7 10h18"/><path d="M7 10v14M25 10v14"/></svg>`,
      "03": `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 27 9v7c0 6.4-4.3 10.7-11 13-6.7-2.3-11-6.6-11-13V9l11-5Z"/><path d="m11 16 3.2 3.2 7-7"/></svg>`,
      "04": `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11"/><path d="M16 8v8l5 4"/><path d="M6 16h3M23 16h3"/></svg>`
    };
    return `<article class="feature-card feature-card-${number}" aria-label="${escapeHtml(title)}">
      <div class="feature-card-media" aria-hidden="true">${icons[number] || icons["03"]}</div>
      <h3>${title}</h3>
      <p>${text}</p>
    </article>`;
  },
  PageHero: ({ eyebrow, title, text }) => `<section class="page-hero"><div class="container"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${text}</p></div></section>`,
  AcademyHero: ({ eyebrow, title, text }) => `<section class="page-hero academy-hero"><div class="container academy-hero-inner"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${text}</p></div></section>`,
  DisclaimerBlock: ({ compact = false } = {}) => `<aside class="disclaimer ${compact ? "disclaimer-compact" : ""}"><strong>Contenido exclusivamente educativo.</strong> Este análisis es únicamente educativo e informativo. No constituye asesoría financiera, recomendación de inversión, oferta ni solicitud para comprar o vender valores. Toda inversión implica riesgo, incluida la posible pérdida del capital.</aside>`
};

const ProtectedRoute = page => {
  if (!AuthProvider.ready) return Pages.Loading();
  if (!AuthProvider.user) return Pages.Restricted();
  return page();
};

const AdminRoute = page => {
  if (!AuthProvider.ready) return Pages.Loading();
  if (!AuthProvider.user) return Pages.Restricted();
  if (AuthProvider.profile?.role !== "admin") return Pages.Forbidden();
  return page();
};

const Pages = {
  Loading: () => `<div class="page"><section class="gate"><div class="container gate-card"><div class="gate-brand">${Components.Logo()}</div><span class="eyebrow">Cargando</span><h1>Preparando sesión</h1><p>Estamos comprobando el estado de autenticación.</p></div></section></div>`,

  Restricted: () => `
    <div class="page"><section class="gate">
      <div class="container gate-card restricted-gate-card">
        <span class="eyebrow">Área privada</span>
        <h1>Acceso restringido</h1>
        <p>El Centro de Análisis está disponible únicamente para usuarios registrados.</p>
        <div class="button-row">
          <a class="button button-primary" href="/auth?mode=register" data-link>Crear cuenta gratuita</a>
          <a class="button button-secondary" href="/auth?mode=login" data-link>Iniciar sesión</a>
        </div>
      </div>
    </section></div>`,

  Forbidden: () => `
    <div class="page"><section class="gate">
      <div class="container gate-card">
        <div class="gate-brand">${Components.Logo()}</div>
        <span class="eyebrow">Administración</span>
        <h1>Acceso no autorizado</h1>
        <p>Esta sección requiere rol administrativo.</p>
        <div class="button-row">${Components.Button({ label: "Ir al análisis", href: "/analisis" })}</div>
      </div>
    </section></div>`,

  Home: () => `
    <div class="page">
      <section class="hero"><div class="container hero-content">
        <span class="eyebrow">Patrimonio · Disciplina · Visión</span>
        <h1 class="hero-statement"><span>Inversiones con propósito.</span><span>Resultados con disciplina.</span></h1>
        <p>Hampton Crest Capital ofrece formación institucional y herramientas de análisis para inversionistas que buscan construir patrimonio con criterio y rigor.</p>
        <div class="button-row">${Components.Button({ label: "Acceso gratuito", href: "/analisis" })}${Components.Button({ label: "Explorar Academia", href: "/academia", variant: "secondary" })}</div>
      </div></section>
      ${Components.Section({ content: `
        <div class="mission-layout"><div class="section-heading"><span class="eyebrow">Nuestra misión</span><h2>Elevar el nivel del inversionista hispanohablante a través de la educación.</h2></div>
        <div class="mission-copy"><p>Creemos que las mejores decisiones de inversión nacen del conocimiento, no de la especulación. Por eso democratizamos el acceso a marcos analíticos institucionales, con un enfoque en fundamentos, disciplina y horizonte de largo plazo.</p><a class="text-link" href="/academia" data-link>Conocer la academia</a></div></div>`,
        tone: "cream"
      })}
      ${Components.Section({ content: `
        <div class="section-heading"><span class="eyebrow">Centro del Inversor</span><h2>Una base rigurosa para cada etapa.</h2><p>Herramientas y contenidos diseñados para convertir información compleja en criterio aplicable.</p></div>
        <div class="feature-grid">
          ${Components.Card({ number: "01", title: "Academia gratuita", text: "Lecciones claras para dominar fundamentos, riesgo, valoración y construcción de cartera." })}
          ${Components.Card({ number: "02", title: "Análisis de acciones", text: "Marcos estructurados para investigar empresas y formular preguntas relevantes." })}
          ${Components.Card({ number: "03", title: "Rigor institucional", text: "Principios y procesos inspirados en una toma de decisiones profesional y responsable." })}
          ${Components.Card({ number: "04", title: "Visión de largo plazo", text: "Perspectiva para separar el ruido de corto plazo de los factores verdaderamente importantes." })}
        </div>`, tone: "paper"
      })}
      ${Components.Section({ content: `
        <div class="cta-band"><div><span class="eyebrow">Su próximo paso</span><h2>¿Listo para comenzar?</h2><p>Crear una cuenta gratuita y desbloquee el Centro de Análisis y su historial personal.</p></div><div class="button-row">${Components.Button({ label: "Registrarse gratis", href: "/auth?mode=register" })}${Components.Button({ label: "Solicitar información", href: "/contacto", variant: "secondary" })}</div></div>`,
        tone: "navy"
      })}
    </div>`,

  Academia: () => `
    <div class="page academy-page">${Components.AcademyHero({ eyebrow: "Academia gratuita", title: "Conocimiento para invertir con criterio.", text: "Cursos y biblioteca educativa para estudiar empresas, riesgo, finanzas personales y mercados con disciplina." })}
    ${Components.Section({ content: `<div class="academy-toolbar"><div class="search-bar"><span>⌕</span><input id="academySearch" type="search" placeholder="Buscar cursos o libros" aria-label="Buscar contenido de academia"></div><a class="button button-outline" href="/academia/libros" data-link>Biblioteca gratuita</a></div><div class="section-heading compact-heading"><span class="eyebrow">Cursos destacados</span><h2>Cursos destacados</h2></div><div class="course-grid" id="featuredCourses"></div><div class="section-heading compact-heading"><span class="eyebrow">Cursos nuevos</span><h2>Nuevos cursos</h2></div><div class="course-grid" id="newCourses"></div><div class="section-heading compact-heading"><span class="eyebrow">Biblioteca gratuita</span><h2>Biblioteca Financiera Gratuita</h2></div><div class="book-grid" id="academyBooksPreview"></div>${Components.DisclaimerBlock({ compact: true })}`, tone: "cream" })}</div>`,

  AcademyBooks: () => `
    <div class="page academy-page">${Components.AcademyHero({ eyebrow: "Biblioteca gratuita", title: "Biblioteca Financiera Gratuita", text: "Recursos educativos seleccionados para ayudarle a fortalecer sus conocimientos financieros y su criterio como inversionista." })}
    ${Components.Section({ content: `<h2 class="sr-only">Catálogo de libros</h2><div class="filter-row" id="bookFilters"></div><div class="book-grid" id="bookLibrary"><div class="empty-state"><h2>Cargando libros</h2><p class="muted">Consultando biblioteca educativa…</p></div></div>${Components.DisclaimerBlock({ compact: true })}`, tone: "cream" })}</div>`,

  Course: () => `
    <div class="page academy-page" id="coursePage">${Components.AcademyHero({ eyebrow: "Curso", title: "Cargando curso", text: "Preparando contenido educativo…" })}</div>`,

  Lesson: () => `
    <div class="page academy-page" id="lessonPage">${Components.AcademyHero({ eyebrow: "Lección", title: "Cargando lección", text: "Preparando contenido educativo…" })}</div>`,

  Progress: () => `
    <div class="page">${Components.PageHero({ eyebrow: "Mi progreso", title: "Su avance educativo.", text: "Revise lecciones completadas, cursos iniciados y próximos contenidos para continuar." })}
    ${Components.Section({ content: `<div id="progressDashboard" class="panel"><p class="muted">Cargando progreso…</p></div>${Components.DisclaimerBlock({ compact: true })}`, tone: "cream" })}</div>`,

  Analisis: () => {
    const profile = AuthProvider.profile || {};
    const user = AuthProvider.user || {};
    const fullName = profile.full_name || user.email || "Usuario";
    return `
      <div class="page">${Components.PageHero({ eyebrow: "Centro de análisis", title: "Bienvenido al Centro de Análisis", text: "Área privada para usuarios registrados de Hampton Crest Capital." })}
      ${Components.Section({ content: `
        <div class="dashboard-grid">
          <article class="welcome-card">
            <span class="eyebrow">Sesión activa</span>
            <h2>Bienvenido al Centro de Análisis</h2>
            <div class="profile-list">
              <div><span>Nombre</span><strong>${escapeHtml(fullName)}</strong></div>
              <div><span>Email</span><strong>${escapeHtml(user.email || "—")}</strong></div>
              <div><span>Rol</span><strong>${escapeHtml(profile.role || "viewer")}</strong></div>
            </div>
          </article>
          <article class="panel personal-dashboard-panel" id="personalDashboard">
            <span class="eyebrow">Panel personal</span>
            <h2 class="serif">Seguimiento educativo</h2>
            <p class="muted">Cargando sus búsquedas recientes y watchlists…</p>
          </article>
          <article class="panel history-placeholder">
            <span class="eyebrow">Historial personal</span>
            <h2 class="serif">Buscar y guardar análisis por ticker.</h2>
            <form class="analysis-form-inline" id="tickerForm">
              <div class="form-field"><label for="tickerInput">Símbolo bursátil</label><input id="tickerInput" name="ticker" maxlength="16" required placeholder="Ingrese un símbolo" autocomplete="off" list="tickerSuggestions"></div>
              <datalist id="tickerSuggestions"></datalist>
              <button class="button button-ink">Analizar símbolo</button>
            </form>
            ${Components.DisclaimerBlock({ compact: true })}
            <div id="analysisResult"></div>
          </article>
        </div>
        <div class="panel search-history-panel">
          <div class="panel-heading-row"><div><span class="eyebrow">Historial</span><h2 class="serif">${profile.role === "admin" ? "Todas las búsquedas guardadas" : "Sus búsquedas guardadas"}</h2></div>${profile.role === "admin" ? `<span class="tag">Vista admin</span>` : ""}</div>
          <div id="searchHistory" class="table-wrap compact-table"><p class="muted">Cargando historial…</p></div>
        </div>`, tone: "cream" })}</div>`;
  },

  Watchlists: () => `
    <div class="page">${Components.PageHero({ eyebrow: "Watchlists", title: "My Watchlists", text: "Organice acciones para seguimiento educativo personal, sin señales de operación ni recomendaciones." })}
    ${Components.Section({ content: `
      <div class="watchlist-shell">
        <aside class="panel watchlist-sidebar">
          <span class="eyebrow">Crear watchlist</span>
          <h2 class="serif">Nuevo grupo de seguimiento</h2>
          <form class="form-stack" id="createWatchlistForm">
            <div class="form-field"><label for="watchlistName">Nombre</label><input id="watchlistName" name="name" required placeholder="Ej. Tecnología de calidad"></div>
            <button class="button button-ink">Crear watchlist</button>
          </form>
          <div class="watchlist-summary" id="watchlistSummary"><p class="muted">Cargando resumen…</p></div>
        </aside>
        <section class="watchlist-main">
          <div class="panel-heading-row">
            <div><span class="eyebrow">Mis Watchlists</span><h2 class="serif">Listas guardadas</h2></div>
            <a class="button button-outline" href="/analisis" data-link>Analizar ticker</a>
          </div>
          <div id="watchlistsContainer" class="watchlist-grid"><div class="empty-state"><h3>Cargando watchlists</h3><p class="muted">Consultando sus listas personales…</p></div></div>
        </section>
      </div>
      ${Components.DisclaimerBlock({ compact: true })}`, tone: "cream" })}</div>`,

  Contacto: () => `
    <div class="page">${Components.PageHero({ eyebrow: "Contacto", title: "Conversemos.", text: "Utilice este formulario para consultas sobre el acceso, la academia o el futuro Centro del Inversor." })}
    ${Components.Section({ content: `<div class="contact-layout"><aside class="contact-aside"><span class="eyebrow">Hampton Crest Capital</span><h2>Estamos para orientarle.</h2><p>Respondemos consultas operativas y educativas. No atendemos solicitudes de recomendaciones personales ni sugerimos operaciones.</p><div class="contact-details"><div><span>Correo electrónico</span><strong><a href="mailto:hamptoncrestcapital@gmail.com">hamptoncrestcapital@gmail.com</a></strong></div><div><span>Horario</span><strong>Lunes a viernes · 9:00–17:00 ET</strong></div></div></aside>
      <div class="panel"><form class="contact-form" id="contactForm"><div class="form-grid"><div class="form-field"><label for="name">Nombre</label><input id="name" name="name" required autocomplete="name"></div><div class="form-field"><label for="email">Correo</label><input id="email" name="email" type="email" required autocomplete="email"></div><div class="form-field"><label for="phone">Teléfono</label><input id="phone" name="phone" type="tel" autocomplete="tel"></div><div class="form-field"><label for="subject">Asunto</label><input id="subject" name="subject" required></div></div><div class="form-field"><label for="message">Mensaje</label><textarea id="message" name="message" required></textarea></div><div id="contactStatus"></div><button class="button button-ink">Enviar solicitud</button><p class="form-note">Formulario conectado a Supabase. No incluya información financiera sensible.</p></form></div></div>`, tone: "cream" })}</div>`,

  Auth: () => {
    const mode = authMode();
    const authUnavailable = Boolean(AuthProvider.error && !AuthProvider.client);
    if (AuthProvider.user) {
      return `<div class="page"><section class="gate"><div class="container gate-card"><div class="gate-brand">${Components.Logo()}</div><span class="eyebrow">Sesión activa</span><h1>Ya inició sesión</h1><p>Puede continuar al Centro de Análisis o cerrar sesión desde el menú de usuario.</p><div class="button-row">${Components.Button({ label: "Ir al análisis", href: "/analisis" })}</div></div></section></div>`;
    }

    return `
      <div class="page auth-page">
        <div class="auth-card">
          <div class="auth-brand">${Components.Logo({ className: "brand-logo-on-light" })}</div>
          <span class="eyebrow">Área privada</span>
          <h1>${mode === "reset" ? "Recuperar acceso" : "Su Centro del Inversor"}</h1>
          <p>${mode === "reset" ? "Ingrese su correo para recibir instrucciones de restablecimiento." : "Acceda a herramientas educativas y a su historial personal de investigación."}</p>
          ${AuthProvider.error ? `<div class="status-message error">${escapeHtml(AuthProvider.error)}</div>` : ""}
          ${authUnavailable ? authUnavailableState() : `
            <div class="auth-tabs">
              <a href="/auth?mode=login" data-link class="${mode === "login" ? "active" : ""}">Iniciar sesión</a>
              <a href="/auth?mode=register" data-link class="${mode === "register" ? "active" : ""}">Crear cuenta</a>
              <a href="/auth?mode=reset" data-link class="${mode === "reset" ? "active" : ""}">Restablecer</a>
            </div>
            ${authForm(mode)}
          `}
        </div>
      </div>`;
  },

  Admin: () => `
    <div class="page">${Components.PageHero({ eyebrow: "Administración", title: "Panel administrativo.", text: "Base protegida para la futura gestión del Centro del Inversor." })}
    ${Components.Section({ content: `${adminNav()}<div class="admin-stats" id="adminStats"><div class="admin-stat"><strong>—</strong><span>Usuarios registrados</span></div><div class="admin-stat"><strong>—</strong><span>Cursos publicados</span></div><div class="admin-stat"><strong>—</strong><span>Lecciones publicadas</span></div><div class="admin-stat"><strong>—</strong><span>Libros publicados</span></div><div class="admin-stat"><strong>—</strong><span>Búsquedas totales</span></div></div><div class="panel most-searched-panel"><span class="eyebrow">Actividad reciente</span><h2 class="serif">Símbolos más buscados</h2><div id="mostSearchedSymbols" class="symbol-chip-row"><span class="muted">Cargando símbolos…</span></div></div><div class="admin-panel-grid"><div class="panel"><span class="eyebrow">Contacto</span><h2 class="serif">Solicitudes recientes</h2><div id="adminContacts" class="table-wrap compact-table"><p class="muted">Cargando solicitudes…</p></div></div><div class="panel"><span class="eyebrow">Actividad de análisis</span><h2 class="serif">Búsquedas recientes</h2><div id="adminSearches" class="table-wrap compact-table"><p class="muted">Cargando actividad…</p></div></div><div class="panel"><span class="eyebrow">Usuarios</span><h2 class="serif">Registros recientes</h2><div id="adminRecentUsers" class="table-wrap compact-table"><p class="muted">Cargando usuarios…</p></div></div></div>`, tone: "cream" })}</div>`,

  AdminCourses: () => `
    <div class="page">${Components.PageHero({ eyebrow: "CMS", title: "Gestión de cursos.", text: "Crear, editar, publicar y organizar cursos de la Academia gratuita." })}
    ${Components.Section({ content: `${adminNav()}${courseAdminForm()}<div id="adminCoursesList" class="cms-list"><p class="muted">Cargando cursos…</p></div>`, tone: "cream" })}</div>`,

  AdminLessons: () => `
    <div class="page">${Components.PageHero({ eyebrow: "CMS", title: "Gestión de lecciones.", text: "Crear lecciones, editar contenido enriquecido, publicar y ordenar el temario." })}
    ${Components.Section({ content: `${adminNav()}${lessonAdminForm()}<div id="adminLessonsList" class="cms-list"><p class="muted">Cargando lecciones…</p></div>`, tone: "cream" })}</div>`,

  AdminBooks: () => `
    <div class="page">${Components.PageHero({ eyebrow: "CMS", title: "Biblioteca de libros.", text: "Subir PDFs, portadas y metadatos para la biblioteca educativa gratuita." })}
    ${Components.Section({ content: `${adminNav()}${bookAdminForm()}<div id="adminBooksList" class="cms-list"><p class="muted">Cargando libros…</p></div>`, tone: "cream" })}</div>`,

  AdminUsers: () => `
    <div class="page">${Components.PageHero({ eyebrow: "Administración", title: "Usuarios registrados.", text: "Vista administrativa de perfiles y roles del Centro del Inversor." })}
    ${Components.Section({ content: `${adminNav()}<div id="adminUsersList" class="table-wrap compact-table"><p class="muted">Cargando usuarios…</p></div>`, tone: "cream" })}</div>`
};

function adminNav() {
  return `<nav class="admin-tabs cms-tabs" aria-label="Administración CMS">
    <a class="filter-button" href="/admin" data-link>Panel</a>
    <a class="filter-button" href="/admin/cursos" data-link>Cursos</a>
    <a class="filter-button" href="/admin/lecciones" data-link>Lecciones</a>
    <a class="filter-button" href="/admin/libros" data-link>Libros</a>
    <a class="filter-button" href="/admin/usuarios" data-link>Usuarios</a>
  </nav>`;
}

function authUnavailableState() {
  return `<div class="auth-unavailable">
    <h2>Acceso en preparación</h2>
    <p>Estamos finalizando la conexión segura del Centro del Inversor. Si ya tiene acceso o necesita asistencia, contacte directamente a Hampton Crest Capital.</p>
    <div class="auth-support-actions">
      <a class="button button-ink button-wide" href="mailto:hamptoncrestcapital@gmail.com">Contactar soporte</a>
      <a class="button button-outline button-wide" href="/contacto" data-link>Ir a contacto</a>
    </div>
  </div>`;
}

function courseAdminForm(course = {}) {
  return `<form class="panel cms-form" id="courseAdminForm" data-id="${escapeHtml(course.id || "")}">
    <div class="panel-heading-row"><div><span class="eyebrow">Gestión de cursos</span><h2 class="serif">${course.id ? "Editar curso" : "Crear curso"}</h2></div><button class="button button-ink">Guardar curso</button></div>
    <div class="form-grid">
      <div class="form-field"><label>Título</label><input name="title" required value="${escapeHtml(course.title || "")}"></div>
      <div class="form-field"><label>Slug</label><input name="slug" value="${escapeHtml(course.slug || "")}" placeholder="curso-fundamentos"></div>
    </div>
    <div class="form-field"><label>Descripción</label><textarea name="description">${escapeHtml(course.description || "")}</textarea></div>
    <div class="form-grid">
      <div class="form-field"><label>Imagen miniatura</label><input name="thumbnail" type="file" accept="image/*"></div>
      <div class="form-field"><label>URL de miniatura</label><input name="thumbnail_url" value="${escapeHtml(course.thumbnail_url || "")}"></div>
    </div>
    <label class="check-row"><input type="checkbox" name="is_published" ${course.is_published ? "checked" : ""}> Publicado</label>
    <div id="courseAdminStatus"></div>
  </form>`;
}

function lessonAdminForm(lesson = {}, courses = []) {
  return `<form class="panel cms-form" id="lessonAdminForm" data-id="${escapeHtml(lesson.id || "")}">
    <div class="panel-heading-row"><div><span class="eyebrow">Gestión de lecciones</span><h2 class="serif">${lesson.id ? "Editar lección" : "Crear lección"}</h2></div><button class="button button-ink">Guardar lección</button></div>
    <div class="form-grid">
      <div class="form-field"><label>Curso</label><select name="course_id" id="lessonCourseSelect">${courses.map(course => `<option value="${escapeHtml(course.id)}" ${lesson.course_id === course.id ? "selected" : ""}>${escapeHtml(course.title)}</option>`).join("")}</select></div>
      <div class="form-field"><label>Orden</label><input name="lesson_order" type="number" value="${escapeHtml(lesson.lesson_order ?? 1)}"></div>
    </div>
    <div class="form-field"><label>Título</label><input name="title" required value="${escapeHtml(lesson.title || "")}"></div>
    <div class="form-field"><label>URL de video de YouTube</label><input name="video_url" value="${escapeHtml(lesson.video_url || "")}" placeholder="https://www.youtube.com/watch?v=..."></div>
    <div class="rich-toolbar" aria-label="Editor toolbar">
      <button type="button" data-command="formatBlock" data-value="H2">H2</button>
      <button type="button" data-command="formatBlock" data-value="H3">H3</button>
      <button type="button" data-command="insertUnorderedList">Lista</button>
      <button type="button" data-command="formatBlock" data-value="BLOCKQUOTE">Cita</button>
      <button type="button" data-command="createLink">Link</button>
      <button type="button" data-command="insertImage">Imagen</button>
    </div>
    <div class="rich-editor" id="lessonContentEditor" contenteditable="true">${lesson.content || ""}</div>
    <input type="hidden" name="content" id="lessonContentInput">
    <label class="check-row"><input type="checkbox" name="is_published" ${lesson.is_published ? "checked" : ""}> Publicada</label>
    <div id="lessonAdminStatus"></div>
  </form>`;
}

function bookAdminForm(book = {}) {
  return `<form class="panel cms-form" id="bookAdminForm" data-id="${escapeHtml(book.id || "")}">
    <div class="panel-heading-row"><div><span class="eyebrow">Biblioteca de libros</span><h2 class="serif">${book.id ? "Editar libro" : "Crear libro"}</h2></div><button class="button button-ink">Guardar libro</button></div>
    <div class="form-grid">
      <div class="form-field"><label>Título</label><input name="title" required value="${escapeHtml(book.title || "")}"></div>
      <div class="form-field"><label>Autor</label><input name="author" value="${escapeHtml(book.author || "")}"></div>
    </div>
    <div class="form-field"><label>Descripción</label><textarea name="description">${escapeHtml(book.description || "")}</textarea></div>
    <div class="form-field"><label>Categoría</label><select name="category">${bookCategories.map(category => `<option value="${escapeHtml(category)}" ${book.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div>
    <div class="form-grid">
      <div class="form-field"><label>PDF</label><input name="book_file" type="file" accept="application/pdf"></div>
      <div class="form-field"><label>Imagen de portada</label><input name="cover_image" type="file" accept="image/*"></div>
    </div>
    <div class="form-grid">
      <div class="form-field"><label>PDF URL</label><input name="file_url" value="${escapeHtml(book.file_url || "")}"></div>
      <div class="form-field"><label>Cover URL</label><input name="cover_image_url" value="${escapeHtml(book.cover_image_url || "")}"></div>
    </div>
    <label class="check-row"><input type="checkbox" name="is_published" ${book.is_published ? "checked" : ""}> Publicado</label>
    <div id="bookAdminStatus"></div>
  </form>`;
}

function authForm(mode) {
  if (mode === "reset") {
    return `<form class="form-stack" id="resetForm"><div class="form-field"><label for="resetEmail">Correo electrónico</label><input id="resetEmail" name="email" type="email" required autocomplete="email"></div><div id="authStatus"></div><button class="button button-ink button-wide">Enviar enlace de restablecimiento</button></form>`;
  }

  return `<form class="form-stack" id="authForm">
    ${mode === "register" ? `<div class="form-field"><label for="fullName">Nombre completo</label><input id="fullName" name="fullName" required autocomplete="name"></div>` : ""}
    <div class="form-field"><label for="authEmail">Correo electrónico</label><input id="authEmail" name="email" type="email" required autocomplete="email"></div>
    <div class="form-field"><label for="password">Contraseña</label><input id="password" name="password" type="password" minlength="6" required autocomplete="${mode === "login" ? "current-password" : "new-password"}"></div>
    <div id="authStatus"></div>
    <button class="button button-ink button-wide">${mode === "login" ? "Iniciar sesión" : "Crear cuenta gratuita"}</button>
    <p class="form-note">La sesión se mantiene de forma segura mediante Supabase Auth. Se cerrará automáticamente tras inactividad.</p>
  </form>`;
}

function AppLayout(content, route) {
  const academy = isAcademyRoute(route);
  return `${Components.Header({ academy })}<main id="app" tabindex="-1">${content}</main>${Components.Footer({ academy })}<div class="toast" id="toast" role="status"></div>`;
}

function renderRoute() {
  const path = currentPath();
  const route = resolveRoute(path);
  let content;
  if (adminRoutes.has(route)) content = AdminRoute(Pages[pathToPage(route)]);
  else if (protectedRoutes.has(route)) content = ProtectedRoute(Pages[pathToPage(route)]);
  else content = Pages[pathToPage(route)]();

  root.innerHTML = AppLayout(content, route);
  document.title = `${pageTitle(route)} | Hampton Crest Capital`;
  bindLayout(route);
  if (route === "/academia") bindAcademia();
  if (route === "/academia/libros") bindAcademyBooks();
  if (route === "/academia/curso") bindCoursePage();
  if (route === "/academia/leccion") bindLessonPage();
  if (route === "/mi-progreso" && AuthProvider.user) bindProgressPage();
  if (route === "/analisis" && AuthProvider.user) bindAnalysisCenter();
  if (route === "/watchlists" && AuthProvider.user) bindWatchlistsPage();
  if (route === "/admin" && AuthProvider.profile?.role === "admin") bindAdminDashboard();
  if (route === "/admin/cursos" && AuthProvider.profile?.role === "admin") bindAdminCourses();
  if (route === "/admin/lecciones" && AuthProvider.profile?.role === "admin") bindAdminLessons();
  if (route === "/admin/libros" && AuthProvider.profile?.role === "admin") bindAdminBooks();
  if (route === "/admin/usuarios" && AuthProvider.profile?.role === "admin") bindAdminUsers();
  if (route === "/auth") bindAuthForms();
  if (route === "/contacto") bindContactForm();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function pathToPage(route) {
  return ({ "/": "Home", "/academia": "Academia", "/academia/libros": "AcademyBooks", "/academia/curso": "Course", "/academia/leccion": "Lesson", "/mi-progreso": "Progress", "/analisis": "Analisis", "/watchlists": "Watchlists", "/contacto": "Contacto", "/auth": "Auth", "/admin": "Admin", "/admin/cursos": "AdminCourses", "/admin/lecciones": "AdminLessons", "/admin/libros": "AdminBooks", "/admin/usuarios": "AdminUsers" })[route] || "Home";
}

function resolveRoute(path) {
  if (routes.includes(path)) return path;
  if (/^\/academia\/curso\/[^/]+\/leccion\/[^/]+$/.test(path)) return "/academia/leccion";
  if (/^\/academia\/curso\/[^/]+$/.test(path)) return "/academia/curso";
  return "/";
}

function isAcademyRoute(route) {
  return route === "/academia" || route === "/academia/libros" || route === "/academia/curso" || route === "/academia/leccion";
}

function pageTitle(route) {
  const titles = {
    "/": "Centro del Inversor",
    "/academia": "Academia Gratuita",
    "/academia/libros": "Biblioteca Financiera Gratuita",
    "/academia/curso": "Curso",
    "/academia/leccion": "Lección",
    "/mi-progreso": "Mi progreso",
    "/analisis": "Centro de análisis",
    "/watchlists": "Watchlists",
    "/contacto": "Contacto",
    "/auth": "Acceso",
    "/admin": "Administración",
    "/admin/cursos": "Cursos",
    "/admin/lecciones": "Lecciones",
    "/admin/libros": "Libros",
    "/admin/usuarios": "Usuarios"
  };
  return titles[route] || "Centro del Inversor";
}

function bindLayout(route) {
  const nav = document.getElementById("siteNav");
  const menu = document.getElementById("menuButton");
  menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    document.body.classList.toggle("menu-open", open);
    menu.setAttribute("aria-expanded", String(open));
  });

  const userMenuButton = document.getElementById("userMenuButton");
  const userMenuPanel = document.getElementById("userMenuPanel");
  if (userMenuButton && userMenuPanel) {
    userMenuButton.addEventListener("click", () => {
      const open = userMenuPanel.classList.toggle("open");
      userMenuButton.setAttribute("aria-expanded", String(open));
    });
  }

  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) logoutButton.addEventListener("click", () => AuthProvider.logout());

  document.querySelectorAll("[data-link]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault();
    navigate(link.getAttribute("href"));
  }));
  document.querySelectorAll(".site-nav a").forEach(link => link.classList.toggle("active", normalizePath(link.getAttribute("href").split("?")[0]) === route));
}

function bindDynamicLinks(rootNode = document) {
  rootNode.querySelectorAll("[data-link]").forEach(link => {
    if (link.dataset.boundLink) return;
    link.dataset.boundLink = "true";
    link.addEventListener("click", event => {
      event.preventDefault();
      navigate(link.getAttribute("href"));
    });
  });
}

async function bindAcademiaLegacy() {
  const filters = document.getElementById("lessonFilters");
  const grid = document.getElementById("lessonGrid");
  grid.innerHTML = `<div class="empty-state"><h3>Cargando lecciones</h3><p class="muted">Consultando Hampton Crest Capital…</p></div>`;
  let lessons = [];
  let progress = new Map();
  try {
    lessons = await DataStore.getAcademyLessons();
    progress = await DataStore.getLessonProgress();
  } catch (error) {
    grid.innerHTML = `<div class="empty-state"><h3>No pudimos cargar la academia</h3><p class="muted">${escapeHtml(error.message || "Revise la conexión con Supabase.")}</p></div>`;
    return;
  }

  if (!lessons.length) {
    filters.innerHTML = "";
    grid.innerHTML = `<div class="empty-state"><h3>No hay lecciones publicadas</h3><p class="muted">Las lecciones aparecerán aquí cuando existan registros publicados en Supabase.</p></div>`;
    return;
  }

  const tags = ["Todos", ...new Set(lessons.map(item => item.category || item.tag || "Academia"))];
  let activeTag = "Todos";
  filters.innerHTML = tags.map(tag => `<button class="filter-button ${tag === activeTag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("");
  const draw = () => {
    const query = document.getElementById("lessonSearch").value.toLowerCase().trim();
    const visible = lessons.filter(item => {
      const category = item.category || item.tag || "Academia";
      const haystack = `${item.title} ${item.description || ""} ${item.lesson_type || ""} ${category} ${item.tag || ""}`.toLowerCase();
      return (activeTag === "Todos" || category === activeTag) && haystack.includes(query);
    });
    grid.innerHTML = visible.map(lessonCard).join("") || `<div class="empty-state"><h3>No encontramos lecciones</h3><p class="muted">Pruebe con otra búsqueda.</p></div>`;
    grid.querySelectorAll(".lesson-button").forEach(button => button.addEventListener("click", async () => {
      try {
        if (!AuthProvider.user) {
          showToast("Inicie sesión para guardar progreso.");
          return;
        }
        await DataStore.saveLessonProgress(button.dataset.lessonId, 100);
        showToast("Lección marcada como completada.");
        renderRoute();
      } catch (error) {
        showToast(error.message || "No se pudo guardar el progreso.");
      }
    }));
  };

  const lessonCard = lesson => {
    const itemProgress = progress.get(String(lesson.id));
    const percent = Number(itemProgress?.progress_percent || 0);
    const completed = Boolean(itemProgress?.completed);
    const duration = lesson.duration_minutes ? `${lesson.duration_minutes} min` : "Lectura";
    const category = lesson.category || lesson.tag || "Academia";
    return `<article class="lesson-card">
      <div class="card-meta"><span>${escapeHtml(lesson.lesson_type || "Lección")}</span><span>${escapeHtml(duration)}</span></div>
      <h3>${escapeHtml(lesson.title)}</h3>
      <p>${escapeHtml(lesson.description || "Contenido educativo de Hampton Crest Capital.")}</p>
      ${AuthProvider.user ? `<div class="lesson-progress"><div><span>${completed ? "Completada" : "Progreso"}</span><strong>${percent.toFixed(0)}%</strong></div><div class="progress-track"><span style="width:${Math.min(100, percent)}%"></span></div></div>` : ""}
      <footer><span class="tag">${escapeHtml(category)}</span><button class="text-link lesson-button" data-lesson-id="${escapeHtml(lesson.id)}">${completed ? "Completada" : "Marcar completada"}</button></footer>
    </article>`;
  };

  filters.addEventListener("click", event => {
    if (!event.target.dataset.tag) return;
    activeTag = event.target.dataset.tag;
    filters.querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.tag === activeTag));
    draw();
  });
  document.getElementById("lessonSearch").addEventListener("input", draw);
  draw();
}

async function bindAcademia() {
  const featured = document.getElementById("featuredCourses");
  const newest = document.getElementById("newCourses");
  const booksNode = document.getElementById("academyBooksPreview");
  const search = document.getElementById("academySearch");
  try {
    const [courses, books] = await Promise.all([DataStore.getAcademyCourses(), DataStore.getAcademyBooks()]);
    const render = () => {
      const query = String(search?.value || "").toLowerCase().trim();
      const visibleCourses = courses.filter(course => `${course.title} ${course.description || ""}`.toLowerCase().includes(query));
      const visibleBooks = books.filter(book => `${book.title} ${book.author || ""} ${book.category || ""}`.toLowerCase().includes(query));
      featured.innerHTML = visibleCourses.slice(0, 3).map(courseCard).join("") || emptyContent("No hay cursos publicados", "Los cursos aparecerán cuando el equipo publique contenido.", true);
      newest.innerHTML = visibleCourses.slice(0, 6).map(courseCard).join("") || emptyContent("No hay cursos nuevos", "Pruebe otra búsqueda.", true);
      booksNode.innerHTML = visibleBooks.slice(0, 3).map(bookCard).join("") || emptyContent("Todavía no hay libros publicados.", "Pronto agregaremos recursos educativos gratuitos para fortalecer su formación financiera.", true);
      bindDynamicLinks();
    };
    search?.addEventListener("input", render);
    render();
  } catch (error) {
    featured.innerHTML = emptyContent("No pudimos cargar la academia", error.message || "Revise la conexión con Supabase.", true);
    newest.innerHTML = "";
    booksNode.innerHTML = "";
  }
}

async function bindAcademyBooks() {
  const filters = document.getElementById("bookFilters");
  const grid = document.getElementById("bookLibrary");
  try {
    const books = await DataStore.getAcademyBooks();
    const categories = ["Todos", ...bookCategories];
    let active = "Todos";
    filters.innerHTML = categories.map(category => `<button class="filter-button ${category === active ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("");
    const render = () => {
      const visible = books.filter(book => active === "Todos" || book.category === active);
      grid.innerHTML = visible.map(bookCard).join("") || emptyContent("Todavía no hay libros publicados.", "Pronto agregaremos recursos educativos gratuitos para fortalecer su formación financiera.", true);
      bindDynamicLinks();
    };
    filters.addEventListener("click", event => {
      if (!event.target.dataset.category) return;
      active = event.target.dataset.category;
      filters.querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.category === active));
      render();
    });
    render();
  } catch (error) {
    grid.innerHTML = emptyContent("No pudimos cargar la biblioteca en este momento.", "Intente nuevamente más tarde.", true);
  }
}

async function bindCoursePage() {
  const slug = currentPath().split("/")[3];
  const page = document.getElementById("coursePage");
  try {
    const [course, progress] = await Promise.all([DataStore.getAcademyCourseBySlug(slug), DataStore.getLessonProgress()]);
    if (!course) {
      page.innerHTML = notFoundPage("Curso no disponible", "Este curso no está publicado o no existe.");
      return;
    }
    page.innerHTML = `${Components.AcademyHero({ eyebrow: "Curso gratuito", title: escapeHtml(course.title), text: escapeHtml(course.description || "Contenido educativo de Hampton Crest Capital.") })}${Components.Section({ content: `<div class="lesson-list">${course.academy_lessons.map(lesson => lessonListItem(course, lesson, progress)).join("") || emptyContent("Este curso aún no tiene lecciones publicadas", "Vuelva pronto para consultar nuevos contenidos.", true)}</div>${Components.DisclaimerBlock({ compact: true })}`, tone: "cream" })}`;
  } catch (error) {
    page.innerHTML = notFoundPage("No pudimos cargar el curso", error.message || "Revise la conexión con Supabase.");
  }
}

async function bindLessonPage() {
  const lessonId = currentPath().split("/")[5];
  const page = document.getElementById("lessonPage");
  try {
    const [lesson, progress] = await Promise.all([DataStore.getAcademyLesson(lessonId), DataStore.getLessonProgress()]);
    if (!lesson) {
      page.innerHTML = notFoundPage("Lección no disponible", "Esta lección no está publicada o no existe.");
      return;
    }
    const completed = progress.get(String(lesson.id))?.completed;
    page.innerHTML = `${Components.AcademyHero({ eyebrow: escapeHtml(lesson.academy_courses.title), title: escapeHtml(lesson.title), text: "Contenido educativo gratuito." })}${Components.Section({ content: `<article class="lesson-reader">${youtubeEmbed(lesson.video_url)}<div class="rich-content">${lesson.content || "<p>Contenido en preparación.</p>"}</div>${AuthProvider.user ? `<button class="button button-ink" id="completeLessonButton" ${completed ? "disabled" : ""}>${completed ? "Lección completada" : "Marcar como completada"}</button>` : `<a class="button button-ink" href="/auth?mode=login" data-link>Iniciar sesión para guardar progreso</a>`}<a class="text-link" href="/academia/curso/${escapeHtml(lesson.academy_courses.slug)}" data-link>Volver al curso</a></article>${Components.DisclaimerBlock({ compact: true })}`, tone: "cream" })}`;
    document.getElementById("completeLessonButton")?.addEventListener("click", async () => {
      await DataStore.saveLessonProgress(lesson.id, 100);
      showToast("Lección marcada como completada.");
      bindLessonPage();
    });
    page.querySelectorAll("[data-link]").forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      navigate(link.getAttribute("href"));
    }));
  } catch (error) {
    page.innerHTML = notFoundPage("No pudimos cargar la lección", error.message || "Revise la conexión con Supabase.");
  }
}

async function bindProgressPage() {
  const node = document.getElementById("progressDashboard");
  try {
    const summary = await DataStore.getProgressSummary();
    node.innerHTML = `<div class="admin-stats progress-stats"><div class="admin-stat"><strong>${summary.coursesStarted}</strong><span>Cursos iniciados</span></div><div class="admin-stat"><strong>${summary.coursesCompleted}</strong><span>Cursos completados</span></div><div class="admin-stat"><strong>${summary.completedLessons}</strong><span>Lecciones completadas</span></div><div class="admin-stat"><strong>${summary.progressPercent}%</strong><span>Porcentaje de avance</span></div></div><div class="lesson-list">${summary.courses.map(course => `<article class="lesson-row"><div><strong>${escapeHtml(course.title)}</strong><span>${course.lesson_count} lecciones publicadas</span></div><a class="button button-outline" href="/academia/curso/${escapeHtml(course.slug)}" data-link>Continuar</a></article>`).join("") || emptyContent("Aún no hay cursos disponibles", "Cuando existan cursos publicados aparecerán aquí.")}</div>`;
    node.querySelectorAll("[data-link]").forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      navigate(link.getAttribute("href"));
    }));
  } catch (error) {
    node.innerHTML = `<p class="muted">${escapeHtml(error.message || "No se pudo cargar su progreso.")}</p>`;
  }
}

function courseCard(course) {
  return `<article class="course-card academy-card"><div class="course-thumb">${course.thumbnail_url ? `<img src="${escapeHtml(course.thumbnail_url)}" alt="">` : Components.BrandEmblem({ className: "academy-logo-card" })}</div><div><span class="tag">${course.lesson_count} lecciones</span><h3>${escapeHtml(course.title)}</h3><p>${escapeHtml(course.description || "Curso educativo gratuito.")}</p><a class="button button-outline" href="/academia/curso/${escapeHtml(course.slug)}" data-link>Abrir curso</a></div></article>`;
}

function bookCard(book) {
  return `<article class="book-card academy-card"><div class="book-cover">${book.cover_image_url ? `<img src="${escapeHtml(book.cover_image_url)}" alt="${escapeHtml(book.title)}">` : Components.BrandEmblem({ className: "academy-logo-card" })}</div><div><span class="tag">${escapeHtml(book.category || "Academia")}</span><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.description || "Recurso educativo gratuito.")}</p><small>${escapeHtml(book.author || "Hampton Crest Capital")}</small>${book.file_url ? `<a class="button button-outline" href="${escapeHtml(book.file_url)}" target="_blank" rel="noopener">Abrir PDF</a>` : ""}</div></article>`;
}

function lessonListItem(course, lesson, progress) {
  const completed = progress.get(String(lesson.id))?.completed;
  return `<article class="lesson-row"><div><strong>${escapeHtml(lesson.title)}</strong><span>${completed ? "Completada" : "Pendiente"} · Lección ${escapeHtml(lesson.lesson_order || "")}</span></div><a class="button button-outline" href="/academia/curso/${escapeHtml(course.slug)}/leccion/${escapeHtml(lesson.id)}" data-link>Ver lección</a></article>`;
}

function youtubeEmbed(url) {
  const id = youtubeId(url);
  return id ? `<div class="video-frame"><iframe src="https://www.youtube.com/embed/${escapeHtml(id)}" title="Video educativo" allowfullscreen loading="lazy"></iframe></div>` : "";
}

function youtubeId(url) {
  const value = String(url || "");
  return value.match(/[?&]v=([^&]+)/)?.[1] || value.match(/youtu\.be\/([^?]+)/)?.[1] || "";
}

function emptyContent(title, text, academy = false) {
  return `<div class="empty-state">${academy ? Components.BrandEmblem({ className: "academy-logo-empty" }) : ""}<h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(text)}</p></div>`;
}

function notFoundPage(title, text) {
  return `<section class="gate"><div class="container gate-card"><span class="eyebrow">Academia Gratuita</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><div class="button-row">${Components.Button({ label: "Volver a Academia Gratuita", href: "/academia" })}</div></div></section>`;
}

async function bindAnalysisCenter() {
  const form = document.getElementById("tickerForm");
  const tickerInput = document.getElementById("tickerInput");
  const suggestions = document.getElementById("tickerSuggestions");
  let searchTimer = null;

  if (tickerInput && suggestions) {
    tickerInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const query = tickerInput.value.trim();
      if (query.length < 1) {
        suggestions.innerHTML = "";
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const results = await DataStore.searchTicker(query);
          suggestions.innerHTML = results.map(item => `<option value="${escapeHtml(item.ticker)}">${escapeHtml(item.companyName)} ${item.exchange ? `· ${escapeHtml(item.exchange)}` : ""}</option>`).join("");
        } catch {
          suggestions.innerHTML = "";
        }
      }, 250);
    });
  }

  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(form);
      const ticker = String(data.get("ticker")).trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
      const resultNode = document.getElementById("analysisResult");
      if (!ticker) {
        resultNode.innerHTML = `<div class="status-message error">Ingrese un símbolo válido.</div>`;
        return;
      }
      resultNode.innerHTML = `<div class="status-message">Cargando datos del mercado…</div>`;
      try {
        const stock = await DataStore.getStockAnalysis(ticker);
        const summary = buildEducationalSummary(stock);
        resultNode.innerHTML = stockAnalysisCard(stock, summary);
        bindWatchlistPicker(stock);
        await DataStore.saveTickerSearch(stock.ticker, summary.shortText, stock.companyName);
        form.reset();
        showToast("Análisis educativo guardado en su historial.");
        renderSearchHistory();
      } catch (error) {
        resultNode.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No pudimos cargar los datos del mercado en este momento.")}</div>`;
      }
    });
    const requestedTicker = routeQueryParam("ticker");
    if (requestedTicker) {
      tickerInput.value = requestedTicker.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 16);
      setTimeout(() => form.requestSubmit(), 0);
    }
  }
  await renderPersonalDashboard();
  await renderSearchHistory();
}

async function bindWatchlistPicker(stock) {
  const button = document.getElementById("addToWatchlistButton");
  const picker = document.getElementById("watchlistPicker");
  if (!button || !picker) return;
  button.addEventListener("click", async () => {
    picker.classList.toggle("hidden");
    if (picker.classList.contains("hidden")) return;
    picker.innerHTML = `<div class="status-message">Cargando watchlists…</div>`;
    try {
      const watchlists = await DataStore.getWatchlists();
      picker.innerHTML = `
        <form class="watchlist-picker-form" id="watchlistPickerForm">
          <div class="form-field">
            <label for="watchlistSelect">Watchlist existente</label>
            <select id="watchlistSelect" name="watchlistId">
              <option value="">Crear nueva watchlist</option>
              ${watchlists.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${item.watchlist_items.length})</option>`).join("")}
            </select>
          </div>
          <div class="form-field">
            <label for="newWatchlistName">Nueva watchlist</label>
            <input id="newWatchlistName" name="newName" placeholder="Ej. Empresas para estudiar">
          </div>
          <button class="button button-ink">Guardar ${escapeHtml(stock.ticker)}</button>
        </form>
        <p class="form-note">Esta función organiza seguimiento educativo; no genera señales ni recomendaciones.</p>`;
      document.getElementById("watchlistPickerForm").addEventListener("submit", async event => {
        event.preventDefault();
        const data = new FormData(event.target);
        let watchlistId = String(data.get("watchlistId") || "");
        try {
          if (!watchlistId) {
            const created = await DataStore.createWatchlist(data.get("newName"));
            watchlistId = created.id;
          }
          await DataStore.addWatchlistItem(watchlistId, stock);
          picker.classList.add("hidden");
          showToast("Símbolo agregado a su watchlist.");
          await renderPersonalDashboard();
        } catch (error) {
          picker.insertAdjacentHTML("afterbegin", `<div class="status-message error">${escapeHtml(error.message || "No se pudo guardar en la watchlist.")}</div>`);
        }
      });
    } catch (error) {
      picker.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudieron cargar sus watchlists.")}</div>`;
    }
  });
}

async function renderPersonalDashboard() {
  const node = document.getElementById("personalDashboard");
  if (!node) return;
  try {
    const dashboard = await DataStore.getWatchlistDashboard();
    node.innerHTML = `
      <span class="eyebrow">Panel personal</span>
      <h2 class="serif">Seguimiento educativo</h2>
      <div class="mini-stat-grid">
        <div><strong>${dashboard.searches.length}</strong><span>Búsquedas recientes</span></div>
        <div><strong>${dashboard.watchlists.length}</strong><span>Watchlists</span></div>
        <div><strong>${dashboard.savedStocks}</strong><span>Acciones guardadas</span></div>
      </div>
      <div class="dashboard-mini-list">
        <h3>Recent searches</h3>
        ${dashboard.searches.length ? dashboard.searches.map(item => `<a href="/analisis?ticker=${encodeURIComponent(item.ticker)}" data-link><strong>${escapeHtml(item.ticker)}</strong><span>${escapeHtml(item.company_name || "Seguimiento educativo")}</span></a>`).join("") : `<p class="muted">Aún no hay búsquedas guardadas.</p>`}
      </div>
      <div class="dashboard-mini-list">
        <h3>My watchlists</h3>
        ${dashboard.watchlists.length ? dashboard.watchlists.slice(0, 4).map(item => `<a href="/watchlists" data-link><strong>${escapeHtml(item.name)}</strong><span>${item.watchlist_items.length} acciones</span></a>`).join("") : `<p class="muted">Cree su primera watchlist desde un análisis.</p>`}
      </div>`;
    node.querySelectorAll("[data-link]").forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      navigate(link.getAttribute("href"));
    }));
  } catch (error) {
    node.innerHTML = `<span class="eyebrow">Panel personal</span><h2 class="serif">Seguimiento educativo</h2><p class="muted">${escapeHtml(error.message || "No se pudo cargar su panel personal.")}</p>`;
  }
}

async function bindWatchlistsPage() {
  const form = document.getElementById("createWatchlistForm");
  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await DataStore.createWatchlist(data.get("name"));
        form.reset();
        showToast("Watchlist creada.");
        await renderWatchlists();
      } catch (error) {
        showToast(error.message || "No se pudo crear la watchlist.");
      }
    });
  }
  await renderWatchlists();
}

async function renderWatchlists() {
  const container = document.getElementById("watchlistsContainer");
  const summary = document.getElementById("watchlistSummary");
  if (!container) return;
  try {
    const watchlists = await DataStore.getWatchlists();
    const savedStocks = watchlists.reduce((total, item) => total + item.watchlist_items.length, 0);
    if (summary) {
      summary.innerHTML = `<div class="mini-stat-grid"><div><strong>${watchlists.length}</strong><span>Watchlists</span></div><div><strong>${savedStocks}</strong><span>Acciones</span></div></div>`;
    }
    container.innerHTML = watchlists.length
      ? watchlists.map(watchlistCard).join("")
      : `<div class="empty-state"><h3>No hay watchlists todavía</h3><p class="muted">Cree una lista para organizar acciones que desea estudiar.</p></div>`;
    bindWatchlistCardActions(container);
  } catch (error) {
    container.innerHTML = `<div class="empty-state"><h3>No pudimos cargar sus watchlists</h3><p class="muted">${escapeHtml(error.message || "Revise la conexión con Supabase.")}</p></div>`;
  }
}

function watchlistCard(item) {
  const items = item.watchlist_items || [];
  return `<article class="watchlist-card" data-watchlist-id="${escapeHtml(item.id)}">
    <header>
      <div>
        <span class="eyebrow">Watchlist</span>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${items.length} acciones · Creada ${formatDate(item.created_at)}</p>
      </div>
      <button class="text-link danger-link" data-delete-watchlist="${escapeHtml(item.id)}">Eliminar</button>
    </header>
    <form class="watchlist-inline-form" data-rename-watchlist="${escapeHtml(item.id)}">
      <input name="name" value="${escapeHtml(item.name)}" aria-label="Renombrar watchlist">
      <button class="button button-outline">Renombrar</button>
    </form>
    <form class="watchlist-inline-form" data-add-watchlist-item="${escapeHtml(item.id)}">
      <input name="ticker" maxlength="16" required placeholder="Ticker">
      <input name="companyName" placeholder="Empresa opcional">
      <button class="button button-ink">Agregar</button>
    </form>
    <div class="watchlist-items">
      ${items.length ? items.map(watchlistItemRow).join("") : `<p class="muted">Aún no hay acciones guardadas.</p>`}
    </div>
  </article>`;
}

function watchlistItemRow(item) {
  return `<div class="watchlist-item">
    <div><strong>${escapeHtml(item.ticker)}</strong><span>${escapeHtml(item.company_name || "Empresa no especificada")} · ${formatDate(item.created_at)}</span></div>
    <div class="watchlist-item-actions">
      <a class="button button-outline" href="/analisis?ticker=${encodeURIComponent(item.ticker)}" data-link>Analyze</a>
      <button class="button button-outline" data-remove-watchlist-item="${escapeHtml(item.id)}">Remove</button>
    </div>
  </div>`;
}

function bindWatchlistCardActions(container) {
  container.querySelectorAll("[data-link]").forEach(link => link.addEventListener("click", event => {
    event.preventDefault();
    navigate(link.getAttribute("href"));
  }));
  container.querySelectorAll("[data-rename-watchlist]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await DataStore.renameWatchlist(form.dataset.renameWatchlist, new FormData(form).get("name"));
      showToast("Watchlist actualizada.");
      await renderWatchlists();
    } catch (error) {
      showToast(error.message || "No se pudo renombrar la watchlist.");
    }
  }));
  container.querySelectorAll("[data-add-watchlist-item]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const ticker = String(data.get("ticker") || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 16);
    try {
      await DataStore.addWatchlistItem(form.dataset.addWatchlistItem, {
        ticker,
        companyName: String(data.get("companyName") || "").trim() || ticker
      });
      showToast("Acción agregada.");
      await renderWatchlists();
    } catch (error) {
      showToast(error.message || "No se pudo agregar la acción.");
    }
  }));
  container.querySelectorAll("[data-remove-watchlist-item]").forEach(button => button.addEventListener("click", async () => {
    try {
      await DataStore.removeWatchlistItem(button.dataset.removeWatchlistItem);
      showToast("Acción removida.");
      await renderWatchlists();
    } catch (error) {
      showToast(error.message || "No se pudo remover la acción.");
    }
  }));
  container.querySelectorAll("[data-delete-watchlist]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("¿Desea eliminar esta watchlist y sus acciones guardadas?")) return;
    try {
      await DataStore.deleteWatchlist(button.dataset.deleteWatchlist);
      showToast("Watchlist eliminada.");
      await renderWatchlists();
    } catch (error) {
      showToast(error.message || "No se pudo eliminar la watchlist.");
    }
  }));
}

function stockAnalysisCard(stock, summary) {
  const metrics = [
    ["Ticker", stock.ticker],
    ["Empresa", stock.companyName],
    ["Bolsa", stock.exchange],
    ["Precio actual", formatCurrency(stock.currentPrice)],
    ["Capitalización", formatLargeNumber(stock.marketCap)],
    ["P/E", formatMetric(stock.peRatio)],
    ["EPS", formatMetric(stock.eps)],
    ["Dividendo", formatPercent(stock.dividendYield)],
    ["Beta", formatMetric(stock.beta)],
    ["Máx. 52 semanas", formatCurrency(stock.yearHigh)],
    ["Mín. 52 semanas", formatCurrency(stock.yearLow)],
    ["Sector", stock.sector],
    ["Industria", stock.industry]
  ];
  return `<div class="analysis-result-box stock-analysis-card">
    <span class="eyebrow">Resultado educativo</span>
    <h3>${escapeHtml(stock.companyName || stock.ticker)}</h3>
    <div class="stock-metric-grid">${metrics.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`).join("")}</div>
    <div class="education-summary">
      <h4>Valoración</h4><p>${escapeHtml(summary.valuation)}</p>
      <h4>Riesgo</h4><p>${escapeHtml(summary.risk)}</p>
      <h4>Ingresos y dividendos</h4><p>${escapeHtml(summary.income)}</p>
      <h4>Volatilidad</h4><p>${escapeHtml(summary.volatility)}</p>
      <h4>Perfil del negocio</h4><p>${escapeHtml(summary.business)}</p>
    </div>
    <div class="watchlist-add-area">
      <button class="button button-ink" id="addToWatchlistButton" data-ticker="${escapeHtml(stock.ticker)}" data-company="${escapeHtml(stock.companyName || stock.ticker)}">Agregar a Watchlist</button>
      <div id="watchlistPicker" class="watchlist-picker hidden"></div>
    </div>
    ${Components.DisclaimerBlock({ compact: true })}
  </div>`;
}

function buildEducationalSummary(stock) {
  const pe = Number(stock.peRatio);
  const beta = Number(stock.beta);
  const dividend = Number(stock.dividendYield);
  const sector = stock.sector || "su sector";
  const valuation = Number.isFinite(pe)
    ? `El múltiplo P/E de ${pe.toFixed(2)} ofrece una referencia inicial para comparar expectativas del mercado frente a beneficios actuales. Conviene contrastarlo con empresas comparables y crecimiento histórico.`
    : "No hay suficiente información de múltiplos para formar una lectura de valoración; conviene revisar estados financieros y comparables.";
  const risk = `La revisión educativa debe considerar concentración de ingresos, márgenes, deuda, ciclo económico y riesgos específicos de ${sector}.`;
  const income = Number.isFinite(dividend) && dividend > 0
    ? `La rentabilidad por dividendo reportada es ${formatPercent(dividend)}. Es útil analizar sostenibilidad, flujo de caja y política histórica de distribución.`
    : "No se observa una rentabilidad por dividendo destacada en los datos disponibles; el análisis de ingresos debe enfocarse en flujo de caja y reinversión.";
  const volatility = Number.isFinite(beta)
    ? `La beta de ${beta.toFixed(2)} ayuda a contextualizar sensibilidad relativa frente al mercado, aunque no describe todos los riesgos del negocio.`
    : "No hay beta disponible; la volatilidad debe evaluarse con datos históricos y escenarios de estrés.";
  const business = `${stock.companyName || stock.ticker} opera en ${stock.industry || "una industria no especificada"} dentro de ${sector}. El análisis educativo debe partir del modelo de negocio y sus fuentes de ventaja competitiva.`;
  return {
    valuation,
    risk,
    income,
    volatility,
    business,
    shortText: `${valuation} ${risk} ${income}`.slice(0, 900)
  };
}

async function renderSearchHistory() {
  const container = document.getElementById("searchHistory");
  if (!container) return;
  const isAdmin = AuthProvider.profile?.role === "admin";
  const searches = await DataStore.getSearchHistory({ all: isAdmin });
  container.innerHTML = searchTable(searches, isAdmin);
}

async function bindAdminCourses() {
  const form = document.getElementById("courseAdminForm");
  const render = async () => {
    const courses = await DataStore.getAcademyCourses({ admin: true });
    document.getElementById("adminCoursesList").innerHTML = cmsCards(courses, "course");
    bindCmsEditButtons("course", courses, render);
  };
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("courseAdminStatus");
    const data = new FormData(form);
    status.innerHTML = `<div class="status-message">Guardando curso…</div>`;
    try {
      const fileUrl = data.get("thumbnail")?.name ? await DataStore.uploadAcademyFile("academy-images", data.get("thumbnail")) : "";
      await DataStore.saveCourse({
        title: String(data.get("title") || "").trim(),
        slug: String(data.get("slug") || "").trim(),
        description: String(data.get("description") || "").trim(),
        thumbnail_url: fileUrl || String(data.get("thumbnail_url") || "").trim(),
        is_published: data.get("is_published") === "on"
      }, form.dataset.id);
      form.reset();
      form.dataset.id = "";
      status.innerHTML = `<div class="status-message">Curso guardado correctamente.</div>`;
      await render();
    } catch (error) {
      status.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudo guardar el curso.")}</div>`;
    }
  });
  await render();
}

async function bindAdminLessons() {
  const form = document.getElementById("lessonAdminForm");
  const courses = await DataStore.getAcademyCourses({ admin: true });
  document.getElementById("lessonCourseSelect").innerHTML = courses.map(course => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.title)}</option>`).join("");
  bindRichEditor();
  const render = async () => {
    const lessons = await DataStore.getAdminLessons();
    document.getElementById("adminLessonsList").innerHTML = cmsCards(lessons, "lesson");
    bindCmsEditButtons("lesson", lessons, render);
  };
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    document.getElementById("lessonContentInput").value = document.getElementById("lessonContentEditor").innerHTML;
    const status = document.getElementById("lessonAdminStatus");
    const data = new FormData(form);
    status.innerHTML = `<div class="status-message">Guardando lección…</div>`;
    try {
      await DataStore.saveLesson({
        course_id: data.get("course_id"),
        title: String(data.get("title") || "").trim(),
        content: data.get("content"),
        video_url: String(data.get("video_url") || "").trim(),
        lesson_order: data.get("lesson_order"),
        is_published: data.get("is_published") === "on"
      }, form.dataset.id);
      form.reset();
      form.dataset.id = "";
      document.getElementById("lessonContentEditor").innerHTML = "";
      status.innerHTML = `<div class="status-message">Lección guardada correctamente.</div>`;
      await render();
    } catch (error) {
      status.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudo guardar la lección.")}</div>`;
    }
  });
  await render();
}

async function bindAdminBooks() {
  const form = document.getElementById("bookAdminForm");
  const render = async () => {
    const books = await DataStore.getAcademyBooks({ admin: true });
    document.getElementById("adminBooksList").innerHTML = cmsCards(books, "book");
    bindCmsEditButtons("book", books, render);
  };
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("bookAdminStatus");
    const data = new FormData(form);
    status.innerHTML = `<div class="status-message">Guardando libro…</div>`;
    try {
      const fileUrl = data.get("book_file")?.name ? await DataStore.uploadAcademyFile("academy-books", data.get("book_file")) : "";
      const coverUrl = data.get("cover_image")?.name ? await DataStore.uploadAcademyFile("academy-images", data.get("cover_image")) : "";
      await DataStore.saveBook({
        title: String(data.get("title") || "").trim(),
        author: String(data.get("author") || "").trim(),
        description: String(data.get("description") || "").trim(),
        category: data.get("category"),
        file_url: fileUrl || String(data.get("file_url") || "").trim(),
        cover_image_url: coverUrl || String(data.get("cover_image_url") || "").trim(),
        is_published: data.get("is_published") === "on"
      }, form.dataset.id);
      form.reset();
      form.dataset.id = "";
      status.innerHTML = `<div class="status-message">Libro guardado correctamente.</div>`;
      await render();
    } catch (error) {
      status.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudo guardar el libro.")}</div>`;
    }
  });
  await render();
}

async function bindAdminUsers() {
  const users = await DataStore.getAdminUsers();
  document.getElementById("adminUsersList").innerHTML = users.length
    ? `<table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Fecha</th></tr></thead><tbody>${users.map(user => `<tr><td>${escapeHtml(user.full_name || "—")}</td><td>${escapeHtml(user.email || "—")}</td><td>${escapeHtml(user.role || "viewer")}</td><td>${formatDate(user.created_at)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">No hay usuarios registrados.</p>`;
}

function cmsCards(items, type) {
  if (!items.length) return emptyContent("No hay contenido", "Cree el primer registro desde el formulario.");
  return items.map(item => `<article class="cms-card"><div><span class="tag">${item.is_published ? "Publicado" : "Borrador"}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || item.academy_courses?.title || item.category || "Contenido educativo")}</p></div><div class="cms-actions"><button class="button button-outline" data-edit-${type}="${escapeHtml(item.id)}">Editar</button><button class="button button-outline" data-delete-${type}="${escapeHtml(item.id)}">Eliminar</button></div></article>`).join("");
}

function bindCmsEditButtons(type, items, render) {
  document.querySelectorAll(`[data-edit-${type}]`).forEach(button => button.addEventListener("click", () => {
    const item = items.find(entry => entry.id === button.dataset[`edit${capitalize(type)}`]);
    if (!item) return;
    if (type === "course") fillCourseForm(item);
    if (type === "lesson") fillLessonForm(item);
    if (type === "book") fillBookForm(item);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelectorAll(`[data-delete-${type}]`).forEach(button => button.addEventListener("click", async () => {
    if (!confirm("¿Desea eliminar este contenido?")) return;
    const id = button.dataset[`delete${capitalize(type)}`];
    if (type === "course") await DataStore.deleteCourse(id);
    if (type === "lesson") await DataStore.deleteLesson(id);
    if (type === "book") await DataStore.deleteBook(id);
    showToast("Contenido eliminado.");
    await render();
  }));
}

function fillCourseForm(course) {
  const form = document.getElementById("courseAdminForm");
  form.dataset.id = course.id;
  form.elements.title.value = course.title || "";
  form.elements.slug.value = course.slug || "";
  form.elements.description.value = course.description || "";
  form.elements.thumbnail_url.value = course.thumbnail_url || "";
  form.elements.is_published.checked = Boolean(course.is_published);
}

function fillLessonForm(lesson) {
  const form = document.getElementById("lessonAdminForm");
  form.dataset.id = lesson.id;
  form.elements.course_id.value = lesson.course_id || "";
  form.elements.title.value = lesson.title || "";
  form.elements.video_url.value = lesson.video_url || "";
  form.elements.lesson_order.value = lesson.lesson_order || 1;
  form.elements.is_published.checked = Boolean(lesson.is_published);
  document.getElementById("lessonContentEditor").innerHTML = lesson.content || "";
}

function fillBookForm(book) {
  const form = document.getElementById("bookAdminForm");
  form.dataset.id = book.id;
  form.elements.title.value = book.title || "";
  form.elements.author.value = book.author || "";
  form.elements.description.value = book.description || "";
  form.elements.category.value = book.category || bookCategories[0];
  form.elements.file_url.value = book.file_url || "";
  form.elements.cover_image_url.value = book.cover_image_url || "";
  form.elements.is_published.checked = Boolean(book.is_published);
}

function bindRichEditor() {
  document.querySelectorAll(".rich-toolbar button").forEach(button => button.addEventListener("click", () => {
    const command = button.dataset.command;
    let value = button.dataset.value || null;
    if (command === "createLink") value = prompt("URL del enlace") || "";
    if (command === "insertImage") value = prompt("URL de la imagen") || "";
    if (value === "") return;
    document.execCommand(command, false, value);
    document.getElementById("lessonContentEditor")?.focus();
  }));
}

async function bindAdminDashboard() {
  const stats = await DataStore.getAdminStats();
  const statsNode = document.getElementById("adminStats");
  if (statsNode) {
    statsNode.innerHTML = `
      <div class="admin-stat"><strong>${stats.users}</strong><span>Usuarios registrados</span></div>
      <div class="admin-stat"><strong>${stats.courses}</strong><span>Cursos publicados</span></div>
      <div class="admin-stat"><strong>${stats.lessons}</strong><span>Lecciones publicadas</span></div>
      <div class="admin-stat"><strong>${stats.books}</strong><span>Libros publicados</span></div>
      <div class="admin-stat"><strong>${stats.searches}</strong><span>Búsquedas totales</span></div>`;
  }
  const searchesNode = document.getElementById("adminSearches");
  if (searchesNode) {
    const searches = await DataStore.getSearchHistory({ all: true });
    searchesNode.innerHTML = searchTable(searches, true);
  }
  const usersNode = document.getElementById("adminRecentUsers");
  if (usersNode) {
    try {
      const users = await DataStore.getAdminUsers();
      usersNode.innerHTML = users.length
        ? `<table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Fecha</th></tr></thead><tbody>${users.slice(0, 8).map(user => `<tr><td>${escapeHtml(user.full_name || "—")}</td><td>${escapeHtml(user.email || "—")}</td><td>${escapeHtml(user.role || "viewer")}</td><td>${formatDate(user.created_at)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">No hay usuarios registrados.</p>`;
    } catch (error) {
      usersNode.innerHTML = `<p class="muted">${escapeHtml(error.message || "No se pudieron cargar usuarios recientes.")}</p>`;
    }
  }
  const mostSearchedNode = document.getElementById("mostSearchedSymbols");
  if (mostSearchedNode) {
    const symbols = await DataStore.getMostSearchedSymbols();
    mostSearchedNode.innerHTML = symbols.length
      ? symbols.map(item => `<span class="symbol-chip"><strong>${escapeHtml(item.ticker)}</strong>${item.count}</span>`).join("")
      : `<span class="muted">Aún no hay búsquedas suficientes.</span>`;
  }
  const contactsNode = document.getElementById("adminContacts");
  if (contactsNode) {
    try {
      const contacts = await DataStore.getContactRequests();
      contactsNode.innerHTML = contactTable(contacts);
      contactsNode.querySelectorAll("[data-contact-status]").forEach(select => {
        select.addEventListener("change", async event => {
          try {
            await DataStore.updateContactStatus(event.target.dataset.contactStatus, event.target.value);
            showToast("Estado de solicitud actualizado.");
            bindAdminDashboard();
          } catch (error) {
            showToast(error.message || "No se pudo actualizar el estado.");
          }
        });
      });
    } catch (error) {
      contactsNode.innerHTML = `<p class="muted">${escapeHtml(error.message || "No se pudieron cargar las solicitudes.")}</p>`;
    }
  }
}

function searchTable(searches, showUser) {
  if (!searches.length) return `<p class="muted">No hay búsquedas guardadas todavía.</p>`;
  return `<table><thead><tr><th>Ticker</th><th>Empresa</th>${showUser ? "<th>Usuario</th>" : ""}<th>Fecha</th></tr></thead><tbody>${searches.map(item => `<tr><td><strong>${escapeHtml(item.ticker)}</strong></td><td>${escapeHtml(item.company_name || "—")}</td>${showUser ? `<td>${escapeHtml(item.user_id)}</td>` : ""}<td>${formatDate(item.created_at)}</td></tr>`).join("")}</tbody></table>`;
}

function contactTable(contacts) {
  if (!contacts.length) return `<p class="muted">No hay solicitudes de contacto todavía.</p>`;
  return `<table><thead><tr><th>Nombre</th><th>Correo</th><th>Asunto</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>${contacts.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.subject || "—")}</td><td><select class="status-select" data-contact-status="${escapeHtml(item.id)}"><option value="new" ${item.status === "new" ? "selected" : ""}>new</option><option value="reviewed" ${item.status === "reviewed" ? "selected" : ""}>reviewed</option><option value="closed" ${item.status === "closed" ? "selected" : ""}>closed</option></select></td><td>${formatDate(item.created_at)}</td></tr>`).join("")}</tbody></table>`;
}

function bindAuthForms() {
  const form = document.getElementById("authForm");
  const resetForm = document.getElementById("resetForm");

  if (form) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const status = document.getElementById("authStatus");
      const mode = authMode();
      const data = new FormData(form);
      status.innerHTML = `<div class="status-message">Procesando solicitud…</div>`;
      try {
        if (mode === "register") {
          const result = await AuthProvider.register({
            fullName: String(data.get("fullName")).trim(),
            email: String(data.get("email")).trim(),
            password: String(data.get("password"))
          });
          if (!result.session) {
            status.innerHTML = `<div class="status-message">Cuenta creada. Revise su correo para confirmar el acceso.</div>`;
            return;
          }
        } else {
          await AuthProvider.login({
            email: String(data.get("email")).trim(),
            password: String(data.get("password"))
          });
        }
        SessionTimeoutHandler.sync();
        navigate("/analisis");
      } catch (error) {
        status.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudo completar la solicitud.")}</div>`;
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", async event => {
      event.preventDefault();
      const status = document.getElementById("authStatus");
      const email = new FormData(resetForm).get("email");
      status.innerHTML = `<div class="status-message">Enviando enlace…</div>`;
      try {
        await AuthProvider.resetPassword(String(email).trim());
        status.innerHTML = `<div class="status-message">Si el correo existe, recibirá instrucciones para restablecer la contraseña.</div>`;
      } catch (error) {
        status.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudo enviar el enlace.")}</div>`;
      }
    });
  }
}

function bindContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.getElementById("contactStatus");
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim() || null,
      subject: String(data.get("subject") || "").trim(),
      message: String(data.get("message") || "").trim()
    };

    if (!payload.name || !payload.email || !payload.subject || !payload.message) {
      status.innerHTML = `<div class="status-message error">Nombre, correo, asunto y mensaje son obligatorios.</div>`;
      return;
    }

    status.innerHTML = `<div class="status-message">Enviando solicitud…</div>`;
    try {
      await DataStore.createContactRequest(payload);
      form.reset();
      status.innerHTML = `<div class="status-message">Su solicitud fue enviada correctamente. Nuestro equipo la revisará pronto.</div>`;
      showToast("Su solicitud fue enviada correctamente. Nuestro equipo la revisará pronto.");
    } catch (error) {
      status.innerHTML = `<div class="status-message error">${escapeHtml(error.message || "No se pudo enviar la solicitud. Inténtelo nuevamente.")}</div>`;
    }
  });
}

function navigate(href) {
  const [path, query = ""] = href.split("?");
  const routePath = stripAppBase(path);
  const target = `${routePath}${query ? `?${query}` : ""}`;
  history.pushState({}, "", `${APP_BASE}/index.html#${target}`);
  document.body.classList.remove("menu-open");
  renderRoute();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function authMode() {
  const raw = routeSearchString();
  const params = new URLSearchParams(raw || "");
  const mode = params.get("mode");
  return ["login", "register", "reset"].includes(mode) ? mode : "login";
}

function routeQueryParam(name) {
  const raw = routeSearchString();
  return new URLSearchParams(raw || "").get(name) || "";
}

function currentPath() {
  if (location.hash) {
    const hashPath = location.hash.replace(/^#/, "").split("?")[0];
    return normalizePath(hashPath || "/");
  }
  return normalizePath(stripAppBase(location.pathname));
}

function routeSearchString() {
  if (location.hash && location.hash.includes("?")) return location.hash.split("?")[1];
  return location.search.slice(1);
}

function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function stripAppBase(path) {
  if (!path) return "/";
  if (path === APP_BASE) return "/";
  if (path === "/index.html") return "/";
  if (path.startsWith(`${APP_BASE}/`)) {
    const stripped = path.slice(APP_BASE.length) || "/";
    return stripped === "/index.html" ? "/" : stripped;
  }
  return path;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function initials(value) {
  return String(value || "U").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
}

function formatLargeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 2 }).format(number);
}

function formatMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(number);
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const normalized = Math.abs(number) > 1 ? number / 100 : number;
  return new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 2 }).format(normalized);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

window.addEventListener("popstate", renderRoute);
renderRoute();
const scheduleAuthInit = window.requestIdleCallback
  ? callback => window.requestIdleCallback(callback, { timeout: 2500 })
  : callback => setTimeout(callback, 1800);
scheduleAuthInit(() => AuthProvider.init().then(() => {
  SessionTimeoutHandler.sync();
  renderRoute();
}));
