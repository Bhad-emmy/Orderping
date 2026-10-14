import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, CheckCircle2, LoaderCircle } from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
type Hours = { weekday: number; opens_at: string | null; closes_at: string | null; is_closed: boolean };
type Business = { name: string; slug: string; timezone: string; whatsapp_number: string | null };
const money = (n: number) => formatNaira(Number(n || 0));
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function PublicBookingPage() {
  const { slug = "" } = useParams();
  const [business, setBusiness] = useState<Business | null>(null);
  const [hours, setHours] = useState<Hours[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ id: string; starts_at: string } | null>(null);
  const dayHours = date ? hours.find(h => h.weekday === new Date(date + "T12:00:00").getDay()) : undefined;
  const minDate = new Date(Date.now() + 60_000).toISOString().slice(0, 10);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !isSupabaseConfigured) { setError("Booking is not configured yet."); setLoading(false); return; }
      try {
        const { data, error: invokeError } = await supabase.functions.invoke("public-booking", { body: { action: "load", slug } });
        if (invokeError || data?.error) throw new Error(data?.error || "Booking options could not be loaded.");
        if (active) { setBusiness(data.business); setHours(data.hours || []); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "This booking page is unavailable."); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [slug]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!supabase || !date || !time) { setError("Choose a date and time."); return; }
    const starts = new Date(date + "T" + time + ":00");
    if (!Number.isFinite(starts.getTime()) || starts.getTime() <= Date.now()) { setError("Choose a future appointment time."); return; }
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("public-booking", { body: {
        action: "book", slug, starts_at: starts.toISOString(),
        customer_name: name, customer_phone: phone, customer_email: email || null, customer_note: note || null,
      }});
      if (invokeError || data?.error) throw new Error(data?.error || "Your appointment could not be booked.");
      setSuccess({ id: data.appointment.id, starts_at: data.appointment.starts_at });
    } catch (e) { setError(e instanceof Error ? e.message : "Booking failed. Please try another time."); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="full-loader"><LoaderCircle size={22} className="spin" /> Loading booking page…</div>;
  if (success) return <main className="public-booking-page"><section className="public-booking-card booking-success"><span className="booking-success-icon"><CheckCircle2 size={30} /></span><span className="eyebrow">BOOKING REQUEST SENT</span><h1>You're on the calendar.</h1><p>Your appointment request has been sent to {business?.name}. The business will confirm it with you.</p><div className="booking-summary"><div><span>Reference</span><strong>#{success.id.slice(0, 8).toUpperCase()}</strong></div><div><span>Date and time</span><strong>{new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(success.starts_at))}</strong></div><div><span>Price</span><strong>Agreed at the location</strong></div></div><p className="booking-note">No payment has been collected through this page. Please contact the business if you need to change your request.</p><Link to={"/store/" + encodeURIComponent(slug)} className="button secondary"><ArrowLeft size={15} /> Back to business</Link></section></main>;
  if (error && !business) return <main className="public-booking-page"><section className="public-booking-card"><CalendarDays size={28} /><h1>Booking page unavailable</h1><p>{error}</p><Link to="/" className="button secondary">Back to OrderPing</Link></section></main>;
  return <main className="public-booking-page"><header className="booking-topbar"><Link to={"/store/" + encodeURIComponent(slug)}><ArrowLeft size={16} /> Back to store</Link><span>Powered by <strong>OrderPing</strong></span></header><section className="public-booking-hero"><span className="booking-service-icon"><CalendarDays size={22} /></span><span className="eyebrow">BOOK ONLINE</span><h1>Book with {business?.name}</h1><p>Choose a date and preferred time. Discuss the exact service and price directly with the business.</p></section><form className="public-booking-card booking-form" onSubmit={submit}><div className="booking-section-title"><span>01</span><div><h2>Pick a date and time</h2><p>Appointments are requested in the business's local time.</p></div></div><div className="booking-date-grid"><label>Date<input type="date" min={minDate} required value={date} onChange={e => { setDate(e.target.value); setTime(""); }} /></label><label>Time<select required value={time} onChange={e => setTime(e.target.value)} disabled={!date || !dayHours || dayHours.is_closed || !dayHours.opens_at || !dayHours.closes_at}><option value="">Choose a time</option>{dayHours && !dayHours.is_closed && dayHours.opens_at && dayHours.closes_at ? (() => { const options: string[] = []; const [oh, om] = dayHours.opens_at!.slice(0, 5).split(":").map(Number); const [ch, cm] = dayHours.closes_at!.slice(0, 5).split(":").map(Number); const start = oh * 60 + om; const end = ch * 60 + cm; for (let m = start; m + 30 <= end; m += 30) options.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0")); return options.map(t => <option key={t} value={t}>{t}</option>); })() : null}</select>{date && (!dayHours || dayHours.is_closed) && <small className="field-hint">{weekdays[new Date(date + "T12:00:00").getDay()]} is marked closed.</small>}</label></div><div className="booking-section-title"><span>02</span><div><h2>Your details</h2><p>The business uses these details to confirm your appointment.</p></div></div><div className="booking-date-grid"><label>Full name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></label><label>Phone number<input required type="tel" maxLength={32} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+234…" /></label></div><label>Email address (optional)<input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>What do you need? (optional)<textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Briefly describe what you want done. The final price will be agreed at the location." /></label>{error && <div className="inline-alert error">{error}</div>}<button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <CalendarDays size={16} />}{busy ? "Sending request…" : "Request appointment"}</button><p className="booking-note">No price is displayed or collected online. The business will confirm your appointment and agree on the price with you at the location.</p></form><footer className="storefront-footer"><span>© {new Date().getFullYear()} OrderPing</span><span>Appointments made simpler.</span></footer></main>;
}
