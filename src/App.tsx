import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { Activity, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardList, Clock3, CreditCard, ExternalLink, Eye, EyeOff, LayoutDashboard, LoaderCircle, LogOut, Menu, Package, Plus, RefreshCw, Search, Settings, ShoppingBag, ShoppingCart, Store, Truck, Wallet, MessageCircle, X } from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import { formatNaira, isSupabaseConfigured, messageFromError, supabase } from "./lib/supabase";

type Business = { id: string; owner_id: string; name: string; slug: string; business_type: string; email: string | null; whatsapp_number: string | null; timezone: string };
type Product = { id: string; business_id: string; type: string; name: string; description: string | null; price_minor: number; image_url?: string | null; is_active: boolean; created_at?: string };
type Order = { id: string; business_id: string; customer_name: string; customer_email: string | null; customer_phone: string; status: string; total_amount_minor: number; amount_paid_minor: number; currency_code: string; fulfilment_method: string; customer_note: string | null; created_at: string };
type PaymentRecord = { id: string; business_id: string; order_id: string; amount_minor: number; method: "cash" | "bank_transfer" | "pos" | "online" | "other"; reference: string | null; note: string | null; recorded_at: string; recorded_by: string };
type Reservation = { id: string; customer_name: string; customer_phone: string; status: string; requested_pickup_at: string | null; total_amount_minor: number; created_at: string };
type Notice = { type: "success" | "error" | "info"; text: string };
const money = (n: number) => formatNaira(Number(n || 0));
const dateLabel = (v?: string) => v ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)) : "—";
const shortDate = (v?: string) => v ? new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short" }).format(new Date(v)) : "—";
const initials = (v: string) => v.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "OP";

function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const show = useCallback((text: string, type: Notice["type"] = "success") => setNotice({ text, type }), []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return { notice, show };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => setSession(value));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!isSupabaseConfigured || !supabase) return <SetupScreen />;
  if (!ready) return <FullLoader label="Starting OrderPing…" />;
  return <Routes>
    <Route path="/store/:slug" element={<Storefront />} />
    <Route path="/login" element={session ? <Navigate to="/app" replace /> : <AuthScreen />} />
    <Route path="/" element={<LandingPage signedIn={Boolean(session)} />} />
    <Route path="/app/*" element={session ? <VendorApp user={session.user} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<NotFound />} />
  </Routes>;
}

function LandingPage({ signedIn }: { signedIn: boolean }) {
  return <main className="landing-page">
    <header className="landing-nav">
      <Brand />
      <nav aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#features">Features</a>
        <a href="#contact">Contact</a>
      </nav>
      <div className="landing-nav-actions">
        <Link className="landing-login-link" to={signedIn ? "/app" : "/login"}>{signedIn ? "Open dashboard" : "Sign in"}</Link>
        <Link className="button primary" to={signedIn ? "/app" : "/login"}>{signedIn ? "Go to dashboard" : "Get started"} <ArrowRight size={15} /></Link>
      </div>
    </header>
    <section className="landing-hero">
      <div className="landing-copy">
        <span className="landing-kicker"><span className="landing-kicker-dot" /> SIMPLE ORDER MANAGEMENT FOR SMALL BUSINESSES</span>
        <h1>Turn your catalogue into <em>your next order.</em></h1>
        <p>Share one clean store link. Let customers place orders or request reservations. Keep every order and payment record organised in one workspace.</p>
        <div className="landing-hero-actions">
          <Link className="button primary landing-primary" to={signedIn ? "/app" : "/login"}>{signedIn ? "Open your dashboard" : "Create your vendor account"} <ArrowRight size={17} /></Link>
          <a className="button secondary landing-secondary" href="#how-it-works"><span className="landing-play">↘</span> See how it works</a>
        </div>
        <div className="landing-trust-line"><CheckCircle2 size={16} /> Customers order as guests <span /> No payment processing required</div>
      </div>
      <div className="landing-visual" aria-label="Illustration of an OrderPing vendor dashboard">
        <div className="visual-glow" />
        <div className="visual-window">
          <div className="visual-window-top"><span className="visual-window-brand"><span className="visual-mini-mark"><ShoppingBag size={13} /></span> orderping</span><span className="visual-window-status"><i /> Vendor workspace</span></div>
          <div className="visual-window-body">
            <div className="visual-sidebar"><span className="visual-sidebar-brand" /><span className="visual-sidebar-active" /><span /><span /><span /><span /></div>
            <div className="visual-dashboard">
              <div className="visual-greeting"><div><small>YOUR BUSINESS AT A GLANCE</small><strong>Good morning, vendor</strong></div><span className="visual-avatar">OP</span></div>
              <div className="visual-summary"><div><span>Open orders</span><strong>08</strong><i>↗ Today</i></div><div><span>Reservations</span><strong>04</strong><i>↗ Pending</i></div></div>
              <div className="visual-orders-head"><strong>Recent orders</strong><span>View all</span></div>
              <div className="visual-order-row"><span className="visual-product-dot peach" /><span className="visual-order-lines"><b>Everyday essentials</b><small>Customer order · #OP-1042</small></span><span className="visual-order-pill">New</span></div>
              <div className="visual-order-row"><span className="visual-product-dot blue" /><span className="visual-order-lines"><b>Classic tote bag</b><small>Customer order · #OP-1041</small></span><span className="visual-order-pill processing">Processing</span></div>
              <div className="visual-order-row"><span className="visual-product-dot green" /><span className="visual-order-lines"><b>Daily care bundle</b><small>Customer order · #OP-1040</small></span><span className="visual-order-pill ready">Ready</span></div>
            </div>
          </div>
          <div className="visual-bottom-note"><CheckCircle2 size={14} /> One place for orders, reservations and payment records</div>
        </div>
        <div className="floating-note floating-note-top"><span className="floating-note-icon violet"><ShoppingBag size={17} /></span><span><b>New order received</b><small>Customer checkout complete</small></span><Check size={16} /></div>
        <div className="floating-note floating-note-bottom"><span className="floating-note-icon mint"><Wallet size={17} /></span><span><b>Payment record updated</b><small>Balance tracked in one view</small></span><Check size={16} /></div>
      </div>
    </section>
    <div className="landing-proof-strip"><div><strong>One link</strong><span>Share your catalogue</span></div><div><strong>Guest checkout</strong><span>No customer account needed</span></div><div><strong>Order clarity</strong><span>Track fulfilment status</span></div><div><strong>Payment ledger</strong><span>Know what is still due</span></div></div>
    <section className="landing-section" id="how-it-works">
      <div className="landing-section-heading"><span className="eyebrow">A SIMPLER WAY TO SELL</span><h2>From product list to organised orders.</h2><p>Keep the customer experience light and the admin work under control.</p></div>
      <div className="landing-steps"><article><span className="landing-step-number">01</span><span className="landing-step-icon"><Store size={21} /></span><h3>Set up your storefront</h3><p>Add your business details and publish the products you want customers to see.</p></article><article><span className="landing-step-number">02</span><span className="landing-step-icon"><ExternalLink size={21} /></span><h3>Share one simple link</h3><p>Send your catalogue on WhatsApp, Instagram, or wherever your customers find you.</p></article><article><span className="landing-step-number">03</span><span className="landing-step-icon"><ClipboardList size={21} /></span><h3>Manage everything together</h3><p>Review incoming orders, respond to reservations, and record payments from your workspace.</p></article></div>
    </section>
    <section className="landing-feature-section" id="features">
      <div className="landing-feature-intro"><span className="eyebrow">MADE FOR DAILY BUSINESS</span><h2>Less chasing. More clarity.</h2><p>OrderPing gives your day-to-day selling a clear home, whether your customers find you through social media or word of mouth.</p><Link className="text-link" to={signedIn ? "/app" : "/login"}>{signedIn ? "Go to your workspace" : "Start with OrderPing"} <ArrowRight size={15} /></Link></div>
      <div className="landing-features-grid"><article><span className="landing-feature-icon violet"><ShoppingCart size={20} /></span><h3>Orders in one view</h3><p>See customer details, order status and fulfilment without searching through chats.</p></article><article><span className="landing-feature-icon mint"><Wallet size={20} /></span><h3>Manual payment tracking</h3><p>Record what has been received and keep outstanding balances visible.</p></article><article><span className="landing-feature-icon peach"><Clock3 size={20} /></span><h3>Product reservations</h3><p>Review and respond to requests from customers who want to reserve products.</p></article><article><span className="landing-feature-icon blue"><ShoppingBag size={20} /></span><h3>Customer-friendly storefront</h3><p>Customers browse and submit orders as guests, without creating an account.</p></article></div>
    </section>
    <section className="landing-cta"><div><span className="eyebrow">READY WHEN YOU ARE</span><h2>Give your orders a proper home.</h2><p>Start with your storefront, then manage each new order from one workspace.</p></div><Link className="button primary landing-primary" to={signedIn ? "/app" : "/login"}>{signedIn ? "Open dashboard" : "Create your vendor account"} <ArrowRight size={17} /></Link></section>
    <WhatsAppContactForm />
    <footer className="landing-footer"><Brand /><span>Orders made simpler.</span><div><a href="https://wa.me/2349066929361" target="_blank" rel="noreferrer">WhatsApp us</a><Link to="/login">Vendor sign in</Link><span>© {new Date().getFullYear()} OrderPing</span></div></footer>
  </main>;
}

function WhatsAppContactForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = [
      "Hi OrderPing team! I'd like to make an enquiry.",
      "",
      "Name: " + name.trim(),
      "Phone: " + phone.trim(),
      "Message: " + message.trim(),
    ].join("\n");
    window.open("https://wa.me/2349066929361?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
  }
  return <section className="landing-contact" id="contact">
    <div className="landing-contact-copy"><span className="eyebrow">NEED A HAND?</span><h2>Talk to the OrderPing team.</h2><p>Send your enquiry through WhatsApp. We'll prepare your message and let you send it from your WhatsApp account.</p><a className="button secondary" href="https://wa.me/2349066929361" target="_blank" rel="noreferrer"><MessageCircle size={16} /> Chat on WhatsApp</a></div>
    <form className="landing-contact-form" onSubmit={submit}>
      <label>Your name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" /></label>
      <label>Phone number<input required type="tel" maxLength={32} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+234…" /></label>
      <label>Your message<textarea required rows={4} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="How can we help?" /></label>
      <button className="button primary full" type="submit"><MessageCircle size={16} /> Continue to WhatsApp</button>
      <p className="field-hint">WhatsApp opens with your message ready. You still need to tap Send.</p>
    </form>
  </section>;
}

function Brand({ light = false }: { light?: boolean }) {
  return <Link to="/" className={"brand-lockup" + (light ? " light" : "")}><span className="brand-mark"><ShoppingBag size={21} /></span><span>orderping</span></Link>;
}
function SetupScreen() {
  return <div className="setup-page"><div className="setup-card"><Brand /><span className="eyebrow">FRONTEND CONFIGURATION</span><h1>Connect your workspace.</h1><p>The vendor interface is ready for its Supabase connection. Add your project URL and publishable/anon key to a local <code>.env</code> file.</p><div className="code-panel"><code>VITE_SUPABASE_URL=https://…supabase.co<br />VITE_SUPABASE_ANON_KEY=…</code></div><p className="small-muted">Use the MEKA LOGIC project. Expose the <code>orderping</code> schema in API settings without removing existing schemas. Never use a service-role key in frontend code.</p><a className="text-link" href="https://supabase.com/dashboard/project/baoqyhhyenimfhkrwspn/settings/api" target="_blank" rel="noreferrer">Open Supabase API settings <ExternalLink size={14} /></a></div></div>;
}
function FullLoader({ label }: { label: string }) {
  return <div className="full-loader"><span className="spinner"><LoaderCircle size={22} /></span><span>{label}</span></div>;
}
function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError("");
    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        navigate("/app");
      } else {
        const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (authError) throw authError;
        if (data.session) navigate("/app");
        else setError("Account created. Check your email to confirm your account, then sign in.");
      }
    } catch (err) { setError(messageFromError(err)); }
    finally { setBusy(false); }
  }
  return <div className="auth-page">
    <section className="auth-story">
      <Brand light />
      <div className="story-content">
        <span className="eyebrow light-eyebrow">YOUR BUSINESS, LESS SCATTERED</span>
        <h1>Make space for<br /><em>the next order.</em></h1>
        <p>Bring your catalogue, customer requests and payment records into one calm, focused workspace.</p>
        <div className="auth-benefits">
          <div><span><CheckCircle2 size={17} /></span><div><strong>A storefront worth sharing</strong><small>One simple link for your customers</small></div></div>
          <div><span><CheckCircle2 size={17} /></span><div><strong>Orders without the guesswork</strong><small>See status, customer and fulfilment</small></div></div>
          <div><span><CheckCircle2 size={17} /></span><div><strong>Payments tracked clearly</strong><small>Know what came in and what remains</small></div></div>
        </div>
      </div>
      <div className="story-footer">ORDERPING · ORDERS MADE SIMPLER</div>
    </section>
    <section className="auth-panel">
      <div className="auth-panel-inner">
        <div className="auth-back"><Link to="/" className="back-home"><ArrowRight size={14} /> Back to home</Link><div className="mobile-brand"><Brand /></div></div>
        <span className="eyebrow">{mode === "login" ? "VENDOR WORKSPACE" : "START SELLING WITH ORDERPING"}</span>
        <h2>{mode === "login" ? "Welcome back." : "Create your account."}</h2>
        <p className="auth-subtitle">{mode === "login" ? "Sign in to manage your store and customer orders." : "Set up your vendor account to create a shareable storefront."}</p>
        <div className="auth-mode-tabs" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
        </div>
        <form className="form-stack auth-form" onSubmit={submit}>
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@business.com" /></label>
          <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /><button className="icon-button password-toggle" type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><span className="field-hint">Use at least 8 characters.</span></label>
          {error && <div className={mode === "signup" && error.startsWith("Account created.") ? "inline-alert info" : "inline-alert error"}>{error}</div>}
          <button className="button primary full auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{mode === "login" ? "Sign in to OrderPing" : "Create vendor account"}<ArrowRight size={16} /></button>
        </form>
        <div className="auth-security-note"><span><CheckCircle2 size={16} /></span><p>Your account is private. Customers can still browse your store and order as guests.</p></div>
        <p className="auth-legal">By continuing, you agree to use OrderPing responsibly and keep account credentials secure.</p>
      </div>
    </section>
  </div>;
}
const navItems = [
  { label: "Overview", path: "/app", icon: LayoutDashboard, exact: true },
  { label: "Orders", path: "/app/orders", icon: ShoppingCart },
  { label: "Reservations", path: "/app/reservations", icon: ClipboardList },
  { label: "Products", path: "/app/products", icon: Package },
  { label: "Payments", path: "/app/payments", icon: Wallet },
];

function VendorApp({ user }: { user: User }) {
  const location = useLocation(); const navigate = useNavigate(); const { notice, show } = useNotice();
  const [business, setBusiness] = useState<Business | null>(null);
  const [products, setProducts] = useState<Product[]>([]); const [orders, setOrders] = useState<Order[]>([]); const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true); const [pageError, setPageError] = useState(""); const [mobileNav, setMobileNav] = useState(false); const [search, setSearch] = useState("");
  const [productModal, setProductModal] = useState(false); const [editingProduct, setEditingProduct] = useState<Product | null>(null); const [saving, setSaving] = useState(false);
  const [productForm, setProductForm] = useState({ name: "", description: "", price: "", active: true, image_url: "" }); const [productImage, setProductImage] = useState<File | null>(null);
  const [businessForm, setBusinessForm] = useState({ name: "", slug: "", email: "", whatsapp: "" });
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null); const [paymentValue, setPaymentValue] = useState(""); const [paymentMethod, setPaymentMethod] = useState<PaymentRecord["method"]>("bank_transfer"); const [paymentReference, setPaymentReference] = useState(""); const [paymentNote, setPaymentNote] = useState(""); const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]); const [reservationUnavailable, setReservationUnavailable] = useState(false);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setPageError("");
    try {
      const result = await supabase.from("businesses").select("*").eq("owner_id", user.id).maybeSingle();
      if (result.error) throw result.error;
      const current = result.data as Business | null; setBusiness(current);
      if (!current) { setProducts([]); setOrders([]); setReservations([]); setPaymentRecords([]); return; }
      const [pr, or, payments] = await Promise.all([
        supabase.from("catalog_items").select("*").eq("business_id", current.id).eq("type", "product").order("created_at", { ascending: false }),
        supabase.from("orders").select("*").eq("business_id", current.id).eq("order_type", "order").order("created_at", { ascending: false }).limit(200),
        supabase.from("payment_records").select("*").eq("business_id", current.id).order("recorded_at", { ascending: false }).limit(500),
      ]);
      if (pr.error) throw pr.error; if (or.error) throw or.error; if (payments.error) throw payments.error;
      setProducts((pr.data || []) as Product[]); setOrders((or.data || []) as Order[]); setPaymentRecords((payments.data || []) as PaymentRecord[]);
      const rr = await supabase.functions.invoke("vendor-reservations", { body: { business_id: current.id } });
      if (rr.error) setReservationUnavailable(true);
      else { setReservations((rr.data?.reservations || []) as Reservation[]); setReservationUnavailable(false); }
    } catch (err) { setPageError(messageFromError(err)); }
    finally { setLoading(false); }
  }, [user.id]);
  useEffect(() => { void loadData(); }, [loadData]);
  const activeOrders = useMemo(() => orders.filter(o => !["cancelled", "delivered"].includes(o.status)), [orders]);
  const filteredOrders = useMemo(() => { const q = search.trim().toLowerCase(); return q ? orders.filter(o => [o.customer_name, o.customer_phone, o.id, o.status].some(v => String(v || "").toLowerCase().includes(q))) : orders; }, [orders, search]);
  async function signOut() { if (supabase) { await supabase.auth.signOut(); navigate("/login"); } }
  function openProduct(product?: Product) {
    setEditingProduct(product || null);
    setProductForm(product ? { name: product.name, description: product.description || "", price: String(Number(product.price_minor) / 100), active: product.is_active, image_url: product.image_url || "" } : { name: "", description: "", price: "", active: true, image_url: "" }); setProductImage(null);
    setProductModal(true);
  }
  async function saveProduct(event: FormEvent) {
    event.preventDefault(); if (!supabase || !business) return;
    const price = Number(productForm.price);
    if (!Number.isFinite(price) || price < 0) { show("Enter a valid product price.", "error"); return; }
    if (productImage && (!["image/jpeg", "image/png", "image/webp"].includes(productImage.type) || productImage.size > 5 * 1024 * 1024)) { show("Choose a JPG, PNG or WebP image under 5 MB.", "error"); return; }
    setSaving(true);
    try {
      let imageUrl = productForm.image_url || null;
      if (productImage) {
        const extension = productImage.type === "image/jpeg" ? "jpg" : productImage.type === "image/png" ? "png" : "webp";
        const objectPath = business.id + "/" + crypto.randomUUID() + "." + extension;
        const { error: uploadError } = await supabase.storage.from("orderping-product-images").upload(objectPath, productImage, { cacheControl: "3600", contentType: productImage.type, upsert: false });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("orderping-product-images").getPublicUrl(objectPath).data.publicUrl;
      }
      const payload = { business_id: business.id, type: "product", name: productForm.name.trim(), description: productForm.description.trim() || null, price_minor: Math.round(price * 100), image_url: imageUrl, is_active: productForm.active, updated_at: new Date().toISOString() };
      const result = editingProduct ? await supabase.from("catalog_items").update(payload).eq("id", editingProduct.id).eq("business_id", business.id) : await supabase.from("catalog_items").insert(payload);
      if (result.error) throw result.error;
      show(editingProduct ? "Product updated." : "Product added."); setProductModal(false); await loadData();
    } catch (err) { show(messageFromError(err), "error"); } finally { setSaving(false); }
  }
  async function toggleProduct(product: Product) {
    if (!supabase || !business) return;
    const { error } = await supabase.from("catalog_items").update({ is_active: !product.is_active, updated_at: new Date().toISOString() }).eq("id", product.id).eq("business_id", business.id);
    if (error) show(messageFromError(error), "error"); else { show(product.is_active ? "Product hidden." : "Product published."); await loadData(); }
  }
  async function updateOrder(order: Order, status: string) {
    if (!supabase || !business) return;
    const { error } = await supabase.from("orders").update({ status, updated_at: new Date().toISOString() }).eq("id", order.id).eq("business_id", business.id);
    if (error) show(messageFromError(error), "error"); else { show("Order status updated."); await loadData(); }
  }
  async function recordPayment(event: FormEvent) {
    event.preventDefault(); if (!supabase || !business || !paymentOrder) return;
    const value = Number(paymentValue); const minor = Math.round(value * 100);
    if (!Number.isFinite(value) || value <= 0 || minor > Number(paymentOrder.total_amount_minor) - Number(paymentOrder.amount_paid_minor)) { show("Enter a valid payment not exceeding the outstanding balance.", "error"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("payment_records").insert({ business_id: business.id, order_id: paymentOrder.id, amount_minor: minor, method: paymentMethod, reference: paymentReference.trim() || null, note: paymentNote.trim() || null, recorded_by: user.id });
      if (error) throw error;
      show("Payment recorded in the customer ledger."); setPaymentOrder(null); setPaymentValue(""); setPaymentReference(""); setPaymentNote(""); setPaymentMethod("bank_transfer"); await loadData();
    } catch (err) { show(messageFromError(err), "error"); } finally { setSaving(false); }
  }
  async function createBusiness(event: FormEvent) {
    event.preventDefault(); if (!supabase) return;
    const slug = businessForm.slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) { show("Store link must be 3–50 characters: letters, numbers and hyphens.", "error"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("businesses").insert({ owner_id: user.id, name: businessForm.name.trim(), slug, business_type: "product", email: businessForm.email.trim() || null, whatsapp_number: businessForm.whatsapp.trim() || null, timezone: "Africa/Lagos" });
      if (error) throw error; show("Store created."); await loadData();
    } catch (err) { show(messageFromError(err), "error"); } finally { setSaving(false); }
  }
  async function reservationAction(item: Reservation, status: "confirmed" | "cancelled") {
    if (!supabase || !business) return; setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("update-reservation-status", { body: { business_id: business.id, reservation_id: item.id, status } });
      if (error) throw error; show(status === "confirmed" ? "Reservation confirmed." : "Reservation rejected."); await loadData();
    } catch (err) { show("Reservation API is not deployed yet. " + messageFromError(err), "error"); } finally { setSaving(false); }
  }

  const path = location.pathname;
  const pageTitle = path.includes("/products") ? "Products" : path.includes("/orders") ? "Orders" : path.includes("/reservations") ? "Reservations" : path.includes("/payments") ? "Payments" : path.includes("/settings") ? "Store settings" : "Overview";
  if (loading && !business && !pageError) return <FullLoader label="Loading your workspace…" />;
  if (!business) return <div className="onboarding-page"><div className="onboarding-top"><Brand /><button className="button ghost" onClick={signOut}><LogOut size={16} /> Sign out</button></div><div className="onboarding-card"><div className="onboarding-icon"><Store size={26} /></div><span className="eyebrow">YOUR FIRST STORE</span><h1>Let’s get your store ready.</h1><p>Add your business details to create a shareable product catalogue and start managing customer orders.</p><form className="form-stack" onSubmit={createBusiness}><label>Business name<input required maxLength={120} value={businessForm.name} onChange={e => { const name = e.target.value; setBusinessForm(v => ({ ...v, name, slug: v.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") })); }} placeholder="e.g. Ada's Essentials" /></label><label>Store link<input required maxLength={50} value={businessForm.slug} onChange={e => setBusinessForm(v => ({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} placeholder="adas-essentials" /><span className="field-hint">Customers will use /store/{businessForm.slug || "your-store-name"}</span></label><label>Business email (optional)<input type="email" value={businessForm.email} onChange={e => setBusinessForm(v => ({ ...v, email: e.target.value }))} placeholder="hello@business.com" /></label><label>WhatsApp number (optional)<input type="tel" value={businessForm.whatsapp} onChange={e => setBusinessForm(v => ({ ...v, whatsapp: e.target.value }))} placeholder="+234…" /></label>{pageError && <div className="inline-alert error">{pageError}</div>}<button className="button primary full" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Create my store <ArrowRight size={16} /></button></form></div></div>;

  return <div className="app-shell"><aside className={"sidebar" + (mobileNav ? " sidebar-open" : "")}><Brand /><div className="side-label">WORKSPACE</div><div className="workspace-switch"><span className="workspace-avatar">{initials(business.name)}</span><span className="workspace-name"><strong>{business.name}</strong><small>Product store</small></span><ChevronDown size={15} /></div><div className="side-label nav-label">MENU</div><nav className="main-nav">{navItems.map(item => { const active = item.exact ? path === item.path : path.startsWith(item.path); const Icon = item.icon; return <Link key={item.path} to={item.path} onClick={() => setMobileNav(false)} className={"nav-item" + (active ? " active" : "")}><Icon size={18} /><span>{item.label}</span>{item.label === "Orders" && activeOrders.length > 0 && <span className="nav-count">{activeOrders.length}</span>}</Link>; })}</nav><div className="sidebar-spacer" /><div className="side-help"><div className="help-icon"><CircleHelp size={18} /></div><strong>Need a hand?</strong><p>Keep your orders moving. We're here to help you get started.</p><a href="mailto:support@orderping.app">Contact support <ArrowRight size={13} /></a></div><Link to="/app/settings" className={"nav-item settings-link" + (path.includes("/settings") ? " active" : "")}><Settings size={18} /><span>Store settings</span></Link><button className="profile-button" onClick={signOut}><span className="profile-avatar">{initials(user.email || "Vendor")}</span><span className="profile-info"><strong>{user.email?.split("@")[0] || "Store owner"}</strong><small>{user.email}</small></span><LogOut size={16} /></button></aside>
    {mobileNav && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileNav(false)} />}
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div></div><div className="topbar-actions"><span className="live-indicator"><i /> Workspace active</span><button className="icon-button" aria-label="Refresh data" onClick={() => void loadData()}><RefreshCw size={17} /></button><button className="icon-button notification-button" aria-label="Notifications" onClick={() => show("Notifications will appear here when alerts are configured.", "info")}><Bell size={17} /></button><span className="top-avatar">{initials(business.name)}</span></div></header><div className="page-container">
      {notice && <div className={"toast " + notice.type} role="status"><span>{notice.type === "success" ? <CheckCircle2 size={17} /> : <CircleHelp size={17} />}</span>{notice.text}</div>}
      {pageError && <div className="inline-alert error page-error"><span>{pageError}</span><button className="text-link" onClick={() => void loadData()}>Retry</button></div>}
      <Routes>
        <Route index element={<Dashboard business={business} products={products} orders={orders} reservations={reservations} reservationUnavailable={reservationUnavailable} onAddProduct={() => openProduct()} onNavigate={navigate} />} />
        <Route path="products" element={<ProductsPage products={products} search={search} setSearch={setSearch} onAdd={() => openProduct()} onEdit={openProduct} onToggle={toggleProduct} />} />
        <Route path="orders" element={<OrdersPage orders={filteredOrders} search={search} setSearch={setSearch} onStatus={updateOrder} onPayment={order => { setPaymentOrder(order); setPaymentValue(""); }} />} />
        <Route path="reservations" element={<ReservationsPage reservations={reservations} unavailable={reservationUnavailable} onStatus={reservationAction} />} />
        <Route path="payments" element={<PaymentsPage orders={orders} payments={paymentRecords} onRecord={order => { setPaymentOrder(order); setPaymentValue(""); setPaymentReference(""); setPaymentNote(""); setPaymentMethod("bank_transfer"); }} />} />
        <Route path="settings" element={<SettingsPage business={business} productsCount={products.length} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div></main>
    {productModal && <Modal title={editingProduct ? "Edit product" : "Add a product"} onClose={() => setProductModal(false)}><form className="form-stack" onSubmit={saveProduct}><label>Product name<input required maxLength={160} value={productForm.name} onChange={e => setProductForm(v => ({ ...v, name: e.target.value }))} placeholder="e.g. Everyday tote bag" /></label><label>Description <span className="optional-label">Optional</span><textarea rows={3} maxLength={1000} value={productForm.description} onChange={e => setProductForm(v => ({ ...v, description: e.target.value }))} placeholder="A short description customers will see" /></label><label>Price (NGN)<div className="price-input"><span>₦</span><input type="number" min="0" step="0.01" required value={productForm.price} onChange={e => setProductForm(v => ({ ...v, price: e.target.value }))} placeholder="0.00" /></div></label><label>Product picture <span className="optional-label">Optional · JPG, PNG or WebP · Max 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setProductImage(e.target.files?.[0] || null)} />{productImage && <span className="field-hint">Selected: {productImage.name}</span>}{!productImage && productForm.image_url && <span className="field-hint">A product picture is already saved. Choose a new file to replace it.</span>}</label><label className="checkbox-label"><input type="checkbox" checked={productForm.active} onChange={e => setProductForm(v => ({ ...v, active: e.target.checked }))} /> Show this product in the catalogue</label><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setProductModal(false)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{editingProduct ? "Save changes" : "Add product"}</button></div></form></Modal>}
    {paymentOrder && <Modal title="Record a payment" onClose={() => setPaymentOrder(null)}><div className="payment-summary"><span>Customer</span><strong>{paymentOrder.customer_name}</strong><span>Order</span><strong>#{paymentOrder.id.slice(0, 8)}</strong><span>Order total</span><strong>{money(paymentOrder.total_amount_minor)}</strong><span>Already paid</span><strong>{money(paymentOrder.amount_paid_minor)}</strong><span>Balance due</span><strong className="amount-due">{money(Number(paymentOrder.total_amount_minor) - Number(paymentOrder.amount_paid_minor))}</strong></div><form className="form-stack" onSubmit={recordPayment}><label>Payment amount (NGN)<input type="number" min="0.01" step="0.01" required max={(Number(paymentOrder.total_amount_minor) - Number(paymentOrder.amount_paid_minor)) / 100} value={paymentValue} onChange={e => setPaymentValue(e.target.value)} placeholder="0.00" /></label><label>Payment method<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentRecord["method"])}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="pos">POS</option><option value="online">Online</option><option value="other">Other</option></select></label><label>Transfer/reference ID <span className="optional-label">Optional</span><input maxLength={120} value={paymentReference} onChange={e => setPaymentReference(e.target.value)} placeholder="e.g. bank transaction reference" /></label><label>Note <span className="optional-label">Optional</span><textarea rows={2} maxLength={500} value={paymentNote} onChange={e => setPaymentNote(e.target.value)} placeholder="Instalment 1, deposit, etc." /></label><div className="inline-alert info">Each payment is saved separately against this customer’s order. OrderPing does not process payments.</div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setPaymentOrder(null)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save payment</button></div></form></Modal>}
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow || "YOUR BUSINESS"}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
function Dashboard({ business, products, orders, reservations, reservationUnavailable, onAddProduct, onNavigate }: { business: Business; products: Product[]; orders: Order[]; reservations: Reservation[]; reservationUnavailable: boolean; onAddProduct: () => void; onNavigate: (path: string) => void }) {
  const paid = orders.reduce((s, o) => s + Number(o.amount_paid_minor || 0), 0);
  const due = orders.reduce((s, o) => s + Math.max(0, Number(o.total_amount_minor || 0) - Number(o.amount_paid_minor || 0)), 0);
  const awaiting = orders.filter(o => ["new", "processing"].includes(o.status)).length;
  const url = window.location.origin + "/store/" + business.slug;
  return <><div className="welcome-strip"><div><span className="welcome-kicker">✦ YOUR STORE, AT A GLANCE</span><h2>Good business starts here.</h2><p>Here’s what’s happening with {business.name} today.</p></div><div className="welcome-art"><div className="art-circle circle-one" /><div className="art-circle circle-two" /><div className="art-card"><ShoppingBag size={23} /><span>Orders</span><strong>{String(orders.length).padStart(2, "0")}</strong></div></div></div>
    <div className="quick-actions"><button className="button primary" onClick={onAddProduct}><Plus size={17} /> Add product</button><button className="button secondary" onClick={() => onNavigate("/app/orders")}><ShoppingCart size={16} /> View orders <ArrowRight size={15} /></button><button className="button secondary" onClick={() => { void navigator.clipboard?.writeText(url); }}><ExternalLink size={15} /> Copy store link</button></div>
    <div className="section-heading"><div><h2>Business overview</h2><p>A snapshot of your sales activity</p></div><span className="period-pill"><Activity size={14} /> All time</span></div>
    <div className="metric-grid"><MetricCard label="Total orders" value={String(orders.length)} note={awaiting + " need attention"} icon={<ShoppingCart size={19} />} tone="blue" trend="Order volume" /><MetricCard label="Payments received" value={money(paid)} note="Manually recorded" icon={<Wallet size={19} />} tone="green" trend="Collected" /><MetricCard label="Outstanding balance" value={money(due)} note="Across all orders" icon={<CreditCard size={19} />} tone="orange" trend="To collect" /><MetricCard label="Live products" value={String(products.filter(p => p.is_active).length)} note={products.length + " total products"} icon={<Package size={19} />} tone="purple" trend="Catalogue" /></div>
    <div className="dashboard-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h3>Recent orders</h3><p>Your latest customer activity</p></div><button className="text-link" onClick={() => onNavigate("/app/orders")}>All orders <ArrowRight size={14} /></button></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Date</th><th>Status</th><th className="align-right">Total</th></tr></thead><tbody>{orders.slice(0, 5).map(o => <tr key={o.id}><td><CustomerCell name={o.customer_name} detail={o.customer_phone} /></td><td className="muted-cell">{shortDate(o.created_at)}</td><td><StatusPill status={o.status} /></td><td className="align-right amount-cell">{money(o.total_amount_minor)}</td></tr>)}</tbody></table></div> : <EmptyState icon={<ShoppingCart size={22} />} title="No orders yet" description="When customers place an order, it will appear here." action={<button className="button secondary small" onClick={() => onNavigate("/app/products")}>Add your first product</button>} />}</section>
      <section className="panel getting-started"><div className="panel-heading"><div><h3>Getting started</h3><p>Three steps to launch your store</p></div><span className="step-count">{(business ? 1 : 0) + (products.length ? 1 : 0) + (orders.length ? 1 : 0)}/3</span></div><div className="checklist"><Checklist done={Boolean(business)} number="1" title="Set up your store" description="Your business profile is created." /><Checklist done={products.length > 0} number="2" title="Add your products" description="Give customers something to browse." action={!products.length ? <button className="text-link" onClick={onAddProduct}>Add first product <ArrowRight size={13} /></button> : undefined} /><Checklist done={orders.length > 0} number="3" title="Receive your first order" description="Share your storefront link with customers." action={<button className="text-link" onClick={() => { void navigator.clipboard?.writeText(url); }}>Copy store link <ArrowRight size={13} /></button>} /></div><div className="store-link-card"><div className="store-link-icon"><Store size={18} /></div><div><strong>Your storefront</strong><span>{window.location.host}/store/{business.slug}</span></div><button className="icon-button" aria-label="Open storefront" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}><ExternalLink size={16} /></button></div></section></div>
    <div className="bottom-note"><span><Clock3 size={15} /> Reservations</span>{reservationUnavailable ? "Reservation service is waiting for its backend functions." : reservations.length + " reservation requests"}<button className="text-link" onClick={() => onNavigate("/app/reservations")}>View reservations <ArrowRight size={13} /></button></div></>;
}
function Checklist({ done, number, title, description, action }: { done: boolean; number: string; title: string; description: string; action?: ReactNode }) {
  return <div className="checklist-item"><span className={"check-circle" + (done ? " done" : "")}>{done ? <Check size={14} /> : number}</span><div><strong>{title}</strong><p>{description}</p>{action}</div></div>;
}
function MetricCard({ label, value, note, icon, tone, trend }: { label: string; value: string; note: string; icon: ReactNode; tone: string; trend: string }) {
  return <div className="metric-card"><div className="metric-top"><span className={"metric-icon " + tone}>{icon}</span><span className="metric-trend">{trend}</span></div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-note">{note}</span></div>;
}
function CustomerCell({ name, detail }: { name: string; detail: string }) {
  return <div className="customer-cell"><span className="customer-avatar">{initials(name)}</span><span><strong>{name}</strong><small>{detail}</small></span></div>;
}
function ProductsPage({ products, search, setSearch, onAdd, onEdit, onToggle }: { products: Product[]; search: string; setSearch: (v: string) => void; onAdd: () => void; onEdit: (p: Product) => void; onToggle: (p: Product) => void }) {
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const filtered = products.filter(p => [p.name, p.description || ""].some(v => v.toLowerCase().includes(search.toLowerCase())));
  useEffect(() => {
    if (!previewImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
      if (event.key === "+" || event.key === "=") setImageZoom(value => Math.min(3, Number((value + 0.25).toFixed(2))));
      if (event.key === "-") setImageZoom(value => Math.max(1, Number((value - 0.25).toFixed(2))));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);
  return <><PageHeader eyebrow="YOUR CATALOGUE" title="Products" description="Keep your catalogue up to date. Customers only see products you make active." action={<button className="button primary" onClick={onAdd}><Plus size={17} /> Add product</button>} /><div className="toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search products" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" /></div><span className="result-count">{filtered.length} products</span></div>{filtered.length ? <div className="products-grid">{filtered.map((p, i) => <article className="product-card" key={p.id}><div className={"product-art art-tone-" + (i % 5)}>{p.image_url ? <button type="button" className="store-image-trigger" aria-label={"View larger image of " + p.name} onClick={() => { setPreviewImage({ url: p.image_url!, name: p.name }); setImageZoom(1); }}><img className="product-image" src={p.image_url} alt={p.name} loading="lazy" /><span className="store-image-hint"><Search size={14} /> Tap to zoom</span></button> : <span className="product-art-icon"><Package size={29} /></span>}<span className={"status-dot " + (p.is_active ? "active" : "inactive")} /></div><div className="product-card-body"><div className="product-card-title"><h3>{p.name}</h3><span className={"mini-status " + (p.is_active ? "status-live" : "status-muted")}>{p.is_active ? "Live" : "Hidden"}</span></div><p>{p.description || "No description added yet."}</p><div className="product-card-footer"><strong>{money(p.price_minor)}</strong><div><button className="icon-button" aria-label={"Edit " + p.name} onClick={() => onEdit(p)}><Settings size={16} /></button><button className="button small secondary" onClick={() => onToggle(p)}>{p.is_active ? "Hide" : "Publish"}</button></div></div></div></article>)}</div> : <EmptyState icon={<Package size={22} />} title={search ? "No matching products" : "Your catalogue is empty"} description={search ? "Try another search term." : "Add your first product to start taking orders."} action={!search ? <button className="button primary" onClick={onAdd}><Plus size={16} /> Add product</button> : undefined} />}{previewImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={"Image preview: " + previewImage.name} onClick={() => setPreviewImage(null)}><button type="button" className="image-lightbox-close" aria-label="Close image preview" onClick={() => setPreviewImage(null)}><X size={24} /></button><div className="image-lightbox-content" onClick={event => event.stopPropagation()}><div className="image-lightbox-title">{previewImage.name}</div><div className="image-lightbox-stage"><img src={previewImage.url} alt={previewImage.name} style={{ transform: "scale(" + imageZoom + ")" }} /></div><div className="image-lightbox-controls"><button type="button" aria-label="Zoom out" disabled={imageZoom <= 1} onClick={() => setImageZoom(value => Math.max(1, Number((value - 0.25).toFixed(2))))}>−</button><span>{Math.round(imageZoom * 100)}%</span><button type="button" aria-label="Zoom in" disabled={imageZoom >= 3} onClick={() => setImageZoom(value => Math.min(3, Number((value + 0.25).toFixed(2))))}>+</button><button type="button" className="image-lightbox-reset" onClick={() => setImageZoom(1)}>Reset</button></div><p className="image-lightbox-help">Tap outside or press Esc to close · Use + / − to zoom</p></div></div>}</>;
}
function OrdersPage({ orders, search, setSearch, onStatus, onPayment }: { orders: Order[]; search: string; setSearch: (v: string) => void; onStatus: (o: Order, s: string) => void; onPayment: (o: Order) => void }) {
  const [filter, setFilter] = useState("all");
  const statuses = ["all", "new", "processing", "ready", "dispatched", "delivered", "cancelled"];
  const filtered = orders.filter(o => filter === "all" || o.status === filter);
  return <><PageHeader eyebrow="CUSTOMER ACTIVITY" title="Orders" description="Every purchase request, from new order to delivery." /><div className="toolbar orders-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search orders" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone or order…" /></div><div className="filter-select"><span>Status</span><select value={filter} onChange={e => setFilter(e.target.value)}>{statuses.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>)}</select><ChevronDown size={14} /></div><span className="result-count">{filtered.length} orders</span></div><section className="panel full-table-panel">{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Order / customer</th><th>Date</th><th>Fulfilment</th><th>Status</th><th className="align-right">Total</th><th>Payment</th><th>Actions</th></tr></thead><tbody>{filtered.map(o => <tr key={o.id}><td><CustomerCell name={o.customer_name} detail={"#" + o.id.slice(0, 8) + " · " + o.customer_phone} /></td><td className="muted-cell">{dateLabel(o.created_at)}</td><td><span className="fulfilment-label">{o.fulfilment_method === "collection" ? <Package size={14} /> : <Truck size={14} />}{o.fulfilment_method === "collection" ? "Collection" : "Delivery"}</span></td><td><StatusPill status={o.status} /></td><td className="align-right amount-cell">{money(o.total_amount_minor)}</td><td><PaymentPill order={o} /></td><td><div className="row-actions"><button className="button small secondary" onClick={() => onPayment(o)}>Payment</button><select className="status-select" aria-label={"Update status for order " + o.id.slice(0, 8)} value={o.status} onChange={e => onStatus(o, e.target.value)}>{statuses.slice(1).map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></div></td></tr>)}</tbody></table></div> : <EmptyState icon={<ShoppingCart size={22} />} title="No orders found" description="Orders will appear here after customers submit them." />}</section></>;
}
function ReservationsPage({ reservations, unavailable, onStatus }: { reservations: Reservation[]; unavailable: boolean; onStatus: (r: Reservation, s: "confirmed" | "cancelled") => void }) {
  return <><PageHeader eyebrow="SAVE IT FOR LATER" title="Reservations" description="Review requests from customers who want to reserve a product for later purchase or pickup." />{unavailable ? <div className="reservation-notice"><div className="reservation-notice-icon"><ClipboardList size={23} /></div><div><h3>Reservation service is not connected yet</h3><p>The screen is ready, but this feature needs dedicated reservation fields and Supabase Edge Functions. Orders stay separate so a reservation is never mistaken for a sale.</p><span className="mini-status status-muted">Backend dependency</span></div></div> : reservations.length ? <section className="panel full-table-panel"><div className="table-wrap"><table><thead><tr><th>Customer</th><th>Requested pickup</th><th>Date requested</th><th>Status</th><th className="align-right">Value</th><th>Actions</th></tr></thead><tbody>{reservations.map(r => <tr key={r.id}><td><CustomerCell name={r.customer_name} detail={r.customer_phone} /></td><td>{dateLabel(r.requested_pickup_at || undefined)}</td><td>{dateLabel(r.created_at)}</td><td><StatusPill status={r.status} /></td><td className="align-right amount-cell">{money(r.total_amount_minor)}</td><td><div className="row-actions"><button className="button small primary" disabled={r.status === "confirmed"} onClick={() => onStatus(r, "confirmed")}>Confirm</button><button className="button small secondary" disabled={["cancelled", "rejected"].includes(r.status)} onClick={() => onStatus(r, "cancelled")}>Reject</button></div></td></tr>)}</tbody></table></div></section> : <EmptyState icon={<ClipboardList size={22} />} title="No reservation requests yet" description="New product reservation requests will show up here." />}<div className="bottom-note"><span><CircleHelp size={15} /> Reservation policy</span>Confirm availability before promising a product. This pilot does not automatically lock stock or expire reservations.</div></>;
}
function PaymentsPage({ orders, payments, onRecord }: { orders: Order[]; payments: PaymentRecord[]; onRecord: (o: Order) => void }) {
  const [customerFilter, setCustomerFilter] = useState("");
  const received = orders.reduce((s, o) => s + Number(o.amount_paid_minor || 0), 0);
  const due = orders.reduce((s, o) => s + Math.max(0, Number(o.total_amount_minor || 0) - Number(o.amount_paid_minor || 0)), 0);
  const payable = orders.filter(o => Number(o.total_amount_minor) > Number(o.amount_paid_minor) && o.status !== "cancelled");
  const filteredPayments = payments.filter(p => {
    const order = orders.find(o => o.id === p.order_id);
    const q = customerFilter.trim().toLowerCase();
    return !q || [order?.customer_name, order?.customer_phone, p.reference, p.note, p.order_id, p.method].some(v => String(v || "").toLowerCase().includes(q));
  });
  return <><PageHeader eyebrow="MONEY IN, MONEY DUE" title="Payments" description="Each customer payment is recorded separately, with its own date, method and reference." /><div className="payment-metrics"><div className="payment-metric"><span className="metric-icon green"><Wallet size={19} /></span><span>Total received</span><strong>{money(received)}</strong><small>Across all orders</small></div><div className="payment-metric"><span className="metric-icon orange"><CreditCard size={19} /></span><span>Outstanding</span><strong>{money(due)}</strong><small>Balance still to collect</small></div><div className="payment-metric"><span className="metric-icon blue"><ClipboardList size={19} /></span><span>Orders to collect</span><strong>{payable.length}</strong><small>Unpaid or partially paid</small></div></div><section className="panel full-table-panel"><div className="panel-heading"><div><h3>Customer balances</h3><p>One row per order, showing each customer’s total, paid amount and remaining balance.</p></div></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>Customer / order</th><th>Total</th><th>Received</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><CustomerCell name={o.customer_name} detail={o.customer_phone + " · #" + o.id.slice(0, 8)} /></td><td className="amount-cell">{money(o.total_amount_minor)}</td><td className="amount-cell">{money(o.amount_paid_minor)}</td><td className="amount-cell">{money(Number(o.total_amount_minor) - Number(o.amount_paid_minor))}</td><td><PaymentPill order={o} /></td><td><button className="button small secondary" disabled={Number(o.amount_paid_minor) >= Number(o.total_amount_minor) || o.status === "cancelled"} onClick={() => onRecord(o)}>{Number(o.amount_paid_minor) ? "Add payment" : "Record payment"}</button></td></tr>)}</tbody></table></div> : <EmptyState icon={<Wallet size={22} />} title="No customer balances yet" description="Customer orders will appear here when they are submitted." />}</section><section className="panel full-table-panel"><div className="panel-heading"><div><h3>Individual payment transactions</h3><p>Every instalment and payment is listed separately for easier tracking.</p></div><span className="result-count">{filteredPayments.length} records</span></div><div className="toolbar orders-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Filter payment records" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} placeholder="Search customer, phone, reference…" /></div></div>{filteredPayments.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Customer / order</th><th>Method</th><th>Reference / note</th><th className="align-right">Amount</th></tr></thead><tbody>{filteredPayments.map(p => { const order = orders.find(o => o.id === p.order_id); return <tr key={p.id}><td className="muted-cell">{dateLabel(p.recorded_at)}</td><td><CustomerCell name={order?.customer_name || "Customer"} detail={(order?.customer_phone || "") + " · #" + p.order_id.slice(0, 8)} /></td><td><span className="fulfilment-label">{p.method.replace("_", " ")}</span></td><td><div>{p.reference || "—"}</div>{p.note && <small className="muted-cell">{p.note}</small>}</td><td className="align-right amount-cell">{money(p.amount_minor)}</td></tr>; })}</tbody></table></div> : <EmptyState icon={<CreditCard size={22} />} title="No individual payments recorded" description="Record a customer payment from their balance row. Each payment will appear here as its own transaction." />}</section></>;
}
function SettingsPage({ business, productsCount }: { business: Business; productsCount: number }) {
  const url = window.location.origin + "/store/" + business.slug;
  return <><PageHeader eyebrow="YOUR WORKSPACE" title="Store settings" description="Your public store details and launch information." /><div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h3>Business profile</h3><p>These details identify your public storefront.</p></div><span className="mini-status status-live">Active</span></div><SettingRow label="Business name" value={business.name} /><SettingRow label="Store slug" value={business.slug} /><SettingRow label="Business type" value="Product store" /><SettingRow label="Email" value={business.email || "Not added"} /><SettingRow label="WhatsApp" value={business.whatsapp_number || "Not added"} /><SettingRow label="Timezone" value={business.timezone || "Africa/Lagos"} /><SettingRow label="Products" value={String(productsCount)} /></section><section className="panel settings-panel"><div className="panel-heading"><div><h3>Public storefront</h3><p>Share this link with your customers.</p></div><ExternalLink size={17} /></div><div className="public-link-box"><Store size={18} /><span>{url}</span></div><button className="button primary full" onClick={() => { void navigator.clipboard?.writeText(url); }}>Copy storefront link <ExternalLink size={15} /></button><p className="settings-help">Customer catalogue and submissions are handled by secured server-side functions. Test this link before sharing it.</p></section></div></>;
}
function SettingRow({ label, value }: { label: string; value: string }) { return <div className="settings-row"><span>{label}</span><strong>{value}</strong></div>; }
function PaymentPill({ order }: { order: Order }) {
  const paid = Number(order.amount_paid_minor || 0); const total = Number(order.total_amount_minor || 0); const status = paid <= 0 ? "unpaid" : paid >= total ? "paid" : "partial";
  return <span className={"status-pill payment-" + status}><i />{status === "unpaid" ? "Unpaid" : status === "paid" ? "Paid" : "Partial"}</span>;
}
function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase(); return <span className={"status-pill state-" + s.replace(/[^a-z0-9-]/g, "")}><i />{s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")}</span>;
}
function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", handler); document.body.style.overflow = "hidden"; return () => { window.removeEventListener("keydown", handler); document.body.style.overflow = ""; }; }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><span className="eyebrow">ORDERPING WORKSPACE</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close modal" onClick={onClose}><X size={18} /></button></div>{children}</section></div>;
}

function Storefront() {
  const { slug = "" } = useParams();
  const [store, setStore] = useState<{ business: { name: string; slug: string; email?: string; whatsapp_number?: string }; products: Product[] } | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [cart, setCart] = useState<Record<string, number>>({});
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null); const [imageZoom, setImageZoom] = useState(1);
  const [mode, setMode] = useState<"purchase" | "reservation">("purchase"); const [customer, setCustomer] = useState({ name: "", phone: "", email: "", note: "", fulfilment: "collection", pickup: "" });
  const [submitting, setSubmitting] = useState(false); const [success, setSuccess] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError("Storefront configuration is incomplete."); setLoading(false); return; }
      setLoading(true); setError("");
      try {
        const { data, error: fnError } = await supabase.functions.invoke("public-storefront", { body: { slug } });
        if (fnError) throw fnError;
        if (!data?.business || !Array.isArray(data.products)) throw new Error("Unexpected storefront response.");
        if (active) setStore(data);
      } catch (err) { if (active) setError("The public-storefront Edge Function must be deployed before this page can load. " + messageFromError(err)); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [slug]);
  useEffect(() => { if (!previewImage) return; const previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewImage(null); if (event.key === "+" || event.key === "=") setImageZoom(value => Math.min(3, Number((value + 0.25).toFixed(2)))); if (event.key === "-") setImageZoom(value => Math.max(1, Number((value - 0.25).toFixed(2)))); }; window.addEventListener("keydown", onKeyDown); return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); }; }, [previewImage]);
  const selected = (store?.products || []).filter(p => (cart[p.id] || 0) > 0);
  const total = selected.reduce((s, p) => s + Number(p.price_minor) * cart[p.id], 0);
  function quantity(id: string, delta: number) { setCart(old => { const n = Math.max(0, Math.min(1000, (old[id] || 0) + delta)); const next = { ...old }; if (!n) delete next[id]; else next[id] = n; return next; }); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!supabase || !store || !selected.length) return;
    if (mode === "reservation" && !customer.pickup) { setError("Choose your preferred pickup date and time."); return; }
    setSubmitting(true); setError(""); setSuccess("");
    try {
      const body = { slug, customer_name: customer.name.trim(), customer_phone: customer.phone.trim(), customer_email: customer.email.trim() || null, customer_note: customer.note.trim() || null, fulfilment_method: customer.fulfilment, requested_pickup_at: mode === "reservation" ? new Date(customer.pickup).toISOString() : null, items: selected.map(p => ({ catalog_item_id: p.id, quantity: cart[p.id] })) };
      const { data, error: fnError } = await supabase.functions.invoke(mode === "purchase" ? "submit-order" : "submit-reservation", { body });
      if (fnError) throw fnError; if (data?.error) throw new Error(String(data.error));
      setSuccess(mode === "purchase" ? "Your order has been submitted. The store will follow up with you." : "Your reservation request has been sent. The store will confirm availability."); setCart({});
    } catch (err) { setError(messageFromError(err)); } finally { setSubmitting(false); }
  }
  return <div className="storefront-page"><header className="storefront-header"><Brand /><span className="storefront-secure"><span /> Shop directly with the business</span></header>{loading ? <FullLoader label="Opening store…" /> : error && !store ? <div className="storefront-message"><span className="empty-icon"><Store size={24} /></span><h1>Store unavailable</h1><p>{error}</p><Link className="button secondary" to="/">Back to OrderPing</Link></div> : store ? <><section className="store-hero"><span className="eyebrow">OFFICIAL STOREFRONT</span><div className="store-avatar"><Store size={28} /></div><h1>{store.business.name}</h1><p>Browse the catalogue and place an order, or reserve products for later pickup.</p><div className="store-hero-meta"><span><CheckCircle2 size={15} /> Direct with the seller</span><span><ShoppingBag size={15} /> {store.products.length} products</span></div></section><main className="store-content"><div className="store-section-heading"><div><span className="eyebrow">THE COLLECTION</span><h2>Available products</h2></div><span className="result-count">{selected.length} in your list</span></div>{store.products.length ? <div className="store-products-grid">{store.products.map((p, i) => <article className="store-product-card" key={p.id}><div className={"store-product-art art-tone-" + (i % 5)}>{p.image_url ? <button type="button" className="store-image-trigger" aria-label={"View larger image of " + p.name} onClick={() => { setPreviewImage({ url: p.image_url!, name: p.name }); setImageZoom(1); }}><img className="store-product-image" src={p.image_url} alt={p.name} loading="lazy" /><span className="store-image-hint"><Search size={14} /> Tap to zoom</span></button> : <Package size={33} />}</div><div className="store-product-details"><h3>{p.name}</h3><p>{p.description || "Available from this store."}</p><div className="store-product-bottom"><strong>{money(p.price_minor)}</strong><div className="quantity-stepper"><button aria-label={"Remove one " + p.name} disabled={!cart[p.id]} onClick={() => quantity(p.id, -1)}>−</button><span>{cart[p.id] || 0}</span><button aria-label={"Add one " + p.name} onClick={() => quantity(p.id, 1)}><Plus size={15} /></button></div></div></div></article>)}</div> : <EmptyState icon={<Package size={22} />} title="Products coming soon" description="This store has not published any products yet." />}{selected.length > 0 && <section className="store-checkout"><div className="checkout-heading"><div><span className="eyebrow">YOUR SELECTION</span><h2>Ready when you are.</h2></div><strong>{money(total)}</strong></div><div className="checkout-mode"><button className={mode === "purchase" ? "selected" : ""} onClick={() => setMode("purchase")}><ShoppingCart size={16} /> Place an order</button><button className={mode === "reservation" ? "selected" : ""} onClick={() => setMode("reservation")}><Clock3 size={16} /> Reserve for later</button></div><form className="store-form" onSubmit={submit}><div className="store-form-grid"><label>Your name<input required maxLength={120} value={customer.name} onChange={e => setCustomer(v => ({ ...v, name: e.target.value }))} placeholder="Full name" /></label><label>Phone number<input type="tel" required minLength={5} maxLength={32} value={customer.phone} onChange={e => setCustomer(v => ({ ...v, phone: e.target.value }))} placeholder="+234…" /></label><label>Email <span className="optional-label">Optional</span><input type="email" value={customer.email} onChange={e => setCustomer(v => ({ ...v, email: e.target.value }))} placeholder="you@example.com" /></label>{mode === "purchase" ? <label>Fulfilment<select value={customer.fulfilment} onChange={e => setCustomer(v => ({ ...v, fulfilment: e.target.value }))}><option value="collection">Pickup / collection</option><option value="delivery">Delivery</option></select></label> : <label>Preferred pickup<input type="datetime-local" required min={new Date(Date.now() + 60000).toISOString().slice(0, 16)} value={customer.pickup} onChange={e => setCustomer(v => ({ ...v, pickup: e.target.value }))} /></label>}</div><label>Note <span className="optional-label">Optional</span><textarea rows={2} maxLength={500} value={customer.note} onChange={e => setCustomer(v => ({ ...v, note: e.target.value }))} placeholder="Any details the seller should know?" /></label>{error && <div className="inline-alert error">{error}</div>}{success && <div className="inline-alert success"><CheckCircle2 size={17} />{success}</div>}<button className="button primary full" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={17} /> : null}{mode === "purchase" ? "Submit order" : "Request reservation"} <ArrowRight size={16} /></button><p className="checkout-disclaimer">No payment is taken here. The seller will contact you to confirm details and payment.</p></form></section>}</main><footer className="storefront-footer"><span>Powered by <strong>OrderPing</strong></span><span>Orders made simpler.</span></footer>{previewImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={"Image preview: " + previewImage.name} onClick={() => setPreviewImage(null)}><button type="button" className="image-lightbox-close" aria-label="Close image preview" onClick={() => setPreviewImage(null)}><X size={24} /></button><div className="image-lightbox-content" onClick={event => event.stopPropagation()}><div className="image-lightbox-title">{previewImage.name}</div><div className="image-lightbox-stage"><img src={previewImage.url} alt={previewImage.name} style={{ transform: "scale(" + imageZoom + ")" }} /></div><div className="image-lightbox-controls"><button type="button" aria-label="Zoom out" disabled={imageZoom <= 1} onClick={() => setImageZoom(value => Math.max(1, Number((value - 0.25).toFixed(2))))}>−</button><span>{Math.round(imageZoom * 100)}%</span><button type="button" aria-label="Zoom in" disabled={imageZoom >= 3} onClick={() => setImageZoom(value => Math.min(3, Number((value + 0.25).toFixed(2))))}>+</button><button type="button" className="image-lightbox-reset" onClick={() => setImageZoom(1)}>Reset</button></div><p className="image-lightbox-help">Tap outside or press Esc to close · Use + / − to zoom</p></div></div>}</> : null}</div>;
}
function NotFound() {
  return <div className="not-found"><div className="brand-mark"><ShoppingBag size={22} /></div><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>That page isn't here.</h1><p>The link may be incorrect, or this page may have moved.</p><Link className="button primary" to="/app">Back to workspace <ArrowRight size={16} /></Link></div>;
}
