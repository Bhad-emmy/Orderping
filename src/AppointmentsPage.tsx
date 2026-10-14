import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { CalendarDays, Check, Clock3, LoaderCircle, RefreshCw, Search, XCircle } from "lucide-react";
import { formatNaira, messageFromError, supabase } from "./lib/supabase";

type Business = { id: string; name: string; slug: string };
type Appointment = {
  id: string; business_id: string; catalog_item_id: string | null; customer_name: string;
  customer_phone: string; customer_email: string | null; customer_note: string | null;
  starts_at: string; ends_at: string; status: string; total_amount_minor: number | null;
  amount_paid_minor: number; currency_code: string; created_at: string;
};
type Service = { id: string; name: string; duration_minutes: number };
const money = (n: number) => formatNaira(Number(n || 0));
const dateTime = (v: string) => new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));

export default function AppointmentsPage({ user }: { user: User }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Record<string, Service>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError("");
    try {
      const { data: found, error: businessError } = await supabase.from("businesses")
        .select("id,name,slug").eq("owner_id", user.id).maybeSingle();
      if (businessError) throw businessError;
      if (!found) { setBusiness(null); setAppointments([]); setServices({}); return; }
      setBusiness(found as Business);
      const { data, error: appointmentError } = await supabase.from("appointments")
        .select("*").eq("business_id", found.id).order("starts_at", { ascending: true }).limit(300);
      if (appointmentError) throw appointmentError;
      const rows = (data || []) as Appointment[];
      setAppointments(rows);
      const ids = [...new Set(rows.map(row => row.catalog_item_id).filter(Boolean))];
      if (ids.length) {
        const { data: catalog, error: catalogError } = await supabase.from("catalog_items")
          .select("id,name,duration_minutes").eq("business_id", found.id).in("id", ids);
        if (catalogError) throw catalogError;
        setServices(Object.fromEntries(((catalog || []) as Service[]).map(s => [s.id, s])));
      } else setServices({});
    } catch (e) { setError(messageFromError(e)); }
    finally { setLoading(false); }
  }, [user.id]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(item: Appointment, status: "confirmed" | "cancelled" | "completed") {
    if (!supabase || !business) return;
    setSavingId(item.id); setError(""); setNotice("");
    try {
      const { error: updateError } = await supabase.from("appointments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", item.id).eq("business_id", business.id);
      if (updateError) throw updateError;
      setNotice(status === "confirmed" ? "Appointment confirmed." : status === "cancelled" ? "Appointment cancelled." : "Appointment marked complete.");
      await load();
    } catch (e) { setError("Could not update appointment. " + messageFromError(e)); }
    finally { setSavingId(""); }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appointments.filter(item => (filter === "all" || item.status === filter) &&
      (!q || [item.customer_name, item.customer_phone, item.customer_email || "", item.id, (item.catalog_item_id ? services[item.catalog_item_id]?.name : "Price agreed at location") || ""].some(v => v.toLowerCase().includes(q))));
  }, [appointments, filter, search, services]);
  const pendingCount = appointments.filter(a => a.status === "pending").length;

  return <>
    <div className="page-header"><div><span className="eyebrow">CUSTOMER APPOINTMENTS</span><h1>Appointments</h1><p>Review requests and manage your business's appointment calendar.</p></div><button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Refresh</button></div>
    {!business && !loading ? <div className="panel"><div className="empty-state"><CalendarDays size={24} /><h3>Create your business first</h3><p>Appointment requests will appear here after your business is set up.</p></div></div> : <>
      <div className="payment-metrics">
        <div className="payment-metric"><span className="metric-icon orange"><Clock3 size={19} /></span><span>Awaiting response</span><strong>{pendingCount}</strong><small>Requests needing attention</small></div>
        <div className="payment-metric"><span className="metric-icon blue"><CalendarDays size={19} /></span><span>Total requests</span><strong>{appointments.length}</strong><small>Most recent 300 appointments</small></div>
      </div>
      <div className="toolbar orders-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search appointments" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone or service…" /></div><div className="filter-select"><span>Status</span><select value={filter} onChange={e => setFilter(e.target.value)}>{["pending","confirmed","completed","cancelled","all"].map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}</option>)}</select></div><span className="result-count">{visible.length} requests</span></div>
      {notice && <div className="toast success" role="status"><Check size={17} />{notice}</div>}
      {error && <div className="inline-alert error page-error">{error}<button className="text-link" onClick={() => void load()}>Retry</button></div>}
      <section className="panel full-table-panel">{loading ? <div className="empty-state"><LoaderCircle size={22} className="spin" /><p>Loading appointments…</p></div> : visible.length ? <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Service</th><th>Appointment time</th><th>Status</th><th>Price</th><th>Actions</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong>{item.customer_name}</strong><div className="muted-cell">{item.customer_phone}</div>{item.customer_email && <div className="muted-cell">{item.customer_email}</div>}{item.customer_note && <small className="muted-cell">Note: {item.customer_note}</small>}</td><td>{item.catalog_item_id ? services[item.catalog_item_id]?.name || "Service" : "Flexible booking"}{!item.catalog_item_id && <div className="muted-cell">Details agreed in person</div>}</td><td><div>{dateTime(item.starts_at)}</div><small className="muted-cell">Until {dateTime(item.ends_at)}</small></td><td><span className={"status-pill state-" + item.status}>{item.status[0].toUpperCase() + item.status.slice(1)}</span></td><td className="amount-cell">{item.total_amount_minor == null ? "Agreed on arrival" : money(item.total_amount_minor)}</td><td><div className="row-actions">{item.status === "pending" && <><button className="button small primary" disabled={!!savingId} onClick={() => void updateStatus(item, "confirmed")}>{savingId === item.id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Confirm</button><button className="button small secondary" disabled={!!savingId} onClick={() => void updateStatus(item, "cancelled")}><XCircle size={14} /> Reject</button></>}{item.status === "confirmed" && <><button className="button small primary" disabled={!!savingId} onClick={() => void updateStatus(item, "completed")}>Complete</button><button className="button small secondary" disabled={!!savingId} onClick={() => void updateStatus(item, "cancelled")}>Cancel</button></>}</div></td></tr>)}</tbody></table></div> : <div className="empty-state"><CalendarDays size={24} /><h3>{filter === "pending" ? "No pending appointment requests" : "No appointments found"}</h3><p>{search ? "Try another search." : "When customers request an appointment from your public booking page, it will appear here."}</p></div>}</section>
      <div className="bottom-note"><span><CalendarDays size={15} /> Public booking link</span><a href={"/book/" + encodeURIComponent(business?.slug || "")} target="_blank" rel="noreferrer">{window.location.origin + "/book/" + (business?.slug || "")}</a></div>
    </>}
  </>;
}
